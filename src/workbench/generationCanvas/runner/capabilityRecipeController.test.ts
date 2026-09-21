import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { runCapabilityRecipeOnNode } from './capabilityRecipeController'
import type { CapabilityRecipeMediaProcessor } from './capabilityRecipePostprocess'
import type { GenerationNodeExecutor } from './generationNodeExecutor'

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

beforeEach(() => {
  const source: GenerationCanvasNode = {
    id: 'source-1', kind: 'image', title: 'Source', position: { x: 0, y: 0 }, prompt: 'same person',
    categoryId: 'shots', result: imageResult('source'), history: [imageResult('source')], status: 'success',
    meta: { vendor: 'old-provider', modelKey: 'old-model' },
  }
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [source], edges: [], groups: [], selectedNodeIds: [] })
})

describe('runCapabilityRecipeOnNode', () => {
  it('creates one derived collection node and leaves the source untouched', async () => {
    const executor = vi.fn(async (node: GenerationCanvasNode) => {
      const recipeMeta = node.meta?.capabilityRecipe as { output?: { id?: string } } | undefined
      return imageResult(recipeMeta?.output?.id || 'unknown')
    })

    const outcome = await runCapabilityRecipeOnNode('source-1', plan(), {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    })

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

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    })

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

    const outcome = await runCapabilityRecipeOnNode('source-1', videoPlan, {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    })

    expect(outcome.successCount).toBe(1)
    expect(executor).toHaveBeenCalledOnce()
  })

  it('requires a spend grant before creating the derived node', async () => {
    await expect(runCapabilityRecipeOnNode('source-1', plan(), {
      executor: async () => imageResult('unused'),
      grantId: '',
      persist: async () => {},
    })).rejects.toThrow('缺少付费生成授权')

    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
  })

  it('can mint a grant for the newly-created target with the exact task budget', async () => {
    const grantFactory = vi.fn(async () => 'grant-for-target')
    const executor = vi.fn(async () => imageResult('generated'))

    const outcome = await runCapabilityRecipeOnNode('source-1', plan(), {
      executor,
      grantFactory,
      persist: async () => {},
    })

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

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    })

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

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, {
      executor: async () => imageResult('styled'),
      mediaProcessor,
      grantId: 'grant-1',
      persist: async () => {},
    })

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

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, {
      executor,
      mediaProcessor,
      grantId: 'grant-1',
      persist: async () => {},
    })

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

    await runCapabilityRecipeOnNode('source-1', plan(), {
      executor,
      mediaProcessor,
      grantId: 'grant-1',
      persist: async () => {},
    })

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

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    })

    expect(useGenerationCanvasStore.getState().nodes.find((node) => node.id === outcome.nodeId)?.kind).toBe('model3d')
  })

  it('compiles a distinct camera instruction into every custom-view task', async () => {
    const prompts: string[] = []
    const executor = vi.fn(async (node: GenerationCanvasNode) => {
      prompts.push(node.prompt || '')
      return imageResult(`generated-${prompts.length}`)
    })

    await runCapabilityRecipeOnNode('source-1', plan(), {
      executor,
      grantId: 'grant-1',
      persist: async () => {},
    })

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

    const outcome = await runCapabilityRecipeOnNode('source-1', plan(), {
      executor,
      mediaProcessor,
      compareMultiviewSubjects,
      grantId: 'grant-1',
      persist: async () => {},
    })

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

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, {
      executor,
      mediaProcessor,
      grantId: 'grant-1',
      persist: async () => {},
    })

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

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, {
      executor: async () => imageResult('composite'),
      mediaProcessor,
      grantId: 'grant-1',
      persist: async () => {},
    })

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
    const retry = Reflect.get(controller, 'retryCapabilityRecipeOnNode')
    expect(retry).toBeTypeOf('function')
    if (typeof retry !== 'function') return

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

    const outcome = await retry('grid-target', {
      executor: async (node: GenerationCanvasNode) => {
        prompts.push(node.prompt || '')
        return imageResult('grid-composite')
      },
      mediaProcessor,
      grantId: 'retry-grant',
      retryRunId: 'grid-retry-2',
      persist: async () => {},
    })

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
    const inspectVideoQuality = vi.fn(async () => ({
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

    const outcome = await runCapabilityRecipeOnNode('source-1', recipePlan, {
      executor: async () => videoResult('generated-video'),
      grantId: 'grant-1',
      persist: async () => {},
      inspectVideoQuality,
    } as never)

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
