import { describe, expect, it } from 'vitest'
import { resolveCatalogTaskPollingPolicy } from './catalogTaskPollingPolicy'

describe('catalog task polling policy', () => {
  it.each(['image_to_3d', 'text_to_3d', 'image_to_video', 'text_to_video'] as const)(
    'keeps long-running %s tasks recoverable for the extended provider window',
    (kind) => {
      expect(resolveCatalogTaskPollingPolicy(kind)).toEqual({
        softTimeoutMs: 300_000,
        hardTimeoutMs: 1_200_000,
      })
    },
  )

  it('keeps ordinary image tasks on the short polling window', () => {
    expect(resolveCatalogTaskPollingPolicy('text_to_image')).toEqual({
      softTimeoutMs: 120_000,
      hardTimeoutMs: 120_000,
    })
  })

  it.each(['text_to_image', 'image_edit'] as const)(
    'allows JiMeng Web %s tasks to finish four-image original recovery',
    (kind) => {
      expect(resolveCatalogTaskPollingPolicy(kind, 'jimeng-web')).toEqual({
        softTimeoutMs: 300_000,
        hardTimeoutMs: 1_800_000,
      })
    },
  )

  it.each(['text_to_video', 'image_to_video'] as const)(
    'keeps Pavo Web %s tasks query-only for up to one hour',
    (kind) => {
      expect(resolveCatalogTaskPollingPolicy(kind, 'pavo-web')).toEqual({
        softTimeoutMs: 600_000,
        hardTimeoutMs: 3_600_000,
      })
    },
  )
})
