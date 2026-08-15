# 3D 导演台：全旅程实测、开源社区调研与完整重设计

日期：2026-08-02
范围：Nomi、TapNow、LibTV、开源预演/姿势/动作/场景项目
状态：研究与推荐设计完成；等待产品方向确认，尚未改生产 UI

名称说明：用户口述的 “TypeNow / LipTV” 经实际账号、产品形态与官方页面核对，本文分别按 **TapNow / LibTV** 记录；没有找到与本任务相符的独立 TypeNow 产品，LibTV 官方名称也不是 LipTV。

## 0. 最终判断

Nomi 的方向不该是“小 Blender”，也不该和 TapNow 比谁能造更大的 3D 世界。

Nomi 应该成为：

> **镜头参考编译器**——把故事镜头里的角色、空间关系、动作和运镜意图，编译成同一冻结版本下可验证、可回填、可复现的一张构图图和一段运镜参考。

这次真实走查推翻了一个容易出现的错觉：Nomi 不是“功能还不够”。当前生产构建已经能搭景、摆人、套姿势、操控角色、设相机、画轨迹、录 take、导出首尾帧、生成真实 5 秒 MP4，并把图片和视频送回画布。真正的问题是：

1. **用户要自己拼出真相。** 工作视图、输出画面、最终预览、浮动相机监看同时存在，用户不确定哪一块会被导出。
2. **静态构图和动态运镜不是同一镜头合同。** 两套 builder、两套 Host、两个下游目标，可能各自成功，却不保证来自同一人物关系、同一相机和同一 revision。
3. **技术成功不等于镜头可用。** 实测 MP4 真能生成，但人物在运动中接近出框、推近末端裁脚；安全取景没有成为出片前的全段检查。
4. **失败不一定成为失败。** 当前任务可能长期停在“渲染较慢”；截图也会先判成功、再异步持久化，用户无法判断是否真的落盘和回填。
5. **姿势/场景不是“再手调几个角度”的问题。** 用户指出姿势观感错误是成立的：当前机器度量能证明脚没穿地、重心大致合法，却不能证明姿势自然、导演意图准确。开源社区能提供动作、姿势、场景与数据结构，但必须经过许可证、骨骼、坐标、物理和人眼质量门，不能直接拷进列表。

因此最终方案不是“再做一次 UI 瘦身”，而是三件事一起成立：

- **产品主语从“3D 工具”改成“当前这一镜”；**
- **底层从隐式相机和散落产物改成冻结镜头 + ReferencePack；**
- **社区能力从素材堆积改成经过策展和校验的导演积木。**

## 1. 这次如何调研

### 1.1 统一任务

三个产品都用同一任务评价：

> 两名角色在街道对峙，建立站位、朝向和动作，得到一个双人中景，再做一段轻推进；最终输出静态构图参考和产品支持的动态运镜参考，并送回画布或下游生成入口。

评价不是“有没有这个按钮”，而是：

- 输入从哪里来；
- 用户实际要点、拖、选、学什么；
- 中间状态是否可理解、可复核；
- 失败后能否知道发生了什么并继续；
- 输出是否真实落地；
- 输出去了哪里、下游能不能直接消费；
- 用户学到的是导演语言，还是软件内部结构。

### 1.2 证据层级

| 层级 | 本轮做法 | 能证明什么 |
|---|---|---|
| 真实产品旅程 | 在 Nomi 生产构建、TapNow、LibTV 新测试项目中从输入走到产物或明确阻断 | 用户真实可达性、摩擦、状态和输出 |
| 人眼证据 | 逐张查看当前生产截图、首尾帧和回画布状态 | 构图自然度、遮挡、注意力竞争、所见是否像完成 |
| 代码证据 | 读 Nomi 状态、播放、捕获、回填代码；读开源官方仓库真实源码 | 不是视觉猜测，而是解释机制与根因 |
| 自动验证 | 构建、E2E、首尾帧/MP4 一致性、姿势度量、真 LLM 工具选择 | 指定不变量是否成立；不替代人眼判断 |
| 官网/许可 | 只用官方产品页、帮助、GitHub 仓库与 license | 当前能力、来源和可否商用 |

完整证据索引见 [`2026-08-02-3d-director-stage/README.md`](./2026-08-02-3d-director-stage/README.md)。截图是证据，不是结论；任何调试绕行、灰色等待态或脚本漂移都在本文明示。

## 2. 3D 导演台真正解决什么问题

### 2.1 用户不是来“做 3D”的

典型用户的原话其实是：

- “这两个人要面对面，不要站反。”
- “男主往前半步，女主别被挡住。”
- “给我一个双人中景，镜头慢慢推近。”
- “让生成模型别把首尾位置、角色身份和镜头运动搞错。”

因此 3D 只是确定空间关系的中间表示。产品价值发生在前后两端：

```text
故事镜头 / 角色与场景参考 / 导演意图
                    ↓
       可编辑、可验证的空间与时间状态
                    ↓
 构图图 / 首尾帧 / 运镜视频 / 下游槽位回填
```

如果用户必须理解 `Position X`、`Near/Far`、骨骼 Euler 轴、`composition_ref` 和 `video_ref`，说明中间表示泄漏到了产品表面。

### 2.2 输入合同

理想输入不从空白 3D 世界开始，而从当前故事镜头开始：

- 故事角色 ID 与角色参考；
- 场景 ID、场景参考与必要道具；
- 人物关系、动作、朝向和遮挡意图；
- 景别、角度、画幅和可选运镜；
- 下游图片/视频节点与它们真实支持的参考槽。

允许缺信息，但缺失要诚实：例如“没有街景参考，将先用灰模街道”，而不是弹出一页配置表。

### 2.3 中间合同

中间态不是“页面上有哪些控件”，而是：

- 一份共享的 `SceneBlocking`：角色、身份、道具、场景、站位、朝向、姿势、人工锁定；
- 一个明确的 active `ShotCoverage`：相机、景别、焦段、画幅、主体、代表帧和 MotionTrack；
- 编辑 selection 只表示“我正在改谁”，不能改变最终出片相机；
- Agent 与人工只能操作同一份状态，不存在 AI 隐藏版和手工版。

### 2.4 输出合同

用户只做一个动作：**使用这一镜**。

系统按同一冻结 revision 生成逻辑 `ReferencePack`：

- 必需：最终构图图；
- 有运镜时：运镜参考视频；
- 模型确实需要时：首尾帧、站位/视线图、Pose、Depth 等；
- manifest：角色身份、源 revision、coverage、camera、代表帧、校验结果、产物 hash 和下游回填结果。

画布不默认堆一排技术产物。用户看到的是“构图已回填到关键帧；运镜已回填到视频节点”，并可撤销、查看或只重试失败项。

## 3. Nomi 当前生产构建：能力闭环已经存在

