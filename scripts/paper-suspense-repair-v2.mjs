#!/usr/bin/env node

import { execFile } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { spawnSync } from 'node:child_process'

const execFileAsync = promisify(execFile)
const DREAMINA = '/Users/huawuer/.local/bin/dreamina'
const PROJECT_ID = 'workspace-8fc380eb-098e-450b-b57d-138ac8f758f9'
const ASSET_PREFIX = `nomi-local://asset/${PROJECT_ID}/`
const CARD_IDS = [
  'paper-ref-anchor-1',
  'paper-ref-anchor-2',
  'paper-ref-anchor-3',
  'paper-ref-anchor-6',
]

const COMMON_CONSTRAINTS = [
  '【故事】独居女主深夜想用水敷衍晚饭，异常黄色便利贴阻止她，恐怖对抗最终反转为母亲留下的关心。',
  '【画面统一】9:16竖屏，720p，当代中国普通小公寓厨房，4300K中性实用灯，低饱和、自然肤色、真实皮肤与纸张纤维，不使用奇幻光效。',
  '【动作下限】这是真实叙事视频，不是照片动效。每镜必须具有动作起势、执行过程、接触受力和可见结果；人物和道具数量守恒。',
  '【纸人比例】纸人完全站立时高度固定为12到15厘米，只由一张黄色便利贴折成；不得长到垃圾桶高度、儿童高度或真人比例。',
  '【文字策略】不要生成关键中文文字；黄色便签正面保留稳定、无遮挡的书写区域，文字由后期叠加。',
  '【禁止】静态图片轻微运动、人物变脸、手指畸形、穿模、额外肢体、道具复制或瞬移、纸人变成肉质生物、纸人长五官、油画感、青橙调色、HDR、重颗粒、字幕、水印和乱码。',
].join('\n')

