# Nomi 创作能力产品级验收

日期：2026-07-16，2026-07-17 更新
分支：`codex/nomi-codex-director-upgrade-20260705`
基线：`cd9ab865e8a87acef23e7ac1f84c7e37f1aa159a`
状态：`PARTIAL / BLOCKED`，继续停留在 Gate 8

## 结论

本轮已把原有“配方技术切片”补成可见、可配置、可诊断、可回滚、可做成本确认并能进入 Blender 的产品工作流。确定性质量检查、Electron UI、性能、旧项目兼容、版本回滚、进程清理和真实 Blender 空间关系均有可重复证据。VIBING Director 新增 Kenney Furniture Kit 开源资产目录，能在画面内中文搜索 140 个 GLB，首次导入下载约 5 MB 官方包并校验固定 SHA-256，后续复用缓存；每个项目资产保存来源页、许可页、包版本、包哈希和文件哈希。自定义机位现在会核对机位槽位、独立单帧封装、空图、尺寸、重复画面和中心主体漂移；九宫格 `grid9-local-v2` 与自定义机位 `custom-view-local-v2` 共用中心区域复合检查，对感知结构、颜色、纹理和对比度建立稳健基线，仅在至少两类信号同时异常时标记具体机位。该复合代理能发现“背景相同但中心主体已更换”的明显漂移，同时明确不能证明人物/物体身份或三维几何一致。图像风格迁移会读取源图、结果图和风格参考图，分别报告画幅保留、内容结构保留和向参考视觉签名靠近的程度，并明确这些指标不能替代语义风格人工验收。视频配方现在会在生成结果落盘后自动读取编码、时长、尺寸、画幅、黑帧和冻结占比；v2v 还会比较源视频与结果视频的时长和冻结变化，不再把“返回了视频 URL”当成时序质量通过。全景、风格、视频与 3D 质量评测现在共用素材地址失败关闭规则：仅有 `type`、旧后处理元数据或旧 GLB 校验摘要，而没有当前素材地址时，结果完整性必须失败，且不会把伪结果继续送进像素、FFmpeg 或结构检查器；图像可用 `thumbnailUrl` 兜底，视频与 3D 则必须保留真实 `url` 或 `providerUrl`，缩略图不能冒充视频或 GLB。AGNES 免费/default 通道新增双层提交控制：Renderer 提前排队并显示等待时间，Electron 在真实 vendor 出口用持久台账做权威预约，GUI、RPC、MCP 和一次性 headless CLI 不能通过并发或重启绕过限制。

多视角质量链新增独立的批量语义比较契约，把“中心像素连续性代理”“主体语义身份”“主体三维几何一致性”拆成三项证据。九宫格和自定义机位只调用一次批量比较器；比较器缺失、异常、漏回机位或未检测到来源主体时，语义项必须显示 `unavailable` 或 `warning`，不能沿用像素代理的 `pass`。比较器返回明确拒绝时，身份和几何分别标记精确机位。产品现已接入用户触发的生产视觉复核适配层：仅列出已连接且支持图片输入的文本模型，来源图和全部已落盘机位在一次禁用工具的隔离对话中批量发送，响应必须是结构化 JSON；执行前显示明确的文本模型额度确认，报告记录 evaluator 与 token 用量。远程临时 URL、输出截断、无效 JSON 和字段缺失均失败关闭。根据火山引擎官方多模态契约，Nomi 已补充识别 Doubao Seed 2.0 Pro/Lite；当前真实目录的 10 个可执行文本模型中有 2 个视觉复核候选。隔离 Electron 已证明模型可选、打开报告不自动调用、点击复核后先确认一次批量请求和十张本地图片；本轮没有获批发起真实模型调用，因此真实语义身份或几何结果仍未产生。

模型目录现在严格区分“仓库内置模型定义”和“供应商已经连接且可执行”。未连接 KIE 或 RunningHub 时，HappyHorse 和图生 3D 模型不会再被误算为可用；缺模型的配方仍可选择，并在抽屉中直接显示 KIE HappyHorse `video-edit` 或 RunningHub Enterprise-Shared 的接入指引。供应商保存后触发目录变更事件，当前抽屉会原位刷新，不要求重启应用。能力核 CLI 此前只过滤 `model.enabled`，会把断开供应商的种子模型错误暴露给外部 Agent；现已与 catalog 健康检查共用供应商可执行判定。当前运行态 `nomi.mjs models` 返回 20 个模型，KIE/RunningHub 误暴露数为 0。

Codex、Claude Code 和 Cursor 的 MCP 接入现在不再把“存在一个 `nomi` 配置块”直接当成当前版本已接入。主进程会同时核对 Electron 可执行文件、源码仓库参数和 `NOMI_MCP_STDIO=1`；指向旧 checkout 的条目显示“需更新”，一键更新仍先备份并只替换 `nomi` 条目，不覆盖其它 MCP server。当前机器的 Codex 与 Claude Code 配置已从 `/Users/huawuer/Projects/Nomi` 迁移到本改造版，分别保留独立备份；已运行的旧 stdio 子进程不会被当作第二个 GUI 或被强杀，客户端下次重启后按新配置启动。GUI 能力核广告的退出清理也改为仅删除当前 PID 自己写入的 `instance.json`，旧实例退出不能抹掉仍在线的新实例。

RunningHub 的混元 3D、HiTem3D 与 Meshy 6 请求和轮询映射此前已经存在，但结果归一化仍有两个生产缺口：当上游把预览 PNG 放在 `results[0]` 时，预览会被错误标成 `model3d`；3D 任务还沿用普通图片的 2 分钟硬超时。当前 3D 专用响应变换只接受 `fileType`/MIME 明确为 GLB 或 URL 以 `.glb` 结尾的结果，预览图可保留为 Renderer 备选但不能冒充模型；没有 GLB 时明确失败关闭。文生/图生 3D 现在与视频共用 5 分钟软超时、20 分钟硬超时和可找回任务语义，超时后只允许继续查询既有 task id，不会重复提交付费任务。

生成画布 Agent 现在明确知道何时先读取 `list_capability_recipes`，不会把图生视频、视频转视频、图片模型和 3D 交接混为一谈；配方、模型和资源 id 必须来自实时目录。分镜表每一行新增紧凑的创作能力菜单，可基于该镜的图片或视频节点直接打开统一能力抽屉，不再要求用户先在散乱画布中寻找节点。所有批量生成入口也已统一到非破坏版本语义：确认前画布零变化，确认后已有结果分叉为 V2/V3；若上下游同时重生成，新下游只读取新上游，原节点结果、模型设置和旧下游关系保持不变。

内置 Skill Playbook 不再只是 Agent 下拉项。左侧常驻入口已改为“能力组件”，打开后默认就是内置组件，而不是先落到空的“我的技能”；六个创作 Playbook 会展开为 11 张原子配方卡，九宫格、自定义机位、图片转 3D、全景、人像、身份、情绪、风格资源和视频效果均可独立点击或拖入画布。`brand.promo` 保留为多阶段工作流卡，不伪装成单次生成组件。每张原子卡只声明一个配方、准确的图像/视频/场景/多视角/3D 类型和可执行说明，创建后形成可持久化、可缩放的单配方 `SkillNode`，直接显示“配置并运行”。高级模型、参数、资源和费用确认继续复用统一能力抽屉，结果节点 id 仍追加回写；父 Skill 名称仅保留给 Canvas Agent 编排，不复制 Provider 执行逻辑。旧项目中的多配方 `SkillNode` 继续按原结构解析。独立“技能库”仍保留我的技能、导入、导出和 AI 新建，用于管理而不挤占画布组件入口。

每份自动质量报告现在都可独立记录“人工通过”或“人工拒绝”以及最多 500 字备注。人工记录进入项目持久化和画布撤销历史，只更新目标 collection，不覆盖自动 `status`、检查项、evaluator 或其它历史结果；只读项目能查看已有结论但不能修改。Electron 回归验证了自动 warning 与人工拒绝同时存在、撤销后恢复未复核、再改为人工通过，并从落盘项目读回备注。该记录为人工视觉验收证据，不能替代尚未执行的 Provider smoke，也不能把自动失败改写为自动通过。

