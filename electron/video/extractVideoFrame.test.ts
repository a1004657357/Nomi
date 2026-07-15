import { describe, expect, it } from 'vitest'
import { videoFrameCacheRelativePath } from './extractVideoFrame'

describe('videoFrameCacheRelativePath', () => {
  it('为同一视频和帧位生成稳定路径', () => {
    const first = videoFrameCacheRelativePath('nomi-local://asset/p/assets/generated/clip.mp4', 'first')
    const second = videoFrameCacheRelativePath('nomi-local://asset/p/assets/generated/clip.mp4', 'first')
    expect(first).toBe(second)
    expect(first).toMatch(/^assets\/generated\/video-frames\/frame-first-[a-f0-9]{24}\.png$/)
  })

  it('不同视频或帧位不会共用缓存文件', () => {
    const videoAFirst = videoFrameCacheRelativePath('https://cdn.example/a.mp4', 'first')
    const videoALast = videoFrameCacheRelativePath('https://cdn.example/a.mp4', 'last')
    const videoBFirst = videoFrameCacheRelativePath('https://cdn.example/b.mp4', 'first')
    expect(new Set([videoAFirst, videoALast, videoBFirst]).size).toBe(3)
  })

  it('不把远端 URL 或查询参数暴露到文件名', () => {
    const relativePath = videoFrameCacheRelativePath('https://cdn.example/private.mp4?token=secret', 1.25)
    expect(relativePath).toMatch(/^assets\/generated\/video-frames\/frame-at-[a-f0-9]{24}\.png$/)
    expect(relativePath).not.toContain('secret')
  })
})
