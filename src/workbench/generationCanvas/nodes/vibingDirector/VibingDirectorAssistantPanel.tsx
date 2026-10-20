import type { JSX } from 'react'
import React from 'react'
import { IconPlayerStopFilled, IconRobot, IconSend2 } from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../../../design'
import { cn } from '../../../../utils/cn'
import AssistantModelPicker from '../../../ai/AssistantModelPicker'
import { handleAiComposerKeyDown } from '../../../ai/aiComposerKeyboard'
import { AutoGrowTextarea } from '../../../ai/composer/AutoGrowTextarea'
import type { ToolCallEvent } from '../../../ai/workbenchAgentRunner'
import { isProjectExecutionContextCurrent, withProjectAction, type ProjectExecutionContext } from '../../../project/projectCanvasReadSurface'
import {
  preferredVibingDirectorAgentProtocol,
  rememberVibingDirectorStructuredProtocol,
  sendVibingDirectorAgentMessage,
} from './vibingDirectorAgentClient'
import {
  evaluateVibingDirectorToolCall,
  resolveVibingDirectorStructuredPlanWithRepair,
} from './vibingDirectorAgentProtocol'
import {
  formatVibingDirectorContext,
  type VibingDirectorPlan,
  type VibingDirectorPlanResult,
  type VibingDirectorState,
} from './vibingDirectorState'

type DirectorMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  error?: boolean
}

type PendingPlan = {
  project: ProjectExecutionContext
  toolCallId: string
  summary: string
  plan: VibingDirectorPlan
  confirm?: ToolCallEvent['confirm']
}

type VibingDirectorAssistantPanelProps = {
  directorNodeId: string
  state: VibingDirectorState
  applying?: boolean
  onApplyPlan: (plan: VibingDirectorPlan) => Promise<VibingDirectorPlanResult>
  onCancelBlender?: () => void
}

