import { describe, expect, it, vi } from 'vitest'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type {
  GenerationNodeResult,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import type { CapabilityRecipeImageInspection } from './capabilityRecipePostprocess'
import {
  evaluateCapabilityRecipeCollection,
  normalizedPerceptualHashDistance,
} from './capabilityRecipeQuality'

const OUTPUTS = [
  { id: 'front', label: '正面', azimuth: 0, elevation: 0 },
  { id: 'front-right', label: '右前侧', azimuth: 45, elevation: 0 },
  { id: 'right', label: '右侧', azimuth: 90, elevation: 0 },
  { id: 'rear-right', label: '右后侧', azimuth: 135, elevation: 0 },
  { id: 'rear', label: '背面', azimuth: 180, elevation: 0 },
  { id: 'rear-left', label: '左后侧', azimuth: -135, elevation: 0 },
  { id: 'left', label: '左侧', azimuth: -90, elevation: 0 },
  { id: 'front-left', label: '左前侧', azimuth: -45, elevation: 0 },
  { id: 'top', label: '俯视', azimuth: 0, elevation: 75 },
]

function plan(): RecipeRunPlan {
  return {
    id: 'grid-run',
    recipeId: 'image.multiview.grid9',
    recipeVersion: 2,
    outputKind: 'image_collection',
    sourceNodeIds: ['source'],
    resourceIds: [],
    model: {
      vendorKey: 'provider',
      modelKey: 'model',
      archetypeId: 'image-edit',
      modeId: 'edit',
      compatibilityTier: 'compatible',
    },
    params: { backgroundPolicy: 'preserve_scene' },
    outputCount: 9,
    taskCount: 1,
    outputs: OUTPUTS,
    createdAt: 100,
  }
}

function result(id: string): GenerationNodeResult {
  return { id, type: 'image', url: `nomi-local://${id}.png`, createdAt: 100 }
}

function collection(): GenerationResultCollection {
  return {
    id: 'grid-run',
    recipeId: 'image.multiview.grid9',
    createdAt: 100,
    items: OUTPUTS.map((output) => ({
      ...output,
      status: 'success',
      result: result(output.id),
    })),
  }
}

function customViewPlan(): RecipeRunPlan {
  const outputs = [
    { id: 'camera-a', label: '主机位', azimuth: 0, elevation: 0, shotSize: 'medium' },
    { id: 'camera-b', label: '右侧机位', azimuth: 60, elevation: 5, shotSize: 'close' },
    { id: 'camera-c', label: '俯拍机位', azimuth: -30, elevation: 35, shotSize: 'wide' },
  ]
  return {
    ...plan(),
    id: 'custom-view-run',
    recipeId: 'image.multiview.custom',
    outputCount: outputs.length,
    taskCount: outputs.length,
    outputs,
  }
}

function customViewCollection(): GenerationResultCollection {
  return {
    id: 'custom-view-run',
    recipeId: 'image.multiview.custom',
    createdAt: 100,
    items: customViewPlan().outputs.map((output) => ({
      ...output,
      status: 'success',
      result: result(output.id),
    })),
  }
}

function hashFor(seed: number): string {
  let state = seed + 1
  return Array.from({ length: 256 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state >>> 31 ? '1' : '0'
  }).join('')
}

function inspection(index: number): CapabilityRecipeImageInspection {
  const averageRgb: [number, number, number] = [0.46 + index * 0.002, 0.44, 0.42]
  return {
    width: 1024,
    height: 1024,
    opaqueRatio: 1,
    meanLuma: 0.46 + index * 0.002,
    lumaStdDev: 0.18,
    edgeEnergy: 0.12,
    averageRgb,
    perceptualHash: hashFor(index),
    borderAverageRgb: [0.3, 0.32, 0.28],
    borderNearWhiteRatio: 0.02,
    centerRegion: {
      lumaStdDev: 0.18,
      edgeEnergy: 0.12,
      averageRgb,
      perceptualHash: hashFor(index + 100),
    },
  }
}

function panoramaPlan(): RecipeRunPlan {
  return {
    ...plan(),
    id: 'panorama-run',
    recipeId: 'scene.panorama.2to1',
    outputKind: 'panorama',
    outputCount: 1,
    taskCount: 1,
    outputs: [{ id: 'panorama', label: '360° 全景' }],
  }
}

function panoramaCollection(croppedFraction = 0): GenerationResultCollection {
  const panoramaResult: GenerationNodeResult = {
    ...result('panorama'),
    raw: {
      capabilityRecipePostprocess: {
        width: 2048,
        height: 1024,
        panoramaNormalization: {
          sourceWidth: croppedFraction > 0 ? 1536 : 2048,
          sourceHeight: 1024,
          sourceAspectRatio: croppedFraction > 0 ? 1.5 : 2,
          targetAspectRatio: 2,
          croppedFraction,
        },
      },
    },
  }
  return {
    id: 'panorama-run',
    recipeId: 'scene.panorama.2to1',
    createdAt: 100,
    items: [{
      id: 'panorama',
      label: '360° 全景',
      status: 'success',
      result: panoramaResult,
    }],
  }
}

function panoramaInspection({
  seamDistance = 0,
  poleVariation = false,
}: {
  seamDistance?: number
  poleVariation?: boolean
} = {}): CapabilityRecipeImageInspection {
  const left = Array.from({ length: 32 }, () => [0.4, 0.45, 0.5] as [number, number, number])
  const right = Array.from(
    { length: 32 },
    () => [0.4 + seamDistance, 0.45 + seamDistance, 0.5 + seamDistance] as [number, number, number],
  )
  const flat = Array.from({ length: 65 }, () => 0.4)
  const alternating = Array.from({ length: 65 }, (_, index) => index % 2)
  return {
    width: 2048,
    height: 1024,
    opaqueRatio: 1,
    meanLuma: 0.48,
    lumaStdDev: 0.2,
    edgeEnergy: 0.12,
    averageRgb: [0.45, 0.44, 0.43],
    perceptualHash: hashFor(20),
    leftEdgeRgb: left,
    rightEdgeRgb: right,
    topBandLuma: poleVariation ? alternating : flat,
    bottomBandLuma: poleVariation ? alternating : flat,
    middleBandLuma: alternating,
  }
}

function model3dPlan(): RecipeRunPlan {
  return {
    ...plan(),
    id: 'model3d-run',
    recipeId: 'image.multiview.reconstruct3d',
    outputKind: 'model3d',
    outputCount: 1,
    taskCount: 1,
    outputs: [{ id: 'model3d', label: '3D 模型' }],
  }
}

function model3dCollection({
  materialCount = 1,
  externalImageCount = 0,
}: {
  materialCount?: number
  externalImageCount?: number
} = {}): GenerationResultCollection {
  return {
    id: 'model3d-run',
    recipeId: 'image.multiview.reconstruct3d',
    createdAt: 100,
    items: [{
      id: 'model3d',
      label: '3D 模型',
      status: 'success',
      result: {
        id: 'model3d-result',
        type: 'model3d',
        url: 'nomi-local://asset/project/model.glb',
        createdAt: 100,
        model3dValidation: {
          version: 1,
          glbVersion: 2,
          byteLength: 1024,
          meshCount: 1,
          primitiveCount: 2,
          nodeCount: 3,
          materialCount,
          textureCount: externalImageCount ? 1 : 0,
          imageCount: externalImageCount,
          embeddedImageCount: 0,
          externalImageCount,
          externalImageUris: externalImageCount ? ['texture.png'] : [],
          externalBufferCount: 0,
          externalBufferUris: [],
          animationCount: 0,
          skinCount: 0,
          bounds: {
            min: [0, 0, 0],
            max: [1, 2, 1],
            size: [1, 2, 1],
            diagonal: Math.sqrt(6),
          },
          warnings: externalImageCount ? ['模型引用 1 个外部纹理文件'] : [],
        },
      },
    }],
  }
}

function videoPlan(recipeId: 'video.look.apply' | 'video.edit.look' = 'video.look.apply'): RecipeRunPlan {
  return {
    ...plan(),
    id: 'video-run',
    recipeId,
    recipeVersion: recipeId === 'video.look.apply' ? 2 : 1,
    outputKind: 'video',
    params: { aspectRatio: '16:9' },
    outputCount: 1,
    taskCount: 1,
    outputs: [{ id: 'video', label: '视频结果' }],
  }
}

function videoCollection(): GenerationResultCollection {
  return {
    id: 'video-run',
    recipeId: 'video.look.apply',
    createdAt: 100,
    items: [{
      id: 'video',
      label: '视频结果',
      status: 'success',
      result: {
        id: 'video-result',
        type: 'video',
        url: 'nomi-local://asset/project/video.mp4',
        createdAt: 100,
      },
    }],
  }
}

function stylePlan(): RecipeRunPlan {
  return {
    ...plan(),
    id: 'style-run',
    recipeId: 'image.style.transfer',
    outputKind: 'image',
    sourceNodeIds: ['source'],
    resourceIds: ['style-reference'],
    params: { styleStrength: 60 },
    outputCount: 1,
    taskCount: 1,
    outputs: [{ id: 'styled', label: '风格化图片' }],
  }
}

function styleCollection(): GenerationResultCollection {
  return {
    id: 'style-run',
    recipeId: 'image.style.transfer',
    createdAt: 100,
    items: [{
      id: 'styled',
      label: '风格化图片',
      status: 'success',
      result: result('styled'),
    }],
  }
}

function styleInspection(
  averageRgb: [number, number, number],
  perceptualHash: string,
  overrides: Partial<CapabilityRecipeImageInspection> = {},
): CapabilityRecipeImageInspection {
  return {
    width: 1024,
    height: 1024,
    opaqueRatio: 1,
    meanLuma: 0.45,
    lumaStdDev: 0.18,
    edgeEnergy: 0.12,
    averageRgb,
    perceptualHash,
    centerRegion: {
      lumaStdDev: 0.18,
      edgeEnergy: 0.12,
      averageRgb,
      perceptualHash,
    },
    ...overrides,
  }
}

describe('normalizedPerceptualHashDistance', () => {
  it('reports exact and partial hash differences', () => {
    expect(normalizedPerceptualHashDistance('0101', '0101')).toBe(0)
    expect(normalizedPerceptualHashDistance('0101', '1100')).toBe(0.5)
  })
})

describe('evaluateCapabilityRecipeCollection', () => {
  it('produces a passing local quality report for nine valid and visually distinct views', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      plan(),
      collection(),
      async (image) => inspection(OUTPUTS.findIndex((output) => output.id === image.id)),
      200,
    )

    expect(report.quality).toMatchObject({
      version: 1,
      kind: 'grid9',
      evaluator: 'grid9-local-v2',
      status: 'unavailable',
      evaluatedAt: 200,
      metrics: {
        expectedImageCount: 9,
        successfulImageCount: 9,
        inspectedImageCount: 9,
        inspectionErrorCount: 0,
        semanticComparatorAvailable: false,
      },
    })
    expect(report.quality?.checks.map((check) => [check.id, check.status])).toEqual([
      ['view-contract', 'pass'],
      ['image-availability', 'pass'],
      ['dimensions', 'pass'],
      ['image-content', 'pass'],
      ['background-preservation-proxy', 'unavailable'],
      ['view-diversity', 'pass'],
      ['subject-continuity-proxy', 'pass'],
      ['subject-semantic-identity', 'unavailable'],
      ['subject-geometry-consistency', 'unavailable'],
      ['requested-camera-adherence', 'unavailable'],
      ['background-policy-compliance', 'unavailable'],
    ])
    expect(report.quality?.checks.find((check) => check.id === 'subject-continuity-proxy')?.metrics).toMatchObject({
      proxyMode: 'center-composite',
      visualOutlierCount: 0,
      comparedViewCount: 9,
    })
  })

  it('passes semantic identity and geometry only after a batch comparator verifies every view', async () => {
    const compareMultiviewSubjects = vi.fn(async (input: {
      outputs: Array<{ itemId: string }>
    }) => ({
      evaluator: 'deterministic-subject-v1',
      sourceSubjectDetected: true,
      items: input.outputs.map((output) => ({
        itemId: output.itemId,
        outputSubjectDetected: true,
        sameSubject: true,
        identityScore: 0.91,
        geometryConsistent: true,
        geometryScore: 0.86,
        cameraMatches: true,
        cameraScore: 0.9,
        backgroundCompliant: true,
        backgroundScore: 0.88,
      })),
    }))
    const report = await evaluateCapabilityRecipeCollection(
      plan(),
      collection(),
      async (image) => inspection(OUTPUTS.findIndex((output) => output.id === image.id)),
      205,
      {
        sourceResult: result('source'),
        compareMultiviewSubjects,
      },
    )

    expect(compareMultiviewSubjects).toHaveBeenCalledTimes(1)
    expect(report.quality).toMatchObject({
      status: 'pass',
      metrics: {
        semanticComparatorAvailable: true,
        semanticComparatorEvaluator: 'deterministic-subject-v1',
      },
    })
    expect(report.quality?.checks.find((check) => check.id === 'subject-semantic-identity')).toMatchObject({
      status: 'pass',
      metrics: {
        comparedSubjectCount: 9,
        minimumIdentityScore: 0.91,
      },
    })
    expect(report.quality?.checks.find((check) => check.id === 'subject-geometry-consistency')).toMatchObject({
      status: 'pass',
      metrics: {
        comparedGeometryCount: 9,
        minimumGeometryScore: 0.86,
      },
    })
  })

  it('fails semantic identity and geometry on the exact views rejected by the comparator', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      plan(),
      collection(),
      async (image) => inspection(OUTPUTS.findIndex((output) => output.id === image.id)),
      206,
      {
        sourceResult: result('source'),
        compareMultiviewSubjects: async (input: {
          outputs: Array<{ itemId: string }>
        }) => ({
          evaluator: 'deterministic-subject-v1',
          sourceSubjectDetected: true,
          items: input.outputs.map((output) => ({
            itemId: output.itemId,
            outputSubjectDetected: true,
            sameSubject: output.itemId !== 'rear',
            geometryConsistent: output.itemId !== 'top',
            cameraMatches: true,
            backgroundCompliant: true,
            detail: output.itemId === 'rear'
              ? '主体服装和轮廓不一致'
              : output.itemId === 'top'
                ? '主体与桌面的空间关系变化'
                : undefined,
          })),
        }),
      },
    )

    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'subject-semantic-identity')).toMatchObject({
      status: 'fail',
      itemIds: ['rear'],
    })
    expect(report.quality?.checks.find((check) => check.id === 'subject-geometry-consistency')).toMatchObject({
      status: 'fail',
      itemIds: ['top'],
    })
  })

  it('keeps semantic checks unavailable with the comparator error when batch comparison fails', async () => {
    const compareMultiviewSubjects = vi.fn(async () => {
      throw new Error('语义比较服务暂不可用')
    })
    const report = await evaluateCapabilityRecipeCollection(
      plan(),
      collection(),
      async (image) => inspection(OUTPUTS.findIndex((output) => output.id === image.id)),
      207,
      {
        sourceResult: result('source'),
        compareMultiviewSubjects,
      },
    )

    expect(compareMultiviewSubjects).toHaveBeenCalledTimes(1)
    expect(report.quality).toMatchObject({
      status: 'unavailable',
      metrics: { semanticComparatorAvailable: false },
    })
    expect(report.quality?.checks.find((check) => check.id === 'subject-semantic-identity')).toMatchObject({
      status: 'unavailable',
      details: ['语义比较服务暂不可用'],
    })
    expect(report.items).toHaveLength(9)
  })

  it('warns instead of passing when a comparator omits one expected view', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      plan(),
      collection(),
      async (image) => inspection(OUTPUTS.findIndex((output) => output.id === image.id)),
      208,
      {
        sourceResult: result('source'),
        compareMultiviewSubjects: async (input: {
          outputs: Array<{ itemId: string }>
        }) => ({
          evaluator: 'deterministic-subject-v1',
          sourceSubjectDetected: true,
          items: input.outputs.slice(0, -1).map((output) => ({
            itemId: output.itemId,
            outputSubjectDetected: true,
            sameSubject: true,
            geometryConsistent: true,
            cameraMatches: true,
            backgroundCompliant: true,
          })),
        }),
      },
    )

    expect(report.quality?.status).toBe('warning')
    expect(report.quality?.checks.find((check) => check.id === 'subject-semantic-identity')).toMatchObject({
      status: 'warning',
      itemIds: ['top'],
      metrics: {
        comparedSubjectCount: 8,
        unavailableSubjectCount: 1,
      },
    })
    expect(report.quality?.checks.find((check) => check.id === 'subject-geometry-consistency')).toMatchObject({
      status: 'warning',
      itemIds: ['top'],
      metrics: {
        comparedGeometryCount: 8,
        unavailableGeometryCount: 1,
      },
    })
  })

  it('flags exact duplicate views and low-information images without deleting results', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      plan(),
      collection(),
      async (image) => {
        const index = OUTPUTS.findIndex((output) => output.id === image.id)
        if (index === 0) return { ...inspection(index), lumaStdDev: 0, edgeEnergy: 0 }
        if (index === 1) return { ...inspection(index), perceptualHash: hashFor(2) }
        if (index === 2) return { ...inspection(index), perceptualHash: hashFor(2) }
        return inspection(index)
      },
      201,
    )

    expect(report.items).toHaveLength(9)
    expect(report.items.every((item) => item.result)).toBe(true)
    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'image-content')).toMatchObject({
      status: 'fail',
      itemIds: ['front'],
    })
    expect(report.quality?.checks.find((check) => check.id === 'view-diversity')).toMatchObject({
      status: 'fail',
      metrics: { exactDuplicatePairCount: 1 },
    })
  })

  it('keeps the structural report and marks pixel checks unavailable when no inspector exists', async () => {
    const report = await evaluateCapabilityRecipeCollection(plan(), collection(), undefined, 202)

    expect(report.quality?.status).toBe('unavailable')
    expect(report.quality?.checks.slice(0, 2).map((check) => check.status)).toEqual(['pass', 'pass'])
    expect(report.quality?.checks.slice(2).every((check) => check.status === 'unavailable')).toBe(true)
    expect(report.quality?.metrics?.inspectionErrorCount).toBe(9)
  })

  it('isolates one unreadable image as a warning rather than failing the generated collection', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      plan(),
      collection(),
      async (image) => {
        if (image.id === 'top') throw new Error('图片地址失效')
        return inspection(OUTPUTS.findIndex((output) => output.id === image.id))
      },
      203,
    )

    expect(report.quality?.status).toBe('warning')
    expect(report.quality?.metrics?.inspectedImageCount).toBe(8)
    expect(report.quality?.metrics?.inspectionErrorCount).toBe(1)
    expect(report.items.find((item) => item.id === 'top')?.status).toBe('success')
  })

  it('warns when one center subject drifts even if every full-image color stays the same', async () => {
    const stableCenterHash = '0'.repeat(256)
    const report = await evaluateCapabilityRecipeCollection(
      plan(),
      collection(),
      async (image) => {
        const index = OUTPUTS.findIndex((output) => output.id === image.id)
        const base = inspection(index)
        const drifted = image.id === 'rear'
        return {
          ...base,
          averageRgb: [0.45, 0.45, 0.45],
          centerRegion: drifted
            ? {
                lumaStdDev: 0.72,
                edgeEnergy: 0.64,
                averageRgb: [0.95, 0.05, 0.08],
                perceptualHash: '1'.repeat(256),
              }
            : {
                lumaStdDev: 0.18,
                edgeEnergy: 0.12,
                averageRgb: [0.46, 0.44, 0.42],
                perceptualHash: stableCenterHash,
              },
        }
      },
      204,
    )

    expect(report.quality?.checks.find((check) => check.id === 'subject-continuity-proxy')).toMatchObject({
      status: 'warning',
      itemIds: ['rear'],
      metrics: {
        proxyMode: 'center-composite',
        visualOutlierCount: 1,
        comparedViewCount: 9,
      },
    })
  })
})

