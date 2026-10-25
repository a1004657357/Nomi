// Isolated presentation evidence from actual JSX, not an App/provider acceptance run.
// TSX_TSCONFIG_PATH=tests/ux/fixtures/content-flow.tsconfig.json node --import tsx tests/ux/main-style-content-flow.walk.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as icons from '@tabler/icons-react'
import { createInstance } from 'i18next'
import { chromium } from 'playwright'
import { WorkbenchButton, WorkbenchIconButton } from '../../src/design/actions.tsx'
import { NomiSelect } from '../../src/design/NomiSelect.tsx'
import { cn } from '../../src/utils/cn.ts'
import { qualityLabel } from '../../src/workbench/generationCanvas/nodes/capabilityQualityPresentation.ts'
import { formatVideoFrameTime } from '../../src/workbench/generationCanvas/nodes/videoKeyframeInspectorModel.ts'
import { MODEL3D_CAPTURE_RATIOS } from '../../src/workbench/generationCanvas/nodes/model3d/model3dCamera.ts'
import { contentFlowCases, findContentFlowRow } from '../../scripts/lib/mainStyleContentFlowCases.mjs'

const require = createRequire(import.meta.url)
// The TSX projections load CJS packages; share their provider instances rather than ESM copies.
const { MantineProvider, Menu } = require('@mantine/core')
const { I18nextProvider, useTranslation } = require('react-i18next')
const { resources } = require('../../src/i18n/resources.ts')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const out = path.resolve(process.env.NOMI_STYLE_SHOTS_DIR || path.join(root, 'tests/ux/shots/main-style-content-flow'))
fs.mkdirSync(out, { recursive: true })
const noop = () => {}
const locale = process.env.NOMI_STYLE_LOCALE === 'en' ? 'en' : 'zh-CN'
const i18n = createInstance()
await i18n.init({ lng: locale, resources, initImmediate: false })

