import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../../../workbenchStore'
import type { StoryboardPlan } from '../../agent/storyboardPlan'
import { __resetCanvasUndoJournalForTests } from '../../events/canvasUndoJournal'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import StoryboardTableNode, { StoryboardMediaPreview } from './StoryboardTableNode'

const plan: StoryboardPlan = {
  title: '22 镜性能样例',
  anchors: [],
  shots: Array.from({ length: 22 }, (_, offset) => {
    const index = offset + 1
    return {
      index,
      shotKind: 'video' as const,
      durationSec: 5,
      anchorIds: [],
      prompt: `镜头 ${index} 视频提示词`,
      imagePrompt: `镜头 ${index} 图片提示词`,
      videoPrompt: `镜头 ${index} 视频提示词`,
      scene: '室内咖啡馆',
      shotSize: '中景',
      cameraAngle: '平视',
      cameraMove: '缓慢推进',
      characters: '主角',
      performance: '端起咖啡',
      dialogue: '开始吧',
      props: '咖啡杯',
      sound: '环境声',
      notes: '连续性优先',
    }
  }),
}

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  useWorkbenchStore.getState().hydrateStoryboardDesigns({})
  __resetCanvasUndoJournalForTests()
})

function renderStoryboardTable(): string {
  const table = useGenerationCanvasStore.getState().addNode({
    kind: 'text',
    title: '分镜脚本',
    categoryId: 'shots',
    meta: { storyboardGroup: true, storyboardPlanSnapshot: plan },
  })
  for (let index = 1; index <= 3; index += 1) {
    const video = useGenerationCanvasStore.getState().addNode({
      kind: 'video',
      title: `镜头 ${index} 视频`,
      categoryId: 'shots',
    })
    useGenerationCanvasStore.getState().updateNode(video.id, {
      shotIndex: index,
      result: {
        id: `result-${index}`,
        type: 'video',
        url: `nomi-local://video-${index}.mp4`,
        createdAt: 1,
      },
    })
  }
  const current = useGenerationCanvasStore.getState().nodes.find((node) => node.id === table.id)!
  return renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(StoryboardTableNode, { node: current }),
    ),
  )
}

describe('StoryboardTableNode compact rendering budget', () => {
  it('does not mount every row editor by default', () => {
    const markup = renderStoryboardTable()
    expect((markup.match(/<textarea/g) || []).length).toBe(0)
  })

  it('does not mount video players in the compact overview', () => {
    const markup = renderStoryboardTable()
    expect((markup.match(/<video/g) || []).length).toBe(0)
  })

  it('renders a playable video preview affordance when the provider omitted a poster', () => {
    const video = useGenerationCanvasStore.getState().addNode({
      kind: 'video',
      title: '镜头 1 视频',
      categoryId: 'shots',
    })
    useGenerationCanvasStore.getState().updateNode(video.id, {
      shotIndex: 1,
      result: {
        id: 'video-result-1',
        type: 'video',
        url: 'nomi-local://video-1.mp4',
        createdAt: 1,
      },
    })
    const current = useGenerationCanvasStore.getState().nodes.find((node) => node.id === video.id)!
    const markup = renderToStaticMarkup(
      React.createElement(StoryboardMediaPreview, {
        node: current,
        type: 'video',
        emptyLabel: '待生成视频',
        compact: true,
      }),
    )
    expect(markup).toContain('aria-label="播放镜头 1视频预览"')
    expect((markup.match(/<video/g) || []).length).toBe(0)
    expect(markup).not.toContain('已生成')
  })

  it('preserves a portrait video ratio and exposes double-click enlargement', () => {
    const video = useGenerationCanvasStore.getState().addNode({
      kind: 'video',
      title: '镜头 1 视频',
      categoryId: 'shots',
      meta: { aspect_ratio: '9:16' },
    })
    useGenerationCanvasStore.getState().updateNode(video.id, {
      shotIndex: 1,
      result: {
        id: 'video-result-portrait',
        type: 'video',
        url: 'nomi-local://video-portrait.mp4',
        thumbnailUrl: 'nomi-local://video-portrait-poster.png',
        createdAt: 1,
      },
    })
    const current = useGenerationCanvasStore.getState().nodes.find((node) => node.id === video.id)!
    const markup = renderToStaticMarkup(
      React.createElement(StoryboardMediaPreview, {
        node: current,
        type: 'video',
        emptyLabel: '待生成视频',
        compact: true,
      }),
    )
    expect(markup).toContain('data-storyboard-media-preview="video"')
    expect(markup).toContain('data-media-aspect-ratio="0.5625"')
    expect(markup).toContain('style="width:40.5px;height:72px"')
    expect(markup).toContain('title="双击放大视频预览"')
    expect(markup).not.toContain('object-cover')
  })

  it('routes row generation through extracted configurable nodes', () => {
    const markup = renderStoryboardTable()
    expect(markup).toContain('aria-label="配置镜头 1 图片生成"')
    expect(markup).toContain('aria-label="配置镜头 1 视频生成"')
    expect(markup).toContain('aria-label="打开镜头 1 创作能力"')
    expect(markup).not.toContain('aria-label="显示镜头 1 图片节点"')
    expect(markup).not.toContain('aria-label="显示镜头 1 视频节点"')
  })

  it('defers compact image previews instead of mounting full images immediately', () => {
    const image = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      title: '镜头 1 图片',
      categoryId: 'shots',
    })
    useGenerationCanvasStore.getState().updateNode(image.id, {
      result: {
        id: 'image-result-1',
        type: 'image',
        url: 'nomi-local://image-1.png',
        createdAt: 1,
      },
    })
    const current = useGenerationCanvasStore.getState().nodes.find((node) => node.id === image.id)!
    const markup = renderToStaticMarkup(
      React.createElement(StoryboardMediaPreview, {
        node: current,
        type: 'image',
        emptyLabel: '待生成图',
        compact: true,
      }),
    )
    expect((markup.match(/<img/g) || []).length).toBe(0)
    expect(markup).toContain('generation-canvas-v2-node__media-loading')
    expect(markup).toContain('!absolute')
    expect(markup).toContain('before:hidden')
    expect(markup).toContain('after:hidden')
  })

  it('preserves a portrait image ratio and exposes double-click enlargement', () => {
    const image = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      title: '镜头 1 图片',
      categoryId: 'shots',
      meta: { aspect_ratio: '9:16' },
    })
    useGenerationCanvasStore.getState().updateNode(image.id, {
      shotIndex: 1,
      result: {
        id: 'image-result-portrait',
        type: 'image',
        url: 'nomi-local://image-portrait.png',
        createdAt: 1,
      },
    })
    const current = useGenerationCanvasStore.getState().nodes.find((node) => node.id === image.id)!
    const markup = renderToStaticMarkup(
      React.createElement(StoryboardMediaPreview, {
        node: current,
        type: 'image',
        emptyLabel: '待生成图',
        compact: true,
      }),
    )
    expect(markup).toContain('data-storyboard-media-preview="image"')
    expect(markup).toContain('data-media-aspect-ratio="0.5625"')
    expect(markup).toContain('style="width:40.5px;height:72px"')
    expect(markup).toContain('title="双击放大图片预览"')
    expect(markup).not.toContain('object-cover')
  })
})
