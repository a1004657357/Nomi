import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStoryboardShotTable } from '../../../electron/shared/canvas/shotTable'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import { useWorkbenchStore } from '../workbenchStore'
import { createDefaultWorkbenchDocument } from '../workbenchTypes'
import { normalizePayload, normalizeRecord } from './projectNormalize'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import { readLocalProject, saveLocalProject } from './projectRepository'
import { PROJECT_INDEX_KEY, projectRecordKey } from './projectStorage'
import {
  clearActiveWorkbenchProjectSaveTarget,
  persistActiveWorkbenchProjectNow,
  readCurrentWorkbenchProjectPayload,
  replayCanvasEventTailAndSealGenesis,
  restoreWorkbenchProjectPayload,
  subscribeWorkbenchProjectPersistence,
} from './workbenchProjectSession'

vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => null }))

const legacyMapKey = ['storyboard', 'Plans'].join('')
const legacyPlanKey = ['storyboard', 'Plan'].join('')
const legacyCommittedKey = ['storyboard', 'Plan', 'Committed'].join('')
const summary = { id: 'isolated-storyboard-project', name: 'User project', createdAt: 1, updatedAt: 2 }

function planFor(documentId: string): StoryboardPlan {
  return {
    title: `User plan ${documentId}`, aspectRatio: '9:16',
    anchors: [{ id: `anchor-${documentId}`, kind: 'character', name: 'User name', description: 'User description', carrier: 'visual',
      referenceUrl: 'https://example.invalid/reference.png', referenceSourceNodeId: 'asset-node',
      params: { userValue: 0, userFlag: false } }],
    shots: [{ index: 1, shotId: `shot-${documentId}`, durationSec: 0, anchorIds: [`anchor-${documentId}`],
      prompt: 'Original user prompt\nDo not translate or replace.', notes: 'User continuity notes',
      params: { userValue: 0, userFlag: false },
      referenceBindings: { character: [{ url: 'https://example.invalid/reference.png', sourceNodeId: 'asset-node', name: 'User reference' }] } }],
  }
}

