import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetWriteContext } from '../assets/assetWriteContext'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  projectDirById: vi.fn(),
  capture: vi.fn(),
  writeAsset: vi.fn(),
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../projects/repository', () => ({ projectDirById: mocks.projectDirById }))
vi.mock('../assets/assetWriteContext', () => ({ captureAssetWriteContext: mocks.capture }))
vi.mock('../runtime', () => ({ writeAsset: mocks.writeAsset }))
vi.mock('../assets/glbValidation', () => ({ inspectGlb: () => ({ meshCount: 1 }) }))

import { activeBlenderSceneRenderCount, cancelAllBlenderSceneRenders, runBlenderSceneRender } from './blenderRunner'
import { activeDirectorBlenderRenderCount, cancelAllDirectorBlenderRenders, runDirectorBlenderRender } from './directorCli'
import { activeVibingDirectorBlenderPlanCount, cancelAllVibingDirectorBlenderPlans, runVibingDirectorBlenderPlan } from './vibingDirectorRunner'

const runners = [
  { name: 'scene', run: runBlenderSceneRender, count: activeBlenderSceneRenderCount, cancelAll: cancelAllBlenderSceneRenders },
  { name: 'director', run: runDirectorBlenderRender, count: activeDirectorBlenderRenderCount, cancelAll: cancelAllDirectorBlenderRenders },
  { name: 'vibing', run: runVibingDirectorBlenderPlan, count: activeVibingDirectorBlenderPlanCount, cancelAll: cancelAllVibingDirectorBlenderPlans },
] as const

