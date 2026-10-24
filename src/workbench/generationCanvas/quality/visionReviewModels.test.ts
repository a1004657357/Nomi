import { describe, expect, it } from 'vitest'
import type {
  ModelCatalogModelDto,
  ModelCatalogVendorDto,
} from '../../api/modelCatalogApi'
import { visionReviewModelOptions } from './visionReviewModels'

function vendor(
  key: string,
  patch: Partial<ModelCatalogVendorDto> = {},
): ModelCatalogVendorDto {
  return {
    key,
    name: key.toUpperCase(),
    enabled: true,
    hasApiKey: true,
    authType: 'bearer',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...patch,
  }
}

function model(
  vendorKey: string,
  modelKey: string,
  patch: Partial<ModelCatalogModelDto> = {},
): ModelCatalogModelDto {
  return {
    vendorKey,
    modelKey,
    labelZh: modelKey,
    kind: 'text',
    enabled: true,
    published: true,
    publishedModes: ['chat'],
    availability: { usable: true },
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...patch,
  }
}

describe('visionReviewModelOptions', () => {
  it('uses the shared model availability decision instead of reconstructing readiness', () => {
    const options = visionReviewModelOptions([
      model('connected', 'gpt-4o', { published: false, availability: { usable: false, reason: 'model_unpublished' } }),
      model('connected', 'gemini-2.5-pro', { availability: undefined }),
      model('connected', 'claude-3-5-sonnet', { availability: { usable: false, reason: 'credential_locked' } }),
    ], [vendor('connected')])
    expect(options).toEqual([])
  })

  it('only exposes executable text models that support image input', () => {
    const options = visionReviewModelOptions(
      [
        model('connected', 'explicit-vision', { meta: { supportsImageInput: true } }),
        model('connected', 'gpt-4o'),
        model('connected', 'doubao-seed-2.0-lite'),
        model('connected', 'deepseek-chat'),
        model('disconnected', 'gemini-2.5-pro', {
          availability: { usable: false, reason: 'credential_missing' },
        }),
        model('disabled-vendor', 'claude-3-5-sonnet', {
          availability: { usable: false, reason: 'vendor_disabled' },
        }),
        model('connected', 'disabled-model', {
          enabled: false,
          availability: { usable: false, reason: 'model_disabled' },
          meta: { supportsImageInput: true },
        }),
        model('local', 'qwen2.5-vl-7b'),
      ],
      [
        vendor('connected'),
        vendor('disconnected', { hasApiKey: false }),
        vendor('disabled-vendor', { enabled: false }),
        vendor('local', { authType: 'none', hasApiKey: false }),
      ],
    )

    expect(options.map((option) => `${option.vendorKey}/${option.modelKey}`)).toEqual([
      'connected/doubao-seed-2.0-lite',
      'connected/explicit-vision',
      'connected/gpt-4o',
      'local/qwen2.5-vl-7b',
    ])
  })

  it('lets an explicit false capability override a vision-looking model id', () => {
    expect(visionReviewModelOptions(
      [model('connected', 'gpt-4o', { meta: { supportsImageInput: false } })],
      [vendor('connected')],
    )).toEqual([])
  })
})
