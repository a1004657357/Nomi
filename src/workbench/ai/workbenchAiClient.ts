import type { AgentAttachmentPayload, AgentsChatResponseDto } from '../../api/desktopClient'
import { getDesktopBridge } from '../../desktop/bridge'
import { runSingleShotAgent } from './agentLoopMode'
import type { ProjectAgentAttachmentClaim } from '../../../electron/shared/workbenchInput'

export type WorkbenchAiRequest = {
  prompt: string
  systemPrompt?: string
  displayPrompt: string
  sessionKey: string
  projectId?: string
  flowId?: string
  projectName?: string
  skillKey: string
  skillName: string
  playbookStageId?: string
  disableTools?: boolean
  mode?: 'agent' | 'chat' | 'refine' | 'auto'
  agentModelKey?: string
  agentVendorKey?: string
  attachments?: AgentAttachmentPayload[]
}
export type WorkbenchAiStreamHandlers = {
  onContent?: (delta: string, text: string) => void
  onCancelReady?: (cancel: () => void) => void
}
async function attachmentClaims(input: WorkbenchAiRequest): Promise<ProjectAgentAttachmentClaim[]> {
  if (!input.attachments?.length) return []
  const list = getDesktopBridge()?.assets.list
  if (!input.projectId || !list) throw new Error('agent_attachment_claim_required')
  const byUrl = new Map<string, string>()
  let cursor: string | null | undefined
  do {
    const page = await list({ projectId: input.projectId, limit: 500, cursor })
    for (const asset of page.items) {
      const data = asset.data as { url?: unknown } | undefined
      if (typeof data?.url === 'string') byUrl.set(data.url, asset.id)
    }
    if (!page.cursor || page.cursor === cursor) break
    cursor = page.cursor
  } while (cursor)
  return input.attachments.map(attachment => {
    const assetId = byUrl.get(attachment.url)
    if (!assetId) throw new Error('agent_attachment_claim_required')
    return { assetId, version: 1 }
  })
}

/** Custom structured planners use isolated lane calls, never the resident conversation or legacy chat IPC. */
export async function sendWorkbenchAiMessage(input: WorkbenchAiRequest, handlers: WorkbenchAiStreamHandlers): Promise<AgentsChatResponseDto> {
  const claims = await attachmentClaims(input)
  const response = await runSingleShotAgent({
    featureKey: input.sessionKey,
    prompt: input.prompt,
    displayPrompt: input.displayPrompt,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.agentModelKey && input.agentVendorKey ? { model: { modelKey: input.agentModelKey, vendorKey: input.agentVendorKey } } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments, attachmentClaims: claims } : {}),
    onCancelReady: handlers.onCancelReady,
  })
  if (response.text) handlers.onContent?.(response.text, response.text)
  return response
}
