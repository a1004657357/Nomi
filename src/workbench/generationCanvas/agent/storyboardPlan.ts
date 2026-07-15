import { z } from 'zod'
import type { BuiltinCanvasCategoryId, GenerationCanvasEdgeMode } from '../model/generationCanvasTypes'

/**
 * 「分镜方案」中间表示（IR）—— 剧本→方案文档→确认→落画布 主链路的中枢。
 * 方案：`docs/plan/2026-06-13-storyboard-plan-document-flow.md`（§1.1 字段、决策 B=结构化字段视图）。
 *
 * planner 第一手产出这个**结构化对象**（不是自由文本），创作区把它渲染成可改的字段卡
 * （字段直接绑这个对象，改字段即改对象，无「文字→结构」解析），用户确认后
 * `storyboardPlanToCreateNodesArgs` 把它转成 create_canvas_nodes 参数落画布。
 */

/** 锚类型：跨镜头要一致的东西。character/scene/prop 默认视觉锚；style 默认文本锚（每镜常驻）。 */
export type PlanAnchorKind = 'character' | 'scene' | 'prop' | 'style'

/** 载体：视觉锚=生成参考图挂参考槽；文本锚=描述拼进引用它的镜头 prompt（prompt 能说清的就别生成图）。 */
export type PlanAnchorCarrier = 'visual' | 'text'

export type PlanAnchor = {
  /** 稳定 id；落画布时直接当 create_canvas_nodes 的 clientId。 */
  id: string
  kind: PlanAnchorKind
  /** 「林夏」「天台」「红书包」「全片风格」——镜头按名引用、也是卡片标题。 */
  name: string
  /** 标准描述：视觉锚 → 卡片/定妆 prompt；文本锚 → 拼进引用镜头的 prompt。 */
  description: string
  carrier: PlanAnchorCarrier
  /** all=每镜常驻（风格/品牌）；selective=被点名才用（角色/场景/道具）。缺省按 kind 推。 */
  scope?: 'all' | 'selective'
  /**
   * 同一锚要在「一张定妆卡/场景卡」里并列呈现的变体/状态（用户拍板：AI 猜 + 手改）。
   * 角色：如「成年」「童年」「战损」；场景：如「白天远景」「夜晚近景」。
   * 落画布时拼进卡片提示词的「变体行」，让多视图+多变体集中在一张图里、整张喂参考。
   */
  variants?: string[]
}

export type PlanShot = {
  index: number
  /**
   * 该镜种类：'image'=图片分镜（落 image 节点、无时长、绑图片模型）；'video'=视频分镜（落 video 节点、带时长）。
   * 缺省（旧草稿无此字段）按 'video' 兜底以保持既有行为；新计划由拆镜头开关/planner 显式标注
   * （用户拍板：拆镜头默认出图片分镜）。图片镜头满意后可经「转视频」升成视频镜头（S2）。
   */
  shotKind?: 'image' | 'video'
  /** 该镜时长(秒)；仅视频镜头用——落画布写进视频节点 duration 参数，按所选模型控件钳值。图片镜头忽略。 */
  durationSec: number
  /** 这镜用到哪些锚（按 anchor.id 引用）→ 视觉锚连参考边、文本锚拼 prompt。 */
  anchorIds: string[]
  /** 兼容旧项目的提示词字段；新方案优先使用 imagePrompt / videoPrompt。 */
  prompt: string
  /** 关键帧/图片生成提示词：静态画面、构图、景别、主体姿态。 */
  imagePrompt?: string
  /** 视频生成提示词：动作演进、运镜、节奏、时长感，不复述静态锚描述。 */
  videoPrompt?: string
  /** 场景/地点：表格主列；可与 scene anchor 同名，也可写更具体的空间位置。 */
  scene?: string
  /** 景别：远景/全景/中景/近景/特写等。 */
  shotSize?: string
  /** 机位：正面/侧面/俯拍/仰拍/过肩/主观等。 */
  cameraAngle?: string
  /** 运镜：固定/推/拉/摇/移/跟拍/环绕/手持等。 */
  cameraMove?: string
  /** 出镜角色，逗号分隔或自然语言均可。 */
  characters?: string
  /** 人物表演/动作调度。 */
  performance?: string
  /** 角色对白；后续可接字幕/配音，不并入备注。 */
  dialogue?: string
  /** 道具/关键物件。 */
  props?: string
  /** 音乐/环境声/音效。 */
  sound?: string
  /** 不直接参与默认生成的补充说明。 */
  notes?: string
  /** 用户在分镜编辑器为该镜选的视频模型 catalog key；没选 → 落画布用默认视频模型兜底。 */
  modelKey?: string
  /** 用户为该镜选的模型模式 id（随 modelKey 一起）；没选 → 默认模式。 */
  modeId?: string
  /** 用户为该镜调的模型参数（archetype 控件键 → 值，如 aspect_ratio/resolution）；落画布铺进节点 meta。留空=用模型默认。 */
  params?: Record<string, unknown>
}

