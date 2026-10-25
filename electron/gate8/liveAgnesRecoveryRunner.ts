import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createDiskGateway } from '../capabilityCore/gateway'
import { fetchTaskResult } from '../tasks/taskResultQuery'

type Submission = {
  phase: string
  shotIndex: number
  nodeId: string
  status: string
  [key: string]: unknown
}

type Gate8State = {
  submissions: Submission[]
  updatedAt?: string
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

function latestTaskId(projectDir: string, nodeId: string): string {
  const eventsDir = path.join(projectDir, '.nomi', 'events')
  const files = fs.readdirSync(eventsDir).filter((name) => name.endsWith('.jsonl')).sort()
  let taskId = ''
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(eventsDir, file), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event?.type === 'vendor.call.requested' && event?.payload?.nodeId === nodeId) {
          taskId = String(event.payload.runId || '').trim()
        }
      } catch {
        // Ignore an incomplete tail line.
      }
    }
  }
  if (!taskId) throw new Error(`task id not found for node ${nodeId}`)
  return taskId
}

function localPathForAsset(projectDir: string, projectId: string, url: string): string | null {
  const prefix = `nomi-local://asset/${projectId}/`
  return url.startsWith(prefix) ? path.join(projectDir, decodeURIComponent(url.slice(prefix.length))) : null
}

async function run(): Promise<void> {
  const projectId = String(process.argv[2] || '').trim()
  const nodeId = String(process.argv[3] || '').trim()
  const shotIndex = Number(process.argv[4])
  if (!projectId || !nodeId || !Number.isFinite(shotIndex)) throw new Error('projectId, nodeId and shotIndex are required')
  const projectDir = projectDirForId(projectId)
  const statePath = path.join(projectDir, '.nomi', 'gate8-live-state.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Gate8State
  const submission = [...state.submissions].reverse().find((item) => (
    item.phase === 'video' && item.shotIndex === shotIndex && item.nodeId === nodeId
  ))
  if (!submission) throw new Error('matching submission not found')
  const taskId = latestTaskId(projectDir, nodeId)
  submission.taskId = taskId
  submission.recoveryStartedAt = new Date().toISOString()
  const initialDelayMs = Math.max(0, Number(process.env.GATE8_RECOVERY_INITIAL_DELAY_MS || 60_000))
  const intervalMs = Math.max(15_000, Number(process.env.GATE8_RECOVERY_INTERVAL_MS || 30_000))
  await delay(initialDelayMs)

  const gateway = createDiskGateway(projectId)
  const prompt = (await gateway.readDoc()).nodes.find((node) => node.id === nodeId)?.prompt || ''
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const response = await fetchTaskResult({
      taskId,
      vendor: 'agnes',
      taskKind: 'image_to_video',
      prompt,
      modelKey: 'agnes-video-v2.0',
      projectId,
    })
    const result = response.result
    process.stdout.write(`${JSON.stringify({ event: 'recovery.poll', attempt, taskId, status: result.status, assetCount: result.assets.length })}\n`)
    if (result.status === 'succeeded' && result.assets[0]) {
      const asset = result.assets[0]
      const snapshot = await gateway.readDoc()
      const node = snapshot.nodes.find((item) => item.id === nodeId)
      if (!node) throw new Error(`node not found: ${nodeId}`)
      const nodeResult = {
        id: result.id,
        type: 'video',
        url: asset.url,
        ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
        ...(asset.providerUrl ? { providerUrl: asset.providerUrl } : {}),
        ...(asset.assetId ? { assetId: asset.assetId } : {}),
        ...(asset.durationSeconds ? { durationSeconds: asset.durationSeconds } : {}),
        createdAt: Date.now(),
      }
      await gateway.apply({
        ...snapshot,
        nodes: snapshot.nodes.map((item) => item.id === nodeId
          ? {
              ...item,
              status: 'success',
              error: undefined,
              result: nodeResult,
              history: [...(Array.isArray(item.history) ? item.history : []), nodeResult],
              meta: { ...(item.meta || {}), recoveredTaskId: taskId },
            }
          : item),
      })
      submission.status = 'success'
      submission.providerStatus = 'succeeded'
      submission.recoveredWithoutCreate = true
      submission.recoveryFinishedAt = new Date().toISOString()
      submission.assetUrl = asset.url
      submission.assetPath = localPathForAsset(projectDir, projectId, asset.url)
      state.updatedAt = new Date().toISOString()
      fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      process.stdout.write(`${JSON.stringify({ event: 'recovery.completed', taskId, nodeId, assetPath: submission.assetPath })}\n`)
      return
    }
    if (result.status === 'failed' || result.status === 'cancelled') {
      submission.providerStatus = result.status
      submission.recoveryFinishedAt = new Date().toISOString()
      submission.error = result.error || `AGNES task ${result.status}`
      state.updatedAt = new Date().toISOString()
      fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      throw new Error(String(submission.error))
    }
    await delay(intervalMs)
  }
  submission.status = 'recoverable'
  submission.recoveredWithoutCreate = true
  submission.recoveryFinishedAt = new Date().toISOString()
  state.updatedAt = new Date().toISOString()
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  throw new Error(`AGNES task ${taskId} did not reach a terminal state during recovery`)
}

app.setName('nomi')
void app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    app.exit(1)
  })
