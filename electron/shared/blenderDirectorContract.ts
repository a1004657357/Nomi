/** Blender scene vocabulary shared by the renderer, native bridge and Agent schemas. */
export const BLENDER_DIRECTOR_STAGE_PRESETS = [
  'empty', 'studio', 'coffee_shop', 'city_street', 'interior_room',
] as const
export type BlenderDirectorStagePreset = (typeof BLENDER_DIRECTOR_STAGE_PRESETS)[number]

export const BLENDER_SPATIAL_CHECK_STATUSES = ['passed', 'warning', 'failed'] as const
export type BlenderSpatialCheckStatus = (typeof BLENDER_SPATIAL_CHECK_STATUSES)[number]

/** Local Blender process termination; not provider generation/task lifecycle. */
export type BlenderTerminationReason = 'cancelled' | 'timeout'
