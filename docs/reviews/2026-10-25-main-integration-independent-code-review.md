# 自定义 main 集成：独立代码审查记录

实现线：nomi-main-blockers-20261025。
验收线：Anscombe-01a17083；只读，非实现作者。

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
