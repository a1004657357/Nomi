/**
 * Slice 2 测试：PlanShot ↔ ShotSpecV1 适配层。
 *
 * 验收（Gate 1 Slice 2）：
 * - 旧扁平字段正确派生进 ShotSpec 子对象（shotSize→shotScale、cameraMove→cameraMotion.type 等）。
 * - anchorIds 经锚类型翻译成带 role 的 references（无裸图片数组）。
 * - 旧项目（仅扁平字段、无锚定义）不抛错（无损打开前提）。
 * - round-trip：planShotToShotSpec → mergeShotSpecIntoPlanShot 不丢扁平字段。
 * - ShotSpec 通过 cinematicSchema parse（与 Slice 1 schema 对齐）。
 */
import { describe, expect, it } from 'vitest'
import { parseStoryboardPlan, type PlanAnchor, type PlanShot, type StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import { shotSpecSchema } from './cinematicSchema'
import { readShotSpec, readStoryboardAsShotSpecs } from './shotSpecReaders'
import {
  mergeShotSpecIntoPlanShot,
  migrateStoryboardPlanShots,
  planShotToShotSpec,
  shotSpecIdFromIndex,
} from './shotSpecMigration'

function makeAnchor(overrides: Partial<PlanAnchor> = {}): PlanAnchor {
  return {
    id: 'a1',
    kind: 'character',
    name: '林夏',
    description: '主角',
    carrier: 'visual',
    scope: 'selective',
    ...overrides,
  }
}

function makeShot(overrides: Partial<PlanShot> = {}): PlanShot {
  return {
    index: 1,
    shotKind: 'video',
    durationSec: 5,
    anchorIds: [],
    prompt: '林夏站在天台',
    scene: '天台',
    shotSize: '中景',
    cameraAngle: '过肩',
    cameraMove: '推',
    characters: '林夏',
    performance: '转身',
    dialogue: '你来了',
    props: '电话',
    sound: '风声',
    notes: '夜戏',
    ...overrides,
  }
}

describe('planShotToShotSpec — 扁平字段 → ShotSpec 子对象', () => {
  it('projects supplier and variant independently for same-name models', () => {
    for (const vendor of ['apimart', 'kie']) {
      const source = makeShot({ modelKey: 'shared-model', modelVendor: vendor, variantId: 'fast' })
      const strategy = planShotToShotSpec(source, 'p', new Map()).generationStrategy
      expect(strategy).toMatchObject({ modelKey: 'shared-model', vendorKey: vendor, variantId: 'fast' })
      expect(strategy.providerId).toBeUndefined()
      expect(mergeShotSpecIntoPlanShot(makeShot(), planShotToShotSpec(source, 'p', new Map())))
        .toMatchObject({ modelKey: 'shared-model', modelVendor: vendor, variantId: 'fast' })
    }
  })

  it('reads historical plans without treating a variant as a supplier', () => {
    const plan = parseStoryboardPlan({ title: 'legacy', anchors: [], shots: [makeShot({ modelKey: 'shared-model', variantId: 'vip' })] })
    const strategy = readShotSpec(1, plan, [], 'p')!.spec.generationStrategy
    expect(strategy).toMatchObject({ modelKey: 'shared-model', variantId: 'vip' })
    expect(strategy.vendorKey).toBeUndefined()
    expect(strategy.providerId).toBeUndefined()
    expect(readStoryboardAsShotSpecs(plan, [], 'p')[0].spec.generationStrategy).toEqual(strategy)
    expect(plan.shots[0]).not.toHaveProperty('modelVendor')
  })

  it('does not attach an old supplier or variant when a strategy changes the model', () => {
    const old = makeShot({ modelKey: 'old-model', modelVendor: 'old-vendor', variantId: 'old-variant' })
    const spec = planShotToShotSpec(makeShot({ modelKey: 'new-model' }), 'p', new Map())
    spec.generationStrategy.providerId = 'legacy-ambiguous-value'
    const merged = mergeShotSpecIntoPlanShot(old, spec)
    expect(merged.modelKey).toBe('new-model')
    expect(merged.modelVendor).toBeUndefined()
    expect(merged.variantId).toBeUndefined()
  })

  it('derives cinematography from shotSize/cameraAngle/cameraMove', () => {
    const spec = planShotToShotSpec(makeShot(), 'proj-1', new Map())
    expect(spec.cinematography.shotScale).toBe('中景')
    expect(spec.cinematography.cameraAngle).toBe('过肩')
    expect(spec.cinematography.cameraMotion.type).toBe('推')
  })

  it('derives subjects from characters/performance/dialogue (primary + secondary split)', () => {
    const spec = planShotToShotSpec(
      makeShot({ characters: '林夏，反派' }),
      'proj-1',
      new Map(),
    )
    expect(spec.subjects).toHaveLength(2)
    expect(spec.subjects[0].role).toBe('primary')
    expect(spec.subjects[0].performance).toBe('转身')
    expect(spec.subjects[1].role).toBe('secondary')
  })

  it('derives time.durationSeconds from shotKind (image=0, video=durationSec)', () => {
    const videoSpec = planShotToShotSpec(makeShot({ shotKind: 'video', durationSec: 7 }), 'p', new Map())
    expect(videoSpec.time.durationSeconds).toBe(7)
    const imageSpec = planShotToShotSpec(makeShot({ shotKind: 'image', durationSec: 7 }), 'p', new Map())
    expect(imageSpec.time.durationSeconds).toBe(0)
  })

  it('translates anchorIds into references with roles via anchor kind', () => {
    const anchors = new Map<string, PlanAnchor>([
      ['a-char', makeAnchor({ id: 'a-char', kind: 'character' })],
      ['a-scene', makeAnchor({ id: 'a-scene', kind: 'scene' })],
      ['a-prop', makeAnchor({ id: 'a-prop', kind: 'prop' })],
    ])
    const spec = planShotToShotSpec(
      makeShot({ anchorIds: ['a-char', 'a-scene', 'a-prop'] }),
      'p',
      anchors,
    )
    expect(spec.references).toEqual([
      { assetId: 'a-char', role: 'character_ref', required: false },
      { assetId: 'a-scene', role: 'style_ref', required: false },
      { assetId: 'a-prop', role: 'reference', required: false },
    ])
  })

  it('degrades unknown anchorId to reference role (no naked array, no throw)', () => {
    const spec = planShotToShotSpec(
      makeShot({ anchorIds: ['ghost-id'] }),
      'p',
      new Map(), // 无锚定义
    )
    expect(spec.references).toEqual([{ assetId: 'ghost-id', role: 'reference', required: false }])
  })

  it('infers generation mode by §15.4 rules', () => {
    expect(
      planShotToShotSpec(makeShot({ shotKind: 'image', anchorIds: [] }), 'p', new Map())
        .generationStrategy.mode,
    ).toBe('text-to-image')
    expect(
      planShotToShotSpec(makeShot({ shotKind: 'image', anchorIds: ['a'] }), 'p', new Map())
        .generationStrategy.mode,
    ).toBe('image-to-image')
    expect(
      planShotToShotSpec(makeShot({ shotKind: 'video', anchorIds: [] }), 'p', new Map())
        .generationStrategy.mode,
    ).toBe('text-to-video')
    expect(
      planShotToShotSpec(makeShot({ shotKind: 'video', keyframe: { enabled: true } }), 'p', new Map())
        .generationStrategy.mode,
    ).toBe('first-frame')
    expect(
      planShotToShotSpec(makeShot({ shotKind: 'video', anchorIds: ['a'] }), 'p', new Map())
        .generationStrategy.mode,
    ).toBe('omni-reference')
  })
})

describe('planShotToShotSpec — 迁移期安全性', () => {
  it('old project: minimal PlanShot (only index/durationSec/anchorIds/prompt) does not throw', () => {
    const minimal: PlanShot = { index: 3, durationSec: 0, anchorIds: [], prompt: 'x' }
    const spec = planShotToShotSpec(minimal, 'proj-old', new Map())
    expect(spec.id).toBe(shotSpecIdFromIndex(3, 'proj-old'))
    expect(spec.status).toBe('draft')
    expect(spec.subjects).toEqual([])
    expect(spec.references).toEqual([])
  })

  it('ShotSpec output passes cinematicSchema parse (Slice 1 schema alignment)', () => {
    const spec = planShotToShotSpec(makeShot(), 'proj-1', new Map())
    expect(() => shotSpecSchema.parse(spec)).not.toThrow()
  })
})

describe('mergeShotSpecIntoPlanShot — round-trip 守恒', () => {
  it('ShotSpec edits flow back to PlanShot flat fields without losing originals', () => {
    const original = makeShot()
    const spec = planShotToShotSpec(original, 'p', new Map())
    // 用户在 ShotSpec 视图改了 shotScale
    const editedSpec: typeof spec = {
      ...spec,
      cinematography: { ...spec.cinematography, shotScale: '特写' },
    }
    const merged = mergeShotSpecIntoPlanShot(original, editedSpec)
    expect(merged.shotSize).toBe('特写') // 改动回流
    expect(merged.scene).toBe('天台') // 未改的原扁平字段保留
    expect(merged.cameraAngle).toBe('过肩') // 未改的保留
  })

  it('empty ShotSpec fields do not blank out existing PlanShot fields', () => {
    const original = makeShot({ shotSize: '远景' })
    const spec = planShotToShotSpec(makeShot({ shotSize: undefined }), 'p', new Map())
    // spec.cinematography.shotScale 为 undefined，merge 不应覆盖原 shotSize
    const merged = mergeShotSpecIntoPlanShot(original, spec)
    expect(merged.shotSize).toBe('远景')
  })
})

describe('migrateStoryboardPlanShots — 批量迁移', () => {
  it('resolves film defaults and explicit shot parameters before projecting strategy overrides', () => {
    const plan: StoryboardPlan = {
      title: 'scope', anchors: [], aspectRatio: '4:3',
      shots: [
        makeShot({ index: 1, params: { resolution: '1080p' } }),
        makeShot({ index: 2, params: { aspect_ratio: '1:1', seed: 0 }, modeId: 'first' }),
      ],
    }
    const before = structuredClone(plan)
    const specs = migrateStoryboardPlanShots(plan, 'p')
    expect(specs.get(1)?.generationStrategy.overrides).toEqual({ aspect_ratio: '4:3', resolution: '1080p' })
    expect(specs.get(2)?.generationStrategy.overrides).toEqual({ aspect_ratio: '1:1', seed: 0, modeId: 'first' })
    expect(plan).toEqual(before)
  })

  it('keeps the plan context through storyboard and single-shot reader wrappers', () => {
    const plan: StoryboardPlan = { title: 'scope', anchors: [], shots: [makeShot()], aspectRatio: '4:3' }
    expect(readStoryboardAsShotSpecs(plan, [], 'p')[0].spec.generationStrategy.overrides).toEqual({ aspect_ratio: '4:3' })
    expect(readShotSpec(1, plan, [], 'p')?.spec.generationStrategy.overrides).toEqual({ aspect_ratio: '4:3' })
  })

  it('migrates all shots, keyed by index', () => {
    const plan: StoryboardPlan = {
      title: '短片',
      anchors: [makeAnchor({ id: 'a1', kind: 'character', scope: 'all' })],
      shots: [
        makeShot({ index: 1, anchorIds: ['a1'] }),
        makeShot({ index: 2, shotKind: 'image', anchorIds: [] }),
      ],
    }
    const map = migrateStoryboardPlanShots(plan, 'proj-1')
    expect(map.size).toBe(2)
    expect(map.get(1)?.references[0]).toEqual({ assetId: 'a1', role: 'character_ref', required: true })
    expect(map.get(2)?.generationStrategy.mediaKind).toBe('image')
    expect(map.get(2)?.time.durationSeconds).toBe(0)
  })

  it('does not mutate the input plan (pure function)', () => {
    const plan: StoryboardPlan = {
      title: 't',
      anchors: [],
      shots: [makeShot({ index: 1 })],
    }
    const snapshot = JSON.parse(JSON.stringify(plan))
    migrateStoryboardPlanShots(plan, 'p')
    expect(plan).toEqual(snapshot)
  })
})
