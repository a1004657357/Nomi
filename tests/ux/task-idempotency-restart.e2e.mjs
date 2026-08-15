// Production-wiring smoke: two real Electron processes, local invalid vendor only, no Provider request.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { isolatedElectronLaunchOptions } from './helpers/electronFixture.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-idempotency-restart-'))
const launch = isolatedElectronLaunchOptions(repoRoot, tempRoot)
const payload = {
  vendor: 'nomi-local-invalid-vendor',
  request: {
    kind: 'text_to_video',
    prompt: 'local restart fixture; must never reach a provider',
    extras: { idempotencyKey: 'restart-fixture-key', modelKey: 'invalid-model' },
  },
}

function assert(condition, message) {
  if (!condition) throw new Error(`IDEMPOTENCY RESTART FAIL: ${message}`)
  console.log(`  ✓ ${message}`)
}

async function launchAndSubmit() {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: launch.args,
    cwd: launch.cwd,
    env: { ...launch.env, NOMI_E2E_SMOKE: '1', NOMI_DISABLE_CAPABILITY_CORE: '1' },
  })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    return await win.evaluate(async (taskPayload) => {
      try {
        await window.nomiDesktop.tasks.run(taskPayload)
        return 'unexpected success'
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, payload)
  } finally {
    await app.close()
  }
}

try {
  const firstError = await launchAndSubmit()
  assert(/invalid|vendor|模型|供应商/i.test(firstError), 'first process reaches local validation only')

  const ledgerPath = path.join(launch.paths.settingsDir, 'tasks', 'ledger.jsonl')
  assert(fs.existsSync(ledgerPath), 'production main initializes and writes settings/tasks/ledger.jsonl')
  const firstLines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean)
  const firstRecords = firstLines.map((line) => JSON.parse(line))
  assert(firstRecords.some((record) => record.status === 'submitting'), 'submitting is durable before execution settles')
  assert(firstRecords.at(-1)?.status === 'unknown', 'ambiguous failure is durable as unknown')

  const secondError = await launchAndSubmit()
  assert(/上一会话|不会自动重发|新意图|人工核对/.test(secondError), 'second process rejects replay instead of create')
  const secondLines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean)
  assert(secondLines.length === firstLines.length, 'restart replay performs no second ledger submission')
  console.log('IDEMPOTENCY RESTART PASS: 6 assertions, 2 Electron processes, 0 Provider requests')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