export type StoryboardPlan = {
  title: string
  anchors: PlanAnchor[]
  shots: PlanShot[]
}

export const SCREEN_VISIBILITY_PROMPT_RULE = [
  '屏幕可见性硬规则：只有当镜头明确是屏幕面朝镜头、主观视角、过肩视角、屏幕特写或可见屏幕反射时，才允许描述手机/电脑/平板屏幕内容。',
  '如果人物正面面对镜头，而手机/电脑背面或侧面朝向镜头，屏幕不可见；prompt 必须写背壳、边框、手持姿势和人物视线，禁止写「屏幕上显示…」、UI、文字或任何屏幕内容。',
  '如果剧情必须交代屏幕内容，改成单独的屏幕特写/过肩镜头，或明确写「屏幕面朝镜头」。不要在同一镜头里同时写「设备背对镜头」和「屏幕内容可见」。',
].join('\n')

// ── 校验 schema：planner 产出/落库前的运行时守卫（也是 S3 激活时交给 LLM 的工具参数 schema）──
//
// 与上方手写类型同形：手写类型带字段级 JSDoc（语义文档，z.infer 会丢），故两者并存；
// 下方编译期守卫保证二者互相赋值兼容，防 schema 与类型漂移（P1 单一真相源的轻量落地）。

export const planAnchorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['character', 'scene', 'prop', 'style']),
  name: z.string().min(1),
  description: z.string(),
  carrier: z.enum(['visual', 'text']),
  scope: z.enum(['all', 'selective']).optional(),
  variants: z
    .array(z.string())
    .optional()
    .describe(
      '同一锚需要并列在一张定妆卡/场景卡里的变体/状态。仅当剧情里该角色/场景有明显形态差异时填，' +
        '如角色「成年」「童年」，场景「白天远景」「夜晚近景」；没有就省略。',
    ),
})

export const planShotSchema = z.object({
  index: z.number().int(),
  shotKind: z
    .enum(['image', 'video'])
    .optional()
    .describe("镜头种类:'image'=图片分镜(图生图静态画面,无时长),'video'=视频分镜(带时长运镜)。默认 image。"),
  durationSec: z.number(),
  anchorIds: z.array(z.string()),
  prompt: z.string(),
  imagePrompt: z.string().optional(),
  videoPrompt: z.string().optional(),
  scene: z.string().optional(),
  shotSize: z.string().optional(),
  cameraAngle: z.string().optional(),
  cameraMove: z.string().optional(),
  characters: z.string().optional(),
  performance: z.string().optional(),
  dialogue: z.string().optional(),
  props: z.string().optional(),
  sound: z.string().optional(),
  notes: z.string().optional(),
  modelKey: z.string().optional(),
  modeId: z.string().optional(),
  params: z.record(z.unknown()).optional(),
})

