# TSX I18n 回归对齐

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

基点 `cfefca36a1555388ad569e765408ce87280b6944`；独立 sibling/分支 `Nomi-i18n-display-align-20261025` / `codex/i18n-display-align-20261025`，旧分支保留，不 reset。

| 格 | 决定 |
| --- | --- |
| ★1 用户流程 | 只修既有 Node 测试对 canonical owner、英文显示和获批控件文案的过时假设，不修改产品、用户数据、媒体、Provider 或视觉 PNG。 |
| ★2 Owner | camera 原值归 shared/canvas/sourceDefaults；显示归既有 CanvasComponentText/i18next。两个 Node 源码测试在各自进程内用现有 tsx/cjs/api 注册真实 tsconfig.app.json，并清理 hook/恢复环境，不提供全局 React。 |
| ★3 复用 | 不新建 gate/运行时；使用既有 test:eng-system，旧三文件命令前缀不变，显式补漏接的新 Node 文件。已有独立 gate 的 extension-lint-hosts 不重复。 |
| ★4 全状态 | 475 个双语 key、37 组件和 111 绑定保留。只允许 cfefca36a 的 21 zh/21 en 动作文本和两个预览 classHash 对齐；未知/自定义标签、原始 JSON、相机几何、零 onChange 写入继续严格验证。 |
| ★9 验收 | 默认/显式配置红测，定向 plain Node 绿测，实际 test:eng-system 不拿 full 全局锁；对 fixture/生产/预算 diff 做精确核对。不跑 Vitest 全仓、UI、Provider、截图或真实 CI；协调线负责最终集成验收。 |

## 依据

- `33cd631dd` 的真实 canonical source 与 `src/i18n/workflowSourceBoundary.test.ts`：默认机位仍为中文 raw，英文显示 View 1，语言切换不得写回。
- `cfefca36a -- src/i18n/locales/canvasComponents.ts` 及 `docs/fixes/2026-10-25-control-preview-semantics.root-cause.json`：42 项有限显示文本和两个展示/操作 DOM 变化，不是重置所有 snapshot 的许可。
- 安装版本 tsx 4.22.3 的 `dist/cjs/api/index.d.cts` 与 register 实现：register 在调用时读取 TSX_TSCONFIG_PATH；用现有 API 在测试内固定 app config，随后恢复环境，结束时注销 hook。无生产 React import 或全局 React。
- 离线安装使用已存在 `/Volumes/S7/.pnpm-store`，frozen lockfile、ignore-scripts，下载 0；不改依赖/锁文件。初次安装早于 checkout 完成而未启动，默认 cache 缺 tarball 后改用已验证缓存；未改代理。

## CI 接线库存

只用 `git diff --diff-filter=A --name-only fe51422b6..HEAD -- scripts`，不扫描官方历史。新增顶层 Node 文件 11 个；extension-lint-hosts 已由 check:quality-gate-workflow 调用。以下 10 个未找到已有脚本/CI 调用，显式追加到 test:eng-system 一次：

- agent-tool-face-usecases.node-test.mjs
- browser-shortcut-label.node-test.mjs
- check-fresh-base.node-test.mjs
- main-style-content-flow.node-test.mjs
- main-style-reference-repair.node-test.mjs
- root-cause-history-evidence.node-test.mjs
- self-written-closeout.node-test.mjs
- tsx-diagnostics-lint.node-test.mjs
- tsx-i18n-display.node-test.mjs
- tsx-redundant-bindings.node-test.mjs

原 merge-preflight / eng-metrics / archetype-autosync 三套保留，不对整个入口添加 tsx/React 全局参数。tests/system 的 unit 阶段通过 package test 已到达 test:eng-system，最终 CI 执行由协调线复验。

首次实际激活全部用例为 121/123，暴露两个历史测试问题：Agent 清单用例静态 import TS 的 extensionless 注册表，没有 loader；Base 冗余用例误把当前实际调用的 isImageLikeGenerationNodeKind 也当 unused。保留原三套完整命令，之后在同一 eng-system 用 `&& node --import tsx --test <十个显式文件>` 串行，不新建平行 gate。B 两源码测试仍各自注册 app 配置，可独立 plain Node；Agent 原用例/工具 schema 不改。自己的冗余用例仅将该函数的“应消失”改成“必须保留且实际调用一次、参数 node.kind”；其他 hook 位置、Props、回调与 unused/ESLint 断言保留。

## 当前证据

原 display 正确 app 配置下 36/41，失败为过时中文 copy、两个 classHash、局部默认值 regex 与旧英文 SSR 期望；默认 --import tsx 的 SSR 另有 React undefined。日志留在本 worktree `.tmp/tsx-display-align/`，不提交。

A 后续 structured reason 若交付，按实际共享 owner 对齐 cancellation 检查，不能以旧 includes 字符串作为业务合同；未交付前不伪造兼容分支或改生产实现。

## 实测结果

- 初始配置正确的旧 display 回归 36/41；默认 `--import tsx` 同时复现 React undefined。新增有限-delta/门岗接线断言先红 2/2，再修 fixture 与 package。
- 不带 tsx CLI、不设 TSX_TSCONFIG_PATH 的两个源码文件 plain Node 为 50/50；兼容原显式 app 配置 + `--import tsx` 也为 50/50。真实 shared factory 覆盖 0..9 个输出、zh/en/zh、编辑对象 identity/JSON/几何；SSR 显示 View 1，保留原 45/10 与自定义 -13/7、中文用户标签和零 onChange。
- 实际 `env -u TSX_TSCONFIG_PATH pnpm run test:eng-system`：原三套 20/20、新增十套 111/111，总计 131/131；未拿全仓/全局重锁。首次 121/123 的两个旧问题已按上节最小修正，没有删除 Agent 测例、放松表面数量或碰工具 schema。
- Fixture 精确 diff：21 个 zh 值、2 个 classHash；37 文件 key 列表、其余 35 hash、475 key 与全部 111 bindings 不变。绑定 JSON SHA256 仍为 bbc286e4f3396183fb7ffaa4f09afe4f1b82d08036394600453428e0b1196f48。21 个英文短名有独立精确期望；全部插值检查保留。
- package 逐字段比较仅 test:eng-system 改变；生产目录、锁文件、PNG 基线均零 diff，79 lint 预算原样保留。三个变化的 Node 脚本独立 ESLint 为 0 errors/0 warnings；新 v3 用现有 validator 定向验证，不运行历史全仓合同集合。
- 未运行真实 CI、完整 UI/Unit/Contracts、日常 App、Provider、Chromium 或 build:site；不碰协调线未提交 SSR 宽高测试、营销生成数据和字体排查。旧分支保持不动。当前 pinned cfefca36a 的取消分类仍是原始 message 路径，A 新 owner 到手后由下一次集成对齐，不声称已验收未交付实现。

日志均在本独立 sibling `.tmp/tsx-display-align/`；设计与 v3 可随本批小提交独立回滚。
