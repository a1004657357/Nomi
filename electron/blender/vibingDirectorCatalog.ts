import { desktopT } from "../desktopStrings";
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { hardenedFetch, type HardenedFetchResult } from '../hardenedFetch'
import {
  importVibingDirectorAsset,
  type ImportedVibingDirectorAsset,
} from './vibingDirectorAssets'

const KENNEY_FURNITURE_PACK = {
  id: 'kenney-furniture-kit-1.0',
  archiveSha256: 'e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0',
  archiveUrl: 'https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip',
  sourcePageUrl: 'https://kenney.nl/assets/furniture-kit',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
} as const

const KENNEY_FURNITURE_ASSET_NAMES = `
bathroomCabinet bathroomCabinetDrawer bathroomMirror bathroomSink bathroomSinkSquare
bathtub bear bedBunk bedDouble bedSingle bench benchCushion benchCushionLow
bookcaseClosed bookcaseClosedDoors bookcaseClosedWide bookcaseOpen bookcaseOpenLow books
cabinetBed cabinetBedDrawer cabinetBedDrawerTable cabinetTelevision cabinetTelevisionDoors
cardboardBoxClosed cardboardBoxOpen ceilingFan chair chairCushion chairDesk
chairModernCushion chairModernFrameCushion chairRounded coatRack coatRackStanding
computerKeyboard computerMouse computerScreen desk deskCorner doorway doorwayFront doorwayOpen
dryer floorCorner floorCornerRound floorFull floorHalf hoodLarge hoodModern kitchenBar
kitchenBarEnd kitchenBlender kitchenCabinet kitchenCabinetCornerInner kitchenCabinetCornerRound
kitchenCabinetDrawer kitchenCabinetUpper kitchenCabinetUpperCorner kitchenCabinetUpperDouble
kitchenCabinetUpperLow kitchenCoffeeMachine kitchenFridge kitchenFridgeBuiltIn
kitchenFridgeLarge kitchenFridgeSmall kitchenMicrowave kitchenSink kitchenStove
kitchenStoveElectric lampRoundFloor lampRoundTable lampSquareCeiling lampSquareFloor
lampSquareTable lampWall laptop loungeChair loungeChairRelax loungeDesignChair
loungeDesignSofa loungeDesignSofaCorner loungeSofa loungeSofaCorner loungeSofaLong
loungeSofaOttoman paneling pillow pillowBlue pillowBlueLong pillowLong plantSmall1
plantSmall2 plantSmall3 pottedPlant radio rugDoormat rugRectangle rugRound rugRounded rugSquare
shower showerRound sideTable sideTableDrawers speaker speakerSmall stairs stairsCorner
stairsOpen stairsOpenSingle stoolBar stoolBarSquare table tableCloth tableCoffee
tableCoffeeGlass tableCoffeeGlassSquare tableCoffeeSquare tableCross tableCrossCloth tableGlass
tableRound televisionAntenna televisionModern televisionVintage toaster toilet toiletSquare
trashcan wall wallCorner wallCornerRond wallDoorway wallDoorwayWide wallHalf wallWindow
wallWindowSlide washer washerDryerStacked
`.trim().split(/\s+/)

const SEARCH_ALIASES: ReadonlyArray<[RegExp, string]> = [
  [/coffee/i, '咖啡 咖啡店 coffee cafe'],
  [/table|desk/i, '桌子 桌 台面 table desk'],
  [/chair|stool|bench/i, '椅子 座椅 凳子 chair seat stool'],
  [/sofa|lounge/i, '沙发 休闲椅 sofa lounge'],
  [/lamp|ceilingFan/i, '灯 灯具 吊灯 台灯 落地灯 ceiling light'],
  [/plant/i, '植物 盆栽 绿植 plant'],
  [/computer|laptop/i, '电脑 笔记本 键盘 鼠标 显示器 computer'],
  [/kitchen/i, '厨房 厨具 kitchen'],
  [/book/i, '书 书架 book'],
  [/wall|door/i, '墙 门 窗 建筑 wall door window'],
  [/rug/i, '地毯 rug carpet'],
  [/television|radio|speaker/i, '电视 音响 收音机 media'],
]

