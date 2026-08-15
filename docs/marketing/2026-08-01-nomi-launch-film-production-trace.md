# Nomi 国际宣传片制作追踪

更新时间：2026-08-01  
状态：中文 / 英文 16:9 母版、中文 / 英文 9:16 社交版、X 安全画幅英文竖版、15 秒官网静音循环版与双语 SRT 均已完成导出；全部成片已做媒体探测与最终 MP4 像素校对

## ChatCut 项目

- 项目：`Nomi International Launch Film`
- Project ID：`e972cb0b-b0bf-4c14-98ab-25093c2d0475`
- 初始 Timeline ID：`c995e3a0-b174-4736-b7aa-e86b3aa72b58`
- 英文 Timeline ID：`c77f89cb-a09d-40f2-935f-7b3b966a9094`
- 中文竖版 Timeline ID：`7d4dde53-0579-4ae7-b869-be912102dade`
- 英文竖版 Timeline ID：`dc8ac171-cb5a-4bde-825f-8b6fb48ac918`
- 官网静音版 Timeline ID：`fe40f4b3-0c6e-442b-83bd-5eb4d79796da`
- 画布：1920×1080，30 fps
- 编辑器：<https://app.chatcut.io/zh/editor/e972cb0b-b0bf-4c14-98ab-25093c2d0475>

## 素材溯源

| 角色 | ChatCut Asset ID | 来源 | 导入方式 | 媒体事实 | 状态 |
|---|---|---|---|---|---|
| 原始完整录屏 | `68fc31c8-ca76-4448-bbe6-d51439a33680` | `/Users/aoqimin/Documents/FocuSee/Nomi 2026-07-30 02-25-31.mp4` | ChatCut import helper | 原文件 3444×2160，H.264 + AAC，30 fps，705.236 s；导入时因宽度超过 1920 转码为 1920×1204，705.267 s，264,019,450 bytes；音频 -23.4 LUFS | 上传 `ready`；转写 `complete` |
| 官网演示片 | `f8f0e4d0-d83d-4dc0-a407-af2046682264` | `/Users/aoqimin/Desktop/Nomi/marketing/assets/demo.mp4` | ChatCut import helper | 1280×720，46.6 s，无音轨，4,542,583 bytes | 上传 `ready`；无音轨无需转写 |
| 3D 导演台静帧 | `5d912025-0b7e-42f4-911b-01785334fdc3` | `/Users/aoqimin/Desktop/Nomi/marketing/assets/screen-3d.png` | ChatCut import helper | 1600×943，422,757 bytes | 上传 `ready` |
| Nomi 标志 | `56dbccec-435a-4b63-be51-10435e3db108` | `/Users/aoqimin/Desktop/Nomi/marketing/assets/nomi-logo.svg` | ChatCut import helper | SVG，512×512，399 bytes | 上传 `ready` |
| 时间线真实截图 | `ac341231-4cac-49ed-b4b5-832406e0a8ff` | `/Users/aoqimin/Desktop/Nomi-growth-spec/marketing/assets/screen-timeline.png` | ChatCut import helper | PNG，3834×1914，1,860,416 bytes | 上传 `ready` |

## 导入验证

- `browse_assets`：首批 4 项素材均在 `Master` 文件夹，名称与原文件一致；粗剪校对后又补入 1 张真实时间线截图。
- `track_progress target=upload`：完整录屏 `ready`，`progress=1`，终态成功。
- `track_progress target=transcription`：完整录屏 `complete`，状态为 `Transcript ready`。
- 完整录屏上传期间发生一次 CloudFront 502 与分片超时；helper 自动重试成功，没有重复注册资产。
- 生成/剪辑将引用原始资产与 source offset；不创建本地预剪扁平视频。

## 当前质量边界

- 原始口播只作为事实与时间点参考，成片主旁白另写。
- 禁用录屏原声，避免重复口头语、等待说明、报错与供应商故障进入成片。
- 明确排除 09:55–10:06 的供应商不稳定段落。
- 10:36–11:05 时间线段仅在画面干净时使用，否则改用官网演示片或现有时间线静帧。

## 后续记录区

### 视觉系统

