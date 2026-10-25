import { describe, expect, it } from 'vitest'
import {
  assistantModelOptionLabel,
  assistantModelOptionValue,
  resolveAssistantModelSelection,
} from './assistantModelOptions'

const rows = [
  { vendorKey: 'zhipu', modelKey: 'glm-5.2', labelZh: 'GLM 5.2' },
  { vendorKey: 'relay-a', modelKey: 'deepseek-chat', labelZh: 'DeepSeek Chat' },
  { vendorKey: 'relay-b', modelKey: 'deepseek-chat', labelZh: 'DeepSeek Chat' },
]

describe('assistant model option identity', () => {
  it('uses vendor + model as the option value so same model id from different providers does not collide', () => {
    expect(assistantModelOptionValue(rows[1])).not.toBe(assistantModelOptionValue(rows[2]))
  })

  it('resolves old localStorage prefs that only effectively matched by modelKey', () => {
    expect(resolveAssistantModelSelection(rows, { vendorKey: '', modelKey: 'glm-5.2' })).toBe(
      assistantModelOptionValue(rows[0]),
    )
  })

  it('returns blank for stale prefs that are no longer in the catalog', () => {
    expect(resolveAssistantModelSelection(rows, { vendorKey: 'old', modelKey: 'missing' })).toBe('')
  })

  it('adds provider name only when duplicate model ids need disambiguation', () => {
    expect(assistantModelOptionLabel(rows[0], rows)).toBe('GLM 5.2')
    expect(assistantModelOptionLabel(rows[1], rows)).toBe('DeepSeek Chat · relay-a')
  })
})
