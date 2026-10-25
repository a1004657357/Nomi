import crypto from 'node:crypto'
import { BLENDER_DIRECTOR_STAGE_PRESETS, type BlenderDirectorStagePreset } from '../shared/blenderDirectorContract'
import { addNodes, connectNodes, type CanvasSnapshot } from './canvasGraph'
import type { ProjectGateway } from './gateway'

export type DirectorStagePreset = BlenderDirectorStagePreset

export type DirectorRenderInput = {
  projectId: string
  sourceNodeId: string
  stagePreset?: DirectorStagePreset
}

export type DirectorRenderResult = {
  jobId: string
  blenderVersion?: string
  preview: { url: string; assetId?: string }
  blend: { url: string; assetId?: string }
  model: { url: string; assetId?: string }
}

/** 主进程注入的受约束 Blender 调用。能力核永远不接收脚本、二进制路径或任意命令。 */
export type RunDirectorFn = (input: {
  jobId: string
  projectId: string
  ownerNodeId: string
  title: string
  stagePreset?: DirectorStagePreset
  scene: unknown
}) => Promise<DirectorRenderResult>

const DIRECTOR_STAGE_PRESETS = new Set<DirectorStagePreset>(BLENDER_DIRECTOR_STAGE_PRESETS)

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function defaultDirectorSceneState(): Record<string, unknown> {
  return {
    objects: [{
      id: 'director-subject', name: '主体', type: 'mannequin', visible: true,
      position: [0, 1.25, 0], rotation: [0, 0, 0], scale: [2.5, 2.5, 2.5], color: '#ef4444', geometry: 'box',
    }],
    cameras: [{
      id: 'director-camera', name: '导演相机', visible: true,
      position: [4, 2.4, 5], rotation: [-0.36, 0.68, 0], target: [0, 0.8, 0],
      fov: 45, aspectRatio: '16:9', lensDepth: 0, near: 0.1, far: 200,
    }],
    trajectories: [], trajectoryBindings: [], trajectoryGroups: [],
    sceneTimeline: { totalDuration: 5 },
    environment: {
      preset: 'city', showGrid: true, showAxes: true, showSky: false, darkMode: false,
      backgroundColor: '#f6f3ee', panoramaRotation: 0, environmentMode: 'panorama', sphereRadius: 50,
    },
    editorCamera: { position: [-5, 3.2, 6], target: [0, 0.75, 0], rotation: [0, 0, 0], mode: 'edit' },
  }
}

function directorSceneFromNode(node: CanvasSnapshot['nodes'][number]): Record<string, unknown> {
  const meta = node.meta || {}
  if (!Object.prototype.hasOwnProperty.call(meta, 'scene3dState')) return defaultDirectorSceneState()
  const scene = plainRecord(meta.scene3dState)
  if (!scene) throw new Error('3D 导演台的场景状态无效')
  return scene
}

