import { describe, expect, it } from 'vitest'
import {
  DENSE_EDGE_PAN_THRESHOLD,
  LIGHTWEIGHT_NODE_RENDER_THRESHOLD,
  MEDIA_HEAVY_NODE_THRESHOLD,
  resolveCanvasPerformanceProfile,
  shouldDeferCanvasEdgesWhilePanning,
  resolveLightweightNodePreview,
  shouldRenderFullNodeContent,
  shouldUseLightweightNodeRendering,
} from './canvasNodeLevelOfDetail'

describe('canvas node level of detail', () => {
  it('uses lightweight rendering only for large zoomed-out canvases', () => {
    expect(shouldUseLightweightNodeRendering(LIGHTWEIGHT_NODE_RENDER_THRESHOLD, 0.3)).toBe(false)
    expect(shouldUseLightweightNodeRendering(LIGHTWEIGHT_NODE_RENDER_THRESHOLD + 1, 0.3)).toBe(true)
    expect(shouldUseLightweightNodeRendering(LIGHTWEIGHT_NODE_RENDER_THRESHOLD + 1, 1)).toBe(false)
  })

  it('keeps selected and focused nodes fully interactive in lightweight mode', () => {
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: false, focusFlash: false })).toBe(false)
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: true, focusFlash: false })).toBe(true)
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: false, focusFlash: true })).toBe(true)
    expect(shouldRenderFullNodeContent({ lightweightMode: false, selected: false, focusFlash: false })).toBe(true)
  })

  it('defers expensive SVG edges only on dense canvases while the viewport moves', () => {
    expect(shouldDeferCanvasEdgesWhilePanning(DENSE_EDGE_PAN_THRESHOLD - 1)).toBe(false)
    expect(shouldDeferCanvasEdgesWhilePanning(DENSE_EDGE_PAN_THRESHOLD)).toBe(true)
  })

  it('automatically reduces effects for media-heavy canvases without hiding normal-size nodes', () => {
    expect(resolveCanvasPerformanceProfile({
      preference: 'auto',
      nodeCount: 20,
      edgeCount: 10,
      mediaNodeCount: MEDIA_HEAVY_NODE_THRESHOLD,
      videoNodeCount: 0,
      zoom: 1,
    })).toEqual({
      lightweightNodes: false,
      reduceEffects: true,
      suspendMediaWhileMoving: true,
      deferEdgesWhileMoving: false,
    })
  })

  it('makes smooth mode aggressively defer edges and media while preserving selected-node recovery', () => {
    const profile = resolveCanvasPerformanceProfile({
      preference: 'smooth',
      nodeCount: 30,
      edgeCount: 2,
      mediaNodeCount: 2,
      videoNodeCount: 1,
      zoom: 0.7,
    })
    expect(profile).toEqual({
      lightweightNodes: true,
      reduceEffects: true,
      suspendMediaWhileMoving: true,
      deferEdgesWhileMoving: true,
    })
    expect(shouldRenderFullNodeContent({
      lightweightMode: profile.lightweightNodes,
      selected: true,
      focusFlash: false,
    })).toBe(true)
  })
})

describe('resolveLightweightNodePreview', () => {
  it('uses an image thumbnail before the full image URL', () => {
    expect(
      resolveLightweightNodePreview({
        result: { type: 'image', thumbnailUrl: 'thumb.webp', url: 'full.png' },
      }),
    ).toEqual({ kind: 'image', src: 'thumb.webp' })
  })

  it('uses a video thumbnail as a static lightweight preview', () => {
    expect(
      resolveLightweightNodePreview({
        result: { type: 'video', thumbnailUrl: 'poster.jpg', url: 'clip.mp4' },
      }),
    ).toEqual({ kind: 'image', src: 'poster.jpg' })
  })

  it('keeps videos playable when no poster was persisted', () => {
    expect(
      resolveLightweightNodePreview({
        result: { type: 'video', url: 'clip.mp4' },
      }),
    ).toEqual({ kind: 'video', src: 'clip.mp4' })
  })

  it('does not mount media for non-visual results or empty URLs', () => {
    expect(resolveLightweightNodePreview({ result: { type: 'text' } })).toBeNull()
    expect(resolveLightweightNodePreview({ result: { type: 'image', url: '  ' } })).toBeNull()
  })
})
