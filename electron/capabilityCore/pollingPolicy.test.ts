import { describe, expect, it } from 'vitest'
import { resolveCapabilityPollIntervalMs, resolveCapabilityPollTimeoutMs } from './pollingPolicy'

describe('capability polling vendor identity', () => {
  it.each(['agnes', 'agnes--second-account'])('retains the video throttle for %s', (key) => {
    expect(resolveCapabilityPollIntervalMs('image_to_video', key)).toBe(15_000)
    expect(resolveCapabilityPollIntervalMs('text_to_video', key)).toBe(15_000)
    expect(resolveCapabilityPollIntervalMs('text_to_image', key)).toBe(1_500)
  })
  it('does not classify an unrelated or merely similarly named provider as Agnes', () => {
    expect(resolveCapabilityPollIntervalMs('image_to_video', 'agnes-copy')).toBe(3_000)
    expect(resolveCapabilityPollTimeoutMs('image_to_video', '42')).toBe(42)
    expect(resolveCapabilityPollTimeoutMs('image_to_video', undefined)).toBe(900_000)
  })
})
