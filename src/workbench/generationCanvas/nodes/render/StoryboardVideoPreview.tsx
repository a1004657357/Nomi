import type { JSX } from 'react'
import React from 'react'
import { IconPlayerPlayFilled, IconVideo } from '@tabler/icons-react'
import { localAssetThumbnailUrl } from '../../../../design/localAssetThumbnail'
import { isProjectExecutionContextCurrent, withProjectAction, type ProjectExecutionContext } from '../../../project/projectCanvasReadSurface'
import { useOpenProjectId } from '../../../project/useOpenProjectId'
import { sameProjectAgentBinding } from '../../../../../electron/shared/projectBinding'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { buildVideoPlaybackUrl } from '../../../../media/videoPlaybackUrl'
import { cn } from '../../../../utils/cn'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { DeferredNodeImage } from '../DeferredNodeMedia'
import {
  observeDeferredNodeMediaVisibility,
  requestDeferredNodeMediaSlot,
  scheduleAfterCanvasShellPaint,
} from '../deferredNodeMediaQueue'
import { StoryboardMediaLightbox } from './StoryboardMediaLightbox'
import {
  fitStoryboardMediaPreview,
  readStoryboardMediaAspectRatio,
} from './storyboardMediaPreviewLayout'

const COMPACT_PREVIEW_SIZE = { width: 160, height: 160 } as const
const EXPANDED_PREVIEW_SIZE = { width: 320, height: 320 } as const
const LIGHTBOX_POSTER_SIZE = { width: 512, height: 512 } as const
const posterCache = new Map<string, { binding: ProjectExecutionContext['binding']; url: string }>()
const posterRequests = new Map<string, { project: ProjectExecutionContext; request: Promise<string> }>()

type Props = {
  node: GenerationCanvasNode
  videoUrl: string
  posterUrl: string
  compact: boolean
  visibilityRoot?: Element | null
}

function posterCacheKey(projectId: string, videoUrl: string): string {
  return `${projectId}::${videoUrl}`
}

function requestVideoPoster(project: ProjectExecutionContext, videoUrl: string): Promise<string> {
  project.assertCurrent()
  const projectId = project.binding.projectId
  const key = posterCacheKey(projectId, videoUrl)
  const cached = posterCache.get(key)
  if (cached && sameProjectAgentBinding(cached.binding, project.binding)) return Promise.resolve(cached.url)
  const pending = posterRequests.get(key)
  if (pending && isProjectExecutionContextCurrent(pending.project)) return pending.request.then(url => { project.assertCurrent(); return url })

  const extractFrame = getDesktopBridge()?.video?.extractFrame
  if (!extractFrame) return Promise.reject(new Error('当前环境不支持视频抽帧'))

  const request = new Promise<string>((resolve, reject) => {
    requestDeferredNodeMediaSlot('video', (release) => {
      void Promise.resolve().then(() => {
        project.assertCurrent()
        return extractFrame({ videoUrl, which: 'first', projectId, projectBinding: project.binding })
      })
        .then((result) => {
          project.assertCurrent()
          const url = String(result?.url || '').trim()
          if (!url) throw new Error('视频抽帧没有返回图片')
          posterCache.set(key, { binding: project.binding, url })
          resolve(url)
        })
        .catch(reject)
        .finally(release)
    })
  })
  posterRequests.set(key, { project, request })
  const removeRequest = () => { if (posterRequests.get(key)?.request === request) posterRequests.delete(key) }
  void request.then(
    removeRequest,
    removeRequest,
  )
  return request
}

function persistVideoPoster(project: ProjectExecutionContext, nodeId: string, videoUrl: string, posterUrl: string): void {
  project.assertCurrent()
  const store = useGenerationCanvasStore.getState()
  const current = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!current?.result || current.result.thumbnailUrl) return
  const currentVideoUrl = String(current.result.url || current.result.providerUrl || '').trim()
  if (currentVideoUrl !== videoUrl) return
  store.updateNode(current.id, {
    result: { ...current.result, thumbnailUrl: posterUrl },
  })
}

