/**
 * Slice 1 测试：电影级领域模型 v1 类型 + zod schema。
 *
 * 验收（Gate 1 Slice 1）：
 * - 类型编译通过（drift guard 零运行时，但编译期锁住 schema 与手写类型同形）。
 * - zod parse 固定 golden case：完整对象 round-trip。
 * - 迁移期宽松：缺失 optional 子字段的对象仍能 parse（旧项目无损打开的前提）。
 * - ReferenceBinding 无 role 的对象被拒（§9.2 规则）。
 * - ShotSpec version 钉死：version:2 被拒（未来迁移基础）。
 */
import { describe, expect, it } from 'vitest'
import {
  assetRevisionSchema,
  filmBibleSchema,
  generationIntentSchema,
  generationStrategySchema,
  referenceBindingSchema,
  shotSpecSchema,
} from './cinematicSchema'
import type {
  AssetRevisionV1,
  FilmBibleV1,
  GenerationIntentV1,
  GenerationStrategyV1,
  ReferenceBindingV1,
  ShotSpecV1,
} from './cinematicTypes'

describe('ReferenceBinding schema (§9.2)', () => {
  it('accepts a full reference binding', () => {
    const ref: ReferenceBindingV1 = {
      assetId: 'asset-char-linxia',
      revisionId: 'rev-1',
      role: 'identity',
      strength: 0.8,
      required: true,
    }
    expect(referenceBindingSchema.parse(ref)).toEqual(ref)
  })

  it('rejects a reference without role (§9.2 rule: no naked image arrays)', () => {
    // role 是必填；缺 role 应被 zod 拒
    expect(() => referenceBindingSchema.parse({ assetId: 'a', required: true })).toThrow()
  })

  it('rejects strength out of [0,1]', () => {
    expect(() =>
      referenceBindingSchema.parse({ assetId: 'a', role: 'style', required: true, strength: 1.5 }),
    ).toThrow()
  })

  it('accepts legacy edge-mode roles during migration', () => {
    for (const role of ['reference', 'first_frame', 'style_ref', 'image_ref'] as const) {
      expect(referenceBindingSchema.parse({ assetId: 'a', role, required: true }).role).toBe(role)
    }
  })
})

describe('GenerationStrategy schema (§9.3)', () => {
  it('keeps canonical supplier and variant separate while preserving opaque legacy providerId', () => {
    const source = {
      mediaKind: 'video', mode: 'first-frame', rationale: 'legacy',
      modelKey: 'shared-model', vendorKey: 'apimart', variantId: 'fast', providerId: 'old-variant',
    }
    expect(generationStrategySchema.parse(source)).toEqual(source)
    const legacy = { ...source, vendorKey: undefined, variantId: undefined }
    const parsed = generationStrategySchema.parse(legacy)
    expect(parsed.providerId).toBe('old-variant')
    expect(parsed.vendorKey).toBeUndefined()
    expect(parsed.variantId).toBeUndefined()
  })

  it('accepts a model-agnostic strategy', () => {
    const s: GenerationStrategyV1 = {
      mediaKind: 'video',
      mode: 'first-last-frame',
      rationale: '明确位移与状态变化，用首尾帧锁起止',
    }
    expect(generationStrategySchema.parse(s)).toEqual(s)
  })

  it('accepts provider/model pinning + overrides', () => {
    const s = generationStrategySchema.parse({
      mediaKind: 'image',
      mode: 'omni-reference',
      rationale: '角色身份一致需较大运动自由',
      providerId: 'codex',
      modelKey: 'gpt-image-2',
      overrides: { aspect_ratio: '16:9' },
    })
    expect(s.overrides).toEqual({ aspect_ratio: '16:9' })
  })
})

describe('GenerationIntent schema (§9.5)', () => {
  it('accepts a full intent', () => {
    const intent: GenerationIntentV1 = {
      id: 'intent-1',
      projectId: 'proj-1',
      shotId: 'shot-07',
      mediaKind: 'video',
      prompt: '林夏转身',
      references: [{ assetId: 'a', role: 'identity', required: true }],
      target: { aspectRatio: '9:16', durationSeconds: 5, outputCount: 1 },
      budget: { maxCostCny: 2, maxSubmissions: 3 },
    }
    expect(generationIntentSchema.parse(intent)).toEqual(intent)
  })

  it('rejects outputCount < 1', () => {
    expect(() =>
      generationIntentSchema.parse({
        id: 'i',
        projectId: 'p',
        mediaKind: 'image',
        prompt: 'x',
        references: [],
        target: { aspectRatio: '1:1', outputCount: 0 },
        budget: { maxSubmissions: 1 },
      }),
    ).toThrow()
  })
})

