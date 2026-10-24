import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'

const require = createRequire(import.meta.url)
const logging = require('../src/desktop/rendererLog.ts')
const root = new URL('../', import.meta.url)
const dir = 'src/workbench/generationCanvas/nodes/scene3d/'
const cases = [
  ['scene3dEnvironment.tsx', 'EnvironmentResourceBoundary', 'warn', 'scene3d-environment-load-failed', 'hasError'],
  ['scene3dObjects.tsx', 'MannequinAssetBoundary', 'error', 'scene3d-mannequin-asset-load-failed', 'failed'],
  ['scene3dObjects.tsx', 'GeneratedModelBoundary', 'error', 'scene3d-generated-model-load-failed', 'failed'],
]
for (const [file, symbol, level, event, flag] of cases) {
  test(`${symbol} preserves fallback and forwards original failure through the existing owner`, () => {
    const text = fs.readFileSync(new URL(dir + file, root), 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const node = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === symbol)
    assert.ok(node, symbol)
    const code = ts.transpileModule(node.getText(source).replace(/^export\s+/, ''), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
    const Boundary = new Function('React', 'logRendererError', 'logRendererWarn', code + `\nreturn ${symbol}`)(React, logging.logRendererError, logging.logRendererWarn)
    const boundary = new Boundary({ children: 'content', fallback: 'fallback', resetKey: 'a' })
    assert.equal(boundary.render(), 'content')
    const report = [], local = []
    const previousWindow = globalThis.window, previousConsole = console[level]
    globalThis.window = { nomiDesktop: { log: { report: entry => report.push(entry) } } }
    console[level] = (...args) => local.push(args)
    try {
      const error = Object.assign(new Error('asset decode failed'), { code: 'ASSET_DECODE' })
      boundary.componentDidCatch(error)
      assert.equal(report.length, 1)
      assert.equal(report[0].level, level)
      assert.equal(report[0].event, event)
      assert.equal(report[0].error.message, error.message)
      assert.equal(report[0].error.code, error.code)
      assert.equal(report[0].error.stack, error.stack)
      assert.equal(local[0][1], error)
      boundary.state = Boundary.getDerivedStateFromError(error)
      assert.equal(boundary.state[flag], true)
      assert.equal(boundary.render(), 'fallback')
      if (symbol === 'EnvironmentResourceBoundary') {
        let update
        boundary.setState = value => { update = value }
        boundary.props = { ...boundary.props, resetKey: 'b' }
        boundary.componentDidUpdate({ resetKey: 'a' })
        assert.deepEqual(update, { hasError: false })
      }
    } finally {
      console[level] = previousConsole
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    }
  })
}

for (const [file, event, level, hasError] of [
  ['src/workbench/capability/capabilityLegacyActions.ts', 'capability-generation-batch-failed', 'error', true],
  [dir + 'scene3dMannequinLocomotion.ts', 'mannequin-clip-retarget-failed', 'warn', true],
  [dir + 'scene3dMannequinLocomotion.ts', 'mannequin-locomotion-clip-unavailable', 'warn', false],
]) {
  test(`${event} keeps the original error and scalar context in the shared reporter`, () => {
    const text = fs.readFileSync(new URL(file, root), 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    let call
    const visit = node => {
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === event) call = node
      ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(call, 'the production failure must remain observable')
    const invoke = new Function('logRendererError', 'logRendererWarn', 'error', 'clip', 'activeClip', call.getText(source))
    const reports = [], local = []
    const previousWindow = globalThis.window, previousConsole = console[level]
    globalThis.window = { nomiDesktop: { log: { report: entry => reports.push(entry) } } }
    console[level] = (...args) => local.push(args)
    try {
      const error = Object.assign(new Error('fixture failure'), { code: 'FIXTURE_FAILURE' })
      invoke(logging.logRendererError, logging.logRendererWarn, error, { name: 'walk' }, 'walk')
      assert.equal(reports.length, 1)
      assert.equal(local.length, 1)
      assert.equal(reports[0].event, event)
      assert.equal(reports[0].level, level)
      if (hasError) {
        assert.equal(reports[0].error.message, error.message)
        assert.equal(reports[0].error.code, error.code)
        assert.equal(reports[0].error.stack, error.stack)
      } else assert.equal(reports[0].error, undefined)
      if (level === 'warn') assert.deepEqual(reports[0].fields, { clip: 'walk' })
    } finally {
      console[level] = previousConsole
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    }
  })
}

test('safe cleanup retains a stable memo owner and removes only unused work', () => {
  const session = fs.readFileSync(new URL(dir + 'useScene3DEditorSession.ts', root), 'utf8')
  assert.match(session, /const initialEditorCameraRef = React\.useRef/)
  const fullscreen = fs.readFileSync(new URL(dir + 'Scene3DFullscreen.tsx', root), 'utf8')
  assert.match(fullscreen, /position: initialEditorCameraRef\.current\.position \}\),\s*\[initialEditorCameraRef\]/)
  const batch = fs.readFileSync(new URL('src/workbench/generationCanvas/components/BatchGenerateSettingsButton.tsx', root), 'utf8')
  assert.doesNotMatch(batch, /const regenerationTargetIds/)
  assert.match(batch, /const generationTargets = run \? selectedTargets\.filter/)
  const skills = fs.readFileSync(new URL('src/workbench/skillLibrary/SkillLibraryPanel.tsx', root), 'utf8')
  assert.doesNotMatch(skills, /const setActiveCategoryId/)
  assert.match(skills, /const setWorkspaceMode = useWorkbenchStore/)
  assert.match(skills, /const setCreationActiveSkill = useWorkbenchStore/)
})
