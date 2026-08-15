# Electron 孤儿进程与 `write EIO` 递归报错根因修复计划

日期：2026-08-07
状态：完成

## 1. 已确认的根因

- `~/Library/Logs/nomi/nomi-crash.log` 在 2026-08-06 12:04:13 的同一毫秒附近连续写入 634 条 `uncaughtException: write EIO`。
- 第一条 `EIO` 来自测试/任务宿主结束后，仍存活的 Electron 主进程继续向已关闭的继承终端写日志。
- 当前 `installCrashHandlers()` 监听 `uncaughtException` 后只记录、不退出，覆盖了 Node 的默认崩溃退出；`logCrash()` 又调用 `console.error()` 写回同一条坏掉的 stderr，于是异常处理器递归触发自身。
- 当前机器仍可见父进程已经变成 PID 1 的旧 Nomi Electron，以及没有生命周期兜底的测试实例；说明“调用方最好记得 `app.close()`”不是结构保证。
- `scripts/dev-electron.mjs` 退出时只清理 Vite/Tailwind，没有统一收掉 Electron；`scripts/start-electron.mjs` 也只镜像子进程退出，没有父进程退出清理。

Node 官方文档明确要求 `uncaughtException` 只做同步清理后退出，不应恢复正常运行；`uncaughtExceptionMonitor` 可以观测且不改变默认退出。Electron 官方文档说明 `app.exit()` 会跳过窗口关闭事件并立即退出，适合父启动器已消失、无法再做正常交互式关闭的开发/测试实例。

## 2. 目标与不动项

### 目标

1. 崩溃日志只落一次盘，不再从崩溃处理器写 stdout/stderr，也不再吞掉 Node 默认退出。
2. 任何未打包的 Nomi Electron 在启动父进程消失或被替换后，最多一个探测周期内立即退出，不留孤儿窗口/Helper。
3. `pnpm dev` / `pnpm start` 收到正常退出信号时主动终止它们启动的子进程。
4. 用自动化回归测试证明“父进程变化会退出”“父进程健康不会误退”“崩溃监听不注册 `uncaughtException`/`unhandledRejection` 接管器”。

### 不动项

- 不改变打包后的 Nomi 生命周期；正装由 macOS/Windows 用户会话管理，不绑定临时父 PID。
- 不改变 renderer 崩溃、素材下载失败等显式 `logCrash()` 调用的落盘格式。
- 不靠扩大 `pkill` 范围清场，不触碰其他 Electron 应用或其他正在执行的 Nomi 任务。
- 不引入新依赖，不新增 UI，不改变用户数据与项目文件。

## 3. 文件与职责

- 新增 `electron/parentProcessWatchdog.ts`：纯运行时生命周期守卫；记录启动父 PID、周期检查当前父 PID与存活状态，异常时调用注入的立即退出函数。
- 新增 `electron/parentProcessWatchdog.test.ts`：用可控 PID/时钟覆盖健康、换父、父进程消失、重复退出保护。
- 修改 `electron/crashLog.ts`：用 `uncaughtExceptionMonitor` 同步落盘，不注册会吞掉默认崩溃的 `uncaughtException` / `unhandledRejection`；崩溃监听路径不调用 console。
- 新增 `electron/crashLog.test.ts`：用假 ProcessLike 捕获事件注册和调用次数，证明只监控、不接管、不递归写终端。
- 新增 `electron/mainProcessLifecycle.ts` 及接线测试并修改 `electron/main.ts`：把崩溃监控与开发实例父进程守卫接线移出 800 行主入口；读取启动器显式传入的原始 PID，封住 Electron 模块加载前父进程已消失的竞态；打包实例不启用守卫。
- 新增 `scripts/child-process-lifecycle.mjs` 与测试：统一登记/终止启动器子进程，信号到来时收拢 Electron、Vite、Tailwind。
- 修改 `scripts/dev-electron.mjs`、`scripts/start-electron.mjs`：复用统一生命周期工具，删除各自不完整的退出逻辑，并把真实启动器 PID 显式传给 Electron。

## 4. TDD 执行顺序

### 任务 A：崩溃监听不再递归

- [x] 先写失败测试：期望只注册 `uncaughtExceptionMonitor`，不注册 `uncaughtException` / `unhandledRejection`。
- [x] 先写失败测试：调用 monitor 只触发一次同步 recorder，绝不调用 console sink。
- [x] 跑 `pnpm exec vitest run electron/crashLog.test.ts`，确认因目标 API/行为缺失而红。
- [x] 最小修改 `crashLog.ts`，让测试转绿。

### 任务 B：父进程消失时 Electron 自退

- [x] 先写失败测试：父 PID 不变且存活时不退出。
- [x] 先写失败测试：当前父 PID 变化或原父 PID 不存在时只调用一次退出。
- [x] 先写失败测试：守卫定时器 `unref()`，不反过来阻止进程自然退出。
- [x] 跑 `pnpm exec vitest run electron/parentProcessWatchdog.test.ts`，确认红。
- [x] 实现守卫并在 `main.ts` 的非打包实例启动，跑聚焦测试与 Electron typecheck 转绿。

### 任务 C：启动器主动收拢子进程

- [x] 先写失败测试：父进程收到 SIGINT/SIGTERM/exit 时，每个仍存活子进程只被终止一次。
- [x] 先写失败测试：子进程已退出后从登记表移除，不误杀后来复用的 PID。
- [x] 先写失败测试：子进程不响应正常信号时，2 秒后升级 `SIGKILL`。
- [x] 实现共享 helper，替换 dev/start 两套不完整逻辑并跑聚焦测试。

### 任务 D：真实生命周期回归

- [x] 构建 Electron 主进程。
- [x] 用临时 Node 启动器拉起 Nomi 测试实例，强制结束启动器，断言 Electron 主 PID 在限定时间内消失。
- [x] 在 Electron 主模块尚未加载完成时立即 `SIGKILL` 启动器，断言晚安装的守卫仍按显式原始 PID 识别孤儿并退出。
- [x] 检查 `nomi-crash.log`：本轮没有新增长串 `write EIO`（计数 `1268 → 1268`）。
- [x] 只清理已确认的旧孤儿 Nomi PID `82726` 及其两个 Helper；未触碰仍有活父进程的实例。
- [x] 跑完整 `pnpm run gates`（424 个测试文件：423 通过、1 跳过；3837 个测试：3836 通过、1 跳过；lint 97/98、生产构建通过）。

独立代码审查发现并推动修复“守卫安装前父进程已消失”的 bootstrap 竞态；复审结果无 Critical / Important 问题，结论 `Ready to merge: Yes`。

## 5. 回滚与验收门

回滚只需撤销本批提交；没有数据迁移、配置迁移或持久化格式变化。

验收门：

- 聚焦测试先红后绿，完整门禁全绿。
- 非打包实例的父进程消失后自动退出；健康父进程不误退。
- 人为制造的坏 stderr 不再产生递归日志，未捕获异常恢复为 Node 默认非零退出。
- 打包构建仍通过，`app.isPackaged` 分支不安装父进程守卫。
- 当前旧孤儿清理后，进程表只保留有活父进程、明确属于正在执行任务的实例。
