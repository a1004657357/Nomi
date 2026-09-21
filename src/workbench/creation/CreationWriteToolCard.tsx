import { useTranslation } from 'react-i18next'
import { IconCursorText, IconFilePlus, IconReplace } from '@tabler/icons-react'
import { WorkbenchButton } from '../../design'
import { cn } from '../../utils/cn'
import { writeToolLabelKey } from './creationAiReplyText'
import type { PendingDocToolCall, WriteToolName } from './creationTurnController'

function writeToolIcon(name: WriteToolName): JSX.Element {
  if (name === 'insert_at_cursor') return <IconCursorText size={13} />
  if (name === 'replace_selection') return <IconReplace size={13} />
  return <IconFilePlus size={13} />
}

export default function CreationWriteToolCard({ call, editorReady, onApply, onReject }: {
  call: PendingDocToolCall
  editorReady: boolean
  onApply: (call: PendingDocToolCall) => void
  onReject: (toolCallId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'workbench-creation-ai__tool-call',
        'flex flex-col gap-2 p-3 rounded-nomi border border-nomi-accent-soft bg-nomi-accent-soft/40',
      )}
      data-tool-call-id={call.toolCallId}
    >
      <div className={cn('workbench-creation-ai__tool-call-head', 'inline-flex items-center gap-[6px] text-nomi-accent text-caption font-medium')}>
        {writeToolIcon(call.toolName)}
        {t(writeToolLabelKey(call.toolName))}
      </div>
      <div className={cn('workbench-creation-ai__tool-call-body', 'max-h-[160px] overflow-auto text-nomi-ink text-body-sm leading-[1.5] whitespace-pre-wrap')}>
        {call.content || t('creationAi.emptyContent')}
      </div>
      <div className={cn('flex items-center justify-end gap-2 mt-1')}>
        <WorkbenchButton
          className={cn('h-7 px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-caption cursor-pointer hover:bg-nomi-ink-05')}
          onClick={() => onReject(call.toolCallId)}
        >
          {t('creationAi.reject')}
        </WorkbenchButton>
        <WorkbenchButton
          className={cn('h-7 px-3 rounded-nomi-sm border-0 bg-nomi-ink text-nomi-paper text-caption cursor-pointer hover:bg-nomi-accent disabled:cursor-not-allowed disabled:opacity-45')}
          data-primary="true"
          disabled={!editorReady}
          onClick={() => onApply(call)}
        >
          {t('creationAi.apply')}
        </WorkbenchButton>
      </div>
    </div>
  )
}