export const storyboardPlanSchema = z.object({
  title: z.string(),
  anchors: z.array(planAnchorSchema),
  shots: z.array(planShotSchema),
})

// 编译期漂移守卫：仅当 zod 推断类型 ⟺ 手写类型互相可赋值时才编译通过（零运行时）。
const _planSchemaToType = (p: z.infer<typeof storyboardPlanSchema>): StoryboardPlan => p
const _planTypeToSchema = (p: StoryboardPlan): z.infer<typeof storyboardPlanSchema> => p
void _planSchemaToType
void _planTypeToSchema

/**
 * 落库前校验方案对象。planner 产出经 backend zod 已过一道，渲染层再守一道——
 * 防直接调用 / 未来别的入口绕过 backend 时灌入畸形对象（throw，调用方映射成 tool error）。
 */
export function parseStoryboardPlan(raw: unknown): StoryboardPlan {
  return storyboardPlanSchema.parse(raw)
}

// ── 落画布转换器：StoryboardPlan → create_canvas_nodes 参数（纯函数，可单测）──

/** create_canvas_nodes 节点参数（镜像 canvasTools.plannedNodeSchema 的渲染层用子集）。 */
export type PlanCreatedNode = {
  clientId: string
  kind: string
  title: string
  prompt: string
  modelKey?: string
  modeId?: string
  params?: Record<string, string | number | boolean>
  /** 参考卡身份（角色/场景/道具锚）：落画布写进 node.meta.referenceSheet → 永不占镜头编号（shotNumbering）。 */
  referenceSheet?: true
  /** 分镜组总控卡：落画布写进 node.meta.storyboardGroup，用于把一组镜头标成同一脚本入口。 */
  storyboardGroup?: true
  /** 分镜表节点快照：让画布节点本身保留可恢复脚本数据。 */
  storyboardPlanSnapshot?: StoryboardPlan
}

export type PlanCreatedEdge = {
  sourceClientId: string
  targetClientId: string
  mode?: GenerationCanvasEdgeMode
}

export type PlanCreateNodesArgs = {
  summary: string
  nodes: PlanCreatedNode[]
  edges: PlanCreatedEdge[]
  /**
   * 前 anchorCount 个 node 是参考卡（角色/场景/道具，按构造序先 push），其余是镜头。
   * 落画布时交给 layoutStoryboardNodes 做「参考行在上 + 镜头折行网格」布局——道具锚 kind=image
   * 与镜头 image 无法靠 kind 区分，故由域层用计数显式给出角色边界。
   */
  anchorCount: number
  /**
   * 整批强制落进同一分类（用户拍板：一个分镜方案的角色/场景/镜头落在一起）。
   * 不设则按 kind 各归各类（cast/scene/shots）——agent 直接建卡仍走 kind 默认。
   * 设 'shots'：角色/场景与镜头同处「分镜」视图，参考边同屏可见可连、谁没生成一眼看到，
   * 且不破坏编号（character/scene kind 不参与 shotIndex，见 model/shotNumbering.ts）。
   */
  groupCategoryId?: BuiltinCanvasCategoryId
}

export type StoryboardPlanToArgsOptions = {
  /** 定妆卡/场景卡默认图片模型（偏好 GPT Image 2，通用解析）；调用方传入，不在此硬编码目录。 */
  defaultImageModelKey?: string
  /** 定妆卡（纯文生）默认模式 id；调用方传入。 */
  defaultImageModeId?: string
  /** （图片）图生图模式 id：保留给定妆卡变体等场景；调用方传入。 */
  defaultImageRefModeId?: string
  /** 镜头默认视频模型（用户没在编辑器为该镜选模型时兜底，通用解析偏好 Seedance）；调用方传入。 */
  defaultVideoModelKey?: string
  /** 镜头默认视频模式 id（优先带 image_ref/first_frame 槽的 i2v，定妆卡参考才喂得进）；调用方传入。 */
  defaultVideoModeId?: string
}

