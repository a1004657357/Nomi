import { describe, expect, it, vi } from 'vitest'
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from '../capabilityCore/canvasReadSurfaceRegistry'
import { createCreativeLaneTools } from './laneCreativeTools'

const binding = { projectId: 'creative-test', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 }
const safeResult = (status = 'applied') => ({ status, summary: 'Fixture result', generationStarted: false, autoResubmit: false })

async function fixture() {
  const ownerAuthority = createSurfaceOwnerAuthority()
  const owner = ownerAuthority.capture({ contents: {}, frame: {}, webContentsId: 1, processId: 2, frameRoutingId: 3, origin: 'file://', isLive: () => true })
  const registry = createCanvasReadSurfaceRegistry({ ownerAuthority, resolveProjectIdentity: async () => ({ ...binding, canonicalRootPath: '/tmp/creative-fixture', canonicalRootDigest: 'fixture-root' }) })
  const suspension = registry.suspend(owner, { surfaceInstanceId: 'creative-surface' })
  const committed = await registry.commitCanvasRead(owner, { projectId: binding.projectId, suspension })
  const session = registry.openProjectSession(owner, committed.binding)
  const requestRenderer = vi.fn(async (_op: string, _payload: unknown, _timeout: number): Promise<unknown> => safeResult('read'))
  const assembly = createCreativeLaneTools({ registry, session, binding, requestRenderer })
  const controller = new AbortController()
  const execute = (name: string, args: unknown = {}, id = 'call-1') => assembly.tools.find(tool => tool.name === name)!.execute(args, { toolCallId: id, signal: controller.signal })
  const approve = async (name: string, args: unknown, id = 'call-1', record = vi.fn(async () => {})) => {
    const call = { toolName: name, toolCallId: id, args }
    await assembly.toolLifecycle.prepare(call, controller.signal)
    await assembly.toolLifecycle.approved(call, record)
    return call
  }
  return { ...assembly, registry, session, owner, requestRenderer, execute, approve, controller }
}

