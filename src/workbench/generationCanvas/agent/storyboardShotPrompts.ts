import type { PlanShot } from './storyboardPlan'

export const SCREEN_VISIBILITY_PROMPT_RULE = [
  '屏幕可见性硬规则：只有当镜头明确是屏幕面朝镜头、主观视角、过肩视角、屏幕特写或可见屏幕反射时，才允许描述手机/电脑/平板屏幕内容。',
  '如果人物正面面对镜头，而手机/电脑背面或侧面朝向镜头，屏幕不可见；prompt 必须写背壳、边框、手持姿势和人物视线，禁止写「屏幕上显示…」、UI、文字或任何屏幕内容。',
  '如果剧情必须交代屏幕内容，改成单独的屏幕特写/过肩镜头，或明确写「屏幕面朝镜头」。不要在同一镜头里同时写「设备背对镜头」和「屏幕内容可见」。',
].join('\n')

function firstNonEmptyText(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) return text
  }
  return ''
}

export function storyboardShotImagePrompt(shot: PlanShot): string {
  return firstNonEmptyText(shot.imagePrompt, shot.keyframe?.prompt, shot.ffDesc, shot.prompt, buildStoryboardShotImagePrompt(shot))
}

export function storyboardShotVideoPrompt(shot: PlanShot): string {
  const explicitVideoPrompt = firstNonEmptyText(shot.videoPrompt)
  // 旧版确定性扩写把所有参考图都写成“唯一首帧”。当节点切到全能参考时必须重编，
  // 否则模式虽正确，提示词仍会要求模型锁死构图，继续产出照片动效。
  if (
    usesFullReferenceMode(shot) &&
    isDerivedVideoPrompt(explicitVideoPrompt) &&
    /首帧继承|唯一视觉起点|图生视频导演提示词/.test(explicitVideoPrompt)
  ) {
    return buildDetailedStoryboardShotVideoPrompt(shot)
  }
  if (explicitVideoPrompt) return explicitVideoPrompt

  // 不能再把 imagePrompt/静态 prompt 直接当视频 prompt。只要分镜表已有导演字段或
  // 关键帧描述，就从结构化信息重编动作时间线、运镜与物理连续性；纯旧项目里本来就含
  // 动作和运镜的一条 prompt 仍原样保留，避免无谓改写历史内容。
  const hasStructuredVideoDirection = [
    shot.scene,
    shot.shotSize,
    shot.cameraAngle,
    shot.cameraMove,
    shot.characters,
    shot.performance,
    shot.dialogue,
    shot.props,
    shot.sound,
    shot.notes,
  ].some((value) => Boolean(shotFieldText(value)))
  if (hasStructuredVideoDirection || shotFieldText(shot.imagePrompt)) {
    return buildDetailedStoryboardShotVideoPrompt(shot)
  }
  return firstNonEmptyText(shot.prompt, buildStoryboardShotVideoPrompt(shot))
}

export function storyboardShotPromptForKind(shot: PlanShot): string {
  return (shot.shotKind === 'image' ? storyboardShotImagePrompt(shot) : storyboardShotVideoPrompt(shot)).trim()
}

export function compactShotField(label: string, value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? `${label}：${text}` : ''
}

function shotFieldText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finitePositiveDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function isDerivedVideoPrompt(value: string): boolean {
  return /^(?:图生|文生)?视频导演提示词：|^视频生成提示词：/.test(value)
}

