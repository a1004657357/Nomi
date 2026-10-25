import { describe, expect, it } from 'vitest'
import {
  modelSupportsImageInput,
  modelSupportsPdfInput,
} from './textModelCapabilities'

describe('renderer text model capabilities', () => {
  it('honors explicit capability metadata before model-name inference', () => {
    expect(modelSupportsImageInput('plain-model', null, { supportsImageInput: true })).toBe(true)
    expect(modelSupportsImageInput('gpt-4o', null, { supportsImageInput: false })).toBe(false)
    expect(modelSupportsPdfInput('plain-model', null, { supportsPdfInput: true })).toBe(true)
  })

  it('detects known vision families and rejects ordinary text-only models', () => {
    expect(modelSupportsImageInput('gpt-4o', null, undefined)).toBe(true)
    expect(modelSupportsImageInput('claude-3-5-sonnet', null, undefined)).toBe(true)
    expect(modelSupportsImageInput('qwen2.5-vl-72b', null, undefined)).toBe(true)
    expect(modelSupportsImageInput('doubao-seed-2.0-lite', null, undefined)).toBe(true)
    expect(modelSupportsImageInput('doubao-seed-2-0-pro-260215', null, undefined)).toBe(true)
    expect(modelSupportsImageInput('custom-endpoint', 'Doubao Seed 2.0 Pro', undefined)).toBe(true)
    expect(modelSupportsImageInput('deepseek-chat', null, undefined)).toBe(false)
    expect(modelSupportsImageInput('doubao-seed-1.6-lite', null, undefined)).toBe(false)
  })
})
