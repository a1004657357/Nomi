import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import type { RecipeOutputDescriptor, RecipeRunPlan } from '../../../config/capabilityRecipes'
import { dataUrlToFile, persistNodeImageFile } from '../adapters/persistNodeImage'
import type { GenerationNodeResult, GenerationResultCollection } from '../model/generationCanvasTypes'
import type { CapabilityRecipeTask } from './capabilityRecipeRunner'
import { blobToDataUrl } from '../../../lib/removeBackground'

export type CapabilityRecipeMediaProcessor = {
  splitGrid3x3: (
    result: GenerationNodeResult,
    outputs: RecipeOutputDescriptor[],
    ownerNodeId: string,
  ) => Promise<GenerationNodeResult[]>
  normalizePanorama2to1: (
    result: GenerationNodeResult,
    ownerNodeId: string,
  ) => Promise<GenerationNodeResult>
  normalizeStyleAspect?: (
    result: GenerationNodeResult,
    ownerNodeId: string,
    aspectRatio: number,
  ) => Promise<GenerationNodeResult>
  normalizeImageDimensions?: (
    result: GenerationNodeResult,
    ownerNodeId: string,
    width: number,
    height: number,
  ) => Promise<GenerationNodeResult>
  inspectImage?: (result: GenerationNodeResult) => Promise<CapabilityRecipeImageInspection>
}

type PixelCrop = { x: number; y: number; width: number; height: number }

export type CapabilityRecipeImageInspection = {
  width: number
  height: number
  opaqueRatio: number
  meanLuma: number
  lumaStdDev: number
  edgeEnergy: number
  averageRgb: [number, number, number]
  perceptualHash: string
  borderAverageRgb?: [number, number, number]
  borderNearWhiteRatio?: number
  centerRegion?: {
    lumaStdDev: number
    edgeEnergy: number
    averageRgb: [number, number, number]
    perceptualHash: string
  }
  leftEdgeRgb?: Array<[number, number, number]>
  rightEdgeRgb?: Array<[number, number, number]>
  topBandLuma?: number[]
  bottomBandLuma?: number[]
  middleBandLuma?: number[]
}

function sourceImageUrl(result: GenerationNodeResult): string {
  const url = result.url || result.thumbnailUrl || result.providerUrl
  if (!url) throw new Error('生成结果没有可处理的图片地址')
  return url
}

function loadImage(url: string): Promise<HTMLImageElement> {
  if (typeof Image === 'undefined') throw new Error('当前运行环境不支持图片后处理')
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法读取生成图片，可能是图片地址跨域或已失效'))
    if (!url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('nomi-local:')) {
      image.crossOrigin = 'anonymous'
    }
    image.src = url
  })
}

async function renderCrop(image: HTMLImageElement, crop: PixelCrop): Promise<string> {
  if (typeof document === 'undefined') throw new Error('当前运行环境不支持图片后处理')
  const canvas = document.createElement('canvas')
  canvas.width = crop.width
  canvas.height = crop.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建图片后处理画布')
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  )
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('canvas toBlob failed')), 'image/png')
  })
  return blobToDataUrl(blob)
}

