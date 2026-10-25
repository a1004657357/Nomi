/**
 * [INPUT]: 依赖 src/assets 既有 Nomi/动画/UE4 GLB 与 director/pose 的 9 个 FBX（构建产物 URL，只喂 three loader）、../../model/actionLibrary 的 ACTION_LIBRARY
 * [OUTPUT]: 对外提供 MANNEQUIN_MODEL_URL、MANNEQUIN_ANIMATION_URL、UE4_MANNEQUIN_MODEL_URL、POSE_CLIP_ASSETS、poseClipAssetFor
 * [POS]: director/scene/character 的内置资产地址单一真相（V1 scene3dConstants 入籍 + 2026-09-03 Mixamo 姿态库入籍）；
 *        只渲染不持久化，登记在 src/bundleAssetUrlBoundary.test.ts 的 RENDER_ONLY_ALLOWLIST。Vite 要静态字面量才能收进产物，所以逐条写 URL，不拼字符串。
 *        scene3d 与 UE4 rig 复用此地址 owner，保留不同模型及动画身份；本模块不写项目资产或节点结果。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ACTION_LIBRARY } from '../../model/actionLibrary'

export const MANNEQUIN_MODEL_URL = new URL('../../../../../../assets/nomi-mannequin.glb', import.meta.url).href
export const MANNEQUIN_ANIMATION_URL = new URL('../../../../../../assets/nomi-mannequin-animations.glb', import.meta.url).href
export const UE4_MANNEQUIN_MODEL_URL = new URL('../../../../../../assets/ue-mannequin-retopology.glb', import.meta.url).href

export type PoseClipAsset = { fbx: string }

const asset = (fbx: URL): PoseClipAsset => ({ fbx: fbx.href })

/** 与 model/actionLibrary 的 file 名一一对应（Mixamo 动画） */
export const POSE_CLIP_ASSETS: Record<string, PoseClipAsset> = {
  StandingIdle: asset(new URL('../../../../../../assets/director/pose/StandingIdle.fbx', import.meta.url)),
  KneelingDown: asset(new URL('../../../../../../assets/director/pose/KneelingDown.fbx', import.meta.url)),
  Kneeling: asset(new URL('../../../../../../assets/director/pose/Kneeling.fbx', import.meta.url)),
  Standing: asset(new URL('../../../../../../assets/director/pose/Standing.fbx', import.meta.url)),
  StandardWalk: asset(new URL('../../../../../../assets/director/pose/StandardWalk.fbx', import.meta.url)),
  Running: asset(new URL('../../../../../../assets/director/pose/Running.fbx', import.meta.url)),
  MaleSittingPose1: asset(new URL('../../../../../../assets/director/pose/MaleSittingPose1.fbx', import.meta.url)),
  MaleSittingPose: asset(new URL('../../../../../../assets/director/pose/MaleSittingPose.fbx', import.meta.url)),
  KneelingIdle: asset(new URL('../../../../../../assets/director/pose/KneelingIdle.fbx', import.meta.url)),
}

/** 动作库 id → 资产（T-Pose 与未知 id 为 null） */
export function poseClipAssetFor(actionId: string): PoseClipAsset | null {
  const entry = ACTION_LIBRARY.find((item) => item.id === actionId)
  return entry?.file ? (POSE_CLIP_ASSETS[entry.file] ?? null) : null
}
