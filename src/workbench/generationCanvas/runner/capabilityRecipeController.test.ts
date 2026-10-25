import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { createProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { runCapabilityRecipeOnNode, type RunCapabilityRecipeOnNodeOptions } from './capabilityRecipeController'
import { createBrowserCapabilityRecipeMediaProcessor, type CapabilityRecipeMediaProcessor } from './capabilityRecipePostprocess'
import type { GenerationNodeExecutor } from './generationNodeExecutor'
import type { CapabilityRecipeVideoInspection } from './capabilityRecipeQuality'

let projectSession: ReturnType<typeof createProjectSessionTestHarness>
let project: ProjectExecutionContext

// The controller issues from the real coordinator; IO fixtures carry that same action's lifetime.
function recipeOptions<T extends RunCapabilityRecipeOnNodeOptions>(project: ProjectExecutionContext, options: T) {
  return {
    ...options,
    signal: project.signal,
    mediaProcessor: options.mediaProcessor ?? createBrowserCapabilityRecipeMediaProcessor(project),
  }
}

function imageResult(id: string): GenerationNodeResult {
  return { id, type: 'image', url: `nomi-local://${id}.png`, createdAt: 100 }
}

function videoResult(id: string): GenerationNodeResult {
  return { id, type: 'video', url: `nomi-local://${id}.mp4`, createdAt: 100 }
}

function visualHash(seed: number): string {
  let state = seed + 1
  return Array.from({ length: 256 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state >>> 31 ? '1' : '0'
  }).join('')
}

function plan(): RecipeRunPlan {
  return {
    id: 'recipe-run-1', recipeId: 'image.multiview.custom', recipeVersion: 1, outputKind: 'image_collection',
    sourceNodeIds: ['source-1'], resourceIds: [],
    model: {
      vendorKey: 'provider-a', modelKey: 'model-a', archetypeId: 'test-image', modeId: 'edit',
      compatibilityTier: 'native',
    },
    params: { quality: 'high' }, outputCount: 2, taskCount: 2,
    outputs: [
      { id: 'front', label: '正面', azimuth: 0, elevation: 0 },
      { id: 'back', label: '背面', azimuth: 180, elevation: 0 },
    ],
    createdAt: 100,
  }
}

beforeEach(async () => {
  projectSession = createProjectSessionTestHarness()
  await projectSession.open('recipe-project')
  project = withProjectAction(project => project, () => { throw new Error('project_identity_unavailable') })
  const source: GenerationCanvasNode = {
    id: 'source-1', kind: 'image', title: 'Source', position: { x: 0, y: 0 }, prompt: 'same person',
    categoryId: 'shots', result: imageResult('source'), history: [imageResult('source')], status: 'success',
    meta: { vendor: 'old-provider', modelKey: 'old-model' },
  }
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source], edges: [], groups: [], selectedNodeIds: [] })
})
afterEach(() => projectSession.dispose())

