# Codex Img2 + AGNES 真实 Provider Smoke

日期：2026-08-02  
工作区：`/Users/huawuer/Projects/Nomi-codex-director-upgrade`  
判定：**最小真实链路通过；Gate 8 仍为 in-progress**

## 约束

- 仅调用 Codex Img2 与 AGNES；未调用即梦 Web/CLI。
- 隔离项目：`workspace-21d3fe2f-aff6-4365-95ce-500fe24d3854`。
- 每个 Provider 只创建 1 个真实任务；失败不自动重试。
- 报告不包含 API Key、Cookie、Authorization header 或账号标识。

## 真实结果

| Provider | 模型/模式 | 创建次数 | 耗时 | 结果 |
| --- | --- | ---: | ---: | --- |
| Codex | `codex-img2` / text-to-image | 1 | 81.128s | success，1 张本地 PNG |
| AGNES | `agnes-video-v2.0` / image-to-video | 1 | 240.340s | success，1 段本地 MP4 |

项目事件日志中，每个节点均只有 1 条 `vendor.call.requested` 和 1 条
`vendor.call.completed`。AGNES 的等待过程只 query 同一个远端任务，不再次 create。

## 资产

- 项目根：`/Users/huawuer/Documents/Nomi Projects/Provider E2E Codex AGNES 20260802-msbrw2ik-57bbeb51`
- Codex 图片：`assets/generated/2026-08-02/codex-img2-1785673625470.png`
  - 1,964,296 bytes，941x1672，PNG。
- AGNES 视频：`assets/generated/2026-08-02/video-1785673925309.mp4`
  - 1,816,266 bytes，H.264，704x1280，24fps，5.041667s。
- 画布血缘：Codex 图片节点到 AGNES 视频节点已有 1 条 `reference` 边。

Provider 响应未返回可核实的人民币费用，因此费用记为“Provider 未返回”，不猜测金额。

## 技术验收

使用本轮新增的请求参数感知技术检查复验真实文件：

- Codex 图片：9:16 画幅相对误差约 0.053%，通过；文件可解码。
- AGNES 视频：时长误差约 0.042s，通过；黑帧占比 0%；冻结占比 0%。
- AGNES 视频：实际 704x1280，相对请求 9:16 的比例误差约 2.22%，标记 `suspect`。

纪律：画幅不符只标记、保留原始 Provider 资产，不静默裁切、不自动重编码、不自动重新付费生成。

## 清理

- Codex 子进程：0 个残留。
- capability headless host：0 个残留。
- `nomi-codex-img2-*` / `nomi-codex-home-*` 临时目录：0 个残留。
- 一次性联系表已清理。

## Gate 8 判定

本次证据关闭了“Codex 与 AGNES 当前账号到底能否真实走通”的缺口，但没有完成 Gate 8：

- 未完成 6-12 镜完整短片。
- 未完成 Blender 预演、revision 选择、时间线和最终 MP4 全旅程。
- 未完成真实用户操作记录和六角色人工审查。

因此只能写为 **Provider live smoke passed / Gate 8 in-progress**，不得写成生产验收完成或可发布。