describe('style-transfer quality evaluation', () => {
  it('reports content retention and measurable movement toward the style reference', async () => {
    const sourceResult = result('source')
    const styleReferenceResult = result('style-reference')
    const sourceHash = '0'.repeat(256)
    const outputHash = `${'1'.repeat(16)}${'0'.repeat(240)}`
    const inspectImage = vi.fn(async (image: GenerationNodeResult) => {
      if (image.id === 'source') {
        return styleInspection([0.2, 0.2, 0.2], sourceHash, {
          meanLuma: 0.2,
          lumaStdDev: 0.1,
          edgeEnergy: 0.08,
        })
      }
      if (image.id === 'style-reference') {
        return styleInspection([0.8, 0.6, 0.2], hashFor(90), {
          meanLuma: 0.62,
          lumaStdDev: 0.28,
          edgeEnergy: 0.22,
        })
      }
      return styleInspection([0.68, 0.52, 0.2], outputHash, {
        meanLuma: 0.54,
        lumaStdDev: 0.24,
        edgeEnergy: 0.19,
      })
    })

    const report = await evaluateCapabilityRecipeCollection(
      stylePlan(),
      styleCollection(),
      inspectImage,
      600,
      { sourceResult, styleReferenceResults: [styleReferenceResult] },
    )

    expect(inspectImage).toHaveBeenCalledTimes(3)
    expect(report.quality).toMatchObject({
      kind: 'style',
      evaluator: 'style-transfer-local-v1',
      status: 'pass',
      evaluatedAt: 600,
    })
    expect(report.quality?.checks.map((check) => [check.id, check.status])).toEqual([
      ['style-output', 'pass'],
      ['style-image-content', 'pass'],
      ['style-aspect-retention', 'pass'],
      ['style-content-retention', 'pass'],
      ['style-transfer-proxy', 'pass'],
    ])
    expect(report.quality?.checks.find((check) => check.id === 'style-transfer-proxy')).toMatchObject({
      metrics: {
        referenceCount: 1,
        inspectedReferenceCount: 1,
      },
    })
  })

  it('preserves the output and marks reference checks unavailable without a readable style image', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      stylePlan(),
      styleCollection(),
      async () => styleInspection([0.4, 0.4, 0.4], hashFor(50)),
      601,
      { sourceResult: result('source'), styleReferenceResults: [] },
    )

    expect(report.items[0]?.result?.id).toBe('styled')
    expect(report.quality?.kind).toBe('style')
    expect(report.quality?.status).toBe('unavailable')
    expect(report.quality?.checks.find((check) => check.id === 'style-transfer-proxy')).toMatchObject({
      status: 'unavailable',
    })
  })

  it('fails closed when a successful style result has no readable media address', async () => {
    const broken = styleCollection()
    if (broken.items[0]?.result) broken.items[0].result.url = undefined
    const inspectImage = vi.fn(async (image: GenerationNodeResult) => {
      if (image.id === 'source') return styleInspection([0.2, 0.2, 0.2], '0'.repeat(256))
      if (image.id === 'style-reference') return styleInspection([0.8, 0.6, 0.2], hashFor(90))
      return styleInspection([0.68, 0.52, 0.2], `${'1'.repeat(16)}${'0'.repeat(240)}`)
    })

    const report = await evaluateCapabilityRecipeCollection(
      stylePlan(),
      broken,
      inspectImage,
      602,
      {
        sourceResult: result('source'),
        styleReferenceResults: [result('style-reference')],
      },
    )

    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'style-output')).toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('没有可读取'),
    })
    expect(inspectImage).toHaveBeenCalledTimes(2)
    expect(inspectImage).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'styled' }))
  })
})