describe('runCapabilityRecipeOnNode', () => {
  it('creates one derived collection node and leaves the source untouched', async () => {
    const executor = vi.fn<GenerationNodeExecutor>(async (node, context) => {
      expect(context?.projectTarget).toEqual(project.binding)
      expect(context?.signal).toBe(project.signal)
      expect(context?.grantId).toBe('grant-1')
      const recipeMeta = node.meta?.capabilityRecipe as { output?: { id?: string } } | undefined
      return imageResult(recipeMeta?.output?.id || 'unknown')
    })

    const outcome = await runCapabilityRecipeOnNode('source-1', plan(), recipeOptions(project, {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    const state = useGenerationCanvasStore.getState()
    const source = state.nodes.find((node) => node.id === 'source-1')
    const output = state.nodes.find((node) => node.id === outcome.nodeId)
    expect(source?.result?.id).toBe('source')
    expect(source?.resultCollections).toBeUndefined()
    expect(output?.regeneratedFrom).toBe('source-1')
    expect(output?.result?.id).toBe('front')
    expect(output?.resultCollections?.[0]?.items.map((item) => item.result?.id)).toEqual(['front', 'back'])
    expect(output?.resultCollections?.[0]?.source).toEqual({
      nodeId: 'source-1',
      resultId: 'source',
      label: 'Source',
      url: 'nomi-local://source.png',
    })
    expect((output?.meta?.capabilityRecipe as { plan?: RecipeRunPlan } | undefined)?.plan).toEqual(plan())
    expect(state.edges.some((edge) => edge.source === 'source-1' && edge.target === output?.id)).toBe(true)
    expect(executor).toHaveBeenCalledTimes(2)
  })

  it('preserves four same-request provider candidates in the collection and node history', async () => {
    const recipePlan = plan()
    recipePlan.outputCount = 1
    recipePlan.taskCount = 1
    recipePlan.outputs = [{ id: 'front', label: '正面', azimuth: 0, elevation: 0 }]
    const executor = vi.fn(async () => ({
      ...imageResult('candidate-1'),
      alternatives: [
        imageResult('candidate-2'),
        imageResult('candidate-3'),
        imageResult('candidate-4'),
      ],
    }))

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, recipeOptions(project, {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    const output = useGenerationCanvasStore.getState().nodes.find((node) => node.id === outcome.nodeId)
    expect(output?.resultCollections?.[0]?.items[0]?.candidates?.map((result) => result.id)).toEqual([
      'candidate-1',
      'candidate-2',
      'candidate-3',
      'candidate-4',
    ])
    expect(output?.history?.map((result) => result.id)).toEqual(expect.arrayContaining([
      'candidate-1',
      'candidate-2',
      'candidate-3',
      'candidate-4',
    ]))
  })

  it('replaces inherited image model identity when an image recipe creates a video node', async () => {
    const state = useGenerationCanvasStore.getState()
    state.updateNode('source-1', {
      meta: {
        vendor: 'agnes',
        modelVendor: 'agnes',
        modelKey: 'agnes-image-2.1-flash',
        modelAlias: 'agnes-image-2.1-flash',
        modelLabel: 'Agnes Image',
        archetypeId: 'agnes-image',
        archetype: { id: 'agnes-image', modeId: 'edit' },
        imageModel: 'agnes-image-2.1-flash',
        imageModelVendor: 'agnes',
      },
    })
    const videoPlan: RecipeRunPlan = {
      ...plan(),
      id: 'agnes-video-run',
      recipeId: 'video.look.apply',
      recipeVersion: 2,
      outputKind: 'video',
      model: {
        vendorKey: 'agnes',
        modelKey: 'agnes-video-v2.0',
        archetypeId: 'agnes-video',
        modeId: 'i2v',
        compatibilityTier: 'compatible',
      },
      outputCount: 1,
      taskCount: 1,
      outputs: [{ id: 'video', label: '视频结果' }],
    }
    const executor = vi.fn(async (node: GenerationCanvasNode) => {
      expect(node.kind).toBe('video')
      expect(node.meta).toMatchObject({
        vendor: 'agnes',
        modelVendor: 'agnes',
        modelKey: 'agnes-video-v2.0',
        modelAlias: 'agnes-video-v2.0',
        modelAutoSelectDisabled: true,
        archetypeId: 'agnes-video',
        archetype: { id: 'agnes-video', modeId: 'i2v' },
        videoModel: 'agnes-video-v2.0',
        videoModelVendor: 'agnes',
      })
      expect(node.meta?.imageModel).toBeUndefined()
      expect(node.meta?.imageModelVendor).toBeUndefined()
      return videoResult('generated-video')
    })

    const outcome = await runCapabilityRecipeOnNode('source-1', videoPlan, recipeOptions(project, {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    expect(outcome.successCount).toBe(1)
    expect(executor).toHaveBeenCalledOnce()
  })

  it('requires a spend grant before creating the derived node', async () => {
    await expect(runCapabilityRecipeOnNode('source-1', plan(), recipeOptions(project, {
      executor: async () => imageResult('unused'),
      grantId: '',
      persist: async () => {},
    }))).rejects.toThrow('缺少付费生成授权')

    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
  })

  it('rejects an old action lifetime after A to B to A before invoking the executor', async () => {
    const executor = vi.fn<GenerationNodeExecutor>(async () => imageResult('must-not-run'))
    const grantFactory = vi.fn(async () => 'must-not-mint')
    const persist = vi.fn(async () => {})
    await projectSession.open('recipe-project-B')
    await projectSession.open('recipe-project')
    expect(() => project.assertCurrent()).toThrow()
    const before = useGenerationCanvasStore.getState().nodes

    await expect(runCapabilityRecipeOnNode('source-1', plan(), recipeOptions(project, {
      executor, grantFactory, persist,
    }))).rejects.toMatchObject({ name: 'AbortError' })

    expect(executor).not.toHaveBeenCalled()
    expect(grantFactory).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes).toBe(before)
  })

  it('rejects a late successful receipt after project switch without persisting it', async () => {
    let finish!: (result: GenerationNodeResult) => void
    const executor = vi.fn<GenerationNodeExecutor>(() => new Promise(resolve => { finish = resolve }))
    const persist = vi.fn(async () => {})
    const recipePlan = { ...plan(), taskCount: 1, outputCount: 1, outputs: plan().outputs.slice(0, 1) }
    const pending = runCapabilityRecipeOnNode('source-1', recipePlan, recipeOptions(project, {
      executor, grantId: 'grant-1', persist,
    }))
    const rejected = expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
    await vi.waitFor(() => expect(executor).toHaveBeenCalledOnce())
    await projectSession.open('recipe-project-B')
    const oldTarget = useGenerationCanvasStore.getState().nodes.find(node => node.id !== 'source-1')!
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{ ...oldTarget, title: 'project-B same-id node', result: imageResult('B-result'), history: [imageResult('B-result')] }],
      edges: [], groups: [], selectedNodeIds: [],
    })
    const before = useGenerationCanvasStore.getState().nodes
    finish(imageResult('late-result-A'))

    await rejected
    expect(project.signal.aborted).toBe(true)
    expect(persist).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes).toBe(before)
  })

  it('does not create a target in a new project after late source inspection', async () => {
    const inspection = { width: 1200, height: 800, opaqueRatio: 1, meanLuma: 0.5, lumaStdDev: 0.2,
      edgeEnergy: 0.1, averageRgb: [0.5, 0.5, 0.5] as [number, number, number], perceptualHash: visualHash(1) }
    let finish!: (value: typeof inspection) => void
    const inspectImage = vi.fn(() => new Promise<typeof inspection>(resolve => { finish = resolve }))
    const executor = vi.fn<GenerationNodeExecutor>(async () => imageResult('must-not-run'))
    const persist = vi.fn(async () => {})
    const pending = runCapabilityRecipeOnNode('source-1', { ...plan(), recipeId: 'image.style.transfer' }, recipeOptions(project, {
      executor, persist, grantId: 'grant-1',
      mediaProcessor: { inspectImage, splitGrid3x3: async () => [], normalizePanorama2to1: async result => result },
    }))
    const rejected = expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
    await vi.waitFor(() => expect(inspectImage).toHaveBeenCalledOnce())
    await projectSession.open('recipe-project-B')
    const source = useGenerationCanvasStore.getState().nodes[0]!
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ ...source, title: 'project-B source' }], edges: [], groups: [], selectedNodeIds: [] })
    const before = useGenerationCanvasStore.getState().nodes
    finish(inspection)
    await rejected
    expect(useGenerationCanvasStore.getState().nodes).toBe(before)
    expect(executor).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('does not roll back a same-id node in the new project when grant minting fails late', async () => {
    let rejectGrant!: (error: Error) => void
    const grantFactory = vi.fn(() => new Promise<string>((_resolve, reject) => { rejectGrant = reject }))
    const executor = vi.fn<GenerationNodeExecutor>(async () => imageResult('must-not-run'))
    const pending = runCapabilityRecipeOnNode('source-1', plan(), recipeOptions(project, { executor, grantFactory, persist: async () => {} }))
    const rejected = expect(pending).rejects.toThrow('grant mint failed')
    await vi.waitFor(() => expect(grantFactory).toHaveBeenCalledOnce())
    const target = useGenerationCanvasStore.getState().nodes.find(node => node.id !== 'source-1')!
    await projectSession.open('recipe-project-B')
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ ...target, title: 'project-B same-id node' }], edges: [], groups: [], selectedNodeIds: [] })
    const before = useGenerationCanvasStore.getState().nodes
    rejectGrant(new Error('grant mint failed'))
    await rejected
    expect(useGenerationCanvasStore.getState().nodes).toBe(before)
    expect(executor).not.toHaveBeenCalled()
  })

  it('rejects a successful persistence receipt returned after project switch', async () => {
    let finish!: () => void
    const persist = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const pending = runCapabilityRecipeOnNode('source-1', plan(), recipeOptions(project, {
      executor: async () => imageResult('A-result'), grantId: 'grant-1', persist,
    }))
    const rejected = expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
    await projectSession.open('recipe-project-B')
    finish()
    await rejected
  })

  it('can mint a grant for the newly-created target with the exact task budget', async () => {
    const grantFactory = vi.fn(async () => 'grant-for-target')
    const executor = vi.fn(async () => imageResult('generated'))

    const outcome = await runCapabilityRecipeOnNode('source-1', plan(), recipeOptions(project, {
      executor,
      grantFactory,
      persist: async () => {},
    }))

    expect(grantFactory).toHaveBeenCalledWith(outcome.nodeId, 2)
    expect(executor).toHaveBeenCalledTimes(2)
  })

  it('applies creative resource prompt tokens and reference edges to the derived node', async () => {
    const state = useGenerationCanvasStore.getState()
    const source = state.nodes.find((node) => node.id === 'source-1')!
    const resource: GenerationCanvasNode = {
      id: 'style-1', kind: 'resource', title: '胶片风格', position: { x: 0, y: 300 }, categoryId: 'scene',
      result: imageResult('style-source'),
      creativeResource: {
        id: 'style-1', kind: 'style', label: '胶片风格', promptTokens: ['35mm film', 'soft highlight rolloff'],
        assetIds: ['style-source'], createdAt: 1, updatedAt: 1,
        license: { commercialUse: 'allowed' },
      },
    }
    state.restoreSnapshot({ nodes: [source, resource], edges: [], groups: [], selectedNodeIds: [] })
    const recipePlan = { ...plan(), resourceIds: ['style-1'] }
    const executor = vi.fn<GenerationNodeExecutor>(async (node, context) => {
      expect(node.prompt).toContain('35mm film')
      expect(context?.edges?.some((edge) => edge.source === 'style-1' && edge.target === node.id && edge.mode === 'style_ref')).toBe(true)
      return imageResult('styled')
    })

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, recipeOptions(project, {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    expect(executor).toHaveBeenCalledTimes(2)
    expect(outcome.successCount).toBe(2)
  })

  it('uses the connected style resource image in the style-transfer quality report', async () => {
    const state = useGenerationCanvasStore.getState()
    const source = state.nodes.find((node) => node.id === 'source-1')!
    const resource: GenerationCanvasNode = {
      id: 'style-1', kind: 'resource', title: '海报风格', position: { x: 0, y: 300 }, categoryId: 'scene',
      result: imageResult('style-source'),
      creativeResource: {
        id: 'style-1', kind: 'style', label: '海报风格', promptTokens: ['graphic poster'],
        assetIds: ['style-source'], createdAt: 1, updatedAt: 1,
      },
    }
    state.restoreSnapshot({ nodes: [source, resource], edges: [], groups: [], selectedNodeIds: [] })
    const recipePlan: RecipeRunPlan = {
      ...plan(),
      id: 'style-run',
      recipeId: 'image.style.transfer',
      outputKind: 'image',
      resourceIds: ['style-1'],
      outputCount: 1,
      taskCount: 1,
      outputs: [{ id: 'styled', label: '风格化图片' }],
    }
    const inspectImage = vi.fn(async (image: GenerationNodeResult) => {
      const isSource = image.id === 'source'
      const isStyle = image.id === 'style-source'
      const averageRgb: [number, number, number] = isSource
        ? [0.2, 0.2, 0.2]
        : isStyle
          ? [0.8, 0.6, 0.2]
          : [0.68, 0.52, 0.2]
      return {
        width: 1024,
        height: 1024,
        opaqueRatio: 1,
        meanLuma: isSource ? 0.2 : isStyle ? 0.62 : 0.54,
        lumaStdDev: isSource ? 0.1 : isStyle ? 0.28 : 0.24,
        edgeEnergy: isSource ? 0.08 : isStyle ? 0.22 : 0.19,
        averageRgb,
        perceptualHash: isSource ? '0'.repeat(256) : isStyle ? visualHash(90) : `${'1'.repeat(16)}${'0'.repeat(240)}`,
        centerRegion: {
          lumaStdDev: isSource ? 0.1 : isStyle ? 0.28 : 0.24,
          edgeEnergy: isSource ? 0.08 : isStyle ? 0.22 : 0.19,
          averageRgb,
          perceptualHash: isSource ? '0'.repeat(256) : isStyle ? visualHash(90) : `${'1'.repeat(16)}${'0'.repeat(240)}`,
        },
      }
    })
    const mediaProcessor: CapabilityRecipeMediaProcessor = {
      splitGrid3x3: async () => [],
      normalizePanorama2to1: async (result) => result,
      inspectImage,
    }

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, recipeOptions(project, {
      executor: async () => imageResult('styled'),
      mediaProcessor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    const target = useGenerationCanvasStore.getState().nodes.find((node) => node.id === outcome.nodeId)
    expect(inspectImage).toHaveBeenCalledWith(imageResult('style-source'))
    expect(target?.resultCollections?.[0]?.quality).toMatchObject({
      kind: 'style',
      evaluator: 'style-transfer-local-v1',
      status: 'pass',
    })
  })

  it('derives style generation aspect parameters from the source image before submission', async () => {
    const recipePlan: RecipeRunPlan = {
      ...plan(),
      id: 'style-aspect-run',
      recipeId: 'image.style.transfer',
      outputKind: 'image',
      outputCount: 1,
      taskCount: 1,
      outputs: [{ id: 'styled', label: '风格化图片' }],
    }
    const normalizeStyleAspect = vi.fn(async (result: GenerationNodeResult) => result)
    const mediaProcessor: CapabilityRecipeMediaProcessor = {
      splitGrid3x3: async () => [],
      normalizePanorama2to1: async (result) => result,
      normalizeStyleAspect,
      inspectImage: async () => ({
        width: 900,
        height: 1600,
        opaqueRatio: 1,
        meanLuma: 0.5,
        lumaStdDev: 0.2,
        edgeEnergy: 0.15,
        averageRgb: [0.5, 0.5, 0.5],
        perceptualHash: visualHash(17),
      }),
    }
    const executor = vi.fn(async (node: GenerationCanvasNode) => {
      expect(node.meta?.aspect_ratio).toBe('9:16')
      expect(node.prompt).toContain('精确比例 0.5625，模型档位 9:16')
      return imageResult('styled')
    })

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, recipeOptions(project, {
      executor,
      mediaProcessor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    const target = useGenerationCanvasStore.getState().nodes.find((node) => node.id === outcome.nodeId)
    const persistedPlan = (target?.meta?.capabilityRecipe as { plan?: RecipeRunPlan } | undefined)?.plan
    expect(persistedPlan?.params).toMatchObject({
      aspectRatio: '9:16',
      sourceAspectRatio: 0.5625,
      sourceWidth: 900,
      sourceHeight: 1600,
    })
    expect(normalizeStyleAspect).toHaveBeenCalledWith(imageResult('styled'), outcome.nodeId, 0.5625)
  })

  it('derives one source aspect lock for every independent multiview task', async () => {
    const inspectImage = vi.fn(async () => ({
      width: 1200,
      height: 800,
      opaqueRatio: 1,
      meanLuma: 0.5,
      lumaStdDev: 0.2,
      edgeEnergy: 0.15,
      averageRgb: [0.5, 0.5, 0.5] as [number, number, number],
      perceptualHash: visualHash(17),
    }))
    const mediaProcessor: CapabilityRecipeMediaProcessor = {
      splitGrid3x3: async () => [],
      normalizePanorama2to1: async (result) => result,
      inspectImage,
    }
    const executor = vi.fn(async (node: GenerationCanvasNode) => {
      expect(node.meta?.aspect_ratio).toBe('3:2')
      expect(node.prompt).toContain('来源图 1200×800，比例 1.5')
      const recipeMeta = node.meta?.capabilityRecipe as { output?: { id?: string } } | undefined
      return imageResult(recipeMeta?.output?.id || 'unknown')
    })

    await runCapabilityRecipeOnNode('source-1', plan(), recipeOptions(project, {
      executor,
      mediaProcessor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    expect(executor).toHaveBeenCalledTimes(2)
    expect(inspectImage).toHaveBeenCalledWith(imageResult('source'))
  })

  it('switches the derived node kind to the recipe output kind before execution', async () => {
    const recipePlan: RecipeRunPlan = {
      ...plan(),
      outputKind: 'model3d',
      outputCount: 1,
      taskCount: 1,
      outputs: [{ id: 'model', label: '3D 模型' }],
    }
    const executor = vi.fn(async (node: GenerationCanvasNode) => {
      expect(node.kind).toBe('model3d')
      return { id: 'model', type: 'model3d' as const, url: 'nomi-local://model.glb', createdAt: 100 }
    })

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, recipeOptions(project, {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    expect(useGenerationCanvasStore.getState().nodes.find((node) => node.id === outcome.nodeId)?.kind).toBe('model3d')
  })

  it('compiles a distinct camera instruction into every custom-view task', async () => {
    const prompts: string[] = []
    const executor = vi.fn(async (node: GenerationCanvasNode) => {
      prompts.push(node.prompt || '')
      return imageResult(`generated-${prompts.length}`)
    })

    await runCapabilityRecipeOnNode('source-1', plan(), recipeOptions(project, {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('方位角 0°')
    expect(prompts[1]).toContain('方位角 180°')
    expect(prompts[0]).not.toBe(prompts[1])
  })

  it('passes one batch subject comparator through the real recipe quality controller', async () => {
    const compareMultiviewSubjects = vi.fn(async (input: {
      outputs: Array<{ itemId: string }>
    }) => ({
      evaluator: 'deterministic-subject-v1',
      sourceSubjectDetected: true,
      items: input.outputs.map((output) => ({
        itemId: output.itemId,
        outputSubjectDetected: true,
        sameSubject: true,
        identityScore: 0.92,
        geometryConsistent: true,
        geometryScore: 0.87,
        cameraMatches: true,
        cameraScore: 0.9,
        backgroundCompliant: true,
        backgroundScore: 0.89,
      })),
    }))
    const mediaProcessor: CapabilityRecipeMediaProcessor = {
      splitGrid3x3: async () => [],
      normalizePanorama2to1: async (result) => result,
      inspectImage: async (result) => ({
        width: 1024,
        height: 1024,
        opaqueRatio: 1,
        meanLuma: 0.5,
        lumaStdDev: 0.2,
        edgeEnergy: 0.1,
        averageRgb: result.id === 'front' ? [0.45, 0.44, 0.43] : [0.48, 0.46, 0.44],
        perceptualHash: result.id === 'front' ? visualHash(1) : visualHash(2),
        borderAverageRgb: [0.3, 0.31, 0.29],
        borderNearWhiteRatio: 0.02,
      }),
    }
    const executor = vi.fn(async (node: GenerationCanvasNode) => {
      const recipeMeta = node.meta?.capabilityRecipe as { output?: { id?: string } } | undefined
      return imageResult(recipeMeta?.output?.id || 'unknown')
    })

    const outcome = await runCapabilityRecipeOnNode('source-1', plan(), recipeOptions(project, {
      executor,
      mediaProcessor,
      compareMultiviewSubjects,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    const target = useGenerationCanvasStore.getState().nodes.find((node) => node.id === outcome.nodeId)
    expect(compareMultiviewSubjects).toHaveBeenCalledTimes(1)
    expect(target?.resultCollections?.[0]?.quality).toMatchObject({
      status: 'pass',
      metrics: {
        semanticComparatorAvailable: true,
        semanticComparatorEvaluator: 'deterministic-subject-v1',
      },
    })
  })

  it('normalizes the panorama aspect-ratio parameter for generation adapters', async () => {
    const recipePlan: RecipeRunPlan = {
      ...plan(),
      recipeId: 'scene.panorama.2to1',
      outputKind: 'panorama',
      params: { aspectRatio: '2:1' },
      outputCount: 1,
      taskCount: 1,
      outputs: [{ id: 'panorama', label: '360° 全景' }],
    }
    const captured: GenerationCanvasNode[] = []
    const executor = vi.fn(async (node: GenerationCanvasNode) => {
      captured.push(node)
      return imageResult('panorama')
    })
    const mediaProcessor: CapabilityRecipeMediaProcessor = {
      splitGrid3x3: async () => [],
      normalizePanorama2to1: async (result) => ({
        ...result,
        raw: {
          capabilityRecipePostprocess: {
            width: 2048,
            height: 1024,
            panoramaNormalization: {
              sourceWidth: 2048,
              sourceHeight: 1024,
              sourceAspectRatio: 2,
              targetAspectRatio: 2,
              croppedFraction: 0,
            },
          },
        },
      }),
      inspectImage: async () => ({
        width: 2048,
        height: 1024,
        opaqueRatio: 1,
        meanLuma: 0.5,
        lumaStdDev: 0.2,
        edgeEnergy: 0.1,
        averageRgb: [0.45, 0.44, 0.43],
        perceptualHash: visualHash(10),
        leftEdgeRgb: Array.from({ length: 32 }, () => [0.4, 0.45, 0.5]),
        rightEdgeRgb: Array.from({ length: 32 }, () => [0.4, 0.45, 0.5]),
        topBandLuma: Array.from({ length: 65 }, () => 0.4),
        bottomBandLuma: Array.from({ length: 65 }, () => 0.4),
        middleBandLuma: Array.from({ length: 65 }, (_, index) => index % 2),
      }),
    }

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, recipeOptions(project, {
      executor,
      mediaProcessor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    expect(executor).toHaveBeenCalledOnce()
    expect(outcome.successCount).toBe(1)
    expect(captured[0]?.meta?.aspect_ratio).toBe('2:1')
    expect(captured[0]?.prompt).toContain('等距柱状投影')
    expect(useGenerationCanvasStore.getState().nodes
      .find((node) => node.id === outcome.nodeId)
      ?.resultCollections?.[0]?.quality?.status).toBe('pass')
  })

  it('postprocesses one composite grid response into nine collection items', async () => {
    const outputs = Array.from({ length: 9 }, (_, index) => ({
      id: `view-${index + 1}`,
      label: `机位 ${index + 1}`,
      azimuth: index * 45,
      elevation: 0,
    }))
    const recipePlan: RecipeRunPlan = {
      ...plan(),
      recipeId: 'image.multiview.grid9',
      outputCount: 9,
      taskCount: 1,
      outputs,
    }
    const mediaProcessor: CapabilityRecipeMediaProcessor = {
      splitGrid3x3: vi.fn<CapabilityRecipeMediaProcessor['splitGrid3x3']>(async (_result, descriptors) => descriptors.map((output) => imageResult(output.id))),
      normalizePanorama2to1: async (result) => result,
      inspectImage: async (result) => {
        const index = outputs.findIndex((output) => output.id === result.id)
        return {
          width: 1024,
          height: 1024,
          opaqueRatio: 1,
          meanLuma: 0.5,
          lumaStdDev: 0.2,
          edgeEnergy: 0.1,
          averageRgb: [0.45 + index * 0.002, 0.44, 0.43],
          perceptualHash: visualHash(index),
        }
      },
    }

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, recipeOptions(project, {
      executor: async () => imageResult('composite'),
      mediaProcessor,
      grantId: 'grant-1',
      persist: async () => {},
    }))

    const target = useGenerationCanvasStore.getState().nodes.find((node) => node.id === outcome.nodeId)
    expect(mediaProcessor.splitGrid3x3).toHaveBeenCalledOnce()
    expect(outcome.successCount).toBe(9)
    expect(target?.resultCollections?.[0]?.items.map((item) => item.result?.id)).toEqual(outputs.map((output) => output.id))
    expect(target?.resultCollections?.[0]?.quality).toMatchObject({
      status: 'unavailable',
      metrics: { semanticComparatorAvailable: false },
    })
    expect(target?.size).toEqual({ width: 520, height: 520 })
    expect(target?.meta?.previewHeight).toBe(520)
  })

  it('retries a legacy failed grid collection in place with the grid prompt and split postprocess', async () => {
    const controller = await import('./capabilityRecipeController')
    const retry = controller.retryCapabilityRecipeOnNode
    expect(retry).toBeTypeOf('function')

    const outputs = Array.from({ length: 9 }, (_, index) => ({
      id: `view-${index + 1}`,
      label: `机位 ${index + 1}`,
      azimuth: index * 45,
      elevation: 0,
    }))
    const source = useGenerationCanvasStore.getState().nodes.find((node) => node.id === 'source-1')!
    const target: GenerationCanvasNode = {
      id: 'grid-target',
      kind: 'image',
      title: '镜头 1 · image.multiview.grid9',
      categoryId: 'shots',
      position: { x: 400, y: 0 },
      prompt: 'same person',
      regeneratedFrom: 'source-1',
      result: imageResult('ordinary-retry-result'),
      history: [imageResult('ordinary-retry-result')],
      status: 'success',
      meta: {
        vendor: 'provider-a',
        modelKey: 'model-a',
        archetype: { id: 'test-image', modeId: 'edit' },
        capabilityRecipe: {
          runId: 'grid-original',
          recipeId: 'image.multiview.grid9',
          taskId: 'grid-original:setup',
          resourceIds: [],
          outputs: [],
        },
      },
      resultCollections: [{
        id: 'grid-original',
        recipeId: 'image.multiview.grid9',
        createdAt: 100,
        source: {
          nodeId: 'source-1',
          resultId: 'source',
          label: 'Source',
          url: 'nomi-local://source.png',
        },
        items: outputs.map((output) => ({
          ...output,
          status: 'error' as const,
          error: 'Failed to fetch',
        })),
      }],
    }
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [source, target],
      edges: [{ id: 'source-to-grid', source: source.id, target: target.id, mode: 'reference' }],
      groups: [],
      selectedNodeIds: [],
    })

    const prompts: string[] = []
    const mediaProcessor: CapabilityRecipeMediaProcessor = {
      splitGrid3x3: vi.fn<CapabilityRecipeMediaProcessor['splitGrid3x3']>(async (_result, descriptors) => descriptors.map((output) => imageResult(output.id))),
      normalizePanorama2to1: async (result) => result,
      inspectImage: async (result) => {
        const index = outputs.findIndex((output) => output.id === result.id)
        return {
          width: 1024,
          height: 1024,
          opaqueRatio: 1,
          meanLuma: 0.5,
          lumaStdDev: 0.2,
          edgeEnergy: 0.1,
          averageRgb: [0.45 + index * 0.002, 0.44, 0.43],
          perceptualHash: visualHash(index),
        }
      },
    }

    const outcome = await retry('grid-target', recipeOptions(project, {
      executor: async (node: GenerationCanvasNode) => {
        prompts.push(node.prompt || '')
        return imageResult('grid-composite')
      },
      mediaProcessor,
      grantId: 'retry-grant',
      retryRunId: 'grid-retry-2',
      persist: async () => {},
    }))

    const state = useGenerationCanvasStore.getState()
    const retried = state.nodes.find((node) => node.id === 'grid-target')
    expect(state.nodes).toHaveLength(2)
    expect(outcome).toMatchObject({
      nodeId: 'grid-target',
      collectionId: 'grid-original',
      successCount: 9,
      failureCount: 0,
    })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('严格 3x3 九宫格接触表')
    expect(prompts[0]).toContain('创作能力配方：image.multiview.grid9')
    expect(mediaProcessor.splitGrid3x3).toHaveBeenCalledOnce()
    expect(retried?.resultCollections).toHaveLength(1)
    expect(retried?.resultCollections?.[0]?.items.every((item) => item.status === 'success')).toBe(true)
    expect(retried?.result?.id).toBe('view-1')
    expect(retried?.history?.some((result) => result.id === 'ordinary-retry-result')).toBe(true)
    expect((retried?.meta?.capabilityRecipe as { plan?: RecipeRunPlan } | undefined)?.plan).toMatchObject({
      id: 'grid-retry-2',
      recipeId: 'image.multiview.grid9',
      outputCount: 9,
      taskCount: 1,
    })
  })

  it('runs the local video inspector and stores its quality report after video generation', async () => {
    const recipePlan: RecipeRunPlan = {
      ...plan(),
      id: 'video-run',
      recipeId: 'video.look.apply',
      recipeVersion: 2,
      outputKind: 'video',
      params: { aspectRatio: '16:9' },
      outputCount: 1,
      taskCount: 1,
      outputs: [{ id: 'video', label: '视频结果' }],
    }
    const inspectVideoQuality = vi.fn(async (): Promise<CapabilityRecipeVideoInspection> => ({
      suspect: false,
      metadata: {
        kind: 'video' as const,
        durationSeconds: 5,
        width: 1280,
        height: 720,
        hasAudio: false,
      },
      checks: [
        { id: 'zero-duration', suspect: false, detail: '时长 5.0s', metrics: { durationSeconds: 5 } },
        { id: 'black-frames', suspect: false, detail: '黑帧占比 0%', metrics: { blackRatio: 0 } },
        { id: 'frozen-video', suspect: false, detail: '冻结占比 5%', metrics: { freezeRatio: 0.05 } },
      ],
    }))

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, recipeOptions(project, {
      executor: async () => videoResult('generated-video'),
      grantId: 'grant-1',
      persist: async () => {},
      inspectVideoQuality,
    }))

    const target = useGenerationCanvasStore.getState().nodes.find((node) => node.id === outcome.nodeId)
    expect(inspectVideoQuality).toHaveBeenCalledWith(videoResult('generated-video'))
    expect(target?.resultCollections?.[0]?.quality).toMatchObject({
      kind: 'video',
      evaluator: 'video-local-v1',
      metrics: {
        inspected: true,
        durationSeconds: 5,
        width: 1280,
        height: 720,
      },
    })
  })
})
