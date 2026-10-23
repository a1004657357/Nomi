import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectOnboardingConnections } from './onboardingDrawerConnections'
import { buildExistingConnectionSummary, canAddModelsToConnection } from './onboardingDrawerDerivations'
import { CustomVendorCard } from './CustomVendorCard'
import { ExistingConnectionModelPicker } from './ExistingConnectionModelPicker'
import { ConnectionWorkspacePage } from './ModelSettingsWorkspacePages'
import { ModelSettingsHome } from './ModelSettingsHome'
import { runModelDiscovery } from './modelDiscovery'
import type { ChipModel } from './ModelChipGroups'
import type { OnboardingVendorMeta } from './useOnboardingDrawerCatalog'

// Synthetic bridge only. This suite never opens a desktop profile or contacts a provider.
const bridge = vi.hoisted(() => ({ onboarding: { httpConnectionListModels: vi.fn(), guessKinds: vi.fn() } }))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => bridge }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const localNames = { dreamina: 'Dreamina', codex: 'Codex', antigravity: 'Antigravity', jimengWeb: 'Jimeng', pavoWeb: 'Pavo' }
const ids = ['gpt-6-sol', 'gpt-image-2']
const modelsFor = (vendorKey: string): ChipModel[] => ids.map((modelKey) => ({
  vendorKey, modelKey, labelZh: modelKey, kind: modelKey === 'gpt-image-2' ? 'image' : 'text',
  enabled: true, published: true, adapterState: 'verified', availability: { usable: true },
}))
const metaFor = (hasApiKey = true): OnboardingVendorMeta => ({
  name: 'Synthetic API Proxy', hasApiKey, baseUrl: 'http://127.0.0.1:1/v1',
  enabled: true, authType: hasApiKey ? 'bearer' : 'none', customCallOnly: false,
})
const render = (element: React.ReactElement) => renderToStaticMarkup(React.createElement(MantineProvider, { children: element }))

beforeEach(() => vi.clearAllMocks())