export type VibingDirectorCatalogAsset = {
  id: string
  name: string
  fileName: string
  format: 'glb'
  source: 'kenney'
  license: 'CC0 1.0'
  packId: typeof KENNEY_FURNITURE_PACK.id
  sourcePageUrl: string
  licenseUrl: string
}

export type ImportVibingDirectorCatalogAssetInput = {
  projectId: string
  directorNodeId: string
  catalogAssetId: string
  cacheDir: string
}

type CatalogFetch = (
  url: string,
  options: Parameters<typeof hardenedFetch>[1],
) => Promise<HardenedFetchResult>

type CatalogLoadOptions = {
  fetchArchive?: CatalogFetch
  expectedArchiveSha256?: string
}

const archiveLoads = new Map<string, Promise<Buffer>>()

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function humanizeAssetName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase())
}

function catalogId(name: string): string {
  return `kenney:furniture-kit:${name}`
}

function assetNameFromCatalogId(id: string): string {
  const prefix = 'kenney:furniture-kit:'
  const name = String(id || '').trim().startsWith(prefix) ? String(id).trim().slice(prefix.length) : ''
  if (!KENNEY_FURNITURE_ASSET_NAMES.includes(name)) throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text1"))
  return name
}

function searchText(name: string): string {
  const aliases = SEARCH_ALIASES
    .filter(([pattern]) => pattern.test(name))
    .map(([, value]) => value)
  return [name, humanizeAssetName(name), ...aliases].join(' ').toLocaleLowerCase()
}

function catalogAsset(name: string): VibingDirectorCatalogAsset {
  return {
    id: catalogId(name),
    name: humanizeAssetName(name),
    fileName: `${name}.glb`,
    format: 'glb',
    source: 'kenney',
    license: 'CC0 1.0',
    packId: KENNEY_FURNITURE_PACK.id,
    sourcePageUrl: KENNEY_FURNITURE_PACK.sourcePageUrl,
    licenseUrl: KENNEY_FURNITURE_PACK.licenseUrl,
  }
}

export function listVibingDirectorCatalogAssets(query = '', limit = 60): VibingDirectorCatalogAsset[] {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase()
  const terms = normalizedQuery.split(/\s+/).filter(Boolean)
  const safeLimit = Math.max(1, Math.min(140, Number.isFinite(limit) ? Math.floor(limit) : 60))
  return KENNEY_FURNITURE_ASSET_NAMES
    .filter((name) => {
      if (!terms.length) return true
      const haystack = searchText(name)
      return terms.every((term) => haystack.includes(term))
    })
    .slice(0, safeLimit)
    .map(catalogAsset)
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text2"))
}

export function extractVerifiedZipEntry(archive: Buffer, entryName: string): Buffer {
  if (!entryName || entryName.includes('..') || path.isAbsolute(entryName)) {
    throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text3"))
  }
  const endOffset = findEndOfCentralDirectory(archive)
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12)
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16)
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize
  if (centralDirectoryEnd > endOffset || centralDirectoryOffset < 0) {
    throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text4"))
  }

  let cursor = centralDirectoryOffset
  while (cursor < centralDirectoryEnd) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text5"))
    }
    const flags = archive.readUInt16LE(cursor + 8)
    const compression = archive.readUInt16LE(cursor + 10)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const fileNameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const localHeaderOffset = archive.readUInt32LE(cursor + 42)
    const fileNameStart = cursor + 46
    const fileNameEnd = fileNameStart + fileNameLength
    const fileName = archive.subarray(fileNameStart, fileNameEnd).toString('utf8')
    cursor = fileNameEnd + extraLength + commentLength
    if (fileName !== entryName) continue
    if ((flags & 0x1) !== 0) throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text6"))
    if (uncompressedSize <= 0 || uncompressedSize > 16 * 1024 * 1024) {
      throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text7"))
    }
    if (localHeaderOffset + 30 > archive.length || archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text8"))
    }
    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > archive.length) throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text9"))
    const compressed = archive.subarray(dataStart, dataEnd)
    const bytes = compression === 0
      ? Buffer.from(compressed)
      : compression === 8
        ? zlib.inflateRawSync(compressed, { maxOutputLength: 16 * 1024 * 1024 })
        : null
    if (!bytes) throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text10", { value0: `${compression}` }))
    if (bytes.length !== uncompressedSize) throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text11"))
    return bytes
  }
  throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text12"))
}