describe('creative components on the desktop lane', () => {
  it('binds six real tools in existing deferred groups and does not duplicate staging', async () => {
    const f = await fixture()
    expect(f.tools.map(tool => tool.name)).toEqual(['list_capability_recipes', 'read_vibing_director', 'apply_capability_recipe', 'save_creative_resource', 'handoff_model3d', 'apply_vibing_director_plan'])
    expect(f.tools.every(tool => tool.internalGroup === 'media')).toBe(true)
    expect(f.tools.some(tool => tool.name === 'create_staging_reference')).toBe(false)
  })

  it('executes a read through the project-bound renderer bridge with safety policy', async () => {
    const f = await fixture()
    expect(await f.execute('list_capability_recipes')).toMatchObject({ ok: true })
    expect(f.requestRenderer).toHaveBeenCalledWith('creative.tool.execute', {
      binding,
      call: { toolCallId: 'call-1', toolName: 'list_capability_recipes', args: {}, policy: { allowGeneration: false, requirePaidConfirmation: true, autoResubmit: false } },
    }, 30_000)
  })

  it('rejects write execution without a completed Host approval lifecycle', async () => {
    const f = await fixture()
    expect(await f.execute('handoff_model3d', { sourceNodeId: 'source', target: 'scene3d' })).toMatchObject({ ok: false })
    expect(f.requestRenderer).not.toHaveBeenCalled()
  })

  it('records approval before dispatch and never automatically replays a write', async () => {
    const f = await fixture()
    const args = { sourceNodeId: 'source', target: 'scene3d' }
    const record = vi.fn(async () => { expect(f.requestRenderer).not.toHaveBeenCalled() })
    const call = await f.approve('handoff_model3d', args, 'call-1', record)
    f.requestRenderer.mockResolvedValue(safeResult())
    expect(await f.execute('handoff_model3d', args)).toMatchObject({ ok: true })
    f.toolLifecycle.settled(call)
    await f.approve('handoff_model3d', args).catch(() => {})
    expect(await f.execute('handoff_model3d', args)).toMatchObject({ ok: false })
    expect(f.requestRenderer).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledOnce()
  })

  it('does not dispatch changed arguments under an earlier approval', async () => {
    const f = await fixture()
    await f.approve('handoff_model3d', { sourceNodeId: 'first', target: 'scene3d' })
    expect(await f.execute('handoff_model3d', { sourceNodeId: 'second', target: 'scene3d' })).toMatchObject({ ok: false })
    expect(f.requestRenderer).not.toHaveBeenCalled()
  })

  it('rejects a project switch before dispatch', async () => {
    const f = await fixture()
    f.registry.suspend(f.owner, { surfaceInstanceId: 'another-surface' })
    expect(await f.execute('list_capability_recipes')).toMatchObject({ ok: false })
    expect(f.requestRenderer).not.toHaveBeenCalled()
  })

  it('does not replace a pending approval or dispatch a disposed assembly', async () => {
    const f = await fixture()
    const args = { sourceNodeId: 'source', target: 'scene3d' }
    await f.toolLifecycle.prepare({ toolName: 'handoff_model3d', toolCallId: 'call-1', args }, f.controller.signal)
    await expect(f.toolLifecycle.prepare({ toolName: 'handoff_model3d', toolCallId: 'call-1', args }, f.controller.signal)).rejects.toThrow()
    f.dispose()
    expect(await f.execute('list_capability_recipes')).toMatchObject({ ok: false })
    expect(f.requestRenderer).not.toHaveBeenCalled()
  })

  it('does not dispatch after cancellation', async () => {
    const f = await fixture()
    f.controller.abort()
    await expect(f.execute('list_capability_recipes')).rejects.toThrow()
    expect(f.requestRenderer).not.toHaveBeenCalled()
  })

  it('revalidates the session after a reply and discards stale results', async () => {
    const f = await fixture()
    f.requestRenderer.mockImplementation(async () => { f.registry.revokeProjectSession(f.session); return safeResult('read') })
    expect(await f.execute('list_capability_recipes')).toMatchObject({ ok: false })
    expect(f.requestRenderer).toHaveBeenCalledTimes(1)
  })

  it('rejects model-provided binding, generation and resubmission overrides', async () => {
    const f = await fixture()
    for (const args of [{ binding }, { allowGeneration: true }, { autoResubmit: true }]) {
      expect(await f.execute('list_capability_recipes', args)).toMatchObject({ ok: false })
    }
    expect(f.requestRenderer).not.toHaveBeenCalled()
  })

  it('returns a recipe plan, not a paid submission, and rejects an applied recipe reply', async () => {
    const f = await fixture()
    const args = { sourceNodeId: 'source', recipeId: 'image.multiview.grid9' }
    await f.approve('apply_capability_recipe', args)
    f.requestRenderer.mockResolvedValue(safeResult('awaiting_paid_confirmation'))
    expect(await f.execute('apply_capability_recipe', args)).toMatchObject({ ok: true, details: { generationStarted: false, autoResubmit: false } })
    await f.approve('apply_capability_recipe', args, 'call-2')
    f.requestRenderer.mockResolvedValue(safeResult('applied'))
    expect(await f.execute('apply_capability_recipe', args, 'call-2')).toMatchObject({ ok: false })
  })

  it('fails closed on generation or automatic resubmission in a renderer reply', async () => {
    const f = await fixture()
    f.requestRenderer.mockResolvedValue({ ...safeResult('read'), generationStarted: true })
    expect(await f.execute('list_capability_recipes')).toMatchObject({ ok: false })
    f.requestRenderer.mockResolvedValue({ ...safeResult('read'), autoResubmit: true })
    expect(await f.execute('list_capability_recipes', {}, 'call-2')).toMatchObject({ ok: false })
  })

  it('uses canonical Vibing action validation before renderer dispatch', async () => {
    const f = await fixture()
    const args = { directorNodeId: 'director', summary: 'Invalid relation', plan: { mode: 'amend', actions: [{ op: 'set_relation', id: 'relation', kind: 'distance', subjectRef: 'actor', targetRef: 'actor', distance: 2 }] } }
    await expect(f.approve('apply_vibing_director_plan', args)).rejects.toThrow()
    expect(f.requestRenderer).not.toHaveBeenCalled()
  })
})
