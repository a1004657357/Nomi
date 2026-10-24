// Run only after the coordinated build; never builds or generates media.
// NOMI_MEDIA_OUTCOME_WALK_ROOT=/absolute/fresh/run node tests/ux/media-outcome.walk.mjs
// Optional NOMI_MEDIA_OUTCOME_VIEW_PROJECTS_DIR=/absolute/original/projects: view one existing image.
// Design: disk -> real library -> canvas; synthetic zh/en; risk disclosure -> cancel.
// Network: existing four-layer guard plus deny-all HTTP/TCP, including local proxies.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, screenshotSettled, expectNoCjkInEnglishDom } from './_assert.mjs'

function absoluteEnv(name, required = false) {
  const value = process.env[name]
  if (!value && !required) return null
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`)
  return path.resolve(value)
}

const root = absoluteEnv('NOMI_MEDIA_OUTCOME_WALK_ROOT', true)
const viewProjects = absoluteEnv('NOMI_MEDIA_OUTCOME_VIEW_PROJECTS_DIR')
if (viewProjects) {
  if (!fs.statSync(viewProjects).isDirectory()) throw new Error('View projects directory is not a directory')
  for (const [parent, child] of [[root, viewProjects], [viewProjects, root]]) {
    const relative = path.relative(parent, child)
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('Evidence and original projects must not contain one another')
    }
  }
}
// EEXIST deliberately fails, even for an empty previous run. Never overwrite old evidence.
fs.mkdirSync(root)
const report = { runId: randomUUID(), status: 'running', executedAt: new Date().toISOString(),
  mode: viewProjects ? 'original-project-view-only' : 'synthetic-bilingual', realProviderCalls: null,
  generated: false, locales: [], limitations: ['UI-only fake run binding tests disclosure/cancel, not backend reconciliation or paid approval.'] }
const save = () => fs.writeFileSync(path.join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
save()

// Runtime instrumentation lives in this fresh evidence run, not in production or another test.
const strictGuard = path.join(root, 'deny-network.cjs')
fs.writeFileSync(strictGuard, String.raw`
'use strict'
const fs = require('node:fs')
const { app, net: electronNet } = require('electron')
const note = (entry) => fs.appendFileSync(process.env.NOMI_WALK_NET_LOG, JSON.stringify(entry) + '\n')
const deny = (via, method = 'UNKNOWN') => {
  note({ kind: 'media-network-blocked', via, method: String(method).toUpperCase() })
  return new Error('Network disabled for media-outcome view-only walkthrough')
}
const layers = []
globalThis.fetch = (_input, init) => Promise.reject(deny('fetch', init?.method || _input?.method || 'GET'))
layers.push('fetch')
for (const name of ['http', 'https']) {
  const mod = require('node:' + name)
  mod.request = (...args) => { throw deny(name, args.find(value => value && typeof value === 'object' && value.method)?.method) }
  mod.get = () => { throw deny(name, 'GET') }
}
layers.push('http', 'https')
const Socket = require('node:net').Socket
const connect = Socket.prototype.connect
Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  if ((first && typeof first === 'object' && first.path) || (typeof first === 'string' && !/^\d+$/.test(first))) {
    return connect.apply(this, args) // Local IPC only, never TCP (not even loopback).
  }
  const error = deny('socket', 'TCP')
  process.nextTick(() => this.destroy(error))
  return this
}
layers.push('socket')
electronNet.fetch = (_url, init) => Promise.reject(deny('electron.fetch', init?.method || 'GET'))
electronNet.request = options => { throw deny('electron.request', options?.method) }
layers.push('electron-net')
app.on('session-created', session => {
  session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    deny('chromium', details.method)
    callback({ cancel: true })
  })
  note({ kind: 'media-session-guard-ready' })
})
layers.push('chromium')
note({ kind: 'media-deny-all-loaded', layers })
`)

const specs = [
  { locale: 'zh-CN', reason: '这一镜可能已被服务商收下，结果没法确认',
    hint: 'Nomi 不会自动重发，请不要重复提交', release: '我核对过了，重新生成', cancel: '取消', proceed: '继续',
    risk: '如果其实已经收下，会重复提交' },
  { locale: 'en', reason: 'Result unconfirmed: the provider may have received this shot',
    hint: 'Nomi will not resend automatically. Do not submit again.', release: "I've checked, generate again", cancel: 'Cancel', proceed: 'Continue',
    risk: 'if it was in fact received, it will be submitted twice' },
]

function fixture(spec) {
  const projectsDir = path.join(root, 'fixtures', spec.locale, 'projects')
  const projectId = `media-outcome-${spec.locale}`
  const projectRoot = path.join(projectsDir, projectId)
  const now = Date.now()
  const structured = { vendorKey: 'fixture', httpStatus: 502, category: 'submission-unknown', retryable: false,
    upstreamCode: 'generation_outcome_unknown', operationRole: 'media-submit', method: 'POST',
    url: 'http://127.0.0.1:9/v1/images/generations',
    upstreamMsg: 'The generation request may have been submitted, but its outcome could not be confirmed.' }
  const marker = Buffer.from(JSON.stringify(structured)).toString('base64')
  const error = `Error invoking remote method 'nomi:catalog:call': Error: NOMI_VENDOR_ERR_B64::${marker}:: ${structured.upstreamMsg}`
  const node = { id: 'media-outcome-image', kind: 'image', title: 'Media outcome fixture', categoryId: 'shots',
    position: { x: 100, y: 100 }, size: { width: 620, height: 420 }, prompt: 'Synthetic outcome fixture; never generate.',
    status: 'error', error, runs: [{ id: 'ui-only-error-run', status: 'error', error, startedAt: now - 1000, updatedAt: now }],
    meta: { modelKey: 'media-outcome-image-fixture', vendor: 'fixture', modelVendor: 'fixture',
      productionRunId: 'ui-only-never-released-run', productionShotId: 'ui-only-shot' } }
  const record = { id: projectId, name: `Media outcome ${spec.locale}`, version: 2, createdAt: now, updatedAt: now,
    savedAt: now, revision: 1, immutableProjectUuid: randomUUID(), projectGeneration: 1, lastKnownRootPath: projectRoot,
    payload: { workbenchDocument: { version: 1, title: '', contentJson: { type: 'doc', content: [] } },
      generationCanvas: { nodes: [node], edges: [], groups: [], selectedNodeIds: [node.id], canvasZoom: 1, canvasPan: { x: 0, y: 0 } },
      timeline: { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [
        { id: 'imageTrack', type: 'image', label: 'Images', clips: [] }, { id: 'videoTrack', type: 'video', label: 'Videos', clips: [] },
      ] } } }
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(record, null, 2))
  return { projectsDir, projectRoot, record, node }
}

function existingProject() {
  const candidates = []
  for (const item of fs.readdirSync(viewProjects, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith('.')) continue
    const projectRoot = path.join(viewProjects, item.name)
    const file = [path.join(projectRoot, '.nomi', 'project.json'), path.join(projectRoot, 'project.json')].find(file => fs.existsSync(file))
    if (!file) continue
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))
    const nodes = record.payload?.generationCanvas?.nodes || []
    const node = nodes.find(node => node.kind === 'image' && node.status === 'success' && node.result?.url)
    if (node) candidates.push({ projectsDir: viewProjects, projectRoot, record, node })
    if (nodes.some(node => ['running', 'queued', 'pending', 'recoverable'].includes(node.status))) {
      throw new Error('View-only projects contain unfinished nodes; refusing to launch automatic recovery')
    }
  }
  candidates.sort((a, b) => (b.record.updatedAt || 0) - (a.record.updatedAt || 0))
  if (!candidates.length) throw new Error('No completed image project found in the original projects directory')
  return candidates[0]
}

function assetHashes(projectRoot) {
  const hashes = {}
  const walk = directory => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('View-only asset snapshot refuses symlinks')
      if (item.name === '.nomi' || item.name === 'project.json') continue
      const file = path.join(directory, item.name)
      if (item.isDirectory()) walk(file)
      else if (item.isFile()) hashes[path.relative(projectRoot, file)] = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    }
  }
  walk(projectRoot)
  return hashes
}

async function openCanvas(instance, selected) {
  const card = instance.win.locator(`[data-project-card][data-project-id=${JSON.stringify(selected.record.id)}]`).first()
  await expect(card).toBeVisible()
  await clickOrFail(card, 'Open the persisted project from the real library')
  let canvas
  await expect.poll(async () => {
    for (const page of instance.app.windows()) {
      if (page.isClosed()) continue
      const node = page.locator(`[data-node-id=${JSON.stringify(selected.node.id)}]`)
      if (await node.isVisible()) { canvas = page; return true }
      const tab = page.getByRole('button', { name: /^(生成|Generate)$/ }).first()
      // This is the existing workspace navigation tab, never the node's generate control.
      if (await tab.isVisible() && await page.locator('[data-project-card]').count() === 0) {
        await clickOrFail(tab, 'Open the generation canvas view')
      }
    }
    return false
  }, { timeout: 30_000, message: 'Persisted image node must mount through the real project route' }).toBe(true)
  await canvas.setViewportSize({ width: 1280, height: 933 })
  return canvas
}

function auditGuard(file) {
  const entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  const base = entries.find(entry => entry.kind === 'guard-loaded')
  const strict = entries.find(entry => entry.kind === 'media-deny-all-loaded')
  for (const layer of ['fetch', 'http', 'https', 'socket', 'chromium']) expect(base?.layers).toContain(layer)
  for (const layer of ['fetch', 'http', 'https', 'socket', 'electron-net', 'chromium']) expect(strict?.layers).toContain(layer)
  expect(entries.some(entry => entry.kind === 'media-session-guard-ready')).toBe(true)
  expect(entries.filter(entry => entry.kind === 'guard-error')).toHaveLength(0)
  const blocked = entries.filter(entry => entry.kind === 'media-network-blocked' || entry.kind === 'blocked')
  const postAttempts = blocked.filter(entry => entry.method === 'POST')
  expect(postAttempts).toHaveLength(0)
  return { verified: true, realProviderCalls: 0, postAttempts: 0, blockedAttempts: blocked.length,
    layers: strict.layers, localProxyAlsoBlocked: true }
}

async function walk(spec, selected, realView) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-media-outcome-'))
  const netLog = path.join(tempRoot, 'network.jsonl')
  const entry = { locale: spec.locale, fixture: !realView, status: 'running', shots: [], profileRemoved: false }
  report.locales.push(entry)
  save()
  const before = realView ? assetHashes(selected.projectRoot) : null
  let instance
  let page
  let failure
  const snap = async name => {
    const file = path.join(root, `${spec.locale}-${name}.png`)
    await screenshotSettled(page, { path: file })
    entry.shots.push(file)
  }
  try {
    instance = await launchNomiApp({ name: `media-outcome-${spec.locale}`, tempRoot, projectsDir: selected.projectsDir,
      syntheticCredentialStorage: true, settleMs: 0, args: ['--no-proxy-server'],
      viewportSize: { width: 1280, height: 933 },
      mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs'), strictGuard],
      env: { NOMI_WALK_NET_LOG: netLog, NOMI_CAPABILITY_DIR: path.join(tempRoot, 'capability') },
      initialLocalStorage: { 'nomi:locale:v1': spec.locale, 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen',
        'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' } })
    instance.win.setDefaultTimeout(30_000)
    page = await openCanvas(instance, selected)
    const node = page.locator(`[data-node-id=${JSON.stringify(selected.node.id)}]`)
    await expect(node).toBeVisible()
    if (realView) {
      await expect.poll(() => node.locator('img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0)),
        { timeout: 30_000, message: 'Original completed image must really render' }).toBe(true)
      await snap('original-completed-image') // Exactly one real-project screenshot, no mutations/actions.
      entry.originalImageRendered = true
    } else {
      const alert = node.getByRole('alert')
      await expect(alert).toBeVisible()
      await expect(node).toContainText(spec.reason)
      await expect(alert).toContainText(spec.hint)
      await expect(alert).not.toContainText(/连不上|余额不足|额度不足|无法连接|Can't connect|Insufficient (balance|credits)|Quota exceeded|Connection failed/i)
      await expect(node.getByRole('button', { name: /^(重试|仍要重试|Retry|Retry anyway)$/ })).toHaveCount(0)
      const release = alert.getByRole('button', { name: spec.release, exact: true })
      await expect(release).toBeVisible()
      await snap('submission-unknown')
      await clickOrFail(release, 'Inspect the existing risk disclosure; never approve resubmission')
      const disclosure = alert.locator('[data-release-confirm]')
      await expect(disclosure).toBeVisible()
      await expect(disclosure).toContainText(spec.risk)
      await expect(disclosure.getByRole('button', { name: spec.proceed, exact: true })).toBeVisible()
      await snap('risk-confirmation')
      // Do not click Continue, any Generate control, or any spend-confirm approval.
      await clickOrFail(disclosure.getByRole('button', { name: spec.cancel, exact: true }), 'Cancel the risk disclosure')
      await expect(disclosure).toBeHidden()
      await expect(release).toBeVisible()
      await expect(page.locator('[data-spend-confirm-dialog]')).toHaveCount(0)
      if (spec.locale === 'en') await expectNoCjkInEnglishDom(page)
      entry.riskDisclosureCancelled = true
      entry.normalRetryAbsent = true
    }
  } catch (error) {
    failure = error
    entry.status = 'failed'
    // Real view keeps its one-shot budget, including failure evidence.
    if (page && (!realView || entry.shots.length === 0)) {
      try { await snap('failure') } catch { entry.failureScreenshotUnavailable = true }
    }
  } finally {
    try { if (instance) await instance.close() } catch (error) { failure ||= error }
    try {
      entry.guard = auditGuard(netLog)
      if (realView) {
        expect(assetHashes(selected.projectRoot)).toEqual(before)
        entry.originalAssetsUnchanged = true
        entry.checkedAssetFiles = Object.keys(before).length
      }
    } catch (error) { failure ||= error }
    fs.rmSync(tempRoot, { recursive: true, force: true })
    entry.profileRemoved = !fs.existsSync(tempRoot)
    if (!entry.profileRemoved) failure ||= new Error('Isolated profile cleanup failed')
    entry.status = failure ? 'failed' : 'passed'
    save()
  }
  if (failure) throw failure
}

try {
  if (viewProjects) await walk(specs[0], existingProject(), true)
  else for (const spec of specs) await walk(spec, fixture(spec), false)
  expect(report.locales.every(entry => entry.guard?.verified && entry.guard.realProviderCalls === 0 && entry.profileRemoved)).toBe(true)
  report.realProviderCalls = 0
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  // No raw DOM, credentials, request payloads, or original project contents in the report.
  report.error = String(error?.message || error)
  process.exitCode = 1
} finally {
  save()
  console.log(JSON.stringify({ status: report.status, realProviderCalls: report.realProviderCalls,
    report: path.join(root, 'report.json'), locales: report.locales.map(entry => ({ locale: entry.locale, status: entry.status, profileRemoved: entry.profileRemoved })) }))
}
