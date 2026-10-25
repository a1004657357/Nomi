import type { BlenderSpatialCheckStatus } from '../../electron/shared/blenderDirectorContract'

export type VibingDirectorAsset = {
  id: string
  name: string
  fileName: string
  format: 'blend' | 'glb' | 'gltf' | 'fbx' | 'obj'
  source: 'local' | 'kenney' | 'polyhaven' | 'quaternius' | 'blenderkit'
  license: string
  importedAt: number
  provenance?: {
    provider: 'kenney'
    catalogAssetId: string
    packId: string
    sourcePageUrl: string
    downloadUrl: string
    licenseUrl: string
    archiveSha256: string
    fileSha256: string
  }
}

export type VibingDirectorCatalogAsset = {
  id: string
  name: string
  fileName: string
  format: 'glb'
  source: 'kenney'
  license: 'CC0 1.0'
  packId: string
  sourcePageUrl: string
  licenseUrl: string
}

export type VibingDirectorPreviewCamera = {
  id: 'director-camera'
  name: string
  position: [number, number, number]
  lookAt: [number, number, number]
  fov: number
  aspectRatio: '16:9' | '9:16' | '4:3' | '3:4' | '1:1' | '2.39:1'
  framing: 'all' | 'target' | 'fixed'
  targetRef?: string
}

export type VibingDirectorSpatialReport = {
  version: 1
  passed: boolean
  checks: Array<{
    relationId: string
    kind: 'facing' | 'distance' | 'support' | 'offset' | 'line_of_sight'
    status: BlenderSpatialCheckStatus
    message: string
    measured?: number
    expected?: number
    rotationMeasured?: number
    rotationExpected?: number
  }>
}

export type VibingDirectorObjectTransform = {
  id: string
  name: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

export type DesktopVibingDirectorBridge = {
  applyBlenderPlan: (payload: {
    jobId: string
    projectId: string
    directorNodeId: string
    plan: unknown
    assets: Array<{ id: string; fileName: string }>
    existingBlendRelativePath?: string
    timeoutMs?: number
  }) => Promise<{
    jobId: string
    blenderVersion?: string
    preview: { url: string; assetId?: string }
    blend: { url: string; assetId?: string }
    model: { url: string; assetId?: string }
    blendRelativePath: string
    previewCamera?: VibingDirectorPreviewCamera
    spatialReport?: VibingDirectorSpatialReport
    objectTransforms?: VibingDirectorObjectTransform[]
  }>
  importAsset: (payload: {
    projectId: string
    directorNodeId: string
    source: VibingDirectorAsset['source']
    license?: string
  }) => Promise<{ canceled?: boolean; asset?: VibingDirectorAsset; relativePath?: string }>
  importExistingAsset: (payload: {
    projectId: string
    directorNodeId: string
    sourceUrl: string
    source: 'local'
    license?: string
  }) => Promise<{ asset: VibingDirectorAsset; relativePath: string }>
  listCatalogAssets: (payload?: {
    query?: string
    limit?: number
  }) => Promise<VibingDirectorCatalogAsset[]>
  importCatalogAsset: (payload: {
    projectId: string
    directorNodeId: string
    catalogAssetId: string
  }) => Promise<{ asset: VibingDirectorAsset; relativePath: string }>
  openBlender: (payload: {
    projectId: string
    directorNodeId: string
    blendRelativePath: string
  }) => Promise<{ opened: boolean }>
  cancelBlenderPlan: (jobId: string) => Promise<{ cancelled: boolean }>
  openAssetSource: (source: 'kenney' | 'polyhaven' | 'quaternius' | 'blenderkit') => Promise<{ opened: boolean }>
}