即梦两条执行路径现已按真实边界拆开。即梦 CLI 的 `multimodal2video` 保留最多 9 张图片、3 段视频和 3 段音频参考；即梦 Web 使用独立 `jimeng-web-seedance-2` 档案，只显示外部扩展实际接受的图片和视频参考、Fast/Standard 变体，不再显示 Web 不会传输的音频、1080p、VIP 或 Mini 选项。Web bridge 会按图片/视频类型读取本地、data URL 或受限远程素材，分别编号并保留 MIME；旧节点若仍提交音频，会明确引导改用 CLI，而不是静默丢弃。这里的“视频参考”只用于引导生成，不等于保留源动作和时序的 `source_video` 视频编辑，因此两个真正 v2v 配方继续保持阻塞。

本轮不能判为全部完成，原因不是本地代码失败，而是仍有四类外部前置条件未满足：

1. 九宫格、全景、人像、情绪、风格和视频配方尚未逐项执行新的付费 Provider 输出；本轮遵守零付费调用策略。
2. 当前没有已连接且声明 `source_video` 的视频转视频模型。
3. 当前没有已连接的真实图生 3D Provider；已通过的是 Provider-like GLB 下游闭环。
4. 当前已有 Doubao Seed 2.0 Pro/Lite 两个图片输入候选，但尚未获批执行多视角视觉复核；因此仍没有真实语义身份或几何输出证据。

两个原 Mixamo 兼容 GLB 已由项目自制的程序化人偶、骨架和 walk/run 动画替换，随包资产许可阻塞已解除。第一方人偶的脚掌/脚趾和前臂/手掌/指端均改成连续蒙皮，并加入跨骨连接面的回归门禁；它仍是导演台低模预演替身，肘膝等关节分节不代表最终角色模型质量。Seedance 扩展原仓库仍无许可证，因此继续维持为用户自备外部依赖，不进入安装包。

因此：Gate 8 的本地产品底座和随包资产许可门禁已通过，真实 Provider 全覆盖仍阻塞；不进入 Gate 9。

## 验收矩阵

| 能力 | 状态 | 已验证 | 未完成或阻塞 |
| --- | --- | --- | --- |
| 源码测试入口与 feature flag | PASS | 源码运行自动可见；生产默认关闭；工具栏入口稳定；E2E 不再靠临时 localStorage 开关 | 正式发布仍需单独审批 |
| CLI/Agent 可执行模型目录 | PASS | 模型启用且供应商启用，并满足有密钥或免鉴权时才暴露；临时 catalog 红绿回归覆盖免鉴权、有密钥、缺密钥、供应商禁用和模型禁用；当前运行态返回 20 项，未连接 KIE/RunningHub 为 0 项 | 供应商连接状态变化后仍需按当前目录实时刷新 |
| 外部 Agent/MCP 版本绑定 | PASS | Codex/Claude/Cursor 配置按可执行文件、仓库参数和 stdio 环境精确匹配；旧 checkout 标记“需更新”，更新只替换 `nomi` 条目并保留其它 server；当前 Codex 与 Claude 配置已迁移并备份；GUI 广告按 owner PID 清理 | 已运行的 Codex MCP 子进程需在客户端重启后才切到新配置，这是 stdio 客户端生命周期，不做运行中强杀 |
| 自定义机位 | PARTIAL | 单帧契约、每机位参数、禁拼贴提示、费用与并发；`custom-view-local-v2` 自动检查槽位契约、图片完整性、空图、尺寸、重复视角、中心主体复合漂移和独立单帧封装；可由用户选择已连接视觉文本模型，一次批量复核身份与几何并记录 token；已有一次 Codex Img2 真实成功输出；当前 Doubao Seed 2.0 Pro/Lite 已进入复核候选 | 需要按当前最终代码再跑多机位付费样本；真实方位角、语义身份与几何仍未执行模型验收 |
| 九宫格多视角 | PARTIAL | 1 次 Provider 请求、9 张本地拆分；顺序、空图和重复代理检查；`grid9-local-v2` 以中心区域感知结构、颜色、纹理和对比度做复合漂移预警；生产适配层把来源与九机位一次批量送入用户选择的视觉文本模型，身份与几何分项回写；Doubao Seed 2.0 可选且发送前费用确认已验证 | 尚无本轮保留的付费九宫格输出；尚未获批执行真实 Doubao 视觉复核，确定性响应只验证适配层、结构化解析与失败关闭契约 |
| 2:1 全景 | PARTIAL | 精确比例、原图/规范化图分离、左右接缝、极点风险、投影可用性报告与 UI；结果地址缺失时失败关闭且不运行伪像素检查 | 尚无本轮真实 Provider 全景输出 |
| 人像真实化与肤质 | PARTIAL | 非破坏版本、原图/结果同步对比、肤质与伪影检查、身份指标不可用时明确标记“未验证” | 尚无本轮付费人像结果；没有本地身份模型时不能声称身份已通过 |
| 5x5 情绪矩阵 | PARTIAL | 25 坐标、能量/亲和轴、请求数、并发上限、结果矩阵与表情区分代理 | 尚未按“先小子集、再 25 格”执行付费验证 |
| 图像风格与资源 | PARTIAL | 风格/色板资源、来源、许可、署名、商用状态；必需资源未选时执行前阻断；生成后报告画幅、内容保留和风格移动代理；无素材地址时结果完整性失败且不把伪结果送进像素检查 | 尚无本轮真实风格迁移输出；本地视觉签名不能代替语义风格人工验收 |
| 图生视频视觉风格/效果 | PARTIAL | 与 v2v 分离命名；i2v 兼容模型目录、输入契约、费用确认；结果节点自动附加编码、时长、尺寸、画幅、黑帧和冻结占比报告；无素材地址时不运行媒体探测；AGNES 视频按 1 RPM 在 Renderer 预排队并由 Electron 持久化权威限流 | 尚未执行新的付费视频输出；本地技术检查不能代替视觉风格/效果人工验收 |
| 即梦 CLI/Web 参考素材 | PARTIAL | CLI 支持图/视频/音频参考；Web 使用独立受限档案并类型化传输图/视频，音频显式引导到 CLI；真实目录与画布模型契约由 91 项 Electron 验收覆盖 | 本轮未获批执行 Web 真实提交；视频参考不能作为 `source_video` v2v 证据 |
| 视频转视频视觉风格/效果 | BLOCKED | UI/Agent 只在模型声明 `source_video` 和 edit intent 时暴露；已实现源/结果时长保留与冻结增量比较；未连接时可选择配方并直接看到 KIE HappyHorse `video-edit` 接入指引 | 零个已连接兼容模型，真实 v2v 无法执行 |
| 图像到 3D | PARTIAL | RunningHub 混元 3D/HiTem3D/Meshy 6 请求与轮询映射；混合预览+GLB 响应只选 GLB，预览-only 明确失败关闭；3D 使用 5 分钟软/20 分钟硬可找回窗口且不重提任务；独立检查当前 GLB 素材地址，再执行 magic/版本/网格/材质/bounds 校验；Scene3D/Blender 导入、变换修改、`.blend`、预览、GLB 回传；未连接时显示 Enterprise-Shared 接入要求 | 上游真实图生 3D Provider 未连接 |
| VIBING Director UI | PASS | 独立全屏工作区、Agent 面板、可交互 3D、Blender 渲染预览、紧凑布局、历史结果回滚；Kenney 140 个 GLB 支持中文搜索和一键导入 | 最终零付费轮次未再次调用真实对话 Provider |
| Blender 空间关系与资产 | PASS | 视觉复核先发现旧检测只验证位置、漏掉两把椅子与角色各 38.66° 的朝向偏差；红测从真实 `.blend` 复现后，`offset` 改为完整相对位姿并在 `facing` 后应用。最终承托间隙 0m、角色距离 2.5m、椅子位置与朝向误差均 0、角色互相朝向误差 0.014°；44 meshes / 51 nodes；远程包主机、体积、SHA-256、ZIP 条目和 GLB 校验受控，导入资产保留 CC0 provenance | Poly Haven/Quaternius/BlenderKit 暂保留手动导入，不伪装成机器目录；低模场景只验收 blockout 与空间关系，不代表最终资产质量 |
| 第一方导演台人偶 | PASS | 原创程序化几何/骨架/动作；左右鞋楦与手套拓扑连续；13 个发布姿态 0 个 P0/P1；31 场景 × 6 视角全部落地并通过结构检查 | 定位为低模预演替身，肘膝关节分节不是最终角色质量 |
| 画布能力组件 | PASS | 左侧“能力组件”默认展示 11 个原子配方组件和独立品牌工作流；每张卡只对应一个配方并准确区分图像、视频、多视角与 3D Provider 类型；点击或拖放创建单配方 `SkillNode`，直接“配置并运行”；模型设置、资源预选、输出追加回写和 Canvas Agent 复用统一链路；旧多配方快照继续解析 | 高级参数仍在统一抽屉中，真实付费执行仍受各能力的 Provider 阻塞约束 |
| 画布、分镜和 Agent 集成 | PASS | 共享配方控制器、共享费用确认、结果集合、资源节点、分镜行图片/视频直达能力入口、Agent 配方路由规则、旧快照规范化 | 真实 Provider 阻塞项同上 |
| 人工视觉验收记录 | PASS | 单结果与多结果质量报告均可独立记录通过/拒绝和备注；项目持久化、只读展示、清除和撤销通过；人工结论不改写自动状态与检查项；旧项目无字段继续解析 | 人工结论是人工证据，不能替代 Provider 输出、视觉模型语义复核或自动技术检查 |
| 非破坏重生成与回滚 | PASS | 单节点、批量设置、框选批量、分镜批量和 Agent 批量均在确认后创建新版本；版本链内部依赖重接到 V2/V3，不覆盖旧结果、旧参数或旧下游；Director 回滚恢复节点状态、预览和关系数量 | 无 |
| 隐藏节点资源释放 | PASS | 收纳的 model3d/video 不挂载 live canvas/video；避免隐藏 Three.js/媒体持续占用 | 无 |
| 画布性能 | PASS | 96 节点/156 边/20 clip：pan 57.6 FPS、zoom 58.8 FPS、timeline 57.5 FPS；自动阈值通过 | pan 仍出现 1 个 124ms 长任务，低于 500ms 总预算但可继续分析 |
| 子进程生命周期 | PASS | Codex 临时目录清理、活动子进程注册表清理、Jimeng 服务 SIGTERM 后超时 SIGKILL、E2E 强制退出兜底 | Jimeng 为复用 Cookie 保持常驻，只有显式停止或 App 退出才关闭，这是设计行为 |
| 许可证与来源 | PASS | 原 Mixamo 兼容 GLB 已删除；第一方 `nomi-mannequin` 模型和动作由可重复 Blender 脚本生成并按 Apache-2.0 分发；Seedance 保持外部路径、不随包分发 | 正式发布仍需 Gate 9 和发布审批 |

