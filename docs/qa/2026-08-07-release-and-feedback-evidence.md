# 发布、反馈与独立验收证据

日期：2026-08-07

## 基线与安全打包

- 基线 commit：`0d375a9590aee716008a06a676dbdf59e7332452`
- 源码 ZIP：`/tmp/Nomi-codex-source-0d375a9-1786107090.zip`
- ZIP 文件大小：`30,067,751 bytes`
- ZIP SHA-256：`624b511ec8c92b365f31785e6f6fdda44a8cef1225c7ce97f421a886ab6a727c`
- 只打包 tracked 源码；排除 `.git`、依赖、构建产物、缓存、数据库、运行状态和浏览器状态。`pnpm run check:secrets` 通过；扫描命中的唯一 key 是测试假凭据 fixture，不是真实凭据。

## 实际修改

- 官网下载：固定 GitHub `latest/download` 资产别名，按 Windows x64 / macOS arm64 / macOS Intel 选择；未知架构安全回退公开 Release 页面，点击时重新解析防止异步竞态。
- 安装包：afterPack 只保留当前 target 的 ffmpeg/ffprobe，并增加构建后 foreign-target 审计。真实 macOS arm64 目录包约 584 MB，`app.asar.unpacked` 约 55 MB；详见同目录的体积基线报告。
- 接入状态：Vendor 卡片保存后调用已有 reachability bridge，区分未测试、测试中、已验证、失败，不把“写入 key”冒充“服务已连通”。
- APIMart TTS：在通用任务参数层把有限数字字符串归一化为 JSON number，覆盖 `speed`，并保留非法值的可诊断性。
- 素材拖拽：原生 `dragstart` 时释放浏览器 overlay 命中状态，避免覆盖画布 drop 入口。
- 3D 引导与 journey：给教练引导的跳过按钮加稳定语义属性；同步 journey 断言到当前“去出片”与“导出 MP4”产品契约，修正懒加载等待和 CTA 选择器，不改回已删除的旧“导出”跳转按钮。

## 独立测试结果

- `check:filesize`、`check:tokens`、`check:dangling-tokens`、`check:archetype-defaults`、`check:secrets`、`check:i18n`、`check:controls`、`check:site`：通过。
- `lint:ci`：通过，仓库棘轮为 98 warnings / 0 errors，未新增 warning。
- `typecheck`：通过。
- `test`：397 个文件通过、1 个跳过；3683 个测试通过、1 个跳过。
- `test:site`：营销站静态检查、桌面/移动 quickstart、平台下载合约通过。
- `test:e2e`：14 条 Electron 冒烟断言通过。
- `test:journeys`：j3 首次创建画面、j5 修改项目进入出片并挂载导出控件均 pass@1 通过。
- `build`：Vite renderer 与 Electron TypeScript 构建通过。
- 真实 macOS arm64 `electron-builder --mac dir --arm64`：通过；审计只发现 `darwin-arm64` ffmpeg/ffprobe。未声称 Windows 构建或 SmartScreen 已验证。

主工作树复核：`typecheck`、`test`、`build`、`test:site`、`test:e2e`、`test:journeys` 和相关聚焦测试均已复跑通过；`git diff --check` 通过。主树包装 `pnpm run gates` 在检查阶段通过至 `check:site`，随后被主树既有未跟踪实验目录（如 `.camera-move-explore/`、`.scene3d-*-lab/`）触发的 ESLint 错误阻断；这些目录在本轮之前已存在，未删除、未修改。干净 sibling worktree 的完整 `lint:ci`（98 warnings / 0 errors）及全部仓库门禁仍是本轮代码健康结论的依据，不能把主树这次阻断说成产品修复失败。

## Pro 协作与纠错记录

ChatGPT Pro 分为四个独立对话：官网发布链路、安装包体积/Windows 信任、Logo 资产审查、3D/交互反馈诊断。Pro 的建议均按本地源码、官方文档和真实测试复核；其中 Logo 与 3D 建议有部分与当前基线已存在实现重合，没有为已修复路径制造并行实现。

对话链接已持久化在 [`docs/pro/2026-08-07-chatgpt-pro-task-briefs.md`](/Users/aoqimin/Desktop/Nomi/docs/pro/2026-08-07-chatgpt-pro-task-briefs.md)，分别对应 Task A/B/C/D；该文件同时记录上传包和脱敏边界。

## 未验证风险

- Windows Authenticode 签名证书、Windows runner 与 SmartScreen 信誉积累未提供，故“Windows 已保护你的电脑”仍是发布外部阻塞。
- Kie Seedance 2.5、Dreamina CLI、Volcengine 的真实供应商能力没有在本轮凭空接入；需要当前官方 API、真实账号和产品方向后单独验证。
- 真实用户反馈中的媒体 URL/编码、生产环境代理和供应商响应未用模拟数据冒充生产验证。

## 权限状态

本轮未 commit、未 push、未创建 PR、未部署、未迁移数据库，也未修改线上配置或真实用户数据。变更仍是本地源码修改。
