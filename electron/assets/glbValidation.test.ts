import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectGlb } from './glbValidation'

function pad4(bytes: Buffer, fill = 0): Buffer {
  const padding = (4 - (bytes.length % 4)) % 4
  return padding ? Buffer.concat([bytes, Buffer.alloc(padding, fill)]) : bytes
}

function glbFromJson(json: Record<string, unknown>, binary = Buffer.alloc(0)): Buffer {
  const jsonBytes = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20)
  const binaryBytes = pad4(binary)
  const chunks = [
    Buffer.from(Uint32Array.of(jsonBytes.length, 0x4e4f534a).buffer),
    jsonBytes,
    ...(binaryBytes.length
      ? [Buffer.from(Uint32Array.of(binaryBytes.length, 0x004e4942).buffer), binaryBytes]
      : []),
  ]
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(header.length + body.length, 8)
  return Buffer.concat([header, body])
}

function triangleGlb(options: { externalTexture?: boolean; invalidBufferView?: boolean } = {}): Buffer {
  const positions = Buffer.alloc(36)
  ;[
    [0, 0, 0],
    [1, 0, 0],
    [0, 2, 0],
  ].flat().forEach((value, index) => positions.writeFloatLE(value, index * 4))
  const textureBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const binary = Buffer.concat([positions, textureBytes])
  return glbFromJson({
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: options.invalidBufferView ? 9999 : positions.length },
      { buffer: 0, byteOffset: positions.length, byteLength: textureBytes.length },
    ],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [1, 2, 0],
    }],
    materials: [{ name: 'Test material' }],
    images: options.externalTexture
      ? [{ uri: 'texture.png' }]
      : [{ bufferView: 1, mimeType: 'image/png' }],
    textures: [{ source: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }, binary)
}

describe('GLB validation', () => {
  it('reports parseable geometry, bounds, materials, and embedded textures', () => {
    const report = inspectGlb(triangleGlb())

    expect(report).toMatchObject({
      version: 1,
      glbVersion: 2,
      meshCount: 1,
      primitiveCount: 1,
      materialCount: 1,
      textureCount: 1,
      imageCount: 1,
      embeddedImageCount: 1,
      externalImageCount: 0,
      bounds: {
        min: [0, 0, 0],
        max: [1, 2, 0],
        size: [1, 2, 0],
      },
    })
    expect(report.bounds.diagonal).toBeCloseTo(Math.sqrt(5))
    expect(report.warnings).toEqual([])
  })

  it('rejects a file that only has the glTF text prefix but no GLB container', () => {
    expect(() => inspectGlb(Buffer.from('glTF'))).toThrow(/GLB.*过短/)
  })

  it('rejects a parseable GLB with no mesh geometry', () => {
    expect(() => inspectGlb(glbFromJson({
      asset: { version: '2.0' },
      scenes: [{ nodes: [] }],
      scene: 0,
    }))).toThrow(/不包含网格/)
  })

  it('rejects buffer views that point outside the binary chunk', () => {
    expect(() => inspectGlb(triangleGlb({ invalidBufferView: true }))).toThrow(/bufferView.*越界/)
  })

  it('reports external texture references instead of silently treating them as embedded', () => {
    const report = inspectGlb(triangleGlb({ externalTexture: true }))

    expect(report.externalImageCount).toBe(1)
    expect(report.externalImageUris).toEqual(['texture.png'])
    expect(report.warnings).toContain('模型引用 1 个外部纹理文件，跨设备或移动项目后可能丢失')
  })

  it('accepts the repository mannequin GLB as real-world coverage', () => {
    const bytes = fs.readFileSync(path.resolve(process.cwd(), 'src/assets/nomi-mannequin.glb'))
    const report = inspectGlb(bytes)

    expect(report.meshCount).toBeGreaterThan(0)
    expect(report.primitiveCount).toBeGreaterThan(0)
    expect(report.bounds.diagonal).toBeGreaterThan(0)
  })
})
