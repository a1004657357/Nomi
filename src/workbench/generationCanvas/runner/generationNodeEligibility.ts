import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { resolveGenerationReferences } from './generationReferenceResolver'
import { currentArchetypeMode, hasAnyArchetypeReference } from '../nodes/controls/archetypeMeta'
import { nodeUnmetReferenceDependency, type UnmetReferenceDependency } from '../nodes/controls/referenceDependency'
import { resolveTaskArchetype } from './catalogTaskResolve'

type GenerationRunContext = {
  nodes?: GenerationCanvasNode[]
  edges?: GenerationCanvasEdge[]
}

export function canRunGenerationNode(
  node: GenerationCanvasNode | Pick<GenerationCanvasNode, 'kind'> | null | undefined,
  context: GenerationRunContext = {},
): boolean {
  if (!node) return false
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  if (executionKind === 'image') {
    // L3 护栏：档案当前模式是「图生图」(image_edit) 且声明了参考槽、却一张参考都递不进来 → 不可生成
    // （对齐视频节点既有护栏；composer 给「图生图需要参考图」文案）。此前 image 恒 true，空参考的
    // 图生图会被静默当纯文生发出去（模板丢空键）——「图生图不按原图」体感来源之一。
    // 纯文生图模式 / 无档案模型照旧恒可生成（后者由 runtime 的 image_edit 闸兜底诚实拒发）；
    // 连了线但源未生成不在此禁——composer 的「备齐参考」波次接管。
    if (!('id' in node) || !node.id) return true
    const meta = node.meta || {}
    const imageArchetype = resolveTaskArchetype(meta)
    const imageMode = imageArchetype ? currentArchetypeMode(imageArchetype, meta) : null
    if (!imageArchetype || !imageMode || imageMode.transportTaskKind !== 'image_edit' || (imageMode.slots || []).length === 0) return true
    const references = resolveGenerationReferences(node, context)
    return hasAnyArchetypeReference(meta, imageArchetype, references)
  }
  // C5: 文本节点只要选了文本模型就能生成；prompt 缺失由 buildCatalogTaskRequest 兜底报错。
  if (executionKind === 'text') return true
  // 声音：配音(台词缺失下游兜底，同 text 可生成)；转写需先有音频参考(audio_ref 槽)。
  if (executionKind === 'audio') {
    if (!('meta' in node)) return true
    const meta = node.meta || {}
    const audioArchetype = resolveTaskArchetype(meta)
    const mode = audioArchetype ? currentArchetypeMode(audioArchetype, meta) : null
    const needsAudioRef = (mode?.slots || []).some((slot) => slot.kind === 'audio_ref')
    if (!needsAudioRef) return true
    // 连线来源也算（今天没有音频源节点种类，SLOT_ACCEPTS.audio_ref=[]，故实际恒空）——口径与另两支一致，
    // 将来加了音频节点不必再想起来补这一处。
    const audioReferences = 'id' in node && node.id ? resolveGenerationReferences(node, context) : undefined
    return Boolean(audioArchetype && hasAnyArchetypeReference(meta, audioArchetype, audioReferences))
  }
  if (executionKind !== 'video') return false
  if (!('id' in node) || !node.id) return false
  const meta = node.meta || {}
  const archetype = resolveTaskArchetype(meta)
  // 无档案模型（ComfyUI 导入图 / 自定义接入）→ 放行。判据必须是**模型自己声明要什么**，不是
  // 「用户手上现在有没有参考」——后者把因果反过来了。图/音两支早已收口成「无档案 = 放行，由 runtime
  // 的诚实闸兜底拒发」（见上 image 分支注释），只有 video 这支漏了，于是**图定义的文生视频工作流**
  // 被锁死：图里没有图输入、UI 也不显示参考框，按钮却非要一张参考才亮 → 用户只能连张图去喂它 →
  // runtime 又以「没有『图生视频』通道」拒发 → 两头堵死，纯文生视频整类发不出去（2026-08-24 用户反馈：
  // 「Comfyui 我配置的文生视频工作流，但是提交必须输入图片才能发出」）。
  // 与 promptRequiredForNode 同一条思路：需不需要某种输入是模型的属性，这一层不猜。
  if (!archetype) return true
  // 当前模式无参考槽 = 纯文生视频（t2v）→ 只要 prompt 即可生成，同 text/image 节点（prompt 缺失下游兜底）。
  // 不能因「video 一律要首帧」把 t2v 的生成按钮锁死——栽过：RunningHub Seedance 默认 text 模式（slots:[]）
  // 按钮被置灰、误提示"需要首帧"，用户根本点不了文生视频（2026-06-30 用户反馈）。apimart/kie Seedance 同病，
  // 只是用户多从图片边起步才没暴露。根因 = 此判定原本不分模式，一律要参考。
  const mode = currentArchetypeMode(archetype, meta)
  if ((mode.slots || []).length === 0) return true
  // 有参考槽的模式（i2v/首尾帧/全能参考 omni/视频编辑）→ 需至少一个参考。判据统一交给
  // hasAnyArchetypeReference：它遍历**本模式声明的槽**，每个槽同时看「画布边」和「meta 手动上传」，
  // 与显示（resolveReferenceSlots）、发送（buildArchetypeInputParams）同一口径。
  // 此前这里是一串就地展开的 OR，每加一种槽都得记得再补一条 → 漏了连线参考视频、尾帧接力、
  // 源视频三处，用户明明连了线、缩略图也显示着，↑ 按钮却死着（2026-08-20 用户反馈 + 不变量测试）。
  const references = resolveGenerationReferences(node, context)
  if (!hasAnyArchetypeReference(meta, archetype, references)) return false
  // 跨槽依赖（档案 slot.requiresAnyOf）：有参考 ≠ 组合合法。Seedance 2.0 的参考音频必须搭配图或视频
  // （方舟「不支持"文本+音频"、"纯音频" 输入」/ APIMart "Must be used together with reference images
  // or reference videos"），只放一段音频此前会被判可生成、发出去才被服务商拒。2.5 已解除，故按档案声明判、
  // 不写死模型名。置灰文案取同一判定（unmetReferenceDependencyForNode），不让 composer 再猜一遍。
  return !unmetReferenceDependencyForNode(node, context)
}

/**
 * 该节点当前有没有「有值却缺伴随」的参考槽（档案 slot.requiresAnyOf）。
 * `canRunGenerationNode` 用它决定能不能点，composer 用它决定置灰时说哪句人话 —— **同一个判定**。
 */
export function unmetReferenceDependencyForNode(
  node: GenerationCanvasNode,
  context: GenerationRunContext = {},
): UnmetReferenceDependency | null {
  const meta = node.meta || {}
  return nodeUnmetReferenceDependency(meta, resolveTaskArchetype(meta), resolveGenerationReferences(node, context))
}
