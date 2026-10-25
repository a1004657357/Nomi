import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentModelEntry } from './availableModels'
import { buildAgentModelEntries } from './availableModels'
import { tryApplyCapabilityToolCall } from './capabilityRecipeToolHandlers'
import { capabilityRecipeRunParamsSchema } from '../../../../electron/shared/agentCapabilities/creativeComponentSchemas'

const state = vi.hoisted(() => ({
  meta: {} as Record<string, unknown>, entries: [] as AgentModelEntry[], run: vi.fn(),
}))
vi.mock('../../../config/featureFlags', () => ({ isCapabilityRecipesEnabled: () => true }))
vi.mock('./availableModels', async importOriginal => ({
  ...await importOriginal<typeof import('./availableModels')>(),
  listAvailableModelsForAgent: async () => state.entries,
}))
vi.mock('./generationCanvasTools', () => ({ readGenerationCanvasSnapshot: () => ({
  nodes: [{ id: 'source', kind: 'image', prompt: 'Original source', meta: state.meta,
    result: { id: 'source-result', type: 'image', url: 'nomi-local://fixture.png', createdAt: 1 } }],
  edges: [],
}) }))
vi.mock('./clientIdRegistry', () => ({ resolveCanvasToolNodeId: (id: string) => id }))
vi.mock('../runner/capabilityRecipeController', () => ({ runCapabilityRecipeOnNode: state.run }))

function plan(record: Record<string, unknown> = {}) {
  return tryApplyCapabilityToolCall({
    toolName: 'apply_capability_recipe',
    record: capabilityRecipeRunParamsSchema.strict().parse({ sourceNodeId: 'source', recipeId: 'portrait.refine', ...record }),
    planOnly: true,
    mutate: <T>(run: () => T) => run(),
    project: {
      binding: { projectId: 'fixture', immutableProjectUuid: 'd7e7c52e-d433-4d1a-aef7-d17f4a642915', projectGeneration: 1 },
      signal: new AbortController().signal, assertCurrent: vi.fn(),
    },
  })
}

describe('recipe tool supplier propagation without generation', () => {
  beforeEach(() => {
    state.run.mockReset()
    state.meta = { modelKey: 'gpt-image-2', modelVendor: 'apimart' }
    state.entries = buildAgentModelEntries(['apimart', 'kie'].map(vendor => ({
      value: 'gpt-image-2', modelKey: 'gpt-image-2', label: 'GPT Image 2', vendor,
      meta: { archetypeId: 'gpt-image-2' },
    })))
  })

  it('keeps the explicit supplier through strict arguments, handler and run plan', async () => {
    expect(await plan({ modelKey: 'gpt-image-2', vendorKey: 'kie' })).toMatchObject({
      handled: true, value: { planned: true, plan: { model: { vendorKey: 'kie', modelKey: 'gpt-image-2' } } },
    })
    expect(state.run).not.toHaveBeenCalled()
  })

  it.each(['modelVendor', 'vendor'])('keeps the source supplier from %s', async field => {
    state.meta = { modelKey: 'gpt-image-2', [field]: 'kie' }
    expect(await plan()).toMatchObject({
      value: { planned: true, plan: { model: { vendorKey: 'kie', modelKey: 'gpt-image-2' } } },
    })
    expect(state.run).not.toHaveBeenCalled()
  })

  it('rejects an ambiguous legacy source before any generation', async () => {
    state.meta = { modelKey: 'gpt-image-2' }
    await expect(plan()).rejects.toThrow()
    expect(state.run).not.toHaveBeenCalled()
  })
})
