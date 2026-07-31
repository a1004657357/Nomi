// 画布 stage 的拖入收口：三种来源 → 建 asset 节点。
//   1) 项目文件树（nomi-local 引用）  2) 素材库（已托管 renderUrl）  3) OS 原始文件（复制+上传）
// 从 GenerationCanvas 抽出，保持组件壳瘦身（R9）。

import type { DragEvent } from 'react'
import { WORKSPACE_FILE_DRAG_MIME, buildWorkspaceFileUrl, parseWorkspaceFileDrag } from '../../explorer/workspaceFileDrag'
import {
  ASSET_LIBRARY_DRAG_MIME,
  parseAssetLibraryDragItems,
  type AssetLibraryDragPayload,
} from '../../assets/assetLibraryDrag'
import { importLocalMediaFilesToGenerationCanvas } from '../adapters/assetImportAdapter'
import {
  extractClipboardMediaUrl,
  pasteClipboardMediaToGenerationCanvas,
  showClipboardMediaPasteNotes,
} from '../adapters/clipboardImagePaste'
import { getGenerationNodeDefaultSize, getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import { dropKindFromMime } from '../model/nodeAssetDrop'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { toast } from '../../../ui/toast'
import type { BrowserAssetCanvasImportItem } from '../../../ui/browser/overlay/globalAssetPopoverEvents'
import type { TiptapDocJson } from '../model/generationCanvasTypes'
import {
  addCanvasSkillNode,
  CANVAS_SKILL_DRAG_MIME,
  parseCanvasSkillDrag,
} from '../skills/canvasSkillModel'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import { getDesktopBridge, type DesktopAssetDto } from '../../../desktop/bridge'

export const BROWSER_ASSET_DRAG_MIME = 'application/x-nomi-assets'
export const LEGACY_BROWSER_ASSET_DRAG_MIME = 'application/x-nomi-browser-assets'
export const BROWSER_MEDIA_DRAG_MIME = 'application/x-nomi-browser-image'

export type CanvasStageDropContext = {
  readOnly: boolean
  offset: { x: number; y: number }
  zoom: number
  activeCategoryId?: string
}

type BrowserAssetCanvasItem = {
  id: string
  type: 'image' | 'video' | 'prompt'
  title: string
  url?: string
  prompt?: string
}

export type BrowserMediaDragPayload = {
  viewId: number
  url: string
  mediaType: 'image' | 'video'
  title?: string
  fileName?: string
  pageUrl?: string
  pageTitle?: string
}

function clampNodePos(value: number): number {
  return Math.max(40, Math.round(value))
}

function layoutColumns(count: number): number {
  if (count <= 1) return 1
  return Math.min(4, Math.ceil(Math.sqrt(count)))
}

export function layoutBrowserAssetDropPositions(
  basePosition: { x: number; y: number },
  count: number,
): Array<{ x: number; y: number }> {
  if (count <= 0) return []
  const columns = layoutColumns(count)
  const footprint = getGenerationNodeFootprintSize('asset')
  const cellWidth = footprint.width + 36
  const cellHeight = footprint.height + 36
  return Array.from({ length: count }, (_, index) => ({
    x: clampNodePos(basePosition.x + (index % columns) * cellWidth),
    y: clampNodePos(basePosition.y + Math.floor(index / columns) * cellHeight),
  }))
}

export function resolveAssetLibraryDropPosition(
  cursorPosition: { x: number; y: number },
  dragAnchor?: AssetLibraryDragPayload['dragAnchor'],
): { x: number; y: number } {
  if (!dragAnchor) return cursorPosition
  const size = getGenerationNodeDefaultSize('asset')
  return {
    x: cursorPosition.x - size.width * dragAnchor.xRatio,
    y: cursorPosition.y - size.height * dragAnchor.yRatio,
  }
}

function cleanBrowserAssetTitle(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function cleanBrowserAssetPrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function tiptapDocFromPlainText(text: string): TiptapDocJson {
  const lines = text ? text.split(/\r?\n/) : ['']
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  }
}

function normalizeBrowserAssetCanvasItem(item: unknown): BrowserAssetCanvasItem | null {
  if (!item || typeof item !== 'object') return null
  const asset = item as {
    id?: unknown
    type?: unknown
    title?: unknown
    subtitle?: unknown
    previewUrl?: unknown
    url?: unknown
    prompt?: unknown
    text?: unknown
    content?: unknown
  }
  const type = asset.type === 'video' ? 'video' : asset.type === 'image' ? 'image' : asset.type === 'prompt' ? 'prompt' : null
  if (!type) return null
  const title = cleanBrowserAssetTitle(
    asset.title,
    type === 'video' ? '参考视频' : type === 'image' ? '参考图片' : '提示词',
  )
  if (type === 'prompt') {
    const prompt =
      cleanBrowserAssetPrompt(asset.prompt) ||
      cleanBrowserAssetPrompt(asset.text) ||
      cleanBrowserAssetPrompt(asset.content) ||
      cleanBrowserAssetPrompt(asset.subtitle) ||
      title
    return {
      id: typeof asset.id === 'string' ? asset.id : `browser-prompt-${title}`,
      type,
      title,
      prompt,
    }
  }
  const url =
    (typeof asset.previewUrl === 'string' ? asset.previewUrl.trim() : '') ||
    (typeof asset.url === 'string' ? asset.url.trim() : '')
  if (!url) return null
  return {
    id: typeof asset.id === 'string' ? asset.id : `browser-asset-${url}`,
    type,
    title,
    url,
  }
}

function parseBrowserAssetDrag(raw: string | null | undefined): BrowserAssetCanvasItem[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    const items = Array.isArray(value) ? value : [value]
    return items.flatMap((item) => {
      const asset = normalizeBrowserAssetCanvasItem(item)
      return asset ? [asset] : []
    })
  } catch {
    return []
  }
}

