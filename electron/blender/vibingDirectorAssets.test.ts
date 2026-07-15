import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ projectDirById: vi.fn() }))

vi.mock('../projects/repository', () => ({ projectDirById: mocks.projectDirById }))

import { importVibingDirectorAsset } from './vibingDirectorAssets'

const tempDirs: string[] = []

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

beforeEach(() => {
  mocks.projectDirById.mockReset()
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('VIBING Director local asset library', () => {
  it('copies a chosen CC0 model into the project-scoped Director asset library', () => {
    const projectDir = tempDir('nomi-vibing-asset-project-')
    const sourceDir = tempDir('nomi-vibing-asset-source-')
    const sourcePath = path.join(sourceDir, 'coffee-cup.glb')
    fs.writeFileSync(sourcePath, Buffer.from('glTF'))
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
      license: 'CC0',
    })
    expect(result.relativePath).toMatch(/^\.nomi\/vibing-director\/director-1\/assets\//)
    expect(fs.readFileSync(path.join(projectDir, result.relativePath))).toEqual(Buffer.from('glTF'))
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
})