const VISUAL_KINDS: ReadonlySet<PlanAnchorKind> = new Set(['character', 'scene', 'prop'])

/** 锚类型 → 该锚连到镜头的参考边语义。 */
function edgeModeForAnchor(kind: PlanAnchorKind): GenerationCanvasEdgeMode {
  if (kind === 'character') return 'character_ref'
  if (kind === 'scene' || kind === 'style') return 'style_ref'
  return 'reference' // prop 走通用参考槽（无道具专用 mode）
}

/**
 * 锚类型 → 画布节点种类。角色/场景有专用卡；**道具无专用节点种类 → 用 image（通用参考图节点）**
 * ——直接用 'prop' 当 kind 会让画布 registry 查不到定义而崩（defaultSize undefined，R13 真机抓出）。
 * 道具落进哪个分类是 S4 的精修（补道具锚），这里先保证落得下、不崩。
 */
function anchorKindToNodeKind(kind: PlanAnchorKind): string {
  if (kind === 'character') return 'character'
  if (kind === 'scene') return 'scene'
  return 'image' // prop（style 是文本锚，不走到这）
}

function shotClientId(shot: PlanShot): string {
  return `shot-${shot.index}`
}

function firstNonEmptyText(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) return text
  }
  return ''
}

export function storyboardShotImagePrompt(shot: PlanShot): string {
  return firstNonEmptyText(shot.imagePrompt, shot.prompt, buildStoryboardShotImagePrompt(shot))
}

export function storyboardShotVideoPrompt(shot: PlanShot): string {
  return firstNonEmptyText(shot.videoPrompt, shot.prompt, shot.imagePrompt, buildStoryboardShotVideoPrompt(shot))
}

export function storyboardShotPromptForKind(shot: PlanShot): string {
  return (shot.shotKind === 'image' ? storyboardShotImagePrompt(shot) : storyboardShotVideoPrompt(shot)).trim()
}

function compactShotField(label: string, value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? `${label}：${text}` : ''
}

function shotFieldText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finitePositiveDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function shotKeywordLine(shot: PlanShot): string {
  return [
    compactShotField('场景', shot.scene),
    compactShotField('景别', shot.shotSize),
    compactShotField('机位', shot.cameraAngle),
    compactShotField('运镜', shot.cameraMove),
    compactShotField('角色', shot.characters),
    compactShotField('表演', shot.performance),
    compactShotField('对白', shot.dialogue),
    compactShotField('道具', shot.props),
    compactShotField('声音', shot.sound),
    compactShotField('备注', shot.notes),
  ].filter(Boolean).join('；')
}