const PLANS = [
  {
    key: 'r1',
    index: 1,
    title: '强钩子与抓腕',
    duration: 12,
    refs: ['paper-shot-01-image', 'paper-shot-03-image', ...CARD_IDS],
    prompt: [
      '【任务】12秒，3个镜头，前2秒必须出现异常。',
      '【0.0-2.0秒】黄色便利贴微距。没有风，纸边突然折起，折痕快速形成细长纸指；便签正面保留干净书写区。冰箱低频嗡鸣突然停止。',
      '【2.0-7.0秒】动作点硬切到冰箱内部24mm广角。纸指猛然缠住女主右腕并收紧，女主被拉向冰箱，透明水瓶脱手、落地、只弹一次后滚开。袖口有真实受力压痕，纸张和皮肤边界清楚。',
      '【7.0-12.0秒】手腕近景转人物近景。女主抓住门框向后挣脱，纸手仍缠在右腕；她停止动作，惊恐看向冰箱深处。尾帧稳定保留女主、纸手、半开冰箱和地面水瓶。',
      '【声音】纸纤维突然绷紧、水瓶落地与冰箱嗡鸣承担转场；不生成字幕。',
    ].join('\n'),
  },
  {
    key: 'r2',
    index: 2,
    title: '撕掉纸手与复活',
    duration: 10,
    refs: ['tail:r1', 'paper-shot-05-image', 'paper-shot-07-image', ...CARD_IDS],
    prompt: [
      '【任务】10秒，3个镜头。@上一段尾帧是0秒真实起点，禁止另起画面。',
      '【0.0-3.0秒】从上一段尾帧连续开始。女主左手抓住纸臂根部，完整撕开并甩进垃圾桶；纸团落到底部后静止一秒。',
      '【3.0-7.0秒】垃圾桶低机位特写。纸团先展开躯干，再折出双臂和双腿，双手抓住桶沿，重心上移，完整翻过桶沿；禁止直接瞬移到台面。',
      '【7.0-10.0秒】无脸纸人站稳后转身指向冰箱。女主后退半步，从操作台拿起金属夹子。尾帧保留纸人指向、女主持夹子和冰箱位置。',
      '【声音】撕纸声、纸团落桶声、纸纤维展开声清楚可辨；不生成字幕。',
    ].join('\n'),
  },
  {
    key: 'r3',
    index: 3,
    title: '引向冰箱与发现饭盒',
    duration: 12,
    refs: ['tail:r2', 'paper-shot-08-image', 'paper-shot-10-image', 'paper-shot-11-image', ...CARD_IDS],
    prompt: [
      '【任务】12秒，3个镜头。@上一段尾帧是0秒真实起点，严格保持人物姿态、纸人位置、空间轴和光线。',
      '【0.0-1.5秒】用纸指指向冰箱的近景做动作匹配切入，不展示纸人全身，以遮蔽上一段尾帧中错误放大的比例；纸张材质、方向和厨房光线保持连续。',
      '【1.5-4.0秒】切到同一空间轴中景。女主谨慎走向冰箱，右手握夹子；纸人以12到15厘米固定高度留在垃圾桶边，绝不瞬移。',
      '【4.0-8.0秒】侧面中景。女主左手握住冰箱把手，先试探、再用力拉开。门体旋转、身体重心和冷光变化符合真实物理。',
      '【8.0-12.0秒】冰箱内部反打。冷光照亮一个透明家常饭盒和黄色便签，女主动作停住，夹子缓慢垂下。尾帧同时看见饭盒、便签和女主反应。',
      '【声音】脚步、金属夹轻响、门封脱离与冰箱嗡鸣连续；不生成字幕。',
    ].join('\n'),
  },
  {
    key: 'r4',
    index: 4,
    title: '母亲字迹反转',
    duration: 10,
    refs: ['paper-video-group-03-dreamina-mini-tail', 'paper-shot-11-image', 'paper-shot-12-image', 'paper-shot-13-image', ...CARD_IDS.slice(0, 3)],
    prompt: [
      '【任务】10秒，3个镜头。@上一段尾帧是0秒真实起点，完成饭盒取出和情绪反转。',
      '【0.0-4.0秒】女主双手从冰箱取出饭盒，关门后把饭盒稳定放到操作台。12到15厘米高的无脸纸人始终站在饭盒旁，不爬到女主身体上。',
      '【4.0-7.0秒】饭盒俯拍特写。女主揭开黄色便签，便签正面朝向镜头并稳定停留两秒，保留干净书写区域，禁止生成乱码。',
      '【7.0-10.0秒】女主侧脸近景。她确认熟悉的字迹，警惕逐渐变成难以置信，眼眶微红，轻声说“妈……”。表演克制，不哭喊。尾帧保持手持便签、饭盒和纸人在同一空间。',
      '【声音】冰箱门、饭盒落台、轻微纸声和克制对白；不生成字幕。',
    ].join('\n'),
  },
  {
    key: 'r5',
    index: 5,
    title: '热饭吃饭与诡异余味',
    duration: 15,
    refs: ['tail:r4', 'paper-shot-15-image', 'paper-shot-17-image', 'paper-shot-19-image', 'paper-shot-20-image', ...CARD_IDS.slice(0, 3)],
    prompt: [
      '【任务】15秒，3个镜头。@上一段尾帧是0秒真实起点，完成热饭、第一口饭和悬疑回勾。',
      '【0.0-5.0秒】女主拿起饭盒，打开微波炉、把饭盒放稳、关门、按下启动键。纸人站在操作台监督，不站肩膀，动作不可跳步。',
      '【5.0-10.0秒】动作点硬切到餐桌侧面。女主揭盖、夹起一口饭、轻吹后吃下，肩膀逐渐放松。家常饭菜真实不过度精致，纸人站在饭盒旁等待。',
      '【10.0-15.0秒】女主准备放下筷子，纸人折出一根细纸指，接触筷子中段并缓慢推回她手中。她无奈轻声说“知道了”，继续吃饭。背景冰箱门缝一小角黄纸悄悄缩回，最后稳定停留一秒。',
      '【声音】微波炉门、按键提示、筷子与饭盒轻响、细微纸声和冰箱嗡鸣自然连续；不生成字幕。',
    ].join('\n'),
  },
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

function resultUrl(node) {
  return String(node?.result?.url || node?.history?.at(-1)?.url || '').trim()
}

function nodeId(key) {
  return `paper-suspense-repair-${key}-dreamina-mini`
}

function tailNodeId(key) {
  return `${nodeId(key)}-tail`
}

function mention(url) {
  return `@[asset:${encodeURIComponent(url)}]`
}

function localAssetPath(projectRoot, url) {
  if (!url.startsWith(ASSET_PREFIX)) die(`不是当前项目资产：${url}`)
  const file = path.join(projectRoot, decodeURIComponent(url.slice(ASSET_PREFIX.length)))
  if (!existsSync(file)) die(`参考资产不存在：${file}`)
  return file
}

function referenceRole(id) {
  if (id === 'paper-ref-anchor-1') return '唯一女主的身份、脸型、发型、燕麦色毛衣和深灰长裤；只锁身份与服装，不锁动作。'
  if (id === 'paper-ref-anchor-2') return '同一夜晚厨房的结构、材质、固定参照物和4300K中性光线。'
  if (id === 'paper-ref-anchor-3') return '米白旧冰箱的造型、尺度、门体和真实使用痕迹。'
  if (id === 'paper-ref-anchor-6') return '浅黄色便利贴的纸张纤维、折痕与无脸折纸形态；不得变成普通卡通角色。'
  if (id.startsWith('paper-shot-')) return `${id.replace('paper-shot-', '分镜').replace('-image', '')}只参考机位、空间关系和动作目的，不锁成静态首帧。`
  return '上一段修复视频的真实尾帧；本段从该帧作为0秒起点，延续构图、人物姿态、道具状态、空间轴和光线。'
}

function resolveReferences(plan, nodesById) {
  const refs = plan.refs.map((spec) => {
    const id = spec.startsWith('tail:') ? tailNodeId(spec.slice(5)) : spec
    const node = nodesById.get(id)
    const url = resultUrl(node)
    if (!url) die(`${plan.key.toUpperCase()} 缺少参考资产：${id}`)
    return { nodeId: id, url, role: referenceRole(id) }
  })
  if (refs.length > 9) die(`${plan.key.toUpperCase()} 参考图 ${refs.length} 张，超过 Seedance 2.0 mini 上限9张`)
  return refs
}

function buildPrompt(plan, refs) {
  return [
    '【全能参考绑定｜每张图用途唯一】',
    ...refs.map((ref) => `${mention(ref.url)}：${ref.role}`),
    COMMON_CONSTRAINTS,
    plan.prompt,
  ].join('\n')
}

function upsertNode(nodes, next) {
  const index = nodes.findIndex((node) => node.id === next.id)
  if (index >= 0) {
    if (nodes[index].status === 'success' && nodes[index].result) return nodes[index]
    if (nodes[index].status === 'error' && Number(nodes[index].meta?.manualResubmissionCount || 0) >= 1) return nodes[index]
    nodes[index] = next
  } else {
    nodes.push(next)
  }
  return next
}

function upsertEdge(edges, source, target) {
  const id = `edge-${source}-${target}-repair_ref`
  const next = { id, source, target, mode: 'composition_ref', order: 0 }
  const index = edges.findIndex((edge) => edge.id === id)
  if (index >= 0) edges[index] = next
  else edges.push(next)
}

function prepare(projectRoot, project) {
  const canvas = project.payload.generationCanvas
  const nodesById = new Map(canvas.nodes.map((node) => [node.id, node]))
  const prepared = []
  for (const plan of PLANS) {
    if (plan.refs.some((ref) => ref.startsWith('tail:')) && !nodesById.has(tailNodeId(plan.refs.find((ref) => ref.startsWith('tail:')).slice(5)))) {
      continue
    }
    const refs = resolveReferences(plan, nodesById)
    const next = {
      id: nodeId(plan.key),
      kind: 'video',
      renderKind: 'shot-frame',
      title: `修复 ${plan.key.toUpperCase()}｜${plan.title}｜${plan.duration}s｜即梦 Mini 全能参考`,
      position: { x: 4800, y: 260 + (plan.index - 1) * 620 },
      size: { width: 560, height: 560 },
      prompt: buildPrompt(plan, refs),
      references: [],
      history: [],
      runs: [],
      status: 'idle',
      categoryId: 'shots',
      meta: {
        modelKey: 'dreamina-seedance-2.0',
        modelAlias: 'dreamina-seedance-2.0',
        videoModel: 'dreamina-seedance-2.0',
        modelLabel: '即梦 Seedance 2.0（会员）',
        modelVendor: 'dreamina',
        vendor: 'dreamina',
        videoModelVendor: 'dreamina',
        archetype: { id: 'dreamina-seedance-2', modeId: 'multimodal', variantId: 'mini' },
        duration: plan.duration,
        durationSeconds: plan.duration,
        videoDuration: plan.duration,
        ratio: '9:16',
        video_resolution: '720p',
        storyboardVideoReferenceStrategy: 'full_reference',
        repairVersion: 2,
        repairKey: plan.key,
        referenceImageUrls: refs.map((ref) => ref.url),
        referenceNodeIds: refs.map((ref) => ref.nodeId),
        referenceRoles: refs.map((ref) => ref.role),
        referenceCapacity: 9,
        generationCount: 1,
        submissionRetryCount: 0,
        directDreaminaCli: true,
        previewHeight: 560,
      },
    }
    const actual = upsertNode(canvas.nodes, next)
    nodesById.set(actual.id, actual)
    upsertEdge(canvas.edges, refs[0].nodeId, actual.id)
    prepared.push({ key: plan.key, id: actual.id, duration: plan.duration, references: refs.length })
  }
  project.revision = Number(project.revision || 0) + 1
  project.updatedAt = Date.now()
  project.savedAt = Date.now()
  const planFile = path.join(projectRoot, 'assets', 'final', '2026-08-07', 'repair-v2', 'repair-plan-v2.json')
  mkdirSync(path.dirname(planFile), { recursive: true })
  writeJson(planFile, { version: 2, projectId: PROJECT_ID, modelVersion: 'seedance2.0mini', concurrency: 1, autoRetry: false, plans: PLANS })
  return prepared
}

function balancedJsonEnd(text, start) {
  const stack = []
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') {
      stack.pop()
      if (!stack.length) return index
    }
  }
  return -1
}