## 最终验证

### 仓库门禁

`pnpm gates` 最终通过：

- 文件体积：同时扫描已跟踪和未跟踪但未忽略的源码，共 897 个文件；800 行上限，巨壳白名单 0。此前新文件不受门禁覆盖的缺口已关闭。
- 设计令牌：4 类违规均为 0。
- 悬空令牌：扫描 849 文件、172 个 token，无悬空引用。
- 敏感信息：扫描 1969 个 tracked 文件，无私有配置或聊天数据库泄露。
- Lint：0 errors，98 warnings，未超过既有上限 98。
- TypeScript：Renderer 与 Electron 均通过。
- Vitest：360 files passed，2 skipped；3120 tests passed，4 skipped。
- Renderer production build 与 Electron build 均通过。
- `.claude/.gates-ok` 已更新。

2026-07-17 CLI 目录与隔离退出修复的增量验证：

- 8 个相关测试文件、49 项测试通过；覆盖能力核、catalog 迁移/只读保护、GUI 可用供应商过滤、smoke 策略和 Electron 隔离夹具。
- `pnpm lint:ci` 通过：0 errors，98 个既有 warnings，未超过棘轮。
- Renderer 与 Electron 全量 TypeScript 检查通过，Electron build 通过。
- 文件体积门扫描 904 个源码文件，800 行上限、巨壳白名单 0；敏感信息门扫描 1969 个 tracked 文件，无泄漏。
- 最终报告不变量通过：`paidEvaluation=false`、`providerCalls=0/0`、8 项可检查、3 项阻断、优雅退出、子进程与临时目录残留均为 0。

2026-07-17 MCP 版本绑定与当前运行态复核：

- 红测证明 JSON 与 Codex TOML 中只要存在 `nomi` 条目，旧实现就会错误显示“已接入”；无配置时也没有“当前/过期”状态。
- 修复后按 command、args 和 `NOMI_MCP_STDIO` 精确判定 `installed`，旧条目返回 `stale=true` 并显示“需更新”；再次安装原位替换旧 Nomi 路径，保留其它 MCP server 和写前备份。
- 能力核广告清理按 owner PID 比较后删除，旧 GUI 实例不能删除新 GUI 的活动广告。后台 `NOMI_MCP_STDIO=1` 进程被正确识别为 Agent transport，不冒充第二个可见 Nomi。
- 能力核/MCP 聚焦回归 4 个文件、30 项测试通过；Electron TypeScript、聚焦 ESLint 和 Electron build 通过。
- 当前机器的 Codex、Claude Code 配置已指向 `/Users/huawuer/Projects/Nomi-codex-director-upgrade`，其它 Claude MCP server 保留 6 个；配置备份未写入仓库。
- 新一轮当前用户目录零费用 smoke：8 项 `inspection_passed`，v2v 2 项与图生 3D 1 项结构化阻断，`providerCalls=0/0`、无 page error；隔离 Electron `appClosed=true`、`forcedKill=false`、退出码 0，临时 Codex home、派生子进程和临时根目录残留均为 0。证据：`evals/runs/2026-07-17T12-47-45Z-capability-recipes-live-single-instance/`。
- smoke CLI 新增前置 `-h/--help` 分支。红测先复现帮助参数继续执行的缺口；修复后 11/11 策略测试通过，实测不创建显式 run-dir、不创建 smoke 临时根目录且不启动 Electron。
- 本轮收口复核通过官方 `pnpm typecheck`、production Renderer/Electron build、0 errors / 98 warnings lint 棘轮、915 个源码文件体积门、1969 个 tracked 文件密钥门、档案默认值与第三方资产审计；全量 Vitest 为 374 个文件通过、2 个跳过，3201 项通过、5 项跳过。能力组件 Electron E2E 为 96/96，无 page error、无 Provider 调用。

2026-07-17 素材地址失败关闭的增量验证：

- 新增红测前，全景、风格和带旧校验摘要的 GLB 在结果地址缺失时仍会整体显示 `pass`；视频会继续调用媒体探测器并把“视频结果”显示为通过。四条回归均先失败，证明缺口可复现。
- 修复后，全景、风格、视频和 3D 共用类型化素材地址判定；图像允许缩略图兜底，视频与 3D 只接受真实媒体/GLB 地址。无地址或只剩海报缩略图时结果完整性为 `fail`，像素、视频或 GLB 结构检查不再使用残留元数据伪造通过结论。
- 3D 报告新增 `model3d-output` 检查。历史结果有地址但没有结构摘要时，地址检查通过、四项结构检查为 `unavailable`，整体不会显示通过；地址丢失但摘要残留时整体失败。
- 质量模块、配方控制器和结果集合共 4 个测试文件、42 项测试通过；全仓 Lint 为 0 errors / 98 个既有 warnings；Renderer 与 Electron TypeScript、生产 Renderer build 和 Electron build 均通过。
- 文件体积门扫描 904 个源码文件，800 行上限、巨壳白名单 0；敏感信息门扫描 1969 个 tracked 文件，无泄漏。
- 零 Provider 确定性评测 10/10 用例、51/51 断言通过，包含类型化素材地址与旧 GLB 摘要失败关闭契约，`providerCalls=0`。证据：`evals/runs/2026-07-17T08-23-21Z-capability-recipes-quality-regression/`。

2026-07-17 多视角中心主体漂移的增量验证：

