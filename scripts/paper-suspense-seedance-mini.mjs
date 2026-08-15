#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const PROJECT_ID = 'workspace-8fc380eb-098e-450b-b57d-138ac8f758f9'
const GROUPS_REQUIRING_TAIL = new Set([2, 4, 6])
const REFERENCE_CARD_IDS = [
  'paper-ref-anchor-1',
  'paper-ref-anchor-2',
  'paper-ref-anchor-3',
  'paper-ref-anchor-6',
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

function mention(url) {
  return `@[asset:${encodeURIComponent(url)}]`
}

function resultUrl(node) {
  return String(node?.result?.url || node?.history?.at(-1)?.url || '').trim()
}

function nodeIdForGroup(index) {
  return `paper-video-group-${String(index).padStart(2, '0')}-dreamina-mini`
}

function tailNodeIdForGroup(index) {
  return `${nodeIdForGroup(index)}-tail`
}

function commonBible() {
  return [
    '【故事】《别忘了吃饭·纸条悬疑版》：独居的年轻女主深夜疲惫回家，想用水敷衍晚饭；一张写着“好好吃饭”的黄色便利贴以真实折纸形态阻止她，恐怖对抗逐步反转为母亲留下的关心，结尾保留纸条仍在监督她的轻微诡异余味。',
    '【整体目标】把故事执行成具有强烈电影感、叙事感、制作感和真实空间感的9:16竖屏短片。每个15秒视频组包含3到4个功能明确的镜头，动作有起势、过程和可见结果；避免复制粘贴式场景、相同构图和“静态图片轻微运动”。',
    '【顶部共享创意指导方针】',
    '整体主题：都市独居、母亲的关心、强制性的照料、纸张超自然。',
    '情绪基调：惊吓与恐怖起势，经过反抗、怀疑和误解，反转为克制温暖，最后留下诡异余味。',
    '世界观风格：当代中国普通小公寓厨房；写实纪录片质感与克制的类型片调度，不做奇幻光效。',
    '镜头哲学：动作因果优先，保持180度空间轴与人物/道具守恒；广角、中焦、长焦、特写、微距按叙事功能切换；静态、跟拍、手持、推镜、拉镜、轻微环绕按段落使用，单镜最多双轴。',
    '色调原则：中性4300K、低饱和、自然肤色，禁止青橙对撞和蓝紫霓虹。',
    '光线原则：厨房实用灯与冰箱内部灯是唯一主要光源，方向、光质、明暗关系连续，光影必须随人物动作、门体开合和镜头位移发生合理变化。',
    '叙事节奏：开篇0.6秒内出现最强视觉钩子；中段推进冲突；后段完成情绪反转或爆发；尾帧稳定留下可承接的余味。',
    '禁止事项：油画、插画、卡通宠物化、纸条五官、肉质触手、星球或银河、HDR、重颗粒、磨皮、过度运动模糊、海报构图、无目的环绕、额外人物或肢体、道具复制/瞬移、穿模、背景呼吸、字幕、水印和无关文字。',
    '【总体限制条件】场景数量限制为1个连续厨房场景；地点数量限制为1个住宅；仅使用冰箱、操作台/垃圾桶、微波炉、餐桌4个功能区；主色数量限制为4到6个。',
    '【色板与背景设计】暖灰白用于墙面和冰箱主体；便利贴浅黄用于唯一异常视觉焦点；燕麦米色用于女主毛衣；中性深灰用于长裤和阴影；低饱和钢灰/灰绿用于台面与电器。背景必须保持同一厨房尺寸、门窗、台面、垃圾桶、微波炉和餐桌的相对位置。',
    '【镜头、光线与衔接】每个镜头与上一镜承担不同功能，使用动作点、视线、声桥或匹配构图衔接；不能平均用力，不能每帧都稳、都亮、都远、都同构图。光斑、冰箱冷光与阴影只随真实光源和运镜移动。',
    '【关键词】写实悬疑、都市孤独、纸张超自然、母女关心、生活质感、克制惊吓、真实皮肤、物理连续。',
    '【声音与空间氛围】冰箱低频嗡鸣、纸纤维摩擦、塑料水瓶落地、脚步与呼吸构成空间声；音乐使用低频持续音和克制脉冲，不用煽情大编制。声音必须承担剪辑桥与情绪转折。',
    '【动作、后期与寓意】动作由明确受力、重心转移、接触和结果构成；后期只允许轻微自然胶片颗粒、真实运动模糊、中等对比度和统一中性色偏。主题寓意是“关心有时令人抗拒，但真正的危险是长期忽视自己”。',
    '【视觉节奏要求】开篇建立危险气氛，中段推进人物与纸条的冲突，后段完成母亲字迹的情绪反转，结尾让纸条监督吃饭留下余味。每段镜头强弱、距离、机位和动作结果必须不同。',
    '【设计风格要求】电影感、专业感、叙事清晰、信息密度高、视觉统一，达到可用于真实拍摄筹备的导演手册标准。',
    '【输出执行边界】以上是共享“前期视觉圣经”，只用于约束生成；最终输出必须是一条干净、连续、可播放的9:16叙事视频。严禁把标题、网格、分区、色板、中文说明或导演手册版式画进视频。',
  ].join('\n')
}

function timelineSections(group) {
  const sections = (group.promptSections || []).filter((section) => {
    const text = String(section || '')
    return text && !text.includes('AGNES') && !text.startsWith('【连续性标注')
  })
  return sections.join('\n')
}

function buildPrompt(group, references, tailUrl) {
  const referenceLines = references.map((ref) => `${mention(ref.url)}：${ref.role}`)
  const continuity = tailUrl
    ? `【连续性标注｜必须执行】${mention(tailUrl)} 是上一组新 Seedance 成片的真实尾帧。本组0秒必须从该帧的构图、人物姿态、道具状态、空间轴和光线连续发展；它是承接起点，但其余分镜图仍只用于各自时段的机位与动作目的。不得另起画面，不得回退使用旧供应商成片。`
    : '【连续性标注】本组是有意设计的独立开场或叙事硬切，不使用上一组尾帧；仍须保持共享角色、场景和道具身份一致。'
  return [
    commonBible(),
    '【全能参考绑定｜必须执行】',
    ...referenceLines,
    '每一张上传图都必须在上方@列表中拥有唯一用途，禁止互换用途。分镜图不是像素级首帧锁定，只约束对应时段的景别、机位、空间关系和动作目的；角色、场景和道具卡不得被改造成新的主体。',
    continuity,
    '【本组15秒执行脚本】',
    timelineSections(group),
  ].join('\n')
}

function groupReferences(index, group, nodesById) {
  const refs = []
  let tailUrl = ''
  if (GROUPS_REQUIRING_TAIL.has(index)) {
    const previous = index - 1
    const tailNode = nodesById.get(tailNodeIdForGroup(previous))
    tailUrl = resultUrl(tailNode)
    if (!tailUrl) die(`视频组 ${index} 缺少视频组 ${previous} 的真实 Seedance 尾帧`)
    refs.push({
      nodeId: tailNode.id,
      url: tailUrl,
      role: '上一组新 Seedance 成片的真实尾帧；本组从这一帧作为0秒承接起点，延续人物姿态、道具状态、构图与光线。',
    })
  }
  for (const shotIndex of group.shotIndexes || []) {
    const nodeId = `paper-shot-${String(shotIndex).padStart(2, '0')}-image`
    const node = nodesById.get(nodeId)
    const url = resultUrl(node)
    if (!url) die(`缺少分镜参考图：${nodeId}`)
    refs.push({
      nodeId,
      url,
      role: `分镜${shotIndex}，只参考对应时段的景别、机位、空间关系和动作目的，不锁成静态首帧。`,
    })
  }
  const cardRoles = [
    '唯一女主身份、脸型、发型、燕麦色毛衣和深灰居家长裤；所有镜头保持一致，不锁定动作。',
    '同一夜晚厨房的空间、材质、固定参照物与中性4300K光线。',
    '老冰箱造型、尺度、米白材质和真实使用痕迹。',
    '黄色便利贴的纸张纤维、折痕、字迹和纸条精灵材质；只允许无脸折纸形态。',
  ]
  REFERENCE_CARD_IDS.forEach((nodeId, cardIndex) => {
    const node = nodesById.get(nodeId)
    const url = resultUrl(node)
    if (!url) die(`缺少参考卡：${nodeId}`)
    refs.push({ nodeId, url, role: cardRoles[cardIndex] })
  })
  if (refs.length > 9) die(`视频组 ${index} 有 ${refs.length} 张参考图，超过 Seedance 2.0 mini 上限 9`)
  return { refs, tailUrl }
}

function createVideoNode(index, group, references, tailUrl, oldNode) {
  const id = nodeIdForGroup(index)
  const oddColumn = index % 2 === 1
  const row = Math.floor((index - 1) / 2)
  return {
    id,
    kind: 'video',
    renderKind: 'shot-frame',
    title: `视频组 ${index}｜分镜 ${(group.shotIndexes || []).map((n) => String(n).padStart(2, '0')).join('-')}｜15s｜即梦 Mini 全能参考${tailUrl ? '｜真实尾帧承接' : ''}`,
    position: { x: oddColumn ? 2740 : 3420, y: 260 + row * 620 },
    size: { width: 560, height: 560 },
    prompt: buildPrompt(group, references, tailUrl),
    references: [],
    history: [],
    runs: [],
    status: 'idle',
    categoryId: oldNode?.categoryId || 'shots',
    meta: {
      modelKey: 'dreamina-seedance-2.0',
      modelAlias: 'dreamina-seedance-2.0',
      videoModel: 'dreamina-seedance-2.0',
      modelLabel: '即梦 Seedance 2.0（会员）',
      modelVendor: 'dreamina',
      vendor: 'dreamina',
      videoModelVendor: 'dreamina',
      archetype: { id: 'dreamina-seedance-2', modeId: 'multimodal', variantId: 'mini' },
      duration: 15,
      durationSeconds: 15,
      videoDuration: 15,
      ratio: '9:16',
      video_resolution: '720p',
      storyboardVideoReferenceStrategy: 'full_reference',
      storyboardAppliedParamKeys: ['ratio', 'video_resolution', 'duration'],
      videoGroup: true,
      videoGroupIndex: index,
      videoGroupTitle: group.title,
      videoGroupShotIndexes: group.shotIndexes,
      videoGroupShotDurationsSec: group.shotDurationsSec,
      continuityType: tailUrl ? 'previous_seedance_tail_as_reference_start' : group.continuity?.type,
      continuityLabel: tailUrl ? `使用视频组${index - 1}的新 Seedance 真实尾帧承接` : group.continuity?.label,
      requiresPreviousTailFrame: Boolean(tailUrl),
      ...(tailUrl ? { previousVideoGroupId: nodeIdForGroup(index - 1), tailReferenceNodeId: tailNodeIdForGroup(index - 1) } : {}),
      referenceImageUrls: references.map((ref) => ref.url),
      referenceNodeIds: references.map((ref) => ref.nodeId),
      referenceRoles: references.map((ref) => ref.role),
      referenceCapacity: 9,
      generationCount: 1,
      directDreaminaCli: true,
      previewHeight: 560,
    },
  }
}

function upsertNode(nodes, node) {
  const index = nodes.findIndex((candidate) => candidate.id === node.id)
  if (index >= 0) {
    if (nodes[index].status === 'success' && nodes[index].result) return nodes[index]
    nodes[index] = node
  } else {
    nodes.push(node)
  }
  return node
}

function upsertDependencyEdge(edges, source, target) {
  const id = `edge-${source}-${target}-composition_ref`
  const next = { id, source, target, mode: 'composition_ref', order: 0 }
  const index = edges.findIndex((edge) => edge.id === id)
  if (index >= 0) edges[index] = next
  else edges.push(next)
}

function preparePhase(project, plan, indexes) {
  const canvas = project.payload.generationCanvas
  const nodesById = new Map(canvas.nodes.map((node) => [node.id, node]))
  const prepared = []
  for (const index of indexes) {
    const group = plan.groups.find((candidate) => candidate.index === index)
    if (!group) die(`缺少视频组计划：${index}`)
    const oldNode = nodesById.get(`paper-video-group-${String(index).padStart(2, '0')}`)
    const { refs, tailUrl } = groupReferences(index, group, nodesById)
    const node = createVideoNode(index, group, refs, tailUrl, oldNode)
    const actual = upsertNode(canvas.nodes, node)
    nodesById.set(actual.id, actual)
    const source = tailUrl ? refs[0].nodeId : `paper-shot-${String(group.shotIndexes[0]).padStart(2, '0')}-image`
    upsertDependencyEdge(canvas.edges, source, actual.id)
    prepared.push({ id: actual.id, references: actual.meta.referenceImageUrls.length, promptChars: actual.prompt.length })
  }
  project.revision = Number(project.revision || 0) + 1
  project.updatedAt = Date.now()
  project.savedAt = Date.now()
  return prepared
}

function mediaProbe(videoPath) {
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v',
    '-show_entries', 'stream=index,width,height,duration,codec_name:stream_disposition=attached_pic,default:format=duration',
    '-of', 'json', videoPath,
  ], { encoding: 'utf8' })
  if (result.status !== 0) die(`ffprobe 失败：${result.stderr || result.stdout}`)
  const parsed = JSON.parse(result.stdout)
  const stream = (parsed.streams || []).find((candidate) => (
    Number(candidate.width) > 0 && Number(candidate.height) > 0 && candidate.disposition?.attached_pic !== 1
  ))
  if (!stream) die('ffprobe 没有找到可播放的视频流')
  return {
    streamIndex: Number(stream.index),
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    durationSeconds: Number(stream.duration || parsed.format?.duration || 0),
  }
}

