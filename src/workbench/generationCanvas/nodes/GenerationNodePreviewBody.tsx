import React from 'react'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode, GenerationResultCollection } from '../model/generationCanvasTypes'
import { CapabilityResultCollection } from './CapabilityResultCollection'
import { DeferredNodeImage } from './DeferredNodeMedia'
import { NodeVideoPlaybackGuard } from './NodeVideoPlaybackGuard'
import PanoramaUploadFallback from './PanoramaUploadFallback'
import type { PanoramaScreenshot } from './PanoramaViewer'
import {
  PendingGenerationPlaceholder,
  RemoveBackgroundPendingPlaceholder,
  Scene3DEditorLoading,
} from './render/CardCommon'

const Scene3DEditor = lazyWithChunkBoundary('3D 场景编辑器', () => import('./Scene3DEditor'))
const VibingDirectorEditor = lazyWithChunkBoundary('VIBING Director', () => import('./VibingDirectorEditor'))
const Model3DCameraNodeBody = lazyWithChunkBoundary('3D 机位代理', () => import('./model3d/Model3DCameraNodeBody'))
const PanoramaViewer = lazyWithChunkBoundary('全景预览', () => import('./PanoramaViewer'))
const CreativeResourceNodeBody = lazyWithChunkBoundary('创作资源', () => import('./render/CreativeResourceNodeBody'))
const CanvasSkillNodeBody = lazyWithChunkBoundary('画布技能', () => import('./render/CanvasSkillNodeBody'))
const ImageComparisonNodeBody = lazyWithChunkBoundary('图像对比', () => import('./render/ImageComparisonNodeBody'))
const OutputCollectorNodeBody = lazyWithChunkBoundary('输出收集', () => import('./render/OutputCollectorNodeBody'))

function NodeBodyLoading(): JSX.Element {
  return <div className="h-full w-full rounded-nomi bg-nomi-paper shadow-nomi-md ring-1 ring-inset ring-nomi-line" />
}

type GenerationNodePreviewBodyProps = {
  node: GenerationCanvasNode
  readOnly: boolean
  resultCollection?: GenerationResultCollection
  visualSize: { width: number; height: number }
  previewHeight: number
  mediaPreviewPriority: boolean
  isRemoveBackgroundPending: boolean
  selected: boolean
  needsFirstFrame: boolean
  hasFrameSourceEdge: boolean
  shotIndex: number | null
  localImagePreviewUrl?: string
  useLocalImagePreview: boolean
  displayPrompt: string
  onPanoramaFullscreen: (trigger: (() => void) | null) => void
  onPanoramaScreenshot: (screenshot: PanoramaScreenshot) => void
  onPanoramaFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  updateMediaDimensions: (width: number, height: number, durationSeconds?: number) => void
}

export function GenerationNodePreviewBody({
  node,
  readOnly,
  resultCollection,
  visualSize,
  previewHeight,
  mediaPreviewPriority,
  isRemoveBackgroundPending,
  selected,
  needsFirstFrame,
  hasFrameSourceEdge,
  shotIndex,
  localImagePreviewUrl,
  useLocalImagePreview,
  displayPrompt,
  onPanoramaFullscreen,
  onPanoramaScreenshot,
  onPanoramaFileChange,
  updateMediaDimensions,
}: GenerationNodePreviewBodyProps): JSX.Element {
  if (resultCollection) {
    return <CapabilityResultCollection node={node} readOnly={readOnly} mediaPreviewPriority={mediaPreviewPriority} />
  }
  if (node.kind === 'resource') {
    return (
      <React.Suspense fallback={<NodeBodyLoading />}>
        <CreativeResourceNodeBody node={node} />
      </React.Suspense>
    )
  }
  if (node.kind === 'skill') {
    return (
      <React.Suspense fallback={<NodeBodyLoading />}>
        <CanvasSkillNodeBody node={node} readOnly={readOnly} />
      </React.Suspense>
    )
  }
  if (node.kind === 'compare') {
    return (
      <React.Suspense fallback={<NodeBodyLoading />}>
        <ImageComparisonNodeBody node={node} />
      </React.Suspense>
    )
  }
  if (node.kind === 'output') {
    return (
      <React.Suspense fallback={<NodeBodyLoading />}>
        <OutputCollectorNodeBody node={node} />
      </React.Suspense>
    )
  }
  if (node.kind === 'vibingDirector' || node.kind === 'scene3d') {
    const Director = node.kind === 'vibingDirector' ? VibingDirectorEditor : Scene3DEditor
    return (
      <React.Suspense fallback={<Scene3DEditorLoading />}>
        <Director node={node} width={visualSize.width} height={previewHeight} readOnly={readOnly} />
      </React.Suspense>
    )
  }
  if (node.kind === 'panorama') {
    const imageUrl = node.result?.url || (typeof node.meta?.imageUrl === 'string' ? node.meta.imageUrl : '')
    return imageUrl ? (
      <React.Suspense fallback={<NodeBodyLoading />}>
        <PanoramaViewer
          imageUrl={imageUrl}
          width={visualSize.width}
          height={previewHeight}
          onEnterFullscreen={onPanoramaFullscreen}
          onScreenshot={onPanoramaScreenshot}
        />
      </React.Suspense>
    ) : (
      <PanoramaUploadFallback onChange={onPanoramaFileChange} />
    )
  }
  if (node.result?.url) {
    if (node.result.type === 'model3d') {
      return (
        <React.Suspense fallback={<Scene3DEditorLoading />}>
          <Model3DCameraNodeBody node={node} readOnly={readOnly} />
        </React.Suspense>
      )
    }
    if (node.result.type === 'video') {
      return (
        <NodeVideoPlaybackGuard
          nodeId={node.id}
          rawUrl={node.result.url}
          data-node-preview-video="true"
          className={cn('w-full h-full min-h-0 object-contain pointer-events-auto', 'bg-nomi-ink-05 select-none')}
          priority={mediaPreviewPriority}
          crossOrigin="use-credentials"
          controls
          muted
          playsInline
          preload="metadata"
          draggable={false}
          onLoadedMetadata={(event) => {
            updateMediaDimensions(
              event.currentTarget.videoWidth,
              event.currentTarget.videoHeight,
              event.currentTarget.duration,
            )
          }}
        />
      )
    }
    return (
      <DeferredNodeImage
        className={cn(
          'w-full h-full min-h-0 object-contain pointer-events-none select-none',
          isRemoveBackgroundPending && 'blur-sm scale-[1.02] transition-[filter,opacity]',
          isRemoveBackgroundPending && '[animation:_remove-bg-pulse_1.5s_ease-in-out_infinite]',
        )}
        src={node.result.url}
        thumbnailSrc={localImagePreviewUrl}
        priority={mediaPreviewPriority}
        alt=""
        onLoad={(event) => {
          if (!useLocalImagePreview) {
            updateMediaDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
          }
        }}
      />
    )
  }
  if (isRemoveBackgroundPending) {
    return <RemoveBackgroundPendingPlaceholder title={node.title} progress={node.progress?.percent} />
  }
  return (
    <PendingGenerationPlaceholder
      selected={selected}
      needsFirstFrame={needsFirstFrame}
      waitingUpstream={hasFrameSourceEdge}
      shotIndex={shotIndex}
      title={node.title}
      prompt={displayPrompt}
    />
  )
}
