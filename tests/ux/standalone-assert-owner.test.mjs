import { readFileSync } from 'node:fs'
import { Linter } from 'eslint'
import globals from 'globals'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

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
    if (name === 'smoke.e2e.mjs') expect(count).toBe(3)
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

it.each(['expect', 'screenshotSettled', 'evidenceDir', 'electronProcess'])('rejects removal of the actual %s binding', (name) => {
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
  expect(binding('evidenceDir')).toBe('path.resolve("outputs/canvas-smoke")')
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
