import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Linter } from 'eslint'
import globals from 'globals'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { expect as canonicalExpect } from './_assert.mjs'

const scripts = ['smoke.e2e.mjs', 'core-smoke-spend-confirm.walk.mjs']
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const parse = (source) => ts.createSourceFile('standalone.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)

function noUndef(source, runtimeGlobals) {
  return new Linter().verify(source, [{
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: runtimeGlobals },
    linterOptions: { noInlineConfig: true },
    rules: { 'no-undef': ['error', { typeof: true }] },
  }], { filename: 'standalone.mjs' }).filter((message) => message.severity === 2)
}

// Serialized renderer functions have browser scope, not the enclosing Node closure.
function standaloneUnbound(source) {
  const ast = parse(source)
  const callbacks = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['evaluate', 'evaluateAll', 'waitForFunction'].includes(node.expression.name.text)) {
      const receiver = node.expression.expression
      const mainProcess = ts.isIdentifier(receiver) && receiver.text === 'app'
        || ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'app'
      const callback = node.arguments[0]
      if (!mainProcess && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        callbacks.push(callback)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const nodeErrors = noUndef(source, globals.node).filter((message) => {
    if (message.ruleId !== 'no-undef') return true
    const offset = ast.getPositionOfLineAndCharacter(message.line - 1, message.column - 1)
    return !callbacks.some((callback) => callback.getStart(ast) <= offset && offset < callback.end)
  }).map((message) => ({ runtime: 'node', ...message }))
  const browserErrors = callbacks.flatMap((callback) => noUndef(`(${callback.getText(ast)});`, globals.browser)
    .map((message) => ({ runtime: `browser@${ast.getLineAndCharacterOfPosition(callback.getStart(ast)).line + 1}`, ...message })))
  return [...nodeErrors, ...browserErrors]
}

function removeBinding(source, name) {
  const ast = parse(source)
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings
      && ts.isNamedImports(statement.importClause.namedBindings)) {
      const bindings = statement.importClause.namedBindings
      const remaining = bindings.elements.filter((binding) => binding.name.text !== name)
      if (remaining.length !== bindings.elements.length) {
        const updated = ts.factory.updateImportDeclaration(statement, statement.modifiers,
          ts.factory.updateImportClause(statement.importClause, statement.importClause.isTypeOnly,
            statement.importClause.name, ts.factory.updateNamedImports(bindings, remaining)),
          statement.moduleSpecifier, statement.attributes)
        return source.slice(0, statement.getStart(ast))
          + ts.createPrinter().printNode(ts.EmitHint.Unspecified, updated, ast) + source.slice(statement.end)
      }
    }
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1
      && statement.declarationList.declarations[0].name.getText(ast) === name) {
      return source.slice(0, statement.getStart(ast)) + source.slice(statement.end)
    }
  }
  throw new Error(`negative control requires the real ${name} binding`)
}

function expectImports(ast) {
  return ast.statements.filter((node) => ts.isImportDeclaration(node)
    && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === './_assert.mjs'
    && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
    && node.importClause.namedBindings.elements.some((binding) => binding.name.text === 'expect'
      && (binding.propertyName?.text ?? binding.name.text) === 'expect'))
}

function verifyStandaloneExpect(source) {
  const ast = parse(source)
  const calls = []
  const root = (node) => ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? root(node.expression) : node
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const target = root(node.expression)
      if (ts.isIdentifier(target) && target.text === 'expect') calls.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!calls.length) throw new Error('standalone has no active expect calls; ownership check would be vacuous')
  if (expectImports(ast).length !== 1) throw new Error('standalone expect must be an explicit named import from ./_assert.mjs')
  return calls.length
}

function removeExpectImport(source) {
  const [declaration] = expectImports(parse(source))
  if (!declaration) throw new Error('negative control requires a real canonical import first')
  return source.slice(0, declaration.getFullStart()) + source.slice(declaration.end)
}

describe.each(scripts)('%s standalone assertion ownership', (name) => {
  it('binds active expect calls to the canonical collecting owner without executing the script', () => {
    const count = verifyStandaloneExpect(read(name))
    expect(count).toBeGreaterThan(0)
    if (name === 'smoke.e2e.mjs') expect(count).toBe(6)
  })

  it('rejects the actual script when the canonical import is removed in memory', () => {
    expect(() => verifyStandaloneExpect(removeExpectImport(read(name)))).toThrow(/explicit named import/)
  })
})