- 红测先构造九张整图平均颜色完全相同、但“背面”中心主体在感知结构、颜色、纹理和对比度上同时突变的集合；旧实现把它误判为 `pass`、`visualOutlierCount=0`，证明整图颜色代理存在真实漏检。
- `grid9-local-v2` 改用中心区域感知哈希 medoid、逐通道颜色中位数、纹理和对比度中位数作为稳健基线；至少两类信号同时越界才预警，具体异常机位写入 `itemIds`。中心采样缺失的旧结果继续使用明确标记的整图颜色降级路径。
- 正常九视角测试真实进入 `center-composite` 路径并保持 `pass`；同背景换主体测试返回 `warning`、`itemIds=["rear"]`、`visualOutlierCount=1`。自定义机位报告也接入同一检查链，正常三机位保持 `pass`，漂移样本定位 `itemIds=["camera-b"]`。
- 质量、后处理、控制器、结果集合和人像身份模块共 5 个测试文件、53 项测试通过；Renderer 与 Electron TypeScript、生产 Renderer build 和 Electron build 均通过。
- 全仓 Lint 为 0 errors / 98 个既有 warnings；文件体积门扫描 905 个源码文件、800 行上限、巨壳白名单 0；敏感信息门扫描 1969 个 tracked 文件无泄漏；第三方资产审计 0 个 release blocker。
- 零 Provider 确定性评测 11/11 用例、57/57 断言通过，新增同背景中心主体漂移失败关闭、自定义机位真实检查链与“不冒充语义身份/几何验证”断言，`providerCalls=0`。证据：`evals/runs/2026-07-17T08-42-07Z-capability-recipes-contract/`。

2026-07-17 多视角语义身份与几何失败关闭的增量验证：

- 红测先证明九宫格和自定义机位在没有语义比较器时仍会显示整体 `pass`，且控制器完全没有调用传入的批量比较器；缺口覆盖到质量函数、自定义机位和真实配方控制器三层。
- 新增 provider-independent `MultiviewSubjectComparator` 批量契约：一次接收来源图和全部可读机位，比较器自身拥有模型与阈值，Nomi 只负责映射结果、保存 evaluator、统计最低分和精确失败机位。身份与几何使用独立布尔结论，分数只作证据，不由 Nomi 重复猜阈值。
- 没有比较器、比较器抛错、来源主体未检出、某机位漏回或没有明确布尔结论时均失败关闭；部分机位可比较时为 `warning`，全部不可比较时为 `unavailable`。生成结果继续保留，不因质量检查失败被删除。
- 质量、后处理、控制器、结果集合和人像身份模块共 5 个测试文件、59 项测试通过；全量 TypeScript 通过；全仓 Lint 为 0 errors / 98 个既有 warnings；Renderer 与 Electron 生产构建通过。
- 文件体积门扫描 906 个源码文件、800 行上限、巨壳白名单 0；敏感信息门扫描 1969 个 tracked 文件无泄漏；第三方资产审计 0 个 release blocker。
- 零 Provider 确定性评测 12/12 用例、65/65 断言通过；新增“像素代理不能冒充语义通过”“九机位只批量比较一次”“背面身份失败与俯视几何失败精确分离”断言，`providerCalls=0`。证据：`evals/runs/2026-07-17T09-07-55Z-capability-recipes-contract/`。

2026-07-17 多视角视觉模型生产适配层的增量验证：

- 用户必须在质量报告中主动选择已连接、已声明支持图片输入的文本模型并确认一次文本模型额度；打开报告不会自动调用模型。
- 适配层只接受已落盘 `nomi-local://` 来源图和结果图，使用独立 session、禁用 Agent 工具并显式钉住供应商与模型。来源图固定为附件 1，全部机位按稳定顺序跟随，一组集合只发送一次请求。
- 模型输出达到长度上限、没有有效 JSON、漏回机位、字段类型错误或证据不足时均不能猜测通过；回写只替换身份与几何两项，保留原有像素、尺寸和连续性检查。
- 自定义 Provider 新增“支持图片输入（用于视觉复核）”声明；显式模型元数据优先于模型名猜测，未声明的普通文本模型不会出现在复核下拉中。
- 视觉复核专项 5 个测试文件、13 项测试通过；原有质量、后处理、控制器、结果集合和人像身份集成共 5 个文件、59 项测试通过。Renderer/Electron TypeScript、聚焦 Lint 和生产 Renderer/Electron build 均通过。
- 零 Provider 确定性评测 13/13 用例、73/73 断言通过；生产适配层用模拟多模态响应验证单次批量、附件顺序、显式模型、禁用工具、token 记录和远程素材提交前阻断，`providerCalls=0`。证据：`evals/runs/2026-07-17T09-39-58Z-capability-vision-review-contract/`。
- 画布组件配方级绑定与 UI 共 4 个测试文件、16 项测试通过；覆盖图片、视频、3D、文字、风格/色板、身份和效果资源的缺失、错误类型与就绪判定。Renderer/Electron TypeScript、聚焦 Lint 和生产构建通过。

2026-07-17 Doubao Seed 2.0 视觉复核接入的增量验证：

- 火山引擎官方资料确认 Doubao Seed 2.0 Pro/Lite/Mini 为多模态通用模型，并支持图片、视频与文本理解；旧检测器只识别 GPT、Claude、Gemini、Qwen-VL 等名称，导致已连接的豆包模型被误报为不可用。
- Renderer 与 Electron 统一识别 `doubao-seed-2.0-lite`、版本化 `doubao-seed-2-0-pro-*` 和 `Doubao Seed 2.0 Pro` 别名；显式 `supportsImageInput=false` 仍优先，旧 Doubao Seed 1.6 不被扩大推断。
- 红测在能力检测、附件门控和视觉复核模型列表三层按预期失败；修复后 3 文件 16/16 通过。Renderer/Electron TypeScript、聚焦 Lint和生产构建通过。
- 当前主 Nomi 只读目录有 10 个可执行文本模型，其中 Doubao Seed 2.0 Lite/Pro 两个进入视觉复核候选。
- 隔离 Electron 90/90 通过，无 pageerror；质量报告显示 Doubao Seed 2.0 Lite，打开报告不自动调用，点击复核后先显示一次批量调用与十张本地图片，取消后 0 Provider 提交。证据：`evals/runs/2026-07-17T11-45-14Z-doubao-vision-review/`。

2026-07-17 图片到 3D 结果契约的增量验证：

- 三组回归先按预期失败：RunningHub 把第一张预览 PNG 标成 `model3d`；Renderer 把预览设为主结果；3D 没有独立长任务轮询策略。红测证明缺口来自真实生产路径而非测试桩。
- 3D 查询增加专用、具名响应变换；共享 RunningHub 图片/视频查询保持不变。混合响应只映射 GLB，preview-only 成功响应不再产生伪模型资产。
- Renderer 对 `image_to_3d` / `text_to_3d` 优先选 `model3d` 类型资产；没有 GLB 时错误明确为“3D 模型任务完成但没有返回 GLB 模型地址”，不会退回图片结果。
- 文生/图生 3D 与视频共用 5 分钟软超时和 20 分钟硬超时。既有 `RecoverableTimeoutError`、task id 和免费查询恢复链保持不变，不会因超时重新下单。
- 聚焦测试 3 文件 9 项通过；跨任务轮询、runtime 资产、GLB 校验和 Scene3D/Blender 交接集成 7 文件 145 项通过。Renderer/Electron TypeScript、聚焦 Lint、生产构建、文件体积和敏感信息门均通过。
- 隔离 Electron 84/84 通过，无 pageerror，0 Provider 调用；组件、质量报告和双击预览截图经人工检查无重叠。证据：`evals/runs/2026-07-17T10-19-57Z-image-to-3d-result-contract/`。

2026-07-17 画布原子能力组件的增量验证：

