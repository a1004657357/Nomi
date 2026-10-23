import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { expect } from './_assert.mjs'

const root = process.env.NOMI_ACCEPTANCE_UI_ROOT
const sourceRoot = process.env.NOMI_ACCEPTANCE_SOURCE_ROOT
if (!root || !sourceRoot || !path.isAbsolute(root) || !path.isAbsolute(sourceRoot) || fs.existsSync(root)) {
  throw new Error('Fresh absolute UI root and retained batch root required')
}
const source = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'report.json'), 'utf8'))
const report = { startedAt: new Date().toISOString(), state: 'running', sourceRunId: source.runId, locales: [] }
fs.mkdirSync(root, { recursive: true })
try {
  for (const locale of ['zh-CN', 'en']) {
    const tempRoot = path.join(root, locale)
    const projectsDir = path.join(tempRoot, 'projects')
    fs.cpSync(path.join(sourceRoot, 'projects'), projectsDir, { recursive: true })
    const launched = await launchNomiApp({ name: 'cliproxy-size-warning', tempRoot, projectsDir,
      mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')],
      initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen',
        'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' } })
    try {
      const nodeId = source.cases[0].nodeId
      await launched.app.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()[0].webContents.send('nomi:production-deep-link', payload)
      }, { projectId: source.projectId, nodeId })
      let win = launched.win
      await expect.poll(() => {
        win = launched.app.windows().find(page => page.url().includes(source.projectId)) ?? launched.win
        return win.locator(`[data-node-id="${nodeId}"]`).count()
      }, { timeout: 60_000 }).toBeGreaterThan(0)
      const node = win.locator(`[data-node-id="${nodeId}"]`).first()
      await expect.poll(() => node.locator('img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0)),
        { timeout: 30_000 }).toBe(true)
      const assetFile = path.join(projectsDir, path.relative(path.join(sourceRoot, 'projects'), source.cases[0].asset.path))
      const verdict = await launched.app.evaluate(async (_, input) => {
        const review = await import(input.module)
        const i18n = await import(input.i18n)
        const setLocale = i18n.setDesktopLocale ?? i18n.default.setDesktopLocale
        setLocale(input.locale)
        return (review.scheduleTechnicalReview ?? review.default.scheduleTechnicalReview)({
          projectId: input.projectId, nodeId: input.nodeId, absolutePath: input.file,
          assetUrl: input.url, type: 'image', expectedImageSize: '1024x1024' })
      }, { module: pathToFileURL(path.join(repoRoot, 'dist-electron/review/reviewTrace.js')).href,
        i18n: pathToFileURL(path.join(repoRoot, 'dist-electron/i18n.js')).href,
        locale, projectId: source.projectId, nodeId, file: assetFile,
        url: `nomi-local://asset/${source.projectId}/${path.relative(projectsDir, assetFile).split(path.sep).slice(1).join('/')}` })
      assert.equal(verdict.imageSizeValidation.status, 'mismatch')
      const badge = node.locator('[data-technical-review="suspect"]')
      await expect(badge).toBeVisible({ timeout: 15_000 })
      const title = await badge.getAttribute('title')
      assert.ok(title?.includes('1024') && title.includes('1254'))
      await win.screenshot({ path: path.join(root, `${locale}.png`) })
      report.locales.push({ locale, state: 'passed', imageDecoded: true, warningTitle: title,
        requested: verdict.imageSizeValidation.requested, actual: verdict.imageSizeValidation.actual })
    } finally { await launched.close() }
  }
  report.state = 'passed'
} catch (error) {
  report.state = 'failed'
  report.error = String(error.message).slice(0, 500)
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