function extractJsonValues(text) {
  const source = String(text || '').trim()
  if (!source) return []
  try { return [JSON.parse(source)] } catch { /* mixed output */ }
  const values = []
  for (let index = 0; index < source.length; index += 1) {
    if (!['{', '['].includes(source[index])) continue
    const end = balancedJsonEnd(source, index)
    if (end < 0) continue
    try {
      values.push(JSON.parse(source.slice(index, end + 1)))
      index = end
    } catch { /* keep scanning */ }
  }
  return values
}

function collectObjects(value, output = []) {
  if (!value || typeof value !== 'object') return output
  output.push(value)
  if (Array.isArray(value)) value.forEach((item) => collectObjects(item, output))
  else Object.values(value).forEach((item) => collectObjects(item, output))
  return output
}

function parseDreaminaOutput(stdout, stderr) {
  const objects = extractJsonValues(`${stdout}\n${stderr}`).flatMap((value) => collectObjects(value))
  const first = (keys) => {
    for (const object of objects) {
      for (const key of keys) {
        if (typeof object?.[key] === 'string' && object[key].trim()) return object[key].trim()
      }
    }
    return ''
  }
  return {
    submitId: first(['submit_id', 'task_id']),
    status: first(['gen_status', 'status']).toLowerCase(),
    failReason: first(['fail_reason', 'error_message', 'message']),
    videoUrl: first(['video_url']),
  }
}

