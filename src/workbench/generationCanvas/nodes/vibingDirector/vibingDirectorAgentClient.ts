import type { AgentsChatResponseDto } from '../../../../api/desktopClient'
import type { ToolCallEvent } from '../../../ai/workbenchAgentRunner'
import { sendWorkbenchAiMessage } from '../../../ai/workbenchAiClient'
import { getAssistantModelPref } from '../../../ai/assistantModelPref'
import type { ProjectExecutionContext } from '../../../project/projectCanvasReadSurface'
import {
  formatVibingDirectorContext,
  type VibingDirectorState,
} from './vibingDirectorState'

export type SendVibingDirectorAgentMessageInput = {
  project: ProjectExecutionContext
  directorNodeId: string
  state: VibingDirectorState
  message: string
  protocol?: 'tools' | 'structured-text'
  onContent?: (delta: string, text: string) => void
  onToolCall?: (event: ToolCallEvent) => void
  onCancelReady?: (cancel: () => void) => void
}

export type VibingDirectorAgentResponse = { response: AgentsChatResponseDto }

const STRUCTURED_PROTOCOL_PREF_PREFIX = 'nomi.vibingDirector.structuredProtocol'

function structuredProtocolPrefKey(): string | null {
  const pref = getAssistantModelPref()
  if (!pref?.modelKey) return null
  return `${STRUCTURED_PROTOCOL_PREF_PREFIX}:${pref.vendorKey || 'default'}:${pref.modelKey}`
}

/** Remember only a provider/model compatibility fact, never conversation data. */
export function preferredVibingDirectorAgentProtocol(): 'tools' | 'structured-text' {
  return 'structured-text'
}

export function rememberVibingDirectorStructuredProtocol(): void {
  try {
    const key = structuredProtocolPrefKey()
    if (key) localStorage.setItem(key, 'structured-text')
  } catch {
    /* storage is optional; retrying native tools remains safe */
  }
}

export function vibingDirectorSessionKey(directorNodeId: string, project: ProjectExecutionContext): string {
  project.assertCurrent()
  const projectId = project.binding.projectId
  return `nomi:workbench:${projectId}:director:${directorNodeId}`
}

