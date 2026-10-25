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

  it('uses structured planning for every provider, while compatibility notes stay provider/model scoped', () => {
    store.set('nomi.assistantModel', JSON.stringify({ vendorKey: 'zai-relay', modelKey: 'glm-5.2' }))

    expect(preferredVibingDirectorAgentProtocol()).toBe('structured-text')

    rememberVibingDirectorStructuredProtocol()

    expect(preferredVibingDirectorAgentProtocol()).toBe('structured-text')
    expect(store.get('nomi.vibingDirector.structuredProtocol:zai-relay:glm-5.2')).toBe('structured-text')

    store.set('nomi.assistantModel', JSON.stringify({ vendorKey: 'another-relay', modelKey: 'glm-5.2' }))
    expect(preferredVibingDirectorAgentProtocol()).toBe('structured-text')
    expect(store.has('nomi.vibingDirector.structuredProtocol:another-relay:glm-5.2')).toBe(false)
  })
})