function messageId(): string {
  return `vibing-director-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function planActionLabel(action: VibingDirectorPlan['actions'][number]): string {
  switch (action.op) {
    case 'set_stage': return `设置场景：${action.preset}`
    case 'set_blocking_layout': return `整理摆位：${action.template}`
    case 'place_asset': return `摆放资产：${action.name}`
    case 'add_marker': return `添加走位标记：${action.name}`
    case 'move_object': return `调整对象：${action.objectRef}`
    case 'remove_object': return `移除对象：${action.objectRef}`
    case 'set_relation': return `设置关系：${action.id}`
    case 'remove_relation': return `移除关系：${action.relationRef}`
    case 'set_camera': return `调整机位：${action.name || action.cameraRef || '导演相机'}`
    case 'set_camera_path': return `设置运镜：${action.cameraRef || '导演相机'}`
    case 'set_beat': return `更新节拍：${action.title}`
  }
}

function isNativeToolTransportError(error: unknown): boolean {
  const detail = error instanceof Error && error.message ? error.message : String(error)
  return /HTTP 400|API 调用参数有误|function call|工具请求被拒绝/i.test(detail)
}

export default function VibingDirectorAssistantPanel({
  directorNodeId,
  state,
  applying = false,
  onApplyPlan,
  onCancelBlender,
}: VibingDirectorAssistantPanelProps): JSX.Element {
  const [draft, setDraft] = React.useState('')
  const [messages, setMessages] = React.useState<DirectorMessage[]>([])
  const [busy, setBusy] = React.useState(false)
  const [pendingPlan, setPendingPlan] = React.useState<PendingPlan | null>(null)
  const cancelRef = React.useRef<(() => void) | null>(null)
  const stateRef = React.useRef(state)

  React.useEffect(() => {
    stateRef.current = state
  }, [state])

  const updateMessage = React.useCallback((id: string, patch: Partial<DirectorMessage>) => {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, ...patch } : message))
  }, [])

  const queuePlan = React.useCallback((request: { summary: string; plan: VibingDirectorPlan }, project: ProjectExecutionContext, confirm?: ToolCallEvent['confirm']) => {
    project.assertCurrent()
    setPendingPlan({
      project,
      toolCallId: `director-plan-${messageId()}`,
      summary: request.summary,
      plan: request.plan,
      confirm,
    })
  }, [])

  const submit = React.useCallback((message: string) => withProjectAction(project => {
    project.assertCurrent()
    const text = message.trim()
    if (!text || busy || applying) return
    const userId = messageId()
    const assistantId = messageId()
    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '处理中...', pending: true },
    ])
    setDraft('')
    setBusy(true)
    const initialProtocol = preferredVibingDirectorAgentProtocol()

    void (async () => {
      let streamed = ''
      let inspected = false
      const resolveStructuredResponse = async (
        responseText: string,
        failurePrefix = '',
      ): Promise<{ summary: string; plan: VibingDirectorPlan } | null> => {
        const outcome = await resolveVibingDirectorStructuredPlanWithRepair({
          initialText: responseText,
          directorNodeId,
          state: stateRef.current,
          originalMessage: text,
          onRepairStart: (firstFailure) => {
            project.assertCurrent()
            updateMessage(assistantId, {
              content: `${failurePrefix}兼容协议响应不可执行：${firstFailure}\n正在自动修复一次…`,
              pending: true,
              error: false,
            })
          },
          repair: async (repairMessage) => {
            const repair = await sendVibingDirectorAgentMessage({
              project,
              directorNodeId,
              state: stateRef.current,
              message: repairMessage,
              protocol: 'structured-text',
              onCancelReady: (cancel) => {
                cancelRef.current = cancel
              },
            })
            project.assertCurrent()
            return repair.response.text
          },
        })
        project.assertCurrent()
        const { resolution } = outcome
        if (!resolution.ok) {
          updateMessage(assistantId, {
            content: `Director Agent 执行失败：${failurePrefix}${resolution.message}`,
            pending: false,
            error: true,
          })
          return null
        }
        return resolution.request
      }

      try {
        const result = await sendVibingDirectorAgentMessage({
          project,
          directorNodeId,
          state: stateRef.current,
          message: text,
          protocol: initialProtocol,
          onContent: (delta) => {
            streamed += delta
            updateMessage(assistantId, { content: streamed, pending: false })
          },
          onCancelReady: (cancel) => {
            cancelRef.current = cancel
          },
          onToolCall: (event) => {
            project.assertCurrent()
            const evaluation = evaluateVibingDirectorToolCall({
              toolName: event.toolName,
              args: event.args,
              directorNodeId,
              state: stateRef.current,
              inspected,
            })
            inspected = evaluation.inspected
            if (evaluation.kind === 'read') {
              void event.confirm({
                ok: true,
                result: formatVibingDirectorContext(directorNodeId, stateRef.current),
                silent: true,
              })
              return
            }
            if (evaluation.kind === 'reject') {
              void event.confirm({ ok: false, message: evaluation.message, denied: true })
              return
            }
            queuePlan(evaluation.request, project, event.confirm)
          },
        })
        project.assertCurrent()
        if (initialProtocol === 'structured-text') {
          const request = await resolveStructuredResponse(result.response.text)
          project.assertCurrent()
          if (!request) return
          queuePlan(request, project)
          updateMessage(assistantId, {
            content: `${request.summary}\n\n已生成 Blender 导演计划，等待确认。`,
            pending: false,
          })
          return
        }
        const finalText = result.response.text.trim()
        updateMessage(assistantId, {
          content: streamed || finalText || '已提交 Blender 导演计划，等待确认。',
          pending: false,
        })
      } catch (error: unknown) {
        if (!isProjectExecutionContextCurrent(project)) return
        const detail = error instanceof Error && error.message ? error.message : String(error)
        if (initialProtocol !== 'tools' || !isNativeToolTransportError(error)) {
          updateMessage(assistantId, { content: `Director Agent 执行失败：${detail}`, pending: false, error: true })
          return
        }
        // This provider/model has already rejected the native tool envelope. Persist the
        // compatibility choice before retrying so a malformed fallback response cannot
        // make every later message repeat the rejected native request.
        rememberVibingDirectorStructuredProtocol()
        updateMessage(assistantId, {
          content: '当前模型不兼容 Nomi 原生 Function Call；已为该模型启用兼容协议，正在重试…',
          pending: true,
        })
        try {
          const fallback = await sendVibingDirectorAgentMessage({
            project,
            directorNodeId,
            state: stateRef.current,
            message: text,
            protocol: 'structured-text',
            onCancelReady: (cancel) => {
              cancelRef.current = cancel
            },
          })
          project.assertCurrent()
          const request = await resolveStructuredResponse(fallback.response.text, '原生工具请求被拒绝；')
          project.assertCurrent()
          if (!request) return
          queuePlan(request, project)
          updateMessage(assistantId, {
            content: `${request.summary}\n\n已生成 Blender 导演计划，等待确认。`,
            pending: false,
          })
        } catch (fallbackError: unknown) {
          if (!isProjectExecutionContextCurrent(project)) return
          const fallbackDetail = fallbackError instanceof Error && fallbackError.message ? fallbackError.message : String(fallbackError)
          updateMessage(assistantId, {
            content: `Director Agent 执行失败：原生工具请求被拒绝；兼容协议也未完成（${fallbackDetail}）`,
            pending: false,
            error: true,
          })
        }
      } finally {
        if (isProjectExecutionContextCurrent(project)) {
          setBusy(false)
          cancelRef.current = null
        }
      }
    })()
  }), [applying, busy, directorNodeId, queuePlan, updateMessage])

  const approvePendingPlan = React.useCallback(() => withProjectAction(async project => {
    const pending = pendingPlan
    if (!pending || applying) return
    setPendingPlan(null)
    try {
      pending.project.assertCurrent()
      project.assertCurrent()
      const result = await onApplyPlan(pending.plan)
      pending.project.assertCurrent()
      project.assertCurrent()
      if (pending.confirm) {
        await pending.confirm({
          ok: true,
          result: {
            backend: 'blender',
            applied: result.applied,
            rejected: result.rejected,
            objectCount: result.state.objects.length,
            beatCount: result.state.beats.length,
            previewReady: Boolean(result.state.output?.previewUrl),
          },
        })
        project.assertCurrent()
      }
      setMessages((current) => [...current, {
        id: messageId(),
        role: 'assistant',
        content: result.rejected.length
          ? `Blender 已回传，但有 ${result.rejected.length} 项未应用。`
          : 'Blender 已完成场景更新并回传预览。',
      }])
    } catch (error: unknown) {
      if (!isProjectExecutionContextCurrent(project) || !isProjectExecutionContextCurrent(pending.project)) return
      const message = error instanceof Error ? error.message : String(error)
      if (pending.confirm) await pending.confirm({ ok: false, message })
      project.assertCurrent()
      setMessages((current) => [...current, {
        id: messageId(),
        role: 'assistant',
        content: `Blender 导演计划未执行：${message}`,
        error: true,
      }])
    }
  }), [applying, onApplyPlan, pendingPlan])

  const rejectPendingPlan = React.useCallback(() => {
    const pending = pendingPlan
    if (!pending || applying) return
    setPendingPlan(null)
    if (pending.confirm) void pending.confirm({ ok: false, message: '用户没有确认这次 Blender 导演计划' })
  }, [applying, pendingPlan])

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--workbench-surface-solid)]" aria-label="VIBING Director Agent">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--workbench-border)] px-3 py-2">
        <IconRobot size={16} className="text-[var(--workbench-muted)]" />
        <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-[var(--workbench-ink)]">Director Agent</span>
        <AssistantModelPicker className="h-7 max-w-[150px]" />
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="text-caption leading-5 text-[var(--workbench-muted)]">描述要在 Blender 中搭建的场景、人物调度或机位。</div>
        ) : messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              'whitespace-pre-wrap rounded-nomi px-2.5 py-2 text-caption leading-5',
              message.role === 'user'
                ? 'ml-5 bg-[var(--nomi-ink)] text-[var(--nomi-paper)]'
                : 'mr-3 bg-[var(--nomi-ink-05)] text-[var(--workbench-ink)]',
              message.error && 'bg-workbench-danger-soft text-workbench-danger',
            )}
          >
            {message.content}
          </div>
        ))}

        {pendingPlan ? (
          <div className="space-y-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2.5 shadow-nomi-sm">
            <div className="text-caption font-medium text-[var(--workbench-ink)]">{pendingPlan.summary}</div>
            <ul className="m-0 space-y-1 p-0 text-micro leading-4 text-[var(--workbench-muted)]">
              {pendingPlan.plan.actions.map((action, index) => <li key={`${action.op}-${index}`}>- {planActionLabel(action)}</li>)}
            </ul>
            <div className="flex items-center justify-end gap-1.5">
              <button
                className="rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-transparent px-2 py-1 text-micro text-[var(--workbench-muted)] hover:bg-[var(--nomi-ink-05)] disabled:opacity-40"
                type="button"
                disabled={applying}
                onClick={rejectPendingPlan}
              >
                跳过
              </button>
              <button
                className="rounded-nomi-sm border border-transparent bg-[var(--nomi-ink)] px-2 py-1 text-micro text-[var(--nomi-paper)] hover:bg-[var(--nomi-accent)] disabled:opacity-40"
                type="button"
                disabled={applying}
                onClick={() => { void approvePendingPlan() }}
              >
                {applying ? '正在执行 Blender…' : '应用到 Blender'}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="shrink-0 border-t border-[var(--workbench-border)] p-2"
        onSubmit={(event) => {
          event.preventDefault()
          submit(draft)
        }}
      >
        <AutoGrowTextarea
          className="min-h-16 w-full rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-2 py-2 text-caption leading-5 text-[var(--workbench-ink)] placeholder:text-[var(--workbench-muted)]"
          aria-label="向 Director Agent 发送消息"
          placeholder="例如：搭一个雨后街道开场，两位角色在门口相遇，镜头缓慢推进。"
          value={draft}
          disabled={busy || applying}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => handleAiComposerKeyDown(event, () => event.currentTarget.form?.requestSubmit())}
        />
        <div className="mt-2 flex justify-end">
          {applying ? (
            <WorkbenchIconButton
              type="button"
              className="grid size-7 place-items-center rounded-full border-0 bg-[var(--nomi-ink)] text-[var(--nomi-paper)] hover:bg-[var(--nomi-accent)]"
              label="停止 Blender 导演计划"
              onClick={onCancelBlender}
              icon={<IconPlayerStopFilled size={13} />}
            />
          ) : busy ? (
            <WorkbenchIconButton
              type="button"
              className="grid size-7 place-items-center rounded-full border-0 bg-[var(--nomi-ink)] text-[var(--nomi-paper)] hover:bg-[var(--nomi-accent)]"
              label="停止 Director Agent"
              onClick={() => cancelRef.current?.()}
              icon={<IconPlayerStopFilled size={13} />}
            />
          ) : (
            <WorkbenchIconButton
              type="submit"
              className="grid size-7 place-items-center rounded-full border-0 bg-[var(--nomi-ink)] text-[var(--nomi-paper)] hover:bg-[var(--nomi-accent)] disabled:cursor-not-allowed disabled:bg-[var(--nomi-ink-05)]"
              disabled={!draft.trim()}
              label="发送给 Director Agent"
              icon={<IconSend2 size={15} />}
            />
          )}
        </div>
      </form>
    </section>
  )
}
