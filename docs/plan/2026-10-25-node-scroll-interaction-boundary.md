# 节点滚动手势边界收口

## 根因与修复

原完整单测列出 24 个滚动区域，分布于 19 个定制 TSX 文件。原生画布监听早于 React 合成事件，仅 stopPropagation 无效。复用现有 NODE_SCROLL_REGION_CLASS_NAME：nowheel、nodrag 和项目的 noPan，保持区域外正常手势。

只新增 19 条 import 和 24 个类接入；未改布局类、尺寸、文字、模型参数、回调、数据或原检查规则/豁免。审计逐文件从 eda08ea7f 构造精确预期，再与工作树全文/hash 对照，任何其他字节变化即拒绝。公共常量引用从 14 增到 33，说明补齐消费者，不是另立规则。

## 验证

- node-scroll-red-01：原守护真实指出 24 处缺口；没有修改守护。
- node-scroll-canonical-green-05：同一滚动/textarea/关键场景守护 3/3。
- 正式 Node 展示套件在类变化后真实报 10 个指纹不符；只对这 10 个字段登记有限前后值，不做整体重录。
- node-scroll-canonical-display-green-06：43/43；475 keys、37 组件和 111 绑定保留，其余原始快照经恢复摘要全部恒等。没有改视觉 PNG。
- 最小改动证据：报告目录 node-scroll-canonical-preservation.json，19 个源文件的完整前后 SHA、24 个区域计数、10 项类哈希。

## 尚未完成

最终构建后执行既有隔离真机走查 tests/ux/node-wheel-scroll-not-canvas-zoom.walk.mjs，要求画布 transform 不变且输入区 scrollTop 真改变；目前不能宣称这两项真机证据已经拿到。其余全仓失败、截图与模型面审批、CI、main 合并仍在后续。