export function buildDetailedStoryboardShotVideoPrompt(shot: PlanShot): string {
  const duration = finitePositiveDuration(shot.durationSec)
  const durationText = duration ? `${duration} 秒` : '约 5 秒'
  const scene = shotFieldText(shot.scene)
  const shotSize = shotFieldText(shot.shotSize)
  const cameraAngle = shotFieldText(shot.cameraAngle)
  const cameraMove = shotFieldText(shot.cameraMove)
  const characters = shotFieldText(shot.characters)
  const performance = shotFieldText(shot.performance)
  const dialogue = shotFieldText(shot.dialogue)
  const props = shotFieldText(shot.props)
  const sound = shotFieldText(shot.sound)
  const notes = shotFieldText(shot.notes)
  const imagePrompt = shotFieldText(shot.imagePrompt)
  const legacyPrompt = shotFieldText(shot.prompt)
  const keywordLine = shotKeywordLine(shot)
  const movement = cameraMove || '稳定自然运镜，保持主体连续清晰'
  const framing = [shotSize || '清晰可读的电影构图', cameraAngle || '自然平视机位'].join('，')
  const subject = characters || '画面主体'
  const action = performance || legacyPrompt || imagePrompt || '按分镜意图完成一个清晰、连贯、可读的动作段落'
  const opening = scene
    ? `开场建立在「${scene}」中，先让环境、光线和主体位置清楚可见。`
    : '开场先建立空间关系、光线方向和主体位置。'
  const middle = `中段让「${subject}」执行动作：${action}。动作要有起势、停顿和细微反应，不要突然跳变。`
  const ending = props
    ? `结尾把注意力收束到「${props}」与主体动作的关系上，保留一瞬稳定画面作为剪辑点。`
    : '结尾保留一瞬稳定画面作为剪辑点，主体姿态和视线保持连贯。'

  const lines = [
    `视频生成提示词：镜头 ${shot.index}，时长 ${durationText}，${framing}，${movement}。`,
    keywordLine ? `关键词：${keywordLine}` : '',
    imagePrompt ? `首帧基准：${imagePrompt}` : '',
    legacyPrompt && legacyPrompt !== imagePrompt ? `原始分镜意图：${legacyPrompt}` : '',
    scene
      ? `场景画面：地点是「${scene}」，需要明确空间层次、前后景关系、光线来源和真实物理尺度。`
      : '场景画面：明确空间层次、前后景关系、光线来源和真实物理尺度。',
    `构图机位：使用「${framing}」，主体在画面中的位置稳定，边缘不要裁切关键肢体或关键道具。`,
    `运镜节奏：${movement}；镜头运动要平滑、有重量感，速度随动作自然变化，不要机械漂移。`,
    `动作时间线：0-1 秒，${opening} 1-${duration ? Math.max(2, Math.round(duration * 0.65)) : 3} 秒，${middle} 最后 1 秒，${ending}`,
    props ? `道具细节：${props} 必须在正确位置出现，和角色手部、视线或动作发生明确关系，不能凭空变形或消失。` : '',
    dialogue ? `对白处理：角色说「${dialogue}」，只表现自然口型和情绪，不要在画面中生成字幕、UI 或多余文字。` : '',
    sound ? `声音氛围：${sound}；画面节奏要和声音情绪一致。` : '',
    notes ? `导演备注：${notes}` : '',
    '画面约束：保持角色外观、服装、道具、场景和光线连续一致；避免人物脸部漂移、手部畸形、道具穿帮、画面闪烁、无关文字、水印和突然切镜。',
  ].filter(Boolean)
  const prompt = lines.join('\n')
  return needsScreenVisibilityRule(prompt) ? [prompt, SCREEN_VISIBILITY_PROMPT_RULE].join('\n') : prompt
}

function buildStoryboardShotImagePrompt(shot: PlanShot): string {
  return [
    compactShotField('场景', shot.scene),
    compactShotField('景别', shot.shotSize),
    compactShotField('机位', shot.cameraAngle),
    compactShotField('角色', shot.characters),
    compactShotField('表演', shot.performance),
    compactShotField('道具', shot.props),
    compactShotField('画面备注', shot.notes),
  ].filter(Boolean).join('\n')
}

function buildStoryboardShotVideoPrompt(shot: PlanShot): string {
  return [
    compactShotField('场景', shot.scene),
    compactShotField('景别', shot.shotSize),
    compactShotField('机位', shot.cameraAngle),
    compactShotField('运镜', shot.cameraMove),
    compactShotField('角色', shot.characters),
    compactShotField('表演与动作演进', shot.performance),
    compactShotField('对白', shot.dialogue),
    compactShotField('道具', shot.props),
    compactShotField('声音', shot.sound),
    compactShotField('节奏备注', shot.notes),
  ].filter(Boolean).join('\n')
}

/**
 * 定妆卡/场景卡提示词构造（R6 调研落地：把图当「版面/网格」描述，先锁身份再列视图，
 * 中性背景+平光+小标签，多视图+多变体集中一张图，整张喂参考视频）。GPT Image 2 尤擅此类多面板版面。
 * 视觉锚（character/scene/prop）→ 卡片大图；变体（成年/童年、白天/夜晚…）拼进「变体行」。
 */
