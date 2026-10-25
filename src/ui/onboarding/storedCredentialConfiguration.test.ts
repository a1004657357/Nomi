import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomVendorCard } from './CustomVendorCard'
import { canAddModelsToConnection } from './onboardingDrawerDerivations'
import { projectOnboardingConnections } from './onboardingDrawerConnections'
import type { OnboardingVendorMeta } from './useOnboardingDrawerCatalog'
import { zhOnboardingProviders, enOnboardingProviders } from '../../i18n/locales/onboardingProviders'

const health = vi.hoisted(() => vi.fn(() => ({ connection: null, recheck: vi.fn() })))
vi.mock('./useVendorHealth', () => ({ useVendorHealth: health }))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => null }))
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }),
}))

const meta = (patch: Partial<OnboardingVendorMeta> = {}): OnboardingVendorMeta => ({
  name: 'Synthetic Relay', hasApiKey: false, hasStoredApiKey: true, enabled: false,
  baseUrl: 'http://127.0.0.1:1/v1', authType: 'bearer', customCallOnly: false, ...patch,
})
const renderCard = (vendorMeta: OnboardingVendorMeta) => renderToStaticMarkup(React.createElement(MantineProvider, {
  children: React.createElement(CustomVendorCard, { vendorKey: 'cliproxy-local', name: 'Synthetic Relay',
    vendorMeta, models: [], detailMode: true, onToggle: vi.fn(), onDelete: vi.fn(), onCustomCall: vi.fn(), onRetype: vi.fn(), onChanged: vi.fn() }),
}))

beforeEach(() => vi.clearAllMocks())

describe('stored credentials remain configurable without becoming executable', () => {
  it.each(['cliproxy-local', 'private-relay'])('allows the saved/unready %s connection into the existing picker without enabling it', vendorKey => {
    const saved = meta()
    const vendorMeta = new Map([[vendorKey, saved]])
    expect(canAddModelsToConnection(vendorKey, vendorMeta)).toBe(true)
    const openPage = vi.fn()
    const projection = projectOnboardingConnections({ models: [], vendorMeta, dreaminaStatus: null, openPage,
      localNames: { dreamina: 'Dreamina', codex: 'Codex', antigravity: 'Antigravity', jimengWeb: 'Jimeng', pavoWeb: 'Pavo' } })
    expect(projection.homeConnections[0].onAddModels).toEqual(expect.any(Function))
    projection.homeConnections[0].onAddModels?.()
    expect(openPage).toHaveBeenCalledWith({ type: 'add', existingVendorKey: vendorKey })
    expect(saved.hasApiKey).toBe(false)
    expect(saved.enabled).toBe(false)
  })

  it('shows a saved/pending key as masked on reopen while health receives ready=false', () => {
    const html = renderCard(meta())
    expect(html).toContain('data-model-connection-edit="apiKey"')
    expect(html).toContain('onboardingProviders.workspace.credentialSavedPending')
    expect(html).not.toContain('data-model-connection-field="apiKey"')
    expect(health).toHaveBeenCalledWith('cliproxy-local', expect.objectContaining({ hasApiKey: false }))
  })

  it('keeps a replacement saved/masked after readiness drops, including the next reopen', () => {
    expect(renderCard(meta({ hasApiKey: true, enabled: true }))).toContain('onboardingProviders.vendorCard.credentialSaved')
    for (const pending of [meta(), meta({ credentialVerificationPending: true })]) {
      const html = renderCard(pending)
      expect(html).toContain('data-model-connection-edit="apiKey"')
      expect(html).toContain('onboardingProviders.workspace.credentialSavedPending')
      expect(html).not.toContain('data-model-connection-field="apiKey"')
    }
    expect(health).toHaveBeenLastCalledWith('cliproxy-local', expect.objectContaining({ hasApiKey: false }))
  })

  it('retains an empty editor and navigation denial after a genuine clear', () => {
    const cleared = meta({ hasStoredApiKey: false })
    const html = renderCard(cleared)
    expect(html).toContain('data-model-connection-field="apiKey"')
    expect(html).not.toContain('onboardingProviders.workspace.credentialSavedPending')
    expect(canAddModelsToConnection('cliproxy-local', new Map([['cliproxy-local', cleared]]))).toBe(false)
  })

  it('keeps legacy-ready DTOs usable without inventing a stored key for a legacy-unready DTO', () => {
    const ready = meta({ hasStoredApiKey: undefined, hasApiKey: true })
    expect(renderCard(ready)).toContain('data-model-connection-edit="apiKey"')
    const absent = meta({ hasStoredApiKey: undefined })
    expect(renderCard(absent)).toContain('data-model-connection-field="apiKey"')
    expect(canAddModelsToConnection('cliproxy-local', new Map([['cliproxy-local', absent]]))).toBe(false)
  })

  it('does not grant generic picker navigation to native CLI/account targets even with stored credentials', () => {
    for (const vendorKey of ['antigravity-cli', 'codex-local', 'comfyui-local', 'pavo-web', 'jimeng-web']) {
      expect(canAddModelsToConnection(vendorKey, new Map([[vendorKey, meta()]]))).toBe(false)
    }
  })

  it('maps the physical-storage flag separately from readiness at the catalog hook boundary', () => {
    const source = fs.readFileSync(new URL('./useOnboardingDrawerCatalog.ts', import.meta.url), 'utf8')
    expect(source).toContain('hasStoredApiKey:')
    expect(source).toContain('vendor.hasStoredApiKey')
    expect(source).toContain('hasApiKey: Boolean(vendor.hasApiKey)')
  })

  it('provides explicit pending-saved status in Chinese and English', () => {
    expect(zhOnboardingProviders.workspace.credentialSavedPending).toBe('API Key 已保存，待验证')
    expect(enOnboardingProviders.workspace.credentialSavedPending).toBe('API Key saved, verification pending')
  })
})
