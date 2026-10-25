import { NODE_SCROLL_REGION_CLASS_NAME } from '../nodeScrollRegionClassName'
import { useTranslation } from 'react-i18next'
import i18n from '../../../../i18n'
import type { JSX } from 'react'
import React from 'react'
import { IconArchive, IconCheck, IconFile3d, IconFolderOpen, IconMusic, IconPhoto, IconVideo } from '@tabler/icons-react'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { toast } from '../../../../ui/toast'
import { buildVideoPlaybackUrl } from '../../../../media/videoPlaybackUrl'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../../project/projectCanvasReadSurface'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import {
  resolveOutputCollectorItems,
  resolveOutputCollectorSelection,
  type OutputCollectorItem,
} from '../outputCollectorModel'
import { StoryboardMediaLightbox } from './StoryboardMediaLightbox'

export default function OutputCollectorNodeBody({ node }: { node: GenerationCanvasNode }): JSX.Element {
  useTranslation()
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const items = React.useMemo(
    () => resolveOutputCollectorItems(node.id, nodes, edges),
    [edges, node.id, nodes],
  )
  const selected = React.useMemo(
    () => resolveOutputCollectorSelection(node, items),
    [items, node],
  )
  const [collectionName, setCollectionName] = React.useState(
    typeof node.meta?.outputCollectionName === 'string' ? node.meta.outputCollectionName : node.title,
  )
  const [busy, setBusy] = React.useState(false)
  const [lightbox, setLightbox] = React.useState<OutputCollectorItem | null>(null)
  const lastArchive = node.meta?.outputCollectorLastArchive
  const lastManifest = lastArchive && typeof lastArchive === 'object'
    ? (lastArchive as Record<string, unknown>).manifestRelativePath
    : null

  const writeSelection = (next: Set<string>) => {
    updateNode(node.id, {
      meta: {
        ...(node.meta || {}),
        outputCollectorSelectionInitialized: true,
        outputCollectorSelectedIds: [...next],
      },
    })
  }

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    writeSelection(next)
  }

  const archive = () => withProjectAction(async project => {
    project.assertCurrent()
    const chosen = items.filter((item) => selected.has(item.id))
    if (!chosen.length) {
      toast(i18n.t("canvasComponents.selectAtLeastOneOutputFirst"), 'warning')
      return
    }
    const projectId = project.binding.projectId
    const bridge = getDesktopBridge()
    if (!projectId || !bridge?.assets.archiveOutputCollection) {
      toast(i18n.t("canvasComponents.localArchivingRequiresASavedProjectInTheNomiDesktop"), 'error')
      return
    }
    setBusy(true)
    try {
      const payload = {
        projectId,
        projectBinding: project.binding,
        collectionName: collectionName.trim() || node.title,
        items: chosen.map((item) => ({
          nodeId: item.sourceNodeId,
          resultId: item.result.id,
          title: item.title,
          type: item.result.type,
          url: item.result.url,
          createdAt: item.result.createdAt,
        })),
      }
      const result = await bridge.assets.archiveOutputCollection(payload)
      project.assertCurrent()
      updateNode(node.id, {
        meta: {
          ...(node.meta || {}),
          outputCollectionName: collectionName.trim() || node.title,
          outputCollectorLastArchive: {
            archivedAt: result.archivedAt,
            relativeDirectory: result.relativeDirectory,
            manifestRelativePath: result.manifestRelativePath,
            itemCount: result.items.length,
          },
        },
      })
      toast(i18n.t("canvasComponents.archivedOutputs", { v0: result.items.length }), 'success')
    } catch (error) {
      if (!isProjectExecutionContextCurrent(project)) return
      toast(i18n.t("canvasComponents.archiveFailed", { v0: error instanceof Error ? error.message : String(error) }), 'error')
    } finally {
      if (isProjectExecutionContextCurrent(project)) setBusy(false)
    }
  }, () => { toast(i18n.t("canvasComponents.localArchivingRequiresAnOpenProjectInTheNomiDesktop"), 'error') })

  const reveal = () => withProjectAction(async project => {
    project.assertCurrent()
    const projectId = project.binding.projectId
    if (typeof lastManifest !== 'string') return
    try {
      const payload = { projectId, projectBinding: project.binding, relativePath: lastManifest }
      await getDesktopBridge()?.workspace.revealFile(payload)
      project.assertCurrent()
    } catch (error) {
      if (!isProjectExecutionContextCurrent(project)) return
      toast(i18n.t("canvasComponents.cannotOpenTheArchiveFolder", { v0: error instanceof Error ? error.message : String(error) }), 'error')
    }
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-nomi-paper p-3 text-nomi-ink">
      <div className="flex shrink-0 items-center gap-2">
        <input
          value={collectionName}
          onChange={(event) => setCollectionName(event.currentTarget.value)}
          onBlur={() => updateNode(node.id, {
            meta: { ...(node.meta || {}), outputCollectionName: collectionName.trim() || node.title },
          })}
          className="min-h-8 min-w-0 flex-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 text-body-sm outline-none focus:border-nomi-accent"
          aria-label={i18n.t("canvasComponents.archiveName")}
          placeholder={i18n.t("canvasComponents.outputCollection")}
        />
        <button
          type="button"
          className="min-h-8 rounded-nomi-sm px-2 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05"
          onClick={() => writeSelection(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}
        >
          {selected.size === items.length ? i18n.t("canvasComponents.deselectAll") : i18n.t("canvasComponents.selectAll")}
        </button>
      </div>

      <div className={`${NODE_SCROLL_REGION_CLASS_NAME} mt-3 min-h-0 flex-1 overflow-y-auto`}>
        {!items.length ? (
          <div className="grid h-full min-h-48 place-items-center px-5 text-center text-body-sm leading-relaxed text-nomi-ink-60">{i18n.t("canvasComponents.connectImageOrVideoNodesThatAlreadyHaveResultsHere")}</div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {items.map((item) => {
              const checked = selected.has(item.id)
              const MediaIcon = item.result.type === 'video'
                ? IconVideo
                : item.result.type === 'audio'
                  ? IconMusic
                  : item.result.type === 'model3d'
                    ? IconFile3d
                    : IconPhoto
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`relative min-w-0 overflow-hidden rounded-nomi-sm border bg-nomi-ink-05 text-left ${checked ? 'border-nomi-accent ring-1 ring-nomi-accent/30' : 'border-nomi-line'}`}
                  onClick={() => toggle(item.id)}
                  onDoubleClick={() => {
                    if (item.result.type === 'image' || item.result.type === 'video') setLightbox(item)
                  }}
                  aria-pressed={checked}
                >
                  <div className="grid aspect-video place-items-center overflow-hidden bg-nomi-ink">
                    {item.result.type === 'image' ? (
                      <img src={item.result.url} alt="" className="size-full object-contain" draggable={false} />
                    ) : item.result.type === 'video' ? (
                      <video src={buildVideoPlaybackUrl(item.result.url)} className="size-full object-contain" muted playsInline preload="metadata" />
                    ) : (
                      <MediaIcon size={28} stroke={1.5} className="text-white/70" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <MediaIcon size={13} stroke={1.7} className="shrink-0 text-nomi-ink-40" />
                    <span className="min-w-0 flex-1 truncate text-caption">{item.title}</span>
                    <span className={`grid size-4 shrink-0 place-items-center rounded-sm border ${checked ? 'border-nomi-accent bg-nomi-accent text-white' : 'border-nomi-line bg-nomi-paper'}`}>
                      {checked ? <IconCheck size={11} stroke={2.2} /> : null}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-nomi-line pt-3">
        <button
          type="button"
          className="inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-nomi-sm bg-nomi-ink px-3 text-body-sm text-nomi-paper hover:bg-nomi-accent disabled:opacity-45"
          disabled={!selected.size || busy}
          onClick={() => void archive()}
        >
          <IconArchive size={16} stroke={1.7} />
          {busy ? i18n.t("canvasComponents.archiving") : i18n.t("canvasComponents.archiveItems", { v0: selected.size })}
        </button>
        {typeof lastManifest === 'string' ? (
          <button type="button" className="grid size-9 place-items-center rounded-nomi-sm border border-nomi-line text-nomi-ink-60 hover:bg-nomi-ink-05" title={i18n.t("canvasComponents.showTheLatestArchiveInFinder")} aria-label={i18n.t("canvasComponents.openLatestArchive")} onClick={() => void reveal()}>
            <IconFolderOpen size={17} stroke={1.7} />
          </button>
        ) : null}
      </div>

      {lightbox && (lightbox.result.type === 'image' || lightbox.result.type === 'video') ? (
        <StoryboardMediaLightbox
          open
          type={lightbox.result.type}
          src={lightbox.result.type === 'video' ? buildVideoPlaybackUrl(lightbox.result.url) : lightbox.result.url}
          label={lightbox.title}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  )
}
