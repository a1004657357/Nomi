import type { Model3dValidationSummary } from '../../model/generationCanvasTypes'
import type { BlenderDirectorStagePreset, BlenderSpatialCheckStatus } from '../../../../../electron/shared/blenderDirectorContract'
export { BLENDER_DIRECTOR_STAGE_PRESETS } from '../../../../../electron/shared/blenderDirectorContract'
export type { BlenderDirectorStagePreset } from '../../../../../electron/shared/blenderDirectorContract'

export const VIBING_DIRECTOR_VERSION = 2 as const

export type BlenderDirectorVector3 = [number, number, number]
export type BlenderDirectorAssetSource = 'local' | 'kenney' | 'polyhaven' | 'quaternius' | 'blenderkit'
export type BlenderDirectorAssetFormat = 'blend' | 'glb' | 'gltf' | 'fbx' | 'obj'
export type BlenderDirectorAspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1' | '2.39:1'
export type BlenderDirectorCameraFraming = 'all' | 'target' | 'fixed'
export type BlenderDirectorRelationKind = 'facing' | 'distance' | 'support' | 'offset' | 'line_of_sight'

export const BLENDER_DIRECTOR_BLOCKING_TEMPLATES = [
  'coffee_two_person_conversation',
] as const

export type BlenderDirectorBlockingTemplate = (typeof BLENDER_DIRECTOR_BLOCKING_TEMPLATES)[number]

export type BlenderDirectorAsset = {
  id: string
  name: string
  fileName: string
  format: BlenderDirectorAssetFormat
  source: BlenderDirectorAssetSource
  license: string
  importedAt: number
  model3dValidation?: Model3dValidationSummary
  provenance?: {
    provider: 'kenney'
    catalogAssetId: string
    packId: string
    sourcePageUrl: string
    downloadUrl: string
    licenseUrl: string
    archiveSha256: string
    fileSha256: string
  }
}

export type BlenderDirectorSceneObject = {
  id: string
  name: string
  kind: 'asset' | 'marker'
  assetId?: string
  role?: string
  position: BlenderDirectorVector3
  rotation: BlenderDirectorVector3
  scale: BlenderDirectorVector3
}

export type BlenderDirectorCamera = {
  id: string
  name: string
  position: BlenderDirectorVector3
  lookAt: BlenderDirectorVector3
  fov: number
  aspectRatio: BlenderDirectorAspectRatio
  framing: BlenderDirectorCameraFraming
  targetRef?: string
  path?: {
    points: BlenderDirectorVector3[]
    durationSec: number
  }
}

export type BlenderDirectorBeat = {
  id: string
  title: string
  action: string
  cameraNote: string
  dialogue?: string
  notes?: string
  durationSec: number
}

export type BlenderDirectorRelation = {
  id: string
  kind: BlenderDirectorRelationKind
  subjectRef: string
  targetRef: string
  distance?: number
  mutual?: boolean
  offset?: [number, number]
  relativeOffset?: BlenderDirectorVector3
  relativeRotation?: BlenderDirectorVector3
}

export type BlenderDirectorSpatialCheck = {
  relationId: string
  kind: BlenderDirectorRelationKind
  status: BlenderSpatialCheckStatus
  message: string
  measured?: number
  expected?: number
  rotationMeasured?: number
  rotationExpected?: number
}

export type BlenderDirectorSpatialReport = {
  version: 1
  passed: boolean
  checks: BlenderDirectorSpatialCheck[]
}

export type BlenderDirectorObjectTransform = {
  id: string
  name: string
  position: BlenderDirectorVector3
  rotation: BlenderDirectorVector3
  scale: BlenderDirectorVector3
}

export type BlenderDirectorOutput = {
  jobId: string
  previewUrl: string
  previewAssetId?: string
  blendUrl: string
  blendAssetId?: string
  modelUrl: string
  modelAssetId?: string
  blendRelativePath: string
  blenderVersion?: string
  previewCamera?: BlenderDirectorCamera
  spatialReport?: BlenderDirectorSpatialReport
  objectTransforms?: BlenderDirectorObjectTransform[]
  createdAt: number
}

/**
 * A VIBING Director node is a Blender return node. It stores a small, auditable
 * plan plus Blender artifacts; it does not mirror a realtime Three.js scene.
 */
export type VibingDirectorState = {
  version: typeof VIBING_DIRECTOR_VERSION
  backend: 'blender'
  brief: string
  stagePreset: BlenderDirectorStagePreset
  assets: BlenderDirectorAsset[]
  objects: BlenderDirectorSceneObject[]
  relations: BlenderDirectorRelation[]
  camera: BlenderDirectorCamera
  beats: BlenderDirectorBeat[]
  output?: BlenderDirectorOutput
  updatedAt: number
}

export type VibingDirectorAction =
  | { op: 'set_stage'; preset: BlenderDirectorStagePreset }
  | {
      op: 'set_blocking_layout'
      template: BlenderDirectorBlockingTemplate
      actorAName?: string
      actorBName?: string
    }
  | {
      op: 'place_asset'
      id: string
      assetId: string
      name: string
      position?: BlenderDirectorVector3
      rotation?: BlenderDirectorVector3
      scale?: BlenderDirectorVector3
    }
  | {
      op: 'add_marker'
      id: string
      name: string
      role?: string
      position?: BlenderDirectorVector3
      rotation?: BlenderDirectorVector3
      scale?: BlenderDirectorVector3
      color?: string
    }
  | {
      op: 'move_object'
      objectRef: string
      position?: BlenderDirectorVector3
      rotation?: BlenderDirectorVector3
      scale?: BlenderDirectorVector3
      name?: string
    }
  | { op: 'remove_object'; objectRef: string }
  | {
      op: 'set_relation'
      id: string
      kind: BlenderDirectorRelationKind
      subjectRef: string
      targetRef: string
      distance?: number
      mutual?: boolean
    }
  | { op: 'remove_relation'; relationRef: string }
  | {
      op: 'set_camera'
      cameraRef?: string
      name?: string
      position?: BlenderDirectorVector3
      lookAt?: BlenderDirectorVector3
      fov?: number
      aspectRatio?: BlenderDirectorAspectRatio
      framing?: BlenderDirectorCameraFraming
      targetRef?: string
    }
  | {
      op: 'set_camera_path'
      cameraRef?: string
      points: BlenderDirectorVector3[]
      durationSec: number
    }
  | {
      op: 'set_beat'
      id: string
      title: string
      action?: string
      cameraNote?: string
      dialogue?: string
      notes?: string
      durationSec?: number
    }

export type VibingDirectorPlan = {
  mode: 'replace' | 'amend'
  brief?: string
  actions: VibingDirectorAction[]
}

export type VibingDirectorPlanResult = {
  state: VibingDirectorState
  applied: string[]
  rejected: string[]
}