async function runCli(args, timeout = 180_000, bin = DREAMINA) {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return {
      code: Number.isInteger(error?.code) ? error.code : 1,
      stdout: String(error?.stdout || ''),
      stderr: String(error?.stderr || error?.message || ''),
    }
  }
}

function latestVideo(directory) {
  if (!existsSync(directory)) return ''
  return readdirSync(directory)
    .map((name) => path.join(directory, name))
    .filter((file) => statSync(file).isFile() && /\.(mp4|mov|webm)$/i.test(file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || ''
}

function isDecodableVideo(file) {
  if (!file || !existsSync(file) || statSync(file).size === 0) return false
  const decoded = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-map', '0:v:0', '-f', 'null', '-',
  ], { encoding: 'utf8' })
  return decoded.status === 0
}

async function recoverDownload(videoUrl, outputDir, submitId) {
  if (!videoUrl) return ''
  const output = path.join(outputDir, `${submitId}_video_1_full.mp4`)
  process.stdout.write(`[download] provider file incomplete; downloading accepted task result once without resubmission\n`)
  const downloaded = await runCli([
    '--noproxy', '*', '-L', '--fail', '--connect-timeout', '20', '--max-time', '600',
    '--retry', '0', '--output', output, videoUrl,
  ], 660_000, '/usr/bin/curl')
  if (downloaded.code !== 0 || !isDecodableVideo(output)) return ''
  return output
}