- Design Style：`Nomi · Warm Editorial`（ID `80f6721729`）
- 色彩：背景 `#F3EEE6`、正文 `#292522`、强调 `#E7795F`、辅助 `#EFA95A`、深色画框 `#242425`
- 字体：标题 `Fraunces`、正文 `DM Sans`；两者均已通过 ChatCut 云字体目录精确匹配。
- 风格边界：温暖的编辑感、克制、触感明确、精确而有人味；生成或剪辑不得退化成霓虹赛博、模板化科技蓝或过量玻璃拟态。
- 中文主时间线：`01-CN-Master-16x9`（ID `c995e3a0-b174-4736-b7aa-e86b3aa72b58`），1920×1080，30 fps。
- 视频轨道：V1 `e8db59d6d2`（产品画面）、V2 `2fe6d015ee`（信息层）、V3 `da846dcdfe`（品牌动效与字幕）。
- 音频轨道：A1 `df9b16d005`（Narration，`anchor`）、A2 `70b06c9d4d`（Music，`follower`）、A3 `1c1ac66b47`（SFX）。
- 结构复核：ChatCut `read_project` 与 `edit_track list` 均返回 3 条视频轨、3 条音频轨，当前时间线无遗留条目；A1/A2 的自动闪避角色正确。

### 脚本与镜头

- 成片脚本：docs/marketing/2026-08-01-nomi-launch-film-scripts.md
- 中文母版：8 个语义段，保留“摩擦 → 控制 → 证据 → 结果 → 行动”的单线结构。
- 英文适配：按英语自然表达重写，不逐字翻译；与中文共享同一产品事实和 CTA 边界。
- 真实素材取样已完成本地逐帧接触表检查：脚本/助手、视觉锚点、画布、浏览器采集、反推复用、集成面板与时间线均有干净源范围。
- 35–43 秒拆为两个 4 秒真实片段：07:00–07:04 证明“采集”，08:06–08:10 证明“反推并复用”；不以单一远景替代两项证据。
- Hook 与 CTA 的 V1 底片来自现有 demo.mp4 真实作品画面，后续由品牌 Motion Graphic 覆盖；不存在用 AI 概念片伪装产品能力。
- 明确禁用原录屏 09:55–10:06 的供应商不稳定段，以及 10:42 后任何可见生成失败画面。
- 宣称审计通过：无“最好 / 领先 / 全部模型 / 所有供应商 / any model / all models”等绝对化表述。

### 时间线与截图校对

- V1 已形成连续 1800 帧 / 60 秒骨架，源音全部为 `-60 dB`；无空隙、无重叠。
- 实际 V1 条目顺序：Hook 真实作品底片 → 脚本/分镜方案 → 视觉锚点画布 → 生成画布 → 浏览器采集 → 反推复用 → AI 助手接入 → 模型/ComfyUI 列表 → 时间线真实截图 → CTA 真实作品底片。
- 35–43 秒和 43–50 秒均按证据拆成两个短镜头，粗剪共 10 个 V1 条目；这比“每个价值只塞一个远景”多两个切点，但旁白与画面事实保持一一对应。
- 视觉锚点和生成画布已添加 ChatCut `Slow Push` clip-scoped Zoom，Effect IDs：`1267d28142`、`2543393c86`；运动只做聚焦，不遮盖产品 UI。
- 时间线截图条目：`d89130b32d`。使用 `cover` 时左右各裁约 5.6%；已同时检查原图与合成帧，Nomi 标志、预览主体、顶部入口和底部时间线均完整保留。

#### 第一轮失败与修正

| 合成帧 | 第一轮发现 | 根因 | 修正 |
|---|---|---|---|
| 180 / 06s | P0：主区只有空白和鼠标 | 00:47.5 源段的有效建议只短暂出现 | 改到 01:28–01:36；稳定帧明确显示“分镜方案”与人物/场景/道具列表 |
| 480 / 16s | P0：系统文件选择器遮住画布 | 02:33.5 源段跨过一次上传动作 | 改到 02:40–02:52；稳定帧只保留视觉锚点、镜头节点和连接关系 |
| 1440 / 48s | P0：ComfyUI 展开后出现“未探测到”警告 | 09:25 后进入连接检查状态 | 第二段回退到 09:22–09:25.5；只展示模型、ComfyUI 与助手入口，不显示警告 |
| 1560 / 52s | P0：原录屏时间线未展开，无法证明收束 | 原录屏 10:36 的时间线仍是折叠状态 | 替换为仓库内真实时间线截图，明确看到预览与已放入的时间线片段 |

