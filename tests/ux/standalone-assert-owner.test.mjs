import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const scripts = ['smoke.e2e.mjs', 'core-smoke-spend-confirm.walk.mjs']
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const parse = (source) => ts.createSourceFile('standalone.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)

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