### 3.1 本轮真实旅程结果

| 旅程 | 输入与实际操作 | 真实输出 | 结论 |
|---|---|---|---|
| 手工完整出片 | 空白项目 → 添加 3D 节点 → 城市街道 → 假人操控/WASD → 选相机 → 推近预设/手绘轨迹 → 构图截图 → 生成运镜参考 | 图片节点 + 可播放的真实 5 秒 MP4 回到画布 | 物理闭环可用 |
| 首尾帧一致性 | 同一运镜导出首帧、尾帧和 MP4 | PNG 1920×1080；MP4 1280×720；首帧 SSIM 0.987191，尾帧 0.961083；无 gizmo | 离屏输出与画面较一致 |
| 人物录 take | 预置右横移跟拍 → 单击倒计时 → WASD + C 半蹲 → 停止 | 人物走位、半蹲关键帧和相机运镜同时进入 take | 录制机制可用，但存在两个停止入口 |
| 首尾帧回填 | 创建导演节点和 `video_ref` 目标 → 推近 → 导首尾帧 | `(first_frame, last_frame, reference)` 自动接到视频节点 | 接线能力存在，但“ReferencePack”只是名字，没有 manifest |
| 真 LLM 触发 | “男主单膝跪地，女主在前方，低机位中景” | 模型正确调用站位工具；2 人、跪姿、低机位参数正确 | 语义选择不是主要瓶颈 |
| 真 LLM 执行 | 批准上述规划并等待画布产物 | 站位参考相关节点出现，但缩略图仍是灰色等待态 | 自动链路未证明真实落盘；当前成功反馈不足 |
| 姿势体检 | 新增第二人物 → 选“蹲下”；另跑 13 预设度量 | 交互可达，度量零 P0/P1；人眼仍看到蹲姿生硬、名牌/操控/gizmo 叠脸 | 机器约束不等于姿势质量 |

第一条旅程的真实产物同时暴露了更严重的体验事实：用户移动人物后可以直接生成视频，没有强制经过最终取景复核；成片里人物被挤到右侧接近出框。另一条推近旅程末端裁脚。**生成成功不等于镜头成功。**

### 3.2 每个功能实际怎么用、体验如何

| 功能 | 实际入口与用法 | 成功反馈/输出 | 真实体验问题 |
|---|---|---|---|
| 进入导演台 | 画布工具栏或右键添加 `scene3d`，节点空态再打开全屏 | 进入 5 步引导和三栏工作区 | 同一新增动作已有两处入口；更关键的是从空白假人开始，没有承接故事镜头 |
| 场景 | 底部“添加”选模板；城市街道一次加入 27 个对象并折成组 | 中央视口出现完整灰模街道 | 模板分组是进步，但未选对象时右栏先展示环境，而非镜头意图 |
| 人物 | 添加假人、场景树选中、属性/姿势切换、13 个预设或关节滑杆 | 站/走/跑/坐/蹲/跪/举手等立即更新 | 预设和 35 项精调同层；姿势物理度量通过但观感仍错；名称和操控浮层冲突 |
| 人物操控 | 点击人物头顶“操控”或任务 CTA，WASD/C 操作 | 视口实时移动/半蹲，可录进 take | 操控/开始录制/录 take 分散在顶栏、人物、右栏和底部 |
| 相机 | 场景树选相机；右栏调位置/目标/FOV，浮动监看也调画幅/FOV | 小监看显示最终相机画面 | 同一参数两处，selection 还会影响最终输出选择 |
| 运镜预设 | 右侧 MoveHub 的“预设”选择推/拉/横移等 | 轨迹与 5 秒时间轴出现，Toast 提示切任务 | 用户仍停在“构图图”任务，却被要求切“运镜参考”；页面叠两层 Toast |
| 手绘轨迹 | MoveHub 切“轨迹”，进视口绘制/编辑 | 相机路径可预览 | banner、MoveHub、时间轴都有相关入口；多段轨迹重开后会被静默丢段 |
| 录 take | MoveHub“录 take”或任务 CTA；倒计时后操控 | 轨迹 + pose track 进入 take | 顶栏“完成这段动作”和底部红色停止同时可结束 |
| 看最终画面 | 工作视图、输出画面编辑、最终预览、浮动相机监看之间切换 | 都能看到某种相机结果 | 四套画面争夺“最终真相”，用户要猜 |
| 构图截图 | 视口/任务 CTA 截图 | 图片节点回画布并尝试接参考槽 | 截图 callback 是 `void`，落盘失败仍可能先显示成功 |
| 首尾帧 | 运镜完成后导出两张图 | 自动接 `first_frame/last_frame/reference` | 角色语义靠节点中文标题包含“运镜首帧/尾帧”推断，英文界面可能失效 |
| 运镜视频 | 任务 CTA 生成参考视频 | 真实 MP4 + 画布视频节点 | 只有 rendering/slow/done，没有 failed；失败耗尽后仍可能永远显示慢 |

### 3.3 页面为什么让人累

当前默认页同时出现：三任务 tab、场景树、自由视口、环境 Inspector、常驻 MoveHub、底部添加、状态句；选中相机再增加浮动监看和时间轴。截图见：

- [默认编辑器](./2026-08-02-3d-director-stage/nomi/01-default-editor.png)
- [选中相机](./2026-08-02-3d-director-stage/nomi/02-camera-selected.png)
- [多表面争夺注意力](./2026-08-02-3d-director-stage/nomi/03-competing-surfaces.png)
- [录制时两个停止入口](./2026-08-02-3d-director-stage/nomi/06-recording-two-stops.png)
- [蹲姿与场内浮层碰撞](./2026-08-02-3d-director-stage/nomi/08-squat-pose-and-label-collision.png)

根因不是每个组件都差，而是每次补新主路时旧主路没有退出：Inspector、任务 CTA、浮动预览、MoveHub、时间轴、Toast 和结果卡各自合理，组合后没有单一主语。

### 3.4 当前代码里的结构性风险

