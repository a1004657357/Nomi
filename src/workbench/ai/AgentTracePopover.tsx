import React from 'react'
import { IconAlertCircle, IconCheck, IconRefresh, IconRoute } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { getActiveWorkbenchProjectId } from '../project/workbenchProjectSession'
import { ConversationHistoryPopover } from './ConversationHistoryPopover'
import { buildAgentTraceTurns, type AgentTraceTurn } from './agentTraceViewModel'

function durationLabel(durationMs: number | null): string {
  if (durationMs === null) return ''
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`
}

export function AgentTraceList({ turns }: { turns: AgentTraceTurn[] }): JSX.Element {
  if (!turns.length) {
    return <div className="px-3 py-8 text-center text-caption text-nomi-ink-40">暂无 Agent 运行记录</div>
  }
  return (
    <div className="max-h-[420px] overflow-y-auto">
      {turns.map((turn) => (
        <div key={turn.sessionId} className="border-b border-nomi-line-soft px-3 py-3 last:border-b-0">
          <div className="flex items-center gap-2">
            {turn.status === 'running' ? (
              <IconRefresh size={14} className="shrink-0 animate-spin text-nomi-accent" />
            ) : turn.status === 'error' ? (
              <IconAlertCircle size={14} className="shrink-0 text-workbench-danger" />
            ) : (
              <IconCheck size={14} className="shrink-0 text-workbench-success" />
            )}
            <span className="min-w-0 flex-1 truncate text-caption font-semibold text-nomi-ink">
              {turn.skillKey || 'Nomi Agent'}
            </span>
            <span className="shrink-0 text-micro text-nomi-ink-40">
              {turn.stepCount} 步{turn.durationMs !== null ? ` · ${durationLabel(turn.durationMs)}` : ''}
            </span>
          </div>
          {turn.vendorKey || turn.modelKey ? (
            <div className="mt-1 truncate text-micro text-nomi-ink-60">
              {[turn.vendorKey, turn.modelKey].filter(Boolean).join(' · ')}
            </div>
          ) : null}
          {turn.stageLabel ? <div className="mt-1 text-micro text-nomi-accent">{turn.stageLabel}</div> : null}
          {turn.promptHead ? <div className="mt-1 line-clamp-2 text-caption leading-relaxed text-nomi-ink-70">{turn.promptHead}</div> : null}
          {turn.toolNames.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {turn.toolNames.map((toolName) => (
                <span key={toolName} className="rounded-nomi-sm bg-nomi-ink-05 px-1.5 py-0.5 text-micro text-nomi-ink-60">
                  {toolName}
                </span>
              ))}
            </div>
          ) : null}
          {turn.error ? <div className="mt-1 line-clamp-2 text-micro text-workbench-danger">{turn.error}</div> : null}
        </div>
      ))}
    </div>
  )
}

export function AgentTraceAction({ actionClassName }: { actionClassName?: string }): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [turns, setTurns] = React.useState<AgentTraceTurn[]>([])
  const [loading, setLoading] = React.useState(false)
  const anchorRef = React.useRef<HTMLButtonElement>(null)

  const load = React.useCallback(() => {
    const projectId = getActiveWorkbenchProjectId()
    const events = getDesktopBridge()?.events
    if (!projectId || !events) {
      setTurns([])
      return
    }
    setLoading(true)
    void events.read(projectId, 0)
      .then((result) => setTurns(buildAgentTraceTurns(Array.isArray(result.events) ? result.events : [])))
      .catch(() => setTurns([]))
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    if (open) load()
  }, [load, open])

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="查看 Agent 运行轨迹"
        aria-expanded={open}
        title="Agent 运行轨迹"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((value) => !value)}
        className={cn(actionClassName, open && 'bg-nomi-accent-soft text-nomi-accent')}
      >
        <IconRoute size={14} />
      </button>
      {open ? (
        <ConversationHistoryPopover anchorRef={anchorRef} onClose={() => setOpen(false)}>
          <div className="w-[320px] overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-lg">
            <div className="flex items-center justify-between border-b border-nomi-line-soft px-3 py-2">
              <span className="text-caption font-semibold text-nomi-ink">Agent 运行轨迹</span>
              {loading ? <IconRefresh size={13} className="animate-spin text-nomi-ink-40" /> : null}
            </div>
            <AgentTraceList turns={turns} />
          </div>
        </ConversationHistoryPopover>
      ) : null}
    </>
  )
}
