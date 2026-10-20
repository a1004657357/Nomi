import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  projectDirById: vi.fn(),
  writeAsset: vi.fn(),
  captureAssetWriteContext: vi.fn(),
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../projects/repository', () => ({ projectDirById: mocks.projectDirById }))
vi.mock('../runtime', () => ({ writeAsset: mocks.writeAsset }))
vi.mock('../assets/assetWriteContext', () => ({ captureAssetWriteContext: mocks.captureAssetWriteContext }))

import {
  activeVibingDirectorBlenderPlanCount,
  cancelVibingDirectorBlenderPlan,
  runVibingDirectorBlenderPlan,
} from './vibingDirectorRunner'

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

const tempDirs: string[] = []

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function fakeBlenderBinary(): string {
  const binary = path.join(tempDir('nomi-vibing-runner-bin-'), 'blender')
  fs.writeFileSync(binary, '#!/bin/sh\n', { mode: 0o755 })
  return binary
}

function minimalGlb(): Buffer {
  const binary = Buffer.alloc(36)
  ;[
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ].flat().forEach((value, index) => binary.writeFloatLE(value, index * 4))
  const source = Buffer.from(JSON.stringify({
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
  const json = Buffer.concat([source, Buffer.alloc((4 - (source.length % 4)) % 4, 0x20)])
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

function childProcess(onKill?: (child: FakeChild, signal: NodeJS.Signals) => void): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn((signal: NodeJS.Signals) => {
    onKill?.(child, signal)
    return true
  })
  return child
}

function request(jobId: string, projectId: string, blenderPath: string, timeoutMs = 30_000) {
  return {
    jobId,
    projectId,
    directorNodeId: 'director-1',
    blenderPath,
    timeoutMs,
    assets: [],
    plan: { mode: 'replace', actions: [{ op: 'set_stage', preset: 'studio' }] },
  }
}

beforeEach(() => {
  mocks.spawn.mockReset()
  mocks.projectDirById.mockReset()
  mocks.writeAsset.mockReset()
  mocks.captureAssetWriteContext.mockReset()
  mocks.captureAssetWriteContext.mockImplementation(async () => ({ root: mocks.projectDirById(), assertCurrent: vi.fn() }))
  mocks.writeAsset.mockImplementation(async (_projectId: string, _bytes: Buffer, fileName: string, _type: string, meta: unknown) => ({
    id: `asset-${fileName}`,
    data: { url: `nomi-local://asset/project/${fileName}`, meta },
  }))
})

afterEach(() => {
  expect(activeVibingDirectorBlenderPlanCount()).toBe(0)
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('VIBING Director Blender lifecycle', () => {
  it('validates the returned GLB and persists its inspection evidence', async () => {
    const projectDir = tempDir('nomi-vibing-runner-project-')
    const blenderPath = fakeBlenderBinary()
    mocks.projectDirById.mockReturnValue(projectDir)
    mocks.spawn.mockImplementation((_binary: string, args: string[]) => {
      const child = childProcess()
      setTimeout(() => {
        const outputDir = args.at(-1)!
        fs.mkdirSync(outputDir, { recursive: true })
        const preview = path.join(outputDir, 'preview.png')
        const blend = path.join(outputDir, 'scene.blend')
        const model = path.join(outputDir, 'scene.glb')
        fs.writeFileSync(preview, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
        fs.writeFileSync(blend, 'BLENDER')
        fs.writeFileSync(model, minimalGlb())
        child.stdout.emit('data', `${JSON.stringify({
          ok: true,
          jobId: 'job-success',
          blenderVersion: '4.0.1',
          artifacts: { preview, blend, model },
        })}\n`)
        child.emit('close', 0, null)
      }, 0)
      return child
    })

    const result = await runVibingDirectorBlenderPlan(request('job-success', 'project', blenderPath))

    expect(result).toMatchObject({
      jobId: 'job-success',
      blenderVersion: '4.0.1',
      blendRelativePath: expect.stringMatching(/scene\.blend$/),
    })
    const modelWrite = mocks.writeAsset.mock.calls.find((call) => call[2] === 'vibing-director-scene.glb')
    expect(modelWrite?.[4]).toMatchObject({
      model3dValidation: {
        meshCount: 1,
        primitiveCount: 1,
      },
    })
  })

  it('waits for the Blender process to close and reports timeout distinctly', async () => {
    const projectDir = tempDir('nomi-vibing-runner-project-')
    const blenderPath = fakeBlenderBinary()
    mocks.projectDirById.mockReturnValue(projectDir)
    const child = childProcess((process, signal) => {
      setTimeout(() => process.emit('close', null, signal), 0)
    })
    mocks.spawn.mockReturnValue(child)

    await expect(runVibingDirectorBlenderPlan(
      request('job-timeout', 'project', blenderPath, 10),
    )).rejects.toThrow(/超时/)

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('cancels an active plan and waits for process cleanup', async () => {
    const projectDir = tempDir('nomi-vibing-runner-project-')
    const blenderPath = fakeBlenderBinary()
    mocks.projectDirById.mockReturnValue(projectDir)
    const child = childProcess((process, signal) => {
      setTimeout(() => process.emit('close', null, signal), 0)
    })
    mocks.spawn.mockReturnValue(child)

    const running = runVibingDirectorBlenderPlan(request('job-cancel', 'project', blenderPath))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cancelVibingDirectorBlenderPlan('job-cancel')).toBe(true)
    await expect(running).rejects.toThrow(/已取消/)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
