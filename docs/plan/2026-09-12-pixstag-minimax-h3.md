# Pixstag 供应商接入（MiniMax-H3，官方 v2 线缆）

日期：2026-09-12 ｜ 状态：实施中

## 背景与契约（R5 逐项对账）

Pixstag（pixstag.com）是视频生成聚合，当前仅一个模型 `MiniMax-H3`。契约抓自官方文档
https://pixstag.com/docs/api（2026-09-12 核对，三次抓取交叉确认）：

- **创建** `POST /api/v2/video_generation`（Bearer）→ 顶层 `{ task_id }`
- **轮询** `GET /api/v2/query/video_generation/{task_id}` → `{ task: { id, status, error{code,message}, content{ url, last_frame_url, … } } }`（视频在 `task.content.url`，限时下载链接）
- **状态** `queued / running / succeeded / failed / cancelled`（cancelled 归 failed 桶）
- **body**：`model="MiniMax-H3"`、`duration` int 4–30、`ratio` adaptive|21:9|16:9|4:3|1:1|3:4|9:16（默认 adaptive）、`resolution` 720P|768P|1080P|2K、`aigc_watermark` bool 默认 false、`use_context_ir` bool（Context-IR 提示词优化）默认 false、`return_last_frame` bool 默认 false、`callback_url` 可选（本地应用收不到 webhook，不接）
- **content 数组**（必填，多模态）：`[{type:'text', text}, {type:'image_url'|'video_url'|'audio_url', <type>:{url}, role}]`；role ∈ first_frame / last_frame / reference_image / reference_video / reference_audio —— **与火山方舟 content 项同形**（volcengineVideos.ts 已端到端验证的线缆）

## 范围

1. **泛化 content 项机制（P4+P1）**：`ArchetypeReferenceSlot` 新增声明字段 `asContentItem`；
   archetypeMeta 构造层删掉 `volcengine_*` inputKey 特判，改为通用「type 由 kind 派生 + role 单源」
   的 content 项构造（单槽→对象，数组槽→对象数组）。火山档案/传输同 commit 迁到中性键
   （`first_image_content` / `last_image_content` / `image_contents` / `video_contents` / `audio_contents`）。
2. **新档案** `src/config/modelArchetypes/minimaxH3Pixstag.ts`（id `minimax-h3-pixstag`，
   4 模式：t2v / first / firstlast / ref；params：ratio+resolution+duration+aigc_watermark+
   use_context_ir+return_last_frame；sources 带 checkedAt 过 check:archetype-sources）。
3. **新传输** `electron/catalog/pixstagVendor.ts`（vendor seed + status mapping + query op）
   + `pixstagVideos.ts`（MiniMax-H3 的 t2v/i2v 两条 create op，content 数组 body，
   defaultParams 给 headless/MCP 兜底）。
4. **种子** seedBuiltins.ts 注册 vendor/model/mapping（reconcile 幂等）。
5. **接入卡** knownVendors.ts + onboardingProviders.ts（zh/en）——纯数据注入通用卡，无新 UI 组件。
6. **生成物** `pnpm run gen:archetype-defaults` 重出 archetypeIdentifiers/archetypeWireDefaults。
7. **测试** pixstag.test.ts（wire 契约 + seed）+ archetypeMeta.test.ts 更新（火山键改名 + pixstag
   content 断言）+ seedBuiltins.test.ts 补 pixstag 种子断言。

## 不动项

- kie / apimart 的 MiniMax-H3 档案与传输（三条线缆并存是「同一模型多家接入」的既定形态）。
- requestPipeline / 轮询 runtime / 接入卡组件（全部复用既有通用机制）。
- 工作区里在途的 Agnes 2.5 Flash 改动（另线工作，验证绿后独立 commit，不混提交）。

## 验收门

- `pnpm run test`（paramConsistency 自动覆盖新档案：声明的 canonical 参数 ⊆ wire 覆盖）
- typecheck / lint:ci / check:filesize / check:tokens / check:i18n / check:archetype-defaults / check:archetype-sources
- 真机走查：dev 启动 → 供应商接入页看到 Pixstag 卡 → 模型选择器出现 MiniMax H3（Pixstag 家）