| 风险 | 代码事实 | 后果 |
|---|---|---|
| 最终相机隐式 | `useScene3DTaskFlow.ts:124-187` 在未选相机时回退 `cameras[0]`；多处捕获/录制同样假设第一台相机 | 选中谁、数组顺序和真正输出谁可能不一致 |
| 多段 MotionTrack 丢失 | `cameraMovePreset.ts:224-279` 可给同一相机追加多 binding；`scene3dSerializer.ts:421-429` 丢弃同对象后续 binding；`scene3dPlayback.ts:60-78` 只 `.find()` 第一段 | 编辑时看似有多段，重开/导出可能只剩第一段 |
| 没有失败终态 | `useScene3DFullscreenActions.ts:586-593` 只有 rendering/slow/done；`CameraMoveCaptureHost.tsx:185-224` giveUp 只清标志 | 用户不知道继续等还是已失败 |
| 截图乐观成功 | `useScene3DCaptureExport.ts:34-62,107-127` 触发后判成功；实际异步持久化在 `Scene3DEditor.tsx:251-317` | 任务成功不代表文件和回填成功 |
| 静态/动态不同源 | `stagingBuilder.ts` 与 `cameraMoveBuilder.ts` 独立建状态；两个工具分别指向图片和视频节点 | 构图图与运镜视频可能不是同一场面 |
| 字符串推断产物 | `scene3dReferenceDirector.ts:109-113` 用中文标题识别首尾帧 | locale 或重命名后回填失效 |
| UI 巨壳承载领域状态 | `Scene3DFullscreen.tsx` 788 行，同时编排约 11 个局部状态、录制、轨迹、捕获、快捷键；Inspector 699 行 | 继续叠 context UI 只会把多重真相藏深 |

## 4. 市场与竞品：用户为什么会选别人

### 4.1 四种产品心智

| 产品 | 用户认为自己在做什么 | 核心优势 | 放弃它的原因 |
|---|---|---|---|
| TapNow | 造一个可拍摄的 3D 世界 | 全屏沉浸、选中后才出现工具、AI/几何体/上传统一加物入口、取景器专注拍摄 | 精确多人关系难审计；冷启动阻断；没有即用人物姿势体系；范围偏世界搭建 |
| LibTV | 做一段轻量专业 previs | 固定场景树、对象 Inspector、导演/机位视角、人物姿势与时间轴可见 | 用户必须学习 DCC 分区、参数和时间轴；出结果前判断多 |
| Nomi 当前 | 在构图/动作/运镜三项任务中完成参考 | 与生成画布和真实下游槽天然相连；手工与 Agent 已共用基础状态 | 最终画面、相机所有权和任务结果不够可信；入口重叠 |
| 推荐 Nomi | 采用“当前这一镜” | 先直接出一版，用导演语言修改，一次可信回填 | 必须坚决砍旧入口并先补数据合同 |

用户选择某一产品，不是因为功能总数，而是它替用户承担了哪类判断：

- TapNow 替用户承担“界面上现在该出现哪些工具”；
- LibTV 让专业用户自己承担精确控制，以换取可审计；
- Nomi 应替用户承担“用哪些姿势/场景/相机证据让下游模型听话”，只把导演决定留给用户。

### 4.2 TapNow：绕行后走通静态拍摄，但冷用户先被透明层卡死

本轮在独立测试项目里实际完成：

```text
新画布
→ 添加“3D 世界 Beta”
→ 进入 3D 世界
→ 添加几何体立方体作为人物代理
→ 导演
→ 取景器
→ 焦段 24mm / 8mm
→ 拍摄
→ 相册
→ 导出当前照片到画布
→ 画布出现“3D 世界拍摄照片”图片节点
```

这条链约 14–16 次动作，至少跨越“画布 → 3D 节点 → 场景 → 导演 → 取景器 → 相册 → 画布”五类心智。静态链没有额外消耗额度；本轮没有花 169 credits 生成完整世界，也没有验证运动镜头 MP4。

必须披露的阻断：当前 2.12.11 空白项目长期存在一个 `opacity:0`、全屏、仍为 `pointer-events:auto` 的 loading overlay。等待和刷新后它仍截获所有真实点击。为完成后半段研究，只在 DevTools 临时关闭该透明层的 pointer events；因此后半段是 **bypass 后走通**，不是冷用户正常完成。

绕行后的功能设计值得借：

- 添加对象统一容纳生成 3D 对象、生成历史、立方体/球和上传模型；
- 对象操作按选择出现，首屏没有永久 Inspector；
- 取景器只留下画幅、焦段和拍摄，最终画面很专注；
- 当前导演模式已经有“初始/新状态”、0–3 秒时间线、播放/循环、现场/调度/镜头管理，旧报告“偏纯静态”的判断需要更新。

但同一任务暴露了定位差异：空白世界没有即用人物/姿势库，用户必须先生成或上传人物；立方体只能当代理。它擅长“造世界再拍”，不擅长“故事镜头一进来就把两人对峙摆对”。

- [空白世界](./2026-08-02-3d-director-stage/tapnow/04-world-empty.png)
- [对象上下文](./2026-08-02-3d-director-stage/tapnow/05-object-selected.png)
- [专注取景器](./2026-08-02-3d-director-stage/tapnow/06-viewfinder.png)
- [现役导演状态](./2026-08-02-3d-director-stage/tapnow/07-director-state.png)

### 4.3 LibTV：低前置、真回画布，但“能摆”不等于“会导”

本轮在独立新项目实际完成：

```text
开始创作
→ 添加节点 / 导演台
→ 打开导演台（默认已有机位 1 + 角色 A）
→ 添加女性素体作为角色 B
→ B 的 X = +1.5，A 的 X = -1.5
→ A 套“伸手”
→ 切机位视角
→ 截图
→ 截图库出现“机位1-截图01”
→ 发送到画布
→ 画布真实出现“导演台 2 机位1-shot-01”图片节点
```

链路约 15–18 次动作，登录、地区和额度均未阻断，20 credits 前后没有变化。它的默认角色+相机明显比 TapNow 更快进入导演任务。

现役功能实测包括：

- 角色来源：本地上传、高斯泼溅、男性/女性/宽厚/健壮/纤细/少年/儿童/二头身、空对象、3×3 群众、几何模型；
- 19 个语义姿势：站立、T 型、行走、跑步、坐姿、蹲下、跪姿、叉腰、倚靠、鞠躬、思考、格斗、踢球、投掷、推进、招手、伸手、抱臂、看手机；
- 姿势之后仍有身体、躯干、头、肩肘髋膝滑杆；
- 导演/机位双视角；右侧对象树 + 属性/姿势；底部场景编辑/动画时间轴；
- 机位有位置、跟随目标、旋转/注视、FOV 和截图库。

它的优点是对象可审计、导演语义可见、默认就能开始摆。劝退点是完整 DCC 密度：用户仍要自己决定人物位置、姿势、机位和构图质量。

最终 1600×900 图片真实回到画布，但人眼看到角色很小、黑场过多，且产品没有提示“人物占比太低”或推荐自动取景。这是一个很清楚的边界：LibTV 是更好的即时摆位工具，却没有自动把意图编译成好镜头。

- [两人和姿势](./2026-08-02-3d-director-stage/libtv/04-two-characters-pose.png)
- [机位视角](./2026-08-02-3d-director-stage/libtv/05-camera-view.png)
- [真实回画布](./2026-08-02-3d-director-stage/libtv/07-canvas-output.png)
- [最终真实产物](./2026-08-02-3d-director-stage/libtv/08-director-output.webp)

## 5. 从用户的 CineForge 例子举一反三：问题必须分层

