import { describe, expect, it } from 'vitest'
import { localAssetThumbnailUrl } from './localAssetThumbnail'

describe('localAssetThumbnailUrl', () => {
  it('adds a bounded preview request to local project assets', () => {
    expect(localAssetThumbnailUrl('nomi-local://asset/project/image.png', { width: 160, height: 96 }))
      .toBe('nomi-local://asset/project/image.png?nomi-thumbnail=160x96')
  })

  it('preserves existing query parameters', () => {
    expect(localAssetThumbnailUrl('nomi-local://asset/project/image.png?v=2', { width: 160, height: 96 }))
      .toBe('nomi-local://asset/project/image.png?v=2&nomi-thumbnail=160x96')
  })

  it('does not rewrite remote or data URLs', () => {
    expect(localAssetThumbnailUrl('https://cdn.example/image.png', { width: 160, height: 96 }))
      .toBe('https://cdn.example/image.png')
    expect(localAssetThumbnailUrl('data:image/png;base64,abc', { width: 160, height: 96 }))
      .toBe('data:image/png;base64,abc')
  })
})