export function buildAnchorSheetPrompt(anchor: PlanAnchor): string {
  const name = anchor.name.trim()
  const desc = anchor.description.trim()
  const variantLine =
    anchor.variants && anchor.variants.length
      ? `\n变体行：${anchor.variants.map((v) => v.trim()).filter(Boolean).join('、')}（每个变体各占一格并在格下标注）。`
      : ''
  if (anchor.kind === 'scene') {
    return [
      '场景参考卡（environment reference sheet）。横向版面、分格清晰、每格下方小标签，统一色调与光源。',
      `同一地点「${name}」：${desc}`,
      '角度：①远景 establishing ②近景细节 ③俯视 overhead ④四分之三视。' + variantLine,
      '要求：跨格保持同一地点与风格一致；避免人物入镜、避免风格漂移、避免格子合并。',
    ].join('\n')
  }
  if (anchor.kind === 'prop') {
    return [
      '道具参考卡。白色中性背景、平光、分格清晰、每格下方小标签。',
      `同一物件「${name}」：${desc}`,
      '视图：①正面 ②侧面 ③细节特写。' + variantLine,
      '要求：跨格保持同一物件一致；避免场景化背景、避免风格漂移、避免格子合并。',
    ].join('\n')
  }
  // character（默认）
  return [
    '角色定妆参考卡（character reference sheet）。白色中性背景、平光、横向版面、分格清晰、每格下方小标签。',
    `同一角色「${name}」，跨所有格保持脸型、发型、服装、标志物完全一致：${desc}`,
    '视图：①正面全身 A-Pose ②侧面 ③背面 ④四分之三侧 ⑤表情行（中性 / 微笑 / 愤怒）。' + variantLine,
    '要求：跨格五官与服装一致；避免格子合并、避免跨格漂移、避免场景化背景。',
  ].join('\n')
}

/** 文本锚的描述拼进引用它的镜头 prompt（「能 prompt 说清的就别生成图」的落地：文本锚 = 写进 prompt）。 */
function buildShotPrompt(shot: PlanShot, anchorById: Map<string, PlanAnchor>): string {
  const textAnchors = shot.anchorIds
    .map((id) => anchorById.get(id))
    .filter((anchor): anchor is PlanAnchor => Boolean(anchor) && anchor!.carrier === 'text')
  const textBits = textAnchors
    .map((anchor) => `${anchor.name}：${anchor.description}`.trim())
    .filter(Boolean)
  const base = storyboardShotPromptForKind(shot)
  const prompt = textBits.length ? [base, ...textBits].filter(Boolean).join('\n') : base
  const screenRuleProbe = [
    base,
    ...textAnchors
      .filter((anchor) => anchor.kind !== 'style')
      .map((anchor) => `${anchor.name}：${anchor.description}`.trim()),
  ].join('\n')
  return needsScreenVisibilityRule(screenRuleProbe) ? [prompt, SCREEN_VISIBILITY_PROMPT_RULE].filter(Boolean).join('\n') : prompt
}

function needsScreenVisibilityRule(prompt: string): boolean {
  const normalized = prompt
    .replace(/没有带?手机/g, '')
    .replace(/没有(?:任何)?(?:手机|屏幕|电脑|显示器|笔记本|平板|界面|UI)/g, '')
    .replace(/无(?:手机|屏幕|电脑|显示器|笔记本|平板|界面|UI)/g, '')
    .replace(/\bno\s+(?:phone|screen|computer|monitor|laptop|tablet|ui)\b/gi, '')
  return /手机|屏幕|电脑|显示器|笔记本|平板|界面|UI|phone|screen|computer|monitor|laptop|tablet/i.test(normalized)
}