用户指出：“人物动作错了，动作和场景预设至少可以从开源社区找，不一定照抄某个仓库，但要意识到这是一种优化方法。”这个判断是对的。正确做法不是把一个仓库复制进 Nomi，而是分五层处理。

### 5.1 第一层：用户问题

表面问题是“蹲姿不好看”，底层可能分别是：

- 缺少合适动作/姿势；
- 有姿势但骨骼轴、bind pose 或脚方向映射错；
- 姿势本身合理，但未做落地、重心、穿插和接触修正；
- 单帧姿势合理，转成动作后脚滑、瞬移或 root motion 错；
- 动作和人物关系、场景道具不匹配；
- UI 只给一堆动作名，用户仍要自己找。

所以“加预设”只能解决第一小层。

### 5.2 第二层：社区原料

社区可能提供：

- 静态姿势角度；
- 带骨骼的动作 clip；
- 程序化行走/跑步/跳跃；
- 人物体型、群众排列；
- CC0 建筑、道路、家具、载具与自然物；
- 场景 kit、相机和灯光预设；
- retarget、自动落地、碰撞/生理约束代码。

这些原料的价值和许可完全不同，不能用一个“开源”标签概括。

### 5.3 第三层：Nomi 规范化能力

所有来源必须先经过：

```text
来源与许可证门
      ↓
单位 / 坐标轴 / 朝向 / AABB / minY 规范化
      ↓
骨骼 profile 与 retarget
      ↓
脚底接触 / 重心 / 穿插 / root motion / 循环连续性
      ↓
多视角人眼与镜头内质量检查
      ↓
导演语义标签与预览
      ↓
版本化 Director Preset Package
```

未经这条管线，素材越多，错误越规模化。

### 5.4 第四层：产品组合

用户不应看到一个“开源素材市场”。他只说“审讯”“追逐”“求婚”“两人对峙”，系统从经过校验的积木中组合：

- 关系模板：面对面、一前一后、围坐、包围；
- 姿势/动作：叉腰、指向、坐、跪、走、跑；
- 场景 kit：街道、室内桌椅、走廊、树林；
- Shot recipe：双人中景、正反打、越肩、低机位；
- Motion recipe：轻推、跟拍、弧绕。

用户只需要“换一个”“再近一点”“A 往前半步”，而不是寻找资源文件。

### 5.5 第五层：真实输出校验

素材通过离线 QA 仍不够。进入当前镜头后还要按角色尺度、场景、机位和时间做 preflight；产出后再检查最终画面。**资产质量、镜头质量、生成模型质量是三道不同的门。**

## 6. CineForge Previz：能借什么，为什么不能直接集成