function fixture(shape: 'single' | 'map' | 'canonical') {
  const documents = ['doc-a', 'doc-b'].map((id, index) => ({
    ...createDefaultWorkbenchDocument(), id, title: `User document ${id}`, updatedAt: 40 + index,
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Original script ${id}` }] }] },
  }))
  const design = (documentId: string, suffix: string, committed: boolean) => ({
    id: `design-${documentId}-${suffix}`, documentId, title: `User design ${suffix}`, plan: planFor(documentId),
    committed, status: committed ? 'committed' as const : 'draft' as const,
    sourceDocumentUpdatedAt: 40, createdAt: 10, updatedAt: 20,
  })
  const canonical = { 'doc-a': [design('doc-a', 'main', true), { ...design('doc-a', 'alternate', false), status: 'stale' as const }], 'doc-b': [design('doc-b', 'main', false)] }
  const expectedDocuments = shape === 'single' ? ['doc-b'] : ['doc-a', 'doc-b']
  const tables = expectedDocuments.map((documentId) => ({
    id: `table-${documentId}`, kind: 'shot_table', title: `User table ${documentId}`, categoryId: 'shots', position: { x: 30, y: 70 },
    meta: { shotTable: createStoryboardShotTable(documentId, shape === 'canonical' ? `design-${documentId}-main` : `migrated-${documentId}`, '2026-10-25T00:00:00.000Z'),
      userSettings: { note: 'Keep node meta', zero: 0, flag: false } },
  }))
  const payload = {
    ...createDefaultWorkbenchProjectPayload(), workbenchDocuments: documents, activeDocumentId: 'doc-b', generationCanvasLastSeq: 37,
    filmBible: { version: 1, projectId: summary.id, theme: 'Original user theme', aspectRatio: '9:16', characters: [{ assetId: 'asset-node', name: 'User name' }], forbiddenContent: ['No identity drift'] },
    categories: [{ id: 'user-category', name: 'User category', icon: '', iconName: 'IconTag', defaultNodeRenderKind: 'shot-frame', order: 20, isBuiltin: false }],
    generationCanvas: { nodes: [
      ...tables,
      { id: 'asset-node', kind: 'image', title: 'User asset', categoryId: 'shots', position: { x: 0, y: 0 }, meta: { userField: 'Preserve', zero: 0, flag: false } },
      { id: 'text-node', kind: 'text', title: 'User text', categoryId: 'shots', position: { x: 10, y: 20 }, contentJson: documents[0].contentJson, meta: { userField: 'Keep text node' } },
    ], edges: [{ id: 'user-edge', source: 'asset-node', target: 'text-node' }], groups: [], selectedNodeIds: [] },
    ...(shape === 'canonical' ? { storyboardDesignsByDocumentId: canonical } : shape === 'map'
      ? { [legacyMapKey]: { 'doc-a': { plan: planFor('doc-a'), committed: true }, 'doc-b': { plan: planFor('doc-b'), committed: false } } }
      : { [legacyPlanKey]: planFor('doc-b'), [legacyCommittedKey]: true }),
  }
  return { record: { ...summary, version: 1, payload }, documents, canonical, tables, expectedDocuments }
}

function expectOwnerOnly(payload: object) {
  for (const key of [legacyMapKey, legacyPlanKey, legacyCommittedKey]) expect(payload).not.toHaveProperty(key)
}

beforeEach(() => {
  const values = new Map<string, string>()
  const localStorage: Storage = {
    get length() { return values.size },
    clear: () => values.clear(), getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)) }, removeItem: (key) => { values.delete(key) },
    key: (index) => [...values.keys()][index] ?? null,
  }
  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('window', { localStorage, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true)
  useGenerationCanvasStore.setState(useGenerationCanvasStore.getInitialState(), true)
})

afterEach(() => {
  clearActiveWorkbenchProjectSaveTarget()
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true)
  useGenerationCanvasStore.setState(useGenerationCanvasStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

describe('canonical storyboard storage uses the real reader, owners, session writer and repository', () => {
  it.each(['single', 'map', 'canonical', 'flat', 'v2'] as const)('round trips %s input without losing documents, designs, node links or user content', async (shape) => {
    const input = fixture(shape === 'flat' || shape === 'v2' ? 'single' : shape)
    const originalFixture = JSON.stringify(input.record)
    const raw = JSON.stringify(shape === 'flat' ? { ...summary, ...input.record.payload } : shape === 'v2' ? { ...input.record, version: 2 } : input.record)
    window.localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify([summary]))
    window.localStorage.setItem(projectRecordKey(summary.id), raw)
    const loaded = readLocalProject(summary.id)!
    expect(window.localStorage.getItem(projectRecordKey(summary.id))).toBe(raw)
    expect(loaded.payload.workbenchDocuments).toEqual(input.documents)
    const owner = loaded.payload.storyboardDesignsByDocumentId!
    expect(Object.keys(owner)).toEqual(input.expectedDocuments)
    for (const documentId of input.expectedDocuments) expect(owner[documentId][0].plan).toEqual(planFor(documentId))
    if (shape === 'canonical') expect(owner).toEqual(input.canonical)
    if (shape === 'single') expect(owner['doc-b'][0].committed).toBe(true)
    if (shape === 'map') expect(owner['doc-a'][0].committed).toBe(true)

    restoreWorkbenchProjectPayload(loaded.payload)
    await replayCanvasEventTailAndSealGenesis(summary.id, loaded.payload, { signal: new AbortController().signal, assertCurrent: () => {} })
    const payload = readCurrentWorkbenchProjectPayload()
    expect(payload.storyboardDesignsByDocumentId).toEqual(owner)
    const onSaved = vi.fn()
    const dispose = subscribeWorkbenchProjectPersistence({ projectId: summary.id, projectName: summary.name, isHydrating: () => false, canPersist: () => true, saveProject: saveLocalProject, onSaved })
    try {
      const receipt = await persistActiveWorkbenchProjectNow()
      expect(onSaved).toHaveBeenCalledWith(receipt)
      const stored = JSON.parse(window.localStorage.getItem(projectRecordKey(summary.id))!)
      expect(stored.payload.storyboardDesignsByDocumentId).toEqual(owner)
      const reloaded = readLocalProject(summary.id)!
      expect(reloaded.payload.storyboardDesignsByDocumentId).toEqual(owner)
      expect(reloaded.payload.workbenchDocuments).toEqual(input.documents)
      expect(reloaded.payload.activeDocumentId).toBe('doc-b')
      expect(reloaded.payload.filmBible).toEqual(input.record.payload.filmBible)
      expect(reloaded.payload.categories).toContainEqual(input.record.payload.categories[0])
      expect(reloaded.payload.timeline).toEqual(loaded.payload.timeline)
      expect(reloaded.payload.generationCanvasLastSeq).toBe(payload.generationCanvasLastSeq)
      expect(reloaded.payload.generationCanvasLastSeq).toBeGreaterThanOrEqual(37)
      for (const original of input.record.payload.generationCanvas.nodes) {
        const node = reloaded.payload.generationCanvas.nodes.find((candidate) => candidate.id === original.id)!
        expect(node).toMatchObject(original)
      }
      expect(reloaded.payload.generationCanvas.edges).toEqual(input.record.payload.generationCanvas.edges)
      for (const table of input.tables) {
        const source = table.meta.shotTable.source
        if (source.kind !== 'storyboard') throw new Error('Expected a storyboard-owned table')
        expect(reloaded.payload.storyboardDesignsByDocumentId?.[source.documentId]?.some((design) => design.id === source.designId)).toBe(true)
      }
      await dispose()
      restoreWorkbenchProjectPayload(reloaded.payload)
      expect(readCurrentWorkbenchProjectPayload().storyboardDesignsByDocumentId).toEqual(owner)
      expect(JSON.stringify(input.record)).toBe(originalFixture)
      expectOwnerOnly(payload)
      expectOwnerOnly(stored.payload)
      expectOwnerOnly(reloaded.payload)
    } finally { await dispose() }
  })

  it.each([{}, { 'doc-a': [] }])('keeps an explicit empty canonical owner authoritative over retired data: %j', (owner) => {
    const base = createDefaultWorkbenchProjectPayload()
    const payload = normalizePayload({ ...base, storyboardDesignsByDocumentId: owner, [legacyMapKey]: { 'doc-a': { plan: planFor('doc-a'), committed: true } }, [legacyPlanKey]: planFor('doc-a') })
    expect(payload.storyboardDesignsByDocumentId).toEqual(owner)
    expect(normalizePayload(JSON.parse(JSON.stringify(payload))).storyboardDesignsByDocumentId).toEqual(owner)
    expectOwnerOnly(payload)
  })

  it('migrates an old flat record from its unstripped source, including Film Bible and node metadata', () => {
    const input = fixture('single')
    const flat = { ...summary, ...input.record.payload }
    const normalized = normalizeRecord(summary, flat)
    expect(normalized.payload.storyboardDesignsByDocumentId?.['doc-b']?.[0].plan).toEqual(planFor('doc-b'))
    expect(normalized.payload.filmBible).toEqual(input.record.payload.filmBible)
    expect(normalized.payload.generationCanvas.nodes).toEqual(input.record.payload.generationCanvas.nodes)
    expectOwnerOnly(normalized.payload)
  })

  it('retains read-only migration of a v2 workspace legacy payload without re-emitting its projection', () => {
    const input = fixture('single')
    const normalized = normalizeRecord(summary, { ...input.record, version: 2 })
    expect(normalized.version).toBe(1)
    expect(normalized.payload.storyboardDesignsByDocumentId?.['doc-b']?.[0].plan).toEqual(planFor('doc-b'))
    expectOwnerOnly(normalized.payload)
  })

  it.each(['plan', 'committed'])('still rejects an invalid legacy single %s without an authoritative canonical owner', async (field) => {
    const raw = { ...createDefaultWorkbenchProjectPayload(),
      [legacyPlanKey]: field === 'plan' ? { title: 'Broken user plan', anchors: [], shots: [{ index: 1 }] } : planFor('doc-a'),
      ...(field === 'committed' ? { [legacyCommittedKey]: 'true' } : {}),
    }
    const before = JSON.stringify(raw)
    const stored = JSON.stringify(fixture('single').record)
    window.localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify([summary]))
    window.localStorage.setItem(projectRecordKey(summary.id), stored)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(() => normalizePayload(raw)).toThrow()
      await expect(saveLocalProject(summary.id, raw, summary.name)).rejects.toThrow()
      expect(window.localStorage.getItem(projectRecordKey(summary.id))).toBe(stored)
      expect(JSON.stringify(raw)).toBe(before)
    } finally { warn.mockRestore() }
  })

  it('does not interpret a null legacy single plan as damaged user content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const payload = normalizePayload({ ...createDefaultWorkbenchProjectPayload(), [legacyPlanKey]: null })
      expect(payload.storyboardDesignsByDocumentId).toBeUndefined()
      expectOwnerOnly(payload)
      expect(warn).not.toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })

  it('does not validate an obsolete active projection as a second owner when canonical content exists', () => {
    const input = fixture('canonical')
    const payload = normalizePayload({ ...input.record.payload, [legacyPlanKey]: { title: 'Obsolete projection' } })
    expect(payload.storyboardDesignsByDocumentId).toEqual(input.canonical)
    expectOwnerOnly(payload)
  })
})
