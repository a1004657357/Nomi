import type { AssetLibraryDragPayload } from './assetLibraryDrag'
import type { AssetRef } from './assetTypes'

export type AssetLibraryUsageContext = 'canvas' | 'timeline'
export type AssetLibrarySourceFilter = 'all' | 'project' | 'smart'
export type AssetLibraryItemAction = 'preview' | 'select' | 'append'
export type AssetGridActivationEvent = {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  detail: number
}

export const ASSET_LIBRARY_SOURCE_OPTIONS: Array<{
  value: AssetLibrarySourceFilter
  labelKey: string
}> = [
  { value: 'all', labelKey: 'assetLibrary.allAssets' },
  { value: 'project', labelKey: 'assetLibrary.projectAssets' },
  { value: 'smart', labelKey: 'assetLibrary.smartGroups' },
]

export function resolveAssetLibraryItemAction(
  usage: AssetLibraryUsageContext,
  source: Exclude<AssetLibrarySourceFilter, 'smart'>,
): AssetLibraryItemAction {
  if (usage === 'timeline') return 'append'
  return source === 'project' ? 'select' : 'preview'
}

export function canManageAssetFolders(usage: AssetLibraryUsageContext): boolean {
  return usage === 'canvas'
}

export function shouldRunAssetItemAction(action: AssetLibraryItemAction, clickCount: number): boolean {
  return action !== 'append' || clickCount <= 1
}

export function isAssetGridActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' '
}

export function sourceFiltersForUsage(usage: AssetLibraryUsageContext): AssetLibrarySourceFilter[] {
  return usage === 'timeline' ? ['all', 'project'] : ['all', 'project', 'smart']
}

export function sourceOptionsForUsage(usage: AssetLibraryUsageContext): typeof ASSET_LIBRARY_SOURCE_OPTIONS {
  const allowed = new Set(sourceFiltersForUsage(usage))
  return ASSET_LIBRARY_SOURCE_OPTIONS.filter((option) => allowed.has(option.value))
}

export function assetToDragPayload(
  asset: AssetRef,
  dragAnchor?: AssetLibraryDragPayload['dragAnchor'],
): AssetLibraryDragPayload {
  return {
    kind: asset.kind,
    name: asset.name,
    renderUrl: asset.renderUrl,
    origin: asset.origin,
    ...(dragAnchor ? { dragAnchor } : {}),
  }
}

export function assetsForLibraryDrag(
  visibleAssets: readonly AssetRef[],
  selectedIds: ReadonlySet<string>,
  draggedAsset: AssetRef,
): AssetRef[] {
  if (!selectedIds.has(draggedAsset.id)) return [draggedAsset]
  return [
    draggedAsset,
    ...visibleAssets.filter((asset) => asset.id !== draggedAsset.id && selectedIds.has(asset.id)),
  ]
}
