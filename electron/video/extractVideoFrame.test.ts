import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeVideoFrameTimes, videoFrameCacheRelativePath } from './extractVideoFrame'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const mock = vi.hoisted(() => ({
  root: '',
  jobs: [] as Array<{ args: string[]; finish(bytes?: Buffer, code?: number): void }>,
  fetch: vi.fn(),
  probe: vi.fn(),
}))
vi.mock('electron', () => ({ app: { getPath: () => mock.root, getAppPath: () => process.cwd(), getName: () => 'Nomi' } }))
vi.mock('../assets/assetEvents', () => ({ broadcastAssetsUpdated: vi.fn(), broadcastAssetLocalizationStarted: vi.fn() }))
vi.mock('../export/ensureExecutable', () => ({ ensureExecutable: () => undefined }))
vi.mock('../export/mediaProbe', async (importOriginal) => ({
  ...await importOriginal<typeof import('../export/mediaProbe')>(),
  probeMediaMetadata: mock.probe,
}))
vi.mock('../hardenedFetch', () => ({ hardenedFetch: mock.fetch }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: (_bin: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() })
    mock.jobs.push({ args, finish(bytes = PNG, code = 0) {
      if (bytes.length) fs.writeFileSync(args[args.length - 1], bytes)
      child.emit('close', code)
    } })
    return child
  },
}))

