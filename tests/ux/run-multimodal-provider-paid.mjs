import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = process.env.NOMI_ACCEPTANCE_RUN_ROOT
const channel = process.env.NOMI_ACCEPTANCE_CHANNEL
if (!root || !path.isAbsolute(root) || !['cliproxy', 'plan'].includes(channel)) throw new Error('Explicit channel and fresh absolute run root required')
if (fs.existsSync(root)) throw new Error('Run root already exists; never rerun a paid batch or overwrite its receipt')
fs.mkdirSync(root, { recursive: true, mode: 0o700 })
const nonce = crypto.randomUUID()
fs.writeFileSync(path.join(root, '.nomi-acceptance'), nonce, { mode: 0o600, flag: 'wx' })
const log = fs.openSync(path.join(root, 'runtime.log'), 'wx', 0o600)
const script = fileURLToPath(new URL(process.env.NOMI_ACCEPTANCE_MODE === 'recovery'
  ? './cliproxy-recovery.acceptance.cjs' : './multimodal-provider.paid.cjs', import.meta.url))
const env = { ...process.env, NOMI_ACCEPTANCE_NONCE: nonce }
delete env.ELECTRON_RUN_AS_NODE
const executable = process.env.NOMI_ACCEPTANCE_ELECTRON || require('electron')
const child = spawn(executable, [script], { cwd: path.resolve(path.dirname(script), '../..'), env, stdio: ['ignore', log, log] })
fs.writeFileSync(path.join(root, 'launcher-start.json'), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }))
child.once('error', error => console.error(JSON.stringify({ error: error.code || error.name })))
const forward = signal => { if (child.exitCode === null) child.kill(signal) }
const onInt = () => forward('SIGINT')
const onTerm = () => forward('SIGTERM')
process.on('SIGINT', onInt)
process.on('SIGTERM', onTerm)
let terminalAt = 0
let cleanupSignal = null
const teardown = setInterval(() => {
  try {
    const report = JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8'))
    if (!report.finishedAt) return
    terminalAt ||= Date.now()
    const elapsed = Date.now() - terminalAt
    if (elapsed > 10_000 && cleanupSignal !== 'SIGKILL') {
      cleanupSignal = 'SIGKILL'; forward('SIGKILL')
    } else if (elapsed > 5_000 && cleanupSignal === null) {
      cleanupSignal = 'SIGTERM'; forward('SIGTERM')
    }
  } catch { /* No terminal receipt: never interrupt a possible paid submission. */ }
}, 500)
const result = await new Promise(resolve => {
  child.once('exit', (code, signal) => resolve({ code, signal }))
  child.once('error', () => { if (child.pid === undefined) resolve({ code: 1, signal: null }) })
})
clearInterval(teardown)
process.off('SIGINT', onInt)
process.off('SIGTERM', onTerm)
fs.closeSync(log)
const settings = path.join(root, 'settings')
fs.rmSync(settings, { recursive: true, force: true })
const receipt = { ...result, cleanupSignal, childExited: true, settingsRemoved: !fs.existsSync(settings), finishedAt: new Date().toISOString() }
fs.writeFileSync(path.join(root, 'launcher-receipt.json'), JSON.stringify(receipt, null, 2))
console.log(JSON.stringify({ runRoot: root, ...receipt }))
process.exitCode = result.code ?? 1