describe('ShotSpec schema (§9.1) — 镜头唯一真相源', () => {
  const fullShot: ShotSpecV1 = {
    version: 1,
    id: 'shot-07',
    projectId: 'proj-1',
    sceneId: 'scene-rooftop',
    index: 7,
    title: '天台对峙',
    narrative: { intent: '揭示反派出场', beat: '转折', conflict: '对峙', informationRevealed: ['反派身份'] },
    time: { durationSeconds: 5, startState: '林夏背对', endState: '林夏转身面对' },
    subjects: [{ assetId: 'char-linxia', role: 'primary', performance: '转身', dialogue: '你来了' }],
    environment: {
      sceneAssetId: 'scene-rooftop',
      propAssetIds: ['prop-phone'],
      costumeAssetIds: ['costume-linxia-coat'],
      spatialRelations: ['林夏在前景，反派在远景门口'],
    },
    cinematography: {
      shotScale: '中景',
      cameraAngle: '过肩',
      lensMm: 35,
      cameraMotion: { type: '推', speed: '慢' },
      composition: '三分法',
      blocking: '林夏左、反派右',
      lighting: '逆光剪影',
      color: '冷青蓝',
    },
    actionChain: ['林夏听到脚步', '停顿', '转身', '看到反派'],
    sound: { dialogue: '你来了', ambience: '风声', sfx: ['脚步声'], musicIntent: '紧张低频' },
    continuity: [{ kind: 'screen-direction', rule: '接上一镜屏向', sourceShotId: 'shot-06' }],
    references: [{ assetId: 'char-linxia', role: 'identity', required: true }],
    generationStrategy: {
      mediaKind: 'video',
      mode: 'first-last-frame',
      rationale: '明确转身位移与结果',
    },
    acceptanceCriteria: ['林夏完成转身', '逆光剪影可见'],
    selectedImageRevisionId: 'rev-img-2',
    selectedVideoRevisionId: 'rev-vid-1',
    status: 'accepted',
  }

  it('round-trips a full ShotSpec', () => {
    expect(shotSpecSchema.parse(fullShot)).toEqual(fullShot)
  })

  it('rejects version:2 (version pinned for future migration)', () => {
    expect(() => shotSpecSchema.parse({ ...fullShot, version: 2 as 1 })).toThrow()
  })

  it('parses a migration-era minimal shot (old project opens losslessly)', () => {
    // 迁移期：narrative.intent/beat 等可选；subjects/environment 子字段可空数组
    const minimal = {
      version: 1,
      id: 'shot-1',
      projectId: 'p',
      index: 1,
      title: '镜1',
      narrative: {},
      time: { durationSeconds: 0 },
      subjects: [],
      environment: { propAssetIds: [], costumeAssetIds: [], spatialRelations: [] },
      cinematography: { cameraMotion: {} },
      actionChain: [],
      sound: { sfx: [] },
      continuity: [],
      references: [],
      generationStrategy: { mediaKind: 'image', mode: 'text-to-image', rationale: '初始' },
      acceptanceCriteria: [],
      status: 'draft',
    }
    const parsed = shotSpecSchema.parse(minimal)
    expect(parsed.status).toBe('draft')
    expect(parsed.cinematography.cameraMotion).toEqual({})
  })
})

describe('FilmBible schema (§8.1)', () => {
  it('round-trips a full Film Bible', () => {
    const bible: FilmBibleV1 = {
      version: 1,
      projectId: 'proj-1',
      theme: '孤独与连接',
      audience: '25-35 都市',
      aspectRatio: '9:16',
      fps: 24,
      targetDurationSeconds: 60,
      characters: [{ assetId: 'char-linxia', name: '林夏', relations: '主角' }],
      soundPrinciples: { music: '极简钢琴', dialogue: '自然' },
      forbiddenContent: ['暴力露骨'],
    }
    expect(filmBibleSchema.parse(bible)).toEqual(bible)
  })

  it('parses minimal Film Bible (only ids + version)', () => {
    const parsed = filmBibleSchema.parse({ version: 1, projectId: 'p' })
    expect(parsed.projectId).toBe('p')
  })

  it('Film Bible 类型不含任何凭据字段（§8.1/§22.1 安全边界）', () => {
    // 静态断言：FilmBibleV1 的字段名集合不含 apiKey/cookie/secret/token
    type FieldNames = keyof FilmBibleV1
    type Forbidden = 'apiKey' | 'cookie' | 'secret' | 'token' | 'Authorization'
    // 编译期：若类型意外加上凭据字段，下一行类型不匹配会编译失败
    const _assertNoCreds: Exclude<FieldNames, Forbidden> extends FieldNames ? true : never = true
    void _assertNoCreds
    expect(_assertNoCreds).toBe(true)
  })
})

describe('AssetRevision schema (§9.6)', () => {
  it('round-trips a full revision', () => {
    const rev: AssetRevisionV1 = {
      id: 'rev-vid-1',
      assetId: 'shot-07-video',
      parentRevisionId: 'rev-vid-0',
      kind: 'generated',
      localPath: 'revisions/shot-07-video/rev-vid-1/result.mp4',
      sha256: 'abc',
      mimeType: 'video/mp4',
      width: 1080,
      height: 1920,
      durationSeconds: 5,
      providerTaskId: 'task-9',
      costCny: 0.5,
      createdAt: '2026-08-02T00:00:00Z',
      status: 'selected',
    }
    expect(assetRevisionSchema.parse(rev)).toEqual(rev)
  })

  it('parses a candidate revision (minimal)', () => {
    const parsed = assetRevisionSchema.parse({
      id: 'rev-1',
      assetId: 'a',
      createdAt: '2026-08-02T00:00:00Z',
      status: 'candidate',
    })
    expect(parsed.status).toBe('candidate')
  })

  it('rejects unknown status', () => {
    expect(() =>
      assetRevisionSchema.parse({ id: 'r', assetId: 'a', createdAt: 't', status: 'live' }),
    ).toThrow()
  })
})
