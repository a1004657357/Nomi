export type AgentTraceEvent = {
  seq?: number
  ts?: string
  type?: string
  payload?: Record<string, unknown>
}

export type AgentTraceTurn = {
  sessionId: string
  startedAt: string
  promptHead: string
  skillKey: string
  status: 'running' | 'ok' | 'error'
  vendorKey: string
  modelKey: string
  stageLabel: string
  allowedTools: string[]
  toolNames: string[]
  stepCount: number
  durationMs: number | null
  error: string
  seq: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function stageLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const stage = value as Record<string, unknown>
  const id = text(stage.stageId)
  if (!id) return ''
  const index = number(stage.index)
  const total = number(stage.total)
  return index !== null && total !== null ? `${index + 1}/${total} · ${id}` : id
}

export function buildAgentTraceTurns(events: readonly unknown[], limit = 12): AgentTraceTurn[] {
  const turns = new Map<string, AgentTraceTurn>()
  for (const value of events) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const event = value as AgentTraceEvent
    const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? event.payload
      : {}
    const sessionId = text(payload.sessionId)
    if (!sessionId || !String(event.type || '').startsWith('agent.')) continue
    if (event.type === 'agent.turn.started') {
      turns.set(sessionId, {
        sessionId,
        startedAt: event.ts ?? '',
        promptHead: text(payload.promptHead),
        skillKey: text(payload.skillKey),
        status: 'running',
        vendorKey: '',
        modelKey: '',
        stageLabel: text(payload.playbookStageId),
        allowedTools: [],
        toolNames: [],
        stepCount: 0,
        durationMs: null,
        error: '',
        seq: event.seq ?? 0,
      })
      continue
    }
    const turn = turns.get(sessionId)
    if (!turn) continue
    turn.seq = Math.max(turn.seq, event.seq ?? 0)
    if (event.type === 'agent.turn.configured') {
      turn.vendorKey = text(payload.vendorKey)
      turn.modelKey = text(payload.modelKey)
      turn.skillKey = text(payload.skillKey) || turn.skillKey
      turn.allowedTools = strings(payload.allowedTools)
      turn.stageLabel = stageLabel(payload.playbook) || turn.stageLabel
    } else if (event.type === 'agent.step.finished') {
      turn.stepCount = number(payload.stepIndex) ?? turn.stepCount
    } else if (event.type === 'agent.tool.proposed') {
      const toolName = text(payload.toolName)
      if (toolName && !turn.toolNames.includes(toolName)) turn.toolNames.push(toolName)
    } else if (event.type === 'agent.turn.error') {
      turn.status = 'error'
      turn.error = text(payload.message)
    } else if (event.type === 'agent.turn.finished') {
      turn.status = payload.status === 'error' ? 'error' : 'ok'
      turn.stepCount = number(payload.stepCount) ?? turn.stepCount
      turn.durationMs = number(payload.durationMs)
    }
  }
  return [...turns.values()]
    .sort((left, right) => right.seq - left.seq)
    .slice(0, Math.max(0, limit))
}
