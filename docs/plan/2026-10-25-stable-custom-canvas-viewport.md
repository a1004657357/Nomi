# 保持自定义画布视口稳定

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

本项是主合并阻断修复计划的范围内细化记录；不将这份补充记录冒充源代码修改前已完成的独立设计。

| 设计格 | 决定与证据 |
| --- | --- |
| 1 使用 | 创建/收纳/调表格/返回3D/发送Playbook后保留正在看的局部；屏外新节点走既有arrival提示。明确抽出行节点与点击产物仍可定位。真实Provider任务不在本补丁验收内。 |
| 2 owner | requestCanvasFit仍归workbenchStore；新节点提示归canvasArrivalModel。实际2971源门表10→3，见报告viewport-stability-door-evidence.json。 |
| 3 复用 | 沿用既有arrival和viewport signal，不新增视口状态、旁路入口或控件。 |
| 4 全状态 | 空/加载/成功/失败/取消/过期沿用原生成与toast；只去掉附加移动，不改原zh/en文案。 |
| 5 打断 | 停止/关窗/断网/重启/连点仍由原项目与生成owner处理，不增加提交或重试；费用沿用原确认与回执，不能由视口动作推断。 |
| 6 外部 | 不修改Provider或Blender协议；未知结果仍走原错误/回收逻辑。 |
| 7 性能 | 移除附加视口信号及两处subscription；无新性能预算或规模声称。 |
| 8 条件 | 本机隔离浏览器7文件87项通过；这里所有按钮的真App逐项走查、Windows和真实媒体生成unverified；旧PNG不变。 |
| 9 验收/回滚 | 原caller红测；viewport+skill10/10、arrival+fit16/16，lint0错误2个既有refresh警告；独立线需在最终head续审；可单独revert本提交。 |

只移除附加导航调用，不删除截图、九机位、关键帧、连接、收纳、尺寸或模型参数功能。
