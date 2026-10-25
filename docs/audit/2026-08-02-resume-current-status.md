# Nomi 定制版 Resume 当前状态审计

日期：2026-08-02  
工作区：`/Users/huawuer/Projects/Nomi-codex-director-upgrade`  
本轮目标：恢复可构建基线 → 修复跨重启钱安全 → 接通 Gate 1/2 → 接通三家 Provider

## 结论

本轮目标已经完成，代码、全量测试和生产构建均通过。这里的“完成”只覆盖上述四段目标，
不代表目标架构 Gate 4–9 已全部完成，也不代表三家真实账号已经做过本轮付费生成验收。

## 已完成

1. 可构建基线
   - 清理源码目录中的生成 JS/source map，恢复 TypeScript 单一源码面。
   - 拆分本轮触达的大文件；文件体积棘轮通过。

2. 跨重启钱安全
   - 全局持久幂等账本在 Electron 启动时初始化。
   - renderer、IPC 与能力核提交统一经过 `taskSubmissionRuntime`。
   - 重启后已受理任务只 query，不再次 create；无法确认的任务保持 unknown，不自动重发。
   - 取消状态按 intent key / Provider task id 回写，并防止随后到达的 rejection 覆盖 cancelled。

3. Gate 1/2 运行闭环
   - Film Bible 进入项目 schema、归一化、读写与 store 持久化。
   - 电影导演语义工具进入真实 Agent harness、确认门和画布执行器。
   - Playbook 阶段以 backend manifest 回执为权威，前端节点只同步，不自行伪造推进。
   - 新增真实“电影导演”画布 Skill，按项目契约、分镜、生产、组装四阶段运行。

4. 三家 Provider 运行链
   - Codex Img2：本地 runner、单次 `image_gen`、全局并发 2、资产落盘、成功清理隔离目录。
   - 即梦 Web：受控 Electron session、客户端在线检查、每意图单次 push、后续 query-only；
     图片回收保留全部结果，视频强制单任务/单结果。
   - AGNES：图生视频使用顶层标量 `image` URL；提交前公网可达性预检；异步 create/poll；
     官方 `url` 与历史 `remixed_from_video_id` 均可回收。
   - 统一取消：Codex 与 ComfyUI 走真实取消；即梦 Web 与 AGNES 明确返回不支持，绝不触发重生成。
   - Director Agent 已暴露 `cancel_provider_task`，仍必须经用户确认。

## 本轮验证

- `pnpm run gates`：PASS。
- 测试：495 个文件通过、2 个跳过；4344 个测试通过、5 个跳过。
- TypeScript：renderer + Electron 均通过。
- 生产构建：renderer + Electron 均通过。
- 安全扫描：2534 个 tracked 文件，无凭据泄漏。
- 第三方资产审计：3 条记录，0 个 release blocker。
- 真实 Provider 请求：0；本轮费用与积分消耗：0。

## 后续真实 Provider 更新（2026-08-02）

在用户明确授权 Codex 与 AGNES、禁止调用即梦后，已于隔离项目完成 2 次真实创建请求：

- Codex Img2：1 次 text-to-image，success。
- AGNES：1 次 image-to-video，success；等待阶段只轮询同一个任务，未重复 create。
- 两个资产均已落盘并回写画布，且图片节点到视频节点已有 `reference` 血缘边。
- Codex/host 子进程和隔离临时目录均无残留。
- AGNES 实际输出 704x1280，不严格符合请求的 9:16，已由技术检查标记 `suspect`，不自动重生成。

完整证据见 `docs/audit/2026-08-02-codex-agnes-live-provider-smoke.md`。这只关闭了本文件
“未做本轮真实付费 smoke”中的 Codex/AGNES 最小接入缺口，不代表 Gate 8 全旅程完成。

## 仍未闭合

1. 未做本轮真实付费 smoke。Codex Img2、即梦 Web、AGNES 当前结论来自真实运行代码和无费用 mock/HTTP
   形状测试；账号、额度、官网 DOM 变化和实时服务可用性仍需隔离项目下的限额验收。
2. `providerCompiler.ts` 仍是 GenerationIntent 的编译外观；现有生产执行继续复用稳定的
   catalog/profile/browser-bridge 路径。它还没有成为唯一 Provider 编译入口。
3. AGNES 与即梦 Web 没有可靠远程 cancel 端点；UI/Agent 只能诚实报告不支持，不能假装取消成功。
4. 通用产物下载重试尚未按 Provider 完整声明；当前即梦仅对“任务完成但文件列表暂未出现”做查询重试。
5. 目标架构 Gate 4–9（Blender 完整闭环、自动验收、OTIO/生产导出、性能安全、真实生产验收、发布）
   不属于本轮完成范围，不能把旧骨架或文档当作已验收能力。
