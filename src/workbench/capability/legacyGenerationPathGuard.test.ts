import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { createProjectSessionTestHarness } from '../project/projectSessionTestHarness'

import { handleCapabilityApply } from './capabilityApplyHandler'

describe('retired renderer production generation bridge', () => {
  it('rejects the old operation even when it carries no canonical binding', async () => {
    const session = createProjectSessionTestHarness()
    try {
      await session.open('retired-route-test')
      await expect(handleCapabilityApply('production.generate-node', {
        projectId: 'retired-route-test', nodeId: 'node-1', maxAttemptsPerJob: 2,
      })).rejects.toMatchObject({ code: 'capability_input_invalid' })
    } finally {
      session.dispose()
    }
  })

  it('has no spend-grant or local provider dispatch implementation', () => {
    const source = readFileSync(new URL('./capabilityApplyHandler.ts', import.meta.url), 'utf8')
    const tree = ts.createSourceFile('capabilityApplyHandler.ts', source, ts.ScriptTarget.Latest, true)
    const handler = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'handleCapabilityApply')
    const guard = handler?.body?.statements.find((node): node is ts.IfStatement => ts.isIfStatement(node)
      && ts.isBinaryExpression(node.expression) && node.expression.left.getText(tree) === 'op'
      && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      && ts.isStringLiteral(node.expression.right) && node.expression.right.text === 'production.generate-node')
    if (!guard || !ts.isThrowStatement(guard.thenStatement) || !guard.thenStatement.expression || !ts.isNewExpression(guard.thenStatement.expression)) throw new Error('retired route must directly reject')
    expect(guard.thenStatement.expression.expression.getText(tree)).toBe('SurfacePortWireError')
    const reason = guard.thenStatement.expression.arguments?.[0]
    expect(reason && ts.isStringLiteral(reason) ? reason.text : undefined).toBe('capability_input_invalid')
    expect(source).not.toContain('mintSpendGrant')
    expect(source).not.toContain('runGenerationNode')
  })
})
