import { describe, expect, it } from 'vitest'
import type { ModelCatalogModelDto } from '../workbench/api/modelCatalogApi'
import { filterCatalogModelsByEnabledVendors } from './modelCatalogCache'

function model(vendorKey: string, modelKey: string): ModelCatalogModelDto {
  return {
    vendorKey,
    modelKey,
    labelZh: modelKey,
    kind: 'image',
    enabled: true,
    createdAt: '',
    updatedAt: '',
  }
}

describe('filterCatalogModelsByEnabledVendors', () => {
  const rows = [
    model('apimart', 'image-model'),
    model('kie', 'happyhorse'),
    model('runninghub', 'hunyuan3d'),
  ]

  it('does not expose seeded models when no vendor is connected', () => {
    expect(filterCatalogModelsByEnabledVendors(rows, new Set())).toEqual([])
  })

  it('keeps only models whose vendor is currently usable', () => {
    expect(filterCatalogModelsByEnabledVendors(rows, new Set(['apimart']))).toEqual([rows[0]])
  })

  it('matches normalized vendor keys', () => {
    expect(filterCatalogModelsByEnabledVendors(rows, new Set(['kie']))).toEqual([rows[1]])
  })
})