describe('custom-view quality evaluation', () => {
  it('reports a valid set of distinct, independently packaged camera outputs', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      customViewPlan(),
      customViewCollection(),
      async (image) => inspection(customViewPlan().outputs.findIndex((output) => output.id === image.id)),
      650,
    )

    expect(report.quality).toMatchObject({
      kind: 'multiview',
      evaluator: 'custom-view-local-v2',
      status: 'unavailable',
      evaluatedAt: 650,
      metrics: {
        expectedImageCount: 3,
        successfulImageCount: 3,
        inspectedImageCount: 3,
        semanticComparatorAvailable: false,
      },
    })
    expect(report.quality?.checks.map((check) => [check.id, check.status])).toEqual([
      ['custom-view-contract', 'pass'],
      ['custom-view-images', 'pass'],
      ['custom-view-content', 'pass'],
      ['background-preservation-proxy', 'unavailable'],
      ['custom-view-dimensions', 'pass'],
      ['custom-view-diversity', 'pass'],
      ['subject-continuity-proxy', 'pass'],
      ['subject-semantic-identity', 'unavailable'],
      ['subject-geometry-consistency', 'unavailable'],
      ['requested-camera-adherence', 'unavailable'],
      ['background-policy-compliance', 'unavailable'],
      ['custom-view-packaging', 'pass'],
    ])
  })

  it('passes semantic checks for custom cameras only after one batch comparison', async () => {
    const compareMultiviewSubjects = vi.fn(async (input: {
      outputs: Array<{ itemId: string }>
    }) => ({
      evaluator: 'deterministic-subject-v1',
      sourceSubjectDetected: true,
      items: input.outputs.map((output) => ({
        itemId: output.itemId,
        outputSubjectDetected: true,
        sameSubject: true,
        identityScore: 0.9,
        geometryConsistent: true,
        geometryScore: 0.84,
        cameraMatches: true,
        cameraScore: 0.9,
        backgroundCompliant: true,
        backgroundScore: 0.87,
      })),
    }))
    const report = await evaluateCapabilityRecipeCollection(
      customViewPlan(),
      customViewCollection(),
      async (image) => inspection(customViewPlan().outputs.findIndex((output) => output.id === image.id)),
      653,
      {
        sourceResult: result('source'),
        compareMultiviewSubjects,
      },
    )

    expect(compareMultiviewSubjects).toHaveBeenCalledTimes(1)
    expect(report.quality).toMatchObject({
      status: 'pass',
      metrics: {
        semanticComparatorAvailable: true,
        semanticComparatorEvaluator: 'deterministic-subject-v1',
      },
    })
  })

  it('warns when one custom camera output has compound center-subject drift', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      customViewPlan(),
      customViewCollection(),
      async (image) => {
        const index = customViewPlan().outputs.findIndex((output) => output.id === image.id)
        const base = inspection(index)
        const drifted = image.id === 'camera-b'
        return {
          ...base,
          averageRgb: [0.45, 0.45, 0.45],
          centerRegion: {
            lumaStdDev: drifted ? 0.72 : 0.18,
            edgeEnergy: drifted ? 0.64 : 0.12,
            averageRgb: drifted ? [0.95, 0.05, 0.08] : [0.46, 0.44, 0.42],
            perceptualHash: (drifted ? '1' : '0').repeat(256),
          },
        }
      },
      652,
    )

    expect(report.quality?.checks.find((check) => check.id === 'subject-continuity-proxy')).toMatchObject({
      status: 'warning',
      itemIds: ['camera-b'],
      metrics: {
        proxyMode: 'center-composite',
        visualOutlierCount: 1,
        comparedViewCount: 3,
      },
    })
  })

  it('flags a changed camera contract and duplicate result without removing either output', async () => {
    const broken = customViewCollection()
    broken.items[1] = { ...broken.items[1]!, azimuth: 0 }
    const report = await evaluateCapabilityRecipeCollection(
      customViewPlan(),
      broken,
      async (image) => {
        const index = customViewPlan().outputs.findIndex((output) => output.id === image.id)
        return {
          ...inspection(index),
          perceptualHash: index < 2 ? hashFor(20) : hashFor(21),
        }
      },
      651,
    )

    expect(report.items).toHaveLength(3)
    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'custom-view-contract')?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'custom-view-diversity')).toMatchObject({
      status: 'fail',
      metrics: { exactDuplicatePairCount: 1 },
    })
  })
})

