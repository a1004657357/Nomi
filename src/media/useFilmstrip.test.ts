import { describe, expect, it } from 'vitest'
import { resolveFilmstripRequest } from './useFilmstrip'

describe('resolveFilmstripRequest', () => {
  it('uses the project encoded in a cross-project local asset URL', () => {
    const videoUrl = 'nomi-local://asset/project%20a/assets/generated/video.mp4'

    expect(resolveFilmstripRequest(videoUrl, {
      explicitProjectId: 'project-b',
      activeProjectId: 'project-c',
    })).toEqual({
      videoUrl,
      projectId: 'project a',
      key: `project a::${videoUrl}`,
    })
  })

  it('falls back from an explicit project to the active project for non-local URLs', () => {
    expect(resolveFilmstripRequest('https://cdn.test/video.mp4', {
      explicitProjectId: 'project-b',
      activeProjectId: 'project-c',
    })?.projectId).toBe('project-b')

    expect(resolveFilmstripRequest('https://cdn.test/video.mp4', {
      activeProjectId: 'project-c',
    })?.projectId).toBe('project-c')
  })

  it('rejects an empty URL or a request with no usable project', () => {
    expect(resolveFilmstripRequest('', { activeProjectId: 'project-c' })).toBeNull()
    expect(resolveFilmstripRequest('https://cdn.test/video.mp4', {})).toBeNull()
  })
})
