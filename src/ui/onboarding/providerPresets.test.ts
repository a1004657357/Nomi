import { describe, expect, it } from 'vitest'
import { PROVIDER_PRESETS } from './providerPresets'

function preset(id: string) {
  const found = PROVIDER_PRESETS.find(item => item.id === id)
  if (!found) throw new Error(`missing provider preset: ${id}`)
  return found
}

describe('subscription provider presets', () => {
  it('keeps Volcengine Agent Plan separate from the pay-as-you-go API', () => {
    const plan = preset('volcengine-agent-plan')
    const metered = preset('volcengine')

    expect(plan.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/plan/v3')
    expect(plan.providerKind).toBe('openai-compatible')
    expect(plan.models?.map(model => model.id)).toContain('doubao-seed-2.0-lite')
    expect(metered.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3')
  })

  it('keeps Kimi Code membership separate from the Moonshot open platform', () => {
    const code = preset('kimi-code')
    const platform = preset('kimi')

    expect(code.baseUrl).toBe('https://api.kimi.com/coding/v1')
    expect(code.providerKind).toBe('openai-compatible')
    expect(code.models?.map(model => model.id)).toEqual([
      'k3',
      'k3-256k',
      'kimi-for-coding',
      'kimi-for-coding-highspeed',
    ])
    expect(platform.baseUrl).toBe('https://api.moonshot.cn/v1')
  })
})
