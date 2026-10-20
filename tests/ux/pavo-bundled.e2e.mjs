// Local Electron integration only: no remote Provider traffic, no paid generation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { launchNomiApp } from './_launchApp.mjs'

const reportDir = process.env.NOMI_PAVO_REPORT_DIR || path.resolve('verification/pavo-bundled')
fs.mkdirSync(reportDir, { recursive: true })
const portServer = net.createServer()
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
const port = portServer.address().port
await new Promise(resolve => portServer.close(resolve))
const serverUrl = `http://127.0.0.1:${port}`
const fixture = `<html><head><meta charset="utf-8"><title>Local Pavo fixture</title></head><body>
<select><option>Agnes Video 2.5 Flash</option></select>
<select><option>全能模式</option><option>首尾帧</option></select>
<div role="tooltip">设置
<div><button aria-checked="true">16:9</button><button>9:16</button><button>1:1</button></div>
<div><button aria-checked="true">720P</button></div>
<div><button aria-checked="true">5s</button><button>10s</button></div>
</div>
<script>document.querySelectorAll('[role=tooltip] button').forEach(button=>button.onclick=()=>{
  button.parentElement.querySelectorAll('button').forEach(item=>item.setAttribute('aria-checked',String(item===button)));
});</script>
<textarea placeholder="输入提示词"></textarea>
<button onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1)">生成</button>
</body></html>`
const report = { startedAt: new Date().toISOString(), providerRequests: 0, paidSubmissions: 0, checks: [] }
let runtime
let serverPid
let electronProcess
try {
  runtime = await launchNomiApp({ name: 'pavo-bundled', env: { NOMI_E2E_SMOKE: '1', NOMI_PAVO_WEB_REAL_SUBMIT: '0' } })
  const { app, win } = runtime
  electronProcess = app.process()
  const catalog = await win.evaluate(() => {
    const mc = window.nomiDesktop.modelCatalog
    return { vendor: mc.listVendors().some(v => v.key === 'pavo-web'), model: mc.listModels({ kind: 'video' }).some(m => m.modelKey === 'pavo-agnes-video-2.5-flash'), ipc: Boolean(window.nomiDesktop.pavoWeb) }
  })
  assert.deepEqual(catalog, { vendor: true, model: true, ipc: true })
  report.checks.push('Pavo vendor, video model and desktop IPC seeded')
  const runner = await app.evaluate(async ({ app }, { fixture, serverUrl }) => {
    const require = process.mainModule.require.bind(process.mainModule)
    const path = require('node:path')
    const runner = require(path.join(app.getAppPath(), 'dist-electron/pavoWeb/runner.js'))
    // Intercept the entire runner HTTPS partition so no external request can leave the fixture.
    await runner.pavoWebRunnerSession().protocol.handle('https', () => new Response(fixture, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    return runner.pavoWebStartRunner(serverUrl)
  }, { fixture, serverUrl })
  serverPid = runner.serverPid
  report.fixtureInfo = await app.evaluate(async ({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('panel.html'))
    return panel?.webContents.executeJavaScript(`(async () => {
      const tabs = await chrome.tabs.query({url:'https://app.pavo-ai.cn/*'});
      return Promise.all(tabs.map(async tab => ({id:tab.id,url:tab.url,info:await chrome.tabs.sendMessage(tab.id,{action:'getPageInfo'}).catch(e=>String(e))})));
    })()`)
  }).catch(error => error.message)
  report.panelConnection = await app.evaluate(async ({ BrowserWindow }, serverUrl) => {
    const panel = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('panel.html'))
    return panel?.webContents.executeJavaScript(`(async () => {
      const stored = await chrome.storage.local.get(['apiBaseUrl', 'apiToken']);
      const health = await fetch(stored.apiBaseUrl + '/', {headers:{'X-Nomi-Token':stored.apiToken},signal:AbortSignal.timeout(3000)})
        .then(async r=>({status:r.status,body:await r.json()})).catch(e=>({error:e.message}));
      return {configuredUrl:stored.apiBaseUrl,expectedUrl:${JSON.stringify(serverUrl)},hasToken:Boolean(stored.apiToken),
        health,locks:await navigator.locks.query(),connectionLabel:document.getElementById('bridgeStatus').textContent};
    })()`)
  }, serverUrl).catch(error => ({error:error.message}))
  assert.equal(runner.available, true)
  assert.equal(runner.clientOnline, true, runner.error)
  assert.ok(runner.extensionDir.endsWith('/integrations/pavo-web-adapter'))
  assert.equal(runner.serverManaged, true)
  report.checks.push('Bundled extension loaded in Electron, managed bridge and SSE connected')
  const result = await app.evaluate(async ({ app }, serverUrl) => {
    const require = process.mainModule.require.bind(process.mainModule)
    const path = require('node:path')
    const bridge = require(path.join(app.getAppPath(), 'dist-electron/pavoWeb/bridge.js'))
    const auth = require(path.join(app.getAppPath(), 'dist-electron/pavoWeb/auth.js'))
    const request = { kind: 'text_to_video', prompt: 'Local dry run fixture only', extras: { idempotencyKey: 'pavo-e2e-dry', realSubmit: false } }
    const first = await bridge.submitPavoWebTask({ request, vendorBaseUrl: serverUrl })
    const duplicate = await bridge.submitPavoWebTask({ request, vendorBaseUrl: serverUrl })
    const poll = async () => (await fetch(`${serverUrl}/api/tasks/${encodeURIComponent(first.taskCode)}`, { headers: auth.pavoWebAuthHeaders() })).json()
    const deadline = Date.now() + 30000
    let task
    do {
      task = (await poll()).task
      if (['completed', 'failed'].includes(task.status)) break
      await new Promise(resolve => setTimeout(resolve, 250))
    } while (Date.now() < deadline)
    return { sameTask: first.taskCode === duplicate.taskCode, status: task.status, error: task.error, taskCode: first.taskCode }
  }, serverUrl)
  assert.equal(result.sameTask, true)
  if (result.status !== 'completed') {
    report.windows = await Promise.all(app.windows().map(async page => ({ url: page.url(), text: (await page.locator('body').innerText().catch(() => '')).slice(-2500) })))
  }
  assert.equal(result.status, 'completed', result.error || result.status)
  const pavo = app.windows().find(page => page.url().startsWith('https://app.pavo-ai.cn'))
  assert.ok(pavo)
  assert.equal(await pavo.evaluate(() => Number(document.body.dataset.clicks || 0)), 0)
  assert.equal(await pavo.locator('textarea').inputValue(), 'Local dry run fixture only')
  report.checks.push('Real extension applies prompt and parameters; duplicate intents deduplicated; zero generation clicks')
  await win.screenshot({ path: path.join(reportDir, 'nomi-library.png') })
  await pavo.screenshot({ path: path.join(reportDir, 'pavo-local-fixture.png') })
  const clipPath = path.join(reportDir, 'local-fixture.mp4')
  const require = createRequire(import.meta.url)
  execFileSync(require('@ffmpeg-installer/ffmpeg').path, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipPath])
  const template = JSON.parse(fs.readFileSync(new URL('./fixtures/perf-heavy.project.json', import.meta.url), 'utf8')).payload.generationCanvas.nodes.find(node => node.kind === 'video')
  const imported = await app.evaluate(async ({ app, BrowserWindow }, { serverUrl, clip, template }) => {
    const require = process.mainModule.require.bind(process.mainModule)
    const path = require('node:path')
    const fs = require('node:fs')
    const runtime = require(path.join(app.getAppPath(), 'dist-electron/runtime.js'))
    const auth = require(path.join(app.getAppPath(), 'dist-electron/pavoWeb/auth.js'))
    // Stop the fixture consumer before simulating a completed remote result locally.
    BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('panel.html')).forEach(w => w.close())
    const post = async (route, body) => {
      const response = await fetch(serverUrl + route, { method: 'POST', headers: auth.pavoWebAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Local fixture ${route}: ${response.status}`)
      return response.json()
    }
    // No consumer remains: this simulates the gateway's production completion contract, not a website submission.
    const { taskCodes: [taskCode] } = await post('/api/tasks/push', { idempotencyKey: 'local-output', prompt: 'local output fixture', realSubmit: true, mediaType: 'video', referenceFiles: [] })
    await post('/api/tasks/submit-claim', { taskCode, conversationSnapshotComplete: true, conversationBaselineIds: [] })
    await post('/api/tasks/result-binding', { taskCode, conversationId: 'local-fixture-conversation' })
    const form = new FormData()
    form.set('taskCode', taskCode)
    form.set('quality', 'original-1')
    form.set('mimeType', 'video/mp4')
    form.set('file', new Blob([Buffer.from(clip, 'base64')], { type: 'video/mp4' }), 'local-fixture.mp4')
    const upload = await fetch(serverUrl + '/api/files/upload', { method: 'POST', headers: auth.pavoWebAuthHeaders(), body: form })
    if (!upload.ok) throw new Error(`Local output upload: ${upload.status}`)
    await post('/api/tasks/status', { taskCode, status: 'completed' })
    const project = runtime.createProject({ name: 'Pavo isolated integration fixture', version: 1, payload: {} })
    const catalog = require(path.join(app.getAppPath(), 'dist-electron/catalog/catalogStore.js')).readCatalog()
    const model = catalog.models.find(model => model.modelKey === 'pavo-agnes-video-2.5-flash')
    const entry = { vendor: 'pavo-web', model, request: { kind: 'text_to_video', prompt: 'local output fixture', extras: {} }, projectId: project.id, nodeId: 'pavo-fixture-video', wantedKind: 'video', providerMeta: { serverUrl } }
    runtime.admitTask(taskCode, entry)
    const first = (await runtime.fetchTaskResult({ taskId: taskCode })).result
    runtime.admitTask(taskCode, entry)
    const second = (await runtime.fetchTaskResult({ taskId: taskCode })).result
    const asset = first.assets[0]
    if (!asset) throw new Error(`Local query did not return output: ${JSON.stringify(first)}`)
    const stored = runtime.listProjectAssets({ projectId: project.id }).items
    const node = { ...template, id: 'pavo-fixture-video', title: 'Pavo 本地回传测试', kind: 'video', status: 'success', references: [], history: [], runs: [], result: { id: asset.assetId, type: 'video', url: asset.url, createdAt: 1 }, meta: { ...template.meta, videoWidth: 320, videoHeight: 180, videoAspectRatio: 16 / 9 }, position: { x: 80, y: 80 } }
    runtime.saveProject(project.id, { ...project, draft: false, payload: { generationCanvas: { nodes: [node], edges: [], groups: [], selectedNodeIds: [] } } })
    const persisted = runtime.readProject(project.id)
    return { projectId: project.id, status: first.status, sameAsset: first.assets[0]?.assetId === second.assets[0]?.assetId, assets: stored.length, assetPath: stored[0]?.data?.absolutePath, nodeResultUrl: persisted.payload.generationCanvas.nodes[0].result.url }
  }, { serverUrl, clip: fs.readFileSync(clipPath).toString('base64'), template })
  assert.equal(imported.status, 'succeeded')
  assert.equal(imported.sameAsset, true)
  assert.equal(imported.assets, 1)
  assert.ok(imported.nodeResultUrl.startsWith('nomi-local://'))
  assert.ok(fs.existsSync(imported.assetPath))
  report.localResult = imported
  report.checks.push('Bound local video imported through production task query; repeated queries create one asset; canvas node persisted')
  await win.goto(win.url().split('#')[0] + '#/studio?projectId=' + encodeURIComponent(imported.projectId))
  await win.getByRole('button', { name: '生成', exact: false }).first().click()
  const returnedNode = win.locator('[data-node-id="pavo-fixture-video"]')
  await returnedNode.waitFor()
  await returnedNode.hover()
  await returnedNode.locator('video').waitFor({ state: 'attached' })
  await win.waitForFunction(() => document.querySelector('[data-node-id="pavo-fixture-video"] video')?.readyState >= 2)
  await win.screenshot({ path: path.join(reportDir, 'pavo-canvas-result.png') })
  await app.evaluate(({ app }) => {
    const require = process.mainModule.require.bind(process.mainModule)
    require(require('node:path').join(app.getAppPath(), 'dist-electron/pavoWeb/runner.js')).disposePavoWebRunner()
  })
  await win.getByRole('button', { name: '打开模型设置', exact: true }).click()
  await win.getByText('Pavo Web', { exact: true }).first().click()
  await win.getByRole('button', { name: '登录网页', exact: true }).waitFor()
  assert.equal(await win.getByRole('button', { name: '启动运行器', exact: true }).isEnabled(), true)
  assert.equal(await win.getByText('fetch failed', { exact: true }).count(), 0)
  await win.screenshot({ path: path.join(reportDir, 'pavo-model-setup.png') })
  report.checks.push('Returned video node and Pavo model settings visible in real Nomi renderer')
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = error.message
  if (runtime) report.windows = await runtime.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ url: window.webContents.getURL(), loading: window.webContents.isLoading() }))).catch(() => [])
  if (runtime) report.panelDiagnostics = await runtime.app.evaluate(async ({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('panel.html'))
    return panel ? panel.webContents.executeJavaScript('document.body.innerText.slice(-3500)') : null
  }).catch(() => null)
  throw error
} finally {
  if (runtime) {
    await runtime.app.evaluate(({ app }) => {
      const require = process.mainModule.require.bind(process.mainModule)
      require(require('node:path').join(app.getAppPath(), 'dist-electron/pavoWeb/runner.js')).disposePavoWebRunner()
    }).catch(() => undefined)
    await runtime.close()
    if (electronProcess?.exitCode === null) electronProcess.kill('SIGTERM')
  }
  if (serverPid) {
    try { process.kill(serverPid, 0); report.bridgeCleanup = 'still_running' } catch { report.bridgeCleanup = 'stopped' }
  }
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
