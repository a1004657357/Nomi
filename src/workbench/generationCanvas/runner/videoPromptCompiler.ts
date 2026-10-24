import { screenVisibilityRuleForPrompt } from '../../../../electron/shared/storyboard/storyboardShotPrompts'

export const VIDEO_PROMPT_COMPILER_MARKER = '【Nomi 视频编译约束】'

export type VideoPromptReferenceStrategy =
  | 'text_only'
  | 'first_frame'
  | 'full_reference'
  | 'reference'

export type CompileVideoPromptInput = {
  prompt: string
  strategy: VideoPromptReferenceStrategy
  referenceImageRoles?: readonly string[]
  referenceImageCount?: number
}

/**
 * 提交前的确定性视频 prompt 编译。它不改写剧情，只把实际发送的参考图用途、动作下限和
 * 连续性约束附到用户/Agent prompt 后，确保网页桥和 API 路径收到同一份导演语义。
 */
export function compileVideoPromptForReferences(input: CompileVideoPromptInput): string {
  const prompt = input.prompt.trim()
  if (!prompt || prompt.includes(VIDEO_PROMPT_COMPILER_MARKER)) return prompt

  const count = Math.max(0, input.referenceImageCount ?? input.referenceImageRoles?.length ?? 0)
  const roles = (input.referenceImageRoles || [])
    .slice(0, count || undefined)
    .map((role) => role.trim())
    .filter(Boolean)
  const lines = [VIDEO_PROMPT_COMPILER_MARKER]

  if (input.strategy === 'first_frame') {
    lines.push('参考绑定：实际发送的单张图片是视频唯一首帧和动作起点；保持其中的人物身份、服装、场景、道具数量、机位与初始空间关系，从该状态连续发展。')
  } else if (input.strategy === 'full_reference') {
    lines.push('参考绑定：以下图片按编号分别使用，不得互换用途；分镜构图图只锁定景别、机位、空间关系和动作意图，不作为首帧，允许为动作重新组织构图。')
    if (roles.length) {
      roles.forEach((role, index) => lines.push(`参考图 ${index + 1}：${role}`))
    } else if (count > 0) {
      lines.push(`共发送 ${count} 张参考图，只按提示词明确的身份、场景、道具或构图用途使用。`)
    }
  } else if (input.strategy === 'reference' && count > 0) {
    lines.push('参考绑定：参考图只用于提示词明确的身份、场景、道具或构图用途，不自动把任意一张参考图当作首帧。')
    roles.forEach((role, index) => lines.push(`参考图 ${index + 1}：${role}`))
  }

  if (!/动作时间线|动作链/.test(prompt)) {
    lines.push('动作下限：前 2 秒内开始一个明确动作链，包含动作起势、执行过程和可见结果；动作结果在镜头结束前稳定成立。')
  }
  if (!/不是照片动效|禁止只靠眨眼|禁止.*画面缩放/.test(prompt)) {
    lines.push('叙事下限：这是真实叙事视频，不是照片动效；禁止用眨眼、呼吸、头发飘动、粒子、画面缩放或轻微推镜替代主要动作。')
  }
  if (!/不凭空增减|数量守恒|不得复制/.test(prompt)) {
    lines.push('连续性下限：人物和关键道具数量守恒，不复制、不瞬移、不变形、不凭空增减；接触、受力、遮挡和落点必须连续。')
  }
  const screenRule = screenVisibilityRuleForPrompt(prompt)
  if (screenRule) lines.push(screenRule)

  return [prompt, lines.join('\n')].join('\n\n')
}