describe('panorama quality evaluation', () => {
  it('passes a native 2:1 panorama with continuous seam and stable poles', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      panoramaPlan(),
      panoramaCollection(),
      async () => panoramaInspection(),
      300,
    )

    expect(report.quality).toMatchObject({
      kind: 'panorama',
      evaluator: 'panorama-local-v1',
      status: 'pass',
      evaluatedAt: 300,
      metrics: { width: 2048, height: 1024, aspectRatio: 2 },
    })
    expect(report.quality?.checks.map((check) => [check.id, check.status])).toEqual([
      ['panorama-image', 'pass'],
      ['panorama-aspect', 'pass'],
      ['panorama-normalization', 'pass'],
      ['panorama-seam', 'pass'],
      ['panorama-poles', 'pass'],
      ['panorama-projection-proxy', 'pass'],
    ])
  })

  it('flags a heavily cropped panorama with a broken seam and distorted poles', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      panoramaPlan(),
      panoramaCollection(0.25),
      async () => panoramaInspection({ seamDistance: 0.5, poleVariation: true }),
      301,
    )

    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'panorama-normalization')).toMatchObject({
      status: 'fail',
      metrics: { croppedPercent: 25 },
    })
    expect(report.quality?.checks.find((check) => check.id === 'panorama-seam')?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'panorama-poles')?.status).toBe('fail')
    expect(report.items[0]?.result?.id).toBe('panorama')
  })

  it('retains the panorama while marking pixel checks unavailable without an inspector', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      panoramaPlan(),
      panoramaCollection(),
      undefined,
      302,
    )

    expect(report.quality?.status).toBe('unavailable')
    expect(report.quality?.checks.find((check) => check.id === 'panorama-normalization')?.status).toBe('pass')
    expect(report.quality?.checks.find((check) => check.id === 'panorama-inspection')?.status).toBe('unavailable')
    expect(report.items[0]?.status).toBe('success')
  })

  it('fails closed when panorama metadata survives but the image address is missing', async () => {
    const broken = panoramaCollection()
    if (broken.items[0]?.result) broken.items[0].result.url = undefined
    const inspectImage = vi.fn(async () => panoramaInspection())

    const report = await evaluateCapabilityRecipeCollection(
      panoramaPlan(),
      broken,
      inspectImage,
      303,
    )

    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'panorama-image')).toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('没有可读取'),
    })
    expect(inspectImage).not.toHaveBeenCalled()
  })
})