it('does not accept runner globals, a comment, a local stub or the wrong assertion owner', () => {
  for (const source of [
    'await expect(target).toBeVisible()',
    'globalThis.expect = () => {}; await expect(target).toBeVisible()',
    '// import { expect } from "./_assert.mjs"\nawait expect(target).toBeVisible()',
    'const expect = () => {}; await expect(target).toBeVisible()',
    'import { expect } from "vitest"; await expect(target).toBeVisible()',
    'import { expect } from "@playwright/test"; await expect(target).toBeVisible()',
    'import { expect as check } from "./_assert.mjs"; await expect(target).toBeVisible()',
  ]) expect(() => verifyStandaloneExpect(source)).toThrow(/explicit named import/)
})

it('rejects removal of the assertions rather than calling an empty script valid', () => {
  expect(() => verifyStandaloneExpect('import { expect } from "./_assert.mjs"')).toThrow(/vacuous/)
})

describe.each(scripts)('%s standalone semantic scope', (name) => {
  it('has no unresolved identifiers in Node or its serialized browser functions', () => {
    expect(standaloneUnbound(read(name))).toEqual([])
  })
})

it.each(['expect', 'screenshotSettled', 'waitForVisualQuiescence', 'evidenceDir', 'electronProcess'])('rejects removal of the actual %s binding', (name) => {
  const messages = standaloneUnbound(removeBinding(read('smoke.e2e.mjs'), name))
  expect(messages.some((message) => message.ruleId === 'no-undef' && message.message.includes(`'${name}'`))).toBe(true)
})

it('keeps browser globals inside renderer callbacks and honors their lexical scope', () => {
  const source = `const win = {};
    await win.evaluate(() => window.document.title);
    await win.locator('canvas').evaluateAll(nodes => nodes.map(node => node instanceof HTMLElement));
    await win.waitForFunction(() => Boolean(document.body));
    await win.evaluate((document) => { const local = document.title; return local; }, {});`
  expect(standaloneUnbound(source)).toEqual([])
  expect(standaloneUnbound('window.document.title').some((message) => message.message.includes("'window'"))).toBe(true)
})

it.each([
  ['const win = {}; await win.evaluate(() => documment.title)', 'documment'],
  ['const win = {}; await win.evaluate(() => process.pid)', 'process'],
  ['const outer = 1; const win = {}; await win.evaluate(() => outer)', 'outer'],
  ['import { expect } from "./_assert.mjs"; const win = {}; await win.evaluate(() => expect(true).toBe(true))', 'expect'],
  ['const app = {}; await app.evaluate(() => document.title)', 'document'],
  ['/* global screenshotDir */ screenshotDir;', 'screenshotDir'],
  ['/* eslint-disable no-undef */ screenshotDir;', 'screenshotDir'],
])('does not mask an invalid runtime binding: %s', (source, name) => {
  expect(standaloneUnbound(source).some((message) => message.message.includes(`'${name}'`))).toBe(true)
})

it('uses the real created evidence directory, canonical screenshot helper and launched process', () => {
  const source = read('smoke.e2e.mjs')
  const ast = parse(source)
  const declarations = ast.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations)
  const binding = (name) => declarations.find((declaration) => declaration.name.getText(ast) === name)?.initializer?.getText(ast)
  expect(binding('evidenceDir')).toBe('path.resolve("outputs/canvas-smoke", path.basename(tempRoot))')
  expect(binding('electronProcess')).toBe('app.process()')
  const screenshotImport = ast.statements.find((statement) => ts.isImportDeclaration(statement)
    && statement.moduleSpecifier.text === './_assert.mjs')
  expect(screenshotImport?.importClause?.namedBindings?.elements.some((element) => element.name.text === 'screenshotSettled'
    && (element.propertyName?.text ?? element.name.text) === 'screenshotSettled')).toBe(true)
  const calls = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  expect(calls.some((call) => call.expression.getText(ast) === 'mkdirSync' && call.arguments[0]?.getText(ast) === 'evidenceDir')).toBe(true)
  const captures = calls.filter((call) => call.expression.getText(ast) === 'screenshotSettled')
  expect(captures).toHaveLength(3)
  expect(captures.map((call) => call.arguments[1].properties.find((prop) => prop.name.getText(ast) === 'path')?.initializer.getText(ast)))
    .toEqual(['path.join(evidenceDir, "library.png")', 'path.join(evidenceDir, "canvas.png")', 'path.join(evidenceDir, "director.png")'])
})

