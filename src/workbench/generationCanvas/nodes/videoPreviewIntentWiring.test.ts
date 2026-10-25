import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { GenerationNodePreviewBody } from './GenerationNodePreviewBody'
import { NodeVideoPlaybackGuard } from './NodeVideoPlaybackGuard'

function videoNode(): GenerationCanvasNode {
  return { id: 'gen-v2-video-020', kind: 'video', title: 'Original video', position: { x: 0, y: 0 },
    result: { id: 'result-020', type: 'video', url: 'nomi-local://asset/isolated-video.mp4', thumbnailUrl: 'nomi-local://asset/isolated-poster.jpg', createdAt: 1 },
    meta: { videoWidth: 1920, videoHeight: 1080, userFlag: false, userValue: 0 } }
}

function previewProps(selected: boolean, requested: boolean, readOnly: boolean) {
  return { node: videoNode(), selected, readOnly, videoPreviewRequested: requested,
    visualSize: { width: 320, height: 180 }, previewHeight: 180, mediaPreviewPriority: false,
    isRemoveBackgroundPending: false, needsFirstFrame: false, hasFrameSourceEdge: false, shotIndex: null,
    useLocalImagePreview: false, displayPrompt: 'Original prompt', onPanoramaFullscreen: vi.fn(),
    onPanoramaScreenshot: vi.fn(), onPanoramaFileChange: vi.fn(), updateMediaDimensions: vi.fn() }
}

describe('video hover intent stays distinct from selection through the actual preview body', () => {
  describe.each([false, true])('readOnly=%s', (readOnly) => {
    it.each([[false, false], [false, true], [true, false], [true, true]])('selected=%s hover=%s forwards distinct intents without changing the node', (selected, requested) => {
      const props = previewProps(selected, requested, readOnly)
      const before = JSON.stringify(props.node)
      Object.freeze(props.node)
      const element = GenerationNodePreviewBody(props)
      expect(React.isValidElement(element)).toBe(true)
      expect(element.type).toBe(NodeVideoPlaybackGuard)
      const guard = element.props as React.ComponentProps<typeof NodeVideoPlaybackGuard>
      expect(guard.previewRequested, `selected=${selected}, hover=${requested}`).toBe(requested)
      expect(guard.engaged).toBe(selected)
      expect(guard.node).toBe(props.node)
      expect(guard.muted).toBe(true)
      expect(guard.controls).toBe(true)
      expect(JSON.stringify(props.node)).toBe(before)
    })
  })

  it('preserves the real metadata measurement callback and original poster source', () => {
    const props = previewProps(false, true, false)
    const element = GenerationNodePreviewBody(props)
    const guard = element.props as React.ComponentProps<typeof NodeVideoPlaybackGuard>
    guard.onLoadedMetadata?.({ currentTarget: { videoWidth: 1920, videoHeight: 1080, duration: 12 } } as React.SyntheticEvent<HTMLVideoElement>)
    expect(props.updateMediaDimensions).toHaveBeenCalledWith(1920, 1080, 12)
    expect(guard.node.result?.thumbnailUrl).toBe('nomi-local://asset/isolated-poster.jpg')
  })

  it('leaves image previews and empty-node selection outside the video guard', () => {
    const props = previewProps(true, false, false)
    const image: GenerationCanvasNode = { ...props.node, kind: 'image', result: { id: 'image', type: 'image', url: 'nomi-local://asset/isolated-image.png', createdAt: 1 } }
    expect(GenerationNodePreviewBody({ ...props, node: image }).type).not.toBe(NodeVideoPlaybackGuard)
    const empty = GenerationNodePreviewBody({ ...props, node: { ...props.node, result: undefined } })
    expect(empty.type).not.toBe(NodeVideoPlaybackGuard)
    expect((empty.props as { selected: boolean }).selected).toBe(true)
  })
})

it('the real shell connects its hover hook and pointer handlers to the preview body, not selection', () => {
  const file = path.join(process.cwd(), 'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx')
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const calls: ts.VariableDeclaration[] = []
  const previews: ts.JsxSelfClosingElement[] = []
  const articles: ts.JsxOpeningElement[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'videoPreview') calls.push(node)
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'GenerationNodePreviewBody') previews.push(node)
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'article') articles.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  const expression = (attributes: ts.JsxAttributes, key: string) => {
    const prop = attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText(source) === key)
    return prop?.initializer && ts.isJsxExpression(prop.initializer) ? prop.initializer.expression?.getText(source) : undefined
  }
  expect(calls).toHaveLength(1)
  expect(calls[0].initializer?.getText(source)).toBe("useNodeVideoPreviewIntent(node.result?.type === 'video')")
  expect(articles).toHaveLength(1)
  expect(expression(articles[0].attributes, 'onPointerEnter')).toBe('videoPreview.onPointerEnter')
  expect(expression(articles[0].attributes, 'onPointerLeave')).toBe('videoPreview.onPointerLeave')
  expect(previews).toHaveLength(1)
  expect(expression(previews[0].attributes, 'videoPreviewRequested')).toBe('videoPreview.requested')
  expect(expression(previews[0].attributes, 'selected')).toBe('selected')
})
