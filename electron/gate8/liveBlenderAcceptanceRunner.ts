import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createDiskGateway } from '../capabilityCore/gateway'
import { renderDirectorOnProject } from '../capabilityCore/core'
import { runDirectorBlenderRender } from '../blender/directorCli'

type Gate8State = {
  nodes: { directorNodeId: string; shots: Array<{ imageNodeId: string }> }
  blender?: Record<string, unknown>
  updatedAt?: string
}

function projectDirForId(projectId: string): string {
  const root = String(process.env.NOMI_PROJECTS_DIR || '').trim()
  if (!root) throw new Error('NOMI_PROJECTS_DIR is required')
  const found = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .find((candidate) => {
      const file = path.join(candidate, '.nomi', 'project.json')
      try {
        return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).id === projectId
      } catch {
        return false
      }
    })
  if (!found) throw new Error(`project not found: ${projectId}`)
  return found
}

function gate8Scene(): Record<string, unknown> {
  return {
    objects: [
      { id: 'roof-floor', name: '天台地面', type: 'mesh', visible: true, position: [0, -0.15, 0], rotation: [0, 0, 0], scale: [9, 0.15, 7], color: '#73777d', geometry: 'box' },
      { id: 'rail-back', name: '后侧护栏', type: 'mesh', visible: true, position: [0, 0.65, -4.6], rotation: [0, 0, 0], scale: [9, 0.08, 0.08], color: '#444b53', geometry: 'box' },
      { id: 'rail-left', name: '左侧护栏', type: 'mesh', visible: true, position: [-6.2, 0.65, 0], rotation: [0, 0, 0], scale: [0.08, 0.08, 7], color: '#444b53', geometry: 'box' },
      { id: 'utility-room', name: '机房', type: 'mesh', visible: true, position: [3.8, 1.4, 1.7], rotation: [0, 0, 0], scale: [2, 1.4, 1.8], color: '#555b62', geometry: 'box' },
      { id: 'utility-door', name: '机房门', type: 'mesh', visible: true, position: [1.75, 1.15, 1.7], rotation: [0, 0, 0], scale: [0.08, 1.15, 0.65], color: '#20252a', geometry: 'box' },
      { id: 'lin-xia', name: '林夏', type: 'mannequin', visible: true, position: [-0.6, 1.25, -0.2], rotation: [0, 0.35, 0], scale: [1, 1, 1], color: '#7f1d3d', geometry: 'box' },
      { id: 'antagonist', name: '来者', type: 'mannequin', visible: true, position: [1.6, 1.25, 1.7], rotation: [0, -0.8, 0], scale: [1.08, 1.08, 1.08], color: '#16191d', geometry: 'box' },
      { id: 'sun-key', name: '夕阳主光', type: 'light', visible: true, position: [-4, 7, -3], rotation: [0.7, 0.2, -0.5], scale: [1, 1, 1], color: '#ffffff', geometry: 'sphere', lightType: 'directional', lightColor: '#ffb36a', lightIntensity: 4.5 },
    ],
    cameras: [
      { id: 'director-camera', name: '镜头06低机位', visible: true, position: [4.8, 2, 7.3], rotation: [-0.2, 0.55, 0], target: [0.2, 1, 0.5], fov: 42, aspectRatio: '9:16', lensDepth: 0, near: 0.1, far: 200 },
    ],
    trajectories: [], trajectoryBindings: [], trajectoryGroups: [],
    sceneTimeline: { totalDuration: 5 },
    environment: { preset: 'city', showGrid: false, showAxes: false, showSky: false, darkMode: false, backgroundColor: '#e8a56f', panoramaRotation: 0, environmentMode: 'panorama', sphereRadius: 50 },
    editorCamera: { position: [5.5, 3.5, 8], target: [0, 1, 0], rotation: [0, 0, 0], mode: 'edit' },
  }
}

async function run(): Promise<void> {
  const projectId = String(process.argv[2] || '').trim()
  if (!projectId) throw new Error('projectId is required')
  const projectDir = projectDirForId(projectId)
  const statePath = path.join(projectDir, '.nomi', 'gate8-live-state.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Gate8State
  const scene = gate8Scene()
  const gateway = createDiskGateway(projectId)
  const initial = await gateway.readDoc()
  await gateway.apply({
    ...initial,
    nodes: initial.nodes.map((node) => node.id === state.nodes.directorNodeId
      ? { ...node, meta: { ...(node.meta || {}), scene3dState: scene } }
      : node),
  })

  const result = await renderDirectorOnProject(
    { projectId, sourceNodeId: state.nodes.directorNodeId },
    gateway,
    (input) => runDirectorBlenderRender({ ...input, timeoutMs: 300_000 }),
  )
  const snapshot = await gateway.readDoc()
  const previewNode = snapshot.nodes.find((node) => node.id === result.previewNodeId)
  const shotNodeId = state.nodes.shots[0].imageNodeId
  const shotNode = snapshot.nodes.find((node) => node.id === shotNodeId)
  if (!previewNode?.result || !shotNode) throw new Error('Blender preview or shot node missing')
  const oldResult = shotNode.result && typeof shotNode.result === 'object' ? shotNode.result : null
  const shotResult = {
    ...(previewNode.result as Record<string, unknown>),
    id: `gate8-shot1-blender-${result.jobId}`,
    createdAt: Date.now(),
  }
  const history = [
    ...(Array.isArray(shotNode.history) ? shotNode.history : []),
    ...(oldResult ? [oldResult] : []),
    shotResult,
  ]
  await gateway.apply({
    ...snapshot,
    nodes: snapshot.nodes.map((node) => node.id === shotNodeId
      ? {
          ...node,
          status: 'success',
          result: shotResult,
          history,
          meta: { ...(node.meta || {}), gate8Source: 'blender-preview', sourceNodeId: result.previewNodeId },
        }
      : node),
    edges: [
      ...snapshot.edges,
      { id: `edge-gate8-blender-shot1-${Date.now()}`, source: result.previewNodeId, target: shotNodeId, mode: 'reference', order: 0 },
    ],
  })

  state.blender = {
    status: 'success',
    finishedAt: new Date().toISOString(),
    sourceNodeId: state.nodes.directorNodeId,
    previewNodeId: result.previewNodeId,
    modelNodeId: result.modelNodeId,
    jobId: result.jobId,
    blenderVersion: result.blenderVersion,
    shot1RevisionSource: result.previewNodeId,
  }
  state.updatedAt = new Date().toISOString()
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ ok: true, projectId, projectDir, ...state.blender }, null, 2)}\n`)
}

void app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    app.exit(1)
  })
