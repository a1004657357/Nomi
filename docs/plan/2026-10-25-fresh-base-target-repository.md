# Fresh-base 绑定真实 PR 仓库设计卡

类别：其他，Git 门岗绑定修复。基点 `a396045cc19d5008cf8811f2088a2f419f24be01`。只改 scripts 与本卡/v3，不改主工作树、remote 配置、workflow、baseline、frozen 或任何业务功能。

| 格 | 决定与证据 |
| --- | --- |
| ★1 用户怎么用 | 本轮 PR 目标 a1004657357/Nomi:main；本地显式 GH_REPO 后校验匹配 fork/main，不要求合入另一个官方仓库的 3070-commit 跨度。门岗只读，不自动 fetch/merge/push。 |
| ★2 谁说了算 | git-delivery.mjs 已有 parseGitHubRepository、remote/base 与 Git 状态 owner；在同一 owner 补只读 resolveDeliveryTarget，fresh-base 复用，现有 preflight/verify-merged 默认行为不改。目标身份由显式 repository/GH_REPO/GITHUB_REPOSITORY 一致声明；无声明时只允许唯一 remote。 |
| ★3 一致与复用 | Git 原生 remote get-url --all 读取 fetch URL，既有 parser 识别 GitHub 仓库；严格解析 refs/remotes/<匹配 remote>/main 的 commit，再用原生 merge-base --is-ancestor。不能取共同祖先、tree 相同或任意 BASE_REF 替代 main tip。 |
| ★4 全状态 | 唯一匹配且真实 tip 是 HEAD 祖先才绿；错误/冲突 repo、歧义 remote、多仓 fetch URL、缺 tracking ref、Git 错误或陈旧分支均红。CI=true 不再跳过；CI checkout origin 属于本仓时按同一规则校验。 |
| ★9 验收与回滚 | 临时 Git 仓库构造真实提交/refs，覆盖 origin 同仓、fork 目标、main 前进、错仓/缺 remote、CI 伪跳过、任意 ref 环境变量、本地 ref shadow 与只读性；再跑既有 delivery 单元和本地只读 gate。协调线集成后复跑 CI；回滚本批独立 commit。 |

## 先查别人

- 现有 owner：`scripts/git-delivery.mjs:181` inspectDeliveryState、`:295` parseGitHubRepository、parseCli，已有 Git state 错误与命令参数处理；不新增并行 remote URL parser 或交付框架。
- [Git merge-base 官方文档](https://git-scm.com/docs/git-merge-base)：--is-ancestor 判真实提交祖先，不用 merge-base 的共同祖先来替代目标 tip。
- [Git remote 官方文档](https://git-scm.com/docs/git-remote)：get-url 读取 fetch URL，--all 检出多 URL，push URL 不能证明 origin/main 属于 push 仓库。
- [GitHub CLI 环境变量](https://cli.github.com/manual/gh_help_environment)：GH_REPO 是仓库选择上下文；本 owner 复用现有 GitHub.com URL parser，接受 OWNER/REPO 及 github.com/OWNER/REPO，冲突或不支持身份明确失败。
- 结论：Git 保留全部祖先语义，只修 main 绑定哪个仓库/remote。拒绝自动回退 origin、CI=true 放行、任意 BASE_REF、选更旧别名、缺 ref 时猜旧祖先。

## 接口边界

fresh-base 的目标分支固定 main。可复用 delivery 的 `--remote` 与 `--base main` 参数来明确匹配 remote；其他 base（包括 HEAD/SHA）不接受。没有 repo 声明且多个 remote 时失败；多个 fetch remote 匹配同仓时必须明确 remote。显式 remote 也必须与声明仓库一致。

缺 ref 时只给出匹配 remote 的 fetch 提示；门岗不会联网执行该命令。提交年龄提示只说明 commit 时间，不能将 fork 的旧 main 提交日期当成未 fetch 或强制合官方更新的证据。

`OWNER/REPO` 与 `github.com/OWNER/REPO` 简称仅允许出现在仓库上下文声明；fetch URL 必须通过原有 GitHub URL parser，不能将同名本地相对目录当成 GitHub remote。

## 实际验收

- 初始红测：20 项真实 Git 用例，旧实现 4 通过、16 失败；真实本地 GH_REPO 仍误查官方 origin/main 而失败，日志 `.tmp/fresh-base-target/real-red.log` 与 `red-tests.log`。
- 复核补红：GitHub-looking relative fetch URL 被误认的问题单独红测 1/1 失败；限制简称转换到上下文边界后通过，保留 `relative-fetch-red.log`。
- 最终 `node --test scripts/check-fresh-base.node-test.mjs scripts/git-delivery.node-test.mjs`：43/43（21 个真实目标绑定用例 + 22 个既有 delivery 回归）。每次新 gate CLI 调用前后检查临时仓库 config、全部 refs、HEAD 完全不变；只允许 file transport，不联网。
- 真实本地 `GH_REPO=a1004657357/Nomi node scripts/check-fresh-base.mjs`：通过，实际选择 fork/main@3d94d96fe1f11a3079cfa9502efe322338b5084b。官方 origin/main@182666a9888ebadc8d45991e507e440064dfc5d3 与两个 remote 配置读回均未改变。
- 仓库 ESLint 原配置整体忽略 scripts，直接 CLI 给出 3 个 ignored 警告，不将此声称为有效 lint。额外用现有 ESLint、@eslint/js recommended 与 Node globals 对这 3 个修改/新增脚本做聚焦校验：0 errors、0 warnings；不改任何 lint 配置。
- 按本批父提交 `ROOT_CAUSE_BASE_REF=a396045cc19d5008cf8811f2088a2f419f24be01`：合同门岗通过，无警告；合同回归 50/50。该变量仅限定本批根因合同的 diff，与 fresh-base 目标无关；fresh-base 的 main 不读取它。
- 默认历史范围的合同回归实际为 49/50，唯一失败是正式 checker 报已有 18 处 removed legacy path not changed in diff（2026-09-15 至 09-26 合同）；未更改、隐藏或豁免，交回协调线处理。
- 真实 GitHub CI、目标 remote 的网络刷新和最终 integration 全局门岗未执行；这里不启动日常 App 或 Provider，不合官方更新。A 新增 source 模块登记尾项仍等确切交付清单，不在本批猜测补列。

日志均在本独立工作树 `/Volumes/S7/AiWork/Projects/Nomi-main-tsx-i18n-20261025/.tmp/fresh-base-target/`，不会提交。