function compilePrompt(prompt, urls) {
  const compiled = prompt.replace(/@\[asset:([^\]]+)\]/g, (_match, encoded) => {
    const url = decodeURIComponent(encoded)
    const index = urls.indexOf(url)
    if (index < 0) die(`提示词引用未上传：${url}`)
    return `@image${index + 1}`
  })
  urls.forEach((_url, index) => {
    if (!compiled.includes(`@image${index + 1}`)) die(`提示词缺少 @image${index + 1} 用途标注`)
  })
  return compiled
}

function probeVideo(file) {
  const probed = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration,codec_name:format=duration',
    '-of', 'json', file,
  ], { encoding: 'utf8' })
  if (probed.status !== 0) die(`ffprobe失败：${probed.stderr || probed.stdout}`)
  const parsed = JSON.parse(probed.stdout)
  const stream = parsed.streams?.[0]
  return {
    width: Number(stream?.width || 0),
    height: Number(stream?.height || 0),
    durationSeconds: Number(stream?.duration || parsed.format?.duration || 0),
    codec: String(stream?.codec_name || ''),
  }
}

function importResult(projectRoot, project, plan, videoPath, submitId) {
  const node = project.payload.generationCanvas.nodes.find((candidate) => candidate.id === nodeId(plan.key))
  if (!node) die(`缺少节点：${nodeId(plan.key)}`)
  const probe = probeVideo(videoPath)
  const relative = path.relative(projectRoot, videoPath).split(path.sep).join('/')
  if (relative.startsWith('../')) die('生成视频必须保存在项目目录内')
  const url = `${ASSET_PREFIX}${relative}`
  const now = Date.now()
  const result = {
    id: `dreamina-${submitId}`,
    type: 'video',
    url,
    model: 'seedance2.0mini',
    durationSeconds: probe.durationSeconds,
    taskId: submitId,
    taskKind: 'video',
    createdAt: now,
    raw: { dreamina: { command: 'multimodal2video', modelVersion: 'seedance2.0mini', submitId, importedFromOfficialCli: true } },
    provenance: {
      timestamp: now,
      provider: 'dreamina',
      modelKey: 'dreamina-seedance-2.0',
      prompt: node.prompt,
      params: { extras: { projectId: PROJECT_ID, ratio: '9:16', video_resolution: '720p', duration: plan.duration, variantId: 'mini', modeId: 'multimodal', referenceImageUrls: node.meta.referenceImageUrls, submissionRetryCount: 0 } },
      vendorRequestId: submitId,
    },
  }
  node.result = result
  node.history = [result]
  node.status = 'success'
  node.error = undefined
  Object.assign(node.meta, {
    videoWidth: probe.width,
    videoHeight: probe.height,
    videoDuration: probe.durationSeconds,
    videoAspectRatio: probe.height ? probe.width / probe.height : 0,
    dreaminaSubmitId: submitId,
    submissionRetryCount: 0,
  })

  if (plan.key !== 'r5') {
    const tailRelative = `assets/final/2026-08-07/repair-v2/tail-refs/${plan.key}-tail.png`
    const tailPath = path.join(projectRoot, tailRelative)
    mkdirSync(path.dirname(tailPath), { recursive: true })
    const extracted = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-0.25', '-i', videoPath, '-frames:v', '1', '-update', '1', tailPath], { encoding: 'utf8' })
    if (extracted.status !== 0 || !existsSync(tailPath) || statSync(tailPath).size === 0) die(`尾帧抽取失败：${extracted.stderr || extracted.stdout}`)
    const tailUrl = `${ASSET_PREFIX}${tailRelative}`
    const tailNode = {
      id: tailNodeId(plan.key),
      kind: 'image',
      renderKind: 'shot-frame',
      title: `修复 ${plan.key.toUpperCase()}｜真实尾帧`,
      position: { x: 5420, y: 390 + (plan.index - 1) * 620 },
      size: { width: 260, height: 360 },
      prompt: `从修复节点 ${plan.key.toUpperCase()} 成片尾部抽取，作为下一段0秒连续性起点。`,
      references: [node.id],
      history: [],
      runs: [],
      status: 'success',
      categoryId: 'shots',
      derivedFrom: node.id,
      meta: { referenceSheet: true, preservedReference: true, tailFrameReference: true, sourceVideoNodeId: node.id, sourceVideoSubmitId: submitId, aspect_ratio: '9:16', repairVersion: 2 },
      result: {
        id: `${tailNodeId(plan.key)}-result`,
        type: 'image',
        url: tailUrl,
        thumbnailUrl: tailUrl,
        model: 'ffmpeg-tail-extraction',
        taskId: `${submitId}-tail`,
        taskKind: 'image',
        createdAt: now,
        raw: { sourceVideo: url, seekFromEndSeconds: 0.25 },
        provenance: { timestamp: now, provider: 'local-ffmpeg', modelKey: 'tail-frame-extraction', prompt: `Extract ${plan.key} tail`, params: { extras: { projectId: PROJECT_ID, sourceVideoNodeId: node.id } }, vendorRequestId: `${submitId}-tail` },
      },
    }
    upsertNode(project.payload.generationCanvas.nodes, tailNode)
    upsertEdge(project.payload.generationCanvas.edges, node.id, tailNode.id)
  }
  project.revision = Number(project.revision || 0) + 1
  project.updatedAt = now
  project.savedAt = now
  return { nodeId: node.id, url, ...probe }
}

