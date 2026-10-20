import type { JSX } from 'react'
import React from 'react'
import {
  IconBadgeCc,
  IconCircleCheck,
  IconCube,
  IconDownload,
  IconExternalLink,
  IconFolderPlus,
  IconSearch,
} from '@tabler/icons-react'
import type { VibingDirectorCatalogAsset } from '../../../../desktop/vibingDirectorBridgeTypes'
import { NomiLoadingMark, WorkbenchIconButton } from '../../../../design'
import { toast } from '../../../../ui/toast'
import type {
  BlenderDirectorAsset,
  BlenderDirectorAssetSource,
} from './vibingDirectorState'

const ASSET_SOURCE_LABEL: Record<BlenderDirectorAssetSource, string> = {
  local: '本地已授权文件',
  kenney: 'Kenney 开源目录',
  polyhaven: 'Poly Haven',
  quaternius: 'Quaternius',
  blenderkit: 'BlenderKit',
}

type VibingDirectorAssetLibraryProps = {
  assets: BlenderDirectorAsset[]
  readOnly: boolean
  onImportAsset: (
    source: BlenderDirectorAssetSource,
    license?: string,
  ) => Promise<BlenderDirectorAsset | null>
  onListCatalogAssets: (query: string) => Promise<VibingDirectorCatalogAsset[]>
  onImportCatalogAsset: (catalogAssetId: string) => Promise<BlenderDirectorAsset>
  onAssetImported: (asset: BlenderDirectorAsset) => void
  onOpenAssetSource: (source: Exclude<BlenderDirectorAssetSource, 'local'>) => void
}

