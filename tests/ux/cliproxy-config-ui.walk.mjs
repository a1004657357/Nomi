// Built Electron only. Synthetic, isolated URL/key persistence and GET-only discovery.
// Run after the coordinated build: EVIDENCE_DIR=/absolute/report-dir node tests/ux/cliproxy-config-ui.walk.mjs
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, screenshotSettled, expectNoCjkInEnglishDom } from './_assert.mjs'

if (!process.env.EVIDENCE_DIR || !path.isAbsolute(process.env.EVIDENCE_DIR)) throw new Error('An absolute EVIDENCE_DIR is required')
const evidence = process.env.EVIDENCE_DIR
fs.mkdirSync(evidence, { recursive: true })
const report = { runId: `cliproxy-config-ui-${new Date().toISOString()}`, status: 'running', fixture: true, realProviderCalls: 0, requests: [], locales: [] }
const remoteIds = ['gpt-6-sol', 'gpt-image-2', 'gpt-6-extra-fixture']
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  report.requests.push({ method: req.method, pathname })
  req.resume()
  res.writeHead(req.method === 'GET' && pathname.endsWith('/models') ? 200 : 405, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ data: remoteIds.map(id => ({ id })) }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
const specs = [
  { locale: 'zh-CN', edit: '编辑 URL / API Key', add: '添加模型', replace: '更换 API Key', fetch: '获取可用模型', cancel: '取消', pending: 'API Key 已保存，待验证' },
  { locale: 'en', edit: 'Edit URL / API Key', add: 'Add Models', replace: 'Replace API Key', fetch: 'Get available models', cancel: 'Cancel', pending: 'API Key saved, verification pending' },
]

async function visibleLayout(win, locator) {
  const result = await locator.evaluate(element => {
    const viewport = { width: innerWidth, height: innerHeight }
    const rect = element.getBoundingClientRect()
    const buttons = [...element.querySelectorAll('button')].map(button => {
      const box = button.getBoundingClientRect()
      return { text: button.innerText, x: box.x, y: box.y, width: box.width, height: box.height,
        fits: button.scrollWidth <= button.clientWidth + 1 && box.left >= 0 && box.right <= innerWidth + 1 }
    })
    const overlap = buttons.some((a, index) => buttons.slice(index + 1).some(b =>
      Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) + 1 &&
      Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) + 1))
    return { viewport, width: rect.width, overflow: element.scrollWidth > element.clientWidth + 1, overlap, buttons }
  })
  expect(result.overflow).toBe(false)
  expect(result.overlap).toBe(false)
  expect(result.buttons.every(button => button.fits)).toBe(true)
  return result
}

const fixtureMetadata = win => win.evaluate(() => {
  const catalog = window.nomiDesktop.modelCatalog
  const vendor = catalog.listVendors().find(value => value.key === 'cliproxy-local')
  return { vendorKey: vendor.key, baseUrl: vendor.baseUrlHint, hasApiKey: vendor.hasApiKey,
    hasStoredApiKey: vendor.hasStoredApiKey, authType: vendor.authType,
    credentialVerificationPending: vendor.credentialVerificationPending,
    modelIds: catalog.listModels().filter(value => value.vendorKey === vendor.key).map(value => value.modelKey) }
})

