import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const transport = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../appFetch', () => ({ appFetch: transport.fetch }))
vi.mock('../jimengWeb/auth', () => ({ jimengWebAuthHeaders: () => ({ 'X-Test-Bridge': 'jimeng' }) }))
vi.mock('../pavoWeb/auth', () => ({ pavoWebAuthHeaders: () => ({ 'X-Test-Bridge': 'pavo' }) }))
import { assertAgnesPublicImageReachable } from './agnesPublicAssetProbe'
import { probeJimengWebServer, submitJimengWebTask, queryJimengWebTask } from '../jimengWeb/seedanceBridge'
import { probePavoWebServer, submitPavoWebTask, queryPavoWebTask } from '../pavoWeb/bridge'
import { JIMENG_WEB_BRIDGE_INSTANCE_ID } from './jimengWeb'
import { PAVO_WEB_BRIDGE_INSTANCE_ID, PAVO_WEB_SAFETY_CONTRACT_VERSION } from './pavoWeb'
import type { TaskRequest } from '../runtime'

const globalFetch = vi.fn(() => { throw new Error('Unowned global network entry was called') })
beforeEach(() => { transport.fetch.mockReset(); globalFetch.mockClear(); vi.stubGlobal('fetch', globalFetch) })
afterEach(() => vi.unstubAllGlobals())

const providers = [
  { id: 'jimeng', base: 'http://127.0.0.1:3457', probe: probeJimengWebServer, submit: submitJimengWebTask, query: queryJimengWebTask,
    status: { name: 'Seedance 任务 Mock API', instanceId: JIMENG_WEB_BRIDGE_INSTANCE_ID, sseClients: 1 } },
  { id: 'pavo', base: 'http://127.0.0.1:3458', probe: probePavoWebServer, submit: submitPavoWebTask, query: queryPavoWebTask,
    status: { name: 'Pavo Web Task Bridge', instanceId: PAVO_WEB_BRIDGE_INSTANCE_ID, safetyContractVersion: PAVO_WEB_SAFETY_CONTRACT_VERSION, sseClients: 1 } },
] as const
const request: TaskRequest = { kind: 'text_to_video', prompt: 'isolated transport fixture', extras: { idempotencyKey: 'fixture-idempotency', projectId: 'project-a', nodeId: 'node-a' } }

describe('web bridge transport ownership', () => {
  it('uses appFetch for the default public image probe, preserving Range and abort controls', async () => {
    transport.fetch.mockResolvedValue(new Response(new Uint8Array([137]), { status: 206, headers: { 'Content-Type': 'image/png' } }))
    const result = await assertAgnesPublicImageReachable('https://cdn.example.com/fixture.png')
    expect(result.status).toBe(206)
    expect(transport.fetch).toHaveBeenCalledExactlyOnceWith('https://cdn.example.com/fixture.png', expect.objectContaining({
      method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: expect.any(AbortSignal),
    }))
    expect(globalFetch).not.toHaveBeenCalled()
  })
  for (const provider of providers) {
    it(`${provider.id}: default health probe uses the common entry`, async () => {
      transport.fetch.mockResolvedValue(Response.json(provider.status))
      expect((await provider.probe(provider.base)).ok).toBe(true)
      expect(transport.fetch).toHaveBeenCalledOnce()
      expect(globalFetch).not.toHaveBeenCalled()
    })
    it(`${provider.id}: submits once with the original idempotency key`, async () => {
      transport.fetch.mockResolvedValueOnce(Response.json(provider.status)).mockResolvedValueOnce(Response.json({ taskCodes: ['fixture-task'] }))
      const result = await provider.submit({ request, vendorBaseUrl: provider.base })
      expect(result.taskCode).toBe('fixture-task')
      const submissions = transport.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')
      expect(submissions).toHaveLength(1)
      expect(JSON.parse(submissions[0][1].body)).toMatchObject({ idempotencyKey: 'fixture-idempotency', prompt: request.prompt })
      expect(transport.fetch).toHaveBeenCalledTimes(2)
      expect(globalFetch).not.toHaveBeenCalled()
    })
    it(`${provider.id}: a queued query never submits or writes an asset`, async () => {
      transport.fetch.mockImplementation(async (url: unknown) => {
        const task = { taskCode: 'fixture-task', status: 'queued', owner: { projectId: 'project-a', nodeId: 'node-a' } }
        return Response.json(String(url).includes('/api/files') ? { files: [] } : provider.id === 'jimeng' ? { tasks: [task] } : { task })
      })
      const writeAsset = vi.fn()
      const result = await provider.query({ taskCode: 'fixture-task', request, serverUrl: provider.base, projectId: 'project-a', nodeId: 'node-a', writeAsset })
      expect(result.status).toBe('queued')
      expect(transport.fetch).toHaveBeenCalled()
      expect(transport.fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
      expect(writeAsset).not.toHaveBeenCalled()
      expect(globalFetch).not.toHaveBeenCalled()
    })
    it(`${provider.id}: an uncertain submission does not resend`, async () => {
      transport.fetch.mockResolvedValueOnce(Response.json(provider.status)).mockRejectedValueOnce(new TypeError('fixture connection closed'))
      await expect(provider.submit({ request, vendorBaseUrl: provider.base })).rejects.toThrow()
      expect(transport.fetch).toHaveBeenCalledTimes(2)
      expect(transport.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
      expect(globalFetch).not.toHaveBeenCalled()
    })
    it(`${provider.id}: an explicitly supplied test transport remains authoritative`, async () => {
      const injected = vi.fn().mockResolvedValue(Response.json(provider.status))
      expect((await provider.probe(provider.base, injected)).ok).toBe(true)
      expect(injected).toHaveBeenCalledOnce()
      expect(transport.fetch).not.toHaveBeenCalled()
      expect(globalFetch).not.toHaveBeenCalled()
    })
  }
})