- 红测先证明多视角被归为普通图片组件、内置 Playbook 没有原子展开函数；第二组红测证明单配方节点仍重复展示配方行，缺少直接“配置并运行”动作。
- 六个内置创作 Playbook 现展开为 11 张原子配方卡，`brand.promo` 保持工作流卡。原子卡只携带一个配方，并按图片、视频、多视角和 3D 精确显示 Provider 类型。
- 点击或拖放原子卡会创建单配方 `SkillNode`；父 Skill 名称只用于 Canvas Agent 路由，模型、参数、资源、费用确认和 Provider 执行继续复用统一能力链。旧多配方快照保持兼容。
- 组件与节点聚焦覆盖 47/47 通过，最终直接动作回归 6/6 通过；Renderer/Electron TypeScript、聚焦 Lint、生产构建、文件体积和敏感信息门均通过。
- 隔离 Electron 88/88 通过，无 pageerror，0 Provider 调用；能力面板和原子节点截图经人工检查无不合理重叠。证据：`evals/runs/2026-07-17T10-30-00Z-atomic-canvas-components/`。

2026-07-17 即梦 Web 图片/视频参考传输的增量验证：

- 红测先证明混合图片/视频输入只留下图片，视频被静默丢弃；第二条红测证明音频也会静默继续。修复后 bridge 按媒体类型收集、去重、读取并限制格式/体积，音频在 Web 路径立即返回 CLI 指引。
- 新增 `jimeng-web-seedance-2` 受限档案；即梦 Web 种子迁移到该档案，CLI 档案继续保留图/视频/音频完整能力。Web 不再暴露不会传输的音频、1080p 或 CLI 专属变体。
- 跨 bridge、catalog、CLI 进程参数、画布档案输入和 Agent 模型目录的 8 个测试文件、283 项测试通过。生成默认参数门岗先发现新档案缺少 wire defaults；重生成 41 个档案后门岗通过，相关回归 144/144。
- Renderer/Electron TypeScript、聚焦 ESLint、production build、文件体积、敏感信息、第三方资产和 diff 检查通过。隔离 Electron 91/91，无 pageerror、0 Provider 调用，并从真实主进程目录确认模型指向受限档案。证据：`evals/runs/2026-07-17T12-09-28Z-jimeng-web-video-reference-catalog/`。

2026-07-17 即梦 Web 图片生成通道的增量验证：

- 新增独立模型 `即梦 Web 图片（实验）`，不再借用视频模型；支持文生图和最多 10 张参考图的改图，参数只暴露当前页面可可靠映射的画幅比例。
- Nomi 主进程按任务类型进入图片或视频 bridge；图片结果按 MIME 识别并写回图片资产，视频链路保持不变。
- 外部 companion 将图片任务切到 `/ai-tool/image/generate`，支持图片结果定位、下载、上传和任务完成回传；Web 队列串行执行，避免图片页和视频页互相导航导致任务停滞。
- 聚焦 Nomi 39/39、companion 8/8、全量 Vitest 3209 项通过且 5 项跳过；类型、档案默认值、文件体积、敏感信息和第三方资产检查通过。
- 隔离 Electron 98/98，无 pageerror、0 Provider 调用。测试确认真实目录存在图片模型，并证明图片任务到达图片 runtime 后在费用保护处停止，没有向 companion 或即梦网页提交。证据：`evals/runs/2026-07-17T14-24-29Z-jimeng-web-image/`。

### Electron 与视觉证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 基础 Electron smoke | 10/10 | `pnpm test:e2e` |
| 当前用户模型目录零费用 smoke | 8 项 `inspection_passed`，v2v 两项与图生 3D 精确阻断；0/0 Provider 调用，无 page error；优雅退出且无进程/临时目录残留 | `evals/runs/2026-07-17T16-10-00Z-capability-recipes-final-zero-spend/` |
| 当前运行态与 MCP 迁移后零费用 smoke | 8 项可检查、3 项精确阻断；0/0 Provider 调用；`appClosed=true`、`forcedKill=false`、退出码 0；主 Nomi ping 保持成功 | `evals/runs/2026-07-17T12-47-45Z-capability-recipes-live-single-instance/` |
| 当前能力组件 Electron E2E | 96/96；内置原子组件、SkillNode 连线、配置抽屉、质量报告、人工通过/拒绝/撤销/持久化、视频预览、模型接入刷新和 3D 阻塞提示通过；无 page error、0 Provider 调用 | `evals/runs/2026-07-17T13-12-10Z-capability-human-review-e2e/` |
| 隔离能力核与优雅退出回归 | 单项 smoke PASS；`appClosed=true`、`forcedKill=false`、退出码 0；隔离实例退出前后主实例端点均为 `127.0.0.1:62143`；临时 Codex home、派生子进程、临时根目录残留均为 0 | `evals/runs/2026-07-17T16-08-00Z-capability-graceful-cleanup-regression/` |
| 配方质量失败关闭与确定性契约 | 地址缺失四类回归通过；相关 42 项测试通过；确定性评测 10/10 用例、51/51 断言；0 Provider 调用 | `evals/runs/2026-07-17T08-23-21Z-capability-recipes-quality-regression/` |
| 多视角中心主体复合漂移 | 旧整图颜色代理漏检红测成立；`grid9-local-v2` 与 `custom-view-local-v2` 正常集合通过，分别定位漂移的 `rear` 与 `camera-b`；相关 53 项测试与 11/11 用例、57/57 断言通过；0 Provider 调用 | `evals/runs/2026-07-17T08-42-07Z-capability-recipes-contract/` |
| 多视角语义身份与几何契约 | 无比较器/异常/漏回均失败关闭；完整比较器九机位单次批量通过；身份 `rear` 与几何 `top` 精确分离；相关 59 项测试与 12/12 用例、65/65 断言通过；0 Provider 调用 | `evals/runs/2026-07-17T09-07-55Z-capability-recipes-contract/` |
| 多视角视觉模型复核入口 | 80/80，无 pageerror；当前无视觉文本模型时显示明确接入说明和“去模型接入”，打开质量报告不自动弹费用确认或调用 Provider；复核浮层截图无重叠 | `evals/runs/2026-07-17T09-43-59Z-capability-vision-review-e2e/` |
| Doubao Seed 2.0 视觉复核候选 | 90/90，无 pageerror、0 Provider 提交；当前目录 Lite/Pro 两个模型被正确识别；隔离 UI 中 Lite 可选，打开报告不自动调用，主动点击后先显示一次批量调用和十张本地图片，取消后不发送 | `evals/runs/2026-07-17T11-45-14Z-doubao-vision-review/` |
| 创作配方 UI、质量、分镜直达与模型接入引导 | 67/67，无 pageerror；分镜节点事件可直开对应能力抽屉；风格和视频质量报告可展开；真实本地 MP4 检出 31% 冻结占比；KIE/RunningHub 缺接入提示可见 | `evals/runs/2026-07-16T19-19-13Z-capability-agent-storyboard-versioning-e2e/` |
| 画布能力组件补充回归 | 84/84，无 pageerror、0 Provider 调用；组件侧栏默认内置组件，多视角组件从侧栏创建到画布；连线前九宫格显示“缺图片”并禁用，真实拖线后原位显示“已就绪”并启用；共享抽屉自动预选多机位九宫格和源图；其余创作配方全链路继续通过 | `evals/runs/2026-07-17T10-05-10Z-capability-component-readiness/` |
| 图片到 3D 结果契约 | 预览+GLB 只选 GLB，preview-only 失败关闭；3D 使用 5 分钟软/20 分钟硬可找回轮询且不重提任务；聚焦 9/9、集成 145/145、Electron 84/84，无 pageerror、0 Provider 调用 | `evals/runs/2026-07-17T10-19-57Z-image-to-3d-result-contract/` |
| 画布原子能力组件 | 88/88，无 pageerror、0 Provider 调用；11 个配方作为独立卡片，九宫格、自定义机位与图片转 3D 不再捆绑；点击或拖放创建单配方节点并直接“配置并运行”；旧多配方节点保持兼容 | `evals/runs/2026-07-17T10-30-00Z-atomic-canvas-components/` |
| 即梦 Web 图片/视频参考目录 | 91/91，无 pageerror、0 Provider 调用；主进程真实种子目录指向 Web 受限档案，跨层 283/283；Web 音频显式转 CLI，视频参考不冒充 v2v | `evals/runs/2026-07-17T12-09-28Z-jimeng-web-video-reference-catalog/` |
| 即梦 Web 图片生成通道 | 98/98，无 pageerror、0 Provider 调用；独立图片模型、文生图/参考图改图、图片页路由、图片结果回传和 Web 单任务串行契约通过 | `evals/runs/2026-07-17T14-24-29Z-jimeng-web-image/` |
| VIBING Director UI | 26/26，无相关 renderer error；非空且构图有效的 3D 预览、真实拖拽改视角、空间质量标记、Kenney CC0 目录与中文搜索、Blender 渲染预览、紧凑布局和历史回滚通过 | `evals/runs/2026-07-17T12-40-00Z-vibing-director-relative-transform-e2e/` |
| Kenney 官方资产包 | PASS；固定 SHA-256 匹配，成功提取真实 `kitchenCoffeeMachine.glb`，未把第三方二进制写入仓库 | `evals/runs/2026-07-17T15-15-00Z-kenney-catalog-real-smoke/report.json` |
| 第一方人偶视觉回归 | 31/31 场景、每场景 6 视角；186 张图；全部 grounded；0 个结构失败 | `evals/runs/2026-07-16T16-12-22Z-vibing-director-first-party-mannequin-final/report.json` |
| 真实性能 | 自动验收通过 | `evals/runs/2026-07-16T17-08-00Z-creative-capability-perf-accepted/report.json` |
| 真实 Blender 模型闭环 | 3-mesh、3-material Provider-like GLB 校验后导入，同一 `.blend` 内完成位置/旋转/缩放修改；回传 GLB 为 4 meshes / 5 nodes，预览为 960x540 | `evals/runs/2026-07-17T12-26-00Z-vibing-director-real-relative-transform-final/model3d/` |
| 真实 Blender 空间关系 | 初始视觉复核发现 38.66° 假通过；最终 `.blend` 读回两把椅子的位置和 yaw 误差均为 0，报告同时记录位置与朝向指标；3/3 真实 Blender 场景通过 | `evals/runs/2026-07-17T12-26-00Z-vibing-director-real-relative-transform-final/relations/` |