function renderImageSample(image: HTMLImageElement): ImageData {
  if (typeof document === 'undefined') throw new Error('当前运行环境不支持图片质量检测')
  const canvas = document.createElement('canvas')
  canvas.width = 65
  canvas.height = 32
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建图片质量检测画布')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

export function analyzeCapabilityImagePixels(
  pixels: Uint8ClampedArray,
  sampleWidth: number,
  sampleHeight: number,
  sourceWidth = sampleWidth,
  sourceHeight = sampleHeight,
): CapabilityRecipeImageInspection {
  const width = Math.max(1, Math.floor(sampleWidth))
  const height = Math.max(1, Math.floor(sampleHeight))
  const sampleCount = width * height
  if (pixels.length < sampleCount * 4) throw new Error('图片质量检测像素数据不完整')

  const lumas = new Float64Array(sampleCount)
  let alphaSum = 0
  let redSum = 0
  let greenSum = 0
  let blueSum = 0
  let weightedPixels = 0
  let lumaSum = 0

  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * 4
    const red = pixels[offset]! / 255
    const green = pixels[offset + 1]! / 255
    const blue = pixels[offset + 2]! / 255
    const alpha = pixels[offset + 3]! / 255
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722
    lumas[index] = luma
    lumaSum += luma
    alphaSum += alpha
    redSum += red * alpha
    greenSum += green * alpha
    blueSum += blue * alpha
    weightedPixels += alpha
  }

  const meanLuma = lumaSum / sampleCount
  let lumaVariance = 0
  let edgeSum = 0
  let edgeCount = 0
  const hashBits: string[] = []

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const luma = lumas[index]!
      lumaVariance += (luma - meanLuma) ** 2
      if (x + 1 < width) {
        const right = lumas[index + 1]!
        edgeSum += Math.abs(luma - right)
        edgeCount += 1
        hashBits.push(luma > right ? '1' : '0')
      }
      if (y + 1 < height) {
        edgeSum += Math.abs(luma - lumas[index + width]!)
        edgeCount += 1
      }
    }
  }

  const colorDivisor = Math.max(Number.EPSILON, weightedPixels)
  const rgbAt = (x: number, y: number): [number, number, number] => {
    const offset = (y * width + x) * 4
    return [
      pixels[offset]! / 255,
      pixels[offset + 1]! / 255,
      pixels[offset + 2]! / 255,
    ]
  }
  const bandLuma = (startY: number, endY: number): number[] => (
    Array.from({ length: width }, (_, x) => {
      let sum = 0
      let count = 0
      for (let y = startY; y < endY; y += 1) {
        sum += lumas[y * width + x]!
        count += 1
      }
      return count > 0 ? sum / count : 0
    })
  )
  const bandHeight = Math.max(1, Math.min(2, height))
  const middleStart = Math.max(0, Math.floor(height / 2) - Math.floor(bandHeight / 2))
  const centerStartX = Math.max(0, Math.floor(width * 0.25))
  const centerEndX = Math.max(centerStartX + 1, Math.min(width, Math.ceil(width * 0.75)))
  const centerStartY = Math.max(0, Math.floor(height * 0.1))
  const centerEndY = Math.max(centerStartY + 1, Math.min(height, Math.ceil(height * 0.72)))
  const centerLumas: number[] = []
  const centerHash: string[] = []
  let centerRed = 0
  let centerGreen = 0
  let centerBlue = 0
  let centerWeight = 0
  let centerEdge = 0
  let centerEdgeCount = 0
  let borderRed = 0
  let borderGreen = 0
  let borderBlue = 0
  let borderWeight = 0
  let borderNearWhite = 0
  let borderCount = 0
  const borderX = Math.max(1, Math.floor(width * 0.08))
  const borderY = Math.max(1, Math.floor(height * 0.08))
  for (let y = centerStartY; y < centerEndY; y += 1) {
    for (let x = centerStartX; x < centerEndX; x += 1) {
      const index = y * width + x
      const offset = index * 4
      const alpha = pixels[offset + 3]! / 255
      const luma = lumas[index]!
      centerLumas.push(luma)
      centerRed += pixels[offset]! / 255 * alpha
      centerGreen += pixels[offset + 1]! / 255 * alpha
      centerBlue += pixels[offset + 2]! / 255 * alpha
      centerWeight += alpha
      if (x + 1 < centerEndX) {
        const right = lumas[index + 1]!
        centerEdge += Math.abs(luma - right)
        centerEdgeCount += 1
        centerHash.push(luma > right ? '1' : '0')
      }
      if (y + 1 < centerEndY) {
        centerEdge += Math.abs(luma - lumas[index + width]!)
        centerEdgeCount += 1
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= borderX && x < width - borderX && y >= borderY && y < height - borderY) continue
      const offset = (y * width + x) * 4
      const red = pixels[offset]! / 255
      const green = pixels[offset + 1]! / 255
      const blue = pixels[offset + 2]! / 255
      const alpha = pixels[offset + 3]! / 255
      borderRed += red * alpha
      borderGreen += green * alpha
      borderBlue += blue * alpha
      borderWeight += alpha
      borderCount += 1
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
      if (alpha >= 0.9 && red >= 0.9 && green >= 0.9 && blue >= 0.9 && chroma <= 0.08) {
        borderNearWhite += 1
      }
    }
  }
  const centerMean = centerLumas.reduce((sum, value) => sum + value, 0) / Math.max(1, centerLumas.length)
  const centerVariance = centerLumas.reduce((sum, value) => sum + (value - centerMean) ** 2, 0)
    / Math.max(1, centerLumas.length)
  const centerColorDivisor = Math.max(Number.EPSILON, centerWeight)
  return {
    width: Math.max(1, Math.floor(sourceWidth)),
    height: Math.max(1, Math.floor(sourceHeight)),
    opaqueRatio: alphaSum / sampleCount,
    meanLuma,
    lumaStdDev: Math.sqrt(lumaVariance / sampleCount),
    edgeEnergy: edgeCount > 0 ? edgeSum / edgeCount : 0,
    averageRgb: [
      redSum / colorDivisor,
      greenSum / colorDivisor,
      blueSum / colorDivisor,
    ],
    perceptualHash: hashBits.join(''),
    borderAverageRgb: [
      borderRed / Math.max(Number.EPSILON, borderWeight),
      borderGreen / Math.max(Number.EPSILON, borderWeight),
      borderBlue / Math.max(Number.EPSILON, borderWeight),
    ],
    borderNearWhiteRatio: borderNearWhite / Math.max(1, borderCount),
    centerRegion: {
      lumaStdDev: Math.sqrt(centerVariance),
      edgeEnergy: centerEdgeCount > 0 ? centerEdge / centerEdgeCount : 0,
      averageRgb: [
        centerRed / centerColorDivisor,
        centerGreen / centerColorDivisor,
        centerBlue / centerColorDivisor,
      ],
      perceptualHash: centerHash.join(''),
    },
    leftEdgeRgb: Array.from({ length: height }, (_, y) => rgbAt(0, y)),
    rightEdgeRgb: Array.from({ length: height }, (_, y) => rgbAt(width - 1, y)),
    topBandLuma: bandLuma(0, bandHeight),
    bottomBandLuma: bandLuma(height - bandHeight, height),
    middleBandLuma: bandLuma(middleStart, Math.min(height, middleStart + bandHeight)),
  }
}

