# 自定义 main 集成：独立代码审查记录

实现线：nomi-main-blockers-20261025。
验收线：Anscombe-01a17083；只读，非实现作者。

## 当前限定结论

截至集成提交 `6aeedbf95ffe965ee2e46de8073174a01278babb`，独立线已关闭这轮实际复现的 merge-preflight P1/P2（含跨行取消构造器漏判），但仍不签整体 GO。下文早期候选的结果是历史分层记录，不替代最终候选的验收。

- 独立执行原 Git/预检两文件共59/59通过、0跳过，包括实际65MiB夹具；完整tree/raw路径和blob覆盖保留。内容预筛只缩小取消关键词的patch，不缩小全量路径分类。原64MiB硬限、零传输检查、九格设计卡及不同独立线判据不变。
- 真实PR #2扫描63退出0，读取6864条原始路径（新增4116、删除197）；GitHub的6807条位于原生rename数学范围[6667,6864]。旧规则日期404按严格规则处理，不适用历史豁免。此结果绑定远端503348841和base/merge-base 3d94d96fe，最终推送后仍须对新head重扫。
- 远端503348841的Quality Gate已结束为失败：Contracts、MacPackage、两条Canvas Acceptance、Core Flow及原128ms性能门通过；Unit为19057通过、1失败，E2E剩一项11px模式说明的FEEL错误。不能把这个旧head记为全绿。
- Unit失败的metadata边界夹具已在3b2782a16修复，独立真实executor/probe定向17/17通过。模式说明统一采用已有caption 12px，真实组件SSR3/3、原八状态走查8/8通过；原九项只读为4通过、5张预期字号差异，五张PNG尚未获单独批准，未更新。
- 最新整树五个受影响owner文件85/85通过。此前完整Node运行时511/511、WebBridge组件7/7仍按原执行版本记录，不和这些重叠测试相加，也不充当真实Provider验收。
- 完整97项Contracts运行46已取消（exit130），不是通过；新的完整315项只读仍未完成。真实App运行62停在固定等待与Suspense加载竞态，修复及真实重建复验尚待完成。

最新独立报告：`independent-review-00c661aa-preflight-final-20261025.md`；原始日志与TAP仍位于下述本轮隔离报告目录。日常项目、原工作区、共享代理、账号与真实生成均未参与本轮修复。

## 代码结论

固定代码候选56b3c050a的增量复核未发现未收口P1/P2。另对随后两个节点浮框夹具/走查文件只读复核，同样未发现新增P1/P2、掩盖生产问题或删除有效断言。本记录不是整体运行GO，也不把截图更新当作验收。

- 初次审查指出legacy map与单份分镜并存时可能丢失单份有效设计，已由4b33559ce修复；独立复核包含11次真实存储往返及15种拒绝坏输入且原文件不变的情形。
- 最终三个测试提交f2517c33d、919641cab、56b3c050a没有改生产权限/生成路径。独立实际五文件43/43通过；WebBridge七例在两次初始化受阻，0例执行，必须另补真实运行证据，不补绿。
- 新节点浮框夹具问题来自取景left=28及缺少现行availability DTO，不是生产过滤故障。新增断言在原夹具验红；仅居中取景、satisfies DTO及合法可用性，不改用户9/25确定的生产“被挡就挡”规则。
- 现有提示词翻译仍保留，走查精确核对effects→translate→optimize三颗工具，不删除功能凑旧图。原参数/锁/纯图标/顺序断言保留。
- 原八状态走查exit0；独立线核读该日志但未重跑浏览器或查看PNG，不冒称独立视觉验收。
- 用户批准新版后撤销三条旧pending登记，原只读188→315，是扩大覆盖；不改容差、状态清单或断言。必须清除更新环境变量执行完整只读验证，并确认PNG未被改写。

## 原始报告

独立作者原报告保存在同一轮隔离报告目录CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025：

- independent-review-7b52f6529-fresh-20261025.md
- independent-review-460b68d77-incremental-20261025.md
- independent-review-56b3c050a-final-code-20261025.md
- independent-review-56b3c050a-composer-fixture-dirty-20261025.md

本轮不调用真实Provider，不以历史四模型生成充当本次验收。日常项目、账号与共享代理不参与测试。最终是否可合并仍取决于完整运行、PR CI、合并前检查及真实merge SHA交付收据。

## 后续CI阻断与独立复核

- 首轮e102 CI的完整Vitest为18991通过，后续Node阶段四项失败另处理，不能把整个Unit签绿。协调线按已批准完整字段重跑原Node运行时：511/511通过、0跳过；P5实测2031/2035，core767/785，说明131字符。
- 原WebBridge组件七例在其他重套件退出后实际7/7通过，35.71秒；不改hookTimeout、beforeAll、网络守护或组件覆盖级别，不等同真实网页登录/生成。
- C的Director共享strict schema保持原native序列化和对象同一owner，独立复核未发现宽容解析偷换；原精确冻结6个变异对照通过。
- 独立复核新增F3/P2：提交前预检继承已付费retrieval语义。沿用既有submit/retrieval类型透传后，原真实executor反例重放metadata/vendor/build/rate均0，码为outbound-blocked-submit且非retrieval；默认下载对照保留，此项可关闭。
- 两项最新明确批准已精确对账：本机桥appFetchImporters仅24→26两个路径；P5 FULL仅1706→2035，core785、MCP上限和并发不变。原报告与红测保留，不回改历史。
- 首轮315只读314通过/1时钟差异，Date-only后该状态两次通过；尚须新的完整315只读，不能将局部补跑充当整套绿。Linux resize单样本133ms超过原128ms，原门槛保持，最终CI必须另验。

新增独立报告：independent-review-f5a9-headers-only-native-dirty-20261025.md、independent-review-f3-closure-and-approved-register-dirty-20261025.md。后续smoke绑定修复、hover请求贯通、技能精确集合和Date-only仍须最终增量复核及真实App/CI；整体仍非GO。