视觉证据已人工检查：

- 创作能力入口、质量报告和资源节点可见，抽屉未越界。
- 左侧创建工具栏与左下画布导航在较矮窗口中不再重叠，“创作能力”入口保持可点击。
- 九宫格与 5x5 情绪矩阵按固定网格显示。
- 全景报告明确展示比例、接缝、极点与投影检查，不把“生成成功”等同于“质量通过”。
- 风格迁移报告明确分开“内容保留代理”和“风格迁移代理”，结果未向参考靠近时显示需检查，不把提示词或资源连接当成风格已通过。
- 自定义机位生成后会附加独立质量报告；机位参数契约与像素差异可自动检查，真实方位角仍保留人工确认边界。
- 视频节点使用真实视频预览；质量报告显示 `1280x720 / 46.6 秒`、黑帧占比和真实 FFmpeg 冻结占比 `31%`，并明确把“风格与效果符合度”标记为需要人工或视觉模型评审。
- 未连接供应商的配方不再被禁用或伪装成可运行：v2v 显示 KIE HappyHorse 接入按钮，图生 3D 显示 RunningHub 与 Enterprise-Shared Key 要求。
- 分镜行通过图片/视频选择事件打开能力抽屉时会自动选中正确源节点，抽屉仍可正常关闭；Agent 提示词测试覆盖先查配方、禁止图片模型冒充视频模型和 GLB 回交规则。
- 左侧“组件”打开后默认选择“内置组件”，无需再切换来源；11 个原子配方按工作流、图像、视频、场景、多视角和 3D 显示专属图标与标签。九宫格、自定义机位和图片转 3D 是三张独立卡片，点击“添加到画布”或拖放都会创建各自的单配方 `SkillNode`。
- 单配方节点只显示当前能力和直接“配置并运行”动作；连接素材后统一抽屉继续核对输入、模型、参数、资源和费用。历史多配方节点仍按每条配方显示“缺图片”或“已就绪”，生成结果通过追加式 id 回写，不覆盖先前输出。
- 多视角质量报告会在原有本地检查下方显示视觉复核操作区；当前目录的 Doubao Seed 2.0 Lite/Pro 会进入模型下拉，打开报告不会自动触发额度确认。点击复核后先明确一次批量请求与本地附件数量，复核操作区与检查项、模型入口均完整可见，没有遮挡或越界。
- 批量版本保护测试覆盖确认前零变更、取消零变更、批准后只给 V2 铸付费令牌，以及上游 V2 → 下游 V2 的依赖重接。
- VIBING Director 的 3D/渲染模式、空间质量标记、镜头节拍和资产区互不遮挡。
- Blender 空间关系不能只看位置数值：旧版报告在椅子位置误差为 0 时错误放行了 38.66° 朝向偏差。最终关系报告把位置与朝向作为两个独立失败条件；真实 `.blend` 读回和预览均确认椅子随角色转向。
- Director 资产区默认显示 Kenney CC0 目录；搜索“咖啡”可见咖啡机和咖啡桌，导入按钮在紧凑窗口中保持可见。官方联网烟测已从固定哈希包中提取真实 `kitchenCoffeeMachine.glb`。
- 第一方人偶鞋底从后跟到鞋尖连续，旧版独立脚趾方块已消失；站立、坐姿、深蹲、单膝、双膝和半蹲代表图未再出现脚部碎块。
- 前臂、手掌和指端改为连续手套蒙皮，旧版悬浮手掌方块已消失；肘膝仍保留导演台低模关节分节，不作为最终人物真实度验收。
- E2E 隔离运行不再自动弹出 detached DevTools，正常源码调试仍保留 DevTools；Director 对话框改按稳定 DOM 契约等待，最终 23 项复测通过。

## Provider 与成本边界

当前最终零付费 smoke：

- 最新运行态复核：`evals/runs/2026-07-17T12-47-45Z-capability-recipes-live-single-instance/report.json`
- `paidEvaluation=false`
- `maxProviderCalls=0`
- `providerCalls=0`
- smoke 使用当前用户模型目录的脱敏副本；自定义机位、九宫格、全景、人像、情绪、图像风格、i2v 视觉风格和 i2v 效果共 8 项完成当前连接状态的可用性检查。
- `pnpm smoke:capability-recipes:real -- --help` 只打印安全默认值、付费开关和运行参数，不创建证据目录、临时目录或 Electron 进程。
- 本轮请求冷却参数为 0，因为硬上限禁止任何 Provider 提交；目录仍返回 AGNES 图片 6000ms、视频 60000ms 的强制最低间隔。报告中的 `appliedDuringThisRun=false` 是零调用下的预期结果，真实提交不能绕过该下限。
- v2v 两项因无兼容模型阻塞；报告给出 `candidateArchetypes=["happyhorse"]`，并指向 KIE HappyHorse 的 `video-edit` 模式。
- 图生 3D 因无兼容模型阻塞；候选档案为 `hunyuan3d`、`hitem3d`、`meshy6`。
- RunningHub 3D 响应会按 GLB 类型或 `.glb` URL 精确筛选；预览图不会消耗下游 GLB 导入机会。3D 长任务在 5 分钟后切换“仍在生成”，最多只查询原 task id 到 20 分钟，不自动再提交。
- 阻塞诊断已细分为 `missing_source_video_model` 与 `missing_image_to_3d_model`，并给出所需输入能力和候选接入方向，不再只返回“没有模型”。
- 隔离 Electron 无 page error；`appClosed=true`、`forcedKill=false`、退出码 0；临时 Codex home、派生子进程和临时根目录残留均为 0。
- 能力核 CLI 已在当前真实目录复核：返回 20 个可执行模型，未连接 KIE/RunningHub 的种子模型为 0，不再给外部 Agent 虚假的 v2v/3D 可执行候选。
- 多视角视觉复核按整个集合计一次文本模型请求，不按九个机位分别计费；费用确认列出模型、附件数量和请求数。仅在用户主动确认后发送，模型用量以 prompt/completion/total token 写入质量报告，不记录 API Key 或供应商原始配置。
- 当前主目录的 Doubao Seed 2.0 Lite/Pro 已可作为多视角视觉复核候选；本轮只验证选择、附件预检和费用确认，没有确认或发送真实模型请求。
- E2E 启动夹具现在同时隔离 `userData`、settings、projects 和 `NOMI_CAPABILITY_DIR`。单项回归 smoke 结束后主 Nomi 仍保持原 RPC 端点，修复了测试实例退出时误删主实例 `instance.json` 的问题。E2E 不再触发面向真人的关闭确认，`app.close()` 已优雅退出；real-smoke 今后若再次超时强杀会把报告标为失败，而不是继续显示 PASS。
- smoke 参数解析同时覆盖 `--key=value` 与 `--key value`；新增回归用例确认 npm/pnpm 的 `--` 分隔符不会再把 `run-dir` 等值误解析为 `1`。

