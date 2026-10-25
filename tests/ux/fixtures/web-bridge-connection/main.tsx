import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../../../src/styles/index.css'
import { NomiAppProviders } from '../../../../src/NomiAppProviders'
import { NomiColorSchemeProvider } from '../../../../src/theme/NomiColorSchemeProvider'
import i18n from '../../../../src/i18n'
import { WebBridgeConnectionCard, type WebBridgeStatus } from '../../../../src/ui/onboarding/WebBridgeConnectionCard'

const query = new URLSearchParams(location.search)
const bridgeKey = query.get('bridge') === 'pavoWeb' ? 'pavoWeb' : 'jimengWeb'
await i18n.changeLanguage(query.get('locale') === 'en' ? 'en' : 'zh-CN')

type Call = { bridgeKey: string; method: string; args: unknown[] }
const fixture = {
  status: {
    server: { ok: false, reachable: false, serverUrl: `http://fixture.invalid/${bridgeKey}`, sseClients: 0, taskTotal: 0 },
    runner: { available: true, running: false, browserOpen: false, clientOnline: false,
      extensionDir: `/fixture/${bridgeKey}/extension`, userDataDir: `/fixture/${bridgeKey}/session` },
    cookieCount: 0, likelyLoggedIn: false,
  } as WebBridgeStatus,
  calls: [] as Call[],
  changed: 0,
  pauseNext: false,
  release: undefined as (() => void) | undefined,
  failure: null as 'returned' | 'thrown' | null,
}

function apiFor(key: string) {
  async function invoke(method: string, args: unknown[] = []) {
    fixture.calls.push({ bridgeKey: key, method, args })
    if (fixture.pauseNext) {
      fixture.pauseNext = false
      await new Promise<void>(resolve => { fixture.release = resolve })
      fixture.release = undefined
    }
    const failure = fixture.failure
    fixture.failure = null
    if (failure === 'returned') return { error: 'fixture returned failure' }
    if (failure === 'thrown') throw new Error('fixture thrown failure')
    if (method === 'startRunner' || method === 'stopRunner') {
      const running = method === 'startRunner'
      Object.assign(fixture.status.server, { ok: running, reachable: running, sseClients: 0 })
      Object.assign(fixture.status.runner, { running, browserOpen: running, clientOnline: false })
    }
    return {}
  }
  return {
    startRunner: () => invoke('startRunner'), stopRunner: () => invoke('stopRunner'),
    openLogin: () => invoke('openLogin'), openAdmin: (url?: string) => invoke('openAdmin', [url]),
  }
}

// This is the existing preload seam, not an Electron process or a production test entry.
const bridge = { jimengWeb: apiFor('jimengWeb'), pavoWeb: apiFor('pavoWeb') }
if (query.get('missing') === 'api') Reflect.deleteProperty(bridge, bridgeKey)
// Direct exposure keeps externally controlled fault fields live in the built fixture.
const fixtureWindow = window as unknown as { nomiDesktop: typeof bridge; webBridgeFixture: typeof fixture }
fixtureWindow.nomiDesktop = bridge
fixtureWindow.webBridgeFixture = fixture

function Fixture(): React.JSX.Element {
  const [status, setStatus] = React.useState<WebBridgeStatus | null>(query.get('missing') === 'status' ? null : structuredClone(fixture.status))
  const group = bridgeKey === 'jimengWeb' ? 'jimengWeb' : 'pavoWeb'
  return <main className="min-h-screen bg-nomi-bg p-6 text-nomi-ink" data-testid="web-bridge-fixture">
    <section style={{ width: 480, maxWidth: '100%' }}>
      <WebBridgeConnectionCard bridgeKey={bridgeKey}
        name={i18n.t(`onboardingProviders.${group}.name`)}
        subtitle={i18n.t(`onboardingProviders.${group}.subtitle`)}
        description={i18n.t(`onboardingProviders.${group}.description`)} status={status}
        onChanged={() => { fixture.changed += 1; setStatus(structuredClone(fixture.status)) }} />
    </section>
  </main>
}

createRoot(document.getElementById('root')!).render(
  <NomiColorSchemeProvider><NomiAppProviders><Fixture /></NomiAppProviders></NomiColorSchemeProvider>,
)
