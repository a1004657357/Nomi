# MCP-only 独立家族计数

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

- 范围：只修冻结检查漏计 localCanvas 两项，不批准 internal 增量。
- 声明事实：onboarding MCP-only 7、localCanvas MCP-only 2；当前 internal27、总计36。
- 冻结值仍21，原 snapshot 与 usecase count guard 不动；未获批准不得把真实面自动写成基线。
- 先红：实际 initializer 仅计7，新用例失败。
- 后绿：`frozen-family-green-02.log` 10/10；用实际源码 predicate 与表达式执行逐族/漏项反例。
- 原完整门岗尝试：`frozen-still-requires-approval-03.log`，tsx 本机pipe EPERM，不能称为冻结比较结果。
- 只读直接检查：`frozen-direct-still-blocked-04.log` exit1，internal27与批准21不等，正确保留阻断。
- 门表：09221429e 与修改后单脚本 AST 均为1，未新增执行或生成入口。
- 不修改官方协议、Provider、超时、并发、付费/授权限制、PNG 或用户数据。