function importResult(projectRoot, project, groupIndex, videoPath, submitId) {
  if (!existsSync(videoPath)) die(`视频文件不存在：${videoPath}`)
  const canvas = project.payload.generationCanvas
  const node = canvas.nodes.find((candidate) => candidate.id === nodeIdForGroup(groupIndex))
  if (!node) die(`尚未准备视频组 ${groupIndex} 的 Dreamina 节点`)
  const probe = mediaProbe(videoPath)
  const relative = path.relative(projectRoot, videoPath).split(path.sep).join('/')
  if (relative.startsWith('../')) die('视频必须位于 Nomi 项目目录内')
  const url = `nomi-local://asset/${PROJECT_ID}/${relative}`
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
    raw: {
      dreamina: {
        command: 'multimodal2video',
        modelVersion: 'seedance2.0mini',
        submitId,
        importedFromOfficialCli: true,
      },
    },
    provenance: {
      timestamp: now,
      provider: 'dreamina',
      modelKey: 'dreamina-seedance-2.0',
      prompt: node.prompt,
      params: {
        extras: {
          projectId: PROJECT_ID,
          ratio: '9:16',
          video_resolution: '720p',
          duration: 15,
          variantId: 'mini',
          modeId: 'multimodal',
          referenceImageUrls: node.meta.referenceImageUrls,
          submissionRetryCount: 0,
        },
      },
      vendorRequestId: submitId,
    },
  }
  node.result = result
  node.history = [result]
  node.status = 'success'
  node.error = undefined
  node.meta.videoWidth = probe.width
  node.meta.videoHeight = probe.height
  node.meta.videoDuration = probe.durationSeconds
  node.meta.videoAspectRatio = probe.height ? probe.width / probe.height : 0
  node.meta.dreaminaSubmitId = submitId
  node.meta.submissionRetryCount = 0

  if ([1, 3, 5].includes(groupIndex)) {
    const tailRelative = `assets/generated/2026-08-07/seedance-mini/tail-refs/group-${String(groupIndex).padStart(2, '0')}-tail.png`
    const tailPath = path.join(projectRoot, tailRelative)
    mkdirSync(path.dirname(tailPath), { recursive: true })
    const extraction = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-0.5', '-i', videoPath,
      '-map', `0:${probe.streamIndex}`, '-frames:v', '1', '-update', '1', tailPath,
    ], { encoding: 'utf8' })
    if (extraction.status !== 0 || !existsSync(tailPath) || statSync(tailPath).size === 0) {
      die(`尾帧抽取失败：${extraction.error?.message || extraction.stderr || extraction.stdout || '未输出图像'}`)
    }
    const tailUrl = `nomi-local://asset/${PROJECT_ID}/${tailRelative}`
    const tailId = tailNodeIdForGroup(groupIndex)
    const tailNode = {
      id: tailId,
      kind: 'image',
      renderKind: 'shot-frame',
      title: `视频组 ${groupIndex}｜新 Seedance 成片真实尾帧`,
      position: { x: 3330, y: 420 + Math.floor((groupIndex - 1) / 2) * 620 },
      size: { width: 260, height: 360 },
      prompt: `从视频组${groupIndex}的新 Seedance 2.0 mini 成片最后0.08秒抽取，用作视频组${groupIndex + 1}的连续性参考起点。`,
      references: [node.id],
      history: [],
      runs: [],
      status: 'success',
      categoryId: 'shots',
      derivedFrom: node.id,
      meta: {
        referenceSheet: true,
        preservedReference: true,
        tailFrameReference: true,
        sourceVideoNodeId: node.id,
        sourceVideoSubmitId: submitId,
        aspect_ratio: '9:16',
      },
      result: {
        id: `${tailId}-result`,
        type: 'image',
        url: tailUrl,
        thumbnailUrl: tailUrl,
        model: 'ffmpeg-tail-extraction',
        taskId: `${submitId}-tail`,
        taskKind: 'image',
        createdAt: now,
        raw: { sourceVideo: url, seekFromEndSeconds: 0.5, sourceVideoStreamIndex: probe.streamIndex },
        provenance: {
          timestamp: now,
          provider: 'local-ffmpeg',
          modelKey: 'tail-frame-extraction',
          prompt: `Extract the last frame from video group ${groupIndex}`,
          params: { extras: { projectId: PROJECT_ID, sourceVideoNodeId: node.id } },
          vendorRequestId: `${submitId}-tail`,
        },
      },
    }
    upsertNode(canvas.nodes, tailNode)
  }
  project.revision = Number(project.revision || 0) + 1
  project.updatedAt = now
  project.savedAt = now
  return { nodeId: node.id, url, ...probe }
}

