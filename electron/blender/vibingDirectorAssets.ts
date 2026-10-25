import { desktopT } from "../desktopStrings";
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { projectDirById } from '../projects/repository'
import { absolutePathFromLocalAssetUrlAnyProject } from '../assets/localAssetFile'
import { inspectGlb, type GlbValidationReport } from '../assets/glbValidation'
import { vibingDirectorAssetPath } from './vibingDirectorRunner'

export type VibingDirectorAssetSource = 'local' | 'kenney' | 'polyhaven' | 'quaternius' | 'blenderkit'
export type VibingDirectorAssetFormat = 'blend' | 'glb' | 'gltf' | 'fbx' | 'obj'

export type VibingDirectorAssetProvenance = {
  provider: 'kenney'
  catalogAssetId: string
  packId: string
  sourcePageUrl: string
  downloadUrl: string
  licenseUrl: string
  archiveSha256: string
  fileSha256: string
}

export type ImportedVibingDirectorAsset = {
  id: string
  name: string
  fileName: string
  format: VibingDirectorAssetFormat
  source: VibingDirectorAssetSource
  license: string
  importedAt: number
  model3dValidation?: GlbValidationReport
  provenance?: VibingDirectorAssetProvenance
}

export type ImportVibingDirectorAssetInput = {
  projectId: string
  directorNodeId: string
  sourcePath: string
  source: VibingDirectorAssetSource
  license?: string
  provenance?: VibingDirectorAssetProvenance
}

export type ImportVibingDirectorAssetFromUrlInput = Omit<ImportVibingDirectorAssetInput, 'sourcePath'> & {
  sourceUrl: string
}

const FORMAT_BY_EXTENSION: Record<string, VibingDirectorAssetFormat> = {
  '.blend': 'blend',
  '.glb': 'glb',
  '.gltf': 'gltf',
  '.fbx': 'fbx',
  '.obj': 'obj',
}

const DEFAULT_LICENSE: Record<VibingDirectorAssetSource, string> = {
  local: '需确认',
  kenney: 'CC0 1.0',
  polyhaven: '需确认',
  quaternius: '需确认',
  blenderkit: '需确认',
}

function sourceType(value: unknown): VibingDirectorAssetSource {
  if (value === 'kenney' || value === 'polyhaven' || value === 'quaternius' || value === 'blenderkit' || value === 'local') return value
  throw new Error(desktopT("custom.blender.vibingDirectorAssets.text1"))
}

function fileFormat(fileName: string): VibingDirectorAssetFormat {
  const format = FORMAT_BY_EXTENSION[path.extname(fileName).toLowerCase()]
  if (!format) throw new Error(desktopT("custom.blender.vibingDirectorAssets.text2"))
  return format
}

export function importVibingDirectorAsset(input: ImportVibingDirectorAssetInput): {
  asset: ImportedVibingDirectorAsset
  relativePath: string
} {
  const projectId = String(input.projectId || '').trim()
  if (!projectId) throw new Error(desktopT("custom.blender.vibingDirectorAssets.text3"))
  const projectDir = projectDirById(projectId)
  if (!projectDir) throw new Error(desktopT("custom.blender.vibingDirectorAssets.text4"))
  const sourcePath = path.resolve(String(input.sourcePath || '').trim())
  const stat = fs.statSync(sourcePath)
  if (!stat.isFile()) throw new Error(desktopT("custom.blender.vibingDirectorAssets.text5"))
  const fileName = path.basename(sourcePath)
  const format = fileFormat(fileName)
  const source = sourceType(input.source)
  if (source === 'kenney' && input.provenance?.provider !== 'kenney') {
    throw new Error(desktopT("custom.blender.vibingDirectorAssets.text6"))
  }
  const model3dValidation = format === 'glb' ? inspectGlb(fs.readFileSync(sourcePath)) : undefined
  const asset: ImportedVibingDirectorAsset = {
    id: `asset-${crypto.randomUUID().slice(0, 12)}`,
    name: path.basename(fileName, path.extname(fileName)) || '未命名资产',
    fileName,
    format,
    source,
    license: String(input.license || '').trim() || DEFAULT_LICENSE[source],
    importedAt: Date.now(),
    ...(model3dValidation ? { model3dValidation } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
  }
  const targetPath = vibingDirectorAssetPath(projectDir, input.directorNodeId, asset)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(sourcePath, targetPath)
  return { asset, relativePath: path.relative(projectDir, targetPath) }
}

export function importVibingDirectorAssetFromUrl(input: ImportVibingDirectorAssetFromUrlInput): {
  asset: ImportedVibingDirectorAsset
  relativePath: string
} {
  const sourcePath = absolutePathFromLocalAssetUrlAnyProject(input.sourceUrl)
  if (!sourcePath) throw new Error(desktopT("custom.blender.vibingDirectorAssets.text7"))
  return importVibingDirectorAsset({
    projectId: input.projectId,
    directorNodeId: input.directorNodeId,
    sourcePath,
    source: input.source,
    ...(input.license ? { license: input.license } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
  })
}