function evaluatePresentation(expression, scope) {
  const output = ts.transpileModule(`const result = (${expression});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    fileName: 'row-projection.tsx',
  }).outputText
  // Evaluate only this repository's extracted presentation source, never external input.
  return new Function('scope', `with (scope) { ${output}; return result; }`)(scope)
}

function declaration(file, symbol, scope) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === symbol) {
      return evaluatePresentation(node.getText(source).replace(/^export\s+(?:default\s+)?/, ''), scope)
    }
    if (ts.isVariableStatement(node)) {
      for (const item of node.declarationList.declarations) {
        if (item.name.getText(source) === symbol && item.initializer) return evaluatePresentation(item.initializer.getText(source), scope)
      }
    }
  }
  throw new Error(`Missing presentation declaration: ${symbol}`)
}

const nodes = 'src/workbench/generationCanvas/nodes/'
const scope = {
  React, ...icons, cn, Menu, WorkbenchButton, WorkbenchIconButton, NomiSelect, i18n, useTranslation,
  Math, Number, String, Array, qualityLabel, formatVideoFrameTime, MODEL3D_CAPTURE_RATIOS,
  selectedTargetNodes: [{ id: 'one' }, { id: 'two' }], targetLabel: i18n.t('canvasComponents.image'), targetKind: 'image',
  skipExisting: true, setSkipExisting: noop, enabled: true, loading: false, models: [{}], setEnabled: noop,
  isMoodRecipe: false, selectedRecipe: { id: 'image.multiview.custom' }, moodOutputCount: 25,
  maxOutputs: 9, outputCount: 6, setOutputCount: noop, moodGenerationMode: 'matrix',
  moodRequestSummary: () => '25 张输出 · 1 次生成任务',
  report: { status: 'warning' }, index: 0, selected: new Set([0, 1, 2]), checked: true,
  review: { verdict: 'accepted', reviewedAt: 1 },
  outputLabel: '当前人像结果', zoom: 1, setBoundedZoom: noop, setZoom: noop,
  node: { title: '当前项目视频与分镜' }, duration: 8.25, onClose: noop, frameCount: 8,
  setFrameCount: noop, busy: false, extract: noop,
  frames: Array.from({ length: 8 }, (_, index) => ({ timeSeconds: index })), frame: { timeSeconds: 2.5 },
  camera: { target: [0, 1.2, 0] }, updateTarget: noop, ratio: '16:9', longEdge: 1920,
  setRatio: noop, setLongEdge: noop, persistCaptureSettings: noop, handleReset: noop,
  plan: { title: '当前分镜头脚本' }, rows: Array.from({ length: 12 }, () => ({})),
  agentFilling: false, autofillWithAgent: noop, containAllRowNodes: noop,
  compactStoryboardTable: noop, polishAllVideoPrompts: noop, fitStoryboardTable: noop, setFullscreen: noop,
}
for (const [file, names] of [
  ['src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx', ['inputClass']],
  [nodes + 'CapabilityHumanReviewControl.tsx', ['reviewLabel']],
  [nodes + 'CapabilityQualityReportPopover.tsx', ['qualityTone', 'CapabilityQualityStatusIcon']],
  [nodes + 'model3d/Model3DCameraNodeBody.tsx', ['CameraNumberField', 'CAPTURE_LONG_EDGES']],
  [nodes + 'VideoKeyframeInspectorDialog.tsx', ['FRAME_COUNTS']],
  [nodes + 'render/ImageComparisonNodeBody.tsx', ['IconButton']],
]) {
  for (const name of names) scope[name] = declaration(file, name, scope)
}

const markup = contentFlowCases.map((entry) => {
  const context = { ...scope, review: entry.id === 'human-unreviewed' ? undefined : scope.review }
  if (entry.id === 'candidate') context.selected = true
  const row = evaluatePresentation(findContentFlowRow(root, entry).text, context)
  const html = renderToStaticMarkup(React.createElement(I18nextProvider, { i18n },
    React.createElement(MantineProvider, { forceColorScheme: 'light' }, row)))
  return `<section data-case="${entry.id}"><h2>${entry.id}</h2><div data-frame class="${entry.dark ? 'bg-nomi-ink text-nomi-paper' : 'bg-nomi-paper text-nomi-ink'}" style="max-width:${entry.width}px;${entry.overlay ? 'aspect-ratio:4/5;position:relative;' : ''}">${html}</div></section>`
}).join('\n')
const htmlFile = path.join(out, 'gallery.html')
const cssFile = path.join(out, 'gallery.css')
fs.writeFileSync(htmlFile, markup)
execFileSync('pnpm', ['exec', 'tailwindcss', '-c', 'tailwind.config.ts', '--content', htmlFile, '-o', cssFile], { cwd: root, stdio: 'pipe' })
const css = fs.readFileSync(require.resolve('@mantine/core/styles.css'), 'utf8') + fs.readFileSync(cssFile, 'utf8')
const documentHtml = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Nomi Content Flow Verification</title><style>${css}</style><style>html,body{height:auto;min-height:100%;overflow:visible}body{margin:0;background:var(--nomi-bg);font-family:var(--nomi-font-sans)}main{padding:16px;display:grid;gap:18px}section{min-width:0}h2{font-size:12px;font-weight:500;color:var(--nomi-ink-60);margin:0 0 6px}[data-frame]{width:100%;border:1px solid var(--nomi-line);min-width:0}body>style{display:none}</style></head><body><main>${markup}</main></body></html>`
fs.writeFileSync(htmlFile, documentHtml)

const executablePath = process.env.NOMI_STYLE_CHROMIUM || chromium.executablePath()
assert.ok(fs.existsSync(executablePath), 'Set NOMI_STYLE_CHROMIUM to an installed Chromium; never download one during this walk')
const browser = await chromium.launch({ executablePath, headless: true })
const results = []
try {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('pageerror', (error) => consoleErrors.push(String(error)))
  await page.route('**/*', (route) => route.abort())
  for (const width of [360, 1280]) {
    for (const stress of [false, true]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.setContent(documentHtml)
      assert.equal(await page.title(), 'Nomi Content Flow Verification')
      assert.equal(await page.locator('[data-case]').count(), contentFlowCases.length)
      if (stress) await page.evaluate(() => {
        for (const frame of document.querySelectorAll('[data-frame]')) {
          const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)
          let text
          while ((text = walker.nextNode())) {
            if (text.textContent.trim() && !text.parentElement.closest('style,svg,button')) {
              text.textContent += ' 长文本验收 LongUnbrokenTitleWithoutSpacesLongUnbrokenTitleWithoutSpaces 并保留所有附属信息'
              break
            }
          }
        }
      })
      const findings = await page.evaluate(() => {
        const failures = []
        const rectOf = (rect) => ({ x: rect.x, y: rect.y, w: rect.width, h: rect.height })
        for (const section of document.querySelectorAll('[data-case]')) {
          const id = section.getAttribute('data-case')
          const frame = section.querySelector('[data-frame]')
          const bounds = frame.getBoundingClientRect()
          if (frame.scrollWidth > frame.clientWidth + 1) failures.push({ id, kind: 'overflow', client: frame.clientWidth, scroll: frame.scrollWidth })
          const boxes = [...frame.querySelectorAll('button,input,select')].filter((element) => element.getBoundingClientRect().width > 0).map((element) => ({ element, rect: element.getBoundingClientRect(), type: 'control' }))
          const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)
          let text
          while ((text = walker.nextNode())) {
            if (!text.textContent.trim() || text.parentElement.closest('style,svg,button,.truncate')) continue
            const range = document.createRange()
            range.selectNodeContents(text)
            for (const rect of range.getClientRects()) if (rect.width && rect.height) boxes.push({ element: text.parentElement, rect, type: 'text' })
          }
          for (const box of boxes) {
            if (box.rect.left < bounds.left - 1 || box.rect.right > bounds.right + 1) failures.push({ id, kind: 'outside-frame', type: box.type, rect: rectOf(box.rect) })
          }
          for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
            const first = boxes[a], second = boxes[b]
            if (first.element.contains(second.element) || second.element.contains(first.element)) continue
            const dx = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left)
            const dy = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top)
            if (dx > 1 && dy > 1) failures.push({ id, kind: 'overlap', a: first.type, b: second.type, dx, dy })
          }
        }
        return failures
      })
      const screenshot = path.join(out, `${width}-${stress ? 'long' : 'normal'}.png`)
      const screenshotHeight = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, document.querySelector('main').getBoundingClientRect().bottom)))
      await page.setViewportSize({ width, height: screenshotHeight })
      await page.evaluate(async () => { await document.fonts.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
      await page.screenshot({ path: screenshot, fullPage: true })
      results.push({ width, stress, cases: contentFlowCases.length, screenshotHeight, screenshot, findings })
      assert.deepEqual(findings, [], JSON.stringify({ width, stress, findings }))
      await page.setViewportSize({ width, height: 1000 })
      for (const selector of [`[data-case="portrait"] button[aria-label="${i18n.t('canvasComponents.closeSourceComparison')}"]`, `[data-case="keyframe-header"] button[aria-label="${i18n.t('canvasComponents.close')}"]`, `[data-case="image-close"] button[aria-label="${i18n.t('canvasComponents.closeFullscreenComparison')}"]`]) {
        const button = page.locator(selector)
        await button.scrollIntoViewIfNeeded()
        assert.ok(await button.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return rect.width >= 32 && rect.height >= 32 && (hit === element || element.contains(hit))
        }), selector)
      }
      const checkbox = page.locator('[data-case="batch"] input[type="checkbox"]')
      await checkbox.uncheck()
      assert.equal(await checkbox.isChecked(), false)
      await checkbox.check()
      assert.equal(await checkbox.isChecked(), true)
    }
  }
  assert.deepEqual(consoleErrors, [])
  fs.writeFileSync(path.join(out, 'layout.json'), JSON.stringify({ boundary: 'actual-jsx-projection-not-app-acceptance', browserPlugin: 'not available', results, consoleErrors }, null, 2))
  console.log(JSON.stringify({ cases: contentFlowCases.length, scenarios: results.length, screenshots: results.map((result) => result.screenshot), consoleErrors }))
} finally {
  await browser.close()
}
