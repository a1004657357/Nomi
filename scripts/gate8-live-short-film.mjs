#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { invoke, readLiveInstance } from './lib/nomiClient.mjs'

const PROJECTS_ROOT = path.join(os.homedir(), 'Documents', 'Nomi Projects')
const STATE_FILE = 'gate8-live-state.json'
const SPEND_ENV = {
  NOMI_LOOP_SPEND_OK: '1',
  NOMI_POLL_TIMEOUT_MS: '360000',
  NOMI_RPC_TIMEOUT_MS: '480000',
}
const MAX_SUBMISSIONS = 12

const CHARACTER_LOCK = '林夏，29岁中国女性，齐肩黑发，清晰自然的东亚面孔，深灰色短风衣、酒红色针织衫、黑色长裤、银色细框腕表'
const SCENE_LOCK = '傍晚城市写字楼天台，浅灰混凝土地面，腰高金属护栏，右侧深灰机房门，远处暖橙天空与蓝灰城市天际线'
const STYLE_LOCK = '写实电影摄影，克制的青橙色调，自然皮肤纹理，真实焦外和运动透视，无文字、无商标、无水印，竖屏9:16'

const SHOTS = [
  {
    imagePrompt: `镜头01建立镜头。${CHARACTER_LOCK}独自站在${SCENE_LOCK}，人物位于画面下方三分之一，身体三分之二侧对镜头，脸部轮廓仍可辨认；左手自然垂下，右手风衣口袋里放着黑色手机。24mm广角远景，轻微低机位，风吹动衣摆和头发，天台空间关系清楚。${STYLE_LOCK}`,
    videoPrompt: `5秒连续叙事镜头。保持参考图中的林夏身份、服装、天台结构和黄昏光线。开场从护栏外侧的城市天际线快速下降并向前推进到林夏三分之二侧身远景；林夏迎风向护栏走两步后停下，风衣下摆和头发持续受风摆动，远处云层产生真实视差。前2秒完成最强的下降推进，后3秒稳定落位。不要做静态缩放、照片抖动或人物凝固。`,
  },
  {
    imagePrompt: `镜头02角色镜头。严格保持上一镜林夏的脸、发型、年龄、服装和${SCENE_LOCK}。林夏背靠护栏但身体转成四分之三正面，右手从风衣口袋拿出黑色手机；手机背面朝向镜头，镜头绝不能看到屏幕或屏幕内容。50mm中近景，视线落向手中手机，表情从平静转为迟疑。${STYLE_LOCK}`,
    videoPrompt: `5秒连续叙事镜头。保持参考图人物身份、服装和天台位置。林夏从口袋完整抽出手机，手机在掌心振动一次；她先低头看向屏幕方向再抬眼扫向机房门，呼吸停顿，眉心逐渐收紧。手机背面始终朝向镜头，绝不显示屏幕。镜头沿她右侧小幅弧形跟随并从中景收至中近景，动作有明确起点和结果，不要只让头发微动。`,
  },
  {
    imagePrompt: `镜头03电话响。严格保持上一镜林夏、服装、手机和天台结构。黑色手机仍是背面朝向镜头，林夏拇指悬在接听位置但屏幕不可见；她的目光停在手机上，嘴唇轻抿。85mm手部与面部同框近景，背景机房门虚化但位置关系可识别。${STYLE_LOCK}`,
    videoPrompt: `5秒连续叙事镜头。参考图只用于锁定身份、手机和天台，不锁死动作。手机在林夏手中连续振动，她的拇指犹豫半秒后完成接听动作；手臂随后抬起，手机从胸前移动到耳侧，眼神同时从手机转向远处。镜头从手部近景快速上摇到面部近景，焦点从手机切到双眼。手机屏幕全程背离镜头，不得出现界面。`,
  },
  {
    imagePrompt: `镜头04接听对白。严格保持上一镜林夏和${SCENE_LOCK}。林夏把黑色手机贴在右耳，手机背面朝外；她侧身面对护栏，左手紧握护栏边缘，眼神警觉。65mm胸像近景，机位在人物左前方，夕阳轮廓光勾勒发丝，脸部自然可读。${STYLE_LOCK}`,
    videoPrompt: `5秒连续表演镜头。保持参考图人物、服装、手机和空间位置。林夏听到电话内容后先僵住，左手指节逐渐收紧抓住护栏；随后她压低声音说一句短话，目光越过镜头看向机房门，表情从迟疑转为戒备。镜头极缓慢前推约半米并略向左绕行，夕阳光斑随机位移动扫过脸侧。禁止静态嘴动、随机眨眼或无目的摇镜。`,
  },
  {
    imagePrompt: `镜头05反派出现。保持林夏身份服装、手机和天台连续性。前景是林夏握手机的肩部和侧脸，背景右侧深灰机房门刚打开，一名高个男性只以逆光剪影和踏出的黑鞋出现，不展示清晰脸部。35mm过肩中景，门、人物、护栏空间关系明确，紧张构图。${STYLE_LOCK}`,
    videoPrompt: `5秒连续悬念镜头。保持参考图的前后景关系。机房门先被从里面推开，门缝光线扩大；一只黑鞋落地后，高个男性剪影向天台迈出一步。林夏在前景听见脚步声，肩膀立刻收紧，通话中的手停住。镜头从林夏肩后向右平移，逐步显露门口剪影并形成明显前后景视差；不要凭空变形、闪现或只做画面推拉。`,
  },
  {
    imagePrompt: `镜头06高潮转身。严格保持林夏、服装、手机、天台和门口剪影连续。林夏突然转身正面对向门口，右手仍把手机贴在耳侧，左脚后撤形成稳定防御姿态；高个男性剪影位于远处门边。40mm低机位双人中景，林夏清晰、反派略虚，护栏与门保持前镜方位。${STYLE_LOCK}`,
    videoPrompt: `5秒高潮镜头。保持参考图人物身份和天台轴线。林夏听见第二声脚步后迅速完成一次完整转身：头先回看、肩膀跟随、左脚后撤落地，最终正面对门口剪影；手机仍贴耳，左手从护栏松开并抬至身体前侧。镜头贴着她的转身方向做快速半环绕并在正面中景急停，背景护栏和门产生强运动视差。结尾保持一秒对峙定格，但前四秒必须有连续真实动作。`,
  },
]

