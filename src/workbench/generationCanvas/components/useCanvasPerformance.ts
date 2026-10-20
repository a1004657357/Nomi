import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { resolveCanvasPerformanceProfile, type CanvasPerformancePreference } from './canvasNodeLevelOfDetail'

const STORAGE_KEY = 'nomi.canvasPerformance.preference'
function readPreference(): CanvasPerformancePreference {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY) === 'smooth' ? 'smooth' : 'auto' }
  catch { return 'auto' }
}
let preference = readPreference()
const listeners = new Set<() => void>()
const getPreference = () => preference
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setCanvasPerformancePreference(next: CanvasPerformancePreference): void {
  if (preference === next) return
  preference = next
  try { globalThis.localStorage?.setItem(STORAGE_KEY, next) }
  catch { /* Storage restrictions must not prevent a session-only preference. */ }
  for (const listener of listeners) listener()
}

export function useCanvasPerformancePreference(): CanvasPerformancePreference {
  return React.useSyncExternalStore(subscribe, getPreference, getPreference)
}

export function useCanvasPerformance(
  nodes: GenerationCanvasNode[],
  edgeCount: number,
  zoom: number,
  stageRef: React.RefObject<HTMLDivElement>,
) {
  const preference = useCanvasPerformancePreference()
  const profile = resolveCanvasPerformanceProfile({ preference, nodeCount: nodes.length, edgeCount, zoom,
    mediaNodeCount: nodes.filter((node) => node.result?.type === 'image' || node.result?.type === 'video').length,
    videoNodeCount: nodes.filter((node) => node.result?.type === 'video').length })
  const settleTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  React.useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.dataset.performancePreference = preference
    stage.toggleAttribute('data-dense-edges', profile.deferEdgesWhileMoving)
    stage.toggleAttribute('data-reduce-effects', profile.reduceEffects)
    stage.toggleAttribute('data-suspend-media-while-moving', profile.suspendMediaWhileMoving)
  }, [preference, profile.deferEdgesWhileMoving, profile.reduceEffects, profile.suspendMediaWhileMoving, stageRef])
  React.useEffect(() => () => { clearTimeout(settleTimer.current) }, [])
  const markViewportMoving = React.useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.toggleAttribute('data-viewport-moving', true)
    clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => stage.removeAttribute('data-viewport-moving'), 120)
  }, [stageRef])
  return { profile, markViewportMoving }
}
