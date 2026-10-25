import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import test, { after } from 'node:test'
import ts from 'typescript'
import i18next from 'i18next'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { register } from 'tsx/cjs/api'

function registerAppTsx() {
  const previous = process.env.TSX_TSCONFIG_PATH
  process.env.TSX_TSCONFIG_PATH = fileURLToPath(new URL('../tsconfig.app.json', import.meta.url))
  try { return register() } finally {
    if (previous === undefined) delete process.env.TSX_TSCONFIG_PATH
    else process.env.TSX_TSCONFIG_PATH = previous
  }
}
const unregister = registerAppTsx()
after(() => unregister())
const require = createRequire(import.meta.url)

const approvedCopy = {
  zh: [
    ["generateNewResults","生成新结果","再生成"],
    ["connectModels51","去模型接入","接入模型"],
    ["generatingKeyframes","关键帧生成中","生成中"],
    ["generate53Keyframes","生成5+3关键帧","生成帧"],
    ["polishVideoPrompt","润色视频词","润色"],
    ["applyAndGenerate","应用并生成","生成"],
    ["executingInBlender","正在执行 Blender…","执行中"],
    ["applyToBlender","应用到 Blender","写入 Blender"],
    ["keyframeNodes"," 个关键帧节点"," 帧节点"],
    ["importLocalModel","导入本地模型","导入模型"],
    ["renderWithBlender","使用 Blender 渲染","Blender 渲染"],
    ["writeOrImportAScriptFirst","请先写入或导入剧本","剧本为空"],
    ["configureAndRun334","配置并运行","配置"],
    ["confirmAndContinue","确认并继续 · {{v0}}/{{v1}}","确认 {{v0}}/{{v1}}"],
    ["runPlaybookAgain","重新运行 Playbook","再运行"],
    ["retryCurrentStage","重试当前阶段","重试本步"],
    ["continueWithAgent","用 Agent 推进","Agent 推进"],
    ["visionModelReview","视觉模型复核","视觉复核"],
    ["sendTo3DDirectorWorkspace","送入 3D 导演台","送导演台"],
    ["clearManualVerdict","清除人工结论","清除结论"],
    ["connectATextModelThatSupportsImageInput","连接支持图片输入的文本模型","接入视觉"],
  ],
  en: [
    ["generateNewResults","Generate new results","Regenerate"],
    ["generatingKeyframes","Generating keyframes","Generating"],
    ["generate53Keyframes","Generate 5+3 keyframes","Generate frames"],
    ["polishVideoPrompt","Polish video prompt","Polish prompt"],
    ["applyAndGenerate","Apply and generate","Generate"],
    ["executingInBlender","Executing in Blender…","Executing"],
    ["applyToBlender","Apply to Blender","Apply plan"],
    ["keyframeNodes"," keyframe nodes"," frames"],
    ["importLocalModel","Import local model","Import model"],
    ["renderWithBlender","Render with Blender","Blender render"],
    ["writeOrImportAScriptFirst","Write or import a script first","Script required"],
    ["configureAndRun334","Configure and run","Configure"],
    ["confirmAndContinue","Confirm and continue · {{v0}}/{{v1}}","Confirm {{v0}}/{{v1}}"],
    ["runPlaybookAgain","Run Playbook again","Run again"],
    ["retryCurrentStage","Retry current stage","Retry step"],
    ["continueWithAgent","Continue with Agent","Ask agent"],
    ["visionModelReview","Vision model review","Vision review"],
    ["sendTo3DDirectorWorkspace","Send to 3D director workspace","Open director"],
    ["sendToBlenderDirector","Send to Blender Director","To Blender"],
    ["clearManualVerdict","Clear manual verdict","Clear verdict"],
    ["connectATextModelThatSupportsImageInput","Connect a text model that supports image input","Connect vision"],
  ],
}
const approvedClasses = [
  {
    "file": "src/workbench/generationCanvas/nodes/VibingDirectorEditor.tsx",
    "from": "bd38ee6152a7e2bb41107ba9fb2455c90d9dc93bd80854a004bbc33e2c150ab9",
    "to": "f14b9c20973952702a992dce505c3b3609e0156e3db888a74bccdf4099fd3f71"
  },
  {
    "file": "src/workbench/generationCanvas/nodes/render/StoryboardVideoPreview.tsx",
    "from": "244a8c6cef7f9988caf6eb77ebdcb7cbe1cb5daf887dd1eeda462c8c9862c1b9",
    "to": "56f95ee22d076efd59897f2a558674e480586d661db0bcf4ce984e794dcf696d"
  }
]

