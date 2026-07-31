import { describe, expect, it } from 'vitest'
import { getGenerationNodeDefaultSize, getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  importBrowserMediaDragToGenerationCanvas,
  importBrowserAssetsToGenerationCanvas,
  layoutBrowserAssetDropPositions,
  parseBrowserMediaDrag,
  resolveAssetLibraryDropPosition,
} from './canvasStageDrop'

describe('layoutBrowserAssetDropPositions', () => {
  it('lays multiple browser assets into a non-overlapping grid', () => {
    const positions = layoutBrowserAssetDropPositions({ x: 120, y: 180 }, 5)
    const footprint = getGenerationNodeFootprintSize('asset')

    expect(positions).toHaveLength(5)
    expect(positions[0]).toEqual({ x: 120, y: 180 })
    expect(positions[1].x - positions[0].x).toBeGreaterThanOrEqual(footprint.width)
    expect(positions[3].y - positions[0].y).toBeGreaterThanOrEqual(footprint.height)

    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const separatedX =
          positions[i].x + footprint.width <= positions[j].x ||
          positions[j].x + footprint.width <= positions[i].x
        const separatedY =
          positions[i].y + footprint.height <= positions[j].y ||
          positions[j].y + footprint.height <= positions[i].y
        expect(separatedX || separatedY).toBe(true)
      }
    }
  })

  it('keeps the grabbed point under the mouse cursor', () => {
    const size = getGenerationNodeDefaultSize('asset')
    const cursor = { x: 640, y: 480 }
    const anchor = { xRatio: 0.25, yRatio: 0.75 }
    const position = resolveAssetLibraryDropPosition(cursor, anchor)

    expect(position.x + size.width * anchor.xRatio).toBe(cursor.x)
    expect(position.y + size.height * anchor.yRatio).toBe(cursor.y)
  })
})

describe('importBrowserAssetsToGenerationCanvas', () => {
  it('creates media and prompt nodes from browser asset box payloads', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })

    const result = importBrowserAssetsToGenerationCanvas(
      [
        { id: 'img-1', type: 'image', title: 'image.png', previewUrl: 'nomi-local://project/assets/image.png' },
        { id: 'vid-1', type: 'video', title: 'video.mp4', previewUrl: 'nomi-local://project/assets/video.mp4' },
        { id: 'txt-1', type: 'prompt', title: 'prompt.md', prompt: '雨夜街道\n霓虹反光' },
      ],
      { basePosition: { x: 100, y: 140 }, categoryId: 'shots' },
    )

    expect(result.createdCount).toBe(3)
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes).toHaveLength(3)
    expect(state.nodes.map((node) => node.kind)).toEqual(['asset', 'asset', 'text'])
    expect(state.nodes.map((node) => node.categoryId)).toEqual(['shots', 'shots', 'shots'])
    expect(state.nodes[0]?.result).toMatchObject({ type: 'image', url: 'nomi-local://project/assets/image.png' })
    expect(state.nodes[1]?.result).toMatchObject({ type: 'video', url: 'nomi-local://project/assets/video.mp4' })
    expect(state.nodes[2]?.prompt).toBe('雨夜街道\n霓虹反光')
    expect(state.nodes[2]?.contentJson?.content).toHaveLength(2)
    expect(state.selectedNodeIds).toEqual(result.nodeIds)
  })
})

describe('browser media drag', () => {
  it('keeps the source browser view and media kind in the drag payload', () => {
    expect(parseBrowserMediaDrag(JSON.stringify({
      viewId: 17,
      url: 'blob:https://chatgpt.com/generated-image',
      mediaType: 'image',
      title: 'ChatGPT result',
      pageUrl: 'https://chatgpt.com/images/',
    }))).toEqual({
      viewId: 17,
      url: 'blob:https://chatgpt.com/generated-image',
      mediaType: 'image',
      title: 'ChatGPT result',
      pageUrl: 'https://chatgpt.com/images/',
      fileName: undefined,
      pageTitle: undefined,
    })
  })

  it('imports a dragged web video through its authenticated browser session', async () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    const result = await importBrowserMediaDragToGenerationCanvas(
      {
        viewId: 8,
        url: 'https://jimeng.jianying.com/result/video',
        mediaType: 'video',
        title: '即梦生成视频',
      },
      { basePosition: { x: 180, y: 220 }, categoryId: 'shots' },
      {
        projectId: 'project-1',
        importMedia: async (payload) => ({
          id: 'asset-web-video',
          name: 'jimeng.mp4',
          userId: 'local',
          projectId: payload.projectId,
          createdAt: '',
          updatedAt: '',
          data: {
            url: 'nomi-local://asset/project-1/assets/imported/jimeng.mp4',
            contentType: 'video/mp4',
            mediaType: 'video',
          },
        }),
      },
    )

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(result.ok).toBe(true)
    expect(node).toMatchObject({
      position: { x: 180, y: 220 },
      categoryId: 'shots',
      status: 'success',
      result: {
        type: 'video',
        url: 'nomi-local://asset/project-1/assets/imported/jimeng.mp4',
        assetId: 'asset-web-video',
      },
      meta: {
        source: 'browser-view-drag',
        uploadStatus: 'uploaded',
      },
    })
  })
})