function writeFileAtomic(targetPath: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(tempPath, bytes, { flag: 'wx' })
    fs.renameSync(tempPath, targetPath)
  } finally {
    fs.rmSync(tempPath, { force: true })
  }
}

async function loadVerifiedArchive(cacheDir: string, options: CatalogLoadOptions): Promise<Buffer> {
  const expectedHash = options.expectedArchiveSha256 || KENNEY_FURNITURE_PACK.archiveSha256
  const archivePath = path.join(path.resolve(cacheDir), `${KENNEY_FURNITURE_PACK.id}-${expectedHash}.zip`)
  const cached = fs.existsSync(archivePath) ? fs.readFileSync(archivePath) : null
  if (cached && sha256(cached) === expectedHash) return cached
  if (cached) fs.rmSync(archivePath, { force: true })

  const existingLoad = archiveLoads.get(archivePath)
  if (existingLoad) return existingLoad
  const load = (async () => {
    const result = await (options.fetchArchive || hardenedFetch)(
      KENNEY_FURNITURE_PACK.archiveUrl,
      {
        timeoutMs: 60_000,
        maxBytes: 8 * 1024 * 1024,
        allowContentTypes: ['application/zip', 'application/octet-stream'],
        allowRedirect: true,
        headers: { 'User-Agent': 'Nomi/0.16 VIBING-Director-Asset-Catalog' },
      },
    )
    const finalUrl = new URL(result.finalUrl)
    if (finalUrl.protocol !== 'https:' || !['kenney.nl', 'www.kenney.nl'].includes(finalUrl.hostname)) {
      throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text13"))
    }
    if (sha256(result.bytes) !== expectedHash) throw new Error(desktopT("custom.blender.vibingDirectorCatalog.text14"))
    writeFileAtomic(archivePath, result.bytes)
    return result.bytes
  })()
  archiveLoads.set(archivePath, load)
  try {
    return await load
  } finally {
    archiveLoads.delete(archivePath)
  }
}

export async function loadVibingDirectorCatalogAssetFile(
  catalogAssetId: string,
  cacheDir: string,
  options: CatalogLoadOptions = {},
): Promise<{ asset: VibingDirectorCatalogAsset; sourcePath: string; archiveSha256: string; fileSha256: string }> {
  const name = assetNameFromCatalogId(catalogAssetId)
  const asset = catalogAsset(name)
  const archive = await loadVerifiedArchive(cacheDir, options)
  const bytes = extractVerifiedZipEntry(archive, `Models/GLTF format/${asset.fileName}`)
  const fileSha256 = sha256(bytes)
  const sourcePath = path.join(path.resolve(cacheDir), KENNEY_FURNITURE_PACK.id, 'models', asset.fileName)
  const existing = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath) : null
  if (!existing || sha256(existing) !== fileSha256) writeFileAtomic(sourcePath, bytes)
  return {
    asset,
    sourcePath,
    archiveSha256: options.expectedArchiveSha256 || KENNEY_FURNITURE_PACK.archiveSha256,
    fileSha256,
  }
}

export async function importVibingDirectorCatalogAsset(
  input: ImportVibingDirectorCatalogAssetInput,
): Promise<{ asset: ImportedVibingDirectorAsset; relativePath: string }> {
  const loaded = await loadVibingDirectorCatalogAssetFile(input.catalogAssetId, input.cacheDir)
  return importVibingDirectorAsset({
    projectId: input.projectId,
    directorNodeId: input.directorNodeId,
    sourcePath: loaded.sourcePath,
    source: 'kenney',
    license: loaded.asset.license,
    provenance: {
      provider: 'kenney',
      catalogAssetId: loaded.asset.id,
      packId: loaded.asset.packId,
      sourcePageUrl: loaded.asset.sourcePageUrl,
      downloadUrl: KENNEY_FURNITURE_PACK.archiveUrl,
      licenseUrl: loaded.asset.licenseUrl,
      archiveSha256: loaded.archiveSha256,
      fileSha256: loaded.fileSha256,
    },
  })
}