function projectDirForId(projectId) {
  for (const entry of fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const projectFile = path.join(PROJECTS_ROOT, entry.name, '.nomi', 'project.json')
    if (!fs.existsSync(projectFile)) continue
    try {
      if (JSON.parse(fs.readFileSync(projectFile, 'utf8')).id === projectId) return path.dirname(path.dirname(projectFile))
    } catch {
      // Ignore unrelated or partially written projects.
    }
  }
  throw new Error(`找不到项目目录: ${projectId}`)
}

function statePath(projectDir) {
  return path.join(projectDir, '.nomi', STATE_FILE)
}

function readState(projectDir) {
  const file = statePath(projectDir)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

function writeState(projectDir, state) {
  state.updatedAt = new Date().toISOString()
  fs.writeFileSync(statePath(projectDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function emit(event, data = {}) {
  process.stdout.write(`GATE8_EVENT ${JSON.stringify({ event, at: new Date().toISOString(), ...data })}\n`)
}

function localPathForAsset(projectDir, projectId, asset) {
  const url = String(asset?.url || '')
  const prefix = `nomi-local://asset/${projectId}/`
  return url.startsWith(prefix) ? path.join(projectDir, decodeURIComponent(url.slice(prefix.length))) : null
}

async function prepare(projectId, projectDir) {
  const existing = readState(projectDir)
  if (existing) {
    emit('prepare.skipped', { reason: 'state-exists', projectId })
    return existing
  }
  const screenplay = [
    '短片：天台对峙',
    '一句话：林夏在天台接到威胁电话，从迟疑到转身面对来者。',
    ...SHOTS.map((_, index) => `镜头${String(index + 1).padStart(2, '0')}：${['建立天台与人物', '手机振动，人物迟疑', '犹豫后接听', '听到威胁并警觉', '机房门打开，脚步逼近', '转身正面对峙'][index]}`),
  ].join('\n')
  const specs = [
    { kind: 'text', title: 'Gate 8 分镜脚本', prompt: screenplay, x: 0, y: 0 },
    { kind: 'text', title: '角色资产卡：林夏', prompt: CHARACTER_LOCK, x: 0, y: 360 },
    { kind: 'text', title: '场景资产卡：城市天台', prompt: SCENE_LOCK, x: 0, y: 720 },
    { kind: 'text', title: '道具资产卡：黑色手机', prompt: '无品牌黑色智能手机；当背面朝向镜头时，禁止显示任何屏幕或界面内容。', x: 0, y: 1080 },
    ...SHOTS.flatMap((shot, index) => [
      { kind: 'image', title: `镜头${String(index + 1).padStart(2, '0')} 关键帧`, prompt: shot.imagePrompt, x: 520, y: index * 380 },
      { kind: 'video', title: `镜头${String(index + 1).padStart(2, '0')} 视频`, prompt: shot.videoPrompt, x: 1050, y: index * 380 },
    ]),
    { kind: 'scene3d', title: '镜头06 Blender 预演', prompt: '天台对峙：林夏转身面对机房门口来者，9:16低机位双人中景。', x: 1580, y: 1900 },
  ]
  const created = await invoke('canvas.addNodes', { projectId, nodes: specs }, { spawnEnv: SPEND_ENV })
  const [screenplayNodeId, roleNodeId, sceneNodeId, propNodeId, ...remaining] = created.ids
  const directorNodeId = remaining.at(-1)
  const shotIds = SHOTS.map((_, index) => ({ imageNodeId: remaining[index * 2], videoNodeId: remaining[index * 2 + 1] }))
  const connections = []
  shotIds.forEach((shot, index) => {
    connections.push({ source: shot.imageNodeId, target: shot.videoNodeId, mode: 'reference' })
    if (index > 0) connections.push({ source: shotIds[index - 1].imageNodeId, target: shot.imageNodeId, mode: 'reference' })
  })
  await invoke('canvas.connect', { projectId, connections }, { spawnEnv: SPEND_ENV })
  const state = {
    schemaVersion: 1,
    projectId,
    projectDir,
    startedAt: new Date().toISOString(),
    constraints: { maxSubmissions: MAX_SUBMISSIONS, maxConcurrency: 2, autoRetryPaid: false, providers: ['codex', 'agnes'] },
    nodes: { screenplayNodeId, roleNodeId, sceneNodeId, propNodeId, directorNodeId, shots: shotIds },
    submissions: [],
  }
  writeState(projectDir, state)
  emit('prepare.completed', { projectId, nodeCount: created.ids.length, edgeCount: connections.length })
  return state
}

async function canvasNode(projectId, nodeId) {
  const canvas = await invoke('canvas.read', { projectId }, { spawnEnv: SPEND_ENV })
  return canvas.nodes.find((node) => node.id === nodeId)
}

async function generateOne({ projectId, projectDir, state, nodeId, phase, shotIndex, prompt, references, allowFailedNode = false, retryReason }) {
  const node = await canvasNode(projectId, nodeId)
  if (!node) throw new Error(`节点不存在: ${nodeId}`)
  if (node.status === 'success' && node.hasResult) {
    emit(`${phase}.skipped`, { shotIndex, nodeId, reason: 'already-success' })
    return
  }
  if (node.status === 'error' && !allowFailedNode) throw new Error(`节点 ${nodeId} 已有失败记录；按不重试规则停止`)
  if (node.status === 'running' || node.status === 'queued') throw new Error(`节点 ${nodeId} 仍为 ${node.status}；为防重复提交停止`)
  if (state.submissions.length >= MAX_SUBMISSIONS) throw new Error(`已达到 ${MAX_SUBMISSIONS} 次提交上限`)

  const startedAtMs = Date.now()
  const submission = {
    phase,
    shotIndex,
    nodeId,
    vendor: 'agnes',
    model: phase === 'image' ? 'agnes-image-2.1-flash' : 'agnes-video-v2.0',
    startedAt: new Date(startedAtMs).toISOString(),
    status: 'submitted',
    ...(retryReason ? { retryReason } : {}),
  }
  state.submissions.push(submission)
  writeState(projectDir, state)
  emit(`${phase}.submitted`, { shotIndex, nodeId, submissionNumber: state.submissions.length })
  try {
    const result = await invoke('generate', {
      projectId,
      nodeId,
      prompt,
      intent: phase,
      vendor: submission.vendor,
      modelKey: submission.model,
      ...(references?.length ? { references } : {}),
      params: phase === 'image'
        ? { size: '720x1280' }
        : { aspect_ratio: '9:16', resolution: '720p', duration: '5' },
    }, { spawnEnv: SPEND_ENV })
    const asset = (result.assets || [])[0]
    const finishedAtMs = Date.now()
    const providerStatus = result.status || 'unknown'
    submission.providerStatus = providerStatus
    submission.status = providerStatus === 'success' || providerStatus === 'succeeded' ? 'success' : providerStatus
    submission.finishedAt = new Date(finishedAtMs).toISOString()
    submission.elapsedMs = finishedAtMs - startedAtMs
    submission.taskId = asset?.id || null
    submission.assetUrl = asset?.url || null
    submission.assetPath = localPathForAsset(projectDir, projectId, asset)
    if (submission.assetPath && fs.existsSync(submission.assetPath) && fs.statSync(submission.assetPath).size < 10 * 1024) {
      throw new Error(`${phase} 镜头 ${shotIndex} 返回了小于 10 KiB 的无效占位资产`)
    }
    writeState(projectDir, state)
    emit(`${phase}.completed`, { shotIndex, nodeId, status: submission.status, elapsedMs: submission.elapsedMs, assetPath: submission.assetPath })
    if (submission.status !== 'success') throw new Error(`${phase} 镜头 ${shotIndex} 返回 ${submission.status}`)
  } catch (error) {
    submission.status = 'failed'
    submission.finishedAt = new Date().toISOString()
    submission.elapsedMs = Date.now() - startedAtMs
    submission.error = error instanceof Error ? error.message.slice(0, 1200) : String(error).slice(0, 1200)
    writeState(projectDir, state)
    emit(`${phase}.failed`, { shotIndex, nodeId, elapsedMs: submission.elapsedMs, error: submission.error })
    throw error
  }
}

function resultUrlForNode(projectDir, nodeId) {
  const record = JSON.parse(fs.readFileSync(path.join(projectDir, '.nomi', 'project.json'), 'utf8'))
  const nodes = record?.payload?.generationCanvas?.nodes
  const node = Array.isArray(nodes) ? nodes.find((item) => item?.id === nodeId) : null
  return typeof node?.result?.url === 'string' ? node.result.url : ''
}

async function generatePhase(projectId, projectDir, state, phase) {
  const indices = phase === 'video' ? [3, 4, 5] : [1, 2, 3, 4, 5]
  for (const index of indices) {
    const videoReferenceIndex = index === 2 ? 1 : index === 5 ? 4 : index
    const references = phase === 'video'
      ? [resultUrlForNode(projectDir, state.nodes.shots[videoReferenceIndex].imageNodeId)].filter(Boolean)
      : undefined
    await generateOne({
      projectId,
      projectDir,
      state,
      nodeId: phase === 'image' ? state.nodes.shots[index].imageNodeId : state.nodes.shots[index].videoNodeId,
      phase,
      shotIndex: index + 1,
      prompt: phase === 'image' ? SHOTS[index].imagePrompt : SHOTS[index].videoPrompt,
      references,
    })
  }
}

function recordExternalCodexFailure(projectDir, state) {
  if (state.submissions.some((submission) => submission.model === 'built-in-image_gen')) {
    emit('external-codex-failure.skipped', { reason: 'already-recorded' })
    return
  }
  const elapsedMs = 297_700
  state.submissions.push({
    phase: 'image',
    shotIndex: 1,
    nodeId: state.nodes.shots[0].imageNodeId,
    vendor: 'codex-direct',
    model: 'built-in-image_gen',
    startedAt: new Date(Date.now() - elapsedMs).toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs,
    timingSource: 'Codex tool wall-time',
    status: 'failed',
    error: 'image generation failed: network error sending request to ChatGPT image generation endpoint',
  })
  writeState(projectDir, state)
  emit('external-codex-failure.recorded', { submissionNumber: state.submissions.length, elapsedMs })
}

async function retryFirstImage(projectId, projectDir, state) {
  const failed = state.submissions.find((submission) => (
    submission.phase === 'image' && submission.shotIndex === 1 && submission.status === 'failed'
  ))
  if (!failed) throw new Error('第 1 镜没有可恢复的失败记录')
  await generateOne({
    projectId,
    projectDir,
    state,
    nodeId: state.nodes.shots[0].imageNodeId,
    phase: 'image',
    shotIndex: 1,
    prompt: SHOTS[0].imagePrompt,
    allowFailedNode: true,
    retryReason: '人工恢复：首次 Codex 调用 300 秒无输出；降为 1K 后单次重提',
  })
}

async function main() {
  const [phase = 'all', projectId] = process.argv.slice(2)
  if (!projectId) throw new Error('用法：node scripts/gate8-live-short-film.mjs <prepare|record-external-codex-failure|retry-first-image|images|videos|all|status> <projectId>')
  if (readLiveInstance()) throw new Error('验收脚本要求 Nomi 桌面实例已关闭，避免多个写者竞争项目文件')
  const projectDir = projectDirForId(projectId)
  const state = await prepare(projectId, projectDir)
  if (phase === 'prepare') return
  if (phase === 'status') {
    emit('status', { projectId, projectDir, submissionCount: state.submissions.length, submissions: state.submissions })
    return
  }
  if (phase === 'retry-first-image') {
    await retryFirstImage(projectId, projectDir, state)
    return
  }
  if (phase === 'record-external-codex-failure') {
    recordExternalCodexFailure(projectDir, state)
    return
  }
  if (phase === 'images' || phase === 'all') await generatePhase(projectId, projectDir, state, 'image')
  if (phase === 'videos' || phase === 'all') await generatePhase(projectId, projectDir, state, 'video')
  emit('generation.completed', { projectId, projectDir, submissionCount: state.submissions.length })
}

main().catch((error) => {
  process.stderr.write(`GATE8_FATAL ${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
