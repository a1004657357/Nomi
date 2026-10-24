import { desktopT } from "../desktopStrings";
type JsonRecord = Record<string, unknown>
type Vec3 = [number, number, number]

export type GlbValidationReport = {
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
    min: Vec3
    max: Vec3
    size: Vec3
    diagonal: number
  }
  warnings: string[]
}

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function integer(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isInteger(number) ? number : fallback
}

function finiteVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const result = value.slice(0, 3).map(Number)
  return result.every(Number.isFinite) ? result as Vec3 : null
}

function safeExternalUri(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  if (/^data:/i.test(raw)) return ''
  try {
    const parsed = new URL(raw)
    return `[${parsed.protocol.replace(':', '')}]/${parsed.pathname.split('/').filter(Boolean).at(-1) || 'asset'}`
  } catch {
    return raw.split(/[?#]/, 1)[0] || 'external-asset'
  }
}

function componentSize(componentType: number): number {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1
    case 5122:
    case 5123:
      return 2
    case 5125:
    case 5126:
      return 4
    default:
      throw new Error(desktopT("custom.assets.glbValidation.text1", { value0: `${componentType}` }))
  }
}

function readComponent(bytes: Buffer, offset: number, componentType: number): number {
  switch (componentType) {
    case 5120: return bytes.readInt8(offset)
    case 5121: return bytes.readUInt8(offset)
    case 5122: return bytes.readInt16LE(offset)
    case 5123: return bytes.readUInt16LE(offset)
    case 5125: return bytes.readUInt32LE(offset)
    case 5126: return bytes.readFloatLE(offset)
    default: throw new Error(desktopT("custom.assets.glbValidation.text2", { value0: `${componentType}` }))
  }
}

function accessorBounds(
  accessorValue: unknown,
  document: JsonRecord,
  binary: Buffer,
): { min: Vec3; max: Vec3 } {
  const accessor = record(accessorValue)
  if (accessor.type !== 'VEC3') throw new Error(desktopT("custom.assets.glbValidation.text3"))
  const declaredMin = finiteVec3(accessor.min)
  const declaredMax = finiteVec3(accessor.max)
  if (declaredMin && declaredMax) return { min: declaredMin, max: declaredMax }

  const views = array(document.bufferViews)
  const viewIndex = integer(accessor.bufferView, -1)
  const view = record(views[viewIndex])
  if (viewIndex < 0 || Object.keys(view).length === 0) {
    throw new Error(desktopT("custom.assets.glbValidation.text4"))
  }
  const componentType = integer(accessor.componentType, -1)
  const count = integer(accessor.count, 0)
  if (count < 1) throw new Error(desktopT("custom.assets.glbValidation.text5"))
  const elementSize = componentSize(componentType) * 3
  const stride = integer(view.byteStride, elementSize)
  if (stride < elementSize) throw new Error(desktopT("custom.assets.glbValidation.text6"))
  const start = integer(view.byteOffset) + integer(accessor.byteOffset)
  const end = start + ((count - 1) * stride) + elementSize
  if (start < 0 || end > binary.length) throw new Error(desktopT("custom.assets.glbValidation.text7"))

  const min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  const size = componentSize(componentType)
  for (let index = 0; index < count; index += 1) {
    const base = start + (index * stride)
    for (let axis = 0; axis < 3; axis += 1) {
      const value = readComponent(binary, base + (axis * size), componentType)
      if (!Number.isFinite(value)) throw new Error(desktopT("custom.assets.glbValidation.text8"))
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  }
  return { min, max }
}

function parseChunks(bytes: Buffer): { document: JsonRecord; binary: Buffer } {
  if (bytes.length < 20) throw new Error(desktopT("custom.assets.glbValidation.text9"))
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) throw new Error(desktopT("custom.assets.glbValidation.text10"))
  const version = bytes.readUInt32LE(4)
  if (version !== 2) throw new Error(desktopT("custom.assets.glbValidation.text11", { value0: `${version}` }))
  const declaredLength = bytes.readUInt32LE(8)
  if (declaredLength !== bytes.length) {
    throw new Error(desktopT("custom.assets.glbValidation.text12", { value0: `${declaredLength}`, value1: `${bytes.length}` }))
  }

  let offset = 12
  let jsonBytes: Buffer | null = null
  let binary = Buffer.alloc(0)
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error(desktopT("custom.assets.glbValidation.text13"))
    const chunkLength = bytes.readUInt32LE(offset)
    const chunkType = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + chunkLength
    if (end > bytes.length) throw new Error(desktopT("custom.assets.glbValidation.text14"))
    if (chunkType === JSON_CHUNK && jsonBytes === null) jsonBytes = Buffer.from(bytes.subarray(start, end))
    if (chunkType === BIN_CHUNK && binary.length === 0) binary = Buffer.from(bytes.subarray(start, end))
    offset = end
  }
  if (!jsonBytes) throw new Error(desktopT("custom.assets.glbValidation.text15"))

  let document: unknown
  try {
    document = JSON.parse(jsonBytes.toString('utf8').replace(/\0+$/g, '').trim())
  } catch (error) {
    throw new Error(desktopT("custom.assets.glbValidation.text16", { value0: `${error instanceof Error ? error.message : String(error)}` }))
  }
  const parsed = record(document)
  if (String(record(parsed.asset).version || '') !== '2.0') throw new Error(desktopT("custom.assets.glbValidation.text17"))
  return { document: parsed, binary }
}