function applyDirectorResult(
  snapshot: CanvasSnapshot,
  sourceNodeId: string,
  scene: Record<string, unknown>,
  result: DirectorRenderResult,
): { snapshot: CanvasSnapshot; previewNodeId: string; modelNodeId: string } {
  const source = snapshot.nodes.find((node) => node.id === sourceNodeId)
  if (!source) throw new Error('Blender 导演预演完成时源 3D 节点已不存在')
  const priorOutputCount = snapshot.nodes.filter((node) => (
    node.meta?.sourceNodeId === sourceNodeId && node.meta?.source === 'blender-director'
  )).length
  const runIndex = Math.ceil(priorOutputCount / 2)
  const sourceWidth = Math.max(320, source.size?.width || 480)
  const x = Math.round((source.position?.x || 0) + sourceWidth + 80 + runIndex * 400)
  const y = Math.round(source.position?.y || 0)
  const created = addNodes(snapshot, [
    { kind: 'image', title: 'Blender 导演预演', prompt: 'Blender 导演 manifest 预演', x, y },
    { kind: 'model3d', title: 'Blender 导演场景', prompt: 'Blender 导演 manifest GLB 场景', x, y: y + 320 },
  ])
  const [previewNodeId, modelNodeId] = created.ids
  const createdAt = Date.now()
  const commonMeta = {
    source: 'blender-director',
    sourceNodeId,
    blenderJobId: result.jobId,
    blenderVersion: result.blenderVersion,
    blenderBlendUrl: result.blend.url,
    blenderBlendAssetId: result.blend.assetId,
  }
  const next: CanvasSnapshot = {
    ...created.snapshot,
    nodes: created.snapshot.nodes.map((node) => {
      if (node.id === previewNodeId) {
        const preview = {
          id: `blender-preview-${result.jobId}`,
          type: 'image',
          url: result.preview.url,
          assetId: result.preview.assetId,
          createdAt,
        }
        return {
          ...node,
          size: { width: 360, height: 240 },
          status: 'success',
          result: preview,
          history: [preview],
          meta: { ...commonMeta, blenderAssetKind: 'preview' },
        }
      }
      if (node.id === modelNodeId) {
        const model = {
          id: `blender-model-${result.jobId}`,
          type: 'model3d',
          url: result.model.url,
          assetId: result.model.assetId,
          createdAt,
        }
        return {
          ...node,
          size: { width: 360, height: 300 },
          status: 'success',
          result: model,
          history: [model],
          meta: { ...commonMeta, blenderAssetKind: 'model', blenderModelAssetId: result.model.assetId },
        }
      }
      if (node.id === sourceNodeId) {
        return {
          ...node,
          meta: {
            ...(node.meta || {}),
            scene3dState: { ...scene, lastThumbnail: result.preview.url },
            blenderRender: {
              source: 'blender-director',
              jobId: result.jobId,
              blenderVersion: result.blenderVersion,
              previewUrl: result.preview.url,
              blendUrl: result.blend.url,
              modelUrl: result.model.url,
            },
          },
        }
      }
      return node
    }),
  }
  return { snapshot: connectNodes(next, [
    { source: sourceNodeId, target: previewNodeId, mode: 'reference' },
    { source: sourceNodeId, target: modelNodeId, mode: 'reference' },
  ]).snapshot, previewNodeId, modelNodeId }
}

/**
 * 外部 Codex/CLI 的导演命令：只引用一个已有 scene3d 节点。场景状态由 Nomi 读取，
 * Blender 产物由主进程写入项目 assets，再把两个可视输出节点和边一起落回同一份图。
 */
export async function renderDirectorOnProject(
  input: DirectorRenderInput,
  gateway: ProjectGateway,
  runDirector: RunDirectorFn,
): Promise<{ jobId: string; sourceNodeId: string; previewNodeId: string; modelNodeId: string; blenderVersion?: string }> {
  const projectId = String(input.projectId || '').trim()
  const sourceNodeId = String(input.sourceNodeId || '').trim()
  if (!projectId) throw new Error('projectId is required')
  if (!sourceNodeId) throw new Error('sourceNodeId is required')
  if (input.stagePreset && !DIRECTOR_STAGE_PRESETS.has(input.stagePreset)) throw new Error('stagePreset 不受支持')
  const initial = await gateway.readDoc()
  const source = initial.nodes.find((node) => node.id === sourceNodeId)
  if (!source || source.kind !== 'scene3d') throw new Error('sourceNodeId 必须指向一个 3D 导演台节点')
  const scene = directorSceneFromNode(source)
  const result = await runDirector({
    jobId: `director-${crypto.randomUUID()}`,
    projectId,
    ownerNodeId: sourceNodeId,
    title: source.title || '3D导演台',
    ...(input.stagePreset ? { stagePreset: input.stagePreset } : {}),
    scene,
  })
  // Blender 运行期间用户可能在画布上继续编辑；重读最新快照，避免用旧快照覆盖其改动。
  const latest = await gateway.readDoc()
  const latestSource = latest.nodes.find((node) => node.id === sourceNodeId)
  if (!latestSource || latestSource.kind !== 'scene3d') throw new Error('Blender 导演预演完成时源 3D 节点已不存在')
  const latestScene = directorSceneFromNode(latestSource)
  const applied = applyDirectorResult(latest, sourceNodeId, latestScene, result)
  await gateway.apply(applied.snapshot)
  return {
    jobId: result.jobId,
    sourceNodeId,
    previewNodeId: applied.previewNodeId,
    modelNodeId: applied.modelNodeId,
    ...(result.blenderVersion ? { blenderVersion: result.blenderVersion } : {}),
  }
}
