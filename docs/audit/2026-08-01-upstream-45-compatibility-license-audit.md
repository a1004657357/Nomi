# 官方 main 45 提交兼容性与许可证审计

日期：2026-08-01

## 审计对象

- 定制分支：`codex/nomi-codex-director-upgrade-20260705`
- 定制基线：`2c80b05c55d0cbdfcb6baa4e3cad4d66d1d4eb91`
- 已同步官方基线：`6057a74e`
- 待合入官方范围：`6057a74e..26ff6870`，共 45 个提交
- 官方版本号与最新标签仍为 `0.18.1` / `v0.18.1`，本次范围属于尚未发布的 `main`

## 结论

可以合并，但不能直接采用自动合并结果。官方更新涉及 161 个文件，定制分支自共同基线涉及
556 个文件，交集 32 个；无写入合并预演得到 19 个内容冲突。冲突集中在 Electron 主进程、
代理、生成任务解析、画布节点与错误分类，均属于定制版关键路径，应按行为合并并跑全量门禁。

许可证从本次官方范围起由 Apache-2.0 改为 AGPL-3.0-only。合并后的组合工作树应整体按
AGPL-3.0 对待；仅本机运行、内部使用和内部修改不触发公开源码要求。对外分发修改版或将修改版
作为网络服务提供时，需要按 AGPL 提供对应源码，或向上游取得商业授权。`v0.18.1` 及以前已发布
代码继续保留 Apache-2.0 授权，但不能据此把本次新合入代码继续标为 Apache-2.0。

本节是工程许可证审计，不替代针对具体商业模式的法律意见。

## 兼容性风险

| 风险 | 级别 | 处理方式 |
|---|---:|---|
| Electron IPC 与 preload 桥接冲突 | 高 | 合并双方 channel、类型和 handler，防止定制 Agent/网页桥能力丢失 |
| 系统代理与官方自定义 SOCKS 代理冲突 | 高 | 统一为单一 dispatcher 初始化流程，保留定制探测并接入官方三态设置 |
| 生成任务轮询、取消与资产落地冲突 | 高 | 保留单次提交/不重发约束，吸收 429 退避、ComfyUI 取消和远端 URL 本地化 |
| 模型/vendor 解析冲突 | 高 | 保留即梦 Web、Codex Img2、AGNES 定制路由，吸收官方 vendor-aware 去重 |
| 画布节点 UI 冲突 | 中 | 保留分镜表、批量设置和历史结果节点，吸收官方预览/状态覆盖层 |
| 时间轴可见跨度修复 | 低 | 官方改动与定制路径无直接冲突，原样吸收并回归播放/导出 |
| ComfyUI Tier-2 新能力 | 中 | 原样吸收新增模块，验证 IPC 可选能力在旧状态下仍可降级 |
| 生成的 Tailwind 文件冲突 | 低 | 不手工拼接，合并源码后重新运行 Tailwind 构建生成 |

## 合并预演冲突

1. `.gitignore`
2. `electron/main.ts`
3. `electron/preload.ts`
4. `electron/runtime.ts`
5. `electron/systemProxy.test.ts`
6. `electron/systemProxy.ts`
7. `electron/tasks/taskResultQuery.ts`
8. `public/tailwind.generated.css`
9. `scripts/check-file-sizes.mjs`
10. `src/desktop/bridge.ts`
11. `src/i18n/locales/generationCommon.ts`
12. `src/ui/onboarding/OnboardingDrawer.tsx`
13. `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx`
14. `src/workbench/generationCanvas/nodes/NodeVideoFrameToolbar.tsx`
15. `src/workbench/generationCanvas/runner/catalogTaskActions.ts`
16. `src/workbench/generationCanvas/runner/catalogTaskResolve.ts`
17. `src/workbench/generationCanvas/runner/generationRunController.ts`
18. `src/workbench/observability/classifyError.ts`
19. `src/workbench/observability/narrate.ts`

## 许可证特征

- 官方 `package.json` 改为 `AGPL-3.0-only`，`LICENSE` 替换为 AGPL-3.0 全文。
- README 明确个人使用、公司内部使用和二次开发可继续进行；修改后闭源分发或提供在线服务需开源修改或购买商业授权。
- 官方说明历史 `v0.18.1` 及以前不追溯变更，仍按 Apache-2.0。
- 生产依赖扫描以 MIT、Apache-2.0、BSD、ISC 为主。
- 现有 ffmpeg/ffprobe 安装包包含 LGPL/GPL 条目，项目按独立可执行文件调用；第三方资产门禁当前为 3 条记录、0 个发布阻断。
- `@imgly/background-removal` 在包管理器许可证报告中标为 Unknown，属于原有依赖，不是本次 45 提交新增；若将来对外发布，仍需单独核对其实际授权条款。
- 本次新增 `socks@2.8.9` 为 MIT，不增加 copyleft 传播风险。

## 合并策略

1. 建立不可变备份分支，记录合并前 HEAD。
2. 合并 `origin/main`，不压平官方 45 个提交历史。
3. 逐个解决 19 个冲突；定制能力与官方能力都必须有明确保留证据。
4. 重新安装锁文件依赖并重建生成 CSS，不手工保留冲突产物。
5. 运行文件尺寸、设计 token、i18n、lint、typecheck、单测和 production build。
6. 补跑模型解析、生成任务轮询、系统代理、资产本地化和定制 provider 定向测试。
7. 只在验证通过后提交合并结果；不自动发布。

## 文件尺寸遗留债

完整门禁首次运行发现 10 个定制版文件超过 800 行。对比合并前备份分支后确认，7 个文件本轮没有
变化；`src/desktop/bridge.ts`、`src/i18n/locales/generationCommon.ts`、
`src/i18n/locales/onboardingProviders.ts` 因吸收官方桥接、错误文案与设置能力增长。此次不在更新合并中
同时展开 10 个文件的跨模块重构，按文件尺寸门禁约定完成逐项人工评审，并以合并后精确行数建立棘轮
白名单。后续增长会继续被门禁阻断，拆分后应同步下调或删除对应基线；这不是对架构债的关闭。

## 验收标准

- Git 无未解决冲突，工作树只含本次审计/合并/模型接入改动。
- 官方 45 个提交可从合并提交追溯。
- 定制版即梦 Web、Codex Img2、AGNES、分镜表和 Blender Director 入口仍存在。
- `pnpm run typecheck`、`pnpm run test`、`pnpm run build` 通过。
- 官方新增代理、资产本地化、模型 vendor 去重、轮询退避和 ComfyUI 定向测试通过。
- Seeds 2.5 模型只有在官方 CLI/接口真实枚举和参数契约得到确认后才加入选择器；不得只加显示名称。
