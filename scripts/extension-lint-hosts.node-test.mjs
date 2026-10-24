import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ESLint } from 'eslint'

const lint = new ESLint()
const file = name => `integrations/pavo-web-adapter/${name}`

test('Pavo browser scripts get browser and extension APIs, but not Node globals', async () => {
  for (const name of ['content.js', 'panel.js']) {
    const [result] = await lint.lintText('chrome.runtime.sendMessage({ url: document.URL }); process.exit();', { filePath: file(name) })
    const missing = result.messages.filter(message => message.ruleId === 'no-undef')
    assert.equal(missing.length, 1)
    assert.match(missing[0].message, /process/)
  }
})

test('Pavo background is a service worker, not a page or an all-globals exception', async () => {
  const [result] = await lint.lintText('chrome.runtime.getManifest(); fetch("https://example.invalid"); document.title;', { filePath: file('background.js') })
  const missing = result.messages.filter(message => message.ruleId === 'no-undef')
  assert.equal(missing.length, 1)
  assert.match(missing[0].message, /document/)
})

test('Pavo local helpers keep real CommonJS and unknown identifiers still fail', async () => {
  for (const name of ['mock-server.js', 'reference-store.js', 'server-auth.js']) {
    const config = await lint.calculateConfigForFile(file(name))
    assert.equal(config.languageOptions.sourceType, 'commonjs')
    const [result] = await lint.lintText('const fs = require("node:fs"); module.exports = fs.existsSync; misspelledRuntimeApi();', { filePath: file(name) })
    const errors = result.messages.filter(message => message.severity === 2)
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /misspelledRuntimeApi/)
  }
})

test('the retained Pavo demo fixtures are offline-only and preserve all three examples', async () => {
  const { default: presets } = await import('../electron/pavoWeb/fixtures/preset-tasks.cjs')
  const tasks = new Map()
  presets.initPresetTasks(task => tasks.set(`fixture-${tasks.size}`, task), tasks)
  assert.equal(tasks.size, 3)
  assert.deepEqual([...tasks.values()].map(task => task.description), ['女孩跳舞测试视频', '风景延时摄影', '产品展示旋转'])
  for (const task of tasks.values()) {
    assert.equal(task.realSubmit, false)
    for (const reference of task.referenceFiles) {
      const bytes = Buffer.from(reference.base64.split(',')[1], 'base64')
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
      assert.equal(bytes.readUInt32BE(16), 512)
      assert.equal(bytes.readUInt32BE(20), 512)
    }
  }
})
