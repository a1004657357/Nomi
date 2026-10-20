import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { finishExportTempInput, getExportJobStatus, startExportJob } from '../export/exportJobs'
import { projectDirById, readProject, saveProject } from '../projects/repository'
import { ensureWorkspaceProjectIdentity } from '../workspace/workspaceProjectIdentity'

type Gate8Result = {
  id?: string
  type?: 'image' | 'video'
  url?: string
  thumbnailUrl?: string
  [key: string]: unknown
}

type Gate8Node = {
  id: string
  title?: string
  status?: string
  result?: Gate8Result | null
  history?: Gate8Result[] | null
  meta?: Record<string, unknown> | null
  [key: string]: unknown
}

type Gate8State = {
  nodes: {
    shots: Array<{ imageNodeId: string; videoNodeId: string }>
  }
  timeline?: Record<string, unknown>
  export?: Record<string, unknown>
  updatedAt?: string
}

type TimelineClip = {
  id: string
  type: 'image' | 'video'
  sourceNodeId: string
  label: string
  startFrame: number
  endFrame: number
  frameCount: number
  offsetStartFrame: number
  offsetEndFrame: number
  url: string
  thumbnailUrl?: string
  framing: { fit: 'cover'; scale: number; offsetX: number; offsetY: number }
  shotId: string
  revisionId: string
}

