// Run with node:test, not Vitest; this executes only the isolated report reducer.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source = fs.readFileSync(new URL('./multimodal-provider.paid.cjs', import.meta.url), 'utf8')
const start = source.indexOf('  report.state = report.cases.some')
const end = source.indexOf('}).catch(error => {', start)
assert.ok(start >= 0 && end > start, 'Acceptance terminal block must remain testable without Electron or spending')
const terminal = source.slice(start, end)

for (const scenario of [
  { name: 'all assets accepted', cases: ['passed'], transport: true, state: 'passed', exit: 0 },
  { name: 'successful siblings survive a rejected task', cases: ['passed', 'failed'], transport: false, state: 'failed', exit: 1 },
  { name: 'binding or queue evidence failed', cases: ['passed'], transport: false, state: 'failed', exit: 1 },
  { name: 'native dimensions mismatch is partial, not transport failure', cases: ['partial'], transport: true, state: 'partial', exit: 0 },
]) {
  test(scenario.name, () => {
    const context = { report: { cases: scenario.cases.map(state => ({ state })), batch: { transportPassed: scenario.transport } }, process: { exitCode: 0 } }
    vm.runInNewContext(terminal, context, { timeout: 1000 })
    assert.equal(context.report.state, scenario.state)
    assert.equal(context.process.exitCode, scenario.exit)
    assert.equal(context.report.cases.length, scenario.cases.length)
  })
}

test('single-image mode cannot start the second media intent', () => {
  assert.ok(source.includes('maxCreateIntents: singleImage ? 1 : batch ? 4 : 2'))
  assert.ok(source.includes("channel === 'cliproxy' && !singleImage"))
  assert.ok(source.includes("else if (channel !== 'cliproxy')"))
  assert.ok(source.includes("activeIntent.httpPosts >= 1"))
  assert.ok(source.includes("if (singleImage && (batch || channel !== 'cliproxy'))"))
})

test('the unchanged summary cases are owned by the reachable Node runner, not Vitest', () => {
  const scripts = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts
  assert.match(scripts['test:eng-system'], /node --test[^&]*\.\/tests\/ux\/multimodal-provider-summary\.node-test\.mjs/)
  assert.match(scripts.test, /pnpm run test:eng-system/)
  assert.equal(fs.existsSync(new URL('./multimodal-provider-summary.test.mjs', import.meta.url)), false)
})