async function generate(projectRoot, projectFile, project, key) {
  const plan = PLANS.find((candidate) => candidate.key === key)
  if (!plan) die(`未知修复节点：${key}`)
  const node = project.payload.generationCanvas.nodes.find((candidate) => candidate.id === nodeId(key))
  if (!node) die(`请先prepare：${nodeId(key)}`)
  if (node.status === 'success' && node.result?.url) return { reused: true, key, videoPath: localAssetPath(projectRoot, node.result.url) }
  const urls = node.meta.referenceImageUrls.map(String)
  const imagePaths = urls.map((url) => localAssetPath(projectRoot, url))
  const prompt = compilePrompt(node.prompt, urls)
  const workDir = path.join(projectRoot, 'assets', 'final', '2026-08-07', 'repair-v2')
  const outputDir = path.join(workDir, 'generated', key)
  const ledgerFile = path.join(workDir, 'generation-ledger-v2.json')
  mkdirSync(outputDir, { recursive: true })
  const ledger = existsSync(ledgerFile) ? readJson(ledgerFile) : { version: 2, projectId: PROJECT_ID, concurrency: 1, autoRetry: false, tasks: {} }
  let entry = ledger.tasks[key]
  if (!entry) {
    entry = { key, nodeId: node.id, state: 'submitting', duration: plan.duration, references: urls.length, modelVersion: 'seedance2.0mini', submissionRetryCount: 0, startedAt: Date.now() }
    entry.manualResubmissionCount = Number(ledger.retryAuthorizations?.[key]?.usedCount || 0)
    ledger.tasks[key] = entry
    writeJson(ledgerFile, ledger)
    const args = [
      'multimodal2video',
      ...imagePaths.map((file) => `--image=${file}`),
      `--prompt=${prompt}`,
      `--duration=${plan.duration}`,
      '--ratio=9:16',
      '--video_resolution=720p',
      '--model_version=seedance2.0mini',
      '--poll=30',
    ]
    process.stdout.write(`[${key}] submit once: duration=${plan.duration}s refs=${urls.length} promptChars=${prompt.length}\n`)
    const submitted = await runCli(args)
    const parsed = parseDreaminaOutput(submitted.stdout, submitted.stderr)
    if (!parsed.submitId) {
      entry.state = 'submit-response-unknown'
      entry.failedAt = Date.now()
      entry.error = parsed.failReason || `dreamina exit ${submitted.code}`
      writeJson(ledgerFile, ledger)
      node.status = 'error'
      node.error = entry.error
      node.meta.submissionRetryCount = 0
      writeJson(projectFile, project)
      die(`${key} 未取得submit_id；为避免重复扣积分已停止且不会重提：${entry.error}`)
    }
    entry.submitId = parsed.submitId
    entry.state = parsed.status || 'querying'
    entry.acceptedAt = Date.now()
    writeJson(ledgerFile, ledger)
  } else if (!entry.submitId) {
    die(`${key} 存在未知提交状态；为避免重复扣积分，拒绝自动重提`)
  }

  process.stdout.write(`[${key}] accepted submitId=${entry.submitId}; polling only\n`)
  const deadline = Date.now() + 35 * 60_000
  while (Date.now() < deadline) {
    const queried = await runCli(['query_result', `--submit_id=${entry.submitId}`, `--download_dir=${outputDir}`])
    const parsed = parseDreaminaOutput(queried.stdout, queried.stderr)
    let videoPath = latestVideo(outputDir)
    if (videoPath && !isDecodableVideo(videoPath)) videoPath = ''
    if (!videoPath && ['success', 'completed', 'succeeded'].includes(parsed.status) && parsed.videoUrl) {
      videoPath = await recoverDownload(parsed.videoUrl, outputDir, entry.submitId)
    }
    if (videoPath && ['success', 'completed', 'succeeded', ''].includes(parsed.status)) {
      entry.state = 'success'
      entry.completedAt = Date.now()
      entry.videoPath = videoPath
      writeJson(ledgerFile, ledger)
      const imported = importResult(projectRoot, project, plan, videoPath, entry.submitId)
      writeJson(projectFile, project)
      return { key, submitId: entry.submitId, videoPath, imported }
    }
    if (['fail', 'failed', 'error'].includes(parsed.status)) {
      entry.state = 'failed'
      entry.failedAt = Date.now()
      entry.error = parsed.failReason || 'Dreamina generation failed'
      writeJson(ledgerFile, ledger)
      node.status = 'error'
      node.error = entry.error
      node.meta.dreaminaSubmitId = entry.submitId
      node.meta.submissionRetryCount = 0
      writeJson(projectFile, project)
      die(`${key} 生成失败；不会自动重提：${entry.error}`)
    }
    entry.state = parsed.status || 'querying'
    entry.lastPolledAt = Date.now()
    writeJson(ledgerFile, ledger)
    await new Promise((resolve) => setTimeout(resolve, 20_000))
  }
  die(`${key} 超过35分钟仍未完成；任务已受理，只停止轮询，不会重提`)
}

