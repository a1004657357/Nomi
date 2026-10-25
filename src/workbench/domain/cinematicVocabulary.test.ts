import { describe, expect, it } from 'vitest'
import { ASSET_REVISION_STATUSES, SHOT_STATUSES } from './cinematicTypes'
import { assetRevisionStatusSchema, shotStatusSchema } from './cinematicSchema'
import { GENERATION_COLLECTION_ITEM_STATUSES, GENERATION_QUALITY_STATUSES } from '../generationCanvas/model/generationCanvasTypes'
import { generationResultCollectionItemSchema, generationResultCollectionSchema } from '../generationCanvas/model/generationCanvasSchema'

describe('cinematic and result vocabulary ownership', () => {
  it('keeps schemas on the actual domain status lists', () => {
    expect(shotStatusSchema.options).toBe(SHOT_STATUSES)
    expect(assetRevisionStatusSchema.options).toBe(ASSET_REVISION_STATUSES)
    expect(SHOT_STATUSES).toEqual(['draft', 'planned', 'asset-blocked', 'ready', 'generating', 'candidate-ready', 'evaluating', 'needs-revision', 'accepted', 'placed-on-timeline'])
    expect(ASSET_REVISION_STATUSES).toEqual(['candidate', 'selected', 'rejected', 'archived'])
    for (const state of SHOT_STATUSES) expect(shotStatusSchema.parse(state)).toBe(state)
    expect(shotStatusSchema.safeParse('submitted')).toMatchObject({ success: false })
  })
  it('preserves collection and review states independently of provider tasks', () => {
    expect(generationResultCollectionItemSchema.shape.status.options).toBe(GENERATION_COLLECTION_ITEM_STATUSES)
    expect(GENERATION_COLLECTION_ITEM_STATUSES).toEqual(['pending', 'running', 'success', 'error'])
    expect(GENERATION_QUALITY_STATUSES).toEqual(['pass', 'warning', 'fail', 'unavailable'])
    const quality = generationResultCollectionSchema.shape.quality.unwrap()
    expect(quality.shape.status.options).toBe(GENERATION_QUALITY_STATUSES)
    expect(quality.shape.checks.element.shape.status.options).toBe(GENERATION_QUALITY_STATUSES)
  })
})