function buildDirectorSystemPrompt(protocol: 'tools' | 'structured-text'): string {
  const common = [
    '你是 Nomi 的 VIBING Director Agent。Blender 是唯一的场景编辑和预演环境；当前节点只是 Blender 的计划、预览和产物回传入口，不维护独立 Three.js 舞台。',
    '你只能为当前 VIBING Director 节点提出声明式 Blender 导演计划：场景预设、已导入资产的摆放、走位标记、对象调整、导演相机/运镜和镜头节拍。',
    '资产只能引用状态中已存在的 assetId。禁止下载、抓取或引用网络 URL、任意文件路径、Blender Python、shell、JavaScript 或其他代码。用户需要新模型时，提示其通过资产库从授权来源下载后手动导入。',
    '对象和相机引用优先使用状态中的稳定 id；名称有歧义时先询问。默认增量修改，除非用户明确要求重建整个场景才使用 replace。',
    '空间关系优先于绝对坐标。咖啡店里两人隔桌对坐时，必须使用 set_blocking_layout(template: coffee_two_person_conversation)，不要把桌、椅、杯、电脑或餐盘都做成普通人物走位标记。其他场景的 add_marker 必须给出 role（例如 actor_seated、actor_standing、table、chair、cup、laptop、plate 或 prop）。',
    '需要关系在后续修改中继续成立时使用 set_relation：facing 维持朝向，distance 维持水平距离并给 distance 米数，support 把物体放在目标表面，offset 保持完整相对位置（例如椅子跟随坐姿角色），line_of_sight 维持视线朝向；双向对视设置 mutual=true。不要仅靠一次性的坐标猜测表达这些关系。',
    '坐标使用 [x, y, z]：x 为左右、y 为离地高度、z 为前后深度；rotation 是角度制 [x,y,z]。桌椅和人物落在地面 y=0，杯子、电脑、餐盘必须落在桌面 y=0.76，人物相对坐席朝向彼此。',
    '相机取景使用 framing：all 自动框住全部非舞台主体；target 配合 targetRef 持续跟随一个已有对象；fixed 才锁定绝对机位。移动主体后不要留下旧 lookAt 导致空画面，特写或跟拍优先使用 target。',
    '计划会先展示给用户确认；只有确认后，Nomi 才在本机启动 Blender，并回传 .blend、预览图和 GLB。不要调用普通画布创建、删除、连线或图片/视频生成工具。',
  ]
  if (protocol === 'tools') {
    return [
      ...common,
      '每次修改前都必须先调用 read_vibing_director 读取当前节点，即使消息里已经带有状态摘要也不能跳过。读取成功后再调用 apply_vibing_director_plan，一次提交一组最小且完整的计划。',
      '先用一两句话说明导演意图，然后发工具调用。不要把工具调用替换成代码或操作步骤。',
    ].join('\n')
  }
  return [
    ...common,
    '最高优先级输出约束：当前供应商不接受原生 Function Call。不要调用工具，也不要输出解释、推理、YAML 或 Markdown。',
    '回复的第一个字符必须是 {，最后一个字符必须是 }。只返回一个 JSON 对象：{"directorNodeId":"当前节点 id","summary":"本次 Blender 调整摘要","plan":{"mode":"replace|amend","brief":"可选","actions":[...]}}。',
    'actions 只能使用：set_stage(preset: empty|studio|coffee_shop|city_street|interior_room), set_blocking_layout(template: coffee_two_person_conversation,actorAName?,actorBName?), place_asset(id,assetId,name,position?,rotation?,scale?), add_marker(id,name,role?,position?,rotation?,scale?,color?), move_object(objectRef,position?/rotation?/scale?/name?), remove_object(objectRef), set_relation(id,kind:facing|distance|support|offset|line_of_sight,subjectRef,targetRef,distance?,mutual?), remove_relation(relationRef), set_camera(cameraRef?/name?/position?/lookAt?/fov?/aspectRatio?/framing?:all|target|fixed,targetRef?), set_camera_path(cameraRef?,points,durationSec), set_beat(id,title,action?,cameraNote?,dialogue?,notes?,durationSec?)。',
    '当前节点只有一个可实际修改的导演相机，稳定 id 为 director-camera。不要输出 cam-main、cam-OTS 等虚拟 cameraRef；多个镜头角度写入各自 set_beat 的 cameraNote。',
    '所有三维坐标必须是 [x,y,z] 数组，禁止未声明字段。',
  ].join('\n')
}

function buildDirectorPrompt(input: SendVibingDirectorAgentMessageInput): string {
  return [
    formatVibingDirectorContext(input.directorNodeId, input.state),
    '',
    '用户请求：',
    input.message,
  ].join('\n')
}

export async function sendVibingDirectorAgentMessage(
  input: SendVibingDirectorAgentMessageInput,
): Promise<VibingDirectorAgentResponse> {
  const { project } = input
  project.assertCurrent()
  const protocol = 'structured-text' as const
  let disposeCancellation = () => {}
  try {
  const response = await sendWorkbenchAiMessage({
    prompt: buildDirectorPrompt(input),
    systemPrompt: buildDirectorSystemPrompt(protocol),
    displayPrompt: input.message,
    sessionKey: vibingDirectorSessionKey(input.directorNodeId, project),
    skillKey: 'workbench.vibing-director',
    skillName: 'VIBING Director',
    projectId: project.binding.projectId,
    disableTools: true,
  }, {
    onContent: (delta, text) => { project.assertCurrent(); input.onContent?.(delta, text) },
    onCancelReady: cancel => {
      if (project.signal.aborted) { cancel(); return }
      project.signal.addEventListener('abort', cancel, { once: true })
      disposeCancellation = () => project.signal.removeEventListener('abort', cancel)
      input.onCancelReady?.(cancel)
    },
  })
  project.assertCurrent()
  return { response }
  } finally {
    disposeCancellation()
  }
}
