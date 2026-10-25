import { afterEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../workbenchStore'
import { workbenchStoreLifetime } from '../workbenchStoreLifetime'
import { batchPlanPreviewStoreLifetime, useBatchPlanPreviewStore } from '../generationCanvas/components/batchPlanPreview'
import {
  isScene3DObjectRuntimeHeld,
  holdScene3DObjectRuntime,
  registerScene3DObjectRef,
  unregisterScene3DObjectRef,
  releaseScene3DObjectRuntime,
  scene3DTrajectoryRuntimeStoreLifetime,
  useScene3DTrajectoryRuntimeStore,
} from '../generationCanvas/nodes/scene3d/trajectory/trajectoryRuntimeStore'

const workbench = useWorkbenchStore.getState()
const batch = useBatchPlanPreviewStore.getState()
const trajectory = useScene3DTrajectoryRuntimeStore.getState()

afterEach(() => {
  useWorkbenchStore.setState(workbench)
  useBatchPlanPreviewStore.setState(batch)
  useScene3DTrajectoryRuntimeStore.setState(trajectory)
  releaseScene3DObjectRuntime('lifetime-object')
})

describe('custom project state lifetime', () => {
  it('releases the old film bible without clearing window preferences', () => {
    const filmBible = { version: 1 as const, projectId: 'lifetime-fixture', theme: 'fixture theme' }
    useWorkbenchStore.setState({ filmBible, sidebarCollapsed: true })
    workbenchStoreLifetime.releaseProject?.()
    expect(useWorkbenchStore.getState().filmBible).toBeNull()
    expect(useWorkbenchStore.getState().sidebarCollapsed).toBe(true)
  })

  it('releases the regeneration target along with its project-owned pending plan', () => {
    useBatchPlanPreviewStore.setState({ regenerationSourceNodeId: 'old-project-node', running: true })
    batchPlanPreviewStoreLifetime.releaseProject?.()
    expect(useBatchPlanPreviewStore.getState()).toMatchObject({ regenerationSourceNodeId: null, plan: null, running: false })
  })

  it('releases project playback state but leaves live object refs to their mounting owner', () => {
    const ref = { current: null }
    registerScene3DObjectRef('lifetime-object', ref)
    holdScene3DObjectRuntime('lifetime-object')
    useScene3DTrajectoryRuntimeStore.setState({ playheadSeconds: 8, sceneTimeline: { totalDuration: 42 } })
    scene3DTrajectoryRuntimeStoreLifetime.releaseProject?.()
    const state = useScene3DTrajectoryRuntimeStore.getState()
    expect(state.playheadSeconds).toBe(0)
    expect(state.sceneTimeline).toEqual({ totalDuration: 10 })
    expect(state.trajectories).toEqual([])
    expect(isScene3DObjectRuntimeHeld('lifetime-object')).toBe(false)
    expect(state.objectRefMap.get('lifetime-object')?.[0]?.ref).toBe(ref)
    unregisterScene3DObjectRef('lifetime-object', ref)
    expect(state.objectRefMap.has('lifetime-object')).toBe(false)
  })
})
