import { PassThrough } from 'node:stream'
import React from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n, { setAppLocale } from '../../../../i18n'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { isCardRenderKind, resolveNodeRenderKind } from '../resolveRenderKind'
import { NodeCardBody } from './NodeCardBody'

// The closed modal is outside body selection; do not load a Leafer canvas in SSR.
vi.mock('../whiteboard/WhiteboardModal', () => ({ default: () => { throw new Error('Closed whiteboard modal must not mount') } }))

async function renderBody(node: GenerationCanvasNode): Promise<string> {
  const renderKind = resolveNodeRenderKind(node)
  const body = isCardRenderKind(renderKind) ? React.createElement(NodeCardBody, { node, renderKind, readOnly: false }) : null
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const output = new PassThrough()
    output.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    output.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    output.on('error', reject)
    const stream = renderToPipeableStream(React.createElement(MantineProvider, null, body), {
      onAllReady() { stream.pipe(output) },
      onError(error) { reject(error) },
    })
  })
}

function pollutedNode(kind: 'whiteboard' | 'audio'): GenerationCanvasNode {
  return { id: `functional-${kind}`, kind, title: 'Original user title', categoryId: 'shots', renderKind: 'shot-frame',
    position: { x: 12, y: 34 }, size: { width: 320, height: 240 }, meta: { userValue: 0, userFlag: false } }
}

afterEach(() => setAppLocale('zh-CN'))

describe.each(['zh-CN', 'en'] as const)('real functional card bodies in %s', (locale) => {
  it('renders the actual whiteboard open control for a migrated shot-frame node', async () => {
    setAppLocale(locale)
    const node = Object.freeze(pollutedNode('whiteboard'))
    const before = JSON.stringify(node)
    const markup = await renderBody(node)
    expect(markup).toContain('data-testid="whiteboard-empty-action"')
    expect(markup).toContain(i18n.t('generationCommon.whiteboard.openAria'))
    expect(JSON.stringify(node)).toBe(before)
  })

  it('renders the actual audio upload input for an empty migrated node', async () => {
    setAppLocale(locale)
    const node = Object.freeze(pollutedNode('audio'))
    const before = JSON.stringify(node)
    const markup = await renderBody(node)
    expect(markup).toContain('type="file"')
    expect(markup).toContain(i18n.t('generationCommon.audio.upload'))
    expect(JSON.stringify(node)).toBe(before)
  })

  it('keeps actual audio playback controls and the stored result', async () => {
    setAppLocale(locale)
    const node = Object.freeze({ ...pollutedNode('audio'), result: { id: 'stored-audio', type: 'audio' as const,
      url: 'nomi-local://asset/isolated-existing-audio.wav', createdAt: 1 }, meta: { userValue: 0, userFlag: false, durationSec: 12 } })
    const before = JSON.stringify(node)
    const markup = await renderBody(node)
    expect(markup).toContain('<audio')
    expect(markup).toContain('role="slider"')
    expect(markup).toContain(i18n.t('generationCommon.audio.play'))
    expect(markup).toContain(node.result.url)
    expect(JSON.stringify(node)).toBe(before)
  })

  it('keeps the actual transcript, copy and subtitle controls', async () => {
    setAppLocale(locale)
    const node = Object.freeze({ ...pollutedNode('audio'), result: { id: 'stored-transcript', type: 'text' as const,
      text: 'Original user transcript', createdAt: 1 } })
    const before = JSON.stringify(node)
    const markup = await renderBody(node)
    expect(markup).toContain(node.result.text)
    expect(markup).toContain(i18n.t('generationCommon.audio.copyTranscript'))
    expect(markup).toContain(i18n.t('generationCommon.audio.generateSubtitleHint'))
    expect(JSON.stringify(node)).toBe(before)
  })
})
