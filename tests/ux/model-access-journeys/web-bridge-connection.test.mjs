import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createWebBridgeJourneyHarness, exerciseWebBridgeJourney, WEB_BRIDGE_CASES } from '../web-bridge-connection.walk.mjs'

let harness
const output = process.env.NOMI_MODEL_ACCESS_OUTPUT_ROOT || path.resolve('.tmp/model-access-journeys/web-bridge')
beforeAll(async () => { harness = await createWebBridgeJourneyHarness(); fs.mkdirSync(output, { recursive: true }) })
afterAll(async () => { await harness?.close() })

it.each(WEB_BRIDGE_CASES)('J17 actual offline connection UI: $bridge / $locale', async input => {
  const ui = await harness.open(input)
  try {
    const report = await exerciseWebBridgeJourney(ui, input)
    fs.writeFileSync(path.join(output, `${input.bridge}-${input.locale}.json`), `${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    const state = await ui.page.evaluate(() => ({
      calls: window.webBridgeFixture.calls, status: window.webBridgeFixture.status,
      pauseNext: window.webBridgeFixture.pauseNext, awaitingRelease: typeof window.webBridgeFixture.release === 'function',
      renderedText: document.body.innerText,
    }))
    fs.writeFileSync(path.join(output, `${input.bridge}-${input.locale}.failure.json`), `${JSON.stringify({ status: 'FAIL', state, blocked: ui.blocked, pageErrors: ui.pageErrors }, null, 2)}\n`)
    throw error
  } finally { await ui.close() }
})

it.each(['api', 'status'])('does not offer actions when the real component is missing %s', async missing => {
  const ui = await harness.open({ bridge: 'jimengWeb', locale: 'en', missing })
  try {
    await expect.poll(() => ui.page.getByRole('button').count()).toBe(0)
    expect(await ui.page.evaluate(() => window.webBridgeFixture.calls)).toEqual([])
    expect(ui.blocked).toEqual([])
    expect(ui.pageErrors).toEqual([])
    fs.writeFileSync(path.join(output, `missing-${missing}.json`), `${JSON.stringify({ status: 'PASS', missing, calls: [], blocked: ui.blocked, pageErrors: ui.pageErrors })}\n`)
  } finally { await ui.close() }
})

it('blocks external origins and local POSTs before any bridge or network side effect', async () => {
  const ui = await harness.open({ bridge: 'jimengWeb', locale: 'en' })
  try {
    const failures = await ui.page.evaluate(async () => Promise.all([
      fetch('https://fixture.invalid/forbidden').then(() => false, () => true),
      fetch(`${location.origin}/__forbidden_submission`, { method: 'POST' }).then(() => false, () => true),
    ]))
    expect(failures).toEqual([true, true])
    expect(ui.blocked).toHaveLength(2)
    expect(ui.blocked).toContainEqual({ method: 'GET', url: 'https://fixture.invalid/forbidden' })
    expect(ui.blocked).toContainEqual(expect.objectContaining({ method: 'POST' }))
    expect(ui.requests.some(request => request.url.includes('forbidden'))).toBe(false)
    expect(await ui.page.evaluate(() => window.webBridgeFixture.calls)).toEqual([])
    fs.writeFileSync(path.join(output, 'network-tripwire.json'), `${JSON.stringify({ status: 'PASS', deliberatelyBlocked: ui.blocked, bridgeCalls: [] }, null, 2)}\n`)
  } finally { await ui.close() }
})