export function StoryboardVideoPreview({
  node,
  videoUrl,
  posterUrl,
  compact,
  visibilityRoot,
}: Props): JSX.Element {
  const projectId = useOpenProjectId()
  const key = projectId ? posterCacheKey(projectId, videoUrl) : ''
  const configuredAspectRatio = readStoryboardMediaAspectRatio(node)
  const [extractedPosterUrl, setExtractedPosterUrl] = React.useState('')
  const [previewElement, setPreviewElement] = React.useState<HTMLElement | null>(null)
  const [aspectRatio, setAspectRatio] = React.useState(configuredAspectRatio)
  const [playing, setPlaying] = React.useState(false)
  const [lightboxOpen, setLightboxOpen] = React.useState(false)
  const singleClickTimerRef = React.useRef<number | null>(null)
  const resolvedPosterUrl = posterUrl || extractedPosterUrl

  React.useEffect(() => {
    setExtractedPosterUrl('')
    setAspectRatio(configuredAspectRatio)
    setPlaying(false)
    setLightboxOpen(false)
  }, [configuredAspectRatio, key])

  const clearSingleClickTimer = React.useCallback(() => {
    if (singleClickTimerRef.current === null) return
    window.clearTimeout(singleClickTimerRef.current)
    singleClickTimerRef.current = null
  }, [])

  React.useEffect(() => clearSingleClickTimer, [clearSingleClickTimer])

  React.useEffect(() => {
    if (resolvedPosterUrl || !projectId || !videoUrl || !previewElement || visibilityRoot === null) return undefined
    return withProjectAction(project => {
    project.assertCurrent()
    if (project.binding.projectId !== projectId) return undefined
    let cancelled = false
    let cancelPaintWait = () => {}
    const stopObserving = observeDeferredNodeMediaVisibility(
      previewElement,
      () => {
        cancelPaintWait = scheduleAfterCanvasShellPaint(() => {
          void Promise.resolve().then(() => requestVideoPoster(project, videoUrl))
            .then((url) => {
              if (cancelled) return
              project.assertCurrent()
              setExtractedPosterUrl(url)
              persistVideoPoster(project, node.id, videoUrl, url)
            })
            .catch(() => {
              // The play affordance remains usable when poster extraction fails.
            })
        })
      },
      { root: visibilityRoot },
    )
    return () => {
      cancelled = true
      stopObserving()
      cancelPaintWait()
    }
    })
  }, [node.id, previewElement, projectId, resolvedPosterUrl, videoUrl, visibilityRoot])

  const previewSrc = buildVideoPlaybackUrl(videoUrl)
  const label = node.shotIndex ? `镜头 ${node.shotIndex}` : node.title || '当前镜头'
  const frameStyle = fitStoryboardMediaPreview(aspectRatio, compact ? 72 : 104)
  const lightboxPoster = resolvedPosterUrl
    ? localAssetThumbnailUrl(resolvedPosterUrl, LIGHTBOX_POSTER_SIZE)
    : undefined
  const updateActualAspectRatio = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const width = event.currentTarget.videoWidth
    const height = event.currentTarget.videoHeight
    if (width > 0 && height > 0) setAspectRatio(width / height)
  }
  const closeLightbox = () => setLightboxOpen(false)
  const openLightbox = () => {
    clearSingleClickTimer()
    setPlaying(false)
    setLightboxOpen(true)
  }

  if (!compact) {
    return (
      <>
        <video
          src={previewSrc}
          poster={resolvedPosterUrl ? localAssetThumbnailUrl(resolvedPosterUrl, EXPANDED_PREVIEW_SIZE) : undefined}
          controls
          muted
          playsInline
          preload="metadata"
          data-storyboard-media-preview="video"
          data-media-aspect-ratio={aspectRatio}
          aria-label={`${label}视频预览`}
          title="双击放大视频预览"
          style={frameStyle}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openLightbox()
          }}
          onLoadedMetadata={updateActualAspectRatio}
          className="shrink-0 rounded-nomi-sm bg-nomi-ink-05 object-contain"
        />
        <StoryboardMediaLightbox
          open={lightboxOpen}
          type="video"
          src={previewSrc}
          poster={lightboxPoster}
          label={`${label}视频`}
          onClose={closeLightbox}
        />
      </>
    )
  }

  const previewClassName = 'h-full w-full rounded-nomi-sm bg-nomi-ink-05 object-contain'
  return (
    <>
      <button
        ref={setPreviewElement}
        type="button"
        data-storyboard-media-preview="video"
        data-media-aspect-ratio={aspectRatio}
        aria-label={`${playing ? '停止' : '播放'}${label}视频预览`}
        aria-pressed={playing}
        title="双击放大视频预览"
        style={frameStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          if (event.detail === 0) {
            setPlaying((current) => !current)
            return
          }
          if (event.detail !== 1) return
          clearSingleClickTimer()
          singleClickTimerRef.current = window.setTimeout(() => {
            singleClickTimerRef.current = null
            setPlaying((current) => !current)
          }, 260)
        }}
        onDoubleClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openLightbox()
        }}
        className={cn(
          'group relative block shrink-0 overflow-hidden rounded-nomi-sm border-0 bg-nomi-ink-05 p-0 outline-none',
          'focus-visible:ring-2 focus-visible:ring-nomi-accent/70',
        )}
      >
        {playing ? (
          <video
            src={previewSrc}
            poster={resolvedPosterUrl ? localAssetThumbnailUrl(resolvedPosterUrl, COMPACT_PREVIEW_SIZE) : undefined}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={updateActualAspectRatio}
            className={cn('pointer-events-none', previewClassName)}
          />
        ) : resolvedPosterUrl ? (
          <DeferredNodeImage
            src={resolvedPosterUrl}
            thumbnailSrc={localAssetThumbnailUrl(resolvedPosterUrl, COMPACT_PREVIEW_SIZE)}
            alt=""
            className={cn('absolute inset-0', previewClassName)}
            placeholderClassName={cn(
              '!absolute !inset-0 !z-auto shrink-0 before:hidden after:hidden',
              previewClassName,
            )}
            visibilityRoot={visibilityRoot}
            draggable={false}
            onLoad={(event) => {
              const width = event.currentTarget.naturalWidth
              const height = event.currentTarget.naturalHeight
              if (width > 0 && height > 0) setAspectRatio(width / height)
            }}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-nomi-ink-40" aria-hidden="true">
            <IconVideo size={18} stroke={1.6} />
          </span>
        )}
        {!playing ? (
          <span
            className="absolute inset-0 flex items-center justify-center bg-black/10 text-white transition-colors group-hover:bg-black/25"
            aria-hidden="true"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 shadow-sm">
              <IconPlayerPlayFilled size={12} />
            </span>
          </span>
        ) : null}
      </button>
      <StoryboardMediaLightbox
        open={lightboxOpen}
        type="video"
        src={previewSrc}
        poster={lightboxPoster}
        label={`${label}视频`}
        onClose={closeLightbox}
      />
    </>
  )
}
