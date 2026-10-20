export type ToolCallEvent = {
  toolCallId: string
  toolName: string
  args: unknown
  confirm: (decision:
    | { ok: true; result?: unknown; effectiveArgs?: Record<string, unknown>; overridesDelta?: Record<string, unknown>; silent?: boolean; proposalId?: string }
    | { ok: false; message?: string; denied?: boolean }) => Promise<void>
}
