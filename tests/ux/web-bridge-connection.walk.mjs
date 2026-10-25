// A bounded real-component journey, not an Electron/settings or generation roundtrip.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import { build, preview } from 'vite'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const fixturePath = '/tests/ux/fixtures/web-bridge-connection/index.html'
export const WEB_BRIDGE_CASES = [
  { bridge: 'jimengWeb', locale: 'zh-CN' }, { bridge: 'jimengWeb', locale: 'en' },
  { bridge: 'pavoWeb', locale: 'zh-CN' }, { bridge: 'pavoWeb', locale: 'en' },
]

export async function createWebBridgeJourneyHarness() {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-web-bridge-ui-vite-'))
  let server, browser
  try {
    // Compile only this real-component fixture; preview has no dev/HMR client or App launcher.
    const outDir = path.join(cacheDir, 'dist')
    await build({ root: repoRoot, configFile: false, publicDir: false, cacheDir, logLevel: 'error',
      build: { outDir, emptyOutDir: true, rollupOptions: { input: path.join(repoRoot, fixturePath.slice(1)) } },
    })
    server = await preview({ root: repoRoot, configFile: false, publicDir: false, logLevel: 'error',
      build: { outDir }, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
    })
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    browser = await chromium.launch({ headless: true })
    return {
      async open({ bridge, locale, missing }) {
        const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' })
        const page = await context.newPage()
        const blocked = [], pageErrors = [], requests = []
        await context.route('**/*', async route => {
          const request = route.request()
          const address = new URL(request.url())
          if (address.origin !== origin || request.method() !== 'GET') {
            blocked.push({ method: request.method(), url: request.url() })
            await route.abort('blockedbyclient')
          } else {
            requests.push({ method: request.method(), url: request.url() })
            await route.continue()
          }
        })
        await context.routeWebSocket('**/*', socket => {
          blocked.push({ method: 'WEBSOCKET', url: socket.url() })
          socket.close()
        })
        page.on('pageerror', error => pageErrors.push(error.message))
        const query = new URLSearchParams({ bridge, locale, ...(missing ? { missing } : {}) })
        try {
          await page.goto(`${origin}${fixturePath}?${query}`)
          await expect(page.getByTestId('web-bridge-fixture')).toBeAttached()
          return { page, blocked, pageErrors, requests, close: () => context.close() }
        } catch (error) { await context.close(); throw error }
      },
      async close() {
        await browser.close()
        await server.close()
        fs.rmSync(cacheDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await browser?.close()
    await server?.close()
    fs.rmSync(cacheDir, { recursive: true, force: true })
    throw error
  }
}

export async function exerciseWebBridgeJourney(ui, { bridge, locale }) {
  const { page } = ui
  const english = locale === 'en'
  const text = english
    ? { start: 'Start runner', stop: 'Stop runner', login: 'Open login', admin: 'Extension admin', refresh: 'Refresh status',
      offline: 'Local extension bridge is offline', server: 'Service online', online: 'Extension online',
      noClient: 'Task service online, browser extension offline', missing: 'Extension directory not found. Check that the local adapter exists.' }
    : { start: '启动桥接', stop: '停止桥接', login: '登录网页', admin: '扩展管理', refresh: '刷新状态',
      offline: '本地扩展桥未连接', server: '服务在线', online: '扩展在线',
      noClient: '任务服务在线，网页扩展未在线', missing: '未找到扩展目录；请检查本机适配器是否存在。' }
  const button = key => page.getByRole('button', { name: text[key], exact: true })
  const snapshot = () => page.evaluate(() => structuredClone({ calls: window.webBridgeFixture.calls, changed: window.webBridgeFixture.changed }))
  const checks = []
  await expect(page.getByText(text.offline, { exact: true })).toBeVisible()
  await expect(button('stop')).toBeDisabled()
  expect((await snapshot()).calls).toEqual([])
  checks.push('offline is not connected; stop is disabled; zero bridge operations')

  await page.evaluate(() => { window.webBridgeFixture.pauseNext = true })
  await button('start').click()
  for (const key of ['start', 'stop', 'login', 'admin']) await expect(button(key)).toBeDisabled()
  await button('start').evaluate(element => element.click())
  expect((await snapshot()).calls).toEqual([{ bridgeKey: bridge, method: 'startRunner', args: [] }])
  await page.evaluate(() => window.webBridgeFixture.release())
  await expect(page.getByText(text.server, { exact: true })).toBeVisible()
  await expect(page.getByText(text.noClient, { exact: true })).toBeVisible()
  await expect(button('stop')).toBeEnabled()
  checks.push('busy blocks actions; start reaches only the selected bridge; server-only is not extension-online')

  await button('login').click()
  await expect(button('login')).toBeEnabled()
  expect((await snapshot()).calls.at(-1)).toEqual({ bridgeKey: bridge, method: 'openLogin', args: [] })
  // Login invocation alone is not proof of a signed-in or live extension session.
  await expect(page.getByText(text.noClient, { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const status = window.webBridgeFixture.status
    Object.assign(status.server, { sseClients: 1, taskTotal: 0 })
    Object.assign(status.runner, { clientOnline: true })
    status.likelyLoggedIn = true
    status.cookieCount = 2
  })
  await button('refresh').click()
  await expect(page.getByText(text.online, { exact: true })).toBeVisible()
  await expect(page.getByText(english ? 'The dedicated Nomi web session currently has 2 cookies.' : '当前 Nomi 专用网页会话已有 2 条 Cookie。', { exact: true })).toBeVisible()
  await button('admin').click()
  await expect(button('admin')).toBeEnabled()
  expect((await snapshot()).calls.at(-1)).toEqual({ bridgeKey: bridge, method: 'openAdmin', args: [`http://fixture.invalid/${bridge}`] })
  checks.push('login is separate from refreshed client status; admin forwards the exact unlocalized server URL')

  const beforeReturned = (await snapshot()).changed
  await page.evaluate(() => { window.webBridgeFixture.failure = 'returned' })
  await button('stop').click()
  await expect(page.getByText('fixture returned failure', { exact: true })).toBeVisible()
  expect((await snapshot()).changed).toBe(beforeReturned + 1)
  await expect(page.getByText(text.online, { exact: true })).toBeVisible()
  await button('stop').click()
  await expect(page.getByText(text.offline, { exact: true })).toBeVisible()
  await expect(page.getByText('fixture returned failure', { exact: true })).toHaveCount(0)
  const beforeThrow = (await snapshot()).changed
  await page.evaluate(() => { window.webBridgeFixture.failure = 'thrown' })
  await button('start').click()
  await expect(page.getByText('fixture thrown failure', { exact: true })).toBeVisible()
  expect((await snapshot()).changed).toBe(beforeThrow)
  await expect(button('start')).toBeEnabled()
  checks.push('returned and thrown failures remain visible, do not fake connection, and release busy state')

  await page.evaluate(() => { window.webBridgeFixture.status.runner.available = false })
  await button('refresh').click()
  await expect(button('start')).toBeDisabled()
  await expect(page.getByText(text.missing, { exact: true })).toBeVisible()
  const final = await snapshot()
  expect(final.calls.map(call => call.method)).toEqual(['startRunner', 'openLogin', 'openAdmin', 'stopRunner', 'stopRunner', 'startRunner'])
  expect(final.calls.every(call => call.bridgeKey === bridge)).toBe(true)
  expect(ui.blocked).toEqual([])
  expect(ui.pageErrors).toEqual([])
  checks.push('missing adapter stays disabled; exact operation ledger contains no generation or cross-bridge calls')
  return { journeyId: 'J17', level: 'component', bridge, locale, status: 'PASS', checks,
    calls: final.calls, blocked: ui.blocked, pageErrors: ui.pageErrors, requests: ui.requests,
    renderedText: await page.getByTestId('web-bridge-fixture').innerText() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const harness = await createWebBridgeJourneyHarness()
  try {
    for (const input of WEB_BRIDGE_CASES) {
      const ui = await harness.open(input)
      try { console.log(JSON.stringify(await exerciseWebBridgeJourney(ui, input))) }
      finally { await ui.close() }
    }
  } finally { await harness.close() }
}
