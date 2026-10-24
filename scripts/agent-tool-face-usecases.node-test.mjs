import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { validateAgentToolFaceUsecases } from './agent-tool-face-usecases-lib.mjs'
import { modelFacingToolSpecs } from '../electron/shared/agentCapabilities/modelFacingToolRegistry.ts'
import { creativeComponentArgumentSchemas } from '../electron/shared/agentCapabilities/creativeComponentSchemas.ts'
const manifest = JSON.parse(fs.readFileSync(new URL('../tests/system/agent-tool-face-usecases.json', import.meta.url), 'utf8'))
const published = modelFacingToolSpecs('internal').map(spec => spec.name)
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
