# Gate 8 真实短片验收报告

日期：2026-08-02  
隔离项目：`Gate 8 短片验收：天台对峙 20260802`  
项目 ID：`workspace-c73aa458-c106-4283-9126-ecdb13c9a0c9`  
判定：**FAILED，继续停留在 Gate 8；不进入 Gate 9，不发布。**

## 结论

本轮真实完成了隔离项目、资产卡、Codex/AGNES Provider 提交、Blender 预演、revision 选择、六镜头时间线和 MP4 导出。Nomi 的本地资产、画布、时间线、filtergraph 和 FFmpeg 主链路已经真实连通。

Gate 8 仍不通过。主要阻断不是“有没有文件”，而是视觉质量：双手机/错误屏幕朝向、人物身份和场景连续性漂移、视频人物重复与形变；同时没有完成 Nomi UI 内的 Agent 分镜审阅、全屏 revision 交互验收和六角色人工签字。Provider 没有返回可核验的人民币费用，因此不能声明本轮费用低于 10 元。

## 旅程结果

| 步骤 | 状态 | 本轮证据 |
| --- | --- | --- |
| 1. 导入短剧本 | PASS | 隔离项目中存在剧本节点和六镜头结构 |
| 2. Agent 拆 6 镜并审阅 | PARTIAL | 六镜结构已落盘，但缺少 `propose_storyboard_plan` 的 UI 交互和人工审阅轨迹 |
| 3. 落画布并创建资产卡 | PASS | 画布 19 节点、16 连线，含角色/场景/道具/6 图/6 视频/Blender 输出 |
| 4. 生成图片镜头 | PASS（链路）/ FAIL（质量） | AGNES 4 张图片真实生成并本地化；仅镜头 2 基本可用 |
| 5. 生成视频镜头 | PASS（链路）/ FAIL（质量） | AGNES 3 段视频真实生成并本地化；仅镜头 5 基本可用 |
| 6. 全屏预览 + 选 revision | PARTIAL | 已用原尺寸 contact sheet 比较并非破坏性地改选镜头 3；未走 Nomi 双击全屏 UI 路径 |
| 7. Blender 预演 | PASS | Blender 4.0.1 返回 PNG、BLEND、GLB 并回写画布 |
| 8. 放入时间线 | PASS | 24fps，六 clips，579 帧；每段保留 `shotId`、`revisionId`、`sourceNodeId` |
| 9. 导出 MP4 | PASS（技术）/ FAIL（成片质量） | filtergraph 主后端导出 720x1280、24fps、24.125s、H.264/AAC MP4 |

旅程完成度：7 个步骤的技术终态完成，2 个步骤仅部分完成。完整 Gate 8 不能据此判通过。

## Provider 与预算

- 提交：12/12，已封顶；成功 7，失败或无效 5。
- 并发：配置上限 2；本轮时间戳显示实际最大并发 1。
- 自动付费重试：关闭。仅 Codex Img2 有一次人工明确重试，其余失败均未自动重提。
- Codex：两次 Img2（一次 300 秒无进展，一次返回 100x100 无效占位图）和一次内置 image generation（网络失败），0 个可用图片。
- AGNES Image 2.1 Flash：4 成功、1 网络失败；成功图均为 736x1312。
- AGNES Video 2.0：3 成功、1 Provider 终态失败；成功视频均为 704x1280、24fps、约 5.04 秒。
- 费用：Provider 返回中没有可核验 CNY 字段，记为 `unknown`。提交上限已遵守，但 10 元上限无法被事实验证为通过。
- Provider 累计等待时间：约 1815.0 秒（30 分 15 秒）；验收运行总跨度约 54 分 22 秒；本地 MP4 导出 10.238 秒。

## 质量发现

1. Codex Img2 当前入口可靠性不合格：一次长时间无输出，一次把无效 100x100 占位图当成成功结果；内置图片生成还出现网络失败。
2. 图片语义一致性不合格：镜头 3 出现双手机；后续镜头仍有手机形态和屏幕朝向错误，违反“手机背面朝镜头时不能显示屏幕”的既定规则。
3. 视频 4 有明显重复人物/形变；视频 6 有身份、背景与空间漂移。视频 5 动作最完整，但不足以弥补跨镜头连续性失败。
4. 三段 AGNES 视频为 704x1280，与严格 9:16 有约 2.22% 画幅偏差；导出使用 cover 裁切统一为 720x1280。
5. Blender 输出只达到空间调度草图级别，能证明链路和机位预演，不是可替代最终关键帧的视觉资产。
6. 成片前三镜为设计中的静态关键帧，因此 freeze 检测在 0-9 秒报告三段各 3 秒静帧；9 秒后视频段有真实运动，没有黑帧报告。

## 资产与成片

- 项目根目录：`/Users/huawuer/Documents/Nomi Projects/Gate 8 短片验收：天台对峙 20260802-msbuyocf-2a3eca13`
- MP4：`exports/gate8-rooftop-confrontation-202608022248.mp4`
- 图片抽检：`.nomi/acceptance/gate8-images-contact-sheet.jpg`
- 视频抽检：`.nomi/acceptance/gate8-videos-contact-sheet.jpg`
- 成片抽检：`.nomi/acceptance/gate8-export-contact-sheet.jpg`
- Blender：`assets/generated/2026-08-02/blender-director-preview.png`、`blender-director-scene.blend`、`blender-director-scene.glb`
- 结构化报告：`.nomi/acceptance/gate8-live-report.json`

## 修复与验证

- 修复 AGNES 长任务轮询：15 秒间隔；查询错误按 15/30/60 秒退避并继续查询同一 task，禁止重新 create。
- 修复旧 FFmpeg 兼容性：多源混音由不受支持的 `amix normalize=0` 改为 `amix + volume=N` 等价表达。
- 新增可恢复 Gate 8 真实短片、Blender 和时间线导出运行器。
- 定向测试：`28/28` 通过。
- 完整 `pnpm run gates`：497 个测试文件通过、2 个跳过；4354 项测试通过、5 项跳过；lint 0 error/95 warning；类型检查、密钥扫描、第三方资产审计和生产构建通过。
- `git diff --check`：通过。

## 清理与安全

- 终止 6 个历史 Nomi Electron 主进程和 1 个旧启动器；其辅助进程随主进程退出。
- 删除 1 个已知 Codex Img2 孤儿诊断目录。
- 清理后未发现 Codex exec、Blender、FFmpeg、Fimer 或多余 Nomi 主进程；保留 1 个由开发监视器启动的 Nomi 实例。
- 报告和隔离项目清单执行 key/cookie/token 值模式扫描；不记录或输出凭据与 Cookie。
- 六角色人工审查：0/6，待真实审查人完成；这是 Gate 8 的显式阻断项。

## 下一步验收条件

1. 修复 Codex Img2 无效成功判定和长时间无输出问题，并获得至少 1 张可用真实图。
2. 把手机朝向、物体数量、身份绑定和空间连续性做成生成前约束与生成后语义质量门，失败资产不得自动进入时间线。
3. 在 Nomi UI 内真实完成 Agent 分镜审阅和全屏 revision 选择，不以脚本落盘替代交互验收。
4. 获得可核验的 Provider 费用回执，并完成六角色人工审查。

以上条件未关闭前，Gate 8 保持 `failed`，不得进入 Gate 9。
