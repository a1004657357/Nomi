// 技能库单卡（画廊式，对齐提示词库的卡片语言）。token-only：颜色/圆角/字号全走设计系统。
// 用户技能可删；内置技能只读（删除位显「内置 · 只读」）。画布组件可点击或拖入，普通技能仍在创作区运行。
import React from 'react'
import {
  IconAlertTriangle,
  IconBox,
  IconBoxMultiple,
  IconCheck,
  IconDownload,
  IconGripVertical,
  IconLock,
  IconPanoramaHorizontal,
  IconPhoto,
  IconRoute,
  IconTrash,
  IconVideo,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../design'
import {
  providerLabel,
  skillCapabilityFor,
  type SkillListItemDto,
  type SkillProviderKind,
} from '../api/skillApi'
import {
  CANVAS_SKILL_DRAG_MIME,
  encodeCanvasSkillDrag,
  isCanvasSkill,
} from '../generationCanvas/skills/canvasSkillModel'
import {
  canvasSkillComponentPresentation,
  type CanvasSkillComponentKind,
} from './skillComponentPresentation'

const COMPONENT_ICONS = {
  image: IconPhoto,
  video: IconVideo,
  scene: IconPanoramaHorizontal,
  multiview: IconBoxMultiple,
  model3d: IconBox,
  workflow: IconRoute,
} satisfies Record<CanvasSkillComponentKind, typeof IconPhoto>

export function SkillCard({
  skill,
  available,
  onUse,
  onExport,
  onDelete,
  showManagementActions = true,
}: {
  skill: SkillListItemDto
  available: ReadonlySet<SkillProviderKind>
  onUse: (skill: SkillListItemDto) => void
  onExport: (skill: SkillListItemDto) => void
  onDelete: (skill: SkillListItemDto) => void
  showManagementActions?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const providerName = (kind: SkillProviderKind): string =>
    t(`libraries.skill.provider.${kind}` as 'libraries.skill.provider.text')
  const cap = skillCapabilityFor(skill, available)
  const isUser = skill.origin === 'user'
  const canvasEnabled = isCanvasSkill(skill)
  const component = canvasSkillComponentPresentation(skill)
  const ComponentIcon = COMPONENT_ICONS[component.kind]

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-nomi border border-nomi-line bg-nomi-paper p-3')}
      data-skill-key={skill.name}
      data-capability-recipe-id={
        skill.canvas?.recipeIds.length === 1 ? skill.canvas.recipeIds[0] : undefined
      }
      data-canvas-skill-enabled={canvasEnabled ? 'true' : 'false'}
      data-canvas-component-kind={canvasEnabled ? component.kind : undefined}
      draggable={canvasEnabled}
      title={canvasEnabled ? '拖到生成画布，或点击“添加到画布”' : undefined}
      onDragStart={(event) => {
        if (!canvasEnabled) return
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(CANVAS_SKILL_DRAG_MIME, encodeCanvasSkillDrag(skill))
      }}
    >
      <div className={cn('flex items-center gap-2')}>
        {canvasEnabled ? (
          <IconGripVertical size={14} stroke={1.7} className={cn('shrink-0 cursor-grab text-nomi-ink-30')} />
        ) : null}
        <ComponentIcon size={15} stroke={1.5} className={cn('shrink-0 text-nomi-ink-60')} />
        <span className={cn('flex-1 min-w-0 truncate text-body-sm font-medium text-nomi-ink')}>{skill.label}</span>
        {canvasEnabled ? (
          <span className={cn('shrink-0 rounded-full bg-nomi-accent-soft px-2 py-0.5 text-micro text-nomi-accent')}>
            {component.label}
          </span>
        ) : skill.isPlaybook ? (
          <span className={cn('shrink-0 rounded-full bg-nomi-accent-soft px-2 py-0.5 text-micro text-nomi-accent')}>
            {t('libraries.skill.playbookStages', { count: skill.stageLabels.length })}
          </span>
        ) : (
          <span className={cn('shrink-0 rounded-full bg-nomi-ink-05 px-2 py-0.5 text-micro text-nomi-ink-60')}>
            {t('libraries.skill.assistant')}
          </span>
        )}
      </div>

      {skill.description ? (
        <p className={cn('text-caption text-nomi-ink-60 line-clamp-2')}>{skill.description}</p>
      ) : (
        <p className={cn('text-caption text-nomi-ink-40')}>{t('libraries.skill.noDescription')}</p>
      )}

      {skill.neededProviders.length > 0 && (
        <div className={cn('flex flex-wrap items-center gap-2')}>
          {skill.neededProviders.map((kind) => {
            const ok = !cap.missing.includes(kind)
            return (
              <span
                key={kind}
                className={cn(
                  'inline-flex items-center gap-0.5 text-micro',
                  ok ? 'text-workbench-success' : 'text-nomi-ink-40',
                )}
              >
                {ok ? <IconCheck size={11} stroke={2} /> : <IconAlertTriangle size={11} stroke={2} />}
                {providerName(kind)}
              </span>
            )
          })}
        </div>
      )}

      <div className={cn('mt-0.5 flex items-center gap-1 border-t border-nomi-line-soft pt-2')}>
        <button
          type="button"
          data-skill-use="true"
          onClick={() => onUse(skill)}
          className={cn(
            'shrink-0 whitespace-nowrap rounded-nomi-sm px-2 py-1 text-caption text-nomi-accent hover:bg-nomi-accent-soft transition-colors',
          )}
        >
          {canvasEnabled ? '添加到画布' : '在创作区用'}
        </button>
        <span className={cn('flex-1')} />
        {showManagementActions ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onExport(skill)}
                  aria-label={`导出 ${skill.label}`}
                  className={cn('shrink-0 w-7 h-7 grid place-items-center rounded-nomi-sm text-nomi-ink-60 hover:text-nomi-ink hover:bg-nomi-ink-05 transition-colors')}
                >
                  <IconDownload size={14} stroke={1.7} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">导出技能包</TooltipContent>
            </Tooltip>
            {isUser ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onDelete(skill)}
                    aria-label={`删除 ${skill.label}`}
                    className={cn('shrink-0 w-7 h-7 grid place-items-center rounded-nomi-sm text-nomi-ink-60 hover:text-workbench-danger hover:bg-nomi-ink-05 transition-colors')}
                  >
                    <IconTrash size={14} stroke={1.7} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">删除技能</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    aria-label="内置技能，只读"
                    className={cn('shrink-0 w-7 h-7 grid place-items-center text-nomi-ink-30')}
                  >
                    <IconLock size={14} stroke={1.7} />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">内置技能 · 只读</TooltipContent>
              </Tooltip>
            )}
          </>
        ) : (
          <span className={cn('text-micro text-nomi-ink-40')}>拖到画布</span>
        )}
      </div>
    </div>
  )
}