const scrollMarkerClassChanges = [
  {
    "file": "src/workbench/generationCanvas/nodes/render/StoryboardTableNode.tsx",
    "from": "4be3f8313a723fd12a1d857f7fc1b5c28a6eff81df23f5527b3aded27b6bdc99",
    "to": "f04f109320e115da3861acf45f0de6f0511907a29644289e9cf3e712b11ba2d3"
  },
  {
    "file": "src/workbench/generationCanvas/nodes/vibingDirector/VibingDirectorFullscreen.tsx",
    "from": "b2720ac6c6fe32c6ea89cd5cb88a77772a242d9484a0424f6fd246e2156d1887",
    "to": "2113d7bc699c81490bf539557fd9ad0e55ce37436fb2f63a83fb9d7fa142091e"
  },
  {
    "file": "src/workbench/generationCanvas/nodes/vibingDirector/VibingDirectorAssistantPanel.tsx",
    "from": "0b3e00f6366cc5965262fec64ede33d508362ddc88b53b92bf1552c17eb3c6ea",
    "to": "0394612667e4ac723a5e9f0a36d8975893194e972ff2460749d10944bfd88fce"
  },
  {
    "file": "src/workbench/generationCanvas/nodes/VideoKeyframeInspectorDialog.tsx",
    "from": "672e7491192cf13467b0104f379b9c32a068c65973c2409ba293c3e6edcd131e",
    "to": "12ee218996a5054cb96882fa276b83d91c6e9d7b9867b8e2d44a2b089010caaf"
  },
  {
    "file": "src/workbench/generationCanvas/nodes/vibingDirector/VibingDirectorAssetLibrary.tsx",
    "from": "f9a3c6cbb54e55fcbb11f6e4895a1ba2ebf487e601335b01925bfaf8be4463b9",
    "to": "ae72fcfc75f9707680c7dc76e0b96004a3e4571a8ba196993ae5aa5ddd9cf542"
  },
  {
    "file": "src/workbench/generationCanvas/nodes/render/CanvasSkillNodeBody.tsx",
    "from": "f96fa58297eb49edcbfb30f1b9f3e0f245d8161e34ecfb04f74fe89814e0bc31",
    "to": "de6292d1d02f2a976541dbf907e5da5db9ae40a0b546022c028d462a5551b26a"
  },
  {
    "file": "src/workbench/generationCanvas/nodes/render/OutputCollectorNodeBody.tsx",
    "from": "b7f8e9141a87dbcebdaa823a5015603e47bba77affcaa39dc8be01fcdb59b848",
    "to": "64227df5926eb3c9a3a16c96070242eab8b7fef2a12d84a4ea8fb7a008468677"
  },
  {
    "file": "src/workbench/generationCanvas/nodes/PortraitComparisonDialog.tsx",
    "from": "09bcd34e41607e657b25fa7e4b57e88a81997c3a0e737dc9aad82778c191a198",
    "to": "2e2c9634a82d41649e75f5f7fdc947462855f33121d85519a4cdc1ebb1938c7c"
  },
  {
    "file": "src/workbench/generationCanvas/nodes/CapabilityQualityReportPopover.tsx",
    "from": "e8543a137c446690420d691fe03b8ed8a392e187d8ef3541dd698aa21c18d578",
    "to": "51f6a4767bf5e376fa3e2755def3066aeef5d5d2c6946cfc126e949bf1aa7b76"
  },
  {
    "file": "src/workbench/generationCanvas/nodes/scene3d/Scene3DFullscreenToolbar.tsx",
    "from": "0860ef77345fe1e07c49c6c7ed6f5fef69b63e3895dcdef78fe117cf9534c180",
    "to": "280094729883092d42a6617d2aac56f3476d8cde0a4263c9d137b2894c66c581"
  }
]

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
test('only reviewed copy, preview and scroll-marker snapshots differ; all bindings stay exact', () => {
  const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
  assert.equal(Object.keys(fixture.zh).length, 475)
  assert.equal(Object.keys(fixture.files).length, 37)
  assert.equal(fixture.bindings.length, 111)
  assert.equal(digest(fixture.bindings), 'bbc286e4f3396183fb7ffaa4f09afe4f1b82d08036394600453428e0b1196f48')
  const restoredCopy = { ...fixture.zh }
  for (const [key, before, approved] of approvedCopy.zh) {
    assert.equal(restoredCopy[key], approved, key)
    restoredCopy[key] = before
  }
  assert.equal(digest(restoredCopy), 'df589ebafb9bbe5a5d7dd6f99edf46a1cda58fff599ed9b590726d8c536c9f55')
  const restoredFiles = structuredClone(fixture.files)
  assert.equal(scrollMarkerClassChanges.length, 10)
  for (const { file, from, to } of scrollMarkerClassChanges) {
    assert.equal(restoredFiles[file].classHash, to, file)
    restoredFiles[file].classHash = from
  }
  for (const { file, from, to } of approvedClasses) {
    assert.equal(restoredFiles[file].classHash, to, file)
    restoredFiles[file].classHash = from
  }
  assert.equal(digest(restoredFiles), 'f539f4633a7678f4588aeb1908a6c25c316fac0254954b34853afd663c34adfa')
  const { enCanvasComponents: en } = readLocale()
  assert.equal(approvedCopy.zh.length, 21)
  assert.equal(approvedCopy.en.length, 21)
  for (const [key, , approved] of approvedCopy.en) assert.equal(en[key], approved, key)
})

