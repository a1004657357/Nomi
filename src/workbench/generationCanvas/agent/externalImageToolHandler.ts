import { unwrapAssetImportResult } from '../../../../electron/shared/contracts/assetImportResult'
import type { ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { getDesktopBridge, type DesktopAssetDto } from '../../../desktop/bridge'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
import type { GenerationNodeResult } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { resolveCanvasToolNodeId } from './clientIdRegistry'
import { readGenerationCanvasSnapshot } from './generationCanvasTools'

type ExternalImageSourceType = 'local_path' | 'url' | 'data_url'

const SOURCE_TYPES: ReadonlySet<string> = new Set(['local_path', 'url', 'data_url'])

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function assetDataString(asset: DesktopAssetDto, key: string): string {
  const value = asset.data?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSourceType(value: unknown): ExternalImageSourceType {
  const sourceType = trimmed(value)
  if (!SOURCE_TYPES.has(sourceType)) throw new Error('sourceType 必须是 local_path / url / data_url')
  return sourceType as ExternalImageSourceType
}

function assertSource(sourceType: ExternalImageSourceType, source: string): void {
  if (!source) throw new Error('source is required')
  if (sourceType === 'url' && !/^https?:\/\//i.test(source)) {
    throw new Error('sourceType=url 时 source 必须是 http(s) URL')
  }
  if (sourceType === 'data_url' && !source.startsWith('data:image/')) {
    throw new Error('sourceType=data_url 时 source 必须是 data:image/... URL')
  }
}

async function importAsset(input: {
  project: ProjectExecutionContext
  nodeId: string
  sourceType: ExternalImageSourceType
  source: string
  fileName?: string
}): Promise<DesktopAssetDto> {
  const desktop = getDesktopBridge()
  if (!desktop?.assets) throw new Error('外部图片导入需要 Electron 桌面运行时')
  const base = {
    projectId: input.project.binding.projectId,
    projectBinding: input.project.binding,
    kind: 'generated',
    fileName: input.fileName,
    ownerNodeId: input.nodeId,
  }
  input.project.assertCurrent()
  if (input.sourceType === 'local_path') {
    if (!desktop.assets.importLocalPath) throw new Error('当前桌面桥不支持从本地路径导入图片，请重启 Nomi 后再试')
    return desktop.assets.importLocalPath({ ...base, path: input.source })
  }
  return unwrapAssetImportResult(await desktop.assets.importRemoteUrl({ ...base, url: input.source, expectedKind: 'image' }))
}

function importedUrl(asset: DesktopAssetDto): string {
  const url = assetDataString(asset, 'url')
  if (!url) throw new Error('外部图片已导入但没有返回可用 URL')
  const contentType = assetDataString(asset, 'contentType')
  if (contentType && contentType !== 'application/octet-stream' && !contentType.startsWith('image/')) {
    throw new Error(`导入结果不是图片资源：${contentType}`)
  }
  return url
}

export async function tryAttachExternalImage(input: {
  project: ProjectExecutionContext
  toolName: string
  record: Record<string, unknown>
  mutate: <T>(fn: () => T) => T
}): Promise<{ handled: false } | { handled: true; value: unknown }> {
  if (input.toolName !== 'attach_external_image_to_node') return { handled: false }

  const { record, mutate, project } = input
  project.assertCurrent()
  const nodeId = resolveCanvasToolNodeId(trimmed(record.nodeId))
  if (!nodeId) throw new Error('nodeId is required')
  const node = readGenerationCanvasSnapshot().nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error('node_not_found')
  if (!isImageLikeGenerationNodeKind(node.kind)) {
    throw new Error('target_node_not_image_like:只能把外部图片绑定到图片类节点')
  }
  const sourceType = normalizeSourceType(record.sourceType)
  const source = trimmed(record.source)
  assertSource(sourceType, source)
  const fileName = trimmed(record.fileName) || undefined
  const imported = await importAsset({ project, nodeId, sourceType, source, fileName })
  project.assertCurrent()
  const url = importedUrl(imported)
  const now = Date.now()
  const prompt = trimmed(record.prompt)
  const provider = trimmed(record.provider) || 'codex-imagegen'
  const modelKey = trimmed(record.modelKey)
  const result: GenerationNodeResult = {
    id: `external-image-${imported.id || now}`,
    type: 'image',
    url,
    thumbnailUrl: url,
    ...(sourceType === 'url' ? { providerUrl: source } : {}),
    assetId: imported.id,
    raw: { asset: imported, sourceType },
    createdAt: now,
    provenance: {
      provider,
      ...(modelKey ? { modelKey } : {}),
      ...(prompt ? { prompt } : {}),
      timestamp: now,
      params: { sourceType, ...(fileName ? { fileName } : {}) },
    },
  }
  mutate(() => useGenerationCanvasStore.getState().addNodeResult(nodeId, result))
  return {
    handled: true,
    value: {
      nodeId,
      resultId: result.id,
      assetId: imported.id,
      url,
      relativePath: assetDataString(imported, 'relativePath') || undefined,
    },
  }
}
