# Self-written 登记与 prior-art 收口设计卡

## 范围与决定

- 目标比较基准是用户 fork 的 `fork/main`，已解析为 `3d94d96fe1f11a3079cfa9502efe322338b5084b`，不是官方 origin。
- 只改登记元数据、此卡、逐文件查证清单、独立 v3 合同与聚焦回归；不改生产逻辑、API、依赖、模型面、tool schemas、门岗或 baseline。
- 不改 `genericZones`、`enforceFrom` 和既有领域根。新领域项只收具体能力目录或确切文件；通用 wrapper 接真实已有 owner / 已安装库与标准 API。
- 手写 ZIP、递归结构共享、外部 store、桌面插值、PNG fixture 编码不因放在产品目录就变成领域能力。登记明确的替换计划；没有运行过的 spike、App、Provider 或媒体验证不得写成通过。
- 无布局、文字、参数、事件、存储或提示词更改，上一批内容流布局保持不动。无截图需求，不启动日常 App。

## 先查别人

- 已有库：`node_modules/i18next/dist/cjs/i18next.js:480` 的 Translator / `:533` 的 translate，以及 [i18next API](https://www.i18next.com/overview/api)。两个 renderer 显示 helper 已调用它；desktopT 仍是手写插值，不能称为已完成同类接入。
- 已有框架：`node_modules/react/cjs/react.development.js:1311` 的 useSyncExternalStore、`node_modules/zustand/vanilla.js:3` 的 createStoreImpl，以及 [React 外部 store 合同](https://react.dev/reference/react/useSyncExternalStore)。React hook 是适配；另写 listeners/notify 的 store 必须独立登记替换条件。
- 已有机制：`node_modules/fflate/lib/node.cjs:2693` 的 unzipSync。Director catalog 仍手读 ZIP 头；接入前必须保留路径、大小、可信归档 hash、单条目与输出界限，不能把解压后的大小检查冒充解压前限额。
- 标准接口：[Node fs](https://nodejs.org/download/release/v24.1.0/docs/api/fs.html)、[Electron IPC](https://www.electronjs.org/docs/latest/api/ipc-main)，本地 API 合同在 `node_modules/@types/node/fs.d.ts:1216` 与 `node_modules/electron/electron.d.ts`。文件/进程/IPC wrapper 不声称替代这些底层实现。
- 真实替代源码：[TanStack replaceEqualDeep](https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts)。本仓没有直接安装 query-core；不能把 react-virtual 当成 query-core，也不能把 Immer producer 语义当成接收完整 snapshot 的等价 API。本批不装库、不换实现。
- 结论：按 [逐文件源码清单](../research/2026-10-25-self-written-fork-main-source-review.md) 区分领域、已接入 adapter、仍手写的机制；登记不代表所有历史技术债已完成替换。

## 验收与交接

聚焦回归先红后绿；运行两道登记门岗的既有单元测试，读取真实 fork diff 和实际源码。主线只读比较包含未提交源文件；隔离分支缺少主线源文件造成的 stale 不能伪装成本分支 CLI 已绿。

登记变化后 PR 正文必须真实引用本卡的仓库路径：`docs/plan/2026-10-25-self-written-prior-art-closeout.md`。注入这段真实待用正文可验证判据，但不等于远端 PR 正文已经更新。本批不 push / merge / 修改 PR。

本批登记 183 个已读源文件：原主线提交的 182 项，以及协调线明确请求的 Blender 共享词汇工作树补充。只读集成真实 CLI 0 未认领，工作树代码 diff 1194 项 errors/warnings/violations 均空；登记相关测试 35/35，聚焦根因测试 50/50。原隔离分支的 4 个主线文件缺失与旧模型推断副本仍如实报红，不改源文件或补豁免消除分支差异。完整验证方法与未验收项在研究清单的“本批验证结果”。