#### 修正后代表帧

| 帧 / 时间 | 结论 | 画面证据 |
|---|---|---|
| 30 / 01s | 通过 | 品牌 Hook 已覆盖真实 Nomi 作品底片，无黑帧 |
| 180 / 06s | 通过 | 分镜方案及人物、场景、道具、全片风格可读 |
| 480 / 16s | 通过 | 视觉锚点与镜头连接图完整，无系统弹窗 |
| 840 / 28s | 通过 | 生成画布、提示词和“开始生成”确认动作同屏 |
| 1110 / 37s | 通过 | 浏览器素材盒显示“已导入画布” |
| 1230 / 41s | 通过 | 反推后的提示词卡与复用素材同屏 |
| 1380 / 46s | 通过 | Claude Code / Codex / Cursor 接入面板稳定可读 |
| 1440、1490 / 48–49.7s | 通过 | 模型列表、ComfyUI 与 AI 编程助手入口可见，无检测警告 |
| 1560 / 52s | 通过 | 预览与时间线已同屏，左右裁切未损伤关键 UI |
| 1740 / 58s | 通过 | CTA 动效已覆盖真实作品结果底片，无黑帧 |

### 品牌动效

- Hook：`Nomi Hook · Direct the Shot`（Asset `c8fa81c5-ba96-4f78-a884-77d6e5307381`，V3 Item `53aac321ee`），覆盖 0–119 帧。深色底与珊瑚色导演框把“猜”转成明确的视觉摩擦；中文字体使用 `Noto Serif SC` / `Noto Sans SC`。
- 集成桥：`Nomi Bridge · Bring Your Own Stack`（Asset `91624231-66c0-45ce-85bf-104e0f3c0908`，V3 Item `9faf1ad4f7`），覆盖 1290–1334 帧。以“接入你的工作流 / BRING YOUR OWN STACK”连接产品实拍与模型、ComfyUI、AI 助手证据段。
- CTA：`Nomi CTA · Open Source and For Teams`（Asset `7002fdee-01a1-4e9e-b5e9-c9abd8a08bb4`，V3 Item `31fc10b4f2`），覆盖 1650–1799 帧。主行动为“下载开源版”，企业服务为 `For Teams`，明确列出定制开发、系统集成、贴牌交付、持续迭代。
- 三个 Motion Graphic 均为 ChatCut 原生可编辑资产，文本、颜色和字体保留属性槽；未使用外部模板、发光霓虹、玻璃拟态或不可编辑的扁平片头。

#### 动效截图校对

| 帧 / 时间 | 结论 | 画面证据 |
|---|---|---|
| 8、60、108 / 0.27–3.6s | 通过 | Hook 从局部构形进入稳定标题，108 帧“猜”的珊瑚导演框完整、无裁切 |
| 1298、1320、1332 / 43.27–44.4s | 通过 | 集成桥的入场态、稳定态均无溢出；三类接入对象可读 |
| 1660 / 55.33s | 通过 | CTA 入场只先露出品牌与辅助色块，符合分阶段揭示逻辑 |
| 1710、1780 / 57–59.33s | 通过（两轮修正后） | “下载开源版 / For Teams”及四项服务均处于安全区，字号与层级清楚 |

CTA 首次稳定帧曾把“贴牌交付 / 持续迭代”拆成孤字；第一次缩字号后仍在右侧被裁。最终没有继续把字硬塞进单行，而是将四项服务做成两行均衡分组，并再次读取 1710、1780 帧真实渲染像素确认通过。

### TTS 同步预备图

目标是 A1 中文旁白轨；所有段落按当前画面边界分别生成、测真实时长、再放置，不生成一条 60 秒整音频。估时以克制产品旁白和轻微提速为基准，标注“紧”的段落必须在生成后先过真实时长门再进时间线。