function smokeReadiness(source) {
  const ast = parse(source), calls = []
  const visit = node => {
    if (ts.isCallExpression(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const finalizer = ast.statements.find(ts.isTryStatement)?.finallyBlock
  const timers = calls.filter(call => call.expression.getText(ast) === 'setTimeout')
  if (timers.length !== 1 || !finalizer || timers[0].getStart(ast) < finalizer.getStart(ast)
    || timers[0].end > finalizer.end || timers[0].arguments[1]?.getText(ast) !== '5_000') {
    throw Error('Only the unchanged App close race may use a raw timer')
  }
  if (calls.some(call => ts.isPropertyAccessExpression(call.expression)
    && ['waitForTimeout', 'setDefaultTimeout', 'configure'].includes(call.expression.name.text))) {
    throw Error('Smoke readiness cannot use sleeps or override timeout defaults')
  }
  const guarded = calls.find(call => call.expression.getText(ast) === 'expect.poll'
    && call.arguments[0]?.getText(ast).includes('workbenchToolbarNames'))
  if (!guarded || !ts.isAwaitExpression(guarded.parent.parent.parent)
    || guarded.parent.parent.expression?.name?.text !== 'toBe'
    || guarded.parent.parent.arguments[0]?.kind !== ts.SyntaxKind.TrueKeyword
    || !guarded.arguments[0].getText(ast).includes('.every(Boolean)')) {
    throw Error('All toolbar controls need one awaited canonical poll to true')
  }
  if (guarded.arguments.length !== 2 || guarded.arguments[1].properties.some(prop => prop.name.getText(ast) !== 'message')) {
    throw Error('Toolbar readiness must retain the canonical default poll timeout')
  }
  const block = ast.statements.find(ts.isTryStatement)?.tryBlock
  const names = block?.statements.find(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations[0].name.getText(ast) === 'workbenchToolbarNames')
  const loop = block?.statements.find(statement => ts.isForOfStatement(statement)
    && statement.expression.getText(ast) === 'workbenchToolbarNames')
  if (!names || !loop) throw Error('Original toolbar loop must remain after the readiness signal')
  const declared = names.declarationList.declarations[0].initializer.elements.map(node => node.text)
  if (JSON.stringify(declared) !== JSON.stringify(['创作', '生成', '预览', '去出片'])) throw Error('Original toolbar identities changed')
  const waitStatement = guarded.parent.parent.parent.parent
  if (waitStatement.end > loop.getStart(ast)) throw Error('Readiness must precede original assertions')
  const visible = calls.filter(call => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'toBeVisible')
  for (const selector of ['button[aria-label="添加图片节点"]', '[data-testid="director-node-open"]']) {
    if (!visible.some(call => call.expression.expression.getText(ast).includes(selector)
      && ts.isAwaitExpression(call.parent) && call.arguments.length === 0)) throw Error(`Missing bounded visibility: ${selector}`)
  }
  if (!calls.some(call => call.expression.getText(ast) === 'waitForVisualQuiescence'
    && ts.isAwaitExpression(call.parent) && call.arguments.length === 1)) throw Error('Prompt layout must settle through the existing default owner')
  const assertOwner = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name.text === 'assert')
  return { fragment: [names, waitStatement, loop].map(node => node.getText(ast)).join('\n'), assertOwner: assertOwner.getText(ast) }
}

function smokeEvidence(source) {
  const ast = parse(source)
  const declarations = ast.statements.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations)
  const declaration = declarations.find(node => node.name.getText(ast) === 'evidenceDir')
  const temp = declarations.find(node => node.name.getText(ast) === 'tempRoot')
  if (temp?.initializer.getText(ast) !== 'mkdtempSync(path.join(os.tmpdir(), "nomi-smoke-e2e-"))') throw Error('Evidence identity must come from the actual fresh temporary root')
  const expression = declaration?.initializer.getText(ast)
  if (expression !== 'path.resolve("outputs/canvas-smoke", path.basename(tempRoot))') throw Error('Evidence must use the unique tempRoot basename under the fixed parent')
  return new Function('path', 'tempRoot', `return ${expression}`)
}

it('uses bounded observed readiness in the actual smoke instead of fixed UI sleeps', () => {
  expect(() => smokeReadiness(read('smoke.e2e.mjs'))).not.toThrow()
})

it('the real smoke fragment retries a partial toolbar and only then keeps all original assertions', async () => {
  const { fragment, assertOwner } = smokeReadiness(read('smoke.e2e.mjs'))
  let round = 0
  const logs = []
  const win = { getByRole: (role, options) => {
    expect(role).toBe('button'); expect(options.exact).toBe(false)
    return { first: () => ({ isVisible: async () => {
      if (options.name === '创作') round += 1
      return round > 1 || options.name === '创作'
    } }) }
  } }
  const run = new (Object.getPrototypeOf(async function () {}).constructor)('win', 'expect', 'console', `let passed = 0; ${assertOwner}\n${fragment}\nreturn passed`)
  expect(await run(win, canonicalExpect.configure({ timeout: 1000 }), { log: line => logs.push(line) })).toBe(4)
  expect(round).toBeGreaterThan(1)
  expect(logs).toHaveLength(4)
})

it('a genuinely missing generation control fails through the real canonical owner, never as a pass', async () => {
  const { fragment, assertOwner } = smokeReadiness(read('smoke.e2e.mjs'))
  const logs = []
  const win = { getByRole: (_role, { name }) => ({ first: () => ({ isVisible: async () => name !== '生成' }) }) }
  const run = new (Object.getPrototypeOf(async function () {}).constructor)('win', 'expect', 'console', `let passed = 0; ${assertOwner}\n${fragment}`)
  await expect(run(win, canonicalExpect.configure({ timeout: 1 }), { log: line => logs.push(line) })).rejects.toThrow()
  expect(logs).toEqual([])
})

it('rejects actual-owner mutations that restore sleep, drop waiting, loosen the signal or raise its timeout', () => {
  const source = read('smoke.e2e.mjs')
  smokeReadiness(source)
  for (const mutation of [
    source.replace('await expect.poll(', 'await win.waitForTimeout(2500); await expect.poll('),
    source.replace('await expect.poll(', 'await new Promise(resolve => setTimeout(resolve, 2500)); await expect.poll('),
    source.replace('await expect.poll(', 'expect.poll('),
    source.replace('.every(Boolean)', '.some(Boolean)'),
    source.replace('message: "工作台工具栏等待路由完成"', 'message: "工作台工具栏等待路由完成", timeout: 60000'),
    source.replace("await expect(win.locator('button[aria-label=\"添加图片节点\"]').first()).toBeVisible()", "expect(win.locator('button[aria-label=\"添加图片节点\"]').first()).toBeVisible()"),
  ]) {
    expect(mutation).not.toBe(source)
    expect(() => smokeReadiness(mutation)).toThrow()
  }
})

it('isolates actual evidence expressions per run and rejects the old root or an environment output path', () => {
  const source = read('smoke.e2e.mjs'), directory = smokeEvidence(source)
  const ast = parse(source)
  const temp = ast.statements.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations)
    .find(node => node.name.getText(ast) === 'tempRoot')
  const createTemp = new Function('mkdtempSync', 'path', 'os', `return ${temp.initializer.getText(ast)}`)
  const roots = []
  try {
    roots.push(createTemp(mkdtempSync, path, os), createTemp(mkdtempSync, path, os))
    const first = directory(path, roots[0]), second = directory(path, roots[1])
    expect(first).not.toBe(second)
    for (const [index, target] of [first, second].entries()) {
      expect(path.dirname(target)).toBe(path.resolve('outputs/canvas-smoke'))
      expect(path.basename(target)).toBe(path.basename(roots[index]))
    }
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  }
  for (const replacement of ['path.resolve("outputs/canvas-smoke")', 'path.resolve(process.env.EVIDENCE_DIR)']) {
    expect(() => smokeEvidence(source.replace('path.resolve("outputs/canvas-smoke", path.basename(tempRoot))', replacement))).toThrow()
  }
  const workflow = readFileSync(new URL('../../.github/workflows/quality-gate.yml', import.meta.url), 'utf8')
  expect(workflow.match(/outputs\/canvas-smoke\/\*\*/g)).toHaveLength(3)
  expect(source).toContain('console.log(`SMOKE EVIDENCE: ${evidenceDir}`)')
  expect(source).toContain('const diagnostic = {\n    evidenceDir,')
  expect(source).toContain('writeFileSync(path.join(evidenceDir, "failure.json")')
  expect(source).toContain('win.screenshot({ path: path.join(evidenceDir, "failure.png") })')
  expect(source).toContain('checkComposerFixedFooter(win, { composer, promptInput, flowNode, longPrompt, evidenceDir })')
})
