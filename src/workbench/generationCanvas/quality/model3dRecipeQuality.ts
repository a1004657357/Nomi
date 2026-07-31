import type {
  GenerationQualityCheck,
  GenerationQualityReport,
  GenerationResultCollection,
} from '../model/generationCanvasTypes'
import {
  hasMediaLocator,
  qualityStatusFromChecks,
  roundQualityMetric,
} from './capabilityQualityUtils'

export function evaluateModel3dCollection(
  collection: GenerationResultCollection,
  evaluatedAt = Date.now(),
): GenerationResultCollection {
  const item = collection.items[0]
  const result = item?.status === 'success'
    && item.result?.type === 'model3d'
    && hasMediaLocator(item.result)
    ? item.result
    : undefined
  const validation = result?.model3dValidation
  const unavailable = (id: string, label: string): GenerationQualityCheck => ({
    id,
    label,
    status: 'unavailable',
    summary: result
      ? '模型结果已保留，但这个历史结果没有 GLB 结构校验摘要'
      : '缺少可定位的 GLB，无法执行结构校验',
    ...(item ? { itemIds: [item.id] } : {}),
  })
  const outputCheck: GenerationQualityCheck = result
    ? {
        id: 'model3d-output',
        label: '3D 模型结果',
        status: 'pass',
        summary: '已保留可读取的 GLB 模型结果',
      }
    : {
        id: 'model3d-output',
        label: '3D 模型结果',
        status: 'fail',
        summary: item?.error || '没有可读取的 3D 模型结果',
        ...(item ? { itemIds: [item.id] } : {}),
      }
  const structuralChecks: GenerationQualityCheck[] = validation
    ? [
        {
          id: 'glb-container',
          label: 'GLB 容器',
          status: 'pass',
          summary: `GLB ${validation.glbVersion} 可解析，文件 ${(validation.byteLength / 1024 / 1024).toFixed(2)} MB`,
          metrics: {
            glbVersion: validation.glbVersion,
            byteLength: validation.byteLength,
            nodeCount: validation.nodeCount,
          },
        },
        validation.meshCount > 0 && validation.primitiveCount > 0 && validation.bounds.diagonal > 0
          ? {
              id: 'glb-geometry',
              label: '网格与边界',
              status: 'pass',
              summary: `${validation.meshCount} 个网格、${validation.primitiveCount} 个 primitive，边界可用`,
              metrics: {
                meshCount: validation.meshCount,
                primitiveCount: validation.primitiveCount,
                boundsDiagonal: roundQualityMetric(validation.bounds.diagonal),
              },
            }
          : {
              id: 'glb-geometry',
              label: '网格与边界',
              status: 'fail',
              summary: '模型没有可用网格、primitive 或几何边界',
              itemIds: item ? [item.id] : undefined,
            },
        validation.materialCount > 0
          ? {
              id: 'glb-materials',
              label: '材质',
              status: 'pass',
              summary: `检测到 ${validation.materialCount} 个材质`,
              metrics: { materialCount: validation.materialCount },
            }
          : {
              id: 'glb-materials',
              label: '材质',
              status: 'warning',
              summary: '模型没有材质，进入 Blender 后可能只显示默认表面',
              metrics: { materialCount: 0 },
            },
        validation.externalImageCount === 0 && validation.externalBufferCount === 0
          ? {
              id: 'glb-textures',
              label: '纹理自包含',
              status: 'pass',
              summary: validation.textureCount > 0
                ? `${validation.textureCount} 个纹理均已内嵌`
                : '没有外部纹理或二进制依赖',
              metrics: {
                textureCount: validation.textureCount,
                embeddedImageCount: validation.embeddedImageCount,
                externalImageCount: 0,
                externalBufferCount: 0,
              },
            }
          : {
              id: 'glb-textures',
              label: '纹理自包含',
              status: 'warning',
              summary: '模型仍引用外部纹理或二进制文件，移动项目后可能丢失',
              details: [
                ...validation.externalImageUris.map((uri) => `纹理：${uri}`),
                ...validation.externalBufferUris.map((uri) => `二进制：${uri}`),
              ],
              metrics: {
                textureCount: validation.textureCount,
                embeddedImageCount: validation.embeddedImageCount,
                externalImageCount: validation.externalImageCount,
                externalBufferCount: validation.externalBufferCount,
              },
            },
      ]
    : [
        unavailable('glb-container', 'GLB 容器'),
        unavailable('glb-geometry', '网格与边界'),
        unavailable('glb-materials', '材质'),
        unavailable('glb-textures', '纹理自包含'),
      ]
  const checks = [outputCheck, ...structuralChecks]

  const quality: GenerationQualityReport = {
    version: 1,
    kind: 'model3d',
    evaluator: 'model3d-local-v1',
    status: qualityStatusFromChecks(checks),
    evaluatedAt,
    checks,
    metrics: validation
      ? {
          meshCount: validation.meshCount,
          primitiveCount: validation.primitiveCount,
          materialCount: validation.materialCount,
          textureCount: validation.textureCount,
          externalImageCount: validation.externalImageCount,
          externalBufferCount: validation.externalBufferCount,
          boundsDiagonal: roundQualityMetric(validation.bounds.diagonal),
        }
      : { validated: false },
  }
  return { ...collection, quality }
}
