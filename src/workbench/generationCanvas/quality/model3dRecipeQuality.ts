import i18n from '../../../i18n/index'
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
      ? i18n.t('capabilityWorkflow.theModelResultIsRetainedButThisHistoricalResult')
      : i18n.t('capabilityWorkflow.noGLBCouldBeLocatedForStructuralValidation'),
    ...(item ? { itemIds: [item.id] } : {}),
  })
  const outputCheck: GenerationQualityCheck = result
    ? {
        id: 'model3d-output',
        label: i18n.t('capabilityWorkflow.label3DModelResult'),
        status: 'pass',
        summary: i18n.t('capabilityWorkflow.aReadableGLBModelResultIsRetained'),
      }
    : {
        id: 'model3d-output',
        label: i18n.t('capabilityWorkflow.label3DModelResult'),
        status: 'fail',
        summary: item?.error || i18n.t('capabilityWorkflow.noReadable3DModelResult'),
        ...(item ? { itemIds: [item.id] } : {}),
      }
  const structuralChecks: GenerationQualityCheck[] = validation
    ? [
        {
          id: 'glb-container',
          label: i18n.t('capabilityWorkflow.gLBContainer'),
          status: 'pass',
          summary: i18n.t('capabilityWorkflow.gLBIsParseableFileSizeMB', { v0: validation.glbVersion, v1: (validation.byteLength / 1024 / 1024).toFixed(2) }),
          metrics: {
            glbVersion: validation.glbVersion,
            byteLength: validation.byteLength,
            nodeCount: validation.nodeCount,
          },
        },
        validation.meshCount > 0 && validation.primitiveCount > 0 && validation.bounds.diagonal > 0
          ? {
              id: 'glb-geometry',
              label: i18n.t('capabilityWorkflow.meshesAndBounds'),
              status: 'pass',
              summary: i18n.t('capabilityWorkflow.meshesAndPrimitivesWithUsableBounds', { v0: validation.meshCount, v1: validation.primitiveCount }),
              metrics: {
                meshCount: validation.meshCount,
                primitiveCount: validation.primitiveCount,
                boundsDiagonal: roundQualityMetric(validation.bounds.diagonal),
              },
            }
          : {
              id: 'glb-geometry',
              label: i18n.t('capabilityWorkflow.meshesAndBounds'),
              status: 'fail',
              summary: i18n.t('capabilityWorkflow.theModelHasNoUsableMeshesPrimitivesOrGeometry'),
              itemIds: item ? [item.id] : undefined,
            },
        validation.materialCount > 0
          ? {
              id: 'glb-materials',
              label: i18n.t('capabilityWorkflow.materials'),
              status: 'pass',
              summary: i18n.t('capabilityWorkflow.detectedMaterials', { v0: validation.materialCount }),
              metrics: { materialCount: validation.materialCount },
            }
          : {
              id: 'glb-materials',
              label: i18n.t('capabilityWorkflow.materials'),
              status: 'warning',
              summary: i18n.t('capabilityWorkflow.theModelHasNoMaterialsAndMayDisplayOnly'),
              metrics: { materialCount: 0 },
            },
        validation.externalImageCount === 0 && validation.externalBufferCount === 0
          ? {
              id: 'glb-textures',
              label: i18n.t('capabilityWorkflow.selfContainedTextures'),
              status: 'pass',
              summary: validation.textureCount > 0
                ? i18n.t('capabilityWorkflow.allTexturesAreEmbedded', { v0: validation.textureCount })
                : i18n.t('capabilityWorkflow.noExternalTextureOrBinaryDependencies'),
              metrics: {
                textureCount: validation.textureCount,
                embeddedImageCount: validation.embeddedImageCount,
                externalImageCount: 0,
                externalBufferCount: 0,
              },
            }
          : {
              id: 'glb-textures',
              label: i18n.t('capabilityWorkflow.selfContainedTextures'),
              status: 'warning',
              summary: i18n.t('capabilityWorkflow.theModelStillReferencesExternalTexturesOrBinaryFiles'),
              details: [
                ...validation.externalImageUris.map((uri) => i18n.t('capabilityWorkflow.texture', { v0: uri })),
                ...validation.externalBufferUris.map((uri) => i18n.t('capabilityWorkflow.binary', { v0: uri })),
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
        unavailable('glb-container', i18n.t('capabilityWorkflow.gLBContainer')),
        unavailable('glb-geometry', i18n.t('capabilityWorkflow.meshesAndBounds')),
        unavailable('glb-materials', i18n.t('capabilityWorkflow.materials')),
        unavailable('glb-textures', i18n.t('capabilityWorkflow.selfContainedTextures')),
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
