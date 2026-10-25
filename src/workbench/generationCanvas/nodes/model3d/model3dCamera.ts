import { MODEL3D_VIEW_SOURCE_NAMES } from '../../../../../electron/shared/canvas/sourceDefaults'
export const MODEL3D_CAPTURE_RATIOS = ['16:9', '9:16', '1:1', '4:3'] as const

export type Model3DCaptureRatio = (typeof MODEL3D_CAPTURE_RATIOS)[number]
export type Model3DVector3 = [number, number, number]

export type Model3DCameraState = {
  version: 1
  /** Horizontal orbit in degrees. 0 is +Z, 90 is +X. */
  azimuth: number
  /** Vertical orbit in degrees. Positive values move the camera upward. */
  elevation: number
  distance: number
  fov: number
  target: Model3DVector3
}

export const DEFAULT_MODEL3D_CAMERA_STATE: Model3DCameraState = {
  version: 1,
  azimuth: 35,
  elevation: 20,
  distance: 4,
  fov: 45,
  target: [0, 0, 0],
}

export type Model3DGrid9CameraPreset = {
  id: string
  label: string
  azimuth: number
  elevation: number
}

export type Model3DGrid9CameraGuide = Model3DGrid9CameraPreset & {
  camera: Model3DCameraState
}

export const MODEL3D_GRID9_CAMERA_PRESETS: readonly Model3DGrid9CameraPreset[] = [
  { id: 'front', label: MODEL3D_VIEW_SOURCE_NAMES['front'], azimuth: 0, elevation: 0 },
  { id: 'front-right', label: MODEL3D_VIEW_SOURCE_NAMES['front-right'], azimuth: 45, elevation: 0 },
  { id: 'right', label: MODEL3D_VIEW_SOURCE_NAMES['right'], azimuth: 90, elevation: 0 },
  { id: 'rear-right', label: MODEL3D_VIEW_SOURCE_NAMES['rear-right'], azimuth: 135, elevation: 0 },
  { id: 'rear', label: MODEL3D_VIEW_SOURCE_NAMES['rear'], azimuth: 180, elevation: 0 },
  { id: 'rear-left', label: MODEL3D_VIEW_SOURCE_NAMES['rear-left'], azimuth: -135, elevation: 0 },
  { id: 'left', label: MODEL3D_VIEW_SOURCE_NAMES['left'], azimuth: -90, elevation: 0 },
  { id: 'front-left', label: MODEL3D_VIEW_SOURCE_NAMES['front-left'], azimuth: -45, elevation: 0 },
  { id: 'top', label: MODEL3D_VIEW_SOURCE_NAMES['top'], azimuth: 0, elevation: 75 },
]

export function model3dGrid9CameraStates(
  baseCamera: Model3DCameraState,
): Model3DGrid9CameraGuide[] {
  const base = normalizeModel3DCameraState(baseCamera) ?? DEFAULT_MODEL3D_CAMERA_STATE
  return MODEL3D_GRID9_CAMERA_PRESETS.map((preset) => ({
    ...preset,
    camera: {
      ...base,
      azimuth: preset.azimuth,
      elevation: preset.elevation,
      target: [...base.target],
    },
  }))
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function wrapDegrees(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180
}

function normalizedTarget(value: unknown): Model3DVector3 {
  if (!Array.isArray(value)) return [...DEFAULT_MODEL3D_CAMERA_STATE.target]
  return [
    finite(value[0], 0),
    finite(value[1], 0),
    finite(value[2], 0),
  ]
}

export function normalizeModel3DCameraState(value: unknown): Model3DCameraState | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return {
    version: 1,
    azimuth: wrapDegrees(finite(record.azimuth, DEFAULT_MODEL3D_CAMERA_STATE.azimuth)),
    elevation: clamp(finite(record.elevation, DEFAULT_MODEL3D_CAMERA_STATE.elevation), -89, 89),
    distance: clamp(finite(record.distance, DEFAULT_MODEL3D_CAMERA_STATE.distance), 0.01, 1_000_000),
    fov: clamp(finite(record.fov, DEFAULT_MODEL3D_CAMERA_STATE.fov), 10, 100),
    target: normalizedTarget(record.target),
  }
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI
}

export function cameraPositionFromState(state: Model3DCameraState): Model3DVector3 {
  const azimuth = degreesToRadians(state.azimuth)
  const elevation = degreesToRadians(state.elevation)
  const horizontalDistance = state.distance * Math.cos(elevation)
  return [
    state.target[0] + horizontalDistance * Math.sin(azimuth),
    state.target[1] + state.distance * Math.sin(elevation),
    state.target[2] + horizontalDistance * Math.cos(azimuth),
  ]
}

export function cameraStateFromPosition(input: {
  position: readonly [number, number, number]
  target: readonly [number, number, number]
  fov: number
}): Model3DCameraState {
  const dx = input.position[0] - input.target[0]
  const dy = input.position[1] - input.target[1]
  const dz = input.position[2] - input.target[2]
  const horizontalDistance = Math.hypot(dx, dz)
  const distance = Math.max(0.01, Math.hypot(dx, dy, dz))
  return {
    version: 1,
    azimuth: wrapDegrees(radiansToDegrees(Math.atan2(dx, dz))),
    elevation: clamp(radiansToDegrees(Math.atan2(dy, horizontalDistance)), -89, 89),
    distance,
    fov: clamp(finite(input.fov, DEFAULT_MODEL3D_CAMERA_STATE.fov), 10, 100),
    target: [
      finite(input.target[0], 0),
      finite(input.target[1], 0),
      finite(input.target[2], 0),
    ],
  }
}

const CAPTURE_RATIO_VALUES: Record<Model3DCaptureRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

export function model3dCaptureDimensions(
  ratio: Model3DCaptureRatio,
  requestedLongEdge: number,
): { width: number; height: number } {
  const longEdge = even(clamp(finite(requestedLongEdge, 1920), 512, 4096))
  const aspect = CAPTURE_RATIO_VALUES[ratio] ?? CAPTURE_RATIO_VALUES['16:9']
  if (aspect >= 1) {
    return { width: longEdge, height: even(longEdge / aspect) }
  }
  return { width: even(longEdge * aspect), height: longEdge }
}
