# 网页桥默认网络入口收敛

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 目标与范围

原全仓网络入口检查找到七处旁路：AGNES 公共图可达性，以及即梦/Pavo 的探测、提交、查询。统一接现有 appFetch，不新造传输层，不修改共享代理内核或网页生成规则。

- 三个源文件各导入原 appFetch，只替换默认 fetch；显式 fetchImpl 保留。
- URL、请求头、body、Range、abort、幂等标识、项目/节点所有者和文件回收完全不改。
- 原 appFetch 不实现重试；loopback bypass 与凭据重定向仍由原 owner 负责。
- 新测试把 ambient global fetch 设为失败 tripwire，单独注入应用入口。验证默认探测、一次 POST、排队查询只 GET/零素材写、不确定提交不再发以及显式注入优先。

## 本轮证据

- web-transport-red-01：新测试 9 失败/2 通过，证明真实默认旁路。
- web-transport-green-02：新测试、原 AGNES/即梦/Pavo 回归和原网络检查 62 通过；唯一文件失败是本机测试服务器 listen EPERM，24 用例未能启动，非业务失败。
- web-transport-local-http-03：同一 Pavo 本地 HTTP fixture 仅取得本机端口权限后重跑，24/24。没有登录网站、调用真实 Provider 或多提生成。
- 实际 2971 个生产源 AST 对账，七业务 owner 的引用 11→11，没有新增业务入口。

## 边界

只证明接线和离线业务/本机服务回归；不把它声称为用户真实代理、免费额度、上游模型或 main 的最终验收。其余全仓失败继续逐项修复，截图/模型面冻结基线未改。