| 段 | 目标帧 / 时长 | 视觉锚点与证据 | 中文旁白 | 估时状态 |
|---|---|---|---|---|
| 1 | 0–119 / 4s | 品牌 Hook；108 帧稳定态 | 你知道镜头该是什么样，但模型只能猜。 | 紧；已压到 16 个有效字符，生成后核时长 |
| 2 | 120–359 / 8s | 分镜方案；180 帧 | Nomi 把故事、分镜和生成放进同一个上下文。 | 可容纳 |
| 3 | 360–719 / 12s | 视觉锚点与连接图；480 帧 | 先固定人物、场景、道具和风格，让每个镜头继承同一个世界。 | 可容纳 |
| 4 | 720–1049 / 11s | 生成画布与助手；840 帧 | 在画布上直接组织镜头，让助手写提示词、放素材、调用生成。 | 可容纳 |
| 5 | 1050–1289 / 8s | 采集与反推复用；1110、1230 帧 | 看到合适的参考，直接采集、反推并复用，不用来回搬运。 | 可容纳 |
| 6 | 1290–1499 / 7s | 集成桥 + 助手/ComfyUI；1320、1380、1490 帧 | 接入自有模型、ComfyUI 和 AI 助手，不被单一供应商锁住。 | 紧；已删冗词，重点核对 ComfyUI 发音与真实时长 |
| 7 | 1500–1649 / 5s | 真实时间线；1560 帧 | 从意图到时间线，成为一条连续的导演流程。 | 可容纳 |
| 8 | 1650–1799 / 5s | CTA；1710、1780 帧 | 下载开源版 Nomi。定制、集成、贴牌，联系团队。 | 紧；已将原长句改成 19 个有效字符 |

英文 Hook 与 CTA 也已从 195 / 180 WPM 的过快初稿压到约 135 / 144 WPM；其余英文段落保持 98–146 WPM，待英文声线确定后用同一套真实时长门验证。

### 旁白与同步

- 中文声线：豆包 `liuchang`（流畅女声）；英文声线：ElevenLabs `peter`。选择均由用户在 ChatCut 声线卡中确认。
- 两种语言都拆成 8 个独立 TTS 资产，逐段测量真实时长后放入各自 A1；没有把 60 秒旁白锁成一个不可局部替换的文件。
- 中文 A1：`df9b16d005`，8 段分别从 0 / 120 / 360 / 720 / 1050 / 1290 / 1500 / 1650 帧开始；实际长度为 116 / 138 / 191 / 179 / 156 / 161 / 134 / 143 帧，全部留在各自镜头窗口内。
- 英文 A1：`0f9cf466fe`，8 段使用相同视觉起点；实际长度为 93 / 183 / 285 / 294 / 208 / 203 / 140 / 133 帧，全部留在各自镜头窗口内。
- 两版旁白均为 `+6 dB`，每段 0.04 秒淡入、0.08 秒淡出。中文 CTA 初次生成 5.208 秒超过 5 秒窗口，改为 `speedRatio=1.1` 后 4.752 秒；英文第 5–8 段也根据真实时长压缩文案并重新生成，不以剪断句尾强行塞入画面。

#### 最终英文生成文案

1. `You know the shot. The model can only guess.`
2. `Nomi keeps the story, storyboard, and generation context connected from the first line.`
3. `Lock characters, locations, props, and style first, so every shot inherits the same world instead of restarting from another prompt.`
4. `Build on a visual canvas. Let the assistant draft prompts, place media, and call generation tools while you keep the whole sequence in view.`
5. `Found the right reference? Capture it, reverse the prompt, and reuse it without changing tools.`
6. `Connect your models, ComfyUI, and AI coding assistants without locking into one provider.`
7. `From intent to timeline, directing becomes one continuous workflow.`
8. `Download Nomi. For custom or white-label builds, talk to us.`

### 音乐与音效

- 原创配乐 Asset：`326ea1db74`，从 169.456 秒成品中截取最后 60 秒，使影片落在已解决的音乐终止点，不用硬切尾音。
- 中文 A2：`70b06c9d4d` / Item `890d0ff24e`，`-9 dB`，旁白闪避 `-6 dB`；英文 A2：`02b407abb3` / Item `7c15a082c8`，`-9 dB`，旁白闪避 `-7 dB`。两版均 1.2 秒淡入、2 秒淡出。
- A3 只保留三处有叙事作用的声音：35 秒采集快门、43 秒轻盈转场、55 秒 CTA 深层转场。中文 Items：`59d9d42575` / `b4a30df786` / `47c9181364`；英文 Items：`7298179969` / `91cd03ef01` / `840ae9e636`。没有为每次鼠标移动堆叠装饰音效。