function buildStoryboardGroupPrompt(plan: StoryboardPlan): string {
  const lines = plan.shots
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((shot) => {
      const image = storyboardShotImagePrompt(shot)
      const video = storyboardShotVideoPrompt(shot)
      return [
        `镜头 ${shot.index}：${shot.shotKind === 'image' ? '图片' : '视频'}${shot.durationSec ? ` / ${shot.durationSec}s` : ''}`,
        compactShotField('  场景', shot.scene),
        compactShotField('  景别', shot.shotSize),
        compactShotField('  机位', shot.cameraAngle),
        compactShotField('  运镜', shot.cameraMove),
        compactShotField('  角色', shot.characters),
        compactShotField('  表演', shot.performance),
        compactShotField('  对白', shot.dialogue),
        compactShotField('  道具', shot.props),
        compactShotField('  声音', shot.sound),
        compactShotField('  备注', shot.notes),
        image ? `  图片提示词：${image}` : '',
        video ? `  视频提示词：${video}` : '',
      ].filter(Boolean).join('\n')
    })
  return [`分镜组：${plan.title.trim() || '未命名分镜'}`, `共 ${plan.shots.length} 个镜头`, '', ...lines].join('\n')
}

/**
 * 确认后：把方案转成 create_canvas_nodes 参数，照常走 applyCanvasToolCall 落画布
 * （复用现有建节点+连边+依赖波次「参考层先生成」，零重写）。
 * - 视觉锚（character/scene/prop）→ 卡片节点（image）；文本锚（style 等）不建节点、描述拼进镜头 prompt。
 * - 每镜按 shotKind 分支：图片镜头 → image 节点（无时长、绑图片模型）；视频镜头 → video 节点（带时长、绑视频模型）。
 *   缺省 shotKind 按 video 兜底（旧草稿兼容）；引用的视觉锚 → 参考边（图片/视频镜头都连，锁身份）。
 *   模型：用户在编辑器为该镜选的 modelKey/modeId 优先，没选 → 按种类取默认图片/视频模型兜底。
 * - **不连 shot→shot 链**：视频→视频会落到尚未实现的「首帧接力抽帧」必裸跑；镜头连贯靠共享定妆卡/场景卡参考。
 */
