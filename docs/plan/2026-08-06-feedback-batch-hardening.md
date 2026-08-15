# Canvas Feedback Batch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根治 2026-08-06 群反馈中的画布遮挡/清晰度、连线可编辑、分组拖动、多结果删除与项目异常恢复，并锁住已经修复的本地上传。

**Architecture:** 画布屏幕空间控件通过稳定 data contract 共用几何；连接模式与结果生命周期分别下沉为纯函数；素材库所有结果从同一投影产生。主进程负责 manifest 诊断/备份/恢复，renderer 只编排用户反馈与重新 hydrate。

**Tech Stack:** Electron 31、React 18、TypeScript、Zustand、Tailwind 3、Vitest、Playwright。

---

### Task 1: 屏幕空间工具条契约与清晰度

**Files:**
- Modify: `src/workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx`
- Modify: `src/workbench/generationCanvas/nodes/useComposerViewportPlacement.ts`
- Create: `src/workbench/generationCanvas/nodes/useComposerViewportPlacement.test.ts`
- Modify: `src/workbench/generationCanvas/nodes/NodePromptOptimizer.tsx`

- [x] **Step 1: 写 clearance 失败测试**

```ts
expect(toolbarClearanceInCanvasUnits(42, 0.7, 18)).toBe(78)
expect(toolbarClearanceInCanvasUnits(0, 0.7, 18)).toBe(0)
```

- [x] **Step 2: 运行测试，确认导出不存在而失败**

Run: `pnpm exec vitest run src/workbench/generationCanvas/nodes/useComposerViewportPlacement.test.ts`
Expected: FAIL，`toolbarClearanceInCanvasUnits` 未导出。

- [x] **Step 3: 实现稳定几何契约**

```ts
export const NODE_FLOATING_TOOLBAR_SELECTOR = '[data-node-floating-toolbar="true"]'
export function toolbarClearanceInCanvasUnits(height: number, zoom: number, gap: number): number {
  return height > 0 ? height / (zoom || 1) + gap : 0
}
```

`FloatingToolbarShell` 增加 `data-node-floating-toolbar="true"`，改用实体 `bg-nomi-paper` 并移除 backdrop blur；placement hook 查询新 selector。

- [x] **Step 4: 提升提示词优化弹层对比度**

将 textarea placeholder 改为 `placeholder:text-nomi-ink-60`，保持 token surface，不引入硬编码颜色。

- [x] **Step 5: 运行定向测试**

Run: `pnpm exec vitest run src/workbench/generationCanvas/nodes/useComposerViewportPlacement.test.ts`
Expected: PASS。

### Task 2: 可编辑且能力安全的连线语义

**Files:**
- Create: `src/workbench/generationCanvas/components/edgeModeMenu.ts`
- Create: `src/workbench/generationCanvas/components/edgeModeMenu.test.ts`
- Modify: `src/workbench/generationCanvas/components/CanvasEdgeLayer.tsx`
- Modify: `src/workbench/generationCanvas/components/GenerationCanvas.tsx`
- Modify: `src/workbench/generationCanvas/styles/generationCanvas.css`
- Modify: `src/i18n/resources.ts`

- [x] **Step 1: 写能力过滤失败测试**

```ts
expect(availableEdgeModes(imageSource, imageTargetWithoutLastFrame)).not.toContain('last_frame')
expect(availableEdgeModes(characterSource, seedreamTarget)).toContain('character_ref')
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/workbench/generationCanvas/components/edgeModeMenu.test.ts`
Expected: FAIL，模块不存在。

- [x] **Step 3: 实现候选模式纯函数**

```ts
const EDITABLE_EDGE_MODES: GenerationCanvasEdgeMode[] = [
  'reference', 'first_frame', 'last_frame', 'style_ref', 'character_ref', 'composition_ref',
]
export const availableEdgeModes = (source, target) =>
  EDITABLE_EDGE_MODES.filter((mode) => validateReferenceEdge(source, target, mode).ok)
```

- [x] **Step 4: 把标签升级为菜单**

在反缩放 `foreignObject` 内渲染按钮和条件菜单；`onUpdateEdgeMode(edge.id, mode)` 复用 store action；断开入口并入同一菜单。通用 reference 边在 active 时显示“参考”按钮。

- [x] **Step 5: 加 i18n 与清晰度样式**

新增 `changeMode / disconnect / menuAria` 中英文 key；标签改用 token 字号/实体背景/描边，禁止新增任意色。

- [x] **Step 6: 运行测试与类型检查**

Run: `pnpm exec vitest run src/workbench/generationCanvas/components/edgeModeMenu.test.ts src/workbench/generationCanvas/store/generationCanvasStore.test.ts && pnpm run typecheck`
Expected: PASS。