function finalize(project, plan, manifest) {
  const nodesById = new Map(project.payload.generationCanvas.nodes.map((node) => [node.id, node]))
  const groups = plan.groups.map((oldGroup) => {
    const index = oldGroup.index
    const node = nodesById.get(nodeIdForGroup(index))
    if (!node?.result?.url) die(`视频组 ${index} 尚未生成成功，不能 finalize`)
    return {
      ...oldGroup,
      id: node.id,
      previousAgnesNodeId: `paper-video-group-${String(index).padStart(2, '0')}`,
      vendorKey: 'dreamina',
      modelKey: 'dreamina-seedance-2.0',
      modeId: 'multimodal',
      variantId: 'mini',
      referenceStrategy: 'full_reference',
      referenceCapacity: 9,
      referenceNodeIds: node.meta.referenceNodeIds,
      referenceImageUrls: node.meta.referenceImageUrls,
      tailReferenceNodeId: node.meta.tailReferenceNodeId || null,
      firstFrameSourceNodeId: null,
      promptSections: node.prompt.split('\n'),
      prompt: node.prompt,
      resultUrl: node.result.url,
      submitId: node.meta.dreaminaSubmitId,
    }
  })
  plan.version = 3
  plan.format = {
    ...plan.format,
    vendorKey: 'dreamina',
    modelKey: 'dreamina-seedance-2.0',
    modelVersion: 'seedance2.0mini',
    modeId: 'multimodal',
    variantId: 'mini',
    referenceCapacity: 9,
    referenceStrategy: 'full_reference',
    aspectRatio: '9:16',
    resolution: '720p',
    durationPerGroupSec: 15,
    submissionRetryCount: 0,
  }
  plan.groups = groups

  manifest.videoPlanVersion = 3
  manifest.videoProvider = {
    vendorKey: 'dreamina',
    modelKey: 'dreamina-seedance-2.0',
    modelVersion: 'seedance2.0mini',
    modeId: 'multimodal',
    variantId: 'mini',
    aspectRatio: '9:16',
    resolution: '720p',
    durationSec: 15,
    referenceCapacity: 9,
    referenceStrategy: 'full_reference',
    submissionRetryCount: 0,
  }
  manifest.videoGroups = groups

  const groupForShot = (shotIndex) => groups.find((group) => group.shotIndexes.includes(shotIndex))
  const updateShot = (shot) => {
    const group = groupForShot(shot.index)
    if (!group) return shot
    const first = group.shotIndexes[0] === shot.index
    shot.videoNodeId = group.id
    shot.videoPrompt = first
      ? group.prompt
      : `本镜头属于“视频组${group.index}｜${group.title}”的 Seedance 2.0 mini 全能参考15秒成片，已在节点 ${group.id} 中按时间段统一生成；不要单独重复提交。`
    shot.modelKey = 'dreamina-seedance-2.0'
    shot.modeId = 'multimodal'
    shot.variantId = 'mini'
    shot.params = { ratio: '9:16', video_resolution: '720p', duration: 15, generation_count: 1 }
    return shot
  }
  manifest.shots = (manifest.shots || []).map(updateShot)
  if (project.payload.storyboardPlan?.shots) project.payload.storyboardPlan.shots = project.payload.storyboardPlan.shots.map(updateShot)
  project.revision = Number(project.revision || 0) + 1
  project.updatedAt = Date.now()
  project.savedAt = Date.now()
  return { groups: groups.length, shots: manifest.shots.length }
}

