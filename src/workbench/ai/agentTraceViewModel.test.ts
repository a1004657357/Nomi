import { describe, expect, it } from 'vitest'
import { buildAgentTraceTurns } from './agentTraceViewModel'

const event = (seq: number, type: string, payload: Record<string, unknown>) => ({
  seq,
  type,
  payload,
  ts: `2026-08-02T00:00:0${seq}.000Z`,
})

describe('agentTraceViewModel', () => {
  it('groups harness events into newest-first inspectable turns', () => {
    const turns = buildAgentTraceTurns([
      event(1, 'agent.turn.started', { sessionId: 's1', skillKey: 'brand.promo', promptHead: '做宣传片' }),
      event(2, 'agent.turn.configured', {
        sessionId: 's1', vendorKey: 'ark-plan', modelKey: 'doubao-seed-code',
        allowedTools: ['create_canvas_nodes'], playbook: { stageId: 'build', index: 1, total: 4 },
      }),
      event(3, 'agent.step.finished', { sessionId: 's1', stepIndex: 1, finishReason: 'tool-calls' }),
      event(4, 'agent.tool.proposed', { sessionId: 's1', toolCallId: 't1', toolName: 'create_canvas_nodes' }),
      event(5, 'agent.turn.finished', { sessionId: 's1', status: 'ok', stepCount: 1, durationMs: 812 }),
      event(6, 'agent.turn.started', { sessionId: 's2', skillKey: 'workbench.generation.canvas-planner', promptHead: '整理画布' }),
    ])

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ sessionId: 's2', status: 'running' })
    expect(turns[1]).toMatchObject({
      sessionId: 's1',
      status: 'ok',
      vendorKey: 'ark-plan',
      modelKey: 'doubao-seed-code',
      stageLabel: '2/4 · build',
      allowedTools: ['create_canvas_nodes'],
      stepCount: 1,
      durationMs: 812,
      toolNames: ['create_canvas_nodes'],
    })
  })
})
