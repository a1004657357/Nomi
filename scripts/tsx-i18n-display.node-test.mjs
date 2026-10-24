import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import test from 'node:test'
import ts from 'typescript'
import i18next from 'i18next'
import { createRequire } from 'node:module'

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/tsx-i18n-display.json', import.meta.url), 'utf8'))
const localePath = new URL('../src/i18n/locales/canvasComponents.ts', import.meta.url)
function readLocale() {
  assert.ok(fs.existsSync(localePath), 'dedicated display namespace must exist')
  const exports = {}
  new Function('exports', ts.transpile(fs.readFileSync(localePath, 'utf8'), { module: ts.ModuleKind.CommonJS }))(exports)
  return exports
}
function sourceClassHash(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), values = []
  const visit = node => { if (ts.isJsxAttribute(node) && node.name.getText(source) === 'className') values.push(node.getText(source)); ts.forEachChild(node, visit) }
  visit(source)
  return crypto.createHash('sha256').update(values.join('\n')).digest('hex')
}
test('dedicated namespace keeps original Chinese and complete real English interpolation', () => {
  const { zhCanvasComponents: zh, enCanvasComponents: en } = readLocale()
  assert.deepEqual(zh, fixture.zh)
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const [key, value] of Object.entries(en)) {
    assert.ok(value.trim(), key)
    assert.doesNotMatch(value, /[\u3400-\u9fff]/u, key)
    assert.deepEqual([...value.matchAll(/\{\{(.*?)\}\}/g)].map(m => m[1]).sort(), [...zh[key].matchAll(/\{\{(.*?)\}\}/g)].map(m => m[1]).sort(), key)
  }
})
for (const [file, expected] of Object.entries(fixture.files)) {
  test(`${file}: Chinese/English display cases and unchanged layout`, async () => {
    const text = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')
    assert.equal(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0, 'TSX syntax must remain valid')
    const keys = [...new Set([...expected.keys, ...[...text.matchAll(/['"]canvasComponents\.([A-Za-z0-9_]+)['"]/g)].map(m => m[1])])]
    assert.ok(keys.length || text.includes('translateCanvasComponentText'), 'component must resolve display copy at the locale boundary')
    assert.equal(sourceClassHash(file, text), expected.classHash, 'localization must retain approved layout classes')
    const { zhCanvasComponents: zh, enCanvasComponents: en } = readLocale()
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'zh-CN', fallbackLng: false, resources: { 'zh-CN': { translation: { canvasComponents: zh } }, en: { translation: { canvasComponents: en } } }, interpolation: { escapeValue: false } })
    for (const lng of ['zh-CN', 'en']) {
      await i18n.changeLanguage(lng)
      for (const key of keys) {
        const args = Object.fromEntries([...fixture.zh[key].matchAll(/\{\{(.*?)\}\}/g)].map((m, i) => [m[1], `VALUE_${i}`]))
        const expectedText = (lng === 'en' ? en : zh)[key].replace(/\{\{(.*?)\}\}/g, (_, name) => args[name])
        assert.equal(i18n.t('canvasComponents.' + key, args), expectedText, `${lng}:${key}`)
      }
    }
  })
}
test('mixed-use canonical defaults remain language-independent', () => {
  const inspector = fs.readFileSync(new URL('../src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx', import.meta.url), 'utf8')
  assert.match(inspector, /label: `机位 \$\{index \+ 1\}`/)
  assert.match(inspector, /shotSize: '中景'/)
  assert.match(inspector, /setResourceLabel\(`\$\{sourceTitle\} 资源`\)/)
  assert.match(inspector, /source: '用户自有素材'/)
  const editor = fs.readFileSync(new URL('../src/workbench/generationCanvas/components/CapabilityCameraOutputsEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /value=\{output.label\}/)
  assert.match(editor, /\['特写', '近景', '中景', '全景'\]/)
  assert.match(editor, /shotSize: value/)
  const scene = fs.readFileSync(new URL('../src/workbench/generationCanvas/nodes/Scene3DEditor.tsx', import.meta.url), 'utf8')
  assert.equal([...scene.matchAll(/message\.includes\('已取消'\)/g)].length, 2, 'protocol error classification must not depend on display language')
})

test('actual rendered display boundaries switch language without changing editable values', async () => {
  const require = createRequire(import.meta.url)
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { MantineProvider } = require('@mantine/core')
  const { I18nextProvider } = require('react-i18next')
  const appI18n = require('../src/i18n/index.ts').default
  const { translateCanvasComponentText } = require('../src/i18n/CanvasComponentText.tsx')
  const { CodexImagegenManage } = require('../src/ui/onboarding/CodexImagegenManage.tsx')
  const { CapabilityCameraOutputsEditor } = require('../src/workbench/generationCanvas/components/CapabilityCameraOutputsEditor.tsx')
  const outputs = [{ id: 'camera-1', label: '机位 1', azimuth: 45, elevation: 10, shotSize: '中景' }]
  const before = JSON.stringify(outputs)
  let changes = 0
  for (const lng of ['zh-CN', 'en', 'zh-CN']) {
    await appI18n.changeLanguage(lng)
    const html = renderToStaticMarkup(React.createElement(I18nextProvider, { i18n: appI18n }, React.createElement(MantineProvider, { forceColorScheme: 'light' },
      React.createElement(React.Fragment, null, React.createElement(CodexImagegenManage), React.createElement(CapabilityCameraOutputsEditor, { outputs, count: 1, onChange: () => changes++ })),
    )))
    assert.ok(html.includes(lng === 'en' ? 'Local Codex image channel' : '本机 Codex 图片通道'))
    assert.ok(html.includes(lng === 'en' ? 'Medium shot' : '中景'))
    assert.ok(html.includes('value="机位 1"'))
    assert.equal(translateCanvasComponentText('即梦 Web'), lng === 'en' ? 'Jimeng Web' : '即梦 Web')
    assert.equal(translateCanvasComponentText('全景'), lng === 'en' ? 'Wide shot' : '全景')
    assert.equal(translateCanvasComponentText('我自己的未登记标题'), '我自己的未登记标题')
    assert.equal(JSON.stringify(outputs), before)
    assert.equal(changes, 0)
  }
})

test('interpolation bindings retain the original source expressions and order', () => {
  const normalize = (expression, restore = false) => {
    const tree = ts.createSourceFile('expression.tsx', `(${expression})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const result = ts.transform(tree, [context => {
      const visit = node => {
        if (restore && ts.isCallExpression(node) && node.expression.getText(tree) === 'translateCanvasComponentText' && node.arguments.length === 1) return ts.visitNode(node.arguments[0], visit)
        if (restore && ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
          const key = node.arguments[0].text.replace(/^canvasComponents\./, '')
          if (fixture.zh[key]) return ts.factory.createStringLiteral(fixture.zh[key])
        }
        if (ts.isStringLiteral(node)) return ts.factory.createStringLiteral(node.text)
        return ts.visitEachChild(node, visit, context)
      }
      return node => ts.visitNode(node, visit)
    }])
    try { return ts.createPrinter({ removeComments: true }).printFile(result.transformed[0]) } finally { result.dispose() }
  }
  for (const entry of fixture.bindings) {
    const text = fs.readFileSync(new URL('../' + entry.file, import.meta.url), 'utf8')
    const source = ts.createSourceFile(entry.file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const matches = []
    const visit = node => {
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === entry.key && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
        matches.push(node.arguments[1].properties.filter(ts.isPropertyAssignment).map(property => normalize(property.initializer.getText(source), true)))
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(matches.some(args => JSON.stringify(args) === JSON.stringify(entry.expressions.map(expression => normalize(expression)))), `${entry.file}:${entry.key}`)
  }
})