AGNES 当前公开模型契约的核对结果：

- Agnes Video V2.0 支持文生视频、图生视频与多图/关键帧输入；当前公开契约没有 source-video 视频转视频输入，因此 Nomi 不会把它伪装成 v2v。
- 公开免费/default 实际限速参考值为文本 20 RPM、图片 1K 20 RPM、图片 2K 10 RPM、视频 1 RPM；Nomi 图片统一采用保守的 2K 下限。
- Renderer 限流负责队列公平、取消和用户可见进度；Electron `provider-submission-rate-limits.json` 是真实提交前的权威台账，并用跨进程锁保护并发预约。
- 台账只保存 rate key 和时间戳，不保存 API Key、prompt、素材 URL、项目或账户标识。

即梦当前参考素材边界：

- 即梦 CLI `multimodal2video` 支持最多 9 张图片、3 段视频、3 段音频；Nomi 的 CLI 档案和参数物化继续覆盖三类素材。
- 即梦 Web 外部扩展接受图片和视频，不接受音频。Nomi Web 档案只暴露这两类，bridge 不再把视频静默过滤；音频会在提交前失败并引导到 CLI。
- 图片/视频参考只证明素材可被送入多模态生成，不证明供应商会保留源视频时序，也不满足 `video.edit.*` 所需的 `source_video` edit 契约。
- 本轮只做零费用目录与传输契约验收，没有启动一次真实 Web 生成任务。

已有历史付费证据仅覆盖：

- `image.multiview.custom`
- Codex Img2 / GPT Image 2
- 1 请求、1 成功输出、91.635 秒
- 报告：`evals/runs/2026-07-16T06-36-34Z-capability-recipes-real-smoke/report.json`

后续任何付费批量必须继续经过费用确认，不允许把 `maxProviderCalls=0` 改成正数后静默执行。

## 性能修复

旧基准把左键空白拖误当作平移，实际测到的是框选。最终基准改为真实中键持续平移，并加入 transform 预检。

最终修复：

1. 画布 transform 每帧直接提交给合成层，React/Zustand 按 180ms 或 320 画布像素漂移批量同步。
2. 停止移动 120ms 后强制同步最终 offset。
3. 画布层使用 `will-change: transform`。
4. 高密度边层在中键、空格拖动或触控板平移期间暂停绘制，停止后恢复。
5. E2E 同时断言移动时边层隐藏、停止后边层恢复。
6. 性能脚本设置最低 FPS、最大帧间隔和累计长任务预算，回退会使测试失败。

最终结果：

| 场景 | FPS | 长任务 | 最大帧间隔 | 验收 |
| --- | ---: | ---: | ---: | --- |
| Canvas pan | 57.6 | 1 / 124ms | 141ms | PASS |
| Canvas zoom | 58.8 | 0 | 44ms | PASS |
| Timeline play | 57.5 | 0 | 23ms | PASS |

## 安全与进程

- Codex Img2 使用最小临时 `CODEX_HOME`，仅链接现有认证会话和必要运行元数据。
- 正常完成、失败、重试、超时和取消都从活动子进程注册表移除。
- Jimeng Web 服务按“登录一次、复用 Cookie”设计常驻，不会每个任务重启；显式停止或 App 退出时先发 `SIGTERM`，2 秒未退出再 `SIGKILL`。
- VIBING Director E2E 在外部证据目录模式下会等待隔离 Electron/Vite 退出并删除临时 user-data；本轮历史 `nomi-vibing-director-e2e-*` 与 `nomi-capability-real-smoke-*` 目录均清理为 0。
- 最终真实 Blender 3/3 smoke 和 26 项隔离 Electron E2E 结束后，Blender、隔离 Electron/Vite 进程以及 `nomi-vibing-director-real-*` 临时目录残留均为 0。
- 创作配方 E2E 在成功时自动删除隔离项目和 user-data，失败时才保留现场；本轮累计清理了 37 个 `nomi-capability-recipes-e2e-*` 隔离目录，最终残留为 0。
- 本轮没有输出 API Key、Cookie、Provider 原始配置或账户标识。
- 最终真实 Provider 兼容性 smoke 的临时 Codex home 和生成子进程残留数均为 0；报告目录为 `evals/runs/2026-07-17T16-10-00Z-capability-recipes-final-zero-spend/`。
- 所有隔离 Electron 现在使用独立 `NOMI_CAPABILITY_DIR`；最小回归结束后真实主实例端点保持 `127.0.0.1:62143`，不会再被测试退出清理覆盖。E2E 关闭确认已跳过，回归报告为 `appClosed=true`、`forcedKill=false`、退出码 0；real-smoke 将任何关闭超时或强杀标成清理失败。
- MCP stdio 是 Codex/Claude/Cursor 各自拉起的无窗口 Agent transport，允许与 GUI 并存且不抢单实例锁；进程诊断必须先检查 `NOMI_MCP_STDIO=1`，不能把它误判为重复 GUI 并清理。配置已迁移到改造版，现有客户端重启前保留旧子进程。
- Codex 超时、取消和强制终止测试会保留生产级诊断目录供断言，但现在会在测试 teardown 登记删除；最终完整门禁后 `nomi-codex-img2-*` 残留为 0。
- AGNES 频率控制发生在缓存未命中之后；命中本地指纹缓存不会等待，也不会占用新的 Provider 提交窗口。
- GUI 与外部能力核最终共用 `runtime.runTask` 的主进程频率闸；headless 进程通过 `userData` 持久台账共享预约，进程重启不会把已预约窗口清零。
- 批量生成的费用确认发生在版本节点创建之前；取消确认不会创建空 V2，也不会铸付费令牌。授权失败发生在确认后时，已创建的空版本保留给用户重试，不会静默删除或再次分叉。
- Kenney 下载仅接受固定官方 HTTPS 主机和固定 SHA-256，限制响应为 8 MB、单条目解压为 16 MB；ZIP 路径、压缩算法和目录边界均在主进程校验。同一缓存包的并发请求合并为一次下载。

## 许可证与来源

- Nomi 仓库 `LICENSE` 为 Apache License 2.0，源码修改可在遵守许可证和 NOTICE/署名义务的前提下使用与商用。
- Seedance 原仓库已定位为 `https://github.com/zhaihao118/Seedance2-Chrome-Extensions`，审计 HEAD 为 `a646f24`、上游清单 `1.3.0`，没有 LICENSE 或包许可证字段。本地用户副本已修改为 `1.5.0`，增加 Nomi 即梦 Web 图片任务支持，不会被较旧上游覆盖。Nomi 只按外部路径调用，不把扩展文件复制进仓库或安装包。
- 原 `src/assets/x-bot.glb` 与 `src/assets/mannequin-animations.glb` 已删除，不再进入源码或安装包。
- `scripts/generate-nomi-mannequin.py` 程序化定义低模几何、骨架、蒙皮权重和 walk/run 关键帧，不导入第三方模型或动画；`mixamorig` 仅保留为旧项目骨名兼容 API。
- 生成结果为 `src/assets/nomi-mannequin.glb` 与 `src/assets/nomi-mannequin-animations.glb`，均纳入仓库 Apache-2.0 许可。
- 连续鞋楦和手套由同一组索引面连接相邻权重区，自动测试要求左右脚存在跨 `Foot`/`ToeBase` 的连接三角面，左右手存在跨 `ForeArm`/`Hand`/`HandMiddle1` 的连接三角面，避免末端刚性方块回归。
- `docs/legal/third-party-assets.json` 记录生成来源、哈希和策略；普通与 release 审计都会校验资产覆盖和二进制完整性。
- Kenney Furniture Kit 1.0 按需下载、不进入安装包；官方页面与支持页声明 CC0、允许商用且无需强制署名。目录导入会自动记录包哈希与文件哈希。
- Poly Haven 免费 Public API 的官方条款限于非商业用途，因此没有作为 Nomi 默认机器后端；Poly Haven、Quaternius 和 BlenderKit 的手动导入默认显示“需确认”，不再根据来源标签自动宣称许可。
- Blender 是外部安装依赖，本轮没有把 Blender 二进制打进 Nomi。

