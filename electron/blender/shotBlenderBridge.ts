import { desktopT } from '../desktopStrings'
/**
 * Gate 4 Slice 1 — ShotSpec ↔ Blender 桥接（§14.2 ShotSpec→plan + directorNode 闭环升级为 shot 闭环）。
 *
 * 对应目标架构 §14.2 Blender 输入：「ShotSpec 的 blocking、camera、lens、motion 和 beats」+ §14.4 执行边界。
 * 现状（Gate 0 §1.8 证据）：闭环是 **directorNode→plan→Blender→回 directorNode**，**非 shot 粒度**——
 * `VibingDirectorBlenderRequest`（`vibingDirectorRunner.ts:54`）只有 directorNodeId，无 shotId。
 *
 * 设计（不破坏既有）：
 * - **shotId 字段**：在 VibingDirectorBlenderRequest 加 optional shotId（向后兼容，既有调用不传 = undefined）。
 * - **ShotSpec→plan 投影**：`projectShotSpecToBlenderPlanInputs` 把 ShotSpec 的 cinematography/blocking/
 *   cameraMotion 派生成 Blender plan 需要的镜头级输入（供 plan 构建器消费）。
 * - **不替代既有 plan 构建**：既有 vibingDirectorTools.ts 的 canonicalActionSchema 仍是 plan 真相源；
 *   本投影只提供「从 ShotSpec 派生 plan 输入」的便捷入口，供 Agent 或 UI 把镜头意图灌进 Blender。
 *
 * 不在本 Slice：实际改 vibingDirectorRunner.ts 的 VibingDirectorBlenderRequest 类型加 shotId 字段
 * （需改既有类型 + 测试，留 Slice 1 接入；本文件先交付投影函数 + 类型扩展声明）。
 */

/** §14.3 Blender 输出里的相机参数（与 vibingDirectorRunner.ts 的 VibingDirectorPreviewCamera 对齐）。 */
export type ShotCameraParams = {
  position?: [number, number, number]
  lookAt?: [number, number, number]
  focalLength?: number
  sensorWidth?: number
  /** 相机路径关键帧（运镜；Gate 0 §1.8：当前无回传，本字段是目标态）。 */
  path?: Array<{
    time: number
    position: [number, number, number]
    rotation?: [number, number, number]
  }>
}

/**
 * ShotSpec 的镜头级输入投影成 Blender plan 可消费的形。
 * 供 Agent 在生成 Blender plan 时，把 ShotSpec 的 blocking/camera/motion 翻译成 declarative action 提示。
 */
export type ShotBlenderInputs = {
  shotId: string
  /** 镜号（供 Blender 场景命名）。 */
  index: number
  /** 走位/调度（§14.2 blocking：谁在哪、怎么动）。 */
  blocking?: string
  /** 景别（shotScale → Blender 相机距离/焦段提示）。 */
  shotScale?: string
  /** 机位角度（cameraAngle → 相机摆放）。 */
  cameraAngle?: string
  /** 运镜（cameraMotion.type/direction/speed → set_camera_path 关键帧提示）。 */
  cameraMotion?: { type?: string; direction?: string; amount?: string; speed?: string }
  /** 焦段（lensMm → 相机 focal length）。 */
  lensMm?: number
  /** 环境空间关系（spatialRelations → 场景物体摆放）。 */
  spatialRelations: string[]
  /** 主体（subjects → 场景角色资产摆放）。 */
  subjects: Array<{ assetId?: string; role: string; performance?: string }>
  /** 时长（durationSeconds → 预演视频长度）。 */
  durationSeconds: number
  /** 起始/结束状态（time.startState/endState → 动画起止姿态）。 */
  startState?: string
  endState?: string
}

/**
 * 把 ShotSpec 子字段投影成 ShotBlenderInputs（供 Blender plan 构建器消费）。
 *
 * ShotSpec 是镜头唯一真相源（§9.1）；本投影是派生，不复制为独立真相（§4.3）。
 */
export function projectShotSpecToBlenderInputs(shot: {
  id: string
  index: number
  cinematography?: {
    shotScale?: string
    cameraAngle?: string
    lensMm?: number
    cameraMotion?: { type?: string; direction?: string; amount?: string; speed?: string }
    blocking?: string
  }
  environment?: { spatialRelations?: string[] }
  subjects?: Array<{ assetId?: string; role: string; performance?: string }>
  time?: { durationSeconds?: number; startState?: string; endState?: string }
}): ShotBlenderInputs {
  return {
    shotId: shot.id,
    index: shot.index,
    ...(shot.cinematography?.blocking ? { blocking: shot.cinematography.blocking } : {}),
    ...(shot.cinematography?.shotScale ? { shotScale: shot.cinematography.shotScale } : {}),
    ...(shot.cinematography?.cameraAngle ? { cameraAngle: shot.cinematography.cameraAngle } : {}),
    ...(shot.cinematography?.cameraMotion
      ? { cameraMotion: shot.cinematography.cameraMotion }
      : {}),
    ...(shot.cinematography?.lensMm ? { lensMm: shot.cinematography.lensMm } : {}),
    spatialRelations: shot.environment?.spatialRelations ?? [],
    subjects: shot.subjects ?? [],
    durationSeconds: shot.time?.durationSeconds ?? 0,
    ...(shot.time?.startState ? { startState: shot.time.startState } : {}),
    ...(shot.time?.endState ? { endState: shot.time.endState } : {}),
  }
}

/**
 * 把 Blender 回传的相机参数关联回 ShotSpec（§14.3 输出 → ShotSpec 派生字段）。
 * 返回一个 patch，调用方可把它 merge 进 ShotSpec 的 Blender 预演 revision 元数据。
 */
export function blenderCameraToShotPatch(camera: {
  position?: [number, number, number]
  lookAt?: [number, number, number]
  focalLength?: number
}): { blenderCamera: ShotCameraParams } {
  return {
    blenderCamera: {
      ...(camera.position ? { position: camera.position } : {}),
      ...(camera.lookAt ? { lookAt: camera.lookAt } : {}),
      ...(typeof camera.focalLength === 'number' ? { focalLength: camera.focalLength } : {}),
    },
  }
}

/**
 * §14.4 执行边界自检：ShotSpec 的 Blender plan 输入是否只含允许的 declarative 字段
 * （不含任意 Python/shell/网络下载）。供 Agent apply_vibing_director_plan 前校验。
 */
export function assertShotBlenderInputsSafe(inputs: ShotBlenderInputs): { safe: boolean; reason?: string } {
  // 检查字符串字段不含危险模式（URL/file path/shell）
  const stringFields = [
    inputs.blocking,
    inputs.shotScale,
    inputs.cameraAngle,
    inputs.cameraMotion?.type,
    inputs.cameraMotion?.direction,
    ...inputs.spatialRelations,
  ].filter((s): s is string => typeof s === 'string')
  for (const s of stringFields) {
    if (/https?:\/\//i.test(s)) return { safe: false, reason: desktopT("custom.workflow.blockingUrl", { value0: s.slice(0, 30) }) }
    if (/^\/[a-z]/i.test(s)) return { safe: false, reason: desktopT("custom.workflow.blockingAbsolutePath", { value0: s.slice(0, 30) }) }
    if (/(\b|rmdir|rm\s|exec|eval|system)\s*\(/i.test(s)) return { safe: false, reason: desktopT("custom.workflow.blockingCall", { value0: s.slice(0, 30) }) }
  }
  return { safe: true }
}