function validateBufferViews(document: JsonRecord, binary: Buffer): void {
  const buffers = array(document.buffers)
  const embeddedBuffer = record(buffers[0])
  const declaredBinaryLength = integer(embeddedBuffer.byteLength)
  if (declaredBinaryLength > binary.length) {
    throw new Error(desktopT("custom.assets.glbValidation.text18", { value0: `${declaredBinaryLength}`, value1: `${binary.length}` }))
  }
  for (const [index, value] of array(document.bufferViews).entries()) {
    const view = record(value)
    if (integer(view.buffer) !== 0) continue
    const start = integer(view.byteOffset)
    const length = integer(view.byteLength, -1)
    if (start < 0 || length < 0 || start + length > binary.length) {
      throw new Error(desktopT("custom.assets.glbValidation.text19", { value0: `${index}` }))
    }
  }
}

export function inspectGlb(bytes: Buffer): GlbValidationReport {
  const { document, binary } = parseChunks(bytes)
  validateBufferViews(document, binary)

  const meshes = array(document.meshes)
  if (meshes.length === 0) throw new Error(desktopT("custom.assets.glbValidation.text20"))
  const accessors = array(document.accessors)
  let primitiveCount = 0
  let min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  let max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const meshValue of meshes) {
    const primitives = array(record(meshValue).primitives)
    for (const primitiveValue of primitives) {
      primitiveCount += 1
      const attributes = record(record(primitiveValue).attributes)
      const positionIndex = integer(attributes.POSITION, -1)
      if (positionIndex < 0 || !accessors[positionIndex]) continue
      const bounds = accessorBounds(accessors[positionIndex], document, binary)
      min = min.map((value, axis) => Math.min(value, bounds.min[axis])) as Vec3
      max = max.map((value, axis) => Math.max(value, bounds.max[axis])) as Vec3
    }
  }
  if (primitiveCount === 0) throw new Error(desktopT("custom.assets.glbValidation.text21"))
  if (![...min, ...max].every(Number.isFinite)) throw new Error(desktopT("custom.assets.glbValidation.text22"))
  const size = min.map((value, axis) => max[axis] - value) as Vec3
  const diagonal = Math.hypot(...size)
  if (!(diagonal > 0)) throw new Error(desktopT("custom.assets.glbValidation.text23"))

  const images = array(document.images)
  const externalImageUris = images.map((value) => safeExternalUri(record(value).uri)).filter(Boolean)
  const embeddedImageCount = images.filter((value) => {
    const image = record(value)
    return Number.isInteger(Number(image.bufferView)) || /^data:/i.test(String(image.uri || ''))
  }).length
  const externalBufferUris = array(document.buffers)
    .map((value) => safeExternalUri(record(value).uri))
    .filter(Boolean)
  const warnings: string[] = []
  if (externalImageUris.length) {
    warnings.push(`模型引用 ${externalImageUris.length} 个外部纹理文件，跨设备或移动项目后可能丢失`)
  }
  if (externalBufferUris.length) {
    warnings.push(`模型引用 ${externalBufferUris.length} 个外部二进制文件，当前 GLB 不是完全自包含`)
  }
  if (array(document.materials).length === 0) warnings.push('模型没有材质')

  return {
    version: 1,
    glbVersion: 2,
    byteLength: bytes.length,
    meshCount: meshes.length,
    primitiveCount,
    nodeCount: array(document.nodes).length,
    materialCount: array(document.materials).length,
    textureCount: array(document.textures).length,
    imageCount: images.length,
    embeddedImageCount,
    externalImageCount: externalImageUris.length,
    externalImageUris,
    externalBufferCount: externalBufferUris.length,
    externalBufferUris,
    animationCount: array(document.animations).length,
    skinCount: array(document.skins).length,
    bounds: { min, max, size, diagonal },
    warnings,
  }
}
