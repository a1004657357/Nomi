import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import i18next from 'i18next'

const root = fileURLToPath(new URL('../', import.meta.url))
const modelFile = 'src/ui/browser/dialog/NomiBrowserDialogModel.tsx'
const viewFile = 'src/ui/browser/dialog/NomiBrowserDialogView.tsx'
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const parse = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const model = parse(modelFile)
const type = model.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'BrowserStartShortcut')
const declaration = model.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(node => node.name.getText(model) === 'BROWSER_START_SHORTCUTS'))
let labelExpression
const view = parse(viewFile)
const visit = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(view) === 'siteLabel') labelExpression = node.initializer.getText(view)
  ts.forEachChild(node, visit)
}
visit(view)
const renderLabel = new Function('site', 't', `return ${labelExpression}`)
const defaults = new Function(ts.transpileModule(declaration.getText(model).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nreturn BROWSER_START_SHORTCUTS')()

test('actual default data and view expression satisfy the exact-one-label typed boundary', () => {
  const text = `${type.getText(model)}\n${declaration.getText(model)}
declare const t: (key: string) => string;
function display(site: BrowserStartShortcut): string { return ${labelExpression}; }
const custom: BrowserStartShortcut = { label: '我的自定义站点', url: 'https://example.test/', hintKey: 'hint' };
const localized: BrowserStartShortcut = { labelKey: 'canvasComponents.jimengWeb', url: 'https://example.test/', hintKey: 'hint' };
// @ts-expect-error A visible identity is required.
const missing: BrowserStartShortcut = { url: 'https://example.test/', hintKey: 'hint' };
// @ts-expect-error Raw text and a display key cannot compete for ownership.
const ambiguous: BrowserStartShortcut = { label: '我的原文', labelKey: 'canvasComponents.jimengWeb', url: 'https://example.test/', hintKey: 'hint' };
void [custom, localized, missing, ambiguous, display];
`
  const file = path.join(root, '.tmp/browser-shortcut-type-fixture.ts')
  const options = { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022 }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, ...rest) => name === file ? ts.createSourceFile(name, text, languageVersion, true) : getSourceFile(name, languageVersion, ...rest)
  const program = ts.createProgram([file], options, host)
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(diagnostic => `${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`), [])
})

test('every default shortcut has exactly one display identity and retains URL/hint fields', () => {
  assert.equal(defaults.length, 10)
  for (const site of defaults) {
    assert.equal(Number(typeof site.label === 'string') + Number(typeof site.labelKey === 'string'), 1, site.url)
    assert.match(site.url, /^https:\/\//)
    assert.equal(typeof site.hintKey, 'string')
  }
})

test('real locale resources switch keyed defaults but never translate or mutate raw custom labels', async () => {
  const locale = file => {
    const exports = {}
    new Function('exports', ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports)
    return exports
  }
  const canvas = locale('src/i18n/locales/canvasComponents.ts')
  const browser = locale('src/i18n/locales/browserAssets.ts')
  const i18n = i18next.createInstance()
  await i18n.init({ lng: 'zh-CN', fallbackLng: false, resources: { 'zh-CN': { translation: { canvasComponents: canvas.zhCanvasComponents, browserAssets: browser.zhBrowserAssets } }, en: { translation: { canvasComponents: canvas.enCanvasComponents, browserAssets: browser.enBrowserAssets } } }, interpolation: { escapeValue: false } })
  defaults.forEach(Object.freeze)
  const custom = Object.freeze({ label: '即梦 Web / 我的站点', url: 'https://custom.example.test/', hintKey: 'browserAssets.sites.jimengHint' })
  const looksLikeKey = Object.freeze({ ...custom, label: 'canvasComponents.jimengWeb' })
  const before = JSON.stringify([defaults, custom, looksLikeKey])
  for (const lng of ['zh-CN', 'en', 'zh-CN']) {
    await i18n.changeLanguage(lng)
    const t = key => i18n.t(key)
    assert.equal(renderLabel(defaults.find(site => site.url.includes('jimeng.')), t), lng === 'en' ? 'Jimeng Web' : '即梦 Web')
    assert.equal(renderLabel(defaults.find(site => site.url.includes('xiaohongshu.')), t), lng === 'en' ? 'Xiaohongshu' : '小红书')
    assert.equal(renderLabel(defaults[0], t), 'ChatGPT Images')
    assert.equal(renderLabel(custom, t), custom.label)
    assert.equal(renderLabel(looksLikeKey, t), looksLikeKey.label)
    assert.equal(JSON.stringify([defaults, custom, looksLikeKey]), before)
  }
})