[CineForge Previz 官方仓库](https://github.com/Work-Fisher/cineforge-previz) 是一个 2026 年公开的 Godot 白模预演工具，README 明确覆盖搭景、人物姿势/动作、群众、虚拟相机、时间轴、PNG/JSON/MP4 输出，并把白模交给即梦/Seedance 做最终渲染。

它对 Nomi 最有价值的不是“完整代码基座”，而是三个具体证据：

1. [`figure_lib.gd`](https://github.com/Work-Fisher/cineforge-previz/blob/77f53dfee256a6bb0d239aa7ceeb03d80ffa6ada/app/scripts/figure_lib.gd#L4-L109) 把程序化人偶、5 种体型、11 关节层级、27 个静态语义姿势、行走/跑步循环、跳跃状态和四元数姿势插值集中在一处。说明姿势不应散落在 UI 常量里，而应成为有坐标约定和运行规则的领域库。
2. [`models_index.json`](https://github.com/Work-Fisher/cineforge-previz/blob/main/app/models_index.json) 为模型记录分类、文件、AABB、`min_y` 和类目缩放。说明场景素材不是一堆 GLB，而要先有可落地、可缩放、可检索的规范化 metadata。
3. [`THIRD_PARTY_NOTICES.md`](https://github.com/Work-Fisher/cineforge-previz/blob/main/THIRD_PARTY_NOTICES.md) 明确模型来自 Kenney CC0；引擎、字体和 FFmpeg 各自许可。说明“仓库许可”和“第三方资产许可”必须分开追溯。

但仓库整体是 **CC BY-NC-SA 4.0**，官方明确禁止商业使用，并要求衍生作品同许可发布。因此：

| 内容 | Nomi 决策 |
|---|---|
| 产品路径、领域拆分、metadata 思路 | 可研究、可独立重做 |
| `figure_lib.gd` 的具体姿势角度、代码和数据表 | **不可直接复制到商业 Nomi** |
| 仓库中的 Kenney 模型 | 不从 CineForge 搬；回到 Kenney 原始 CC0 来源单独建 provenance |
| 白模 → AI 成片的产品定位 | 与 Nomi 同方向，可作为市场验证 |
| 整个 Godot 工具 | 不集成；会制造第二套编辑器与技术栈 |

源码还给出一套比当前 Nomi 更完整但不应照抄的参考边界：7 类 385 个 Kenney GLB、4 个环境预设、48 个相机预设；项目 v2 保存 fps、对象、shots、环境和烧录标签，每个 shot 同时保存相机与对象关键帧。可借的是“waypoint 冻结同一时刻的相机和对象状态”；不可借的是把 48 个运镜与完整时间线一并搬进 Nomi。

## 7. 可直接进入候选池的社区能力

最值得立即做技术 spike 的是 [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app)：它不是导演台，而是很合适的“动作/骨骼适配层”。其真实流程是导入 GLB/GLTF → 选骨骼类型 → 调整/测试骨架 → 预览动作 → 导出带动作 GLB/GLTF。当前项目支持 Human、Fox、Bird、Dragon、Kaiju、Spider、Snake、Fish、Horse 等 rig，源码已有 Mixamo/Rigify 等 bone map 与 retarget 机制；官方 `static/animations` 目录直接提供 `human-base-animations.glb`、`human-addon-animations.glb` 等动作包。

许可证不能只看 README 总结：代码是 MIT，主艺术资产有 CC0 声明；但 [`RigModelVariations.ts`](https://github.com/Mesh2Motion/mesh2motion-app/blob/e66f13ccf00ba0afc07e82d876af016e40792422/src/lib/RigModelVariations.ts) 里还存在 CC-SA、CC-BY 等变体，CMU sample 的原始许可链也不完整。因此每个 asset 必须独立记录 license/attribution/source/hash；只有明确 CC0 的 base rig/animation 才能进入直接候选池。

这不等于“明天把全部动作搬进产品”。正确动作是：

1. 只取 8–12 个高频导演动作做 spike；
2. 建 `Mixamo/Nomi ↔ Mesh2Motion human` 骨骼映射；
3. 检查 bind pose、骨长、脚滑、root motion、循环接缝和 hand/foot contact；
4. 每个动作产出正/侧/最终相机多视角预览；
5. 通过后才进入策展包；失败动作不在运行时降级猜测。

首批建议围绕真实镜头摩擦，不追求数量：

- 待机/站立、走、跑；
- 坐下/坐姿、蹲/跪；
- 指向、叉腰/生气、拒绝、庆祝；
- 对话倾听、疲惫弯腰；
- 必要的进入/退出过渡。

场景侧优先回到 [Kenney](https://kenney.nl/) 等明确 CC0 原始来源，复用 CineForge 已验证的 metadata 思路：`assetId / source / license / unit / upAxis / forwardAxis / aabb / minY / semanticTags / qaStatus`。不要先做任意上传和市场。

### 7.1 开源项目源码级对照

| 项目 | 当前状态/许可 | 输入 → 操作 → 输出 | 用户会喜欢 / 放弃什么 | Nomi 决策 |
|---|---|---|---|---|
| [CineForge Previz](https://github.com/Work-Fisher/cineforge-previz) | 2026-07；CC BY-NC-SA | 白模资产 → 搭景/人偶/群演/48 相机预设/时间线 → JSON/PNG/MP4 | 喜欢完整“施工图”；放弃在登录、DCC 密度和非商业许可 | 借产品心智、waypoint/metadata；clean-room，不复制 |
| [Blockout](https://github.com/wassermanproductions/blockout) | 约 95★；2026-07；Apache-2.0 | 环境/实尺人物/动作/运镜 → Stage/Shoot/Deliver → MP4、depth、normal、stills、prompt、metadata | 喜欢交付包直接服务生成；可能被系统广度吓退 | 借 Deliver package、coverage、auto-frame；不搬完整 DCC |
| [Kunpeng Director](https://github.com/pengfeiqiao/kunpeng-director) | 约 8★；2026-07；MIT | stable IDs + actions + camera templates → timeline/lock/validation → PNG/MP4 | 喜欢 Agent/人工同一确定状态；PoC、固定 24fps 和小生态会劝退 | 借 stable ID、lock、validation；不照搬固定帧率 |
| [Storyboarder Shot Generator](https://github.com/wonderunit/storyboarder) | 约 3773★；主线 2022 后停滞；仓库无清晰 SPDX | 人物/物体/相机/pose preset → blocking → final/top-down/edit state 回故事板 | 喜欢故事板上下文、姿势镜像和保存；维护停滞 | 借“回故事板 + 可编辑状态”；不借老壳 |
| [Storytools](https://github.com/Pullusb/storytools) | 约 123★；2026-08 仍活跃；GPL-3.0 | Blender gizmo/深度俯视/aim → Blender scene → storyboard/animatic | 专业空间操控高效；Blender 门槛和 GPL | 借 Pan/Depth/Aim 交互，不复制代码 |
| [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app) | 约 3039★；2026-08 活跃；代码 MIT，资产混合许可 | 模型 → 选/调 rig、试动作、retarget → 带动画 GLB | 开放 Mixamo 替代；但仍要理解 rig，且不是镜头工具 | 做离线资产适配层，不做用户主界面 |
| [Stable Virtual Camera](https://github.com/Stability-AI/stable-virtual-camera) | 约 1642★；2025；代码/模型输出有非商用约束 | 单/多图 → 13 轨迹或 3D 路径 → 576p 相机运动视频 | 一张图直接出运镜；分辨率、许可和一致性受限 | 借 effect-first 轻路径，不集成受限模型/输出 |

旧报告另有 [3D OpenPose Editor](https://github.com/nonnonstop/sd-webui-3d-open-pose-editor) 与 [mannequin.js](https://github.com/boytchev/mannequin.js) 的具体机制：锁定输出视角后生成 Pose/Depth/Normal/Canny，以及基于真实几何落地和生理约束。它们继续是“机制来源”，不是整套技术基座。

## 8. 三条产品方向与取舍

真正取舍不是“极简还是专业”，而是：**Nomi 是竞争 3D 能力广度，还是竞争下一格分镜一次做对？**

| 方向 | 用户看到什么 | 解决什么 | 代价 | 判断 |
|---|---|---|---|---|
| A. TapNow 式世界画布 | 几乎全屏视口，工具随选择出现，AI/上传/几何体都能加 | 进入 3D 不被面板吓退 | 与 Nomi 生成画布重叠；角色关系和可审计性弱；资产广度战 | 不选，只借上下文出现与专注取景 |
| B. LibTV/完整 previs | 场景树、Inspector、姿势、相机、轨道、时间轴完整可见 | 专业用户精确控制 | 新手学习 DCC；solo 团队承担动画/资产/物理/兼容性 | 不选，只借稳定对象真相与语义预设 |
| C. 镜头参考编译器 | 先看到一版镜头，用人话或直操修改，一次回填同源参考 | 少学、少配、少接线，直接减少 AI 视频返工 | 要先补状态/任务合同，并坚决删除旧主路 | **推荐** |

## 9. 推荐的完整产品设计

### 9.1 一句话体验

> 从故事镜头进入，Nomi 先试一版；用户围绕“当前这一镜”用导演语言或直接操作修正；点一次“使用这一镜”，构图图与运镜参考从同一冻结版本生成并回填。

这是一张可循环的工作台，不是六步 Wizard。创作会反复“看一版 → 改一句 → 手摆一下 → 看成片”，不该每次重新走步骤。

### 9.2 理想旅程

以“两人街头对峙，中景轻推”为例：

1. 从故事镜头点“试拍这一镜”；角色 A/B、街景、对峙、中景、轻推和下游节点已经带入。
2. 中央先显示来源摘要和一个主动作“试一版”，不先展示空白假人、环境参数或时间轴。
3. 系统选择已校验的关系/姿势/街景/机位积木，生成一份 SceneBlocking 和 active coverage。
4. 中央立即显示最终相机画面；A/B 身份清楚；底栏提示“两人入镜、接地、视线成立，末帧脚部可能被裁”。
5. 用户说“两个人再靠近一点，镜头低一点”，或直接点 A 拖半步；两种操作写入同一状态，并可撤销本次修改。
6. 切“看成片”，同一画面隐藏网格、名牌和 gizmo，播放整段轻推；不是跳到另一套预览。
7. 点“使用这一镜”；系统冻结 revision，按关键帧边界 + 自适应采样做全段检查。
8. 同一任务生成构图图和运镜 MP4，持久化 manifest，再 compare-and-attach 到原分镜。
9. 底栏就地显示“构图图 ✓ 已回填；运镜参考 ✓ 已回填”，点“返回分镜”。
10. 若只有视频失败，状态是“部分完成”，用户只补齐运镜，不重做已成功构图。

### 9.3 页面 IA

```text
┌ 返回  镜头 12 · 街头对峙   [角色 2 · 街景 · 中景轻推]             关闭 ┐
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                  当前这一镜（唯一 active coverage）               │
│       摆场面：同一相机画面 + 操控层；看成片：干净画面 + 播放        │
│                                                                  │
│ [镜头素材抽屉]                                      [选中项精调抽屉] │
├──────────────────────────────────────────────────────────────────┤
│ [摆场面 | 看成片]  “两个人再靠近一点，镜头慢慢推近”   [使用这一镜] │
└──────────────────────────────────────────────────────────────────┘
```

### 9.4 顶栏

只回答“这是哪一镜、从哪来”：

- 返回、镜头编号/标题；
- 只读来源摘要 chip，点开查看角色/场景/意图；
- 关闭。

删除永久的“构图图 / 人物动作 / 运镜参考”三 tab。这三项是系统产物，不是用户要分别管理的三个任务。

### 9.5 中央唯一镜头

**摆场面**与**看成片**共享同一 active camera 和同一画面：

- 摆场面只是在最终画面上叠加选择、落地点、名称 chip 和一个变换手柄；
- 看成片隐藏所有辅助层，有运镜时出现最小播放条；
- 俯视摆位是临时辅助视图，明确标“不会出片”，关闭后回到同一镜头；
- 删除浮动 CameraPreview、输出画面编辑和“预览最终画面”三套并行真相。

### 9.6 右侧上下文精调

无选择时收起，不再默认显示环境。

| 选中对象 | 第一层 | 高级层 |
|---|---|---|
| 人物 | 关系、靠近/远离、面向、看向、推荐姿势/动作、落地、镜像 | 身体部位与骨骼轴 |
| 相机 | 主体、景别、角度、焦段、画幅、安全区、跟随/注视 | 精确坐标、Near/Far |
| 道具 | 放在谁旁边、落地、对齐、缩放 | 精确 transform |
| 轨迹 | 语义、时长、速度、平滑、全段警告 | 关键点与曲线 |
| 背景 | 场景/氛围的少量语义选择 | HDRI、网格、天空等技术项 |

姿势首层不展示完整库，而展示“当前镜头推荐 + 最近使用 + 换一个”。完整策展库可搜索，但用户仍按动作意图找，不按资产来源找。

### 9.7 底栏

底栏只有：

- `摆场面 / 看成片`；
- 导演语言输入和 3–5 个当前推荐 chip；
- 当前校验/Job 状态；
- 唯一主 CTA “试一版”或“使用这一镜”。

完整时间轴只在用户显式“精调运镜”时临时全宽打开；关闭即回到镜头。静态构图永远不先展示时间轴。

### 9.8 任务状态与失败恢复

Toast 只用于可撤销的轻操作，出片状态只住底栏一处。

| 状态 | 用户看到 | 行动 |
|---|---|---|
| Preflight 硬错误 | 画面上标问题；“A 在镜头外，暂不能使用” | “帮我修好”或跳到 A |
| Preflight 警告 | “末帧脚部可能被裁” | 推荐“自动修正”；次级“仍使用” |
| 生成中 | 检查 → 构图图 → 运镜 → 持久化 → 回填 | 可取消；不做假百分比 |
| 部分完成 | 构图图 ✓；运镜 ×；已回填 1/2 | “补齐运镜参考” |
| 全部失败 | 明确失败阶段和人话原因 | 原地重试，现场保留 |
| 回填冲突 | “产物已生成，但分镜期间被修改，未覆盖新版本” | 用最新版本重做或查看本次产物 |
| 完成 | “构图图 + 运镜参考已回填” | 返回分镜 |

### 9.9 窄屏

- ≥1280：中央镜头优先，右 Inspector 约 320px，左侧素材仍按需抽屉；
- 960–1279：左右抽屉互斥，一次最多开一个；
- 760–959：Inspector 用 bottom sheet，精调运镜进独立全屏子页；
- <760：保留看成片、状态和回填；摆场面提示扩大窗口，不裁掉主 CTA。

## 10. 社区资产/能力的产品与技术设计

### 10.1 不做“集成某一个仓库”

建立一个内部 `DirectorPresetPackage` 规范，来源可以是 Nomi 自研、CC0 资产或可商用代码，但运行时只认统一格式：

```ts
type DirectorPresetPackage = {
  packageId: string
  version: string
  source: {
    url: string
    author: string
    license: string
    rawHash: string
  }
  kind: 'pose' | 'motion' | 'scene-kit' | 'blocking' | 'camera' | 'lighting'
  rigProfile?: string
  unitScale: number
  upAxis: 'Y' | 'Z'
  forwardAxis: '+Z' | '-Z' | '+X' | '-X'
  semanticTags: string[]
  contacts?: string[]
  rootMotion?: 'none' | 'in-place' | 'world'
  bounds?: { aabb: number[]; minY: number }
  qa: {
    status: 'candidate' | 'passed' | 'rejected'
    checks: string[]
    previewRefs: string[]
  }
  contentHash: string
}
```

未知许可证、没有 provenance 或未过 QA 的内容默认拒绝进入分发包。

### 10.2 资产不是顶层产品导航

运行时检索基于当前镜头语义：

```text
“审讯室，警探站着逼问坐着的嫌疑人，低机位中景”
            ↓
关系：一站一坐、隔桌对视
动作：逼问 / 紧张坐姿
场景：桌椅室内 kit
镜头：低机位双人中景
            ↓
组合后做镜头级检查，先给用户看一版
```

用户可以“换一个动作/场景”，但不需要知道它来自 Mesh2Motion、Kenney 还是 Nomi 自研。

### 10.3 首批策略

| 类别 | 首批做什么 | 暂不做 |
|---|---|---|
| 姿势 | 独立校准现有高频姿势；从合规动作抽取高质量代表帧 | 无限姿势市场 |
| 动作 | 从 Mesh2Motion 中**逐项确认 CC0 来源**后，选少量 walk/run/listen/angry/reject/victory 等做 retarget spike | 一次导入全部 clip |
| 场景 | Kenney 等 CC0 的街道、室内、树林少量 scene kit，补 AABB/minY/锚点 | 任意联网搜模型 |
| 关系 | Nomi 自研面对面、并肩、前后、围坐、包围等参数模板 | 把关系写死到场景资产 |
| 镜头 | 双人中景、正反打、越肩、特写、低/高机位等 recipe | 39 种运镜大目录 |
| 校验 | 接地、穿插、主体越框、视线、轨迹连续性、关键时间采样 | P0 用 VLM 逐帧当主裁判 |

## 11. 底层数据与任务合同

### 11.1 五个必须分开的概念

1. **可编辑文档**：当前 Scene3DState 的 canonical v2；
2. **编译快照**：点击“使用这一镜”时冻结的 scene/coverage/assets hash；
3. **持久 Job**：有明确阶段、heartbeat、重试和终态；
4. **不可变 Manifest**：真实落盘产物与 QA；
5. **回填结果**：目标节点是否仍是预期 revision，是否真实 attach。

Job 成功不自动等于回填成功；回填冲突也不抹掉已经成功生成的 pack。

### 11.2 最小合同

```ts
type Scene3DDocumentV2 = {
  schemaVersion: 2
  sceneId: string
  revisionId: number
  contentHash: string
  objects: SceneObject[]
  coverages: ShotCoverage[]
  activeCoverageId: string
  assetRefs: AssetRef[]
}

type ShotCoverage = {
  coverageId: string
  cameraId: string
  subjectIds: string[]
  heroFrameTime: number
  frameSpec: { aspectRatio: number; resolution: [number, number]; safeArea: number }
  motionTrackIds: string[]
}

type MotionTrack = {
  trackId: string
  targetId: string
  channel: string
  segments: Array<{
    segmentId: string
    start: number
    end: number
    keyframes: unknown[]
    interpolation: string
  }>
}

type ReferencePackJob = {
  jobId: string
  idempotencyKey: string
  snapshot: CompiledSourceSnapshot
  status:
    | 'queued' | 'preparing' | 'preflighting' | 'rendering'
    | 'persisting' | 'attaching' | 'partial'
    | 'succeeded' | 'failed' | 'cancelled'
  error?: { code: string; phase: string; message: string; retryable: boolean }
  artifacts: ArtifactJob[]
}
```

### 11.3 不变量

- selection 永不改变 active coverage；
- 运行中的 Job 永不读取 live Scene3DState；
- 相机输出不再以 `cameras[0]` 或数组重排表达；
- MotionTrack 每个 owner/channel 的 segments 全保留、有序，重叠要显式策略，禁止静默丢弃；
- revision 只在领域修改时递增，hover/playhead/面板折叠不递增；
- retry 重跑同一 snapshot；“使用最新版本”是新 Job；
- 必需 artifact 真落盘、有 checksum 后才成功；
- artifact role 用枚举，不看中文标题；
- 未知许可证资产不能进入可分发 pack；
- 旧 schema 只在 serializer 做单向迁移，新旧运行时/新旧 UI 不并行。

## 12. 改什么、删什么、为什么

| 当前事实 | 改动 | 必须同批删除 | 用户得到什么 |
|---|---|---|---|
| `cameras[0]` 与 selection 决定输出 | schema v2 加 `activeCoverageId/cameraId`，一次性迁移 | 所有业务 fallback 和“搬相机到数组第一位” | 调相机 2 就永远出相机 2 |
| 构图/运镜两套 builder/Host | 同一镜头快照 + `ReferencePackHost` | `stagingAutoCapture`、`cameraMoveAutoCapture` 与两个旧 Host | 一次得到同源图和视频 |
| 四套最终画面 | 中央唯一 active coverage | 浮动监看、输出画面编辑、最终预览副本 | 不再猜哪块会输出 |
| 顶部三任务 + MoveHub + 底部录制 | 当前镜头 + 导演语言 + 一个 CTA | 旧 taskMode、常驻 MoveHub、重复停止/生成入口 | 围绕镜头改，不围绕功能找入口 |
| 默认环境和全量骨骼/相机字段 | context Inspector + 高级折叠 | 未选对象环境空态、重复画幅/FOV | 先出效果，需要时才精调 |
| Toast + overlay + 结果卡 | 底栏持久 Job 状态 | 出片 Toast、固定结果卡、中央任务 overlay | 知道在做什么、失败在哪、下一步是什么 |
| 姿势只靠手调常量 | 策展动作/姿势包 + retarget/QA | 质量未过门的运行时 fallback | 动作更多且更自然，不把错误规模化 |
| 场景模板是对象集合 | versioned scene kit + 锚点/metadata/provenance | 无来源的随意资产 | 场景可复现、可换、可安全落地 |

## 13. 分期方案

### P0：先让一镜可信出包

目标：不增加产品广度，先让当前能力可靠。

1. Scene3D schema v2：显式 active coverage/camera、角色故事 ID、hero frame、revision/hash；旧数据单向迁移。
2. 修 MotionTrack：一个 target/channel、多有序 segments，serializer/playback/capture 全一致。
3. `ReferencePackJob`：冻结 snapshot、真实终态、partial、取消、heartbeat、幂等、错误码、只重试失败 artifact。
4. 合并静态/动态出片与回填；移除中文标题推断；compare-and-attach 处理期间编辑。
5. P0 preflight：起止帧、所有 keyframe/segment 边界和自适应采样；检查相机、主体安全区、接地、明显碰撞、轨迹连续性。
6. UI 收口：一个中央镜头、一个 CTA、一个任务状态；同批删三任务 tab、浮动预览、默认环境、常驻 MoveHub、重复录制停止和关键 Job Toast。
7. 修两条已经漂移的生产走查脚本，把指定统一任务设为发布门。

### P1：先出一版，再用导演语言改

1. 从故事镜头预载角色、场景、关系、镜头和下游目标；
2. 首屏“试一版”，直接产出 SceneBlocking + active coverage；
3. Director command reducer：自然语言与直操共享 `add/move/face/pose/frame/applyMotion` 等命令；
4. context Inspector 与临时精调运镜；
5. 首批策展动作/场景/镜头包；Mesh2Motion 明确 CC0 子集的 retarget spike；
6. 镜头级视觉 QA：在确定性检查之后做人眼/VLM 辅助，不把 LLM pairwise judge 当主指标；
7. ReferencePack lineage、查看、撤销与产物清理。

### P2：一套场面产生多个可靠镜头

1. 同一 blocking 派生双人中景、正打、反打、越肩和特写；
2. coverage 比较、推荐、批量编译；
3. 组合原子运镜的结构化导演计划，加入遮挡、碰撞、主体覆盖校验；
4. 受限的角色/物体因果过程，继续通过现有 `video_ref` 给生成模型重绘；
5. 远程社区包 registry、签名、升级与回滚——只有策展内置包稳定后才做。

### 明确不做

- 不做第二套 3D 导演台；
- 不保留新旧 UI、serializer 或 CaptureHost 的 feature flag 双轨；
- 不做默认展开的完整动画时间轴；
- 不做 Blender 式层、集合、物理、材质和任意关键帧系统；
- 不做资产市场或实时联网搜模型；
- 不为不同模型做两套 UI；
- 不把 CineForge NC-SA 代码/姿势数据复制进商业产品；
- 不宣称 3D preflight 能保证最终生成模型不换脸或不漂移。

## 14. 六角色独立评审后的收敛

| 角色 | 最强反对 | 方案如何修改 |
|---|---|---|
| CTO | 同时做编译链、多 coverage、全时段 QA、社区生态会重新变广度工程 | P0 只让一个 active coverage 可信出包；schema 可容纳多个但不露管理 UI |
| 后端 | active coverage、revision、Job、manifest、回填若只是几个字段仍会多真相 | 分成可编辑文档、冻结快照、持久 Job、不可变 manifest、AttachmentResult 五个合同 |
| PM | 静态构图与运镜 builder 各造一份场景；“全段安全”也不能夸成 AI 成片保证 | 同一 shot truth 一次出包；硬错误/警告/创作选择分级；角色绑定故事 ID |
| 真实用户 | 还要知道图片节点和视频节点、分别生成和接线，就不算完成 | 一次“使用这一镜”，回画布后一眼确认两个产物来自同一镜头 |
| 产品设计 | 六步向导和现有三栏换文案都不对；创作是循环 | 一张以“当前这一镜”为主语的循环工作台；中央唯一真相、底栏唯一 CTA |
| 前端 | 先换 context UI 会把 selection/cameras[0]/flags 的多重真相藏深 | 先 active camera + 单向迁移 + command/revision，再换壳，最后统一 Host；旧实现同批删除 |

共同否决线：

- Job 仍读取 live state；
- selection/数组顺序仍能改变输出相机；
- MotionTrack 仍静默丢段；
- `failed/cancelled/partial` 不是一等状态；
- 新 context UI 上线但旧 taskMode/Inspector/Host 仍隐藏保留；
- 成功只表示“开始捕获”，而不是真实落盘和回填；
- 未知许可证资产进入分发包。

## 15. 验收标准

### 15.1 用户任务

固定发布旅程：

1. 打开已有两名角色和街景的故事镜头；
2. 首屏 60 秒内得到第一版双人对峙中景；
3. 只用“再靠近一点、机位低一点、慢慢推近”完成修改；
4. 预览全段，不裁头、不穿地，警告可理解；
5. 一次“使用这一镜”；
6. 回画布确认构图图和运镜视频来自同一 revision 且接对槽；
7. 注入视频失败，构图保留，只重试视频；
8. 生成期间修改分镜，验证回填冲突不覆盖新版本。

### 15.2 可量化体验门

- 用户无需触碰 XYZ、骨骼轴、Near/Far、composition_ref、video_ref；
- 首屏环境字段数 0、完整时间轴数 0；
- 任一时刻主 CTA 恰好 1 个；
- 录制态可结束入口恰好 1 个；
- active camera 不随 selection 变化；
- “看成片”时中央就是唯一最终画面，浮动相机 Canvas 数 0；
- 构图/运镜必指向同一 scene/coverage revision；
- 全段采样结果和阈值写进 manifest；
- 必需产物未落盘或未 attach 时不得显示全部成功；
- 未知 license 或 QA 未通过的资产无法 publish；
- 1440×900 和 1280×720 下中央作品区至少占可用宽度 60%，浮层不遮主体。

### 15.3 代码与性能门

- serializer 唯一负责 V1 → V2；业务代码不散落 fallback；
- 相机重排不改变最终输出；删除 active 相机有确定接任策略；
- 每个领域 command 只增一次 revision；拖拽中不把每帧写回画布 store；
- Job 冻结后继续编辑不污染产物；
- 一个主交互 Canvas；其他监看 demand-only；离屏捕获串行，避免 WebGL context 争用；
- 新主路上线同 commit 删除旧实现；
- 同构建、同入口、同平台做人眼截图对账，不能只看自动 expect。

## 16. 本轮验证说明

- `pnpm build` 最终通过。最初失败来自本机 `.bin` shim 指向错误路径，`pnpm install --frozen-lockfile --prefer-offline` 正常重建后恢复；没有产品依赖改动。
- 13 个姿势的确定性度量全部通过，但本轮人眼仍判定部分姿势不自然，因此不会拿机器绿灯反驳用户。
- 运行姿势报告时项目测试配置意外带出了与本任务无关的 WeChat feedback 12 个失败；未在本任务越权修复。
- 两条旧 UX 脚本有 selector/断言漂移：入口 aria 已改、时间轴截图存在但断言报未展开。验证物本身要进 P0 卫生修复。

## 17. 资料与源码索引

### Nomi

核心代码：`Scene3DFullscreen.tsx`、`useScene3DTaskFlow.ts`、`scene3dInspector.tsx`、`cameraMovePreset.ts`、`scene3dSerializer.ts`、`scene3dPlayback.ts`、`CameraMoveCaptureHost.tsx`、`StagingCaptureHost.tsx`、`scene3dReferenceDirector.ts`（均位于 `src/workbench/generationCanvas/nodes/scene3d/`）。

研究证据：[2026-07-26 首轮调研](./2026-07-26-3d-director-stage-research-and-design.md)、[2026-08-02 证据目录](./2026-08-02-3d-director-stage/README.md)。

### 竞品与开源

- [CineForge Previz](https://github.com/Work-Fisher/cineforge-previz)
- [CineForge figure library](https://github.com/Work-Fisher/cineforge-previz/blob/main/app/scripts/figure_lib.gd)
- [CineForge model index](https://github.com/Work-Fisher/cineforge-previz/blob/main/app/models_index.json)
- [CineForge third-party notices](https://github.com/Work-Fisher/cineforge-previz/blob/main/THIRD_PARTY_NOTICES.md)
- [Mesh2Motion app](https://github.com/Mesh2Motion/mesh2motion-app)
- [Mesh2Motion CC0 assets](https://github.com/Mesh2Motion/mesh2motion-assets)
- [Mesh2Motion runtime animations](https://github.com/Mesh2Motion/mesh2motion-app/tree/main/static/animations)
- [Wonder Unit Storyboarder](https://github.com/wonderunit/storyboarder)
- [Blockout](https://github.com/wassermanproductions/blockout)
- [Kunpeng Director](https://github.com/pengfeiqiao/kunpeng-director)
- [Storytools](https://github.com/Pullusb/storytools)
- [3D OpenPose Editor](https://github.com/nonnonstop/sd-webui-3d-open-pose-editor)
- [mannequin.js](https://github.com/boytchev/mannequin.js)
- [Theatre.js](https://github.com/theatre-js/theatre)

## 18. 等待确认的唯一产品决定

建议确认的不是具体按钮，而是这条产品边界：

> **Nomi 3D 导演台不再扩成通用 3D 世界或完整 previs；它收敛为“当前这一镜”的参考编译器。P0 先让同一镜头可信地产生并回填构图图与运镜参考；P1 再接故事输入、导演语言与少量经过许可/质量门的社区动作和场景；P2 才开放一套场面多机位和社区包生态。**

确认后下一步不是直接写生产代码，而是按当前真实外壳制作一份可交互 HTML 样张，逐项对账：首屏、唯一中央镜头、context Inspector、导演语言、全段警告、partial 失败与回填完成态；样张获批后再进入 P0 实现。