const roots: string[] = []
const originalSettings = process.env.NOMI_SETTINGS_DIR
function temp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-frame-merge-'))
  roots.push(root)
  return root
}
beforeEach(() => {
  vi.resetModules()
  mock.jobs = []
  mock.root = temp()
  mock.fetch.mockReset().mockResolvedValue({ bytes: Buffer.from('video') })
  mock.probe.mockReset().mockResolvedValue({ durationSeconds: 10 })
  process.env.NOMI_SETTINGS_DIR = path.join(mock.root, 'settings')
})
afterEach(() => {
  vi.restoreAllMocks()
  if (originalSettings === undefined) delete process.env.NOMI_SETTINGS_DIR
  else process.env.NOMI_SETTINGS_DIR = originalSettings
  for (const job of mock.jobs) {
    fs.rmSync(job.args[job.args.length - 1], { force: true })
    const input = job.args[job.args.indexOf('-i') + 1]
    if (path.basename(input).startsWith('nomi-relay-src-')) fs.rmSync(input, { force: true })
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function setup() {
  const repository = await import('../projects/repository')
  const store = await import('../assets/projectAssetStore')
  const api = await import('./extractVideoFrame')
  const { captureAssetWriteContext } = await import('../assets/assetWriteContext')
  const project = repository.createProject({ rootPath: temp(), name: 'frames', payload: {} })
  const context = await captureAssetWriteContext(project.id)
  const video = path.join(temp(), 'clip.mp4')
  fs.writeFileSync(video, 'video')
  const payload = { videoUrl: video, projectId: project.id, projectBinding: context.binding }
  const framePath = (which: 'first' | 'last' | number) => path.join(context.root, api.videoFrameCacheRelativePath(video, which))
  const assets = () => store.listProjectAssets({ projectId: project.id }).items
  const bumpGeneration = () => {
    for (const name of ['project.json', 'project.backup.json']) {
      const target = path.join(context.root, '.nomi', name)
      if (!fs.existsSync(target)) continue
      const record = JSON.parse(fs.readFileSync(target, 'utf8'))
      fs.writeFileSync(target, JSON.stringify({ ...record, projectGeneration: record.projectGeneration + 1 }))
    }
  }
  return { api, repository, store, context, payload, framePath, assets, bumpGeneration }
}

async function finish(index = 0, bytes = PNG, code = 0) {
  await vi.waitFor(() => expect(mock.jobs.length).toBeGreaterThan(index))
  mock.jobs[index].finish(bytes, code)
}

describe('videoFrameCacheRelativePath', () => {
  it('为同一视频和帧位生成稳定路径', () => {
    const first = videoFrameCacheRelativePath('nomi-local://asset/p/assets/generated/clip.mp4', 'first')
    const second = videoFrameCacheRelativePath('nomi-local://asset/p/assets/generated/clip.mp4', 'first')
    expect(first).toBe(second)
    expect(first).toMatch(/^assets\/generated\/video-frames\/frame-first-[a-f0-9]{24}\.png$/)
  })

  it('不同视频或帧位不会共用缓存文件', () => {
    const videoAFirst = videoFrameCacheRelativePath('https://cdn.example/a.mp4', 'first')
    const videoALast = videoFrameCacheRelativePath('https://cdn.example/a.mp4', 'last')
    const videoBFirst = videoFrameCacheRelativePath('https://cdn.example/b.mp4', 'first')
    expect(new Set([videoAFirst, videoALast, videoBFirst]).size).toBe(3)
  })

  it('不把远端 URL 或查询参数暴露到文件名', () => {
    const relativePath = videoFrameCacheRelativePath('https://cdn.example/private.mp4?token=secret', 1.25)
    expect(relativePath).toMatch(/^assets\/generated\/video-frames\/frame-at-[a-f0-9]{24}\.png$/)
    expect(relativePath).not.toContain('secret')
  })

  it('批量时间点去重、排序并过滤非法值', () => {
    expect(normalizeVideoFrameTimes([2, Number.NaN, -1, 1.23456, 2, Number.POSITIVE_INFINITY]))
      .toEqual([0, 1.235, 2])
  })
})

describe('merged frame extraction boundary', () => {
  it('persists a stable frame and reuses it after the memory cache is cleared', async () => {
    const { api, payload, framePath, assets } = await setup()
    const pending = api.extractVideoFrameToAsset({ ...payload, which: 'first' })
    await finish()
    const result = await pending
    expect(fs.readFileSync(framePath('first'))).toEqual(PNG)
    expect(assets()).toHaveLength(1)
    api.resetVideoFrameCacheForTests()
    await expect(api.extractVideoFrameToAsset({ ...payload, which: 'first' })).resolves.toEqual(result)
    expect(mock.jobs).toHaveLength(1)
  })

  it('forces regeneration at the same persistent path', async () => {
    const { api, payload, framePath } = await setup()
    const target = framePath('first')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, 'old frame')
    const pending = api.extractVideoFrameToAsset({ ...payload, which: 'first', forceRerun: true })
    await finish()
    await pending
    expect(fs.readFileSync(target)).toEqual(PNG)
    expect(fs.readdirSync(path.dirname(target))).toEqual([path.basename(target)])
  })

  it('keeps the previous frame and removes staging if the action is revoked after copying', async () => {
    const { api, payload, framePath } = await setup()
    const target = framePath(0)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, 'previous frame')
    let current = true
    const copy = fs.copyFileSync
    vi.spyOn(fs, 'copyFileSync').mockImplementation((...args) => {
      copy(...args)
      current = false
    })
    const pending = api.extractVideoFramesToAssets({ ...payload, times: [0], forceRerun: true }, { assertCurrent() {
      if (!current) throw Object.assign(new Error('project_binding_stale'), { code: 'project_binding_stale' })
    } })
    await finish()
    await expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
    expect(fs.readFileSync(target, 'utf8')).toBe('previous frame')
    expect(fs.readdirSync(path.dirname(target))).toEqual([path.basename(target)])
  })

  it('rejects after download if the project changed, without starting ffmpeg or leaking the source', async () => {
    const { api, payload, assets, bumpGeneration } = await setup()
    let release!: (result: { bytes: Buffer }) => void
    mock.fetch.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const pending = api.extractVideoFramesToAssets({ ...payload, videoUrl: 'https://cdn.example/clip.mp4', times: [0, 1] })
    await vi.waitFor(() => expect(mock.fetch).toHaveBeenCalledTimes(1))
    bumpGeneration()
    const write = vi.spyOn(fs, 'writeFileSync')
    release({ bytes: Buffer.from('video') })
    await expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
    const downloaded = write.mock.calls.map(([file]) => String(file)).filter((file) => path.basename(file).startsWith('nomi-relay-src-'))
    expect(downloaded).toHaveLength(1)
    expect(fs.existsSync(downloaded[0])).toBe(false)
    expect(mock.jobs).toHaveLength(0)
    expect(assets()).toEqual([])
  })

  it.each(['memory', 'disk'] as const)('checks interaction and projectBinding on a %s cache hit', async (cache) => {
    const { api, payload, bumpGeneration } = await setup()
    const pending = api.extractVideoFrameToAsset({ ...payload, which: 'first' })
    await finish()
    await pending
    if (cache === 'disk') api.resetVideoFrameCacheForTests()
    const stale = Object.assign(new Error('project_binding_stale'), { code: 'project_binding_stale' })
    await expect(api.extractVideoFrameToAsset({ ...payload, which: 'first' }, { assertCurrent() { throw stale } }))
      .rejects.toBe(stale)
    bumpGeneration()
    await expect(api.extractVideoFrameToAsset({ ...payload, which: 'first' })).rejects.toMatchObject({ code: 'project_binding_stale' })
    expect(mock.jobs).toHaveLength(1)
  })

  it.each(['single', 'batch'] as const)('rejects %s writes if the project root is rebound during ffmpeg', async (entry) => {
    const { api, repository, payload, assets } = await setup()
    const pending = entry === 'single'
      ? api.extractVideoFrameToAsset({ ...payload, which: 'first' })
      : api.extractVideoFramesToAssets({ ...payload, times: [0, 1] })
    await vi.waitFor(() => expect(mock.jobs).toHaveLength(1))
    const replacement = temp()
    vi.spyOn(repository, 'projectDirById').mockReturnValue(replacement)
    await finish()
    await expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
    vi.restoreAllMocks()
    expect(assets()).toEqual([])
    expect(fs.readdirSync(replacement)).toEqual([])
    expect(mock.jobs).toHaveLength(1)
    expect(fs.existsSync(mock.jobs[0].args.at(-1)!)).toBe(false)
  })

  it('downloads one source for a normalized batch and reuses all cached frames without downloading', async () => {
    const { api, payload } = await setup()
    const batch = { ...payload, videoUrl: 'https://cdn.example/clip.mp4', times: [2, 0, 2, -1, 1.23456, NaN] }
    const pending = api.extractVideoFramesToAssets(batch)
    await finish(0)
    await finish(1)
    await finish(2)
    const result = await pending
    expect(result.frames.map((frame) => frame.timeSeconds)).toEqual([0, 1.235, 2])
    expect(result.frames.every((frame) => frame.url.includes(payload.projectId))).toBe(true)
    expect(mock.fetch).toHaveBeenCalledTimes(1)
    const inputs = mock.jobs.map((job) => job.args[job.args.indexOf('-i') + 1])
    expect(new Set(inputs).size).toBe(1)
    expect(fs.existsSync(inputs[0])).toBe(false)
    api.resetVideoFrameCacheForTests()
    await expect(api.extractVideoFramesToAssets(batch)).resolves.toEqual(result)
    expect(mock.fetch).toHaveBeenCalledTimes(1)
    expect(mock.jobs).toHaveLength(3)
  })

  it('shares single-frame disk cache with a mixed batch', async () => {
    const { api, payload } = await setup()
    const first = api.extractVideoFrameToAsset({ ...payload, which: 0 })
    await finish()
    const cached = await first
    const pending = api.extractVideoFramesToAssets({ ...payload, times: [0, 1] })
    await finish(1)
    const result = await pending
    expect(result.frames[0].url).toBe(cached.url)
    expect(mock.jobs).toHaveLength(2)
  })

  it.each(['single', 'batch'] as const)('revokes %s publication through the same options argument', async (entry) => {
    const { api, payload, assets } = await setup()
    let current = true
    const options = { assertCurrent() {
      if (!current) throw Object.assign(new Error('project_binding_stale'), { code: 'project_binding_stale' })
    } }
    const pending = entry === 'single'
      ? api.extractVideoFrameToAsset({ ...payload, which: 'first' }, options)
      : api.extractVideoFramesToAssets({ ...payload, times: [0, 1] }, options)
    await vi.waitFor(() => expect(mock.jobs).toHaveLength(1))
    current = false
    await finish()
    await expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
    expect(assets()).toEqual([])
    expect(mock.jobs).toHaveLength(1)
  })

  it('stops a batch after revocation during its second frame without publishing that frame', async () => {
    const { api, payload, framePath } = await setup()
    let current = true
    const pending = api.extractVideoFramesToAssets({ ...payload, times: [0, 1, 2] }, { assertCurrent() {
      if (!current) throw Object.assign(new Error('project_binding_stale'), { code: 'project_binding_stale' })
    } })
    await finish(0)
    await vi.waitFor(() => expect(mock.jobs).toHaveLength(2))
    current = false
    await finish(1)
    await expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
    expect(fs.existsSync(framePath(0))).toBe(true)
    expect(fs.existsSync(framePath(1))).toBe(false)
    expect(fs.existsSync(framePath(2))).toBe(false)
    expect(mock.jobs).toHaveLength(2)
  })

  it('rejects stale binding and revoked actions even for a fully cached batch', async () => {
    const { api, payload, bumpGeneration } = await setup()
    const pending = api.extractVideoFramesToAssets({ ...payload, times: [0] })
    await finish()
    await pending
    await expect(api.extractVideoFramesToAssets({ ...payload, times: [0] }, { assertCurrent() { throw new Error('revoked') } }))
      .rejects.toThrow('revoked')
    bumpGeneration()
    await expect(api.extractVideoFramesToAssets({ ...payload, times: [0] })).rejects.toMatchObject({ code: 'project_binding_stale' })
    expect(mock.jobs).toHaveLength(1)
  })

  it.each([[10, 9.75], [0.2, 0.18]])('keeps the last-frame margin for duration %s', async (duration, seek) => {
    const { api, payload } = await setup()
    mock.probe.mockResolvedValue({ durationSeconds: duration })
    const pending = api.extractVideoFrameToAsset({ ...payload, which: 'last' })
    await finish()
    await pending
    const args = mock.jobs[0].args
    const seeks = args.flatMap((value, index) => value === '-ss' ? [Number(args[index + 1])] : [])
    expect(seeks[0] + seeks[1]).toBeCloseTo(seek)
  })

  it.each([0, 1])('cleans source and output on ffmpeg failure (code %s)', async (code) => {
    const { api, payload, assets } = await setup()
    const pending = api.extractVideoFramesToAssets({ ...payload, videoUrl: 'https://cdn.example/clip.mp4', times: [0, 1] })
    await finish(0, Buffer.alloc(0), code)
    await expect(pending).rejects.toBeInstanceOf(api.VideoFrameError)
    const args = mock.jobs[0].args
    expect(fs.existsSync(args[args.indexOf('-i') + 1])).toBe(false)
    expect(fs.existsSync(args.at(-1)!)).toBe(false)
    expect(assets()).toEqual([])
    expect(mock.jobs).toHaveLength(1)
  })

  it('passes expectedKind=image and the captured context for endpoint asset writes', async () => {
    const { api, store, context, payload, assets } = await setup()
    const write = vi.spyOn(store, 'writeAsset')
    const pending = api.extractVideoEndpointsToAsset(payload)
    await finish()
    await pending
    expect(write).toHaveBeenCalledWith(payload.projectId, PNG, expect.any(String), 'image/png',
      expect.objectContaining({ kind: 'generated' }), 'image', expect.objectContaining({ root: context.root, binding: context.binding }))
    expect(assets()).toHaveLength(1)
  })

  it('does not publish filmstrip cache into a replaced project', async () => {
    const { api, payload, context, bumpGeneration } = await setup()
    const pending = api.extractVideoFilmstripToAsset(payload)
    await vi.waitFor(() => expect(mock.jobs).toHaveLength(1))
    bumpGeneration()
    await finish()
    await expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
    expect(fs.existsSync(path.join(context.root, '.nomi/cache/filmstrip'))).toBe(false)
  })

  it('keeps filmstrips in the captured cache root, reuses inflight work, and leaves the asset library unchanged', async () => {
    const { api, payload, context, assets } = await setup()
    const first = api.extractVideoFilmstripToAsset(payload)
    const second = api.extractVideoFilmstripToAsset(payload)
    await finish()
    const result = await first
    await expect(second).resolves.toEqual(result)
    await expect(api.extractVideoFilmstripToAsset(payload)).resolves.toEqual(result)
    expect(fs.readdirSync(path.join(context.root, '.nomi/cache/filmstrip'))).toHaveLength(1)
    expect(mock.jobs).toHaveLength(1)
    expect(assets()).toEqual([])
  })

  it('does not reuse endpoint memory cache across project generations', async () => {
    const { api, payload, bumpGeneration } = await setup()
    const first = api.extractVideoEndpointsToAsset(payload)
    await finish()
    const original = await first
    bumpGeneration()
    const second = api.extractVideoEndpointsToAsset(payload)
    await finish(1)
    expect((await second).url).not.toBe(original.url)
    expect(mock.jobs).toHaveLength(2)
  })

  it.each([
    { times: [] },
    { times: [NaN, Infinity] },
    { times: Array.from({ length: 25 }, (_, index) => index) },
  ])('rejects invalid batches before IO: $times', async ({ times }) => {
    const { api, payload } = await setup()
    await expect(api.extractVideoFramesToAssets({ ...payload, times })).rejects.toBeInstanceOf(api.VideoFrameError)
    expect(mock.fetch).not.toHaveBeenCalled()
    expect(mock.jobs).toHaveLength(0)
  })
})