describe('CLIProxy configuration uses the existing API connection UI', () => {
  it('retains the existing missing-credential gate without hiding connection editing', () => {
    const result = projectOnboardingConnections({
      models: modelsFor('cliproxy-local'), vendorMeta: new Map([['cliproxy-local', { ...metaFor(), hasApiKey: false }]]),
      dreaminaStatus: null, localNames, openPage: vi.fn(),
    })
    expect(result.homeConnections[0].kind).toBe('api')
    expect(result.homeConnections[0].onOpen).toEqual(expect.any(Function))
    expect(result.homeConnections[0].onAddModels).toBeUndefined()
  })

  it('does not give native CLI connections API editing or add-model actions', () => {
    const result = projectOnboardingConnections({
      models: modelsFor('antigravity-cli'), vendorMeta: new Map([['antigravity-cli', metaFor(false)]]),
      dreaminaStatus: null, localNames, openPage: vi.fn(),
    })
    expect(result.homeConnections[0].kind).toBe('local')
    expect(result.homeConnections[0].onAddModels).toBeUndefined()
    const html = render(React.createElement(ModelSettingsHome, {
      connections: result.homeConnections, availableConnections: [], mappings: [], loaded: true,
      bridgeMissing: false, loadError: null, readOnly: null, taskCount: 0,
      onReload: vi.fn(), onCustomApi: vi.fn(), onDirectScript: vi.fn(), onImported: vi.fn(),
    }))
    expect(html).not.toContain('data-model-home-api-actions')
    expect(html).not.toContain('onboardingProviders.workspace.editConnection')
  })

  it.each(['cliproxy-local', 'private-relay-local'])('binds the visible add-model command to the saved %s connection', (vendorKey) => {
    const openPage = vi.fn()
    const result = projectOnboardingConnections({
      models: modelsFor(vendorKey), vendorMeta: new Map([[vendorKey, metaFor()]]), dreaminaStatus: null, localNames, openPage,
    })
    const entry = result.homeConnections[0]
    expect(entry).toHaveProperty('onAddModels', expect.any(Function))
    Reflect.get(entry, 'onAddModels')()
    expect(openPage).toHaveBeenCalledWith({ type: 'add', existingVendorKey: vendorKey })
    expect(bridge.onboarding.httpConnectionListModels).not.toHaveBeenCalled()
  })

  it('names API editing and model addition on the home row without nested buttons', () => {
    const projection = projectOnboardingConnections({
      models: modelsFor('cliproxy-local'), vendorMeta: new Map([['cliproxy-local', metaFor()]]), dreaminaStatus: null, localNames, openPage: vi.fn(),
    })
    const html = render(React.createElement(ModelSettingsHome, {
      connections: projection.homeConnections, availableConnections: [], mappings: [], loaded: true,
      bridgeMissing: false, loadError: null, readOnly: null, taskCount: 0,
      onReload: vi.fn(), onCustomApi: vi.fn(), onDirectScript: vi.fn(), onImported: vi.fn(),
    }))
    expect(html).toContain('onboardingProviders.workspace.editConnection')
    expect(html).toContain('onboardingProviders.workspace.addOtherModels')
    expect(html).toContain('data-model-home-api-actions="cliproxy-local"')
    expect(html).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/)
    expect(bridge.onboarding.httpConnectionListModels).not.toHaveBeenCalled()
  })

  it('does not hide the detail add-model label at narrow widths', () => {
    const html = render(React.createElement(ConnectionWorkspacePage, {
      vendorKey: 'cliproxy-local', title: 'Fixture', details: React.createElement('div'),
      canAddModels: true, onAddModels: vi.fn(), onBack: vi.fn(),
    }))
    expect(html).not.toContain('class="hidden sm:inline">onboardingProviders.workspace.addOtherModels')
  })

  it.each(['cliproxy-local', 'private-relay-local'])('%s is an editable API connection, not a native CLI', (vendorKey) => {
    const models = modelsFor(vendorKey)
    const vendorMeta = new Map([[vendorKey, metaFor()]])
    const openPage = vi.fn()
    const result = projectOnboardingConnections({ models, vendorMeta, dreaminaStatus: null, localNames, openPage })
    expect(result.otherVendorGroups).toEqual([{ vendorKey, name: 'Synthetic API Proxy', models }])
    expect(result.homeConnections).toHaveLength(1)
    expect(result.homeConnections[0]).toMatchObject({ vendorKey, kind: 'api', models })
    result.homeConnections[0].onOpen()
    expect(openPage).toHaveBeenCalledWith({ type: 'connection', vendorKey })
    expect(canAddModelsToConnection(vendorKey, vendorMeta)).toBe(true)
  })

  it.each([true, false])('keeps API configuration/add-model ownership when hasApiKey=%s', (hasApiKey) => {
    const vendorKey = 'cliproxy-local'
    const vendorMeta = new Map([[vendorKey, metaFor(hasApiKey)]])
    const result = projectOnboardingConnections({ models: [], vendorMeta, dreaminaStatus: null, localNames, openPage: vi.fn() })
    expect(result.otherVendorGroups.map(group => group.vendorKey)).toEqual([vendorKey])
    expect(result.homeConnections[0].kind).toBe('api')
    expect(canAddModelsToConnection(vendorKey, vendorMeta)).toBe(true)
  })

  it.each(['cliproxy-local', 'private-relay-local'])('renders the existing URL/key fields and add-model action for %s', (vendorKey) => {
    const meta = metaFor()
    const models = modelsFor(vendorKey)
    const details = React.createElement(CustomVendorCard, {
      vendorKey, name: meta.name, models, vendorMeta: meta, detailMode: true,
      onToggle: vi.fn(), onDelete: vi.fn(), onCustomCall: vi.fn(), onRetype: vi.fn(), onChanged: vi.fn(),
    })
    const html = render(React.createElement(ConnectionWorkspacePage, {
      vendorKey, title: meta.name, details, canAddModels: canAddModelsToConnection(vendorKey, new Map([[vendorKey, meta]])),
      onAddModels: vi.fn(), onBack: vi.fn(),
    }))
    expect(html).toContain('data-vendor-connection-group')
    expect(html).toContain('data-model-connection-edit="apiKey"')
    expect(html).toContain('onboardingProviders.vendorCard.editAddressAria')
    expect(html).toContain('onboardingProviders.workspace.addOtherModels')
    expect(html).toContain(meta.baseUrl)
    expect(html).toContain('gpt-image-2')
    expect(html).not.toContain('gpt-image-2-text-to-image')
    expect(bridge.onboarding.httpConnectionListModels).not.toHaveBeenCalled()
  })

  it('opens the existing picker without reading credentials or fetching upstream on render', () => {
    const vendorKey = 'cliproxy-local'
    const initialConnection = buildExistingConnectionSummary(vendorKey, 'Synthetic API Proxy', modelsFor(vendorKey), new Map([[vendorKey, metaFor()]]))!
    expect(initialConnection.existingModels.map(model => model.modelKey)).toEqual(ids)
    expect(Object.keys(initialConnection).sort()).toEqual(['baseUrl', 'existingModels', 'vendorKey', 'vendorName'])
    const html = render(React.createElement(ExistingConnectionModelPicker, {
      opened: true, vendorKey, initialConnection, confirming: false, onBack: vi.fn(), onConfirm: vi.fn(),
    }))
    expect(html).toContain('onboardingProviders.modelControls.fetch')
    expect(html).toContain('gpt-6-sol')
    expect(html).toContain('gpt-image-2')
    expect(html).toContain('onboardingProviders.modelControls.manual')
    expect(bridge.onboarding.httpConnectionListModels).not.toHaveBeenCalled()
    expect(bridge.onboarding.guessKinds).not.toHaveBeenCalled()
  })

  it('adds more exact model IDs from an explicit synthetic list without replacing registered IDs', async () => {
    const existing = modelsFor('cliproxy-local').map(model => ({ id: model.modelKey, kind: model.kind }))
    const load = vi.fn().mockResolvedValue({ ok: true, models: [...ids, 'gpt-6-extra', 'private/image-model'] })
    const result = await runModelDiscovery({
      existing, previous: existing, load, isCurrent: () => true,
      guessKinds: async () => ({ kinds: { 'gpt-6-extra': 'text', 'private/image-model': 'image' } }),
    })
    expect(load).toHaveBeenCalledTimes(1)
    expect(result?.candidates).toEqual([...existing, { id: 'gpt-6-extra', kind: 'text' }, { id: 'private/image-model', kind: 'image' }])
    expect(result?.remoteTotal).toBe(4)
  })

  it('preserves registered models and an explicit list failure instead of inventing a two-model restriction', async () => {
    const existing = modelsFor('cliproxy-local').map(model => ({ id: model.modelKey, kind: model.kind }))
    const result = await runModelDiscovery({
      existing, previous: existing, isCurrent: () => true,
      load: async () => ({ ok: false, code: 'MODEL_LIST_UNAVAILABLE', failureKind: 'unsupported' }),
    })
    expect(result?.candidates).toEqual(existing)
    expect(result?.result.ok).toBe(false)
    expect(result?.result.code).toBe('MODEL_LIST_UNAVAILABLE')
  })
})