### Task 3: 分组拖动 disclosure

**Files:**
- Create: `src/workbench/sidebar/groupDragDisclosure.ts`
- Create: `src/workbench/sidebar/groupDragDisclosure.test.ts`
- Modify: `src/workbench/sidebar/NodeItem.tsx`
- Modify: `src/workbench/sidebar/GroupItem.tsx`

- [x] **Step 1: 写拖动判定失败测试**

```ts
expect(isNodeDragType(['application/x-nomi-node-id'])).toBe(true)
expect(shouldAutoExpandDropGroup(false, ['application/x-nomi-node-id'])).toBe(true)
expect(shouldAutoExpandDropGroup(true, ['application/x-nomi-node-id'])).toBe(false)
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/workbench/sidebar/groupDragDisclosure.test.ts`
Expected: FAIL，模块不存在。

- [x] **Step 3: 实现父子拖动通知**

`NodeItem` 新增 `onDragStartNode?: (nodeId: string) => void`；写入 DataTransfer 后调用。`GroupItem` 收到后 `setExpanded(false)`。

- [x] **Step 4: 实现目标悬停展开**

折叠组收到节点 dragover 时启动 450ms timer；离开、drop、unmount 清理；timer 到期后展开。

- [x] **Step 5: 运行定向测试**

Run: `pnpm exec vitest run src/workbench/sidebar/groupDragDisclosure.test.ts`
Expected: PASS。

### Task 4: 结果级身份、主图切换与删除

**Files:**
- Create: `src/workbench/generationCanvas/model/nodeResultLifecycle.ts`
- Create: `src/workbench/generationCanvas/model/nodeResultLifecycle.test.ts`
- Modify: `src/workbench/generationCanvas/nodes/ImageResultStack.tsx`
- Modify: `src/i18n/resources.ts`

- [x] **Step 1: 写结果删除失败测试**

```ts
expect(removeNodeResult(node, 'old').result?.id).toBe('main')
expect(removeNodeResult(node, 'main').result?.id).toBe('old')
expect(removeNodeResult(singleResultNode, 'main')).toMatchObject({ result: undefined, history: [], status: 'idle' })
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/workbench/generationCanvas/model/nodeResultLifecycle.test.ts`
Expected: FAIL，模块不存在。

- [x] **Step 3: 实现纯结果生命周期**

```ts
export function resultKey(result: GenerationNodeResult): string { return result.id || result.url || '' }
export function listUniqueNodeResults(node: GenerationCanvasNode): GenerationNodeResult[] { /* result+history 去重 */ }
export function promoteNodeResult(node, key): ResultPatch { /* 目标置主，其余留 history */ }
export function removeNodeResult(node, key): ResultPatch { /* 删除后最新剩余项补主 */ }
```

- [x] **Step 4: 接入结果堆栈 UI**

替换组件内重复去重/切主逻辑；每张非主图增加 token 化垃圾桶按钮。点击后先更新节点，再把能解析出的 `nomi-local` 文件移入废纸篓；失败显示 warning，但节点不恢复坏引用。

- [x] **Step 5: 运行测试**

Run: `pnpm exec vitest run src/workbench/generationCanvas/model/nodeResultLifecycle.test.ts`
Expected: PASS。

### Task 5: 项目素材展示全部结果，全部素材可安全删除

**Files:**
- Modify: `src/workbench/assets/assetTypes.ts`
- Modify: `src/workbench/assets/useAssetPool.ts`
- Create: `src/workbench/assets/assetTypes.results.test.ts`
- Create: `src/workbench/assets/deleteAssetResult.ts`
- Create: `src/workbench/assets/deleteAssetResult.test.ts`
- Modify: `src/workbench/assets/AssetLibraryPanelParts.tsx`
- Modify: `src/workbench/assets/AssetLibraryPanel.tsx`
- Modify: `src/i18n/resources.ts`

- [x] **Step 1: 写多结果投影失败测试**

```ts
expect(canvasNodeToAssetRefs(nodeWithThreeResults).map((item) => item.ownerResultId)).toEqual(['main', 'old-1', 'old-2'])
```

- [x] **Step 2: 写跨项目记录删除失败测试**

```ts
expect(removeAssetResultFromNodes(nodes, target).nodes[0].history).toHaveLength(1)
expect(removeAssetResultFromNodes(nodes, unrelatedTarget).changed).toBe(false)
```

- [x] **Step 3: 运行测试确认失败**

Run: `pnpm exec vitest run src/workbench/assets/assetTypes.results.test.ts src/workbench/assets/deleteAssetResult.test.ts`
Expected: FAIL，新 API 不存在。

