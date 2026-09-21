import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallEvent } from '../agent/generationCanvasAgentClient'

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  fail: vi.fn(),
  sync: vi.fn(() => true),
}))

vi.mock('../skills/canvasSkillModel', () => ({
  completeCanvasSkillStage: mocks.complete,
  failCanvasSkillStage: mocks.fail,
  syncCanvasSkillStageFromHarness: mocks.sync,
}))

import { createCanvasPlaybookRunTracker } from './canvasPlaybookRunTracker'

const target = {
  skillNodeId: 'skill-node-1',
  stage: { id: 'storyboard', goal: 'build shots', tools: ['create_canvas_nodes'], pause: true, index: 1, total: 4 },
} satisfies NonNullable<Parameters<typeof createCanvasPlaybookRunTracker>[0]>

beforeEach(() => {
  mocks.complete.mockReset()
  mocks.fail.mockReset()
  mocks.sync.mockReset().mockReturnValue(true)
})

describe('createCanvasPlaybookRunTracker', () => {
  it('completes only with the backend-validated matching stage', () => {
    const tracker = createCanvasPlaybookRunTracker(target, 'workbench-cinematic-director')
    const stage = {
      skillKey: 'workbench-cinematic-director',
      stageId: 'storyboard',
      stageIndex: 1,
      stageTotal: 4,
      pauseAfter: true,
    }

    tracker.onHarnessConfig({ playbook: stage } as never)
    tracker.complete({ playbook: stage })

    expect(mocks.sync).toHaveBeenCalledWith('skill-node-1', stage)
    expect(mocks.complete).toHaveBeenCalledWith('skill-node-1', 'storyboard', stage)
    expect(mocks.fail).not.toHaveBeenCalled()
  })

  it('marks the stage failed when a tracked tool confirmation is rejected', async () => {
    const transport = vi.fn(async () => undefined)
    const tracker = createCanvasPlaybookRunTracker(target, 'workbench-cinematic-director')
    const tracked = tracker.trackToolCall({ confirm: transport } as unknown as ToolCallEvent)

    await tracked.confirm({ ok: false, message: 'not approved' })
    tracker.complete({ playbook: { stageId: 'storyboard' } })

    expect(transport).toHaveBeenCalledWith({ ok: false, message: 'not approved' })
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.fail).toHaveBeenCalledWith('skill-node-1', 'storyboard', '当前阶段有操作未获批准')
  })

  it('does not mutate skill state when no playbook target is active', () => {
    const tracker = createCanvasPlaybookRunTracker(undefined, undefined)
    tracker.complete(undefined)
    tracker.fail('ignored')
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.fail).not.toHaveBeenCalled()
  })
})
