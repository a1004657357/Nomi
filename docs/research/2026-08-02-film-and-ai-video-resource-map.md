# 电影语言与 AI 视频生成资源地图

> 调研日期：2026-08-02  
> 用途：为 Nomi 的 Director Agent、分镜表、3D 导演台、视频生成路由和自动验收提供知识库与实现候选。  
> 筛选原则：优先官方文档、论文项目页、作者仓库和行业标准；社区项目只作为实现参考。仓库可访问不等于代码、权重、数据和影视素材都允许商用，接入前必须逐项审计许可证。

## 1. 结论

最值得 Nomi 立即吸收的不是某个“导演风格提示词包”，而是四层结构：

1. **电影语言本体**：把景别、机位、镜头运动、构图、焦段、调度、表演、光线、色彩、声音、剪辑和连续性变成结构化字段。
2. **分镜与预演工具链**：Fountain/Storyboarder/Blender/Unreal 负责剧本、镜头、空间和机位；OpenTimelineIO 负责剪辑交换。
3. **Provider 编译器**：同一份镜头意图按 Sora、Veo、Seedance、Runway、Luma、MiniMax、Vidu 等各自参数和参考图模式编译，不能共用一段无差别 prompt。
4. **自动质量门**：用 CineTechBench、VBench、T2V-CompBench、TC-Bench、VideoPhy 等分别检查电影技法、主体/背景一致性、动作与空间绑定、状态转变和物理合理性。

## 2. 电影语言、摄影、灯光与剪辑

### 2.1 权威学习资料

