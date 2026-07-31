import {
  applyVibingDirectorPlan,
  type VibingDirectorState,
} from './vibingDirectorState'
import {
  parseVibingDirectorPlanRequest,
  parseVibingDirectorStructuredPlanResponse,
  type VibingDirectorPlanRequest,
} from './vibingDirectorStructuredProtocol'

export type VibingDirectorStructuredPlanFailureCode =
  | 'no_json'
  | 'explanation_only'
  | 'missing_node_id'
  | 'wrong_node_id'
  | 'invalid_plan'
  | 'preflight_rejected'

export type VibingDirectorStructuredPlanResolution =
  | { ok: true; request: VibingDirectorPlanRequest }
  | { ok: false; code: VibingDirectorStructuredPlanFailureCode; message: string }

export type VibingDirectorToolCallEvaluation =
  | { kind: 'read'; inspected: true }
  | { kind: 'apply'; inspected: true; request: VibingDirectorPlanRequest }
  | { kind: 'reject'; inspected: boolean; message: string }

export function buildVibingDirectorStructuredRepairMessage(input: {
  directorNodeId: string
  originalMessage: string
  failure: string
}): string {
  return [
    '上一条兼容协议响应无法执行，请修复后重新提交完整计划。',
    `当前 Director 节点 id：${input.directorNodeId}`,
    `失败原因：${input.failure.trim().slice(0, 1200)}`,
    `原始请求：${input.originalMessage.trim().slice(0, 2400)}`,
    '必须基于当前状态重新检查对象 id；新增对象要先 add_marker/place_asset，再引用它。',
    '只返回一个 JSON 对象，不要解释、不要 Markdown、不要代码块。',
  ].join('\n')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function preflightRequest(
  request: VibingDirectorPlanRequest,
  state: VibingDirectorState,
): VibingDirectorStructuredPlanResolution {
  const preflight = applyVibingDirectorPlan(state, request.plan)
  if (preflight.rejected.length) {
    return {
      ok: false,
      code: 'preflight_rejected',
      message: `计划与当前 Blender 状态不一致：${preflight.rejected.join('；')}`,
    }
  }
  return { ok: true, request }
}

export function resolveVibingDirectorStructuredPlan(
  text: string,
  directorNodeId: string,
  state: VibingDirectorState,
): VibingDirectorStructuredPlanResolution {
  const raw = parseVibingDirectorStructuredPlanResponse(text)
  if (raw === null) {
    return {
      ok: false,
      code: 'no_json',
      message: '兼容协议没有返回可解析的 JSON 对象。',
    }
  }
  const record = asRecord(raw)
  if (!record) {
    return {
      ok: false,
      code: 'invalid_plan',
      message: '兼容协议返回了 JSON，但顶层不是 Blender 导演计划对象。',
    }
  }
  if (
    record.directorNodeId === undefined
    && ['answer', 'content', 'result', 'data'].some((key) => typeof record[key] === 'string')
  ) {
    return {
      ok: false,
      code: 'explanation_only',
      message: '当前模型只返回了解释文本，没有返回可执行的 Blender 导演 JSON 计划。',
    }
  }
  if (typeof record.directorNodeId !== 'string' || !record.directorNodeId.trim()) {
    return {
      ok: false,
      code: 'missing_node_id',
      message: 'Blender 导演计划缺少当前 Director 节点 id。',
    }
  }
  if (record.directorNodeId !== directorNodeId) {
    return {
      ok: false,
      code: 'wrong_node_id',
      message: `Blender 导演计划目标是「${record.directorNodeId}」，当前节点是「${directorNodeId}」。`,
    }
  }
  const request = parseVibingDirectorPlanRequest(record)
  if (!request) {
    return {
      ok: false,
      code: 'invalid_plan',
      message: 'JSON 已返回，但包含不支持的操作、缺少必填字段或字段类型不正确。',
    }
  }
  return preflightRequest(request, state)
}

export async function resolveVibingDirectorStructuredPlanWithRepair(input: {
  initialText: string
  directorNodeId: string
  state: VibingDirectorState
  originalMessage: string
  repair: (message: string) => Promise<string>
  onRepairStart?: (failure: string) => void
}): Promise<{
  resolution: VibingDirectorStructuredPlanResolution
  repaired: boolean
  firstFailure?: string
}> {
  const initial = resolveVibingDirectorStructuredPlan(input.initialText, input.directorNodeId, input.state)
  if (initial.ok) return { resolution: initial, repaired: false }
  input.onRepairStart?.(initial.message)
  const repairedText = await input.repair(buildVibingDirectorStructuredRepairMessage({
    directorNodeId: input.directorNodeId,
    originalMessage: input.originalMessage,
    failure: initial.message,
  }))
  return {
    resolution: resolveVibingDirectorStructuredPlan(repairedText, input.directorNodeId, input.state),
    repaired: true,
    firstFailure: initial.message,
  }
}

export function evaluateVibingDirectorToolCall(input: {
  toolName: string
  args: unknown
  directorNodeId: string
  state: VibingDirectorState
  inspected: boolean
}): VibingDirectorToolCallEvaluation {
  if (input.toolName === 'read_vibing_director') {
    const args = asRecord(input.args)
    const requestedNodeId = typeof args?.directorNodeId === 'string' ? args.directorNodeId : ''
    if (requestedNodeId !== input.directorNodeId) {
      return {
        kind: 'reject',
        inspected: input.inspected,
        message: requestedNodeId
          ? `读取目标「${requestedNodeId}」不是当前 Director 节点「${input.directorNodeId}」。`
          : '读取当前 Director 前必须提供 directorNodeId。',
      }
    }
    return { kind: 'read', inspected: true }
  }

  if (input.toolName !== 'apply_vibing_director_plan') {
    return {
      kind: 'reject',
      inspected: input.inspected,
      message: `VIBING Director 不支持操作「${input.toolName}」。`,
    }
  }

  if (!input.inspected) {
    return {
      kind: 'reject',
      inspected: false,
      message: '修改 Blender 场景前必须先读取当前 Director 状态，请先调用 read_vibing_director。',
    }
  }

  const request = parseVibingDirectorPlanRequest(input.args)
  if (!request) {
    return {
      kind: 'reject',
      inspected: true,
      message: 'Blender 导演计划包含不支持的操作、缺少必填字段或字段类型不正确。',
    }
  }
  if (request.directorNodeId !== input.directorNodeId) {
    return {
      kind: 'reject',
      inspected: true,
      message: `Blender 导演计划目标是「${request.directorNodeId}」，当前节点是「${input.directorNodeId}」。`,
    }
  }
  const preflight = preflightRequest(request, input.state)
  return preflight.ok
    ? { kind: 'apply', inspected: true, request: preflight.request }
    : { kind: 'reject', inspected: true, message: preflight.message }
}
