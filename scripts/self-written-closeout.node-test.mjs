import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateSelfWritten, pathMatches, staticPrefixOf, validateRegistry } from './self-written-lib.mjs'
import { evaluatePlans, evaluatePullRequest } from './prior-art-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const registry = JSON.parse(read('docs/engineering/self-written.json'))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const originalRootCount = 161
const card = 'docs/plan/2026-10-25-self-written-prior-art-closeout.md'
const report = 'docs/research/2026-10-25-self-written-fork-main-source-review.md'
const owners = () => new Map(registry.entries.map(entry => [entry.id, entry]))
const rows = () => [...read(report).matchAll(/^\| `((?:src|electron)\/[^`]+)` \| (.*?) \| `([^`]+)` \| `([a-f0-9]{64})` \| (.+) \|$/gm)]

test('pre-batch policy and generic exclusion zones are unchanged; new domain claims are capability-scoped', () => {
  assert.equal(digest(registry.genericZones), 'a6ad34cfe5d47bdbca6f2c62880b6898824776520774233365a8319ae8f4b088')
  assert.equal(registry.enforceFrom, '2026-10-08')
  assert.equal(digest(registry.domainRoots.slice(0, originalRootCount)), 'f23d6ce40d3af1bfdb52ccc5b47ad3332a4421543ce2ed9b304061a1e8c68511')
  for (const item of registry.domainRoots.slice(originalRootCount)) {
    assert.ok(item.path.split('/').filter(Boolean).length >= 3, item.path)
    assert.ok(!/^(?:src|electron)\/(?:\*|$)/.test(item.path), item.path)
    assert.ok(item.reason.length >= 12, item.path)
  }
})

test('every reviewed source has an explicit owner, hash and source locator', () => {
  assert.ok(rows().length >= 183, '180 initial sources plus main locale, PNG fixture and Blender vocabulary contract')
  assert.equal(new Set(rows().map(row => row[1])).size, rows().length)
  for (const [, file, locator, owner, , reason] of rows()) {
    assert.match(locator, /#L\d+/)
    assert.ok(reason.length >= 8, file)
    if (owner.startsWith('domain:')) {
      const claim = owner.slice('domain:'.length)
      assert.ok(registry.domainRoots.some(item => item.path === claim && pathMatches(claim, file)), file)
      assert.ok(!(registry.genericZones ?? []).some(zone => pathMatches(zone.path, file)), file)
    } else {
      const entry = owners().get(owner)
      assert.ok(entry?.paths.some(pattern => pathMatches(pattern, file)), `${file}: ${owner}`)
    }
  }
})

test('handwritten generic mechanisms remain explicit replacement work, not domain exemptions', () => {
  for (const id of ['director-catalog-archive', 'snapshot-structural-sharing', 'renderer-external-stores', 'desktop-string-interpolation', 'web-bridge-png-fixture']) {
    const entry = owners().get(id)
    assert.equal(entry?.status, 'to-replace', id)
    assert.equal(entry.plan, report, id)
    assert.ok(entry.revisitWhen.length > 20, id)
    for (const file of entry.paths) {
      const genericZone = (registry.genericZones ?? []).some(item => pathMatches(item.path, file))
      const domainClaim = !genericZone && registry.domainRoots.some(item => pathMatches(item.path, file) && !(item.exclude ?? []).some(pattern => pathMatches(pattern, file)))
      assert.ok(!domainClaim, file)
    }
  }
})

test('i18n display helpers use one existing-library adapter owner, not broad i18n domain expansion', () => {
  const entry = owners().get('locale-display-adapters')
  assert.equal(entry?.status, 'justified')
  for (const file of ['src/i18n/CanvasComponentText.tsx', 'src/i18n/capabilityWorkflowText.ts', 'src/workbench/ai/v4/formatMoney.ts']) assert.ok(entry.paths.includes(file), file)
  assert.ok(entry.alternativesChecked.some(item => item.source.includes('i18next')))
})

test('unreviewed generic neighbors still fail the unchanged gate', () => {
  const paths = [
    'src/i18n/NewUnrelatedText.ts',
    'src/workbench/ai/v4/shareEqualDeepV2.ts',
    'src/workbench/generationCanvas/quality/hooks/useNewQueue.ts',
    'electron/preload/newHostMechanism.ts',
    'electron/downloads/newDownloader.ts',
    'electron/blender/newZipCodec.ts',
    'electron/pavoWeb/fixtures/newCodec.cjs',
  ]
  const result = evaluateSelfWritten({ registry, added: paths.map(file => ({ path: file, content: 'export const value = 1\n' })), today: '2026-10-25', exists: () => true })
  assert.deepEqual(result.violations, paths)
  assert.equal(result.errors.length, 1)
})

test('A canonical source tail uses two existing roots and one exact Director text claim', () => {
  const claims = [
    ['electron/shared/blenderDirectorProtocolText.ts', 'electron/shared/blenderDirectorProtocolText.ts'],
    ['electron/shared/canvas/sourceDefaults.ts', 'electron/shared/canvas/'],
    ['electron/shared/generationPromptText.ts', 'electron/shared/generation*'],
  ]
  for (const [file, owner] of claims) {
    assert.ok(registry.domainRoots.some(item => item.path === owner && pathMatches(owner, file)), `${file}: ${owner}`)
    assert.ok(!registry.genericZones.some(item => pathMatches(item.path, file)), file)
  }
  // These fixtures test path ownership only; the real source/hash review lives in the report.
  const owned = evaluateSelfWritten({ registry, added: claims.map(([file]) => ({ path: file, content: 'export const value = 1\n' })), today: '2026-10-25', exists: () => true })
  assert.deepEqual(owned.violations, [])
  const neighbors = ['electron/shared/blenderDirectorProtocolTextV2.ts', 'electron/shared/blenderDirectorProtocolTextCache.ts', 'electron/shared/unrelatedProtocolText.ts']
  const rejected = evaluateSelfWritten({ registry, added: neighbors.map(file => ({ path: file, content: 'export const value = 1\n' })), today: '2026-10-25', exists: () => true })
  assert.deepEqual(rejected.violations, neighbors)
})

test('registry shape and every physical source/plan exist in the validated tree', () => {
  const result = validateRegistry(registry, {
    exists: file => fs.existsSync(path.join(root, staticPrefixOf(file))),
    today: '2026-10-25',
  })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.stale, [])
})

test('real design card satisfies prior-art; registry-changing PR requires its actual reference', () => {
  const plans = new Map([[card, read(card)]])
  const fileExists = file => fs.existsSync(path.join(root, file))
  assert.deepEqual(evaluatePlans({ plans, fileExists }), [])
  assert.ok(evaluatePullRequest({ body: '', registryChanged: true, plans }).length > 0)
  assert.deepEqual(evaluatePullRequest({ body: `登记查证：${card}`, registryChanged: true, plans, fileExists }), [])
})
