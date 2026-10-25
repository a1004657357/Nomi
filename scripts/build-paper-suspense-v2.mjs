#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'

const PROJECT_ID = 'workspace-8fc380eb-098e-450b-b57d-138ac8f758f9'
const ASSET_PREFIX = `nomi-local://asset/${PROJECT_ID}/`
const FINAL_NODE_ID = 'paper-suspense-final-cut-repair-v2'
const FINAL_CLIP_ID = 'clip-paper-suspense-final-cut-v2'

const SEGMENTS = [
  {
    key: 'r1',
    sourceNodeId: 'paper-suspense-repair-r1-dreamina-mini',
    file: 'assets/final/2026-08-07/repair-v2/generated/r1/6ed199ba-20e2-4c57-8888-b6f1b47db912_video_1.mp4',
    in: 0,
    out: 12.016667,
    reason: '保留完整强钩子、抓腕、水瓶落地和稳定反应尾帧',
  },
  {
    key: 'r2',
    sourceNodeId: 'paper-suspense-repair-r2-dreamina-mini',
    file: 'assets/final/2026-08-07/repair-v2/generated/r2/c3a0a932-e30a-43c9-84d8-3968b11f821e_video_1.mp4',
    in: 0,
    out: 10.016667,
    reason: '保留撕纸、入桶、复活、纸人指向和女主拿夹子',
  },
  {
    key: 'old-group3',
    sourceNodeId: 'paper-video-group-03-dreamina-mini',
    file: 'assets/generated/2026-08-07/seedance-mini/group-03/8f189285-d6fb-4530-9d61-4a73be52aa7b_video_1.mp4',
    in: 4.5,
    out: 15.0,
    reason: '删除重复爬出动作，从女主持夹子开始，保留对峙、走向冰箱和开门',
  },
  {
    key: 'r4',
    sourceNodeId: 'paper-suspense-repair-r4-dreamina-mini',
    file: 'assets/final/2026-08-07/repair-v2/generated/r4/56ed2aab-9efc-4100-b970-f03474e766a2_video_1.mp4',
    in: 4.0,
    out: 10.0,
    reason: '删除纸人贴袖穿模，只保留便签特写和认出母亲字迹的反应',
  },
  {
    key: 'r5',
    sourceNodeId: 'paper-suspense-repair-r5-dreamina-mini',
    file: 'assets/final/2026-08-07/repair-v2/generated/r5/04d78ec8-00a9-4dbe-ac60-570c180ccd8e_video_1.mp4',
    in: 0,
    out: 15.016667,
    reason: '保留热饭、第一口饭、纸指推回筷子和温情结尾',
  },
]

const OVERLAYS = [
  { key: 'opening', start: 0.2, end: 2.8, position: 'top', text: '妈妈走后，冰箱里每天都会出现她的字。' },
  { key: 'note-1', start: 32.75, end: 34.25, position: 'bottom', text: '好好吃饭' },
  { key: 'note-2', start: 34.25, end: 35.8, position: 'bottom', text: '闺女，热一下。妈' },
  { key: 'dialogue-mom', start: 36.0, end: 37.8, position: 'bottom', text: '妈……' },
  { key: 'dialogue-know', start: 49.0, end: 51.2, position: 'bottom', text: '知道了。' },
]

function die(message) {
  throw new Error(message)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function run(bin, args, label) {
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) die(`${label}失败：${result.stderr || result.stdout || result.error?.message || 'unknown error'}`)
  return result.stdout
}

function probe(file) {
  const output = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration,codec_name:format=duration,size',
    '-of', 'json', file,
  ], 'ffprobe')
  const parsed = JSON.parse(output)
  const stream = parsed.streams?.[0]
  return {
    width: Number(stream?.width || 0),
    height: Number(stream?.height || 0),
    durationSeconds: Number(stream?.duration || parsed.format?.duration || 0),
    codec: String(stream?.codec_name || ''),
    size: Number(parsed.format?.size || 0),
  }
}

