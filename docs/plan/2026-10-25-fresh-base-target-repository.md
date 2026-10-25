# Fresh-base 绑定真实 PR 仓库设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

类别：其他，Git 门岗绑定修复。首批基点 `a396045cc19d5008cf8811f2088a2f419f24be01`；审看修正基点 `c5aaa75dd0a3d45e4f18293b0c448a193af1ba3b`。只改 scripts 与本卡/v3，不改主工作树、remote 配置、workflow、baseline、frozen 或任何业务功能。

| 格 | 决定与证据 |
| --- | --- |
| ★1 用户怎么用 | 本轮 PR 目标 a1004657357/Nomi:main；本地显式 GH_REPO 后校验匹配 fork/main，不要求合入另一个官方仓库的 3070-commit 跨度。门岗只读，不自动 fetch/merge/push。 |
| ★2 谁说了算 | git-delivery.mjs 已有 parseGitHubRepository、remote/base 与 Git 状态 owner；在同一 owner 补只读 resolveDeliveryTarget，fresh-base 复用，现有 preflight/verify-merged 默认行为不改。目标身份由显式 repository/GH_REPO/GITHUB_REPOSITORY 一致声明；无声明时只允许唯一 remote。 |
| ★3 一致与复用 | Git 原生 remote get-url --all 读取 fetch URL，既有 parser 识别 GitHub 仓库；严格解析 refs/remotes/<匹配 remote>/main 的 commit，再用原生 merge-base --is-ancestor。不能取共同祖先、tree 相同或任意 BASE_REF 替代 main tip。 |
| ★4 全状态 | 本地唯一匹配且真实 tip 是 HEAD 祖先才绿；错仓、歧义、缺 ref 或陈旧分支均红。保留原 CI=true 短路语义：CI 负责验证指定 checkout 树，desktop-rc 允许发布 ref 落后 main，PR/merge_group 不增加本地祖先前置条件。不新增本地跳过参数。 |
| ★9 验收与回滚 | 临时 Git 仓库验证本地严格目标绑定、真实 detached 旧发布 ref 与较新 main、PR/merge_group 缺 main ref 的原 CI 路径、同一状态非 CI 必红，以及显式 fork preflight。CI 标志只出现在临时测试子进程，实际工作树验收不设置 CI=true。回滚本批独立 commit。 |

## 先查别人

