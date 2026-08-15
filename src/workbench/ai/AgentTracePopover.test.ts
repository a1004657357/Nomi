import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentTraceList } from './AgentTracePopover'

describe('AgentTraceList', () => {
  it('shows model, playbook stage, tools, steps and duration', () => {
    const markup = renderToStaticMarkup(React.createElement(AgentTraceList, { turns: [{
      sessionId: 's1',
      startedAt: '2026-08-02T00:00:00.000Z',
      promptHead: '做宣传片',
      skillKey: 'brand.promo',
      status: 'ok',
      vendorKey: 'ark-plan',
      modelKey: 'doubao-seed-code',
      stageLabel: '2/4 · build',
      allowedTools: ['create_canvas_nodes'],
      toolNames: ['create_canvas_nodes'],
      stepCount: 2,
      durationMs: 812,
      error: '',
      seq: 5,
    }] }))

    expect(markup).toContain('ark-plan · doubao-seed-code')
    expect(markup).toContain('2/4 · build')
    expect(markup).toContain('create_canvas_nodes')
    expect(markup).toContain('2 步')
    expect(markup).toContain('812ms')
  })
})