async function persistProcessedImageForProject(project: ProjectExecutionContext, dataUrl: string, ownerNodeId: string, fileName: string): Promise<string> {
  const file = dataUrlToFile(dataUrl, fileName)
  if (!file) return dataUrl
  return await persistNodeImageFile(file, ownerNodeId, project) || dataUrl
}

function withProcessedOutput(
  source: GenerationNodeResult,
  id: string,
  url: string,
  output: RecipeOutputDescriptor | undefined,
  dimensions: { width: number; height: number },
  postprocessDetails: Record<string, unknown> = {},
): GenerationNodeResult {
  return {
    ...source,
    id,
    url,
    thumbnailUrl: undefined,
    alternatives: undefined,
    raw: {
      capabilityRecipePostprocess: {
        sourceResultId: source.id,
        ...(output ? { output } : {}),
        ...dimensions,
        ...postprocessDetails,
      },
      providerRaw: source.raw,
    },
    provenance: source.provenance ? {
      ...source.provenance,
      params: {
        ...(source.provenance.params ?? {}),
        ...(output ? { capabilityRecipeOutput: output } : {}),
        outputWidth: dimensions.width,
        outputHeight: dimensions.height,
      },
    } : undefined,
  }
}

export function centeredCropForAspectRatio(width: number, height: number, aspectRatio: number): PixelCrop {
  const sourceWidth = Math.max(1, Math.floor(width))
  const sourceHeight = Math.max(1, Math.floor(height))
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new Error('目标画幅比例无效')
  }

  let cropWidth = sourceWidth
  let cropHeight = Math.max(1, Math.floor(cropWidth / aspectRatio))
  cropWidth = Math.max(1, Math.floor(cropHeight * aspectRatio))
  if (cropHeight > sourceHeight) {
    cropHeight = sourceHeight
    cropWidth = Math.max(1, Math.floor(cropHeight * aspectRatio))
    cropHeight = Math.max(1, Math.floor(cropWidth / aspectRatio))
  }

  return {
    x: Math.floor((sourceWidth - cropWidth) / 2),
    y: Math.floor((sourceHeight - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  }
}

const CAPABILITY_IMAGE_ASPECT_RATIOS = [
  '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9',
  '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
] as const

export function nearestCapabilityImageAspectRatio(width: number, height: number): string {
  const sourceRatio = width / Math.max(1, height)
  return CAPABILITY_IMAGE_ASPECT_RATIOS.reduce((nearest, candidate) => {
    const [candidateWidth, candidateHeight] = candidate.split(':').map(Number)
    const [nearestWidth, nearestHeight] = nearest.split(':').map(Number)
    const candidateDistance = Math.abs(Math.log(sourceRatio / (candidateWidth! / candidateHeight!)))
    const nearestDistance = Math.abs(Math.log(sourceRatio / (nearestWidth! / nearestHeight!)))
    return candidateDistance < nearestDistance ? candidate : nearest
  })
}

export function createBrowserCapabilityRecipeMediaProcessor(project: ProjectExecutionContext): CapabilityRecipeMediaProcessor {
  const persistProcessedImage = (dataUrl: string, ownerNodeId: string, fileName: string) => persistProcessedImageForProject(project, dataUrl, ownerNodeId, fileName)
  return {
  async splitGrid3x3(result, outputs, ownerNodeId) {
    const image = await loadImage(sourceImageUrl(result))
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    const tileWidth = Math.floor(sourceWidth / 3)
    const tileHeight = Math.floor(sourceHeight / 3)
    if (tileWidth < 1 || tileHeight < 1) throw new Error('九宫格图片尺寸无效')
    const originX = Math.floor((sourceWidth - tileWidth * 3) / 2)
    const originY = Math.floor((sourceHeight - tileHeight * 3) / 2)

    return Promise.all(outputs.slice(0, 9).map(async (output, index) => {
      const row = Math.floor(index / 3)
      const column = index % 3
      const dataUrl = await renderCrop(image, {
        x: originX + column * tileWidth,
        y: originY + row * tileHeight,
        width: tileWidth,
        height: tileHeight,
      })
      const id = `${result.id}:${output.id}`
      const url = await persistProcessedImage(dataUrl, ownerNodeId, `recipe-grid-${ownerNodeId}-${output.id}.png`)
      return withProcessedOutput(result, id, url, output, { width: tileWidth, height: tileHeight })
    }))
  },

  async normalizePanorama2to1(result, ownerNodeId) {
    const image = await loadImage(sourceImageUrl(result))
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    const crop = centeredCropForAspectRatio(sourceWidth, sourceHeight, 2)
    const panoramaNormalization = {
      sourceWidth,
      sourceHeight,
      sourceAspectRatio: sourceWidth / Math.max(1, sourceHeight),
      targetAspectRatio: 2,
      crop,
      croppedFraction: 1 - (crop.width * crop.height) / Math.max(1, sourceWidth * sourceHeight),
    }
    if (crop.x === 0 && crop.y === 0 && crop.width === sourceWidth && crop.height === sourceHeight) {
      return withProcessedOutput(result, result.id, sourceImageUrl(result), undefined, {
        width: sourceWidth,
        height: sourceHeight,
      }, { panoramaNormalization })
    }
    const dataUrl = await renderCrop(image, crop)
    const url = await persistProcessedImage(dataUrl, ownerNodeId, `recipe-panorama-${ownerNodeId}-${result.id}.png`)
    return withProcessedOutput(result, `${result.id}:2to1`, url, undefined, {
      width: crop.width,
      height: crop.height,
    }, { panoramaNormalization })
  },

  async normalizeStyleAspect(result, ownerNodeId, aspectRatio) {
    const image = await loadImage(sourceImageUrl(result))
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    const crop = centeredCropForAspectRatio(sourceWidth, sourceHeight, aspectRatio)
    if (crop.x === 0 && crop.y === 0 && crop.width === sourceWidth && crop.height === sourceHeight) {
      return result
    }

    const dataUrl = await renderCrop(image, crop)
    const url = await persistProcessedImage(dataUrl, ownerNodeId, `recipe-style-${ownerNodeId}-${result.id}.png`)
    const normalized = withProcessedOutput(result, `${result.id}:source-aspect`, url, undefined, {
      width: crop.width,
      height: crop.height,
    }, {
      styleAspectNormalization: {
        sourceWidth,
        sourceHeight,
        sourceAspectRatio: sourceWidth / Math.max(1, sourceHeight),
        targetAspectRatio: aspectRatio,
        crop,
        croppedFraction: 1 - (crop.width * crop.height) / Math.max(1, sourceWidth * sourceHeight),
      },
    })
    const { alternatives = [], ...providerRaw } = result
    return {
      ...normalized,
      alternatives: [providerRaw, ...alternatives],
    }
  },

  async normalizeImageDimensions(result, ownerNodeId, width, height) {
    const image = await loadImage(sourceImageUrl(result))
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    const targetWidth = Math.max(1, Math.floor(width))
    const targetHeight = Math.max(1, Math.floor(height))
    if (sourceWidth === targetWidth && sourceHeight === targetHeight) return result
    if (sourceWidth < targetWidth || sourceHeight < targetHeight) return result

    const crop = {
      x: Math.floor((sourceWidth - targetWidth) / 2),
      y: Math.floor((sourceHeight - targetHeight) / 2),
      width: targetWidth,
      height: targetHeight,
    }
    const dataUrl = await renderCrop(image, crop)
    const url = await persistProcessedImage(dataUrl, ownerNodeId, `recipe-multiview-${ownerNodeId}-${result.id}.png`)
    const normalized = withProcessedOutput(result, `${result.id}:batch-size`, url, undefined, {
      width: targetWidth,
      height: targetHeight,
    }, {
      multiviewDimensionNormalization: {
        sourceWidth,
        sourceHeight,
        targetWidth,
        targetHeight,
        crop,
      },
    })
    const { alternatives = [], ...providerRaw } = result
    return {
      ...normalized,
      alternatives: [providerRaw, ...alternatives],
    }
  },

  async inspectImage(result) {
    const image = await loadImage(sourceImageUrl(result))
    const sample = renderImageSample(image)
    return analyzeCapabilityImagePixels(
      sample.data,
      sample.width,
      sample.height,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    )
  },
}
}

export const browserCapabilityRecipeMediaProcessor: CapabilityRecipeMediaProcessor = {
  splitGrid3x3: (...args) => createBrowserCapabilityRecipeMediaProcessor(withProjectAction(project => project, () => { throw new Error('project_identity_unavailable') })).splitGrid3x3(...args),
  normalizePanorama2to1: (...args) => createBrowserCapabilityRecipeMediaProcessor(withProjectAction(project => project, () => { throw new Error('project_identity_unavailable') })).normalizePanorama2to1(...args),
  normalizeStyleAspect: (...args) => createBrowserCapabilityRecipeMediaProcessor(withProjectAction(project => project, () => { throw new Error('project_identity_unavailable') })).normalizeStyleAspect!(...args),
  normalizeImageDimensions: (...args) => createBrowserCapabilityRecipeMediaProcessor(withProjectAction(project => project, () => { throw new Error('project_identity_unavailable') })).normalizeImageDimensions!(...args),
  inspectImage: (...args) => createBrowserCapabilityRecipeMediaProcessor(withProjectAction(project => project, () => { throw new Error('project_identity_unavailable') })).inspectImage!(...args),
}

const MAX_MULTIVIEW_DIMENSION_DRIFT = 0.02
const MAX_MULTIVIEW_ASPECT_DRIFT = 0.01

export async function normalizeMultiviewCollectionDimensions(
  plan: RecipeRunPlan,
  collection: GenerationResultCollection,
  ownerNodeId: string,
  processor: CapabilityRecipeMediaProcessor = browserCapabilityRecipeMediaProcessor,
): Promise<GenerationResultCollection> {
  if (
    !['image.multiview.grid9', 'image.multiview.custom'].includes(plan.recipeId)
    || !processor.inspectImage
    || !processor.normalizeImageDimensions
  ) return collection

  const successful = collection.items.filter((item) => item.status === 'success' && item.result)
  if (successful.length < 2) return collection
  let inspected: Array<{
    item: (typeof successful)[number]
    inspection: CapabilityRecipeImageInspection
  }>
  try {
    inspected = await Promise.all(successful.map(async (item) => ({
      item,
      inspection: await processor.inspectImage!(item.result!),
    })))
  } catch {
    return collection
  }
  const widths = inspected.map((entry) => Math.max(1, Math.floor(entry.inspection.width)))
  const heights = inspected.map((entry) => Math.max(1, Math.floor(entry.inspection.height)))
  const targetWidth = Math.min(...widths)
  const targetHeight = Math.min(...heights)
  if (widths.every((width) => width === targetWidth) && heights.every((height) => height === targetHeight)) {
    return collection
  }

  const widthDrift = (Math.max(...widths) - targetWidth) / targetWidth
  const heightDrift = (Math.max(...heights) - targetHeight) / targetHeight
  const aspects = inspected.map((entry) => entry.inspection.width / Math.max(1, entry.inspection.height))
  const aspectDrift = (Math.max(...aspects) - Math.min(...aspects)) / Math.min(...aspects)
  if (
    widthDrift > MAX_MULTIVIEW_DIMENSION_DRIFT
    || heightDrift > MAX_MULTIVIEW_DIMENSION_DRIFT
    || aspectDrift > MAX_MULTIVIEW_ASPECT_DRIFT
  ) return collection

  const normalizedById = new Map<string, GenerationNodeResult>()
  await Promise.all(inspected.map(async ({ item }) => {
    const normalized = await processor.normalizeImageDimensions!(
      item.result!,
      ownerNodeId,
      targetWidth,
      targetHeight,
    )
    normalizedById.set(item.id, normalized)
  }))
  return {
    ...collection,
    items: collection.items.map((item) => {
      const normalized = normalizedById.get(item.id)
      if (!normalized || !item.result) return item
      return {
        ...item,
        result: normalized,
        selectedResultId: normalized.id,
        candidates: (item.candidates ?? [item.result]).map((candidate) => (
          candidate.id === item.result!.id ? normalized : candidate
        )),
      }
    }),
  }
}

export async function postprocessCapabilityRecipeResults(
  plan: RecipeRunPlan,
  task: CapabilityRecipeTask,
  results: GenerationNodeResult[],
  ownerNodeId: string,
  processor: CapabilityRecipeMediaProcessor = browserCapabilityRecipeMediaProcessor,
): Promise<GenerationNodeResult[]> {
  if (plan.recipeId === 'image.multiview.grid9') {
    const expected = task.outputs.length
    if (expected === 1) return results
    if (results.length >= expected) return results.slice(0, expected)
    if (results.length === 0) {
      throw new Error(`九宫格结果数量异常：预期至少 1 张合成图，实际得到 0 张`)
    }
    const candidateGrids = await Promise.all(results.map(async (result) => {
      const split = await processor.splitGrid3x3(result, task.outputs, ownerNodeId)
      if (split.length !== expected) {
        throw new Error(`九宫格拆分失败：预期 ${expected} 张，实际得到 ${split.length} 张`)
      }
      return split
    }))
    return task.outputs.flatMap((_output, outputIndex) => (
      candidateGrids.map((candidateGrid) => candidateGrid[outputIndex]!)
    ))
  }

  if (plan.recipeId === 'scene.panorama.2to1') {
    return Promise.all(results.map((result) => processor.normalizePanorama2to1(result, ownerNodeId)))
  }

  if (plan.recipeId === 'image.style.transfer' && processor.normalizeStyleAspect) {
    const sourceAspectRatio = Number(plan.params.sourceAspectRatio)
    if (Number.isFinite(sourceAspectRatio) && sourceAspectRatio > 0) {
      return Promise.all(results.map((result) => (
        processor.normalizeStyleAspect!(result, ownerNodeId, sourceAspectRatio)
      )))
    }
  }

  return results
}