const FPS = 24
const IMAGE_FRAMES = 72
const VIDEO_FRAMES = 121

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is missing`)
  return value as Record<string, unknown>
}

function requireNode(nodes: Gate8Node[], id: string): Gate8Node {
  const node = nodes.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`canvas node is missing: ${id}`)
  return node
}

function requireResult(node: Gate8Node, expectedType: 'image' | 'video'): Gate8Result & { url: string; id: string } {
  const result = node.result
  if (!result || result.type !== expectedType || typeof result.url !== 'string' || !result.url) {
    throw new Error(`${expectedType} result is missing on ${node.id}`)
  }
  return {
    ...result,
    id: typeof result.id === 'string' && result.id ? result.id : `${node.id}-result`,
    url: result.url,
  }
}

function makeClip(options: {
  shotNumber: number
  node: Gate8Node
  result: Gate8Result & { url: string; id: string }
  type: 'image' | 'video'
  startFrame: number
  frameCount: number
}): TimelineClip {
  return {
    id: `gate8-shot-${options.shotNumber}-${options.type}`,
    type: options.type,
    sourceNodeId: options.node.id,
    label: options.node.title || `镜头 ${String(options.shotNumber).padStart(2, '0')}`,
    startFrame: options.startFrame,
    endFrame: options.startFrame + options.frameCount,
    frameCount: options.frameCount,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    url: options.result.url,
    ...(typeof options.result.thumbnailUrl === 'string' ? { thumbnailUrl: options.result.thumbnailUrl } : {}),
    framing: { fit: 'cover', scale: 1, offsetX: 0, offsetY: 0 },
    shotId: `gate8-shot-${options.shotNumber}`,
    revisionId: options.result.id,
  }
}

function buildManifest(projectId: string, clips: TimelineClip[]): Record<string, unknown> {
  const assets: Record<string, Record<string, unknown>> = {}
  const tracks = [
    { id: 'imageTrack', kind: 'image', type: 'image', clips: [] as Record<string, unknown>[] },
    { id: 'videoTrack', kind: 'video', type: 'video', clips: [] as Record<string, unknown>[] },
  ]

  for (const clip of clips) {
    const assetId = `asset-${clip.id}`
    assets[assetId] = { id: assetId, kind: clip.type, url: clip.url }
    tracks[clip.type === 'image' ? 0 : 1].clips.push({
      id: clip.id,
      assetId,
      startFrame: clip.startFrame,
      endFrame: clip.endFrame,
      sourceStartFrame: clip.offsetStartFrame,
      sourceEndFrame: clip.frameCount - clip.offsetEndFrame,
      transform: clip.framing,
    })
  }

  const durationFrames = Math.max(...clips.map((clip) => clip.endFrame))
  return {
    version: 1,
    projectId,
    createdAt: new Date().toISOString(),
    timeline: {
      fps: FPS,
      durationFrames,
      range: { startFrame: 0, endFrame: durationFrames },
      tracks: tracks.filter((track) => track.clips.length > 0),
    },
    profile: {
      preset: 'publish',
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'none',
      audioMode: 'mute',
      width: 720,
      height: 1280,
      fps: FPS,
      pixelFormat: 'yuv420p',
      quality: 'high',
    },
    assets,
    // Keeps the public renderer manifest on the production filtergraph transition path.
    diagnostics: { warnings: ['Renderer request uses locally resolvable Nomi assets.'] },
  }
}

async function run(): Promise<void> {
  const projectId = String(process.argv[2] || '').trim()
  if (!projectId) throw new Error('projectId is required')
  const projectDir = projectDirById(projectId)
  if (!projectDir) throw new Error(`project not found: ${projectId}`)
  const statePath = path.join(projectDir, '.nomi', 'gate8-live-state.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Gate8State
  const record = readProject(projectId)
  if (!record) throw new Error(`project record not found: ${projectId}`)
  const payload = requireRecord(record.payload, 'project payload')
  const canvas = requireRecord(payload.generationCanvas, 'generation canvas')
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes as Gate8Node[] : []

  const shot1Node = requireNode(nodes, state.nodes.shots[0].imageNodeId)
  const shot2Node = requireNode(nodes, state.nodes.shots[1].imageNodeId)
  const shot3Node = requireNode(nodes, state.nodes.shots[2].imageNodeId)
  const shot4ImageNode = requireNode(nodes, state.nodes.shots[3].imageNodeId)
  const shot4VideoNode = requireNode(nodes, state.nodes.shots[3].videoNodeId)
  const shot5VideoNode = requireNode(nodes, state.nodes.shots[4].videoNodeId)
  const shot6VideoNode = requireNode(nodes, state.nodes.shots[5].videoNodeId)

  const shot4ImageResult = requireResult(shot4ImageNode, 'image')
  const selectedShot3Result: Gate8Result & { url: string; id: string } = {
    ...shot4ImageResult,
    id: 'gate8-shot3-selected-revision-from-shot4',
    createdAt: Date.now(),
  }
  const shot3Original = shot3Node.result && typeof shot3Node.result === 'object' ? shot3Node.result : null
  const alreadySelected = shot3Node.result?.id === selectedShot3Result.id
  const nextNodes = nodes.map((node) => {
    if (node.id !== shot3Node.id || alreadySelected) return node
    const history = [
      ...(Array.isArray(node.history) ? node.history : []),
      ...(shot3Original ? [shot3Original] : []),
      selectedShot3Result,
    ]
    return {
      ...node,
      status: 'success',
      result: selectedShot3Result,
      history,
      meta: {
        ...(node.meta || {}),
        gate8SelectedRevision: true,
        gate8SelectedRevisionReason: '原镜头存在双手机语义错误，改选连续性更好的既有修订。',
        sourceNodeId: shot4ImageNode.id,
      },
    }
  })
  const selectedShot3Node = requireNode(nextNodes, shot3Node.id)

  const clips: TimelineClip[] = []
  let cursor = 0
  const addClip = (
    shotNumber: number,
    node: Gate8Node,
    type: 'image' | 'video',
    frameCount: number,
  ): void => {
    const result = requireResult(node, type)
    clips.push(makeClip({ shotNumber, node, result, type, startFrame: cursor, frameCount }))
    cursor += frameCount
  }
  addClip(1, shot1Node, 'image', IMAGE_FRAMES)
  addClip(2, shot2Node, 'image', IMAGE_FRAMES)
  addClip(3, selectedShot3Node, 'image', IMAGE_FRAMES)
  addClip(4, shot4VideoNode, 'video', VIDEO_FRAMES)
  addClip(5, shot5VideoNode, 'video', VIDEO_FRAMES)
  addClip(6, shot6VideoNode, 'video', VIDEO_FRAMES)

  const timeline = {
    version: 1,
    fps: FPS,
    scale: 1,
    playheadFrame: 0,
    tracks: [
      { id: 'imageTrack', type: 'image', label: '图片轨', clips: clips.filter((clip) => clip.type === 'image') },
      { id: 'videoTrack', type: 'video', label: '视频轨', clips: clips.filter((clip) => clip.type === 'video') },
      { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
    ],
    textClips: [],
  }
  const savedAt = Date.now()
  saveProject(projectId, {
    ...record,
    updatedAt: savedAt,
    savedAt,
    revision: (record.revision || 0) + 1,
    payload: {
      ...payload,
      generationCanvas: { ...canvas, nodes: nextNodes },
      timeline,
    },
  })

  const manifest = buildManifest(projectId, clips)
  const startedAt = Date.now()
  const job = await startExportJob({
    projectId,
    manifest,
    outputName: 'gate8-rooftop-confrontation',
  })
  if (job.backend !== 'filtergraph') {
    throw new Error(`expected filtergraph export backend, received ${job.backend}`)
  }
  const identity = await ensureWorkspaceProjectIdentity(projectDir)
  const result = requireRecord(await finishExportTempInput(identity, { jobId: job.jobId }), 'export result')
  const snapshot = getExportJobStatus(identity, job.jobId)
  const outputPath = String(result.absolutePath || '')
  if (!outputPath || !fs.existsSync(outputPath)) throw new Error('exported MP4 is missing')

  state.timeline = {
    status: 'success',
    fps: FPS,
    aspectRatio: '9:16',
    clipCount: clips.length,
    durationFrames: cursor,
    durationSeconds: cursor / FPS,
    selectedRevisionNodeId: shot3Node.id,
    selectedRevisionId: selectedShot3Result.id,
  }
  state.export = {
    status: snapshot.status,
    backend: job.backend,
    jobId: job.jobId,
    outputPath,
    relativePath: String(result.relativePath || ''),
    bytes: Number(result.size || fs.statSync(outputPath).size),
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString(),
  }
  state.updatedAt = new Date().toISOString()
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ ok: true, projectId, projectDir, timeline: state.timeline, export: state.export }, null, 2)}\n`)
}

app.setName('nomi')
void app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    app.exit(1)
  })