export function storyboardPlanToCreateNodesArgs(
  plan: StoryboardPlan,
  options: StoryboardPlanToArgsOptions = {},
): PlanCreateNodesArgs {
  const anchorById = new Map(plan.anchors.map((anchor) => [anchor.id, anchor]))
  const nodes: PlanCreatedNode[] = []
  const edges: PlanCreatedEdge[] = []

  nodes.push({
    clientId: 'storyboard-group',
    kind: 'text',
    title: `分镜组：${plan.title.trim() || '未命名分镜'}`,
    prompt: buildStoryboardGroupPrompt(plan),
    storyboardGroup: true,
    storyboardPlanSnapshot: plan,
  })

  // 视觉锚 → 定妆卡/场景卡节点（clientId = anchor.id）。prompt 用「卡片大图」构造器：
  // 多视图+多变体集中一张图、整张喂参考（用户拍板）。图片模型锁 GPT Image 2（调用方传入）。
  for (const anchor of plan.anchors) {
    if (anchor.carrier !== 'visual' || !VISUAL_KINDS.has(anchor.kind)) continue
    nodes.push({
      clientId: anchor.id,
      kind: anchorKindToNodeKind(anchor.kind),
      title: anchor.name,
      prompt: buildAnchorSheetPrompt(anchor),
      // 参考卡永不占镜号（道具锚 kind=image 落 shots 分类，不标记会吃掉「镜头 1/2」，R13 抓出）。
      referenceSheet: true,
      ...(options.defaultImageModelKey ? { modelKey: options.defaultImageModelKey } : {}),
      ...(options.defaultImageModeId ? { modeId: options.defaultImageModeId } : {}),
    })
  }

  // 锚已全部 push 完，此刻节点数 = 分镜组总控卡 + 参考卡数（镜头随后 push）→ 落画布布局的角色边界。
  const anchorCount = nodes.length

  // 镜头 → video 节点（用户拍板 B-clean）+ 定妆卡参考边。时长写进 duration 参数。
  // 按 shot.index 排序后再建节点（审计 A5 防御）：布局按数组顺序排格子，若 LLM 把镜头
  // 乱序吐出来，画布空间顺序就会与镜头编号错位（镜6 排在镜5 前）。这里钉死「数组序=镜序」。
  const orderedShots = [...plan.shots].sort((a, b) => a.index - b.index)
  for (const shot of orderedShots) {
    const id = shotClientId(shot)
    // 镜头种类分支（用户拍板：拆镜头默认图片分镜）。缺省无 shotKind → 按 video 兜底（旧草稿兼容）。
    const isImageShot = shot.shotKind === 'image'
    // 该镜引用的视觉锚（定妆卡）——连 character_ref/style_ref/reference 参考边。
    // 视频镜头：图→视频 i2v 参考；图片镜头：图→图 参考（同样锁角色/场景身份，图片模型的参考槽）。
    const visualAnchorIds = shot.anchorIds.filter((anchorId) => {
      const anchor = anchorById.get(anchorId)
      return Boolean(anchor) && anchor!.carrier === 'visual' && VISUAL_KINDS.has(anchor!.kind)
    })
    // 图片镜头绑图片模型默认、视频镜头绑视频模型默认；用户在编辑器为该镜选的 modelKey 永远优先。
    const defaultModelKey = isImageShot ? options.defaultImageModelKey : options.defaultVideoModelKey
    const defaultModeId = isImageShot ? options.defaultImageModeId : options.defaultVideoModeId
    const modelKey = shot.modelKey || defaultModelKey
    // 用户为该镜选了具体模型 → 不套默认模型的 modeId（会张冠李戴）；留空让 buildPlannedNodeMeta
    // 按所选模型自己取默认模式。只有用默认模型时才用默认 modeId。
    const modeId = shot.modeId || (shot.modelKey ? undefined : defaultModeId)
    nodes.push({
      clientId: id,
      // 图片镜头 → image 节点（纯图生图静态画面，无 duration）；视频镜头 → video 节点（带 duration）。
      kind: isImageShot ? 'image' : 'video',
      title: `镜头 ${shot.index}`,
      prompt: buildShotPrompt(shot, anchorById),
      ...(modelKey ? { modelKey } : {}),
      ...(modeId ? { modeId } : {}),
      // duration 仅视频镜头写（由卡的「时长」选择器管）；图片镜头不写。其余模型参数（比例/清晰度/负向…）来自 shot.params。
      params: {
        ...(shot.params || {}),
        ...(!isImageShot && Number.isFinite(shot.durationSec) ? { duration: shot.durationSec } : {}),
      },
    })
    // 定妆卡 → 这一镜参考边（角色 character_ref / 场景·风格 style_ref / 道具 reference）。图片/视频镜头都连。
    for (const anchorId of visualAnchorIds) {
      const anchor = anchorById.get(anchorId)!
      edges.push({ sourceClientId: anchorId, targetClientId: id, mode: edgeModeForAnchor(anchor.kind) })
    }
    // B-clean：不连 shot→shot 链（视频→视频参考会落到尚未实现的首帧接力抽帧 → 必裸跑）。
    // 镜头连贯靠共享的定妆卡/场景卡参考（同一批镜头引用同一组锚 → 视觉一致）。
  }

  // 整批落「分镜」分类：角色/场景与镜头同处一个视图，参考边同屏可见可连（用户拍板 A）。
  return { summary: plan.title.trim() || '分镜方案', nodes, edges, anchorCount, groupCategoryId: 'shots' }
}