try {
  for (const spec of specs) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-cliproxy-ui-${spec.locale}-`))
    const entry = { locale: spec.locale, shots: [], layouts: [], profileRemoved: false }
    report.locales.push(entry)
    let instance
    try {
      instance = await launchNomiApp({
        name: `cliproxy-ui-${spec.locale}`, tempRoot, syntheticCredentialStorage: true, settleMs: 0,
        args: ['--no-proxy-server'], viewportSize: { width: 1280, height: 933 },
        mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')],
        env: { NOMI_WALK_NET_LOG: path.join(tempRoot, 'network.jsonl') },
        initialLocalStorage: { 'nomi:locale:v1': spec.locale, 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen',
          'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
      })
      const { win } = instance
      win.setDefaultTimeout(30_000)
      await win.evaluate(async ({ baseUrl }) => {
        const catalog = window.nomiDesktop.modelCatalog
        await catalog.upsertVendor({ key: 'cliproxy-local', name: 'CLIProxy', baseUrlHint: baseUrl, providerKind: 'openai-compatible', authType: 'bearer', enabled: true })
        await catalog.upsertVendorApiKey('cliproxy-local', { apiKey: 'synthetic-ui-only-key', enabled: true })
        for (const [modelKey, kind] of [['gpt-6-sol', 'text'], ['gpt-image-2', 'image']]) {
          await catalog.upsertModel({ vendorKey: 'cliproxy-local', modelKey, labelZh: modelKey, kind, enabled: true })
        }
      }, { baseUrl })
      await win.reload()
      entry.initialMetadata = await fixtureMetadata(win)
      const snap = async name => {
        const file = path.join(evidence, `${spec.locale}-${name}.png`)
        await screenshotSettled(win, { path: file })
        entry.shots.push(file)
      }
      const openHome = async () => {
        await clickOrFail(win.locator('[data-testid="open-model-settings"]').first(), 'Open model settings')
        await expect(win.locator('[data-model-settings-page="home"]')).toBeVisible()
      }
      await openHome()
      const actions = win.locator('[data-model-home-api-actions="cliproxy-local"]')
      if (await actions.count()) await actions.scrollIntoViewIfNeeded()
      await snap('home')
      await expect(actions.getByRole('button', { name: spec.edit, exact: true })).toBeVisible()
      await expect(actions.getByRole('button', { name: spec.add, exact: true })).toBeVisible()
      entry.layouts.push(await visibleLayout(win, actions))

      await clickOrFail(actions.getByRole('button', { name: spec.edit, exact: true }), 'Edit existing connection')
      const detail = win.locator('[data-model-settings-page="connection"][data-model-settings-vendor="cliproxy-local"]')
      await expect(detail).toBeVisible()
      const urlEdit = detail.getByRole('button', { name: spec.locale === 'zh-CN' ? '编辑 CLIProxy 接入地址' : 'Edit CLIProxy connection address', exact: true })
      await clickOrFail(urlEdit, 'Open URL editor')
      const urlInput = detail.locator('[data-model-connection-field="baseUrl"]')
      await expect(urlInput).toHaveValue(baseUrl)
      const configuredUrl = baseUrl.replace('/v1', '/configured/v1')
      await urlInput.fill(configuredUrl)
      await clickOrFail(detail.locator('[data-model-connection-save="baseUrl"]'), 'Save fixture URL')
      await clickOrFail(detail.getByRole('button', { name: spec.replace, exact: true }), 'Open API Key editor')
      const keyInput = detail.locator('[data-model-connection-field="apiKey"]')
      await expect(keyInput).toHaveAttribute('type', 'password')
      await expect(keyInput).toHaveValue('')
      await snap('key-editor')
      await keyInput.fill('synthetic-ui-only-replacement')
      await keyInput.press('Enter')
      await expect(keyInput).toBeHidden()
      await expect(detail.getByText(spec.pending, { exact: true })).toBeVisible()
      await snap('connection')

      // Close and reopen the real settings surface to verify the isolated persisted edits.
      await win.keyboard.press('Escape')
      await win.keyboard.press('Escape')
      await openHome()
      await clickOrFail(actions.getByRole('button', { name: spec.edit, exact: true }), 'Reopen saved connection')
      await expect(detail.getByText(spec.pending, { exact: true })).toBeVisible()
      await clickOrFail(urlEdit, 'Reopen saved URL editor')
      await expect(urlInput).toHaveValue(configuredUrl)
      await urlInput.press('Escape')
      await clickOrFail(detail.getByRole('button', { name: spec.replace, exact: true }), 'Reopen empty key replacement')
      await expect(keyInput).toHaveValue('')
      await clickOrFail(detail.getByRole('button', { name: spec.cancel, exact: true }), 'Cancel key editing')
      entry.metadata = await fixtureMetadata(win)
      expect(entry.metadata.hasStoredApiKey).toBe(true)
      expect(entry.metadata.hasApiKey).toBe(false)
      expect(entry.metadata.modelIds.sort()).toEqual(['gpt-6-sol', 'gpt-image-2'])
      await clickOrFail(detail.locator('[data-model-settings-back]'), 'Return to connection list')
      await clickOrFail(actions.getByRole('button', { name: spec.add, exact: true }), 'Open existing model picker')
      const picker = win.locator('[data-model-settings-page="add"]')
      await expect(picker).toBeVisible()
      await clickOrFail(picker.getByRole('button', { name: spec.fetch, exact: true }), 'Explicit GET-only fixture list')
      const extra = picker.getByRole('button', { name: 'gpt-6-extra-fixture', exact: true })
      await expect(extra).toBeVisible()
      await clickOrFail(extra, 'Select an additional exact model ID')
      await snap('picker')
      // Do not click self-check: this walk validates configuration/discovery, not paid verification.
      await clickOrFail(picker.getByRole('button', { name: spec.cancel, exact: true }), 'Leave picker without self-check')
      if (await detail.isVisible()) await clickOrFail(detail.locator('[data-model-settings-back]'), 'Return home')
      await win.setViewportSize({ width: 1000, height: 760 })
      await expect(actions).toBeVisible()
      entry.layouts.push(await visibleLayout(win, actions))
      await snap('home-narrow')
      if (spec.locale === 'en') await expectNoCjkInEnglishDom(win)
      const netLog = fs.readFileSync(path.join(tempRoot, 'network.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      expect(netLog.some(value => value.kind === 'guard-loaded')).toBe(true)
      expect(netLog.some(value => value.kind === 'guard-error')).toBe(false)
      entry.blockedNetworkAttempts = netLog.filter(value => value.kind === 'blocked').length
      entry.status = 'passed'
    } catch (error) {
      if (instance) {
        const file = path.join(evidence, `${spec.locale}-failure.png`)
        try {
          await instance.win.screenshot({ path: file })
          entry.shots.push(file)
          entry.failureMetadata = await fixtureMetadata(instance.win)
        } catch (captureError) { entry.failureCaptureError = String(captureError?.message || captureError) }
      }
      throw error
    } finally {
      if (instance) await instance.close()
      fs.rmSync(tempRoot, { recursive: true, force: true })
      entry.profileRemoved = !fs.existsSync(tempRoot)
    }
  }
  expect(report.requests.every(request => request.method === 'GET')).toBe(true)
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  // Error output contains no request headers, credential payloads or private logs.
  report.error = String(error?.message || error)
  process.exitCode = 1
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  fs.writeFileSync(path.join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status: report.status, report: path.join(evidence, 'report.json'), locales: report.locales.map(value => ({ locale: value.locale, status: value.status, profileRemoved: value.profileRemoved })) }))
}