| 资源 | 覆盖内容 | 对 Nomi 的用途 |
| --- | --- | --- |
| [ASC Master Class](https://theasc.com/master-class) | 美国电影摄影师协会的摄影、灯光、工作流和影片分析课程 | 摄影知识库的高可信入口 |
| [ASC Shot Craft: Analyzing a Script](https://theasc.com/articles/shot-craft-analyzing-a-script) | 从剧本提取摄影意图 | Script Agent 到 Director Agent 的规则来源 |
| [ARRI Academy](https://www.arri.com/en/learn-help/arri-academy/arri-certified-courses) | 摄影机、镜头、灯光、色彩与虚拟制作 | 摄影参数与术语词典 |
| [ARRI Lighting Handbook](https://www.arri.com/resource/blob/83996/409091c612f371b0c68b41d9dcb636db/arri-lighting-handbook-english-data.pdf) | 灯具、布光、安全与实拍方法 | 布光 Agent 的规则来源 |
| [Kodak Essential Reference Guide for Filmmakers](https://www.kodak.com/content/products-brochures/Film/kodak-essential-reference-guide-for-filmmakers.pdf) | 曝光、胶片、摄影和后期基础 | 影调、曝光与胶片风格知识 |
| [BFI Filmmaking Toolkits](https://www.bfi.org.uk/get-funding-support/bfi-network/filmmaking-toolkits) | 开发、制作、发行工具包 | 完整制片流程知识库 |
| [BFI Smartphone Shooting Guide](https://www.bfi.org.uk/commercial-partnerships-consultancy/bfi-enterprise-news-highlights/how-shoot-high-quality-smartphone-videos-5-easy-steps) | 轻量拍摄流程 | 低成本实拍模式 |
| [Yale Film Analysis 教学单元](https://teachers.yale.edu/curriculum/units/2015/4/1/4) | 叙事、场面调度、摄影、声音、运动 | 电影分析 Agent 的基础分类 |
| [Grammar of the Shot](https://www.routledge.com/Grammar-of-the-Shot/Bowen/p/book/9781032190136) | 镜头语法、覆盖、连续性 | 建议购买后人工提炼，不能把受版权保护正文直接打包 |
| [Cinematic Color](https://cinematiccolor.org/) | 电影色彩管理的系统资料 | 色彩流水线与术语 |

### 2.2 可检索电影画面与拍摄资料

| 资源 | 可检索维度 | 注意 |
| --- | --- | --- |
| [ShotDeck](https://shotdeck.com/) | 影片、主创、摄影机、镜头、景别、光线、色彩、构图、地点、情绪 | 最强电影参考入口；图片版权归原权利方，不应批量抓取内置 |
| [SHOT.CAFE](https://shot.cafe/) | 影片截图、颜色、光线、角度和标签 | 可做外链搜索，不建议复制图库 |
| [Seek](https://seek.film/) | 情绪、光线、构图、色彩 | 适合 moodboard 和导演风格检索 |
| [To The Cut](https://tothecut.com/) | 景别、镜头、光线、颜色、画幅与创作解析 | 适合把参考图转为结构化镜头参数 |
| [ReelStills](https://reelstills.com/) | 高分辨率电影帧 | 适合人工 lookbook，版权仍需单独处理 |
| [FilmGrab](https://film-grab.com/) | 按影片浏览电影帧 | 适合视觉研究，搜索结构弱于 ShotDeck |
| [Eyecandy](https://eyecannndy.com/) | 运镜、转场、视觉效果和拍摄手法的动态示例 | 适合建立可视化技法词典 |
| [Frame Set](https://site.frameset.app/) | 广告、MV、电影的画面和运动参考 | 适合商业广告 lookbook 与 motion reference |
| [ShotOnWhat](https://shotonwhat.com/) | 影片使用的摄影机、镜头和制作设备 | 适合设备与影片风格关联 |

推荐做法：Nomi 只保存用户选中的**链接、标签、出处、用途和本地授权副本路径**，不要内置或批量镜像商业电影帧。

### 2.3 开放色彩、剪辑与剧本标准

| 项目 | 作用 | 接入建议 |
| --- | --- | --- |
| [OpenColorIO](https://github.com/AcademySoftwareFoundation/OpenColorIO) | 影视/VFX 色彩管理，兼容 ACES | P0：统一预览、导入和导出色彩空间 |
| [OpenColorIO-Config-ACES](https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES) | 常用相机、显示器和 ACES 配置 | P0：为 Nomi 提供明确的色彩配置，而非滤镜名字 |
| [ACES](https://github.com/ampas/aces-dev) | Academy Color Encoding System 参考实现 | P1：先审计当前仓库状态和版本迁移说明 |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | 跨剪辑软件的时间线交换格式 | P0：分镜、视频节点和最终剪辑之间的中间格式 |
| [Fountain](https://github.com/nyousefi/Fountain) | 开放的纯文本剧本标记格式 | P0：剧本导入/导出和 Agent 结构化输出 |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | 转码、拼接、抽帧、代理媒体和质检 | P0：后台媒体处理 |
| [MLT](https://github.com/mltframework/mlt) | 非线性编辑引擎 | P2：只有在 Nomi 要做完整编辑器时再评估 |
| [Remotion](https://github.com/remotion-dev/remotion) | React 驱动的视频合成 | P1：字幕、包装、数据化视频和模板渲染 |

## 3. 分镜、Previs 与虚拟摄影

| 项目/文档 | 核心能力 | Nomi 价值 |
| --- | --- | --- |
| [Wonder Unit Storyboarder](https://github.com/wonderunit/storyboarder) | 分镜、Fountain、3D Shot Generator、GLB 导入 | P0：分镜交互和 3D 镜头预演的直接参考 |
| [Blender Grease Pencil](https://docs.blender.org/manual/en/4.0/grease_pencil/introduction.html) | 2D/3D 混合绘制与故事板 | P0：新 3D 导演台的底座候选 |
| [Blender Storypencil](https://video.blender.org/w/nmfHw6DoKztuA8WFKbp5B2) | 多场景故事板与剪辑工作流 | P0：镜头、场景和时间线的组织方式 |
| [Storytools](https://pullusb.github.io/storytools-docs/) | Blender 故事板绘制和相机工具 | P1：Blender 插件层参考 |
| [Unreal Cinematics / Sequencer](https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematics-and-movie-making-in-unreal-engine) | 相机、镜头、take、rig、虚拟摄影与渲染 | P1：复杂虚拟制片和镜头调度参考 |
| [Unreal Virtual Production Field Guide Vol. 2](https://cdn2.unrealengine.com/Virtual%20Production%20Field%20Guide%20Volume%202%20v1.0-5b06b62cbc5f.pdf) | 虚拟制片完整方法 | 导演台知识库，不是直接代码依赖 |
| [DirectorsConsole](https://github.com/NickPittas/DirectorsConsole) | 无限画布、真实摄影机/镜头/胶片/灯具、ComfyUI | P0：与 Nomi 目标最接近，先做许可证和架构审计 |
| [Prose Storyboard Language](https://arxiv.org/abs/1508.07593) | 人和机器都可读的镜头描述语言 | P0：Nomi `shot_spec` 数据模型的重要参考 |
| [Cinematographic Camera Diffusion](https://github.com/jianghd1996/Camera-control) | 按电影属性生成相机轨迹 | P1：Agent 到 Blender 相机动画的研究参考 |
| [GenDoP / DataDoP](https://kszpxxzmc.github.io/GenDoP/) | 由导演意图生成相机轨迹；约 2.9 万镜头数据 | P1：镜头轨迹推荐与自动调度 |

## 4. 电影数据集与电影技法评测

| 资源 | 内容 | 可用于 |
| --- | --- | --- |
| [MovieNet](https://movienet.github.io/index.html) | 约 1000 部电影的角色、场景、镜头、叙事等多模态标注 | 场景边界、人物、叙事和镜头理解研究 |
| [MovieShots](https://movienet.github.io/projects/eccv20shot.html) | 约 4.6 万镜头，景别与运动标注 | 景别/运镜分类器和提示词检查器 |
| [MovieBench](https://github.com/showlab/MovieBench) | 电影级长视频、角色库、场景/镜头层级描述 | 长叙事与跨镜一致性研究 |
| [HISTORIAN](https://cvl.tuwien.ac.at/research/cvl-databases/historian-a-large-scale-historical-film-dataset-with-cinematographic-annotation/) | 历史电影的镜头边界、类型和相机运动 | 老电影风格与镜头统计研究 |
| [Movie Shot Classification Dataset](https://github.com/magcil/movie_shot_classification_dataset) | 10 类相机运动 | 轻量运镜识别原型 |
| [Hugging Face Movie Shot Categorizer](https://github.com/huggingface/movie-shot-categorizer) | 色彩、灯光和构图分类 | 自动打标签参考 |
| [CineTechBench](https://github.com/PRIS-CV/CineTechBench) | 景别、角度、构图、运镜、光线、色彩、焦段 | P0：Director Agent 与生成结果的电影技法验收 |
| [FilmSet / FilmNet](https://github.com/CXH-Research/FilmNet) | 电影风格数据与增强 | 风格分析研究；先核对数据授权 |

## 5. AI 电影制作与多 Agent 工作流

这些项目最适合学习“工作流和数据结构”，不能仅凭 README 就判断可直接复制或商用。

| 项目 | 强项 | 建议 |
| --- | --- | --- |
| [ViMax](https://github.com/HKUDS/ViMax) | Idea/Script/Novel to Video、多 Agent、参考图选择、一致性检查、并行生成、Agent Loop | P0 架构审计；重点看可恢复任务、镜头依赖和一致性门 |
| [Jellyfish](https://github.com/Forget-C/Jellyfish) | 剧本拆镜、角色/场景/道具/服装、候选确认、异步任务 | P0 参考资产准备和 shot-ready 状态机 |
| [VideoClaw](https://github.com/HITsz-TMG/VideoClaw) | 规划到后期的可审阅生产线 | P1 参考阶段化 Agent 和中间产物 |
| [LumenX](https://github.com/alibaba/lumenx) | AI 短剧一站式生产 | P1 参考剧本分析与短剧工作台 |
| [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app) | ScriptAgent、ProductionAgent、无限画布、分镜与剪辑 | P1 参考画布与 Agent 分工 |
| [ArcReel](https://github.com/ArcReel/ArcReel) | 多 Provider、Agent 调度、沙箱、完整生产线 | P1 参考 Provider 能力发现和 Agent 权限边界 |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | Agent 化视频生产、真实素材检索、剪辑、52 个工具 | P1 参考“避免动态 PPT”的运动质量门 |
| [DirectorsConsole](https://github.com/NickPittas/DirectorsConsole) | 电影器材化画布和 ComfyUI 节点 | P0 参考 Director UI 和器材数据模型 |
| [StoryBlender](https://engineeringai-lab.github.io/StoryBlender/) | 可编辑 3D 故事板与跨镜一致性 | P1 研究 3D 分镜到视频的桥接 |
| [ShotDirector](https://openaccess.thecvf.com/content/CVPR2026/papers/Wu_ShotDirector_Directorially_Controllable_Multi-Shot_Video_Generation_with_Cinematographic_Transitions_CVPR_2026_paper.pdf) | 可导演的多镜头视频与电影转场 | P1 研究镜头间转场与多镜生成 |
| [Camera Artist](https://arxiv.org/abs/2604.09195) | 故事板 Agent 与摄影 Agent 协作 | P1 参考 Director Agent 职责拆分 |
| [Make-A-Storyboard](https://arxiv.org/abs/2312.07549) | 长视频的场景级故事板生成 | 研究参考 |

## 6. 开放 AI 视频基础模型与运行框架

### 6.1 通用生成

| 项目 | 主要能力 | 部署提醒 |
| --- | --- | --- |
| [Wan2.2](https://github.com/Wan-Video/Wan2.2) | T2V/I2V 等开放视频模型 | 模型大，先核对显存和模型许可证 |
| [HunyuanVideo](https://github.com/Tencent-Hunyuan/HunyuanVideo) | T2V/I2V 与并行推理 | 本机 Mac 不适合直接跑完整大模型 |
| [LTX-Video / LTX-2](https://github.com/Lightricks/LTX-Video) | 高效视频生成、音视频能力持续演进 | 适合研究本地/云端可切换运行 |
| [SkyReels-V2](https://github.com/SkyworkAI/SkyReels-V2) | 长视频、首尾帧、视频延展 | 适合镜头延展研究 |
| [CogVideo](https://github.com/THUDM/CogVideo) | T2V/I2V 开放模型族 | 生态成熟，可通过 Diffusers/ComfyUI 使用 |
| [Mochi](https://github.com/genmoai/mochi) | 10B 开放视频模型和可组合 API | Apache-2.0 代码；权重条款仍需确认 |
| [Open-Sora](https://github.com/hpcaitech/Open-Sora) | 开放训练与推理体系 | 适合学习训练/数据/并行，不是轻量本地模型 |
| [Open-Sora-Plan](https://github.com/PKU-YuanGroup/Open-Sora-Plan) | 开放视频生成计划与模型 | 研究与自托管候选 |
| [Step-Video-T2V](https://github.com/stepfun-ai/Step-Video-T2V) | 大型 T2V 模型与评测 | 资源要求高 |
| [LongCat-Video](https://github.com/meituan-longcat/LongCat-Video) | T2V/I2V/续写和长人物视频 | 适合长视频与数字人路线研究 |
| [Ovi](https://github.com/character-ai/Ovi) | 同步音视频生成 | 适合对白/声音原生视频研究 |
| [MOVA](https://github.com/OpenMOSS/MOVA) | 原生同步视频与音频、LoRA 和评测 | 适合音效/口型一体化研究 |
| [Lance](https://github.com/bytedance/Lance) | 图像/视频理解、生成和编辑统一模型 | 新项目，先做成熟度和许可证审计 |
| [VideoCrafter](https://github.com/AILab-CVC/VideoCrafter) | T2V/I2V 基础研究平台 | 生态参考，画质不代表当前最优 |
| [AnimateDiff](https://github.com/guoyww/AnimateDiff) | 为图像扩散模型加入运动模块 | ComfyUI 生态广，适合可控实验 |
| [FramePack](https://github.com/lllyasviel/FramePack) | 低显存长视频生成思路 | 适合本地推理和长序列研究 |

### 6.2 长视频、多镜头与一致性

| 项目 | 重点 | Nomi 价值 |
| --- | --- | --- |
| [LongLive 2.0](https://github.com/NVlabs/LongLive) | 实时、长视频、多镜头和并行基础设施 | 任务调度与长视频推理参考 |
| [Stable Video Infinity](https://github.com/vita-epfl/Stable-Video-Infinity) | 无限长度、逐段 prompt、错误回收 | 跨镜延展和漂移抑制参考 |
| [JoyAI-Echo](https://github.com/jd-opensource/JoyAI-Echo) | 分钟级多镜、音视频记忆、逐镜 prompt | 重点研究“上一镜记忆”数据模型；当前公开范围不支持 I2V |
| [Kaleido](https://github.com/zai-org/Kaleido) | 多主体参考视频生成 | 角色/道具多参考图的直接研究候选 |
| [ConsisID](https://github.com/PKU-YuanGroup/ConsisID) | 身份保持视频生成 | 角色一致性质量门和自托管候选 |
| [AniSora](https://github.com/bilibili/Index-anisora) | 动画视频、角色 360 度和多角度一致性 | 动画项目和角色转身建模研究 |
| [Video-As-Prompt](https://github.com/bytedance/Video-As-Prompt) | 用视频作为语义控制条件 | 比“首帧锁死”更自由的参考模式研究 |

### 6.3 相机、物体与人物运动控制

| 项目 | 控制方式 | Nomi 价值 |
| --- | --- | --- |
| [CameraCtrl](https://github.com/hehao13/CameraCtrl) | 显式相机轨迹 | Blender 相机轨迹到视频模型的桥接参考 |
| [MotionCtrl](https://github.com/TencentARC/MotionCtrl) | 相机与物体运动分离控制 | 解决“只有镜头动、人物不动”或相反的问题 |
| [CamI2V / RealCam-I2V](https://github.com/ZGCTroy/CamI2V) | 真实尺度相机控制 I2V | 3D 导演台到 I2V 的关键研究候选 |
| [UCPE](https://github.com/chengzhag/UCPE) | 相机内参、畸变、方向、pitch/roll | 焦段/镜头畸变/机位姿态的精确控制研究 |
| [Tora](https://github.com/alibaba/Tora) | 轨迹导向视频生成 | 物体运动路径工具参考 |
| [MOFA-Video](https://github.com/MyNiuuu/MOFA-Video) | 生成运动场控制图像动画 | 拖拽运动和人物动画参考 |
| [X-Dyna](https://github.com/bytedance/X-Dyna) | 动态人物动画 | 表演与人体动作参考 |
| [LivePortrait](https://github.com/KwaiVGI/LivePortrait) | 人像表情/姿态驱动 | 数字人口播和表情控制，不适合作为通用电影视频模型 |
| [MimicMotion](https://github.com/Tencent/MimicMotion) | 姿态引导人物视频 | 全身动作和表演参考 |
| [MuseTalk](https://github.com/TMElyralab/MuseTalk) | 实时口型同步 | 对白镜头后处理候选 |
| [Wav2Lip](https://github.com/Rudrabha/Wav2Lip) | 音频驱动口型 | 经典基线；商用需仔细核对权重/训练数据条款 |

## 7. AI 视频编辑、重绘与一致性修复

| 项目 | 能力 | 适合场景 |
| --- | --- | --- |
| [TokenFlow](https://github.com/omerbt/TokenFlow) | 无训练的跨帧一致编辑 | 风格/属性修改并保持时序 |
| [AnyV2V](https://github.com/TIGER-AI-Lab/AnyV2V) | 首帧编辑 + I2V 的通用视频编辑 | 将图像编辑技能扩展到视频 |
| [FateZero](https://github.com/ChenyangQiQi/FateZero) | 零样本文本驱动视频编辑 | 局部属性和风格替换 |
| [vid2vid-zero](https://github.com/baaivision/vid2vid-zero) | 无训练视频到视频编辑 | 研究参考 |
| [Tune-A-Video](https://github.com/showlab/Tune-A-Video) | 单视频微调与文本编辑 | 角色/风格定制研究 |
| [Rerender-A-Video](https://github.com/williamyang1991/Rerender_A_Video) | 零样本视频重绘 | 风格化与外观重构 |
| [DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio) | 多模型生成、编辑和推理流水线 | 自托管 Provider 适配层候选 |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | 图像/视频节点式推理工作流 | Nomi 不应复制其 UI，可把工作流作为后台 Provider |

## 8. AI 视频质量评测与自动验收

| 项目 | 检查什么 | 推荐层级 |
| --- | --- | --- |
| [VBench](https://github.com/Vchitect/VBench) | 主体/背景一致性、闪烁、运动平滑、动态程度、美学、画质、动作、颜色、空间关系、风格等 | P0，先选轻量指标子集 |
| [EvalCrafter](https://github.com/evalcrafter/EvalCrafter) | 700 prompts 与多维视频质量指标 | P1，完整运行依赖较重 |
| [T2V-CompBench](https://github.com/KaiyueSun98/T2V-CompBench) | 属性、空间、动作、运动、交互和数量绑定 | P0，最适合验证复杂 prompt 是否真的执行 |
| [TC-Bench](https://weixi-feng.github.io/tc-bench/) | 初态到终态的时间组合变化 | P0，适合首尾帧和动作链验收 |
| [CineTechBench](https://github.com/PRIS-CV/CineTechBench) | 景别、角度、构图、运镜、光线、色彩、焦段 | P0，Director Agent 专用质量门 |
| [FilmBench](https://arxiv.org/abs/2607.24241) | 电影学院语言体系、真实电影镜头表、T2V/R2V、多镜头和 FilmOps | P0 研究候选；2026-07-27 首发，代码/数据开放状态仍需跟踪 |
| [VideoPhy](https://github.com/Hritikbansal/videophy) | 语义遵循和物理常识 | P1，动作/道具交互验收 |
| [PhyGenBench](https://github.com/OpenGVLab/PhyGenBench) | 力学、光学、热学、材料与自然度 | P1，复杂物理镜头 |
| [Physics-IQ](https://github.com/google-deepmind/physics-iq-benchmark) | 生成视频的物理理解 | P1，物理质量基准 |
| [VMBench](https://github.com/gd-aigc/vmbench) | 感知对齐的运动质量 | P1，解决“动态图片感” |
| [MovieGenBench](https://github.com/facebookresearch/moviegenbench) | 视频与音频生成评测 prompt | P1，音视频模型比较 |
| [ChronoMagic-Bench](https://github.com/PKU-YuanGroup/ChronoMagic-Bench) | 长时间变化和时序一致性 | P2，延时/状态演化镜头 |
| [Video-Bench 汇总](https://github.com/Video-Bench/Video-Bench) | 视频生成 benchmark 索引 | 持续跟踪新评测 |

Nomi 不应一开始把所有 benchmark 跑在用户电脑上。P0 可以先做：

- 低成本规则：分辨率、画幅、时长、黑帧、重复帧、静态程度、音轨、文件完整性。
- VLM 检查：角色/服装/道具/场景是否一致，动作结果是否发生，机位与景别是否符合。
- 选配 GPU 评测：VBench 的一致性/动态指标、T2V-CompBench 的检测/跟踪指标。

## 9. 官方商业视频 API 与提示词文档

| Provider | 官方入口 | Nomi 应映射的能力 |
| --- | --- | --- |
| OpenAI Sora 2 | [Videos API](https://platform.openai.com/docs/api-reference/videos) | prompt、参考图、4/8/12 秒、尺寸、异步状态、remix |
| Google Veo | [Veo on Vertex AI](https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos) | T2V、I2V、首尾帧、延展、模型/时长/结果数、长任务 |
| Runway | [Runway API](https://docs.dev.runwayml.com/api/) | I2V/T2V 任务、状态、输出资产 |
| Luma Dream Machine | [Video Generation](https://docs.lumalabs.ai/ue/docs/video-generation) | 首帧、尾帧、首尾帧、loop、画幅、camera motion/concepts |
| MiniMax Hailuo | [Video Generation](https://platform.minimax.io/docs/guides/video-generation) | T2V、I2V、首尾帧、主体参考、时长、分辨率、镜头命令 |
| Vidu | [API Docs](https://docs.platform.vidu.com/) / [MCP](https://platform.vidu.com/docs/mcp-overview) | T2V/I2V、任务回调；可直接研究 MCP Provider |
| Amazon Nova Reel | [Video Generation](https://docs.aws.amazon.com/nova/latest/userguide/video-generation.html) | 单镜/多镜、storyboard、T2V/I2V、6 秒分段、异步任务 |
| Adobe Firefly | [Firefly Services](https://developer.adobe.com/firefly-services/docs/guides/) / [Usage Notes](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/usage-notes/) | T2V/I2V、画幅、速率限制、企业凭据与存储域限制 |
| Volcengine / Seedance | [官方模型列表](https://www.volcengine.com/docs/6492/2389898?lang=en) | 必须以控制台真实可用模型 ID 为准；即梦 Web 自动化不能伪装成稳定官方 API |

### 长任务调用的统一规则

1. 生成按钮只执行一次 `create`，保存 `provider_task_id` 和请求指纹。
2. 轮询只能调用 `retrieve/status`，绝不能因“暂时没有结果”再次提交 `create`。
3. 支持 webhook 的 Provider 优先 webhook；轮询采用明确间隔、超时和总查询上限。
4. 任务状态必须区分 `queued/running/succeeded/failed/cancelled/unknown`。
5. 用户手动重试必须创建新 revision，保留旧资产和成本记录。
6. 用 `idempotency_key` 或本地提交锁防止双击、重渲染、窗口重启和插件重复注入造成多次扣费。

## 10. 值得持续跟踪的资源索引

- [Awesome Video Generation](https://github.com/AlonzoLeeeooo/awesome-video-generation)：按任务整理的视频生成研究。
- [Awesome Video Generation Daily](https://github.com/kongzhecn/awesome-video-generation)：自动更新到 2026 年的论文索引，覆盖相机、长视频、编辑、世界模型和音视频。
- [Awesome Video Diffusion Models](https://github.com/ChenHsing/Awesome-Video-Diffusion-Models)：模型、控制、数据和编辑分类。
- [Awesome Text-to-Video](https://github.com/jianzhnie/awesome-text-to-video)：生成、控制、加速和 survey。
- [Awesome Evaluation of Visual Generation](https://github.com/ziqihuangg/Awesome-Evaluation-of-Visual-Generation)：视觉生成评测索引。
- [GitHub ai-filmmaking topic](https://github.com/topics/ai-filmmaking)：发现新工作台；结果质量不一，不能自动信任。

## 11. 建议为 Nomi 建立的 `shot_spec`

```json
{
  "shot_id": "SC03-SH07",
  "narrative_intent": "这个镜头为什么存在",
  "beat": "本镜唯一叙事节拍",
  "subject": ["角色A", "道具杯子"],
  "action_chain": ["A端起杯子", "停顿", "看向B", "放下杯子"],
  "start_state": "动作前的可见状态",
  "end_state": "动作完成后的可见状态",
  "performance": "眼神、呼吸、重心、手势、节奏",
  "dialogue": "台词或空",
  "shot_scale": "MS",
  "camera_angle": "eye_level",
  "lens_mm": 50,
  "camera_motion": {"type": "dolly_in", "axis": "z", "amount": "0.8m"},
  "blocking": "人物、道具和相机的空间关系",
  "screen_direction": "A看向画面右，B看向画面左",
  "composition": "三分构图，双人过肩关系",
  "lighting": "窗侧柔光，负补光，背景实用灯",
  "color": "暖中性色，肤色自然，阴影微冷",
  "continuity": ["杯子在A右手", "上一镜A看向画面右"],
  "references": [{"asset_id": "char-A", "role": "identity"}],
  "generation_mode": "omni_reference",
  "duration_seconds": 6,
  "sound": {"dialogue": true, "ambience": "咖啡馆", "sfx": ["杯子落桌"]},
  "acceptance": ["A完成端杯到放杯动作", "B身份一致", "相机前推而非数码变焦"]
}
```

## 12. Nomi 实施优先级

### P0：先做，能直接改善当前工作流

1. 统一 `shot_spec`，把“电影意图”和“Provider prompt”分开保存。
2. 建立 Sora/Veo/Seedance/Runway/Luma/MiniMax/Vidu 的能力矩阵和 prompt 编译器。
3. 每镜生成前自动选择：T2V、首帧、首尾帧、全能参考、主体参考或视频参考。
4. 引入不可重复提交的长任务状态机、成本预算和 revision 历史。
5. 用 OpenTimelineIO 串起分镜表、视频节点和最终时间线。
6. 加入 CineTechBench 分类 + VLM 动作/连续性验收 + 静态程度检测。

### P1：下一阶段

1. 借鉴 Storyboarder/DirectorsConsole/Blender 做独立 3D 导演台，输出真实相机参数和轨迹。
2. 借鉴 ViMax/Jellyfish 做 `asset-ready -> shot-ready -> render-ready -> accepted` 状态机。
3. 引入电影参考搜索连接器，只存元数据和用户授权资产。
4. 将 Blender 相机轨迹适配 CamI2V/CameraCtrl 类自托管 Provider；商业模型则编译成支持的镜头参数或文本。

### P2：研究型能力

1. 多镜头记忆与自动一致性修复（JoyAI-Echo、Stable Video Infinity）。
2. 多主体参考生成（Kaleido）和动画角色 360 度（AniSora）。
3. 本地 VBench/T2V-CompBench GPU 评测和模型自动路由。

## 13. 明确不建议

- 不把导演姓名直接当作“风格按钮”的唯一内容；应拆成可观察的景别、构图、镜头运动、焦段、布光、色彩、剪辑和表演规则。
- 不把 GitHub 上的提示词文件当成真实技能；技能必须有输入约束、结构化输出、Provider 映射、执行器和验收器。
- 不把受版权保护的电影帧、书籍正文或课程批量抓进 Nomi。
- 不把“代码开放”“权重可下载”“数据可用”和“可商用”混为一谈。
- 不让浏览器扩展以“没拉回结果”为理由重新提交视频生成请求。
