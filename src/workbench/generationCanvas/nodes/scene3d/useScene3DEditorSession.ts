import React from 'react'
import { levelEditorCameraRotation } from './scene3dMath'
import type { Scene3DControlMode, Scene3DSelection, Scene3DState } from './scene3dTypes'

/** Keep viewport drafts separate from committed state until close/unmount flushes them. */
export function useScene3DEditorSession({
  initialState,
  state,
  selection,
  controlMode,
  onStateChange,
}: {
  initialState: Scene3DState
  state: Scene3DState
  selection: Scene3DSelection
  controlMode: Scene3DControlMode
  onStateChange: (state: Scene3DState) => void
}) {
  const stateRef = React.useRef(state)
  const selectionRef = React.useRef(selection)
  const controlModeRef = React.useRef(controlMode)
  const onStateChangeRef = React.useRef(onStateChange)
  const initialEditorCameraRef = React.useRef<Scene3DState['editorCamera']>({
    ...initialState.editorCamera,
    rotation: levelEditorCameraRotation(initialState.editorCamera.position, initialState.editorCamera.target),
  })
  const latestEditorCameraRef = React.useRef(initialEditorCameraRef.current)

  React.useEffect(() => { stateRef.current = state }, [state])
  React.useEffect(() => { selectionRef.current = selection }, [selection])
  React.useEffect(() => {
    controlModeRef.current = controlMode
    latestEditorCameraRef.current = { ...latestEditorCameraRef.current, mode: controlMode }
  }, [controlMode])
  React.useEffect(() => { onStateChangeRef.current = onStateChange }, [onStateChange])
  React.useEffect(() => { onStateChangeRef.current(state) }, [state])

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const { body } = document
    const previousOverflow = body.style.overflow
    const previousOverscroll = body.style.overscrollBehavior
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    return () => {
      body.style.overflow = previousOverflow
      body.style.overscrollBehavior = previousOverscroll
    }
  }, [])

  const handleEditorCameraDraft = React.useCallback((editorCamera: Scene3DState['editorCamera']) => {
    latestEditorCameraRef.current = editorCamera
  }, [])

  const flushLatestState = React.useCallback(() => {
    const latestState = {
      ...stateRef.current,
      editorCamera: { ...latestEditorCameraRef.current, mode: controlModeRef.current },
    }
    stateRef.current = latestState
    onStateChangeRef.current(latestState)
    return latestState
  }, [])

  return { stateRef, selectionRef, initialEditorCameraRef, latestEditorCameraRef, handleEditorCameraDraft, flushLatestState }
}