function formatPromptTime(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function dialogueDirection(dialogue: string): string {
  if (!dialogue) return ''
  if (/画外音|旁白|后期(?:统一)?(?:口播|配音)|无现场对白/.test(dialogue)) {
    return `声音与口型：${dialogue}；这是后期声音，不驱动角色口型。人物保持闭口、自然呼吸和符合情境的微表情，画面内不生成字幕或UI。`
  }
  return `对白表演：角色说「${dialogue}」；口型只跟随这句对白，先有视线和呼吸反应再开口，不生成字幕、UI或额外台词。`
}

function usesFullReferenceMode(shot: PlanShot): boolean {
  return /^(?:omni|multimodal|character|reference)$/i.test(shotFieldText(shot.modeId))
}

export function buildDetailedStoryboardShotVideoPrompt(shot: PlanShot): string {
  const duration = finitePositiveDuration(shot.durationSec)
  const totalDuration = duration ?? 5
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
  const hasImageReference = Boolean(imagePrompt)
  const fullReference = hasImageReference && usesFullReferenceMode(shot)
  const movement = cameraMove || '稳定自然运镜，保持主体连续清晰'
  const framing = [shotSize || '清晰可读的电影构图', cameraAngle || '自然平视机位'].join('，')
  const subject = characters || '画面主体'
  const storyIntent = legacyPrompt && !isDerivedVideoPrompt(legacyPrompt) ? legacyPrompt : ''
  const action = performance || storyIntent || '按剧情目的完成一个清晰、连贯、可读的动作段落'
  const firstBeatEnd = Math.min(1, Math.max(0.2, totalDuration * 0.15), totalDuration * 0.35)
  const settleStart = Math.max(firstBeatEnd, totalDuration - Math.min(1, totalDuration * 0.2))
  const firstBeatLabel = formatPromptTime(firstBeatEnd)
  const settleStartLabel = formatPromptTime(settleStart)
  const totalLabel = formatPromptTime(totalDuration)
  const plannedCuts = /切|转场/.test(cameraMove)
  const referenceStrategy = fullReference
    ? '全能参考策略：角色参考图只锁定身份、脸、发型和服装；场景参考图锁定空间、材质、色调和固定参照物；道具参考图锁定造型与尺度；分镜图片只表达景别、机位、空间关系和动作意图，不作为首帧，不要求像素级复刻。允许模型为动作重新组织构图。'
    : hasImageReference
      ? '首帧继承：以已连接的首帧作为唯一视觉起点，继承构图、人物身份与服装、场景、光线和道具初始位置；不要重建或重新设计这些静态信息。'
      : `视觉建立：${scene ? `地点为「${scene}」；` : ''}使用「${framing}」，先明确空间关系、光线方向和主体初始位置。`
  const openingAction = fullReference
    ? `0-${firstBeatLabel} 秒，最强、最清楚的主体动作立即开始，不用静止画面或“缓缓推进”做铺垫；主体直接执行「${action}」的起势，并让动作目标在前 2 秒内可读。`
    : `0-${firstBeatLabel} 秒，保持起始关系，主体完成视线、重心和动作起势，主动作随即发生。`

  const lines = [
    `${fullReference ? '全能参考视频' : hasImageReference ? '图生视频' : '文生视频'}导演提示词：镜头 ${shot.index}，时长 ${durationText}。`,
    storyIntent ? `剧情目的：${storyIntent}` : '',
    referenceStrategy,
    `表演动机：主体为「${subject}」。动作不是摆拍展示，而是为了完成剧情中的具体任务；表演内容：${action}`,
    `表演层次：先由视线确认动作目标，再发生呼吸、重心与肩肘变化，最后由手部完成动作。每个动作只发生一次，保留真实的起势、受力、短暂停顿和收势；微表情服从人物处境，不夸张、不机械。`,
    `动作时间线：${openingAction}${firstBeatLabel}-${settleStartLabel} 秒，完成主要动作并让动作造成的位移、道具状态或人物反应清晰可见；${settleStartLabel}-${totalLabel} 秒，动作结果稳定成立，保留自然呼吸、视线余韵和可剪辑的结束姿态。`,
    `运镜响应：${movement}；摄影机在主体动作启动后再响应，不抢先运动。速度变化要有加速、减速和停稳，保持参考图的空间轴线与主体尺度，避免无目的漂移。`,
    `光影运动：光线必须响应主体动作或摄影机位移，遮挡、反光、阴影或光斑随运动连续变化；禁止把光影写成静止背景装饰。`,
    `运动下限：这是一段真实叙事视频，不是照片动效。禁止只靠眨眼、呼吸、头发飘动、热气、粒子或轻微推镜冒充主要动作；主体必须完成「${action}」并产生可见结果。`,
    props
      ? `道具物理：涉及「${props}」。必须先发生准确接触，道具才随手部或身体移动；保持重量、惯性、承重、遮挡和落点连续，手指不穿模，道具不瞬移、不变形、不凭空增减。`
      : '',
    dialogueDirection(dialogue),
    sound ? `声音节奏参考：${sound}；仅用来约束动作节拍与情绪，不在画面内生成声音说明文字。` : '',
    notes ? `导演备注：${notes}` : '',
    `连续性约束：锁定参考图中的脸型、服装、道具造型、场景参照物、光线方向和色彩；${fullReference ? '构图可以随动作与运镜重新组织，不把分镜图锁成首帧。' : '保持首帧空间轴线和主体尺度。'}避免身份漂移、手部畸形、肢体穿插、动作重复、背景呼吸、画面闪烁、无关文字和水印；${plannedCuts ? '只允许按既定运镜描述中的切点切换，不增加额外镜头。' : '全段保持单镜连续，不突然切镜。'}`,
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
  ]
    .filter(Boolean)
    .join('\n')
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
  ]
    .filter(Boolean)
    .join('\n')
}

export function needsScreenVisibilityRule(prompt: string): boolean {
  const normalized = prompt
    .replace(/没有带?手机/g, '')
    .replace(/没有(?:任何)?(?:手机|屏幕|电脑|显示器|笔记本|平板|界面|UI)/g, '')
    .replace(/无(?:手机|屏幕|电脑|显示器|笔记本|平板|界面|UI)/g, '')
    .replace(/\bno\s+(?:phone|screen|computer|monitor|laptop|tablet|ui)\b/gi, '')
  return /手机|屏幕|电脑|显示器|笔记本|平板|界面|UI|phone|screen|computer|monitor|laptop|tablet/i.test(normalized)
}
