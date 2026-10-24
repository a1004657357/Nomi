import { describe, expect, it } from 'vitest'
import * as renderer from '../../src/config/textModelCapabilities'
import * as main from '../ai/agentUserContent'
import * as shared from './textModelCapabilities'

describe('shared selected-text-model capability owner', () => {
  it('exposes the same three-argument predicates at both original boundaries', () => {
    expect(renderer.modelSupportsImageInput).toBe(main.modelSupportsImageInput)
    expect(renderer.modelSupportsPdfInput).toBe(main.modelSupportsPdfInput)
    expect(renderer.modelSupportsImageInput).toBe(shared.modelSupportsImageInput)
    expect(renderer.modelSupportsPdfInput).toBe(shared.modelSupportsPdfInput)
    expect(renderer.modelSupportsImageInput.length).toBe(3)
    expect(renderer.modelSupportsPdfInput.length).toBe(3)
  })

  it.each([renderer, main])('preserves explicit booleans and existing family inference at either edge', edge => {
    for (const value of [true, false]) {
      expect(edge.modelSupportsImageInput('gpt-4o', 'Gemini', { supportsImageInput: value })).toBe(value)
      expect(edge.modelSupportsPdfInput('gpt-4o', 'Gemini', { supportsPdfInput: value })).toBe(value)
    }
    expect(edge.modelSupportsImageInput('custom', 'Doubao Seed 2.0 Pro', undefined)).toBe(true)
    expect(edge.modelSupportsImageInput('deepseek-chat', null, undefined)).toBe(false)
    expect(edge.modelSupportsPdfInput('claude-3-haiku', null, undefined)).toBe(false)
    expect(edge.modelSupportsPdfInput('gpt-4o', null, undefined)).toBe(true)
  })
})