const [command, projectRootArg, ...args] = process.argv.slice(2)
if (!command || !projectRootArg) {
  die('用法：paper-suspense-seedance-mini.mjs <prepare-odd|prepare-even|import|finalize> <projectRoot> [...]')
}

const projectRoot = path.resolve(projectRootArg)
const projectFile = path.join(projectRoot, '.nomi', 'project.json')
const packageDir = path.join(projectRoot, 'assets', 'suspense-storyboard-2026-08-07')
const planFile = path.join(packageDir, 'video-group-plan.json')
const manifestFile = path.join(packageDir, 'storyboard-manifest.json')
const project = readJson(projectFile)
const plan = readJson(planFile)
if (project.id !== PROJECT_ID) die(`项目 ID 不匹配：${project.id}`)

let report
if (command === 'prepare-odd') {
  report = preparePhase(project, plan, [1, 3, 5])
  writeJson(projectFile, project)
} else if (command === 'prepare-even') {
  report = preparePhase(project, plan, [2, 4, 6])
  writeJson(projectFile, project)
} else if (command === 'import') {
  const [groupRaw, videoPathRaw, submitId] = args
  const groupIndex = Number(groupRaw)
  if (!Number.isInteger(groupIndex) || !videoPathRaw || !submitId) die('import 需要 groupIndex、videoPath、submitId')
  report = importResult(projectRoot, project, groupIndex, path.resolve(videoPathRaw), submitId)
  writeJson(projectFile, project)
} else if (command === 'finalize') {
  const manifest = readJson(manifestFile)
  report = finalize(project, plan, manifest)
  writeJson(projectFile, project)
  writeJson(planFile, plan)
  writeJson(manifestFile, manifest)
} else {
  die(`未知命令：${command}`)
}

process.stdout.write(`${JSON.stringify({ ok: true, command, report }, null, 2)}\n`)
