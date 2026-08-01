import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import CreationAiPanel from './CreationAiPanel'
import WorkbenchEditor from './WorkbenchEditor'
import StoryboardPlanEditor from './storyboard/StoryboardPlanEditor'
import StoryboardScriptPanel from './storyboard/StoryboardScriptPanel'
import StoryboardScriptShortcutButton from './storyboard/StoryboardScriptShortcutButton'
import { NomiAILabel, WorkbenchButton } from '../../design'
import { useWorkbenchStore } from '../workbenchStore'

export default function CreationWorkspace(): JSX.Element {
  const { t } = useTranslation()
  // 创作助手默认展开成编辑器右侧的 344px 侧栏（用户拍板 2026-07-25：回到 3c2fe821 之前的常驻右栏）。
  // 收起态放 store（非本地 useState）→ 跨页面/跨导航不重置，收起「粘住」（根治 3c2fe821 本地 useState 每次进页重置的问题）。
  const collapsed = useWorkbenchStore((s) => s.creationAiCollapsed)
  const setCollapsed = useWorkbenchStore((s) => s.setCreationAiCollapsed)
  // 一次性信号：打开示例/新项目时自动展开助手，让「拆镜头」CTA 一眼可见，消费后清掉。
  const autoOpen = useWorkbenchStore((s) => s.creationAssistantAutoOpen)
  const setAutoOpen = useWorkbenchStore((s) => s.setCreationAssistantAutoOpen)
  const storyboardEditorOpen = useWorkbenchStore((s) => s.storyboardEditorOpen)
  const storyboardScriptOpen = useWorkbenchStore((s) => s.storyboardScriptOpen)
  React.useEffect(() => {
    if (autoOpen) {
      setCollapsed(false)
      setAutoOpen(false)
    }
  }, [autoOpen, setAutoOpen, setCollapsed])

  return (
    <section
      className={cn(
        'workbench-creation relative',
        'w-full h-full min-w-0 min-h-0',
        'pt-[22px] px-6 pb-6',
        'bg-workbench-bg',
        collapsed
          ? 'grid max-w-[900px] mx-auto'
          : cn(
              'grid grid-cols-[minmax(0,1fr)_344px] max-w-[1264px] mx-auto gap-5',
              'max-[1120px]:grid-cols-[minmax(0,1fr)] max-[1120px]:grid-rows-[minmax(420px,1fr)_minmax(320px,42vh)]',
            ),
      )}
      aria-label={t('creationAi.workspace.aria')}
    >
      {storyboardEditorOpen ? (
        <StoryboardPlanEditor />
      ) : storyboardScriptOpen ? (
        <StoryboardScriptPanel />
      ) : (
        <WorkbenchEditor />
      )}
      {!storyboardEditorOpen && !storyboardScriptOpen ? (
        <StoryboardScriptShortcutButton className="absolute top-[22px] left-6 z-[20]" label="查看分镜脚本" />
      ) : null}
      {collapsed ? (
        <WorkbenchButton
          className={cn(
            'absolute top-[22px] right-6 z-[20]',
            'inline-flex items-center gap-2 h-9 pl-[10px] pr-[14px]',
            'border border-nomi-line rounded-full bg-nomi-paper text-nomi-ink',
            'text-body-sm font-medium shadow-nomi-sm cursor-pointer',
            'hover:shadow-nomi-md hover:-translate-y-px',
          )}
          aria-label={t('creationAi.workspace.expandAssistant')}
          onClick={() => setCollapsed(false)}
        >
          <NomiAILabel markSize={18} wordSize={13} suffix={t('creationAi.workspace.assistantSuffix')} />
        </WorkbenchButton>
      ) : (
        <CreationAiPanel onCollapse={() => setCollapsed(true)} />
      )}
    </section>
  )
}
