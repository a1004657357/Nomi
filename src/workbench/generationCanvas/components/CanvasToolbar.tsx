import React from 'react'
import { IconBolt, IconPlayerStopFilled } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { getQuickAddGenerationNodePlugins } from '../nodes/renderRegistry'
import { cancelAllGenerationRuns } from '../runner/generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { CanvasPerformancePreference } from './canvasNodeLevelOfDetail'

const QUICK_ADD_NODE_ITEMS = getQuickAddGenerationNodePlugins()

// Single source of truth for the手动「添加节点」set — used by BOTH the left
// toolbar and the right-click menu so they never diverge. The其它 quickAdd kinds
// (角色/场景/关键帧/镜头/输出) are created by the agent / storyboard flow, not by
// manual add — keeping this list short de-clutters the right-click menu.
// 2026-06-15：左侧栏瘦身为「纯创建节点」——复制/剪切走快捷键(⌘C/⌘X)、批量生成移到选中浮条、
// 发送到时间轴删除(节点可直接拖入时间轴)。这里只保留可手动新建的节点种类（含新增的「声音」）。
const PRIMARY_NODE_KINDS: GenerationNodeKind[] = [
  'text',
  'image',
  'video',
  'audio',
  'model3d',
  'output',
  'compare',
  'whiteboard',
  'panorama',
  'scene3d',
  'vibingDirector',
]
const PRIMARY_ADD_ITEMS = PRIMARY_NODE_KINDS.map((kind) =>
  QUICK_ADD_NODE_ITEMS.find((item) => item.kind === kind),
).filter((item): item is (typeof QUICK_ADD_NODE_ITEMS)[number] => Boolean(item))

type NodeAddMenuProps = {
  className?: string
  style?: React.CSSProperties
  kinds?: GenerationNodeKind[]
  extraItems?: Array<{
    key: string
    label: string
    icon: React.ReactNode
    onClick: () => void
  }>
  onAddNode: (kind: GenerationNodeKind) => void
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
}

export function NodeAddMenu({
  className,
  style,
  kinds,
  extraItems = [],
  onAddNode,
  onContextMenu,
  onPointerDown,
}: NodeAddMenuProps): JSX.Element {
  const items = React.useMemo(() => {
    if (!kinds?.length) return PRIMARY_ADD_ITEMS
    const allowed = new Set(kinds)
    return PRIMARY_ADD_ITEMS.filter((item) => allowed.has(item.kind))
  }, [kinds])
  return (
    <div
      className={cn(
        'generation-canvas-v2-toolbar__node-menu',
        'absolute top-0 left-[calc(100%+8px)] grid gap-1 w-[132px] p-[6px]',
        'border border-workbench-border rounded-nomi',
        'bg-nomi-paper shadow-workbench-pop',
        className,
      )}
      role="menu"
      aria-label="添加节点菜单"
      style={style}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
    >
      {extraItems.map((item) => (
        <button
          type="button"
          key={item.key}
          className={cn(
            'inline-flex items-center justify-start gap-1.5',
            'w-full h-8 min-h-8 px-2 border-0 rounded-nomi',
            'bg-workbench-surface-solid text-workbench-ink font-[inherit] text-caption cursor-pointer',
            'hover:bg-nomi-ink-05',
            '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-nomi-ink-60 [&>svg]:stroke-[1.8]',
          )}
          role="menuitem"
          aria-label={`添加${item.label}节点`}
          onClick={item.onClick}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            type="button"
            key={item.kind}
            className={cn(
              'inline-flex items-center justify-start gap-1.5',
              'w-full h-8 min-h-8 px-2 border-0 rounded-nomi',
              'bg-workbench-surface-solid text-workbench-ink font-[inherit] text-caption cursor-pointer',
              'hover:bg-nomi-ink-05',
              '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-nomi-ink-60 [&>svg]:stroke-[1.8]',
            )}
            role="menuitem"
            aria-label={`添加${item.menuLabel}节点`}
            onClick={() => onAddNode(item.kind)}
          >
            <Icon size={14} stroke={1.6} />
            <span>{item.menuLabel}</span>
          </button>
        )
      })}
    </div>
  )
}

