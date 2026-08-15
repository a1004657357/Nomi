# 项目卡封面：纯导入视频项目显示「加载失败」——媒体类型盲的封面派生根治

日期：2026-08-01 ｜ 范围：项目封面派生（renderer + main 双副本）+ 项目库卡片渲染

## 症状 → 根因 → 入口集（P2）

**症状**：项目库卡片封面对「只含本地导入视频素材」的项目显示「加载失败」（NomiImage 失败占位）。

**根因**：封面派生（`extractCanvasThumbnailUrls` / main 侧 `deriveThumbnailUrls`）对任何有 `result`
的节点直接取 `result.url || result.thumbnailUrl`，**完全无视 `result.type`**。导入 mp4 的素材节点
`result = { type:'video', url:'nomi-local://….mp4' }`（无 poster）→ 封面 URL 是视频 → 塞进
`<img>`（NomiImage）→ 必然 decode 失败 → onError → 「加载失败」。

**这类 bug 的入口集**（不止导入素材）：任何「首个有产物的画布节点不是图片」的项目——
生成视频（`url` 排在 `thumbnailUrl` 之前，同样取到视频）、音频、纯文本结果，全部会把不可
`<img>` 渲染的 URL 派生成封面。修法必须按 `result.type` 分流，才能整类不复发。

**顺带发现（P1）**：派生逻辑实际有 **3 份副本**——`projectNormalize.ts`（真相源）、
`workspaceRepository.ts`（main 等价副本，有等价测试）、`projectSummaryRepository.ts`
（**零引用死码**，且自带第三份无测试的漂移副本 + 第二份 normalizeSummary 副本）。

## 修法

**派生层（真相源换代）**：新纯模块 `src/workbench/project/projectCoverDerive.ts`：

```ts
type ProjectCover = { imageUrls: string[]; videoUrl?: string }
deriveProjectCoverFromNodes(nodes, max=4): ProjectCover
deriveProjectCoverFromRaw(raw): ProjectCover
```

按 `result.type` 分流：`image` → url‖thumbnailUrl；`video` → thumbnailUrl（poster）进
imageUrls，无 poster 时 url 进 `videoUrl`（取首个）；`model3d` → thumbnailUrl；
`text`/`audio` → 跳过；**type 缺失（脏/老数据）→ 维持旧行为按图片取**（url‖thumbnailUrl）。
`length > 4` 过滤、max 截断、脏数据降级语义全保留。

**main 侧副本**：`deriveThumbnailUrls` → `deriveProjectCover`（同算法 CJS 镜像，跨 tsconfig
无法共享模块的既有约束不变），等价测试 `thumbnailDerive.equivalence.test.ts` 扩 typed fixtures
（video 无/有 poster、audio/text 跳过、model3d、type 缺失）双侧逐字对齐。

**Summary 通道（transient，不进持久化 schema）**：`WorkbenchProjectSummary` /
`WorkspaceProjectSummary` 加 `coverVideoUrl?: string`——**只在 list/publish 时现场派生**，
不写进 zod schema、不持久化（桌面 manifest schema 本就 strip 未知字段；这是刻意的：
封面 URL 持久化会腐坏，bundle-asset 教训的同族）。`thumbnail`/`thumbnailUrls` 语义收紧为
**仅可 `<img>` 渲染的 URL**（这两个字段的所有消费方都是 `<img>` 语境）。

**渲染层**：`ThumbnailMosaic` 增加 `videoUrl` 兜底——`imageUrls` 空且有 `videoUrl` 时用
`<video muted preload="metadata" src="…#t=0.1">` 首帧当封面（nomi-local 已支持 byte-range，
PR#54）；`onError` 降级为中性占位（不再出现「加载失败」字样——那是图片语境的文案）。

**诚实封面（去 stale 类）**：`saveLocalProject` 删掉「本次派生为空则沿用 existing 旧封面」的
fallback——封面永远反映**当前保存内容**；web 模式 list 改为「record 可读就现场派生」（桌面
main list 本就每次现场派生），持久化 summary 缩略图字段只在 record 不可读时兜底。

**删死码（P1）**：删除 `projectSummaryRepository.ts` 整文件。

## 不动项

- 持久化 schema（`workbenchProjectSummarySchema` / `workspaceProjectRecordSchema`）零改动，无迁移。
- 画布节点/素材导入链路、时间轴、NomiImage 组件不动。
- 卡片布局/交互不动（同一个封面槽，内容从「必炸的 img」换成「视频首帧」）。

## 验收门

1. 单测：`projectCoverDerive.test.ts`（typed 全分支）+ 等价测试扩展双侧对齐 + 存量测试全绿。
2. 五门全过（filesize/tokens/i18n/lint/typecheck/test/build）。
3. R13 真机走查（dist + 隔离目录）：播种「仅导入 mp4 素材」项目 → 项目库卡片封面真的painted
   视频首帧（videoWidth>0）、页面无「加载失败」；图片项目封面回归不坏。截图亲眼 Read。

## 回滚

单 commit revert 即回原状（无迁移、无 schema 变更、无数据写入格式变化）。