test('new integration Node regressions run exactly once in the existing engineering gate', () => {
  const { scripts } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const commands = scripts['test:eng-system'].split(' && ')
  const original = ['./scripts/merge-preflight.node-test.mjs', './scripts/eng-metrics.node-test.mjs', './scripts/archetype-autosync-workflow.node-test.mjs']
  assert.equal(commands.length, 2)
  const summary = './tests/ux/multimodal-provider-summary.node-test.mjs'
  assert.equal(commands[0], ['node', '--test', summary, ...original].join(' '))
  const args = commands[1].split(/\s+/)
  assert.deepEqual(args.slice(0, 4), ['node', '--import', 'tsx', '--test'])
  const additions = ['agent-tool-face-usecases', 'browser-shortcut-label', 'check-fresh-base', 'main-style-content-flow', 'main-style-reference-repair', 'root-cause-history-evidence', 'self-written-closeout', 'tsx-diagnostics-lint', 'tsx-i18n-display', 'tsx-redundant-bindings']
  assert.equal(args.length, 4 + additions.length)
  const allArgs = commands.flatMap(command => command.split(/\s+/))
  assert.equal(allArgs.filter(arg => arg === summary).length, 1)
  for (const file of [...original, ...additions.map(name => `./scripts/${name}.node-test.mjs`)]) assert.equal(allArgs.filter(arg => arg === file).length, 1, file)
  assert.ok(!args.some(arg => arg.includes('extension-lint-hosts')), 'the existing quality workflow gate already owns this suite')
  assert.ok(scripts['check:quality-gate-workflow'].includes('./scripts/extension-lint-hosts.node-test.mjs'))
  assert.match(scripts.test, /pnpm run test:eng-system/, 'the existing unit entry must still reach the engineering gate')
})

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
test('mixed-use canonical defaults remain language-independent', async () => {
  const inspector = fs.readFileSync(new URL('../src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx', import.meta.url), 'utf8')
  assert.match(inspector, /import \{ createRecipeCameraOutputs \} from '\.\.\/\.\.\/\.\.\/\.\.\/electron\/shared\/canvas\/sourceDefaults'/)
  assert.match(inspector, /createRecipeCameraOutputs\(2, \[\]\)/)
  assert.match(inspector, /createRecipeCameraOutputs\(nextCount, current\)/)
  const { createRecipeCameraOutputs } = require('../electron/shared/canvas/sourceDefaults.ts')
  const appI18n = require('../src/i18n/index.ts').default
  const previousLocale = appI18n.language
  try {
    for (const lng of ['zh-CN', 'en', 'zh-CN']) {
      await appI18n.changeLanguage(lng)
      for (let count = 0; count < 10; count++) {
        assert.deepEqual(createRecipeCameraOutputs(count, []), Array.from({ length: count }, (_, index) => ({
          id: `view-${index + 1}`, label: `机位 ${index + 1}`,
          azimuth: [0, 45, 90, 135, 180, -90, 180, 180, 180][index], elevation: 0, shotSize: '中景',
        })))
      }
      const edited = Object.freeze({ id: 'custom', label: '用户的侧面机位', azimuth: -13, elevation: 7, shotSize: '全景' })
      const before = JSON.stringify(edited)
      assert.equal(createRecipeCameraOutputs(3, [edited])[0], edited)
      assert.equal(JSON.stringify(edited), before)
    }
  } finally { await appI18n.changeLanguage(previousLocale) }
  assert.match(inspector, /setResourceLabel\(`\$\{sourceTitle\} 资源`\)/)
  assert.match(inspector, /source: '用户自有素材'/)
  const editor = fs.readFileSync(new URL('../src/workbench/generationCanvas/components/CapabilityCameraOutputsEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /value=\{output.label\}/)
  assert.match(editor, /\['特写', '近景', '中景', '全景'\]/)
  assert.match(editor, /shotSize: value/)
  const scene = fs.readFileSync(new URL('../src/workbench/generationCanvas/nodes/Scene3DEditor.tsx', import.meta.url), 'utf8')
  assert.equal([...scene.matchAll(/matchNomiErrorCode\(message\)\s*===\s*'operation-cancelled'/g)].length, 1, 'classify cancellation once using its structured identity')
  const sceneTree = ts.createSourceFile('Scene3DEditor.tsx', scene, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let cancellationToast
  const findToast = node => {
    if (ts.isCallExpression(node) && node.expression.getText(sceneTree) === 'toast'
      && ts.isConditionalExpression(node.arguments[0]) && node.arguments[0].condition.getText(sceneTree) === 'cancelled') cancellationToast = node
    ts.forEachChild(node, findToast)
  }
  findToast(sceneTree)
  assert.ok(cancellationToast, 'the actual notice must use the cancellation identity')
  assert.equal(cancellationToast.arguments[0].whenFalse.getText(sceneTree), 'message')
  assert.equal(cancellationToast.arguments[1].condition.getText(sceneTree), 'cancelled')
  assert.equal(cancellationToast.arguments[1].whenTrue.text, 'info')
  assert.equal(cancellationToast.arguments[1].whenFalse.text, 'error')
  assert.ok(!scene.includes("message.includes('已取消')"), 'display prose must not determine workflow state')
  const { matchNomiErrorCode, tagNomiError } = require('../electron/shared/nomiErrorCodes.ts')
  for (const message of ['Blender 导演预演已取消', 'Blender Director preview was cancelled']) {
    assert.equal(matchNomiErrorCode(message), 'operation-cancelled')
    assert.equal(matchNomiErrorCode(`Error invoking remote method 'scene:render': Error: ${message}`), 'operation-cancelled')
    assert.equal(matchNomiErrorCode(`User note: ${message}`), null)
    assert.equal(matchNomiErrorCode(`${message} unexpectedly timed out`), null)
  }
  assert.equal(matchNomiErrorCode(tagNomiError('operation-cancelled', 'Unrelated translated detail')), 'operation-cancelled')
  assert.equal(matchNomiErrorCode(tagNomiError('codex-timeout', 'Stopped waiting')), 'codex-timeout')
})

test('actual rendered display boundaries switch language without changing editable values', async () => {
  assert.equal('React' in globalThis, false, 'the app JSX runtime must not rely on global React')
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { MantineProvider } = require('@mantine/core')
  const { I18nextProvider } = require('react-i18next')
  const appI18n = require('../src/i18n/index.ts').default
  const { translateCanvasComponentText } = require('../src/i18n/CanvasComponentText.tsx')
  const { CodexImagegenManage } = require('../src/ui/onboarding/CodexImagegenManage.tsx')
  const { CapabilityCameraOutputsEditor } = require('../src/workbench/generationCanvas/components/CapabilityCameraOutputsEditor.tsx')
  const { createRecipeCameraOutputs } = require('../electron/shared/canvas/sourceDefaults.ts')
  const outputs = Object.freeze([
    ...createRecipeCameraOutputs(1, []).map(output => Object.freeze({ ...output, azimuth: 45, elevation: 10 })),
    Object.freeze({ id: 'custom', label: '用户的侧面机位', azimuth: -13, elevation: 7, shotSize: '全景' }),
  ])
  const before = JSON.stringify(outputs)
  let changes = 0
  for (const lng of ['zh-CN', 'en', 'zh-CN']) {
    await appI18n.changeLanguage(lng)
    const html = renderToStaticMarkup(React.createElement(I18nextProvider, { i18n: appI18n }, React.createElement(MantineProvider, { forceColorScheme: 'light' },
      React.createElement(React.Fragment, null, React.createElement(CodexImagegenManage), React.createElement(CapabilityCameraOutputsEditor, { outputs, count: 2, onChange: () => changes++ })),
    )))
    assert.ok(html.includes(lng === 'en' ? 'Local Codex image channel' : '本机 Codex 图片通道'))
    assert.ok(html.includes(lng === 'en' ? 'Medium shot' : '中景'))
    assert.ok(html.includes('value="机位 1"'))
    assert.ok(html.includes('value="用户的侧面机位"'))
    assert.ok(html.includes('value="-13"'))
    assert.ok(html.includes('value="7"'))
    assert.ok(html.includes('value="45"'))
    assert.ok(html.includes('value="10"'))
    assert.equal(translateCanvasComponentText('即梦 Web'), lng === 'en' ? 'Jimeng Web' : '即梦 Web')
    assert.equal(translateCanvasComponentText('全景'), lng === 'en' ? 'Wide shot' : '全景')
    assert.equal(translateCanvasComponentText('我自己的未登记标题'), '我自己的未登记标题')
    assert.equal(JSON.stringify(outputs), before)
    assert.equal(changes, 0)
    let input
    const edits = []
    function EditingProbe() {
      const tree = CapabilityCameraOutputsEditor({ outputs, count: 2, onChange: (index, patch) => edits.push({ index, patch }) })
      const visit = node => {
        if (Array.isArray(node)) return node.forEach(visit)
        if (!React.isValidElement(node)) return
        if (node.type === 'input' && node.props.type !== 'number' && !input) input = node.props
        visit(node.props.children)
      }
      visit(tree)
      return tree
    }
    renderToStaticMarkup(React.createElement(I18nextProvider, { i18n: appI18n }, React.createElement(MantineProvider, null, React.createElement(EditingProbe))))
    assert.equal(input.value, '机位 1')
    input.onChange({ target: { value: input.value + 'A' } })
    assert.deepEqual(edits, [{ index: 0, patch: { label: '机位 1A' } }])
    input.onChange({ target: { value: 'View 1A' } })
    assert.deepEqual(edits[1], { index: 0, patch: { label: 'View 1A' } })
    assert.equal(JSON.stringify(outputs), before)
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
