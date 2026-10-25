# 多模态摘要测试运行器归属

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

1. 使用：维护者跑正式test时，原五项Node摘要/提交次数用例确实执行，而不是Vitest空套件。
2. owner：test:eng-system的既有Node组；原五个测试体保留，增加入口可达自验。
3. 复用：沿用node:test/vm，文件改.node-test，不新增runner或全仓忽略。
4. 状态：passed/failed/partial和single-image提交上限断言原样；不运行真实媒体脚本。
9. 验收/回滚：原全仓空套件红；新Node6/6，工程入口守护保持原组并精确加入此一文件；独立线续审，可revert。

此记录在原runner接线后补齐；接下来先按本计划修正工程入口精确断言再运行正式组。无Provider、PNG、预算或冻结更新。