async function renderOverlays(directory) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  })
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 })
    for (const overlay of OVERLAYS) {
      const top = overlay.position === 'top' ? 86 : 1080
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;width:720px;height:1280px;background:transparent;overflow:hidden}
        .text{position:absolute;left:45px;right:45px;top:${top}px;text-align:center;color:white;
          font-family:"PingFang SC","Heiti SC",sans-serif;font-size:${overlay.position === 'top' ? 40 : 44}px;
          font-weight:600;line-height:1.32;letter-spacing:0;text-shadow:0 2px 4px rgba(0,0,0,.95),0 0 14px rgba(0,0,0,.75)}
      </style></head><body><div class="text">${overlay.text}</div></body></html>`)
      await page.screenshot({ path: path.join(directory, `${overlay.key}.png`), omitBackground: true })
    }
  } finally {
    await browser.close()
  }
}

function buildBase(projectRoot, workDir) {
  const baseFile = path.join(workDir, '别忘了吃饭_纸条悬疑版_修复二剪_v2_base.mp4')
  if (existsSync(baseFile)) {
    const existing = probe(baseFile)
    if (existing.width === 720 && existing.height === 1280 && Math.abs(existing.durationSeconds - 53.55) <= 0.3) return baseFile
  }
  const inputs = SEGMENTS.flatMap((segment) => ['-i', path.join(projectRoot, segment.file)])
  const filters = []
  SEGMENTS.forEach((segment, index) => {
    const duration = segment.out - segment.in
    filters.push(
      `[${index}:v]trim=start=${segment.in}:end=${segment.out},setpts=PTS-STARTPTS,scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=24,format=yuv420p[v${index}]`,
      `[${index}:a]atrim=start=${segment.in}:end=${segment.out},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:LRA=11:TP=-1.5,afade=t=in:st=0:d=0.03,afade=t=out:st=${Math.max(0, duration - 0.03)}:d=0.03[a${index}]`,
    )
  })
  filters.push(`${SEGMENTS.map((_segment, index) => `[v${index}][a${index}]`).join('')}concat=n=${SEGMENTS.length}:v=1:a=1[v][a]`)
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    baseFile,
  ], '基础剪辑')
  return baseFile
}

function burnOverlays(baseFile, overlayDir, outputFile) {
  const inputs = OVERLAYS.flatMap((overlay) => ['-loop', '1', '-framerate', '24', '-i', path.join(overlayDir, `${overlay.key}.png`)])
  const filters = []
  let current = '[0:v]'
  OVERLAYS.forEach((overlay, index) => {
    const next = `[vo${index}]`
    filters.push(`${current}[${index + 1}:v]overlay=0:0:eof_action=repeat:enable='between(t,${overlay.start},${overlay.end})'${next}`)
    current = next
  })
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', baseFile,
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', current, '-map', '0:a:0',
    '-t', '53.55',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-movflags', '+faststart',
    outputFile,
  ], '字幕烧录')
}

function createReview(outputFile, reviewDir) {
  mkdirSync(reviewDir, { recursive: true })
  const poster = path.join(reviewDir, 'poster-v2.jpg')
  const contactSheet = path.join(reviewDir, 'contact-sheet-v2.jpg')
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1.6', '-i', outputFile, '-frames:v', '1', poster], '海报抽帧')
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', outputFile, '-vf', 'fps=1/6,scale=270:480,tile=3x3', '-frames:v', '1', contactSheet], '审片接触表')
  return { poster, contactSheet }
}

function upsertFinalNode(projectRoot, project, outputFile, review, media, edlFile) {
  const canvas = project.payload.generationCanvas
  const relativeVideo = path.relative(projectRoot, outputFile).split(path.sep).join('/')
  const relativePoster = path.relative(projectRoot, review.poster).split(path.sep).join('/')
  const videoUrl = `${ASSET_PREFIX}${relativeVideo}`
  const posterUrl = `${ASSET_PREFIX}${relativePoster}`
  const sourceNodeIds = SEGMENTS.map((segment) => segment.sourceNodeId)
  const now = Date.now()
  const result = {
    id: `${FINAL_NODE_ID}-result`,
    type: 'video',
    url: videoUrl,
    thumbnailUrl: posterUrl,
    model: 'local-ffmpeg-edit',
    durationSeconds: media.durationSeconds,
    taskId: 'local-edit-paper-suspense-v2',
    taskKind: 'video',
    createdAt: now,
    raw: { editor: 'ffmpeg', sourceNodeIds, edlFile: path.relative(projectRoot, edlFile).split(path.sep).join('/'), videoCodec: 'h264', audioCodec: 'aac', audioTargetLufs: -16 },
    provenance: {
      timestamp: now,
      provider: 'local-ffmpeg',
      modelKey: 'timeline-edit',
      prompt: 'R1与R2新素材、旧组3精选段、R4无穿模后半段、R5结尾按动作点硬切；统一音频响度并烧录必要叙事文字。',
      params: { extras: { projectId: PROJECT_ID, ratio: '9:16', width: media.width, height: media.height, fps: 24, durationSeconds: media.durationSeconds } },
      vendorRequestId: 'local-edit-paper-suspense-v2',
    },
  }
  const node = {
    id: FINAL_NODE_ID,
    kind: 'video',
    renderKind: 'shot-frame',
    title: `成片二剪 v2｜修复版｜${Math.round(media.durationSeconds)}秒`,
    position: { x: 6100, y: 260 },
    size: { width: 560, height: 620 },
    prompt: '删除重复与穿模段，使用R1、R2、旧组3精选段、R4便签反转和R5吃饭结尾，烧录开场信息、便签内容与关键对白。',
    references: sourceNodeIds,
    history: [result],
    runs: [],
    status: 'success',
    categoryId: 'shots',
    meta: {
      finalCut: true,
      editVersion: 2,
      repairedCut: true,
      modelKey: 'local-ffmpeg-edit',
      modelLabel: '本地剪辑成片',
      modelVendor: 'local',
      sourceNodeIds,
      ratio: '9:16',
      videoWidth: media.width,
      videoHeight: media.height,
      videoDuration: media.durationSeconds,
      fps: 24,
      audioTargetLufs: -16,
      videoCodec: 'h264',
      audioCodec: 'aac',
      burnedText: OVERLAYS,
      previewHeight: 620,
    },
    result,
  }
  const nodeIndex = canvas.nodes.findIndex((candidate) => candidate.id === FINAL_NODE_ID)
  if (nodeIndex >= 0) canvas.nodes[nodeIndex] = node
  else canvas.nodes.push(node)
  const edgeId = `edge-paper-suspense-repair-r5-dreamina-mini-${FINAL_NODE_ID}-edit`
  const edge = { id: edgeId, source: 'paper-suspense-repair-r5-dreamina-mini', target: FINAL_NODE_ID, mode: 'composition_ref', order: 0 }
  const edgeIndex = canvas.edges.findIndex((candidate) => candidate.id === edgeId)
  if (edgeIndex >= 0) canvas.edges[edgeIndex] = edge
  else canvas.edges.push(edge)

  const timeline = project.payload.timeline
  const videoTrack = timeline.tracks.find((track) => track.id === 'videoTrack' || track.type === 'video')
  if (!videoTrack) die('项目缺少视频轨')
  const frames = Math.round(media.durationSeconds * Number(timeline.fps || 30))
  videoTrack.clips = [{
    id: FINAL_CLIP_ID,
    type: 'video',
    sourceNodeId: FINAL_NODE_ID,
    label: '别忘了吃饭·纸条悬疑版｜修复二剪 v2',
    startFrame: 0,
    endFrame: frames,
    frameCount: frames,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    url: videoUrl,
    thumbnailUrl: posterUrl,
    framing: { mode: 'contain', scale: 1, offsetX: 0, offsetY: 0 },
  }]
  project.revision = Number(project.revision || 0) + 1
  project.updatedAt = now
  project.savedAt = now
  return { nodeId: FINAL_NODE_ID, clipId: FINAL_CLIP_ID, frames, videoUrl, posterUrl }
}

const projectRoot = path.resolve(process.argv[2] || '')
if (!projectRoot) die('用法：build-paper-suspense-v2.mjs <projectRoot>')
const projectFile = path.join(projectRoot, '.nomi', 'project.json')
const project = readJson(projectFile)
if (project.id !== PROJECT_ID) die(`项目ID不匹配：${project.id}`)
for (const segment of SEGMENTS) {
  const file = path.join(projectRoot, segment.file)
  if (!existsSync(file) || statSync(file).size === 0) die(`缺少剪辑素材：${file}`)
}

const workDir = path.join(projectRoot, 'assets', 'final', '2026-08-08')
const repairDir = path.join(projectRoot, 'assets', 'final', '2026-08-07', 'repair-v2')
const overlayDir = path.join(repairDir, 'overlays')
const reviewDir = path.join(workDir, 'review')
mkdirSync(workDir, { recursive: true })
mkdirSync(overlayDir, { recursive: true })
const outputFile = path.join(workDir, '别忘了吃饭_纸条悬疑版_修复二剪_v2.mp4')
const edlFile = path.join(workDir, 'edit-decision-list-v2.json')
const backupDir = path.join(projectRoot, '.nomi', 'backups')
mkdirSync(backupDir, { recursive: true })
const backup = path.join(backupDir, `project.before-final-cut-v2-${Date.now()}.json`)
copyFileSync(projectFile, backup)

const baseFile = buildBase(projectRoot, repairDir)
await renderOverlays(overlayDir)
burnOverlays(baseFile, overlayDir, outputFile)
const media = probe(outputFile)
if (media.width !== 720 || media.height !== 1280 || Math.abs(media.durationSeconds - 53.55) > 0.3) {
  die(`成片技术参数异常：${media.width}x${media.height} ${media.durationSeconds}s`)
}
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', outputFile, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], '完整解码')
const review = createReview(outputFile, reviewDir)
writeJson(edlFile, {
  version: 2,
  title: '别忘了吃饭·纸条悬疑版｜修复二剪 v2',
  output: outputFile,
  durationSeconds: media.durationSeconds,
  segments: SEGMENTS.map((segment) => ({ ...segment, duration: segment.out - segment.in })),
  overlays: OVERLAYS,
  audio: { targetLufs: -16, lra: 11, truePeakDb: -1.5 },
  excluded: { r3: '两次参考图上传均在生成前失败且未扣积分；使用旧视频组3精选段代替', r4Head: '前4秒纸人贴袖，裁掉' },
})
const imported = upsertFinalNode(projectRoot, project, outputFile, review, media, edlFile)
writeJson(projectFile, project)
process.stdout.write(`${JSON.stringify({ ok: true, outputFile, edlFile, backup, media, review, imported }, null, 2)}\n`)