### 字幕

- 中文 Caption Singleton：`b7a3c6c6…`，显式绑定中文 A1；`Noto Sans SC` 48 px、600、暖白字、深色半透明底、最多两行、每行约 24 字符，安全区为 left 240 / bottom 140 / width 1440。
- 英文 Caption Singleton：`ce332ced…`，显式绑定英文 A1；`DM Sans` 46 px，最多两行、每行约 38 字符，位置与中文一致。
- 两版都关闭逐字高亮，使用语义短句推进。中文纠正了繁体字与标点；英文清除了 ASR 幻觉 `M.`，修正 `assistants`、`Nomi.` 与 `white-label` 的显示，但没有篡改实际配音音频。
- 代表帧检查覆盖 40 / 190 / 840 / 1150 / 1360 / 1580 / 1730；字幕均未与产品底部时间线或 CTA 主文案碰撞。

### 双语动效适配与回归

- 英文时间线复用同一组 Motion Graphic 资产，只通过实例属性替换英文文案；Hook、集成桥与 CTA 没有复制出一套不可维护的平行动效实现。
- 英文 Hook 使用 `You know the shot. / The model can only / guess`；集成桥使用 `Connect your workflow / Your models / ComfyUI / AI assistants`；CTA 使用 `Download Nomi / For Teams / Custom builds · Integrations · White-label · Ongoing iteration`。
- 英文适配后重新检查中文 60 / 108 / 1320 / 1332 / 1710 / 1780 帧：中文字号、换行、安全区和导演框均未回归；英文导出接触表同时检查了片头、产品证据、集成桥、时间线与 CTA。

### 导出与成片 QA

| 版本 | Render ID | 本地文件 | 媒体事实 | 音频事实 | 结论 |
|---|---|---|---|---|---|
| 中文 v1 | `fe8fc95347` | `/Users/aoqimin/Downloads/Nomi-Launch-Film-CN-Master-v1.mp4` | 1920×1080，30 fps，60.096 s，17,197,190 bytes | -20.1 LUFS，true peak -6.5 dBTP | 未作为母版：接触表发现 Hook 中间态有局部字形，整体响度偏低 |
| 中文 v2 | `76bae80284` | `/Users/aoqimin/Downloads/Nomi-Launch-Film-CN-Master-v2.mp4` | 1920×1080，30 fps，60.096 s，17,225,589 bytes | -18.1 LUFS，LRA 6.9 LU，true peak -4.5 dBTP | **当前中文母版**；修正全文透明度揭示并提升旁白后通过接触表检查 |
| 英文 v1 | `f6ad67d359` | `/Users/aoqimin/Downloads/Nomi-Launch-Film-EN-Master-v1.mp4` | 1920×1080，30 fps，60.096 s，17,395,771 bytes | -17.5 LUFS，LRA 5.5 LU，true peak -2.1 dBTP | **当前英文母版**；英文排版、字幕、桥段与 CTA 全部在安全区 |

成片 QA 不是只看导出任务成功：中文 v2 与英文 v1 都从最终 MP4 抽取接触表并亲眼检查像素；中文又从当前时间线重新渲染关键帧，验证英文属性适配没有误伤中文。两版当前均无黑帧、破字、字幕溢出、CTA 裁切或可见供应商报错。

### 9:16 社交版派生与根因修正

- 中文时间线：`03-CN-Social-9x16`；英文时间线：`04-EN-Social-9x16`；均为 1080×1920、30 fps、1800 帧。
- 初次 `contain` 适配留下大面积黑边；`cover` 虽填满画布，却把真实产品 UI 和关键文字裁掉。两种自动适配均未作为交付版本。
- 最终采用同一个可编辑的竖版编辑舞台 Motion Graphic：`Nomi Vertical Editorial Stage`（Asset `dbcb4604-45ce-4cb9-b02d-05b6902c8a0d`）。中文 Item `cb056a387f`，英文 Item `898244afef`。
- 产品证据段完整保留 16:9 产品窗口，不裁核心 UI；上下留白改造成暖纸编辑版式，承载章节编号、标题、进度与字幕安全区。Hook、集成桥和 CTA 使用原生 9:16 全屏构图。
- 中文 Hook 初检发现末字换行，字号从 94 调至 82 后重新渲染检查；中英文接触表均覆盖 Hook、六个产品章节、集成桥与 CTA。
- 竖版没有复制一套独立动效代码：中英文复用同一个 Motion Graphic，仅以实例属性适配语言。