- 现有 owner：`scripts/git-delivery.mjs:181` inspectDeliveryState、`:295` parseGitHubRepository、parseCli，已有 Git state 错误与命令参数处理；不新增并行 remote URL parser 或交付框架。
- [Git merge-base 官方文档](https://git-scm.com/docs/git-merge-base)：--is-ancestor 判真实提交祖先，不用 merge-base 的共同祖先来替代目标 tip。
- [Git remote 官方文档](https://git-scm.com/docs/git-remote)：get-url 读取 fetch URL，--all 检出多 URL，push URL 不能证明 origin/main 属于 push 仓库。
- [GitHub CLI 环境变量](https://cli.github.com/manual/gh_help_environment)：GH_REPO 是仓库选择上下文；本 owner 复用现有 GitHub.com URL parser，接受 OWNER/REPO 及 github.com/OWNER/REPO，冲突或不支持身份明确失败。
- 本地保留全部祖先语义，只修 main 绑定哪个仓库/remote；拒绝自动回退 origin、任意 BASE_REF 或缺 ref 时猜旧祖先。CI 路径按原有 checkout-tree 语义保留，不能将“本会话不伪造 CI=true”误解成删除产品的合法 CI 分支。
- 本地源码 `.github/workflows/desktop-rc.yml:6,32-33` 使用 inputs.ref 和全历史 checkout；quality-gate 的 PR/merge_group 使用各自验证树。这是两类既有验证上下文，不是新建例外。

## 接口边界

fresh-base 的目标分支固定 main。可复用 delivery 的 `--remote` 与 `--base main` 参数来明确匹配 remote；其他 base（包括 HEAD/SHA）不接受。没有 repo 声明且多个 remote 时失败；多个 fetch remote 匹配同仓时必须明确 remote。显式 remote 也必须与声明仓库一致。

以上目标解析仅用于非 CI 路径。原 `process.env.CI === 'true'` 在解析目标/参数前返回的行为原样恢复；不引入额外标志，也不改变 CI 工作流。`GITHUB_ACTIONS=true`、事件名或 CI 的其他字符串值本身不能放行本地检查。

`resolveDeliveryTarget` 的生产调用者只有 fresh-base。`preflightDelivery` 仍默认 remote=origin、base=main，CLI 透传明确参数；协调线现有记录 `runs/main-integration-20261025/RESULT-ZH.md:18` 是 `delivery:preflight --remote fork --base main`。本仓完整命令为 `pnpm run delivery:preflight -- --remote fork --base main`。GH_REPO 不会单独改写 preflight 的默认 remote；本批不重构它。临时 Git 测试把 origin 改成不存在的本地地址，证明同一显式参数只 fetch fork，未在真实 remote 执行网络验收。

缺 ref 时只给出匹配 remote 的 fetch 提示；门岗不会联网执行该命令。提交年龄提示只说明 commit 时间，不能将 fork 的旧 main 提交日期当成未 fetch 或强制合官方更新的证据。

`OWNER/REPO` 与 `github.com/OWNER/REPO` 简称仅允许出现在仓库上下文声明；fetch URL 必须通过原有 GitHub URL parser，不能将同名本地相对目录当成 GitHub remote。

## 实际验收

- 首批旧实现的本地错仓红测日志仍在 `.tmp/fresh-base-target/real-red.log`。首批 20 项矩阵 4/16、后续 43/43 含后来被用户审看否定的两条 CI 期望，不作为当前 CI 语义验收证据。
- 复核补红：GitHub-looking relative fetch URL 被误认的问题单独红测 1/1 失败；限制简称转换到上下文边界后通过，保留 `relative-fetch-red.log`。
- 审看纠正：先补旧发布 ref 与 PR/merge_group 原 CI 路径红测，再恢复原短路；同一旧 ref 在非 CI 下必须仍红。临时仓库 config、全部 refs、HEAD 前后不变，只允许 file transport，不联网。当前结果单独记录于 `.tmp/ci-release-source-tail/`。
- 修正批实际结果：CI 兼容红测 2/2 失败后修复；fresh-base + delivery 聚焦回归 45/45，含明确的 fork CLI 传参用例；3 个变化脚本独立 Node ESLint 0 errors/0 warnings，父提交 c5aaa75 范围合同门岗通过。真实本地命令未设置 CI=true，仍检查 fork/main 祖先并通过；实际 GHA/发布未执行。
- 真实本地 `GH_REPO=a1004657357/Nomi node scripts/check-fresh-base.mjs`：通过，实际选择 fork/main@3d94d96fe1f11a3079cfa9502efe322338b5084b。官方 origin/main@182666a9888ebadc8d45991e507e440064dfc5d3 与两个 remote 配置读回均未改变。
- 仓库 ESLint 原配置整体忽略 scripts，直接 CLI 给出 3 个 ignored 警告，不将此声称为有效 lint。额外用现有 ESLint、@eslint/js recommended 与 Node globals 对这 3 个修改/新增脚本做聚焦校验：0 errors、0 warnings；不改任何 lint 配置。
- 按本批父提交 `ROOT_CAUSE_BASE_REF=a396045cc19d5008cf8811f2088a2f419f24be01`：合同门岗通过，无警告；合同回归 50/50。该变量仅限定本批根因合同的 diff，与 fresh-base 目标无关；fresh-base 的 main 不读取它。
- 默认历史范围的合同回归实际为 49/50，唯一失败是正式 checker 报已有 18 处 removed legacy path not changed in diff（2026-09-15 至 09-26 合同）；未更改、隐藏或豁免，交回协调线处理。
- 真实 GitHub CI、目标 remote 的网络刷新和最终 integration 全局门岗未执行；这里不启动日常 App 或 Provider，不合官方更新。A 新增 source 模块登记尾项另批处理，不混进 CI 兼容修复。

日志均在本独立工作树 `/Volumes/S7/AiWork/Projects/Nomi-main-tsx-i18n-20261025/.tmp/fresh-base-target/`，不会提交。