- [x] **Step 4: 实现一对多素材投影**

`AssetRef` 增加 `ownerResultId?: string`；新增 `canvasNodeToAssetRefs`，id 使用 `${node.id}:${resultKey}`；`useAssetPool` 改用 `flatMap`。删除旧的一对一实现调用路径。

- [x] **Step 5: 实现记录同步删除服务**

```ts
export async function deleteAssetResult(asset: AssetRef): Promise<DeleteAssetResultOutcome> {
  // 当前项目：更新 Zustand 节点；其它项目：readLocalProjectAsync → 纯函数改 payload → saveLocalProject
  // 最后 workspace.deleteFiles，把文件移入系统废纸篓
}
```

- [x] **Step 6: 全部素材增加独立删除动作**

`AssetGridCell` 增加 `onDelete`，右上角渲染垃圾桶按钮；只在 canvas usage 的“全部素材”提供。主点击继续预览，不改既有 item action。

- [x] **Step 7: 运行定向测试**

Run: `pnpm exec vitest run src/workbench/assets/assetTypes.results.test.ts src/workbench/assets/deleteAssetResult.test.ts src/workbench/assets/assetLibrarySources.test.ts`
Expected: PASS。

### Task 6: 项目 manifest 诊断、备份与恢复

**Files:**
- Create: `electron/workspace/workspaceProjectRecovery.ts`
- Create: `electron/workspace/workspaceProjectRecovery.test.ts`
- Modify: `electron/workspace/workspaceRepository.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/bridge.ts`
- Modify: `src/workbench/NomiStudioApp.tsx`
- Modify: `src/i18n/resources.ts`

- [x] **Step 1: 写诊断/恢复失败测试**

```ts
expect(diagnoseWorkspaceProject(projectId, deps)).toMatchObject({ status: 'corrupt', recoverable: true })
expect(recoverWorkspaceProject(projectId, deps).ok).toBe(true)
expect(fs.existsSync(quarantinedPath)).toBe(true)
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run electron/workspace/workspaceProjectRecovery.test.ts`
Expected: FAIL，模块不存在。

- [x] **Step 3: 实现保存前备份**

保存新 manifest 前，若现有 manifest 能解析，原子写入 `.nomi/project.backup.json`；初始化创建不制造无意义备份。

- [x] **Step 4: 实现诊断与恢复**

诊断区分 registry 缺失、目录缺失、manifest 缺失、JSON 损坏、id 不一致；恢复先复制损坏文件到 `.nomi/project.corrupt-<timestamp>.json`，再写回有效备份。

- [x] **Step 5: 接 IPC/bridge 与 hydrate 编排**

新增 `projects.diagnose/recover`。hydrate 失败时：可恢复则确认恢复并重试；不可恢复则显示明确原因，并允许打开项目文件夹。

- [x] **Step 6: 运行定向测试与类型检查**

Run: `pnpm exec vitest run electron/workspace/workspaceProjectRecovery.test.ts src/workbench/project/projectNormalize.test.ts src/workbench/project/projectPersistenceService.test.ts && pnpm run typecheck`
Expected: PASS。

### Task 7: 回归、视觉对账与交付

**Files:**
- Modify: `scripts/character-card-upload-walkthrough.mjs`（仅在选择器变化时）
- Create: `tests/ux/feedback-batch-hardening.walk.mjs`
- Update: `docs/plan/2026-08-06-feedback-batch-hardening.md`（勾选完成项）

- [x] **Step 1: 编写真实旅程**

旅程在隔离项目目录完成：新建项目、上传角色图、创建 3 个图片结果、切主/删除、打开素材库、拖动长分组、打开边语义菜单、切换浅/深主题、制造可恢复损坏 manifest 后重启恢复。

- [x] **Step 2: 跑上传专用回归**

Run: `pnpm build && node scripts/character-card-upload-walkthrough.mjs`
Expected: 短按打开 filechooser、长按拖动不误弹，两项 PASS。

- [x] **Step 3: 跑反馈批次视觉旅程并亲眼检查截图**

Run: `node tests/ux/feedback-batch-hardening.walk.mjs`
Expected: 无遮挡、标签清晰、删除/恢复成功；浅色与深色截图均生成。

- [x] **Step 4: 跑完整门禁**

Run: `pnpm run gates`
Expected: 全门通过并生成 `.claude/.gates-ok`。

- [x] **Step 5: 提交、推送并启动最新版**

```bash
git add <本计划涉及的源码、测试和文档>
git commit -m "fix(canvas): close feedback batch lifecycle gaps"
git push origin HEAD:main
```

推送后用干净 runtime worktree 启动刚推送的 `main`，确认任务面板与本批次功能同时存在。
