import { describe, expect, it } from 'vitest'
import { buildCustomTextModelUpsert } from './customVendorTextModel'

describe('buildCustomTextModelUpsert', () => {
  it('trims vendor and model id, then creates an enabled text model payload', () => {
    expect(buildCustomTextModelUpsert(' relay ', ' glm-5.2 ')).toEqual({
      vendorKey: 'relay',
      modelKey: 'glm-5.2',
      kind: 'text',
      enabled: true,
    })
  })

  it('rejects blank model ids or missing vendor keys', () => {
    expect(buildCustomTextModelUpsert('relay', '  ')).toBeNull()
    expect(buildCustomTextModelUpsert(' ', 'glm-5.2')).toBeNull()
  })
})