describe.each(runners)('$name asset persistence', (runner) => {
  let root: string
  let context: AssetWriteContext
  let child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> }
  let scratch: string
  let outputDir: string
  let args: string[]
  let stale: boolean

  function run() {
    return runner.run({
      projectId: 'project', jobId: 'job', directorNodeId: 'director',
      scene: {}, plan: { actions: [] }, assets: [],
      blenderPath: path.join(root, 'blender'), harnessRoot: root,
    })
  }

  function complete(code = 0) {
    const artifacts = {
      preview: path.join(outputDir, 'preview.png'),
      blend: path.join(outputDir, 'scene.blend'),
      model: path.join(outputDir, 'scene.glb'),
    }
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(artifacts.preview, 'preview')
    fs.writeFileSync(artifacts.blend, 'BLENDER')
    fs.writeFileSync(artifacts.model, 'glTF')
    child.stdout.emit('data', `${JSON.stringify({ ok: true, jobId: 'job', artifacts })}\n`)
    child.emit('close', code, null)
  }

  beforeEach(() => {
    vi.resetAllMocks()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-blender-persistence-'))
    fs.writeFileSync(path.join(root, 'blender'), '')
    const bridge = path.join(root, 'cli_anything', 'blender', 'bridge.py')
    fs.mkdirSync(path.dirname(bridge), { recursive: true })
    fs.writeFileSync(bridge, '')
    stale = false
    scratch = ''
    context = {
      projectId: 'project', root,
      binding: { projectId: 'project', immutableProjectUuid: '00000000-0000-4000-8000-000000000001', projectGeneration: 1 },
      assertCurrent: vi.fn(() => { if (stale) throw new Error('project_binding_stale') }),
    }
    mocks.projectDirById.mockReturnValue(root)
    mocks.capture.mockResolvedValue(context)
    mocks.writeAsset.mockImplementation((projectId, _bytes, fileName, _type, _meta, _expectedKind, captured) => {
      captured?.assertCurrent()
      return { id: fileName, data: { url: `nomi-local://asset/${projectId}/${fileName}` } }
    })
    child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(() => true),
    })
    mocks.spawn.mockImplementation((_binary, inputArgs: string[]) => {
      args = inputArgs
      if (runner.name === 'director') {
        scratch = path.dirname(args[args.indexOf('--scene-input') + 1])
        outputDir = path.join(root, '.nomi-director', 'exports', 'job')
      } else {
        scratch = path.dirname(args[args.indexOf('--python') + 1])
        outputDir = args.at(-1)!
      }
      return child
    })
  })

  afterEach(() => {
    expect(runner.count()).toBe(0)
    if (scratch) expect(fs.existsSync(scratch)).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it.each(['sync', 'async'])('passes kinds and the same captured context to all %s writes', async (mode) => {
    if (mode === 'async') {
      const write = mocks.writeAsset.getMockImplementation()!
      mocks.writeAsset.mockImplementation(async (...input) => write(...input))
    }
    const running = run()
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    complete()
    await expect(running).resolves.toMatchObject({
      jobId: 'job', preview: { url: expect.any(String) },
      blend: { url: expect.any(String) }, model: { url: expect.any(String) },
    })
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith('project')
    expect(mocks.writeAsset.mock.calls.map((call) => call[5])).toEqual(['image', null, 'model3d'])
    for (const call of mocks.writeAsset.mock.calls) {
      expect(call[6]).toBe(context)
      expect(call[4].kind).toBe('blender')
    }
    expect(mocks.writeAsset.mock.calls[2][4]).toMatchObject({ model3dValidation: { meshCount: 1 } })
  })

  it('waits for capture before spawning and uses its root rather than resolving again', async () => {
    let resolveCapture!: (value: AssetWriteContext) => void
    mocks.capture.mockImplementation(() => new Promise<AssetWriteContext>((resolve) => { resolveCapture = resolve }))
    const running = run()
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce())
    expect(mocks.spawn).not.toHaveBeenCalled()
    mocks.projectDirById.mockReturnValue(path.join(root, 'replacement'))
    resolveCapture(context)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    if (runner.name === 'director') expect(args[args.indexOf('--project-dir') + 1]).toBe(root)
    if (runner.name === 'vibing') expect(outputDir).toBe(path.join(root, '.nomi', 'vibing-director', 'director', 'exports', 'job'))
    complete()
    await expect(running).resolves.toMatchObject({ jobId: 'job' })
  })

  it('rejects failed capture without starting a process or writing assets', async () => {
    mocks.capture.mockRejectedValue(new Error('project_binding_stale'))
    await expect(run()).rejects.toThrow('project_binding_stale')
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.writeAsset).not.toHaveBeenCalled()
  })

  it('cancels a pending capture on exit without later spawning Blender', async () => {
    let resolveCapture!: (value: AssetWriteContext) => void
    mocks.capture.mockImplementation(() => new Promise<AssetWriteContext>((resolve) => { resolveCapture = resolve }))
    const running = run()
    const rejected = expect(running).rejects.toThrow(/已取消/)
    let settled = false
    void running.then(() => { settled = true }, () => { settled = true })
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce())
    const cancelled = runner.cancelAll()
    resolveCapture(context)
    // Close any regression-spawned fake process so a failure does not leak a job.
    await vi.waitFor(() => {
      if (mocks.spawn.mock.calls.length) child.emit('close', null, 'SIGTERM')
      expect(settled).toBe(true)
    })
    await rejected
    expect(cancelled).toBe(1)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.writeAsset).not.toHaveBeenCalled()
  })

  it('reserves the job id while capture is pending', async () => {
    let resolveCapture!: (value: AssetWriteContext) => void
    mocks.capture.mockImplementation(() => new Promise<AssetWriteContext>((resolve) => { resolveCapture = resolve }))
    const running = run()
    await expect(run()).rejects.toThrow(/已在运行/)
    expect(mocks.capture).toHaveBeenCalledOnce()
    resolveCapture(context)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    complete()
    await running
  })

  it('rejects a stale project on child close instead of recapturing a new session', async () => {
    const running = run()
    const rejected = expect(running).rejects.toThrow('project_binding_stale')
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    stale = true
    complete()
    await rejected
    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(mocks.writeAsset).toHaveBeenCalledTimes(1)
  })

  it.each([0, 1, 2])('propagates a rejection from write %i through child close and cleans up', async (index) => {
    const write = mocks.writeAsset.getMockImplementation()!
    let call = 0
    mocks.writeAsset.mockImplementation(async (...input) => {
      if (call++ === index) throw new Error('asset_write_failed')
      return write(...input)
    })
    const running = run()
    const rejected = expect(running).rejects.toThrow('asset_write_failed')
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    complete()
    await rejected
    expect(mocks.writeAsset).toHaveBeenCalledTimes(index + 1)
  })

  it('still propagates synchronous store exceptions through child close', async () => {
    mocks.writeAsset.mockImplementation(() => { throw new Error('sync_write_failed') })
    const running = run()
    const rejected = expect(running).rejects.toThrow('sync_write_failed')
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    complete()
    await rejected
    expect(mocks.writeAsset).toHaveBeenCalledOnce()
  })

  it('rechecks the original context if identity changes between writes', async () => {
    const write = mocks.writeAsset.getMockImplementation()!
    mocks.writeAsset.mockImplementation(async (...input) => {
      const result = write(...input)
      stale = true
      return result
    })
    const running = run()
    const rejected = expect(running).rejects.toThrow('project_binding_stale')
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    complete()
    await rejected
    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(mocks.writeAsset).toHaveBeenCalledTimes(2)
  })

  it.each(['error', 'nonzero'])('does not persist on a child %s and cleans up', async (failure) => {
    const running = run()
    const rejected = expect(running).rejects.toThrow(/失败/)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    if (failure === 'error') {
      child.emit('error', new Error('spawn_failed'))
      child.emit('close', -1, null)
    } else {
      child.emit('close', 1, null)
    }
    await rejected
    expect(mocks.writeAsset).not.toHaveBeenCalled()
  })

  it('retains scratch and the active job until the last write settles', async () => {
    const write = mocks.writeAsset.getMockImplementation()!
    let finishWrite!: () => void
    mocks.writeAsset.mockImplementation((...input) => {
      if (input[2].endsWith('.glb')) return new Promise((resolve) => { finishWrite = () => resolve(write(...input)) })
      return write(...input)
    })
    const running = run()
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    complete()
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'))
    expect(runner.count()).toBe(1)
    expect(fs.existsSync(scratch)).toBe(true)
    finishWrite()
    await running
  })

  it('cancels during persistence without writing later artifacts or killing a closed child', async () => {
    const write = mocks.writeAsset.getMockImplementation()!
    let finishWrite!: () => void
    mocks.writeAsset.mockImplementationOnce((...input) => new Promise((resolve) => {
      finishWrite = () => resolve(write(...input))
    }))
    const running = run()
    const rejected = expect(running).rejects.toThrow(/已取消/)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    complete()
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'))
    expect(runner.cancelAll()).toBe(1)
    finishWrite()
    await rejected
    expect(mocks.writeAsset).toHaveBeenCalledOnce()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('keeps cancel-all process cleanup and does not persist a cancelled result', async () => {
    const running = run()
    const rejected = expect(running).rejects.toThrow(/已取消/)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    expect(runner.cancelAll()).toBe(1)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(runner.count()).toBe(1)
    expect(fs.existsSync(scratch)).toBe(true)
    child.emit('close', null, 'SIGTERM')
    await rejected
    expect(mocks.writeAsset).not.toHaveBeenCalled()
  })
})
