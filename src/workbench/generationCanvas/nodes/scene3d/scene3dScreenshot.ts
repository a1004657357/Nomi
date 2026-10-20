import { unwrapAssetImportResult } from '../../../../../electron/shared/contracts/assetImportResult'
import { getDesktopBridge } from '../../../../desktop/bridge'
import type { ProjectExecutionContext } from '../../../project/projectCanvasReadSurface'

export type PersistedScene3DScreenshot = {
  url: string
  assetId?: string
  raw?: unknown
  localOnly: boolean
}

function fileSafePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'scene3d'
}

export async function persistScene3DScreenshot(
  dataUrl: string,
  ownerNodeId: string,
  title: string,
  project: ProjectExecutionContext | null,
): Promise<PersistedScene3DScreenshot> {
  const desktop = getDesktopBridge()
  if (!desktop || !project) {
    return { url: dataUrl, localOnly: true }
  }
  project.assertCurrent()

  const createdAt = Date.now()
  const fileName = `${fileSafePart(title)}-${fileSafePart(ownerNodeId)}-${createdAt}.png`
  const asset = unwrapAssetImportResult(await desktop.assets.importRemoteUrl({
    projectId: project.binding.projectId,
    projectBinding: project.binding,
    url: dataUrl,
    kind: 'generated',
    expectedKind: 'image',
    fileName,
    ownerNodeId,
  }))
  project.assertCurrent()
  const url = typeof asset.data?.url === 'string' ? asset.data.url.trim() : ''
  if (!url || /^(?:data:|blob:)/i.test(url)) throw new Error('Scene capture did not return a persisted asset URL')
  return {
    url,
    assetId: asset.id,
    raw: { asset },
    localOnly: false,
  }
}