describe('model3d quality evaluation', () => {
  it('reports a validated, parseable GLB with usable geometry', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      model3dPlan(),
      model3dCollection(),
      undefined,
      400,
    )

    expect(report.quality).toMatchObject({
      kind: 'model3d',
      evaluator: 'model3d-local-v1',
      status: 'pass',
      metrics: {
        meshCount: 1,
        primitiveCount: 2,
        materialCount: 1,
      },
    })
    expect(report.quality?.checks.map((check) => [check.id, check.status])).toEqual([
      ['model3d-output', 'pass'],
      ['glb-container', 'pass'],
      ['glb-geometry', 'pass'],
      ['glb-materials', 'pass'],
      ['glb-textures', 'pass'],
    ])
  })

  it('warns when a GLB has no material and still references an external texture', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      model3dPlan(),
      model3dCollection({ materialCount: 0, externalImageCount: 1 }),
      undefined,
      401,
    )

    expect(report.quality?.status).toBe('warning')
    expect(report.quality?.checks.find((check) => check.id === 'glb-materials')?.status).toBe('warning')
    expect(report.quality?.checks.find((check) => check.id === 'glb-textures')).toMatchObject({
      status: 'warning',
      metrics: { externalImageCount: 1 },
    })
  })

  it('keeps a legacy model result but marks structural checks unavailable until revalidated', async () => {
    const legacy = model3dCollection()
    if (legacy.items[0]?.result) legacy.items[0].result.model3dValidation = undefined

    const report = await evaluateCapabilityRecipeCollection(model3dPlan(), legacy, undefined, 402)

    expect(report.items[0]?.status).toBe('success')
    expect(report.quality?.status).toBe('unavailable')
    expect(report.quality?.checks.map((check) => [check.id, check.status])).toEqual([
      ['model3d-output', 'pass'],
      ['glb-container', 'unavailable'],
      ['glb-geometry', 'unavailable'],
      ['glb-materials', 'unavailable'],
      ['glb-textures', 'unavailable'],
    ])
  })

  it('does not pass a stale GLB validation summary when the model address is missing', async () => {
    const broken = model3dCollection()
    if (broken.items[0]?.result) {
      broken.items[0].result.url = undefined
      broken.items[0].result.thumbnailUrl = 'nomi-local://asset/project/model-preview.png'
    }

    const report = await evaluateCapabilityRecipeCollection(model3dPlan(), broken, undefined, 403)

    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'model3d-output')).toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('没有可读取'),
    })
  })
})

