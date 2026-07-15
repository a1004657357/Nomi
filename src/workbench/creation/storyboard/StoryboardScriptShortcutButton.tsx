import React from 'react'
import { IconFileText } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { hasStoryboardScriptSource } from './storyboardScriptViewModel'

type Props = {
  className?: string
  label?: string
}

export default function StoryboardScriptShortcutButton({ className, label = '分镜脚本' }: Props): JSX.Element | null {
  const plan = useWorkbenchStore((s) => s.storyboardPlan)
  const nodes = useGenerationCanvasStore((s) => s.nodes)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)
  const setStoryboardScriptOpen = useWorkbenchStore((s) => s.setStoryboardScriptOpen)

  if (!hasStoryboardScriptSource(plan, nodes)) return null
  if (nodes.some((node) => node.meta?.storyboardGroup === true)) return null

  return (
    <WorkbenchButton
      variant="default"
      size="sm"
      className={cn('shadow-nomi-sm', className)}
      onClick={() => {
        setWorkspaceMode('creation')
        setStoryboardScriptOpen(true)
      }}
    >
      <IconFileText size={14} stroke={1.7} />
      {label}
    </WorkbenchButton>
  )
}
