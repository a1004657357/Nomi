import { describe, expect, it } from 'vitest'
import { batchSpendGrantTtlMs } from './spendConfirm'

describe('batchSpendGrantTtlMs', () => {
  it('keeps small batches at 30 minutes', () => {
    expect(batchSpendGrantTtlMs(1)).toBe(30 * 60_000)
  })

  it('covers a serial 18-node Codex batch without exceeding four hours', () => {
    expect(batchSpendGrantTtlMs(18)).toBe(213 * 60_000)
    expect(batchSpendGrantTtlMs(999)).toBe(4 * 60 * 60_000)
  })
})