describe('video quality evaluation', () => {
  it('retains a generated video and records unavailable local checks when no inspector exists', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      videoPlan(),
      videoCollection(),
      undefined,
      500,
    )

    expect(report.items[0]?.result?.id).toBe('video-result')
    expect(report.quality).toMatchObject({
      kind: 'video',
      evaluator: 'video-local-v1',
      status: 'unavailable',
      evaluatedAt: 500,
    })
    expect(report.quality?.checks.find((check) => check.id === 'video-technical')).toMatchObject({
      status: 'unavailable',
    })
  })

  it('records duration, dimensions, aspect ratio, black frames, and motion from the local inspector', async () => {
    const inspectVideo = vi.fn(async () => ({
      suspect: false,
      metadata: {
        kind: 'video' as const,
        durationSeconds: 5,
        width: 1280,
        height: 720,
        fps: 24,
        videoCodec: 'h264',
        hasAudio: false,
      },
      checks: [
        { id: 'zero-duration', suspect: false, detail: '时长 5.0s', metrics: { durationSeconds: 5 } },
        { id: 'black-frames', suspect: false, detail: '黑帧占比 2%', metrics: { blackRatio: 0.02 } },
        { id: 'frozen-video', suspect: false, detail: '冻结占比 10%', metrics: { freezeRatio: 0.1 } },
      ],
    }))
    const report = await evaluateCapabilityRecipeCollection(
      videoPlan(),
      videoCollection(),
      undefined,
      501,
      { inspectVideo } as never,
    )

    expect(inspectVideo).toHaveBeenCalledOnce()
    expect(report.quality?.checks.map((check) => [check.id, check.status])).toEqual([
      ['video-output', 'pass'],
      ['video-technical', 'pass'],
      ['video-aspect', 'pass'],
      ['video-black-frames', 'pass'],
      ['video-motion', 'pass'],
      ['video-reference-adherence', 'unavailable'],
    ])
    expect(report.quality).toMatchObject({
      kind: 'video',
      status: 'unavailable',
      metrics: {
        inspected: true,
        durationSeconds: 5,
        width: 1280,
        height: 720,
        freezeRatio: 0.1,
      },
    })
  })

  it('fails a mostly frozen video while preserving the generated output', async () => {
    const report = await evaluateCapabilityRecipeCollection(
      videoPlan(),
      videoCollection(),
      undefined,
      502,
      {
        inspectVideo: async () => ({
          suspect: true,
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
            { id: 'frozen-video', suspect: true, detail: '冻结占比 96%', metrics: { freezeRatio: 0.96 } },
          ],
        }),
      } as never,
    )

    expect(report.items[0]?.result?.id).toBe('video-result')
    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'video-motion')).toMatchObject({
      status: 'fail',
      itemIds: ['video'],
    })
  })

  it('does not inspect or accept a video result without a readable media address', async () => {
    const broken = videoCollection()
    if (broken.items[0]?.result) {
      broken.items[0].result.url = undefined
      broken.items[0].result.thumbnailUrl = 'nomi-local://asset/project/video-poster.jpg'
    }
    const inspectVideo = vi.fn(async () => ({
      suspect: false,
      metadata: {
        kind: 'video' as const,
        durationSeconds: 5,
        width: 1280,
        height: 720,
        hasAudio: false,
      },
      checks: [
        { id: 'black-frames', suspect: false, detail: '黑帧占比 0%', metrics: { blackRatio: 0 } },
        { id: 'frozen-video', suspect: false, detail: '冻结占比 0%', metrics: { freezeRatio: 0 } },
      ],
    }))

    const report = await evaluateCapabilityRecipeCollection(
      videoPlan(),
      broken,
      undefined,
      504,
      { inspectVideo } as never,
    )

    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'video-output')).toMatchObject({
      status: 'fail',
      summary: expect.stringContaining('没有可读取'),
    })
    expect(inspectVideo).not.toHaveBeenCalled()
  })

  it('fails video-to-video timing retention when the output drops most of the source duration', async () => {
    const sourceVideo: GenerationNodeResult = {
      id: 'source-video',
      type: 'video',
      url: 'nomi-local://asset/project/source.mp4',
      createdAt: 100,
    }
    const inspectVideo = vi.fn(async (video: GenerationNodeResult) => ({
      suspect: false,
      metadata: {
        kind: 'video' as const,
        durationSeconds: video.id === 'source-video' ? 10 : 4,
        width: 1280,
        height: 720,
        hasAudio: false,
      },
      checks: [
        { id: 'zero-duration', suspect: false, detail: '时长有效' },
        { id: 'black-frames', suspect: false, detail: '黑帧占比 0%', metrics: { blackRatio: 0 } },
        {
          id: 'frozen-video',
          suspect: false,
          detail: '冻结占比 10%',
          metrics: { freezeRatio: video.id === 'source-video' ? 0.08 : 0.1 },
        },
      ],
    }))

    const report = await evaluateCapabilityRecipeCollection(
      videoPlan('video.edit.look'),
      { ...videoCollection(), recipeId: 'video.edit.look' },
      undefined,
      503,
      { inspectVideo, sourceResult: sourceVideo } as never,
    )

    expect(inspectVideo).toHaveBeenCalledTimes(2)
    expect(report.quality?.status).toBe('fail')
    expect(report.quality?.checks.find((check) => check.id === 'video-source-retention')).toMatchObject({
      status: 'fail',
      metrics: {
        sourceDurationSeconds: 10,
        outputDurationSeconds: 4,
        durationRetentionRatio: 0.4,
      },
    })
  })
})
