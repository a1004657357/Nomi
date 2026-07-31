import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ projectDirById: vi.fn(), resolveAssetUrl: vi.fn() }))

vi.mock('../projects/repository', () => ({ projectDirById: mocks.projectDirById }))
vi.mock('../assets/localAssetFile', () => ({ absolutePathFromLocalAssetUrlAnyProject: mocks.resolveAssetUrl }))

import { importVibingDirectorAsset, importVibingDirectorAssetFromUrl } from './vibingDirectorAssets'

const tempDirs: string[] = []

function minimalGlb(): Buffer {
  const binary = Buffer.alloc(36)
  ;[
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ].flat().forEach((value, index) => binary.writeFloatLE(value, index * 4))
  const jsonSource = Buffer.from(JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.length }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [1, 1, 0],
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }), 'utf8')
  const jsonPadding = (4 - (jsonSource.length % 4)) % 4
  const json = Buffer.concat([jsonSource, Buffer.alloc(jsonPadding, 0x20)])
  const body = Buffer.alloc(8 + json.length + 8 + binary.length)
  body.writeUInt32LE(json.length, 0)
  body.writeUInt32LE(0x4e4f534a, 4)
  json.copy(body, 8)
  const binaryHeader = 8 + json.length
  body.writeUInt32LE(binary.length, binaryHeader)
  body.writeUInt32LE(0x004e4942, binaryHeader + 4)
  binary.copy(body, binaryHeader + 8)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(header.length + body.length, 8)
  return Buffer.concat([header, body])
}

const validGlb = minimalGlb()

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

beforeEach(() => {
  mocks.projectDirById.mockReset()
  mocks.resolveAssetUrl.mockReset()
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('VIBING Director local asset library', () => {
  it('does not infer a license from an unverified external-source label', () => {
    const projectDir = tempDir('nomi-vibing-asset-project-')
    const sourceDir = tempDir('nomi-vibing-asset-source-')
    const sourcePath = path.join(sourceDir, 'coffee-cup.glb')
    fs.writeFileSync(sourcePath, validGlb)
    mocks.projectDirById.mockReturnValue(projectDir)

    const result = importVibingDirectorAsset({
      projectId: 'project-1',
      directorNodeId: 'director-1',
      sourcePath,
      source: 'polyhaven',
    })

    expect(result.asset).toMatchObject({
      name: 'coffee-cup',
      fileName: 'coffee-cup.glb',
      format: 'glb',
      source: 'polyhaven',
      license: '需确认',
      model3dValidation: {
        meshCount: expect.any(Number),
        primitiveCount: expect.any(Number),
      },
    })
    expect(result.relativePath).toMatch(/^\.nomi\/vibing-director\/director-1\/assets\//)
    expect(fs.readFileSync(path.join(projectDir, result.relativePath))).toEqual(validGlb)
  })

  it('rejects a forged Kenney source that did not pass through the controlled catalog', () => {
    const projectDir = tempDir('nomi-vibing-asset-project-')
    const sourcePath = path.join(tempDir('nomi-vibing-asset-source-'), 'coffee-cup.glb')
    fs.writeFileSync(sourcePath, validGlb)
    mocks.projectDirById.mockReturnValue(projectDir)

    expect(() => importVibingDirectorAsset({
      projectId: 'project-1',
      directorNodeId: 'director-1',
      sourcePath,
      source: 'kenney',
    })).toThrow(/受控目录/)
  })

  it('rejects unsupported files before they can reach Blender', () => {
    const projectDir = tempDir('nomi-vibing-asset-project-')
    const sourcePath = path.join(tempDir('nomi-vibing-asset-source-'), 'unknown.exe')
    fs.writeFileSync(sourcePath, 'binary')
    mocks.projectDirById.mockReturnValue(projectDir)

    expect(() => importVibingDirectorAsset({
      projectId: 'project-1', directorNodeId: 'director-1', sourcePath, source: 'local',
    })).toThrow(/不支持/)
  })

  it('copies an existing project-local generated GLB without opening a file picker', () => {
    const projectDir = tempDir('nomi-vibing-asset-project-')
    const sourcePath = path.join(tempDir('nomi-vibing-generated-source-'), 'generated-cup.glb')
    fs.writeFileSync(sourcePath, validGlb)
    mocks.projectDirById.mockReturnValue(projectDir)
    mocks.resolveAssetUrl.mockReturnValue(sourcePath)

    const result = importVibingDirectorAssetFromUrl({
      projectId: 'project-1',
      directorNodeId: 'director-1',
      sourceUrl: 'nomi-local://asset/project-1/assets/generated/generated-cup.glb',
      source: 'local',
      license: 'user-owned',
    })

    expect(mocks.resolveAssetUrl).toHaveBeenCalledWith('nomi-local://asset/project-1/assets/generated/generated-cup.glb')
    expect(result.asset).toMatchObject({
      name: 'generated-cup',
      format: 'glb',
      source: 'local',
      license: 'user-owned',
      model3dValidation: {
        meshCount: expect.any(Number),
        bounds: { diagonal: expect.any(Number) },
      },
    })
    expect(fs.readFileSync(path.join(projectDir, result.relativePath))).toEqual(validGlb)
  })

  it('rejects an invalid GLB before copying it into the Director asset library', () => {
    const projectDir = tempDir('nomi-vibing-asset-project-')
    const sourcePath = path.join(tempDir('nomi-vibing-asset-source-'), 'broken.glb')
    fs.writeFileSync(sourcePath, Buffer.from('glTF'))
    mocks.projectDirById.mockReturnValue(projectDir)

    expect(() => importVibingDirectorAsset({
      projectId: 'project-1',
      directorNodeId: 'director-1',
      sourcePath,
      source: 'local',
    })).toThrow(/GLB.*过短/)

    expect(fs.existsSync(path.join(projectDir, '.nomi', 'vibing-director', 'director-1', 'assets'))).toBe(false)
  })
})
