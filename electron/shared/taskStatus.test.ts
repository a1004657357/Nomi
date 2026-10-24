import { describe, expect, expectTypeOf, it } from 'vitest'
import type { GenerationProviderTaskState } from '../capabilityCore/generationRuntimeAdapter'
import { resolveTaskStatus } from '../tasks/responseParsing'
import { classifyUpstreamTaskStatus, isTerminalTaskStatus, KNOWN_TASK_STATUSES, TASK_STATUSES, type TaskStatus } from './taskStatus'

describe('task lifecycle shared vocabulary', () => {
  it('uses the existing provider type without dropping cancellation or unknown', () => {
    expectTypeOf<TaskStatus>().toEqualTypeOf<GenerationProviderTaskState>()
    expect(TASK_STATUSES).toEqual(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown'])
    expect(KNOWN_TASK_STATUSES).toEqual(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
    for (const word of ['cancel', 'cancelled', 'canceled']) {
      expect(classifyUpstreamTaskStatus(word)).toBe('cancelled')
      expect(isTerminalTaskStatus(classifyUpstreamTaskStatus(word))).toBe(true)
    }
    for (const value of [null, undefined, '', 'unknown', 'unsupported', 'queued', 'running']) expect(isTerminalTaskStatus(value)).toBe(false)
  })
  it('keeps explicit cancellation mappings and preserves unknown provider evidence', () => {
    expect(resolveTaskStatus({ status: 'ABORTED_BY_USER' }, null, { cancelled: ['ABORTED_BY_USER'] }, []))
      .toEqual({ status: 'cancelled', unrecognizedStatus: '' })
    expect(resolveTaskStatus({ status: 'new-provider-word' }, null, {}, []))
      .toEqual({ status: 'queued', unrecognizedStatus: 'new-provider-word' })
  })
})
