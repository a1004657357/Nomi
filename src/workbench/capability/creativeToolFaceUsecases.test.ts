import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { creativeComponentArgumentSchemas, type CreativeComponentToolName } from '../../../electron/shared/agentCapabilities/creativeComponentSchemas'
import { capabilityContractById, capabilityPlanReviewOf } from '../../../electron/shared/agentCapabilities/registry'
import { preflightLaneApproval } from '../../../electron/shared/agentLane/laneApproval'
import { buildAgentModelEntries, type AgentModelEntry } from '../generationCanvas/agent/availableModels'
import { tryApplyCapabilityToolCall } from '../generationCanvas/agent/capabilityRecipeToolHandlers'
import { handoffModel3dNode } from '../generationCanvas/agent/model3dHandoff'
import { evaluateVibingDirectorToolCall } from '../generationCanvas/nodes/vibingDirector/vibingDirectorAgentProtocol'
import { applyVibingDirectorPlan, createVibingDirectorState, formatVibingDirectorContext } from '../generationCanvas/nodes/vibingDirector/vibingDirectorState'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { createProjectSessionTestHarness } from '../project/projectSessionTestHarness'
import { withProjectAction, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'

const io = vi.hoisted(() => ({ models: [] as AgentModelEntry[], generate: vi.fn() }))
vi.mock('../../config/featureFlags', () => ({ isCapabilityRecipesEnabled: () => true }))
vi.mock('../generationCanvas/agent/availableModels', async original => ({
  ...await original<typeof import('../generationCanvas/agent/availableModels')>(),
  listAvailableModelsForAgent: async () => io.models,
}))
vi.mock('../generationCanvas/quality/visionReviewModels', () => ({ listVisionReviewModelOptions: async () => [] }))
vi.mock('../generationCanvas/runner/capabilityRecipeController', () => ({ runCapabilityRecipeOnNode: io.generate }))

type OfflineCase = { id: string; offline: { operation: CreativeComponentToolName; args: Record<string, unknown> } }
const manifest = JSON.parse(fs.readFileSync(new URL('../../../tests/system/agent-tool-face-usecases.json', import.meta.url), 'utf8')) as {
  cases: Array<{ id: string; offline?: OfflineCase['offline'] }>
}
const cases = manifest.cases.filter((entry): entry is OfflineCase => Boolean(entry.offline))
let session: ReturnType<typeof createProjectSessionTestHarness>
let project: ProjectExecutionContext
let network: ReturnType<typeof vi.fn>
const store = () => useGenerationCanvasStore.getState()

function roundTrip() {
  const serialized = JSON.stringify(store().readSnapshot())
  store().restoreSnapshot(JSON.parse(serialized))
  return store().readSnapshot()
}

beforeEach(async () => {
  session = createProjectSessionTestHarness()
  await session.open('offline-tool-face')
  project = withProjectAction(value => value)!
  network = vi.fn(() => { throw new Error('Offline fixture must not access the network') })
  vi.stubGlobal('fetch', network)
  io.generate.mockReset().mockImplementation(() => { throw new Error('Offline fixture must not generate') })
  io.models = buildAgentModelEntries([{
    value: 'gpt-image-2', modelKey: 'gpt-image-2', label: 'GPT Image 2', vendor: 'openai',
    meta: { archetypeId: 'gpt-image-2' },
  }])
  const director = createVibingDirectorState(100)
  director.objects = [{
    id: 'actor-A', name: 'Actor A', kind: 'marker', role: 'actor_seated',
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  }]
  const nodes: GenerationCanvasNode[] = [{
    id: 'source-1', kind: 'image', title: 'Portrait fixture', prompt: 'Original portrait',
    position: { x: 0, y: 0 }, categoryId: 'shots', status: 'success',
    result: { id: 'portrait-result', type: 'image', url: 'nomi-local://fixture.png', assetId: 'portrait-asset', createdAt: 1 },
  }, {
    id: 'director-1', kind: 'vibingDirector', title: 'Director fixture', position: { x: 400, y: 0 },
    categoryId: 'scene', meta: { vibingDirectorState: director },
  }, {
    id: 'model-source', kind: 'model3d', title: 'Model fixture', position: { x: 800, y: 0 },
    categoryId: 'scene', status: 'success',
    result: {
      id: 'model-result', type: 'model3d', url: 'nomi-local://fixture.glb', assetId: 'glb-asset', createdAt: 1,
      provenance: { provider: 'fixture', modelKey: 'fixture-model', timestamp: 1 },
      model3dValidation: {
        version: 1, glbVersion: 2, byteLength: 2048, meshCount: 1, primitiveCount: 2, nodeCount: 3,
        materialCount: 1, textureCount: 1, imageCount: 1, embeddedImageCount: 1, externalImageCount: 0,
        externalImageUris: [], externalBufferCount: 0, externalBufferUris: [], animationCount: 0, skinCount: 0,
        bounds: { min: [0, 0, 0], max: [1, 2, 1], size: [1, 2, 1], diagonal: Math.sqrt(6) }, warnings: [],
      },
    },
  }]
  store().restoreSnapshot({ nodes, edges: [], groups: [], selectedNodeIds: [] })
})

afterEach(() => {
  expect(io.generate).not.toHaveBeenCalled()
  expect(network).not.toHaveBeenCalled()
  session.dispose()
  vi.unstubAllGlobals()
})

function requireFreshReview(name: CreativeComponentToolName, args: Record<string, unknown>) {
  const contract = capabilityContractById('creative.component.write')!
  for (const mode of ['step', 'safe-auto', 'project'] as const) {
    expect(preflightLaneApproval({
      toolName: name, capabilityId: contract.id, effect: contract.effect, effectClass: contract.effectClass,
      destructiveHint: false, ...capabilityPlanReviewOf(contract, args),
    }, {
      policy: { mode, spend: 'within-budget' }, workMode: undefined, hasUserInterface: true,
      sessionGrants: new Set([contract.id]),
    })).toMatchObject({ state: 'awaiting-user', grantable: false })
  }
}

describe('manifest-backed creative tools: offline execution and readback', () => {
  for (const entry of cases) it(entry.id + ': ' + entry.offline.operation, async () => {
    const { operation, args: raw } = entry.offline
    const args = creativeComponentArgumentSchemas[operation].parse(raw)
    const before = JSON.parse(JSON.stringify(store().readSnapshot()))
    const context = {
      toolName: operation, record: args, project, mutate: <T>(run: () => T) => run(),
    }
    if (operation === 'list_capability_recipes') {
      expect(await tryApplyCapabilityToolCall(context)).toMatchObject({
        handled: true, value: { recipes: expect.arrayContaining([expect.objectContaining({
          id: 'portrait.refine', compatibleModels: expect.arrayContaining([expect.objectContaining({
            vendorKey: 'openai', modelKey: 'gpt-image-2',
          })]),
        })]), resources: [], visionReviewModels: [] },
      })
      expect(roundTrip()).toEqual(before)
    } else if (operation === 'read_vibing_director') {
      const state = store().nodes.find(node => node.id === 'director-1')!.meta!.vibingDirectorState as ReturnType<typeof createVibingDirectorState>
      expect(evaluateVibingDirectorToolCall({ toolName: operation, args, directorNodeId: 'director-1', state, inspected: false }))
        .toEqual({ kind: 'read', inspected: true })
      expect(formatVibingDirectorContext('director-1', state)).toContain('actor-A')
      expect(roundTrip()).toEqual(before)
    } else if (operation === 'apply_capability_recipe') {
      requireFreshReview(operation, args)
      expect(await tryApplyCapabilityToolCall({ ...context, planOnly: true })).toMatchObject({
        handled: true, value: { planned: true, plan: {
          recipeId: 'portrait.refine', sourceNodeIds: ['source-1'],
          model: { vendorKey: 'openai', modelKey: 'gpt-image-2' },
        } },
      })
      expect(roundTrip()).toEqual(before)
    } else if (operation === 'save_creative_resource') {
      requireFreshReview(operation, args)
      expect(await tryApplyCapabilityToolCall(context)).toMatchObject({ handled: true })
      const snapshot = roundTrip()
      expect(snapshot.nodes.find(node => node.kind === 'resource')).toMatchObject({
        result: { id: 'portrait-result' },
        creativeResource: {
          label: 'User identity', assetIds: ['portrait-asset'], promptTokens: ['same identity'],
          license: { source: 'User-owned fixture', commercialUse: 'allowed', attribution: 'User' },
        },
      })
      expect(snapshot.nodes.find(node => node.id === 'source-1')?.creativeResource).toBeUndefined()
    } else if (operation === 'handoff_model3d') {
      requireFreshReview(operation, args)
      // The real handoff is used; only persistence is an injected offline snapshot sink.
      const persist = vi.fn(async () => { roundTrip() })
      const result = await handoffModel3dNode({
        project, ...creativeComponentArgumentSchemas.handoff_model3d.parse(args), persist, now: () => 200,
      })
      expect(persist).toHaveBeenCalledOnce()
      const snapshot = roundTrip()
      const target = snapshot.nodes.find(node => node.id === result.targetNodeId)
      expect(target).toMatchObject({ kind: 'scene3d', meta: { model3dHandoffs: [expect.objectContaining({
        sourceNodeId: 'model-source', sourceResultId: 'model-result', provider: 'fixture', modelKey: 'fixture-model',
      })] } })
      expect(snapshot.nodes.find(node => node.id === 'model-source')?.result?.id).toBe('model-result')
      expect(snapshot.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'model-source', target: result.targetNodeId })]))
    } else if (operation === 'apply_vibing_director_plan') {
      requireFreshReview(operation, args)
      const state = store().nodes.find(node => node.id === 'director-1')!.meta!.vibingDirectorState as ReturnType<typeof createVibingDirectorState>
      const input = { toolName: operation, args, directorNodeId: 'director-1', state }
      expect(evaluateVibingDirectorToolCall({ ...input, inspected: false }).kind).toBe('reject')
      const read = evaluateVibingDirectorToolCall({ ...input, toolName: 'read_vibing_director', args: { directorNodeId: 'director-1' }, inspected: false })
      const reviewed = evaluateVibingDirectorToolCall({ ...input, inspected: read.inspected })
      expect(reviewed.kind).toBe('apply')
      if (reviewed.kind !== 'apply') throw new Error('Valid reviewed fixture was rejected')
      const result = applyVibingDirectorPlan(state, reviewed.request.plan)
      expect(result.rejected).toEqual([])
      store().updateNode('director-1', { meta: { vibingDirectorState: result.state } })
      const restored = roundTrip().nodes.find(node => node.id === 'director-1')!.meta!.vibingDirectorState as typeof state
      expect(restored.objects.find(object => object.id === 'actor-A')?.position).toEqual([1, 0, 0])
      expect(state.objects[0].position).toEqual([0, 0, 0])
    } else throw new Error('Unimplemented offline tool: ' + String(operation))
  })
})