type CanvasToolbarProps = {
  // 只给「期望落点」（视口锚换算的画布坐标）；真实 AABB 碰撞避让统一收口在 store.addNode。
  getInsertionPosition: () => { x: number; y: number }
  categoryId?: string
  capabilityControl?: React.ReactNode
  performancePreference: CanvasPerformancePreference
  performanceActive: boolean
  onTogglePerformancePreference: () => void
}

export default function CanvasToolbar({
  getInsertionPosition,
  categoryId,
  capabilityControl,
  performancePreference,
  performanceActive,
  onTogglePerformancePreference,
}: CanvasToolbarProps): JSX.Element {
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const hasActiveGeneration = useGenerationCanvasStore((state) =>
    state.nodes.some((node) => node.status === 'queued' || node.status === 'running'),
  )

  const handleAddNode = (kind: GenerationNodeKind) => {
    addNode({ kind, position: getInsertionPosition(), categoryId })
  }

  return (
    <div
      className={cn(
        'generation-canvas-v2-toolbar',
        'absolute top-1/2 left-4 z-[8] inline-flex flex-col items-center gap-1 p-[6px]',
        'border border-workbench-border rounded-nomi',
        'bg-nomi-paper shadow-workbench-md -translate-y-1/2',
      )}
      aria-label="生成画布工具栏"
    >
      {PRIMARY_ADD_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <button
            type="button"
            key={item.kind}
            className={cn(
              'grid size-8 min-h-8 place-items-center rounded-nomi-sm border-0 bg-transparent p-0 text-nomi-ink-60 cursor-pointer',
              'transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink',
              '[&>svg]:size-[18px] [&>svg]:stroke-[1.8]',
            )}
            aria-label={`添加${item.menuLabel}节点`}
            title={item.menuLabel}
            onClick={() => handleAddNode(item.kind)}
          >
            <Icon size={18} stroke={1.6} />
            <span className="hidden">{item.menuLabel}</span>
          </button>
        )
      })}
      {capabilityControl ? (
        <>
          <span className="my-0.5 h-px w-5 bg-workbench-border" aria-hidden="true" />
          {capabilityControl}
        </>
      ) : null}
      <span className="my-0.5 h-px w-5 bg-workbench-border" aria-hidden="true" />
      <button
        type="button"
        className={cn(
          'relative grid size-8 min-h-8 place-items-center rounded-nomi-sm border-0 p-0 cursor-pointer',
          'transition-colors hover:bg-nomi-ink-05',
          performancePreference === 'smooth'
            ? 'bg-nomi-accent-soft text-nomi-accent'
            : 'bg-transparent text-nomi-ink-60',
        )}
        aria-label={performancePreference === 'smooth' ? '关闭流畅模式，改为自动优化' : '开启流畅模式'}
        aria-pressed={performancePreference === 'smooth'}
        title={performancePreference === 'smooth' ? '流畅模式：已开启' : '性能：自动优化'}
        onClick={onTogglePerformancePreference}
      >
        <IconBolt size={17} stroke={1.8} aria-hidden />
        {performanceActive ? (
          <span
            className="absolute right-1 top-1 size-1.5 rounded-full bg-nomi-accent"
            aria-hidden="true"
          />
        ) : null}
      </button>
      {hasActiveGeneration ? (
        <button
          type="button"
          className={cn(
            'mt-1 grid size-8 min-h-8 place-items-center rounded-nomi-sm border-0 border-t border-workbench-border bg-transparent p-0 text-workbench-danger cursor-pointer',
            'transition-colors hover:bg-workbench-danger-soft hover:text-workbench-danger',
            '[&>svg]:size-[17px]',
          )}
          aria-label="停止全部生成"
          title="停止全部生成"
          onClick={() => cancelAllGenerationRuns()}
        >
          <IconPlayerStopFilled size={17} />
        </button>
      ) : null}
    </div>
  )
}
