import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import i18n, { DEFAULT_LOCALE } from '../../../../i18n'

vi.mock('./Scene3DTrajectoryCapture', () => ({ Scene3DTrajectoryCapture: () => null }))
vi.mock('./useScene3DFullscreenActions', () => ({ toastPickCameraFirst: vi.fn() }))

import { buildCameraMoveScene } from './cameraMoveBuilder'
import { useScene3DMoveFrameExport } from './useScene3DCaptureExport'
import type { CameraMoveCaptureResult } from './Scene3DTrajectoryCapture'
import type { Scene3DCaptureResult } from './scene3dTypes'
import { referenceSlotForScene3DCapture } from './scene3dReferenceDirector'

afterEach(async () => { await i18n.changeLanguage(DEFAULT_LOCALE) })

it.each(['zh-CN', 'en-US'])('actual frame-export callback carries roles without translating saved titles: %s', async locale => {
  await i18n.changeLanguage(locale)
  const state = buildCameraMoveScene({ move: 'push_in', speed: 'fast' })
  const original = JSON.stringify(state)
  const camera = state.cameras[0]
  const onScreenshot = vi.fn<(capture: Scene3DCaptureResult) => void>()
  const onKeyframesExported = vi.fn()
  let requested = false
  let captureElement: React.ReactElement | null = null
  function Probe() {
    const result = useScene3DMoveFrameExport({ stateRef: { current: state }, onScreenshot, onKeyframesExported })
    if (!requested) {
      requested = true
      void result.exportCameraMoveFrames(camera.id)
    }
    captureElement = result.moveFrameCapture
    return null
  }
  renderToStaticMarkup(React.createElement(Probe))
  expect(captureElement).not.toBeNull()
  const props = (captureElement! as React.ReactElement<{ onResult: (result: CameraMoveCaptureResult) => void }>).props
  props.onResult({ frames: ['fixture-first', 'fixture-last'], width: 1280, height: 720, fps: 24, title: 'unused' })
  const captures = onScreenshot.mock.calls.map(([capture]) => capture)
  expect(captures).toEqual([
    { dataUrl: 'fixture-first', width: 1280, height: 720, title: `${camera.name} · 运镜首帧`, source: 'scene3d-camera', referenceSlot: 'first_frame' },
    { dataUrl: 'fixture-last', width: 1280, height: 720, title: `${camera.name} · 运镜尾帧`, source: 'scene3d-camera', referenceSlot: 'last_frame' },
  ])
  expect(captures.map(capture => referenceSlotForScene3DCapture({ ...capture, title: 'User edited English title' }))).toEqual(['first_frame', 'last_frame'])
  expect(onKeyframesExported).toHaveBeenCalledWith(2)
  expect(JSON.stringify(state)).toBe(original)
})
