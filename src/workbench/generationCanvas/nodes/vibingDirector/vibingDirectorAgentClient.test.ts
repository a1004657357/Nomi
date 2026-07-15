import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  preferredVibingDirectorAgentProtocol,
  rememberVibingDirectorStructuredProtocol,
} from './vibingDirectorAgentClient'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
}

describe('VIBING Director agent protocol preference', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', localStorageStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('remembers structured text for only the provider/model that rejected native tools', () => {
    store.set('nomi.assistantModel', JSON.stringify({ vendorKey: 'zai-relay', modelKey: 'glm-5.2' }))

    expect(preferredVibingDirectorAgentProtocol()).toBe('tools')

    rememberVibingDirectorStructuredProtocol()

    expect(preferredVibingDirectorAgentProtocol()).toBe('structured-text')

    store.set('nomi.assistantModel', JSON.stringify({ vendorKey: 'another-relay', modelKey: 'glm-5.2' }))
    expect(preferredVibingDirectorAgentProtocol()).toBe('tools')
  })
})