export function parseBrowserMediaDrag(raw: string | null | undefined): BrowserMediaDragPayload | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const viewId = Number(value.viewId)
    const url = typeof value.url === 'string' ? value.url.trim() : ''
    if (!Number.isInteger(viewId) || viewId <= 0 || !/^(https?:\/\/|blob:)/i.test(url)) return null
    const mediaType = value.mediaType === 'video' ? 'video' : 'image'
    const optionalString = (key: string): string | undefined => {
      const text = typeof value[key] === 'string' ? String(value[key]).trim() : ''
      return text || undefined
    }
    return {
      viewId,
      url,
      mediaType,
      title: optionalString('title'),
      fileName: optionalString('fileName'),
      pageUrl: optionalString('pageUrl'),
      pageTitle: optionalString('pageTitle'),
    }
  } catch {
    return null
  }
}

export type BrowserMediaDragImportDeps = {
  projectId?: string
  importMedia?: (payload: {
    viewId: number
    projectId: string
    url: string
    fileName?: string
    title?: string
    mediaType: 'image' | 'video'
  }) => Promise<DesktopAssetDto>
}

export async function importBrowserMediaDragToGenerationCanvas(
  payload: BrowserMediaDragPayload,
  options: { basePosition: { x: number; y: number }; categoryId?: string },
  deps: BrowserMediaDragImportDeps = {},
): Promise<{ ok: boolean; nodeId: string; error?: string }> {
  const projectId = deps.projectId ?? getDesktopActiveProjectId()
  const importMedia = deps.importMedia ?? getDesktopBridge()?.browser?.importMedia
  const store = useGenerationCanvasStore.getState()
  const fallbackTitle = payload.mediaType === 'video' ? '网页视频' : '网页图片'
  const displayTitle = payload.title || payload.fileName || payload.pageTitle || fallbackTitle
  const node = store.addNode({
    kind: 'asset',
    title: displayTitle.replace(/\.[^.]+$/, '') || fallbackTitle,
    prompt: '',
    position: {
      x: clampNodePos(options.basePosition.x),
      y: clampNodePos(options.basePosition.y),
    },
    categoryId: options.categoryId,
    exactPosition: true,
    meta: {
      source: 'browser-view-drag',
      sourceUrl: payload.url,
      pageUrl: payload.pageUrl,
      uploadStatus: 'uploading',
    },
  })
  store.updateNode(node.id, {
    status: 'running',
    progress: { phase: 'browser-import', message: '从网页保存中', updatedAt: Date.now() },
  })

  if (!projectId || !importMedia) {
    const error = '当前浏览器会话导入通道不可用，请先拖到素材盒再导入画布。'
    store.updateNode(node.id, { status: 'error', error, progress: undefined })
    return { ok: false, nodeId: node.id, error }
  }

  try {
    const asset = await importMedia({
      viewId: payload.viewId,
      projectId,
      url: payload.url,
      fileName: payload.fileName,
      title: payload.title || payload.pageTitle,
      mediaType: payload.mediaType,
    })
    const localUrl = typeof asset.data.url === 'string' ? asset.data.url.trim() : ''
    if (!localUrl) throw new Error('网页媒体已经下载，但没有返回本地素材地址')
    const contentType = typeof asset.data.contentType === 'string' ? asset.data.contentType : ''
    const mediaType = contentType.startsWith('video/') || asset.data.mediaType === 'video'
      ? 'video'
      : payload.mediaType
    const result = {
      id: `browser-view-${node.id}-${Date.now()}`,
      type: mediaType,
      url: localUrl,
      assetId: asset.id,
      raw: { asset },
      createdAt: Date.now(),
    }
    store.updateNode(node.id, {
      status: 'success',
      error: undefined,
      progress: undefined,
      result,
      history: [result],
      meta: {
        ...(node.meta || {}),
        source: 'browser-view-drag',
        sourceUrl: undefined,
        uploadStatus: 'uploaded',
        fileName: asset.name || payload.fileName,
        contentType,
      },
    })
    return { ok: true, nodeId: node.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const detail = `网页媒体保存失败：${message}。可以打开素材盒，用“捕捞”后再导入画布。`
    store.updateNode(node.id, {
      status: 'error',
      error: detail,
      progress: undefined,
      meta: { ...(node.meta || {}), uploadStatus: 'failed' },
    })
    return { ok: false, nodeId: node.id, error: detail }
  }
}

export type BrowserAssetsToCanvasResult = {
  createdCount: number
  skippedCount: number
  nodeIds: string[]
}

export function importBrowserAssetsToGenerationCanvas(
  assets: readonly BrowserAssetCanvasImportItem[],
  options: { basePosition: { x: number; y: number }; categoryId?: string },
): BrowserAssetsToCanvasResult {
  const normalized = assets.flatMap((asset) => {
    const item = normalizeBrowserAssetCanvasItem(asset)
    return item ? [item] : []
  })
  if (!normalized.length) return { createdCount: 0, skippedCount: assets.length, nodeIds: [] }

  const store = useGenerationCanvasStore.getState()
  const positions = layoutBrowserAssetDropPositions(options.basePosition, normalized.length)
  const nodeIds: string[] = []

  normalized.forEach((asset, index) => {
    const sourceMeta = { source: 'browser-asset', browserAssetId: asset.id, fileName: asset.title }
    if (asset.type === 'prompt') {
      const prompt = asset.prompt || asset.title
      const node = store.addNode({
        kind: 'text',
        title: asset.title.replace(/\.[^.]+$/, '') || '提示词',
        prompt,
        position: positions[index],
        categoryId: options.categoryId,
        exactPosition: true,
        select: false,
        meta: sourceMeta,
      })
      store.updateNode(node.id, { contentJson: tiptapDocFromPlainText(prompt) })
      nodeIds.push(node.id)
      return
    }

    if (!asset.url) return
    const node = store.addNode({
      kind: 'asset',
      title: asset.title.replace(/\.[^.]+$/, '') || (asset.type === 'video' ? '参考视频' : '参考图片'),
      prompt: '',
      position: positions[index],
      categoryId: options.categoryId,
      exactPosition: true,
      select: false,
      meta: sourceMeta,
    })
    const result = {
      id: `browser-asset-${node.id}-${Date.now()}`,
      type: asset.type,
      url: asset.url,
      createdAt: Date.now(),
    }
    store.updateNode(node.id, {
      result,
      history: [result],
      status: 'success',
      meta: { ...(node.meta || {}), ...sourceMeta },
    })
    nodeIds.push(node.id)
  })

  if (nodeIds.length) {
    nodeIds.forEach((nodeId, index) => store.selectNode(nodeId, index > 0))
  }

  return {
    createdCount: nodeIds.length,
    skippedCount: assets.length - nodeIds.length,
    nodeIds,
  }
}

export function handleCanvasStageDrop(event: DragEvent<HTMLDivElement>, ctx: CanvasStageDropContext): void {
  if (ctx.readOnly) return
  const rect = event.currentTarget.getBoundingClientRect()
  const basePosition = {
    x: (event.clientX - rect.left - ctx.offset.x) / ctx.zoom,
    y: (event.clientY - rect.top - ctx.offset.y) / ctx.zoom,
  }

  // 1) 技能库拖入：创建可持久化的 SkillNode，位置与当前画布分类保持一致。
  const canvasSkill = parseCanvasSkillDrag(event.dataTransfer.getData(CANVAS_SKILL_DRAG_MIME))
  if (canvasSkill) {
    event.preventDefault()
    event.stopPropagation()
    addCanvasSkillNode(canvasSkill, {
      x: clampNodePos(basePosition.x - 190),
      y: clampNodePos(basePosition.y - 180),
    }, ctx.activeCategoryId || 'shots')
    return
  }

  // 2) 项目文件树拖入：文件已在项目里，直接用 nomi-local 协议引用，按 kind 建图片/视频 asset 节点。
  const workspaceDrag = parseWorkspaceFileDrag(event.dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME))
  if (workspaceDrag) {
    event.preventDefault()
    event.stopPropagation()
    const kind: 'image' | 'video' = workspaceDrag.kind === 'video' ? 'video' : 'image'
    const url = buildWorkspaceFileUrl(workspaceDrag.projectId, workspaceDrag.relativePath)
    const store = useGenerationCanvasStore.getState()
    const node = store.addNode({
      kind: 'asset',
      title: workspaceDrag.name.replace(/\.[^.]+$/, '') || (kind === 'video' ? '本地视频' : '本地素材'),
      prompt: '',
      position: { x: clampNodePos(basePosition.x), y: clampNodePos(basePosition.y) },
      categoryId: ctx.activeCategoryId,
    })
    const result = { id: `workspace-${node.id}-${Date.now()}`, type: kind, url, createdAt: Date.now() }
    store.updateNode(node.id, {
      result,
      history: [result],
      status: 'success',
      meta: { ...(node.meta || {}), source: 'workspace-file', fileName: workspaceDrag.name, workspaceRelativePath: workspaceDrag.relativePath },
    })
    return
  }

  // 3) 素材库拖入：素材已在池里（画布产出/项目文件），直接引用 renderUrl 建 asset 节点（图片/视频）。
  const assetDragItems = parseAssetLibraryDragItems(event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME))
  if (assetDragItems.length) {
    event.preventDefault()
    event.stopPropagation()
    const mediaItems = assetDragItems.filter((asset) => asset.kind !== 'audio')
    if (!mediaItems.length) {
      toast('音频请拖到时间轴的「音频轨」当配乐', 'info')
      return
    }
    const store = useGenerationCanvasStore.getState()
    const dragAnchor = assetDragItems.find((asset) => asset.dragAnchor)?.dragAnchor
    const anchoredPosition = resolveAssetLibraryDropPosition(basePosition, dragAnchor)
    const positions = layoutBrowserAssetDropPositions(anchoredPosition, mediaItems.length)
    const nodeIds: string[] = []
    mediaItems.forEach((assetDrag, index) => {
      const node = store.addNode({
        kind: 'asset',
        title: assetDrag.name.replace(/\.[^.]+$/, '') || (assetDrag.kind === 'video' ? '参考视频' : '参考图片'),
        prompt: '',
        position: positions[index],
        categoryId: ctx.activeCategoryId,
        exactPosition: true,
        select: false,
      })
      const result = { id: `asset-ref-${node.id}-${Date.now()}`, type: assetDrag.kind, url: assetDrag.renderUrl, createdAt: Date.now() }
      const originMeta = assetDrag.origin.source === 'project'
        ? { source: 'workspace-file', fileName: assetDrag.name, workspaceRelativePath: assetDrag.origin.relativePath }
        : { source: 'asset-library', fileName: assetDrag.name, referencedNodeId: assetDrag.origin.nodeId }
      store.updateNode(node.id, {
        result,
        history: [result],
        status: 'success',
        meta: { ...(node.meta || {}), ...originMeta },
      })
      nodeIds.push(node.id)
    })
    nodeIds.forEach((nodeId, index) => store.selectNode(nodeId, index > 0))
    if (mediaItems.length < assetDragItems.length) toast('音频请拖到时间轴的「音频轨」当配乐', 'info')
    return
  }

  // 4) 浏览器素材盒拖入：图片/视频创建媒体 asset 节点；提示词创建 text 节点。
  const browserAssets = parseBrowserAssetDrag(
    event.dataTransfer.getData(BROWSER_ASSET_DRAG_MIME) || event.dataTransfer.getData(LEGACY_BROWSER_ASSET_DRAG_MIME),
  )
  if (browserAssets.length) {
    event.preventDefault()
    event.stopPropagation()
    importBrowserAssetsToGenerationCanvas(browserAssets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      title: asset.title,
      previewUrl: asset.url,
      prompt: asset.prompt,
    })), {
      basePosition,
      categoryId: ctx.activeCategoryId,
    })
    return
  }

  // 5) 内置浏览器媒体直拖：用来源 WebContentsView 的登录会话下载，支持防盗链与 blob:。
  const browserMedia = parseBrowserMediaDrag(event.dataTransfer.getData(BROWSER_MEDIA_DRAG_MIME))
  if (browserMedia) {
    event.preventDefault()
    event.stopPropagation()
    void importBrowserMediaDragToGenerationCanvas(browserMedia, {
      basePosition,
      categoryId: ctx.activeCategoryId,
    }).then((result) => {
      if (result.ok) toast(browserMedia.mediaType === 'video' ? '网页视频已保存到画布' : '网页图片已保存到画布', 'success')
      else toast(result.error || '网页媒体保存失败', 'error')
    })
    return
  }

  // 6) OS 文件拖入：复制进项目并上传，创建图片 / 视频素材节点（音频无可落节点，过滤）。
  const files = Array.from(event.dataTransfer.files || []).filter((file) => {
    const kind = dropKindFromMime(file.type)
    return kind === 'image' || kind === 'video'
  })
  if (!files.length) {
    const mediaUrl = extractClipboardMediaUrl(event.dataTransfer)
    if (!mediaUrl) return
    event.preventDefault()
    event.stopPropagation()
    void pasteClipboardMediaToGenerationCanvas({
      clipboardData: event.dataTransfer,
      basePosition,
      categoryId: ctx.activeCategoryId,
    }).then(showClipboardMediaPasteNotes).catch(() => {})
    return
  }
  event.preventDefault()
  event.stopPropagation()
  void importLocalMediaFilesToGenerationCanvas(files, { basePosition, categoryId: ctx.activeCategoryId }).then((result) => {
    // C5：超限截断 / 上传失败不再静默——聚合成一句人话提示（此前 >8 张悄悄丢、失败只在节点上红）。
    const notes: string[] = []
    if (result.skippedOverLimitCount > 0) notes.push(`超过 8 个，已忽略 ${result.skippedOverLimitCount} 个`)
    if (result.skippedTooLargeCount > 0) notes.push(`${result.skippedTooLargeCount} 个文件过大`)
    if (result.failedCount > 0) notes.push(`${result.failedCount} 个导入失败`)
    if (notes.length) toast(notes.join('；'), result.failedCount > 0 ? 'error' : 'info')
  }).catch(() => {})
}
