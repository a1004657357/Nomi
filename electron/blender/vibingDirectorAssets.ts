import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { projectDirById } from '../projects/repository'
import { vibingDirectorAssetPath } from './vibingDirectorRunner'

export type VibingDirectorAssetSource = 'local' | 'polyhaven' | 'quaternius' | 'blenderkit'
export type VibingDirectorAssetFormat = 'blend' | 'glb' | 'gltf' | 'fbx' | 'obj'

export type ImportedVibingDirectorAsset = {
  id: string
  name: string
  fileName: string
  format: VibingDirectorAssetFormat
  source: VibingDirectorAssetSource
  license: string
  importedAt: number
}

export type ImportVibingDirectorAssetInput = {
  projectId: string
  directorNodeId: string
  sourcePath: string
  source: VibingDirectorAssetSource
  license?: string
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
  polyhaven: 'CC0',
  quaternius: 'CC0',
  blenderkit: 'Royalty Free',
}

function sourceType(value: unknown): VibingDirectorAssetSource {
  if (value === 'polyhaven' || value === 'quaternius' || value === 'blenderkit' || value === 'local') return value
  throw new Error('资产来源不受支持')
}

function fileFormat(fileName: string): VibingDirectorAssetFormat {
  const format = FORMAT_BY_EXTENSION[path.extname(fileName).toLowerCase()]
  if (!format) throw new Error('不支持的 Blender 资产格式')
  return format
}

export function importVibingDirectorAsset(input: ImportVibingDirectorAssetInput): {
  asset: ImportedVibingDirectorAsset
  relativePath: string
} {
  const projectId = String(input.projectId || '').trim()
  if (!projectId) throw new Error('projectId 不能为空')
  const projectDir = projectDirById(projectId)
  if (!projectDir) throw new Error('无法找到当前项目目录')
  const sourcePath = path.resolve(String(input.sourcePath || '').trim())
  const stat = fs.statSync(sourcePath)
  if (!stat.isFile()) throw new Error('请选择一个模型文件')
  const fileName = path.basename(sourcePath)
  const format = fileFormat(fileName)
  const source = sourceType(input.source)
  const asset: ImportedVibingDirectorAsset = {
    id: `asset-${crypto.randomUUID().slice(0, 12)}`,
    name: path.basename(fileName, path.extname(fileName)) || '未命名资产',
    fileName,
    format,
    source,
    license: String(input.license || '').trim() || DEFAULT_LICENSE[source],
    importedAt: Date.now(),
  }
  const targetPath = vibingDirectorAssetPath(projectDir, input.directorNodeId, asset)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(sourcePath, targetPath)
  return { asset, relativePath: path.relative(projectDir, targetPath) }
}
