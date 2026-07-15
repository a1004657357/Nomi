/**
 * 分镜规划师的技能标识 + 用户消息构造。
 *
 * 触发入口在创作区 AI 助手（说「拆镜头」）→ 调 runStoryboardPlanner 就地跑（流程 A：不切区）。
 * 原先经 window CustomEvent 把请求甩到生成区助手面板的「事件桥」已删除——规划改在创作区原地完成，
 * 产出 propose_storyboard_plan 落创作 store，编辑器随即在创作区主列展开。
 */

import { SCREEN_VISIBILITY_PROMPT_RULE, type StoryboardPlan } from './storyboardPlan'

export const STORYBOARD_PLANNER_SKILL = {
  key: 'workbench.storyboard.planner',
  name: '故事板规划师',
} as const

/**
 * 构造交给分镜规划师的用户消息。技能体（SKILL.md）已含完整方法论，这里只把剧本正文
 * 包好递进去，附一句指令。
 *
 * 两种模式（P0-9 Slice 3）：
 * - 首次拆镜头：传 storyText，规划整份方案。
 * - 修改现方案：传 currentPlan + revisionRequest，规划师基于现方案按要求改、保留其余，重出整份。
 */
/** 拆镜头模式：image=图片分镜（每镜静态画面，默认）；video=视频分镜（每镜带时长）。 */
export type StoryboardShotMode = 'image' | 'video'

/** 按模式给 planner 的镜头种类硬指令（首拆注入；改方案不注入——保留现方案里每镜已定的 shotKind）。 */
function shotModeDirective(mode: StoryboardShotMode): string {
  if (mode === 'video') {
    return [
      '本次拆的是**视频分镜**：每个 shot 的 shotKind 必须填 "video"，按方法论给时长（durationSec）、运镜与动作演进，modelKey 从可用清单里选视频模型。',
      '每个 shot 必须尽量填写结构化列：scene（场景）、shotSize（景别）、cameraAngle（机位）、cameraMove（运镜）、characters（角色）、performance（人物表演）、dialogue（对白，无则留空）、props（道具）、sound（音乐/音效）、notes（备注）。',
      '每个 shot 同时填写 imagePrompt 和 videoPrompt：imagePrompt 写首帧/关键帧静态画面；videoPrompt 写动作演进、运镜、节奏和时长感。prompt 字段镜像 videoPrompt，兼容旧链路。',
    ].join('\n')
  }
  return [
    '本次拆的是**图片分镜**（不是视频分镜）：每个 shot 的 shotKind 必须填 "image"，durationSec 一律填 0。',
    '每个 shot 必须尽量填写结构化列：scene（场景）、shotSize（景别）、cameraAngle（机位）、cameraMove 填“固定”或留空、characters（角色）、performance（人物姿态/表演）、dialogue 留空或只记剧情对白、props（道具）、sound 留空或只记备注、notes（备注）。',
    'imagePrompt 写**一张静态画面**——构图/景别/光线/人物姿态与表情/环境，**禁止**写运镜（推拉摇跟）、动作演进、转场、时长感、台词/字幕/声音；prompt 字段镜像 imagePrompt，兼容旧链路。',
    'modelKey 从可用模型清单里选**图片模型**（不是视频模型）；清单里没有合适的图片模型就留空（系统用默认图片模型兜底）。',
  ].join('\n')
}

export function buildStoryboardPlanningMessage(input: {
  storyText?: string
  currentPlan?: StoryboardPlan | null
  revisionRequest?: string
  shotMode?: StoryboardShotMode
}): string {
  if (input.currentPlan && input.revisionRequest?.trim()) {
    return [
      '用户正在审阅你之前产出的分镜方案，现在要求你修改它。请基于下面的「当前方案」按用户要求改——',
      '**只改用户点名要改的部分，其余镜头/锚/已选模型/镜号一律原样保留**；改完通过 propose_storyboard_plan 重新产出**整份**方案（不是增量、不是片段）。',
      '如果用户要求改景别、机位、运镜、对白、音乐、表演、道具或备注，请优先改对应的 scene/shotSize/cameraAngle/cameraMove/characters/performance/dialogue/props/sound/notes 字段，再同步必要的 imagePrompt/videoPrompt。',
      '',
      SCREEN_VISIBILITY_PROMPT_RULE,
      '',
      '--- 当前方案(JSON) ---',
      JSON.stringify(input.currentPlan),
      '--- 当前方案结束 ---',
      '',
      '--- 用户的修改要求 ---',
      input.revisionRequest.trim(),
      '--- 修改要求结束 ---',
    ].join('\n')
  }
  const trimmed = (input.storyText || '').trim()
  return [
    '请把下面这段故事规划成一份「分镜方案」（跨镜头要一致的角色/场景/道具/风格 + 每个镜头），通过 propose_storyboard_plan 产出结构化方案对象——先给用户在创作区审阅、修改，不要直接写画布。',
    '',
    shotModeDirective(input.shotMode ?? 'image'),
    '',
    SCREEN_VISIBILITY_PROMPT_RULE,
    '',
    '--- 故事正文 ---',
    trimmed,
    '--- 故事正文结束 ---',
  ].join('\n')
}
