# 公网图片预检复用出站owner

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

1. 使用：保持AGNES参考图预检，只探测响应元数据，不下载整张图、不提交生成。
2. Owner：hardenedFetch及networkOutboundPolicy统一决定目的地、重定向、代理、取消与清理。
3. 复用：新增显式headersOnly分支，默认完整读取不变，不另造分类器或提高字节/超时预算。
4. 状态：成功仍只代表可达；私网跳转、HTTP失败、非图、超时保留失败。零字节元数据不能冒充资产。
5. 中途：父信号和原计时器保持；只头结果立即取消body，所有路径保留dispatchers清理。
6. 外部：默认路径走共享策略；保留现有fetchImpl隔离seam；不运行真实Provider或公网请求。
7. 性能：避免不支持Range的服务返回整图；不增重试、并发或常驻任务。
8. 真实条件：真实共享函数配合隔离DNS/fetch依赖，验证取消/完整读取阳性对照及私网跳转；本机回环测试按需获准。
9. 验收：先红后绿、原全部hardenedFetch与预检/桥接测试、出站门岗和完整CI。只改源码，可独立回退，不改日常项目。

## 独立复核发现的阶段误报

- 默认下载拒绝属于 retrieval；提交前参考图预检使用同一判据但必须显式 submit，不能声称已有付费结果。
- 沿用现有 OutboundStage、describeOutboundRefusal 与稳定码，不删除 reason/cause，不靠中文子串分类。
- 有限红测：同一私网 DNS、同一真实 owner、零 transport，submit 预期 outbound-blocked-submit 而旧代码得到 outbound-blocked；retrieval 对照原本通过。
- 新回归同时锁默认预检传参和真实 owner 两阶段的稳定码/isRetrievalStageCode。协调线四文件96项通过，原预检另跑4项通过；计数有重叠，不相加为唯一测试数。
- 独立复核实际重放原真实 executor 反例：metadata/vendor/build/rate均0，稳定码为outbound-blocked-submit，非retrieval；默认下载对照保留。F3/P2可关闭，最终全套与CI仍须完成。