export default function VibingDirectorAssetLibrary({
  assets,
  readOnly,
  onImportAsset,
  onListCatalogAssets,
  onImportCatalogAsset,
  onAssetImported,
  onOpenAssetSource,
}: VibingDirectorAssetLibraryProps): JSX.Element {
  const [assetSource, setAssetSource] = React.useState<BlenderDirectorAssetSource>('kenney')
  const [assetLicense, setAssetLicense] = React.useState('')
  const [localBusy, setLocalBusy] = React.useState(false)
  const [catalogQuery, setCatalogQuery] = React.useState('')
  const [catalogItems, setCatalogItems] = React.useState<VibingDirectorCatalogAsset[]>([])
  const [catalogLoading, setCatalogLoading] = React.useState(false)
  const [catalogError, setCatalogError] = React.useState('')
  const [catalogImportingId, setCatalogImportingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (assetSource !== 'kenney') return
    let disposed = false
    const timer = window.setTimeout(() => {
      setCatalogLoading(true)
      setCatalogError('')
      void onListCatalogAssets(catalogQuery)
        .then((items) => {
          if (!disposed) setCatalogItems(items)
        })
        .catch((error: unknown) => {
          if (!disposed) {
            setCatalogItems([])
            setCatalogError(error instanceof Error ? error.message : '无法读取开源资产目录')
          }
        })
        .finally(() => {
          if (!disposed) setCatalogLoading(false)
        })
    }, 180)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [assetSource, catalogQuery, onListCatalogAssets])

  const importLocalAsset = React.useCallback(async () => {
    if (localBusy || readOnly || assetSource === 'kenney') return
    setLocalBusy(true)
    try {
      const asset = await onImportAsset(assetSource, assetLicense.trim() || undefined)
      if (!asset) return
      onAssetImported(asset)
      setAssetLicense('')
      toast(`已导入资产「${asset.name}」`, 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '导入 Blender 资产失败', 'error')
    } finally {
      setLocalBusy(false)
    }
  }, [assetLicense, assetSource, localBusy, onAssetImported, onImportAsset, readOnly])

  const importCatalogAsset = React.useCallback(async (catalogAssetId: string) => {
    if (catalogImportingId || readOnly) return
    setCatalogImportingId(catalogAssetId)
    try {
      const asset = await onImportCatalogAsset(catalogAssetId)
      onAssetImported(asset)
      toast(`已下载并导入「${asset.name}」`, 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '下载开源资产失败', 'error')
    } finally {
      setCatalogImportingId(null)
    }
  }, [catalogImportingId, onAssetImported, onImportCatalogAsset, readOnly])

  const importedCatalogIds = React.useMemo(
    () => new Set(assets.map((asset) => asset.provenance?.catalogAssetId).filter(Boolean)),
    [assets],
  )

  return (
    <aside
      className="flex min-h-[400px] flex-col border-t border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] xl:min-h-0 xl:border-l xl:border-t-0"
      data-director-asset-library="true"
    >
      <header className="flex items-center gap-2 border-b border-[var(--workbench-border)] px-3 py-2.5">
        <IconFolderPlus size={16} className="text-[var(--workbench-muted)]" />
        <span className="min-w-0 flex-1 text-body-sm font-medium">Blender 资产库</span>
        {assetSource !== 'local' ? (
          <WorkbenchIconButton
            label={`打开 ${ASSET_SOURCE_LABEL[assetSource]}`}
            icon={<IconExternalLink size={15} />}
            onClick={() => onOpenAssetSource(assetSource)}
          />
        ) : null}
      </header>

      {!readOnly ? (
        <div className="space-y-2 border-b border-[var(--workbench-border)] p-3">
          <select
            className="h-8 w-full rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--workbench-ink)]"
            aria-label="资产来源"
            value={assetSource}
            onChange={(event) => setAssetSource(event.target.value as BlenderDirectorAssetSource)}
          >
            {Object.entries(ASSET_SOURCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>

          {assetSource === 'kenney' ? (
            <>
              <label className="relative block">
                <IconSearch
                  size={14}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--workbench-muted)]"
                />
                <input
                  className="h-8 w-full rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] pl-7 pr-2 text-caption text-[var(--workbench-ink)] placeholder:text-[var(--workbench-muted)]"
                  aria-label="搜索开源三维资产"
                  placeholder="咖啡、桌子、椅子、灯…"
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                />
              </label>
              <div className="flex items-center gap-1.5 text-micro text-[var(--workbench-muted)]">
                <IconBadgeCc size={13} />
                Kenney Furniture Kit 1.0 · CC0
              </div>
            </>
          ) : (
            <>
              <input
                className="h-8 w-full rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--workbench-ink)] placeholder:text-[var(--workbench-muted)]"
                aria-label="资产许可证"
                placeholder="许可证（未填写则标记为需确认）"
                value={assetLicense}
                onChange={(event) => setAssetLicense(event.target.value)}
              />
              <button
                type="button"
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-transparent px-2 text-caption text-[var(--workbench-ink)] hover:bg-[var(--nomi-ink-05)] disabled:opacity-40"
                disabled={localBusy}
                onClick={() => { void importLocalAsset() }}
              >
                {localBusy ? <NomiLoadingMark size={14} /> : <IconFolderPlus size={14} />}
                导入本地模型
              </button>
            </>
          )}
        </div>
      ) : null}

      {assetSource === 'kenney' && !readOnly ? (
        <div className="min-h-0 flex-1 overflow-y-auto" data-director-asset-catalog="kenney">
          {catalogLoading ? (
            <div className="flex items-center gap-2 px-3 py-5 text-caption text-[var(--workbench-muted)]">
              <NomiLoadingMark size={15} />正在读取目录
            </div>
          ) : catalogError ? (
            <div className="px-3 py-5 text-caption leading-5 text-workbench-danger">{catalogError}</div>
          ) : catalogItems.length ? catalogItems.map((item) => {
            const imported = importedCatalogIds.has(item.id)
            const importing = catalogImportingId === item.id
            return (
              <div
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2 border-b border-[var(--workbench-border)] px-3 py-2.5 last:border-b-0"
                data-catalog-asset-id={item.id}
              >
                <div className="min-w-0">
                  <div className="truncate text-caption font-medium">{item.name}</div>
                  <div className="mt-1 text-micro text-[var(--workbench-muted)]">GLB · {item.license}</div>
                </div>
                <WorkbenchIconButton
                  label={imported ? `${item.name} 已导入` : `导入 ${item.name}`}
                  icon={importing
                    ? <NomiLoadingMark size={14} />
                    : imported
                      ? <IconCircleCheck size={15} />
                      : <IconDownload size={15} />}
                  disabled={imported || Boolean(catalogImportingId)}
                  onClick={() => { void importCatalogAsset(item.id) }}
                />
              </div>
            )
          }) : (
            <div className="px-3 py-5 text-caption text-[var(--workbench-muted)]">没有匹配的三维资产</div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {assets.length ? assets.map((asset) => (
            <div key={asset.id} className="border-b border-[var(--workbench-border)] px-3 py-2.5 last:border-b-0">
              <div className="truncate text-caption font-medium">{asset.name}</div>
              <div className="mt-1 flex items-center gap-1.5 text-micro text-[var(--workbench-muted)]">
                <IconCube size={12} />{asset.format} · {ASSET_SOURCE_LABEL[asset.source]}
              </div>
              <div className="mt-1 truncate text-micro text-[var(--workbench-muted)]">{asset.license}</div>
            </div>
          )) : (
            <div className="px-3 py-5 text-caption leading-5 text-[var(--workbench-muted)]">当前项目还没有 Director 资产</div>
          )}
        </div>
      )}
    </aside>
  )
}