function authorizeSingleRetry(projectRoot, projectFile, project, key) {
  const workDir = path.join(projectRoot, 'assets', 'final', '2026-08-07', 'repair-v2')
  const ledgerFile = path.join(workDir, 'generation-ledger-v2.json')
  const ledger = readJson(ledgerFile)
  const previous = ledger.tasks?.[key]
  if (!previous || previous.state !== 'failed' || !previous.submitId) {
    die(`${key} 不存在可人工重提的终态失败任务`)
  }
  ledger.retryAuthorizations ||= {}
  if (Number(ledger.retryAuthorizations[key]?.usedCount || 0) >= 1) {
    die(`${key} 的一次性人工重提授权已经使用，拒绝再次提交`)
  }
  ledger.attemptHistory ||= {}
  ledger.attemptHistory[key] ||= []
  ledger.attemptHistory[key].push({ ...previous, archivedAt: Date.now() })
  ledger.retryAuthorizations[key] = {
    userApproved: true,
    approvedAt: Date.now(),
    maxCount: 1,
    usedCount: 1,
    reason: 'reference upload token timeout before generation; no credit charged',
  }
  delete ledger.tasks[key]
  writeJson(ledgerFile, ledger)

  const node = project.payload.generationCanvas.nodes.find((candidate) => candidate.id === nodeId(key))
  if (!node) die(`缺少节点：${nodeId(key)}`)
  node.status = 'idle'
  node.error = undefined
  node.meta.previousFailedSubmitIds = [...new Set([...(node.meta.previousFailedSubmitIds || []), previous.submitId])]
  node.meta.manualResubmissionCount = 1
  node.meta.submissionRetryCount = 0
  project.revision = Number(project.revision || 0) + 1
  project.updatedAt = Date.now()
  project.savedAt = Date.now()
  writeJson(projectFile, project)
  return { key, previousSubmitId: previous.submitId, authorizedCount: 1 }
}

