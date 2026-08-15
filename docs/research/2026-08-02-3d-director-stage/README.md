# 3D 导演台全旅程证据索引

日期：2026-08-02

本目录只保存可复核证据；体验结论、竞品对比和最终方案见同级文档 `2026-08-02-3d-director-stage-full-journey-research-and-redesign.md`。

## Nomi 生产构建

| 文件 | 证明什么 | 不证明什么 |
|---|---|---|
| `nomi/01-default-editor.png` | 初次进入时同时出现任务条、场景树、自由视口、默认环境和整运镜入口 | 不证明这些入口都被用户理解 |
| `nomi/02-camera-selected.png` | 选中相机后有最终监看、相机属性、运镜 Hub 和时间轴 | 不证明哪一块是唯一最终输出真相 |
| `nomi/03-competing-surfaces.png` | 工作视图、相机监看、轨迹状态、Inspector 与时间轴同时争夺注意力 | 不证明功能不可用 |
| `nomi/04-reference-video-ready.png` | 真实运镜参考视频生成完成，页面出现可用结果 | 不证明失败终态可靠 |
| `nomi/05-back-on-canvas.png` | 静态图和 5 秒视频节点真实回到生成画布 | 不证明二者来自同一冻结的镜头 revision |
| `nomi/06-recording-two-stops.png` | 单击进入录制已成立，但顶栏与底栏同时可结束录制 | 不证明录制数据错误 |
| `nomi/07-reference-pack-feedback-overload.png` | 首尾帧成功接线，但 Toast、结果卡、时间轴与面板同时反馈 | 不证明已有真正的 ReferencePack manifest |
| `nomi/08-squat-pose-and-label-collision.png` | 新增人物并套用“蹲下”真实可达；姿态观感与名牌/操控/gizmo 避让仍有问题 | 机器姿势度量通过不等于人眼自然 |
| `nomi/09-ai-staging-gray-result.png` | 真模型正确触发两人跪姿低机位站位工具后，自动链路仍留下灰色等待态 | 不证明手工导演台不能出图 |
| `nomi/10-export-first-frame.png` | 运镜首帧导出画面 | — |
| `nomi/11-export-last-frame.png` | 运镜尾帧导出画面；可人工检查全段末端裁切 | — |

对应本地实验目录：

- `.scene3d-ux-lab/`
- `.scene3d-keyframe-lab/`
- `.scene3d-recording-lab/`
- `.scene3d-reference-pack-lab/`
- `.pose-lab/`

## TapNow / LibTV

2026-07-26 的完整原图位于 `../2026-07-26-3d-director-stage/screenshots/`。本轮新增证据：

### TapNow

| 文件 | 证明什么 |
|---|---|
| `tapnow/01-home.png`、`02-project.png` | 独立测试项目与画布入口 |
| `tapnow/03-add-menu.png` | 3D 世界入口与产品内节点添加 |
| `tapnow/04-world-empty.png` | 空白 3D 世界的真实冷启动界面 |
| `tapnow/05-object-selected.png` | 以立方体作为人物代理后的上下文操作 |
| `tapnow/06-viewfinder.png` | 取景器、焦段、画幅和拍摄入口 |
| `tapnow/07-director-state.png` | 当前版本已有导演状态与时间线，不再是纯静态世界 |

注意：本轮冷启动被一个 `opacity:0` 但仍截获点击的全屏 loading overlay 阻断。等待和刷新后仍存在；后续链路只为研究临时在 DevTools 关闭其 `pointer-events`。因此“拍摄 → 相册 → 导出画布”是绕行后验证，不能冒充普通用户无阻塞完成。

### LibTV

| 文件 | 证明什么 |
|---|---|
| `libtv/01-canvas.png`、`02-director-node.png` | 新画布添加导演台节点 |
| `libtv/03-director-default.png` | 默认即有角色 A 和机位 1，前置成本低 |
| `libtv/04-two-characters-pose.png` | 新增女性素体、调整两人位置并给 A 套“伸手” |
| `libtv/05-camera-view.png` | 导演视角切到机位视角检查输出 |
| `libtv/06-shot-saved.png` | `机位1-截图01` 进入截图库 |
| `libtv/07-canvas-output.png` | 截图真实发送回画布成为图片节点 |
| `libtv/08-director-output.webp` | 1600×900 最终真实产物；同时显示角色过小、黑场过多、无构图提示 |

若网站阻断或为继续评测使用了调试绕行，主报告会明确标注，不把绕行后的结果冒充冷用户体验。

## 证据纪律

- 截图只回答“当时用户看到了什么”，不能替代输入到输出的旅程判断。
- 自动化 PASS 只证明其断言；最终构图自然度、姿势自然度与页面注意力仍需人眼判断。
- 失败、灰态、选择器漂移和调试绕行都保留在报告中，不用成功截图覆盖。