### 官网 15 秒静音循环版

- 时间线：`05-Web-Hero-Silent`，1920×1080、30 fps、450 帧。
- Motion Graphic：`Nomi Web Hero Silent Loop`（Asset `fe2c65ff-47e2-4475-9378-5cf4e64e8bf9`，Item `8d7de5bd4e`），全长覆盖 0–449 帧。
- V1 只保留四段真实产品证据：故事 / 分镜、视觉锚点、画布导演、时间线结果；0–29 帧为暖纸 Hook，390–449 帧为下载与企业服务 CTA。
- 首尾都回到同一暖纸基底，循环边界无黑闪；字幕被禁用，所有原旁白、配乐和音效条目均已移除。
- H.264 导出仍封装了一条 AAC 静音流；最终 MP4 实测 `mean_volume=-91.0 dB`、`max_volume=-91.0 dB`，属于数字静音，不存在可闻内容。

### X 安全画幅英文竖版

- X 网页端的官方竖版上限为 1200×1900；标准 1080×1920 社交版高出 20 像素，因此没有把同一文件冒险用于 X。
- 从英文竖版派生时间线 `06-EN-X-Safe-1068x1900`（`c4237e73-ce47-4f80-b63f-e5bab0167005`），保持原始 9:16 比例的视觉意图，并将输出改为 1068×1900、30 fps、1800 帧。
- 导出前检查 0 / 60 / 600 / 1320 / 1730 / 1799 帧；导出后再次从最终 MP4 抽取相同叙事节点组成接触表。Hook、产品窗口、集成桥、字幕和 CTA 均无裁切或越界。
- 标准 1080×1920 英文版继续用于 Shorts / Reels / TikTok；1068×1900 只承担 X 发布，避免用一个折中文件污染其他平台的原生画幅。

### 派生版本导出与最终 MP4 QA

| 版本 | Render ID | 本地文件 | 媒体事实 | 音频事实 | 结论 |
|---|---|---|---|---|---|
| 中文 9:16 | `f95b597b3e` | `/Users/aoqimin/Downloads/Nomi-Launch-Film-CN-Social-9x16.mp4` | 1080×1920，H.264，30 fps，60.096 s，11,496,855 bytes | AAC 48 kHz 双声道；mean -21.0 dB，peak -4.5 dB | 通过最终接触表；文字、字幕、产品窗口与 CTA 均在安全区 |
| 英文 9:16 | `0977e8f3dd` | `/Users/aoqimin/Downloads/Nomi-Launch-Film-EN-Social-9x16.mp4` | 1080×1920，H.264，30 fps，60.096 s，12,219,390 bytes | AAC 48 kHz 双声道；mean -20.6 dB，peak -2.1 dB | 通过最终接触表；英文长句没有越界或被裁 |
| 英文 X 安全竖版 | `a8b15ff5ad` | `/Users/aoqimin/Downloads/Nomi-Launch-Film-EN-X-Safe-1068x1900.mp4` | 1068×1900，H.264，30 fps，60.096 s，9,971,277 bytes | AAC 48 kHz 双声道；mean -20.6 dB，peak -2.1 dB | 通过最终接触表；符合 X 网页端 1200×1900 上限，关键内容均在安全区 |
| 官网静音循环 | `f89f9c6d75` | `/Users/aoqimin/Downloads/Nomi-Web-Hero-Silent-15s.mp4` | 1920×1080，H.264，30 fps，15.083 s，5,216,827 bytes | AAC 48 kHz 双声道；mean / peak 均 -91.0 dB | 通过最终接触表；无黑帧、无可闻音频、首尾暖纸基底一致 |

### 字幕文件

- 中文 SRT：Render `9fb82f5abd`，`/Users/aoqimin/Downloads/Nomi-Launch-Film-CN.srt`，87 行。
- 英文 SRT：Render `7a74ba3e0b`，`/Users/aoqimin/Downloads/Nomi-Launch-Film-EN.srt`，86 行。
- 两份 SRT 均从各自 16:9 母版的 Caption Singleton 导出；抽查开头时间码与语义分句正确。
