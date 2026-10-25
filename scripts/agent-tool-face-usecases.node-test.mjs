import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { onboardingVerbs } from '../electron/shared/agentCapabilities/verbs/onboardingVerbs.ts'
import { localCanvasVerbs } from '../electron/shared/agentCapabilities/verbs/localCanvasVerbs.ts'
import { validateAgentToolFaceUsecases } from './agent-tool-face-usecases-lib.mjs'
import { modelFacingToolSpecs } from '../electron/shared/agentCapabilities/modelFacingToolRegistry.ts'
import { creativeComponentArgumentSchemas } from '../electron/shared/agentCapabilities/creativeComponentSchemas.ts'
const manifest = JSON.parse(fs.readFileSync(new URL('../tests/system/agent-tool-face-usecases.json', import.meta.url), 'utf8'))
const published = modelFacingToolSpecs('internal').map(spec => spec.name)
test('frozen counts independently include both MCP-only declaration families without approving an internal increase', () => {
  const text = fs.readFileSync(new URL('./check-model-face-frozen.mjs', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('check-model-face-frozen.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const declarations = new Map()
  const conditions = []
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node.initializer)
    if (ts.isIfStatement(node) && node.expression.getText(tree).startsWith('face.verbCount !==')) conditions.push(node.expression)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.equal(declarations.get('EXPECTED_INTERNAL_VERB_COUNT').getText(tree), '21', 'the internal freeze still requires separate human approval')
  const initializer = declarations.get('expectedMcpOnlyCount').getText(tree)
  assert.ok(!/face\.|captureModelFace|VERB_DECLARATIONS/.test(initializer), 'expected declarations cannot be derived from the assembled surface')
  const isMcpOnly = new Function(`return (${declarations.get('isMcpOnly').getText(tree)})`)()
  const count = new Function('onboardingVerbs', 'localCanvasVerbs', 'isMcpOnly', `return (${initializer})`)
  const expected = count(onboardingVerbs, localCanvasVerbs, isMcpOnly)
  assert.equal(expected, 9)
  assert.equal(count(() => [], localCanvasVerbs, isMcpOnly), 2)
  assert.equal(count(onboardingVerbs, () => [], isMcpOnly), 7)
  assert.equal(conditions.length, 1)
  const rejectCount = new Function('face', 'internalVerbCount', 'expectedMcpOnlyCount', `return (${conditions[0].getText(tree)})`)
  assert.equal(rejectCount({ verbCount: 36 }, 27, expected), false)
  assert.equal(rejectCount({ verbCount: 34 }, 27, expected), true, 'dropping either local assembly still fails')
  assert.equal(rejectCount({ verbCount: 29 }, 27, expected), true, 'dropping the onboarding family still fails')
  assert.equal(rejectCount({ verbCount: 35 }, 27, expected), true, 'dropping a single tool still fails')
})
test('complete inventory and all existing trajectories validate without changing count freezes', () => {
  assert.deepEqual(validateAgentToolFaceUsecases(manifest, published), [])
  assert.deepEqual(manifest.cases.filter(entry => entry.offline).map(entry => entry.offline.operation).sort(), Object.keys(creativeComponentArgumentSchemas).sort())
})
for (const name of manifest.cases.filter(entry => entry.offline).map(entry => entry.offline.operation)) {
  test('missing creative verb remains an error: ' + name, () => {
    const missing = { ...manifest, canonicalVerbs: manifest.canonicalVerbs.filter(verb => verb !== name) }
    assert.ok(validateAgentToolFaceUsecases(missing, published).some(error => error.includes('published verb missing from manifest: ' + name)))
  })
}
test('unknown verbs and missing executable coverage still fail', () => {
  const unknown = structuredClone(manifest)
  unknown.cases[0].tools.push('invented_tool')
  assert.ok(validateAgentToolFaceUsecases(unknown, published).some(error => error.includes('unknown verb: invented_tool')))
  unknown.cases.find(entry => entry.offline).offline.operation = 'invented_tool'
  assert.ok(validateAgentToolFaceUsecases(unknown, published).some(error => error.includes('offline operation is not a published trajectory tool')))
  const missing = { ...manifest, cases: manifest.cases.filter(entry => !entry.tools.includes('handoff_model3d')) }
  assert.ok(validateAgentToolFaceUsecases(missing, published).some(error => error.includes('canonical verb has no user case: handoff_model3d')))
})
test('duplicates and false first-tool trajectories remain errors', () => {
  assert.ok(validateAgentToolFaceUsecases(manifest, [...published, published[0]]).some(error => error.includes('duplicate name')))
  const bad = structuredClone(manifest)
  bad.canonicalVerbs.push(bad.canonicalVerbs[0])
  bad.cases[0].firstTool = 'read_script'
  const errors = validateAgentToolFaceUsecases(bad, published)
  assert.ok(errors.some(error => error.includes('duplicate canonical')))
  assert.ok(errors.some(error => error.includes('must start the trajectory')))
})
