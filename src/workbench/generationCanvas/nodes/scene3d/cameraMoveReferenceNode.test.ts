import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// availableModels 链路走 window.nomiDesktop IPC，node 测试环境不存在——mock 掉
// （本测试不带 modelKey，真实代码路径也不会调它，与 applyCanvasToolCall.test.ts 同例）。
vi.mock('../../agent/availableModels', () => ({ listAvailableModelsForAgent: vi.fn(async () => []) }))

import { applyCanvasToolCall, resetClientIdRegistry } from '../../agent/applyCanvasToolCall'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { buildCameraMoveScene, type CameraMoveSpec } from '../director/agent/cameraMoveBuilder'
import {
  createCameraMoveReferenceNode,
  cameraMoveFrameCount,
  CAMERA_MOVE_CAPTURE_FPS,
  readCameraMoveAutoCapture,
} from '../director/agent/createCameraMoveReferenceNode'
import { createCameraMoveReferenceNode as createLegacyCameraMoveReferenceNode } from './cameraMoveReferenceNode'
import { migrateScene3DState } from '../director/migration/migrateScene3d'
import { migrateScene3DNode } from '../director/migration/migrateScene3dNode'
import { CAMERA_SPEED_DURATION } from './cameraMoveVocab'

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
}

// B1 单一真相源不变量（P1/P4）：手动运镜控件走的 createCameraMoveReferenceNode，和 AI 工具
// create_camera_move 精确分支，对等价输入必须产出同一个 director + cameraMoveAutoCapture 契约。
// 若某天有人在其中一条路上偷改 fps/frameCount/meta 形状（像 handleRecordTake 漏 move 那样漂移），
// 这条测试立刻红。
describe('createCameraMoveReferenceNode — 与 AI create_camera_move 同源', () => {
  let idSequence = 0
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    vi.spyOn(Math, 'random').mockImplementation(() => ++idSequence / 100_000)
    idSequence = 0
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('等价输入下：canonical Director 手动路与 AI 工具的完整工程逐字段一致', async () => {
    const spec: CameraMoveSpec = { move: 'push_in', speed: 'fast', shot: 'close' }

    // —— AI 路：先建目标视频节点，再 create_camera_move 指向它。
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v1', kind: 'video', title: '镜头 1', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const aiTargetId = created.clientIdToNodeId.v1
    idSequence = 0
    const aiRes = (await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v1',
      move: spec.move,
      speed: spec.speed,
      shot: spec.shot,
    })) as { cameraMoveNodeId: string }
    const aiNode = useGenerationCanvasStore.getState().nodes.find((n) => n.id === aiRes.cameraMoveNodeId)!
    const aiFlag = aiNode.meta?.cameraMoveAutoCapture as Record<string, unknown>

    // —— 手动路：清场后自建一个视频节点当目标，直接调共享核心。
    resetCanvas()
    const manualTarget = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: '镜头 M', prompt: 'p' })
    idSequence = 0
    const manualRes = createCameraMoveReferenceNode({ spec, targetNodeId: manualTarget.id })
    const manualNode = useGenerationCanvasStore.getState().nodes.find((n) => n.id === manualRes.cameraMoveNodeId)!
    const manualFlag = manualNode.meta?.cameraMoveAutoCapture as Record<string, unknown>

    expect(aiNode.kind).toBe('director')
    expect(manualNode.kind).toBe('director')
    expect(aiNode.meta).not.toHaveProperty('scene3dState')
    expect(manualNode.meta).not.toHaveProperty('scene3dState')

    // fps / frameCount / move 不变量逐字段一致（targetNodeId 各指各的目标，单独比是否都带上）。
    expect(manualFlag.fps).toBe(aiFlag.fps)
    expect(manualFlag.frameCount).toBe(aiFlag.frameCount)
    expect(manualFlag.move).toBe(aiFlag.move)
    expect(manualFlag.fps).toBe(CAMERA_MOVE_CAPTURE_FPS)
    expect(manualFlag.frameCount).toBe(CAMERA_SPEED_DURATION.fast * CAMERA_MOVE_CAPTURE_FPS)
    expect(manualFlag.move).toBe('push_in')
    expect(manualFlag.targetNodeId).toBe(manualTarget.id)
    expect(aiFlag.targetNodeId).toBe(aiTargetId)

    // Deterministic unique ID sequence lets this compare geometry and all references,
    // rather than deleting arbitrary fields from the assertion.
    idSequence = 0
    const pure = migrateScene3DState(buildCameraMoveScene(spec), { sceneName: manualNode.title }).project
    expect(manualNode.meta?.directorProject).toEqual(pure)
    expect(aiNode.meta?.directorProject).toEqual(pure)
  })

  it.each(['push_in', 'orbit_left'] as const)('legacy constructor and persisted input remain readable: %s', move => {
    const result = createLegacyCameraMoveReferenceNode({ spec: { move, speed: 'fast' }, targetNodeId: 'old-target' })
    const legacyNode = useGenerationCanvasStore.getState().nodes.find(node => node.id === result.cameraMoveNodeId)!
    expect(legacyNode.kind).toBe('scene3d')
    const before = JSON.stringify(legacyNode)
    const migrated = migrateScene3DNode(JSON.parse(before), legacyNode.title)
    expect(migrated.kind).toBe('director')
    expect(readCameraMoveAutoCapture(migrated)).toEqual({
      targetNodeId: 'old-target', fps: CAMERA_MOVE_CAPTURE_FPS,
      frameCount: CAMERA_SPEED_DURATION.fast * CAMERA_MOVE_CAPTURE_FPS, move,
    })
    expect(migrated.meta).not.toHaveProperty('scene3dState')
    expect(migrated.meta.directorProject).toBeDefined()
    expect(migrateScene3DNode(migrated, legacyNode.title).meta).toEqual(migrated.meta)
    expect(JSON.stringify(legacyNode)).toBe(before)
  })

  it('无 targetNodeId：标志不含 targetNodeId 键（不设 undefined，与 Host 契约一致）', () => {
    const spec: CameraMoveSpec = { move: 'orbit_left', speed: 'slow' }
    const res = createCameraMoveReferenceNode({ spec })
    const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === res.cameraMoveNodeId)!
    const flag = node.meta?.cameraMoveAutoCapture as Record<string, unknown>
    expect('targetNodeId' in flag).toBe(false)
    expect(flag.frameCount).toBe(CAMERA_SPEED_DURATION.slow * CAMERA_MOVE_CAPTURE_FPS)
  })

  it('cameraMoveFrameCount：缺速度按 medium 派生（与 builder 时长表同源）', () => {
    expect(cameraMoveFrameCount({ move: 'push_in' })).toBe(CAMERA_SPEED_DURATION.medium * CAMERA_MOVE_CAPTURE_FPS)
    expect(cameraMoveFrameCount({ move: 'push_in', speed: 'fast' })).toBe(CAMERA_SPEED_DURATION.fast * CAMERA_MOVE_CAPTURE_FPS)
  })
})
