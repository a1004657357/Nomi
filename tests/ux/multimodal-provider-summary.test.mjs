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
