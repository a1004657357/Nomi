export type DesktopModel3dValidation = {
  version: 1
  glbVersion: number
  byteLength: number
  meshCount: number
  primitiveCount: number
  nodeCount: number
  materialCount: number
  textureCount: number
  imageCount: number
  embeddedImageCount: number
  externalImageCount: number
  externalImageUris: string[]
  externalBufferCount: number
  externalBufferUris: string[]
  animationCount: number
  skinCount: number
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
    size: [number, number, number]
    diagonal: number
  }
  warnings: string[]
}

export type DesktopVideoQualityInspection = {
  suspect: boolean
  metadata?: {
    kind: 'image' | 'video' | 'audio' | 'unknown'
    durationSeconds?: number
    width?: number
    height?: number
    fps?: number
    videoCodec?: string
    audioCodec?: string
    hasAudio: boolean
    sampleRate?: number
    channels?: number
  }
  checks: Array<{
    id: string
    suspect: boolean
    detail: string
    metrics?: Record<string, number>
  }>
}
