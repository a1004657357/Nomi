import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n, { setAppLocale } from '../../../i18n'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import VibingDirectorEditor from './VibingDirectorEditor'
import { StoryboardVideoPreview } from './render/StoryboardVideoPreview'
import { createVibingDirectorState } from './vibingDirector/vibingDirectorState'

function source(file: string) {
  const full = path.join(process.cwd(), 'src/workbench/generationCanvas/nodes', file)
  return ts.createSourceFile(full, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function elements(file: ts.SourceFile, name: string) {
  const result: ts.JsxElement[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === name) result.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return result
}

function action(file: ts.SourceFile, key: string) {
  const result = elements(file, 'button').find(node => node.openingElement.attributes.properties.some(prop =>
    ts.isJsxAttribute(prop) && prop.name.getText(file) === 'aria-label' && prop.initializer?.getText(file).includes(key),
  ))
  expect(result).toBeDefined()
  return result!
}

function callback(file: ts.SourceFile, element: ts.JsxElement, attribute: string) {
  const value = element.openingElement.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === attribute)
  expect(value && ts.isJsxAttribute(value) && value.initializer && ts.isJsxExpression(value.initializer)).toBeTruthy()
  return (value as ts.JsxAttribute).initializer!.getText(file).slice(1, -1)
}

function compileCallback(text: string, values: Record<string, unknown>) {
  const code = ts.transpileModule(`const callback = ${text}`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText
  return new Function(...Object.keys(values), code + '\nreturn callback')(...Object.values(values)) as (event: { detail?: number; stopPropagation: () => void; preventDefault: () => void }) => void
}

afterEach(() => setAppLocale('zh-CN'))

describe.each(['zh-CN', 'en'] as const)('preview semantics in %s', locale => {
  it('keeps the complete Director presentation outside the opening control', () => {
    setAppLocale(locale)
    const file = source('VibingDirectorEditor.tsx')
    const control = action(file, 'canvasComponents.openVIBINGDirector')
    expect(control.getText(file)).not.toContain('IconBrandBlender')
    expect(control.getText(file)).not.toContain('state.brief')
    expect(control.getText(file)).toContain('IconMaximize')
    expect(callback(file, control, 'onClick')).toBe('openDirector')
    const state = { ...createVibingDirectorState(100), brief: 'USER_AUTHORED_BRIEF' }
    const node: GenerationCanvasNode = { id: 'preview-director', kind: 'vibingDirector', title: 'USER_TITLE', position: { x: 0, y: 0 }, meta: { vibingDirectorState: state } }
    const before = JSON.stringify(node)
    const markup = renderToStaticMarkup(React.createElement(MantineProvider, null,
      React.createElement(VibingDirectorEditor, { node, readOnly: true }),
    ))
    expect(markup).toContain('USER_AUTHORED_BRIEF')
    expect(markup).toContain(i18n.t('canvasComponents.openVIBINGDirector'))
    expect(markup).toContain('tabler-icon-brand-blender')
    expect(JSON.stringify(node)).toBe(before)
  })

  it('has one visible playback affordance with the existing preview dimensions', () => {
    setAppLocale(locale)
    const file = source('render/StoryboardVideoPreview.tsx')
    const control = action(file, 'canvasComponents.videoPreview513')
    expect(control.getText(file)).toContain('IconPlayerPlayFilled')
    expect(control.getText(file)).not.toContain('IconVideo')
    expect(control.openingElement.getText(file)).toContain('style={frameStyle}')
    const node: GenerationCanvasNode = { id: 'preview-video', kind: 'video', title: 'USER_VIDEO', position: { x: 0, y: 0 } }
    const markup = renderToStaticMarkup(React.createElement(MantineProvider, null,
      React.createElement(StoryboardVideoPreview, { node, videoUrl: 'nomi-local://asset/fixture/video.mp4', posterUrl: '', compact: true }),
    ))
    expect(markup).toContain('tabler-icon-player-play-filled')
    expect(markup).not.toContain('tabler-icon-video')
  })
})

it('retains keyboard, single-click delay, double-click and pointer cancellation routes', () => {
  const file = source('render/StoryboardVideoPreview.tsx')
  const control = action(file, 'canvasComponents.videoPreview513')
  let playing = false
  const timers: Array<{ run: () => void; ms: number }> = []
  const clearSingleClickTimer = vi.fn()
  const openLightbox = vi.fn()
  const values = { setPlaying: (update: (current: boolean) => boolean) => { playing = update(playing) },
    clearSingleClickTimer, singleClickTimerRef: { current: null }, openLightbox,
    window: { setTimeout: (run: () => void, ms: number) => { timers.push({ run, ms }); return timers.length } } }
  const click = compileCallback(callback(file, control, 'onClick'), values)
  const event = { detail: 0, stopPropagation: vi.fn(), preventDefault: vi.fn() }
  click(event)
  expect(playing).toBe(true)
  expect(timers).toHaveLength(0)
  click({ ...event, detail: 1 })
  expect(clearSingleClickTimer).toHaveBeenCalledTimes(1)
  expect(timers[0].ms).toBe(260)
  expect(playing).toBe(true)
  timers[0].run()
  expect(playing).toBe(false)
  click({ ...event, detail: 2 })
  expect(timers).toHaveLength(1)
  compileCallback(callback(file, control, 'onDoubleClick'), values)(event)
  expect(openLightbox).toHaveBeenCalledTimes(1)
  expect(event.preventDefault).toHaveBeenCalledTimes(1)
  compileCallback(callback(file, control, 'onPointerDown'), values)(event)
  expect(event.stopPropagation).toHaveBeenCalledTimes(5)
})
