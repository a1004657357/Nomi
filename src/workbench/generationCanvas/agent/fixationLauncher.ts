/**
 * 剧本 → 定妆/定景 launcher（Tier2，复刻 storyboardLauncher 模式）。
 *
 * 创作 AI 面板的「提取设定」入口 / 自然语言触发调 `requestFixationPlanning(text)`；
 * 生成画布的 assistant 面板在同一 window 事件通道上监听，跑 fixation planner skill：
 * 读剧本 → 为主要角色/场景/道具建卡节点 + 注入参考板提示词 → 用户在 AgentPlanCard 确认落地。
 *
 * 用 window CustomEvent（而非共享 zustand 切片），让 launcher 跨 React 生命周期可用
 * （切换 workspace mode 时面板会重挂）。与 storyboardLauncher 同构。
 */

export const FIXATION_PLANNING_EVENT = 'nomi:generation:fixation:request' as const

export type FixationPlanningRequest = {
  /** 用户在创作区写的剧本全文（或选中段）。 */
  storyText: string
  /** 来源标签（analytics / UI）。 */
  source?: string
}

export const FIXATION_PLANNER_SKILL = {
  key: 'workbench.fixation.planner',
  name: '剧本设定提取',
} as const

/** 发给 fixation planner agent 的用户消息（方法论在 skill 正文，这里只递剧本 + 一句指令）。 */
export function buildFixationPlanningMessage(storyText: string): string {
  const trimmed = storyText.trim()
  return [
    '请从下面这段剧本里结构化识别主要角色、关键场景和推动剧情的重要道具，为每项创建一张独立参考卡并写好对应参考图提示词。',
    '角色卡使用 kind=character、categoryId=cast；场景卡使用 kind=scene、categoryId=scene；道具卡使用 kind=image、categoryId=prop。只创建待审阅节点，不调用生成。',
    '',
    '--- 剧本正文 ---',
    trimmed,
    '--- 剧本正文结束 ---',
  ].join('\n')
}

/** 派发定妆规划请求。返回是否有监听器（assistant 面板）已挂载，供调用方决定是否回退提示。 */
export function requestFixationPlanning(request: FixationPlanningRequest): boolean {
  if (typeof window === 'undefined') return false
  const event = new CustomEvent<FixationPlanningRequest>(FIXATION_PLANNING_EVENT, { detail: request })
  return window.dispatchEvent(event)
}
