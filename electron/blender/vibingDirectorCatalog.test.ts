import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractVerifiedZipEntry,
  listVibingDirectorCatalogAssets,
  loadVibingDirectorCatalogAssetFile,
} from './vibingDirectorCatalog'

const tempDirs: string[] = []

function tempDir(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-vibing-catalog-'))
  tempDirs.push(value)
  return value
}

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function singleEntryZip(entryName: string, bytes: Buffer): Buffer {
  const name = Buffer.from(entryName, 'utf8')
  const compressed = zlib.deflateRawSync(bytes)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(bytes.length, 22)
  local.writeUInt16LE(name.length, 26)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(bytes.length, 24)
  central.writeUInt16LE(name.length, 28)

  const localRecord = Buffer.concat([local, name, compressed])
  const centralRecord = Buffer.concat([central, name])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralRecord.length, 12)
  end.writeUInt32LE(localRecord.length, 16)
  return Buffer.concat([localRecord, centralRecord, end])
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('VIBING Director controlled asset catalog', () => {
  it('searches the static CC0 catalog by Chinese scene terms without downloading', () => {
    const results = listVibingDirectorCatalogAssets('咖啡')

    expect(results.map((asset) => asset.fileName)).toContain('kitchenCoffeeMachine.glb')
    expect(results.map((asset) => asset.fileName)).toContain('tableCoffee.glb')
    expect(results.every((asset) => asset.source === 'kenney' && asset.license === 'CC0 1.0')).toBe(true)
  })

  it('extracts only an exact safe entry from a verified archive buffer', () => {
    const bytes = Buffer.from('glTF-test')
    const archive = singleEntryZip('Models/GLTF format/tableCoffee.glb', bytes)

    expect(extractVerifiedZipEntry(archive, 'Models/GLTF format/tableCoffee.glb')).toEqual(bytes)
    expect(() => extractVerifiedZipEntry(archive, '../tableCoffee.glb')).toThrow(/不安全/)
    expect(() => extractVerifiedZipEntry(archive, 'Models/GLTF format/chair.glb')).toThrow(/缺少/)
  })

  it('coalesces parallel downloads, verifies the pinned hash, and reuses the cache', async () => {
    const model = Buffer.from('glTF-catalog-model')
    const archive = singleEntryZip('Models/GLTF format/tableCoffee.glb', model)
    const fetchArchive = vi.fn(async () => ({
      bytes: archive,
      contentType: 'application/zip',
      status: 200,
      finalUrl: 'https://kenney.nl/media/furniture.zip',
      truncated: false,
    }))
    const options = { fetchArchive, expectedArchiveSha256: sha256(archive) }
    const cacheDir = tempDir()

    const [first, second] = await Promise.all([
      loadVibingDirectorCatalogAssetFile('kenney:furniture-kit:tableCoffee', cacheDir, options),
      loadVibingDirectorCatalogAssetFile('kenney:furniture-kit:tableCoffee', cacheDir, options),
    ])
    const cached = await loadVibingDirectorCatalogAssetFile(
      'kenney:furniture-kit:tableCoffee',
      cacheDir,
      options,
    )

    expect(fetchArchive).toHaveBeenCalledTimes(1)
    expect(first.sourcePath).toBe(second.sourcePath)
    expect(cached.fileSha256).toBe(sha256(model))
    expect(fs.readFileSync(cached.sourcePath)).toEqual(model)
  })

  it('rejects untrusted redirects and archive integrity mismatches', async () => {
    const archive = singleEntryZip('Models/GLTF format/tableCoffee.glb', Buffer.from('glTF'))
    const cacheDir = tempDir()
    const baseResult = {
      bytes: archive,
      contentType: 'application/zip',
      status: 200,
      truncated: false,
    }

    await expect(loadVibingDirectorCatalogAssetFile(
      'kenney:furniture-kit:tableCoffee',
      cacheDir,
      {
        expectedArchiveSha256: sha256(archive),
        fetchArchive: async () => ({ ...baseResult, finalUrl: 'https://example.com/furniture.zip' }),
      },
    )).rejects.toThrow(/未授权来源/)

    await expect(loadVibingDirectorCatalogAssetFile(
      'kenney:furniture-kit:tableCoffee',
      cacheDir,
      {
        expectedArchiveSha256: '0'.repeat(64),
        fetchArchive: async () => ({ ...baseResult, finalUrl: 'https://kenney.nl/furniture.zip' }),
      },
    )).rejects.toThrow(/完整性/)
  })

  it('rejects unknown catalog ids before any network access', async () => {
    const fetchArchive = vi.fn()

    await expect(loadVibingDirectorCatalogAssetFile(
      'kenney:furniture-kit:not-real',
      tempDir(),
      { fetchArchive },
    )).rejects.toThrow(/不存在/)
    expect(fetchArchive).not.toHaveBeenCalled()
  })

  it.runIf(process.env.NOMI_REAL_ASSET_CATALOG_SMOKE === '1')(
    'downloads the pinned official Kenney archive and extracts a real GLB',
    async () => {
      const result = await loadVibingDirectorCatalogAssetFile(
        'kenney:furniture-kit:kitchenCoffeeMachine',
        tempDir(),
      )
      const bytes = fs.readFileSync(result.sourcePath)

      expect(bytes.subarray(0, 4).toString('utf8')).toBe('glTF')
      expect(bytes.length).toBeGreaterThan(1_000)
      expect(result.archiveSha256).toBe('e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0')
    },
    90_000,
  )
})
