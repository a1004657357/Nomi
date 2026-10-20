import { beforeEach, describe, expect, it, vi } from 'vitest'
const deps = vi.hoisted(() => ({ singleShot: vi.fn(), list: vi.fn() }))
vi.mock('./agentLoopMode', () => ({ runSingleShotAgent: deps.singleShot }))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => ({ assets: { list: deps.list } }) }))
import { sendWorkbenchAiMessage, type WorkbenchAiRequest } from './workbenchAiClient'
const input: WorkbenchAiRequest = { prompt: 'plan', displayPrompt: 'Plan', sessionKey: 'feature:director', projectId: 'project-A', skillKey: 'director', skillName: 'Director' }
describe('custom planners on Agent lane', () => {
  beforeEach(() => { vi.clearAllMocks(); deps.singleShot.mockResolvedValue({ text: '{"plan":{}}' }) })
  it('forwards system prompt, project identity and explicit model to isolated lane', async () => {
    const onContent = vi.fn()
    const onCancelReady = vi.fn()
    await sendWorkbenchAiMessage({ ...input, systemPrompt: 'constraints', agentModelKey: 'model', agentVendorKey: 'vendor' }, { onContent, onCancelReady })
    expect(deps.singleShot).toHaveBeenCalledWith(expect.objectContaining({ featureKey: input.sessionKey, projectId: 'project-A', systemPrompt: 'constraints', model: { modelKey: 'model', vendorKey: 'vendor' }, onCancelReady }))
    expect(onContent).toHaveBeenCalledWith('{"plan":{}}', '{"plan":{}}')
  })
  it('resolves attachments to main-owned asset claims across pages', async () => {
    deps.list.mockResolvedValueOnce({ items: [], cursor: 'page2' }).mockResolvedValueOnce({ items: [{ id: 'asset-1', data: { url: 'nomi-local://frame.png' } }], cursor: null })
    await sendWorkbenchAiMessage({ ...input, attachments: [{ url: 'nomi-local://frame.png', contentType: 'image/png', fileName: 'frame.png', kind: 'image' }] }, {})
    expect(deps.singleShot).toHaveBeenCalledWith(expect.objectContaining({ attachmentClaims: [{ assetId: 'asset-1', version: 1 }] }))
    expect(deps.list).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'project-A', cursor: 'page2' }))
  })
  it('fails closed before a model call when an attachment cannot be claimed', async () => {
    deps.list.mockResolvedValue({ items: [], cursor: null })
    await expect(sendWorkbenchAiMessage({ ...input, attachments: [{ url: 'https://example.invalid/frame.png', contentType: 'image/png', fileName: 'frame.png', kind: 'image' }] }, {})).rejects.toThrow('agent_attachment_claim_required')
    expect(deps.singleShot).not.toHaveBeenCalled()
  })
})