## 目标 1–9 完成度审计（2026-07-17）

本表按原始目标逐项审计，不以“代码存在”“构建通过”或局部测试代替产品级完成证据。`PARTIAL` 和 `BLOCKED` 都不计为目标完成。

| # | 原始要求 | 结论 | 权威证据 | 未完成或阻塞 |
| --- | --- | --- | --- | --- |
| 1 | 测试构建中有清晰、稳定、可配置的入口，同时保持生产发布受控 | PASS | 左侧“能力组件”默认展示 11 个原子组件；点击、拖放、输入连线、`配置并运行`、统一能力抽屉和 Agent 入口由 96/96 Electron 断言覆盖。开发构建默认开启，生产构建仍需显式 feature flag 或本地实验开关 | 正式发布仍受 Gate 9 与明确审批约束，不属于本轮允许范围 |
| 2 | 九宫格、自定义机位、全景、人像、情绪、风格、视频和图生 3D 逐项完成真实 Provider E2E | BLOCKED | 已保留一次 Codex Img2 自定义机位真实成功；当前目录零费用检查在 `evals/runs/2026-07-17T12-47-45Z-capability-recipes-live-single-instance/report.json` 中记录 8 项 `inspection_passed`、0 次 Provider 调用、2 项 v2v 和 1 项图生 3D 结构化阻塞 | 九宫格、全景、人像、情绪、风格及两项 i2v 尚无本轮最终代码对应的真实输出；未经用户明确批准不能发起可能付费的调用；当前也没有 v2v 或图生 3D 兼容模型 |
| 3 | 多视角一致性与全景比例、接缝、极点、投影检测 | PASS | `grid9-local-v2`、`custom-view-local-v2`、视觉文本模型批量复核适配器、2:1 比例与接缝/极点/投影报告均有单元、契约和 Electron 证据；缺素材地址或无语义证据时失败关闭 | 对真实新输出的最终视觉结论仍依赖第 2 项 Provider smoke，不把确定性 fixture 当成真实生成效果 |
| 4 | 人像真实化、肤质、情绪身份一致性的可视化对比与真实效果验收 | PARTIAL | 原图/结果同步对比、肤质与伪影报告、身份不可用状态、5×5 结果集合及人工通过/拒绝记录已持久化；视觉证据位于 `evals/runs/2026-07-17T13-12-10Z-capability-human-review-e2e/evidence/` | 尚无本轮真实人像、肤质和情绪 Provider 样本；尚未获批调用已连接的 Doubao Seed 2.0 Lite/Pro 对真实结果做语义身份复核 |
| 5 | 真实可用的视频工作流，严格区分 i2v、v2v、视觉风格和时序效果 | BLOCKED | 四类配方、输入契约、模型兼容、费用确认、AGNES 1 RPM 限流、媒体技术报告和 i2v/v2v 文案边界已通过测试；即梦 CLI/Web 参考素材能力也已拆分 | 两项 i2v 尚无本轮真实输出；当前零个模型同时声明 `source_video` 与 edit intent，两项真正 v2v 无法执行 |
| 6 | 图片→3D Provider→GLB→Scene3D/Blender→可编辑工程与预览回传闭环 | BLOCKED | Provider-like GLB 已真实导入 Blender、修改变换、保存 `.blend`、导出 GLB 并回传预览；证据位于 `evals/runs/2026-07-17T12-26-00Z-vibing-director-real-relative-transform-final/model3d/`。上游响应只接受真实 GLB，预览图不能冒充模型 | 当前没有已连接的 Hunyuan3D、HiTem3D、Meshy 6 或等价图生 3D Provider，因此原始要求中的上游真实 Provider 调用未完成 |
| 7 | 独立、Agent 对话驱动、可预览可修改、空间关系可靠的 VIBING Director | PASS | 独立全屏工作区、Agent composer、交互 3D、Blender 预览、回滚和 CC0 资产目录由 26/26 Electron 断言覆盖；真实 Blender smoke 验证承托、距离、椅子/角色相对位置与朝向，最终角色朝向误差 0.014° | 本轮没有额外发起真实文本 Provider 对话；这不影响已验证的 Director 工具协议与 Blender 执行闭环，但若把真实对话调用列为发布证据，仍需单独批准 |
| 8 | 主画布、分镜、Agent、性能、兼容、回滚、进程清理和错误提示 | PASS | 原子 SkillNode、分镜行能力菜单、共享执行控制器、非破坏 V2/V3、旧快照规范化、96 节点性能基线、隐藏媒体释放、恢复轮询、Codex/Jimeng 子进程清理和人话错误均有自动化证据 | 真实 Provider 阻塞时仍只能显示诊断，不能伪造完成结果 |
| 9 | 单元/集成/Electron、真实 Provider、Blender、视觉、成本、安全、许可的产品级 Gate 8 报告 | BLOCKED | 全量 Vitest 3201 项通过、Electron 能力组件 96/96、真实 Blender 3/3、视觉截图、零费用目录检查、密钥门、第三方资产与许可证审计均已落盘 | “真实 Provider smoke 全覆盖”仍因第 2、5、6 项未完成；因此本报告只能判定 Gate 8 本地底座通过、完整产品目标未完成 |

### 阻塞恢复条件

继续完成原始目标必须同时满足以下外部条件，现有本地代码、fixture 或更多零调用测试不能替代：

1. 用户明确批准一组有调用上限、保留费用确认、按低成本顺序执行的图片/i2v Provider smoke，并单独批准一次 Doubao 多视角视觉复核。
2. 连接一个真实声明 `source_video` 和 edit intent 的视频模型，例如 KIE HappyHorse `video-edit` 或等价 Provider。
3. 连接一个真实图生 3D Provider，例如 RunningHub 的 Hunyuan3D、HiTem3D、Meshy 6 或等价服务。

在上述条件解除前，目标状态应为 `BLOCKED`，不是 `COMPLETE`；仍停留在 Gate 8，不进入 Gate 9。

## 剩余行动

1. 用户明确批准费用与调用上限后，按低成本顺序执行：九宫格小样、全景、人像、情绪 3–5 格子集、图像风格、i2v 视觉风格、i2v 效果。
2. 连接一个真实声明 `source_video` 的 v2v 模型后，再验收 `video.edit.look` 和 `video.edit.effect`。
3. 连接 Hunyuan3D、Meshy、Hitem3D 或等价 Provider 后，执行真实“图片→GLB→Scene3D→Blender”上游调用。
4. 经用户确认，用当前已连接的 Doubao Seed 2.0 Lite 或 Pro 执行一次多视角批量视觉复核，保留身份、几何和 token 脱敏报告。
5. 如需把 Director Agent 的真实对话 Provider 也作为最终证据，需单独批准一次文本模型调用并保留脱敏报告。
6. 如需验收即梦 Web 的扩展 DOM、账号状态、真实图片生成和视频参考遵循度，需明确批准一次受频率控制的 Web 生成；该 smoke 不能替代真正 v2v Provider 验收。

## Stage Gate

- Current gate：Gate 8 - AI capability integration。
- Allowed work：Provider 连接、付费确认后的低频 smoke、视觉质量评测、成本/频率控制、安全和许可证审计。
- Forbidden work：Gate 9、正式发布、公开分发许可证不明资产、绕过费用确认。
- Required artifact：本报告及其 `evals/runs` 证据目录。
- Acceptance check：本地产品底座和随包资产许可 PASS；完整真实 Provider 覆盖 BLOCKED。
- Next recommended skill：阻塞项解除前继续使用 `ai-product-stage-gate:implementation-builder`；全部真实证据齐备后再使用 `ai-product-stage-gate:stage-gate-reviewer`。