function preflight(projectRoot, project, key) {
  const plan = PLANS.find((candidate) => candidate.key === key)
  if (!plan) die(`未知修复节点：${key}`)
  const node = project.payload.generationCanvas.nodes.find((candidate) => candidate.id === nodeId(key))
  if (!node) die(`请先prepare：${nodeId(key)}`)
  const urls = node.meta.referenceImageUrls.map(String)
  const files = urls.map((url) => localAssetPath(projectRoot, url))
  const prompt = compilePrompt(node.prompt, urls)
  return {
    key,
    nodeId: node.id,
    duration: plan.duration,
    ratio: '9:16',
    resolution: '720p',
    modelVersion: 'seedance2.0mini',
    references: files.length,
    promptChars: prompt.length,
    allFilesExist: files.every((file) => existsSync(file)),
    allReferencesMentioned: urls.every((_url, index) => prompt.includes(`@image${index + 1}`)),
  }
}

const [command, projectRootRaw, keyRaw] = process.argv.slice(2)
if (!command || !projectRootRaw) die('用法：paper-suspense-repair-v2.mjs <prepare|preflight|generate|retry-generate> <projectRoot> [r1-r5]')
if (!existsSync(DREAMINA)) die(`未安装即梦CLI：${DREAMINA}`)
const projectRoot = path.resolve(projectRootRaw)
const projectFile = path.join(projectRoot, '.nomi', 'project.json')
const project = readJson(projectFile)
if (project.id !== PROJECT_ID) die(`项目ID不匹配：${project.id}`)

if (command === 'prepare') {
  const backupDir = path.join(projectRoot, '.nomi', 'backups')
  mkdirSync(backupDir, { recursive: true })
  const backup = path.join(backupDir, `project.before-repair-v2-${Date.now()}.json`)
  copyFileSync(projectFile, backup)
  const report = prepare(projectRoot, project)
  writeJson(projectFile, project)
  process.stdout.write(`${JSON.stringify({ ok: true, command, backup, report }, null, 2)}\n`)
} else if (command === 'generate') {
  const key = String(keyRaw || '').toLowerCase()
  const report = await generate(projectRoot, projectFile, project, key)
  process.stdout.write(`${JSON.stringify({ ok: true, command, report }, null, 2)}\n`)
} else if (command === 'preflight') {
  const key = String(keyRaw || '').toLowerCase()
  const report = preflight(projectRoot, project, key)
  process.stdout.write(`${JSON.stringify({ ok: true, command, report }, null, 2)}\n`)
} else if (command === 'retry-generate') {
  const key = String(keyRaw || '').toLowerCase()
  const authorization = authorizeSingleRetry(projectRoot, projectFile, project, key)
  const report = await generate(projectRoot, projectFile, project, key)
  process.stdout.write(`${JSON.stringify({ ok: true, command, authorization, report }, null, 2)}\n`)
} else {
  die(`未知命令：${command}`)
}
