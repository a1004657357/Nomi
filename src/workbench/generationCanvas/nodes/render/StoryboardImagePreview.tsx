import { useTranslation } from 'react-i18next'
import i18n from '../../../../i18n'
import { translateCanvasComponentText } from '../../../../i18n/CanvasComponentText'
import type { JSX } from 'react'
import React from 'react'
import { localAssetThumbnailUrl } from '../../../../design/localAssetThumbnail'
import { cn } from '../../../../utils/cn'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { DeferredNodeImage } from '../DeferredNodeMedia'
import { StoryboardMediaLightbox } from './StoryboardMediaLightbox'
import {
  fitStoryboardMediaPreview,
  readStoryboardMediaAspectRatio,
} from './storyboardMediaPreviewLayout'

const COMPACT_THUMBNAIL_SIZE = { width: 160, height: 160 } as const
const EXPANDED_THUMBNAIL_SIZE = { width: 320, height: 320 } as const

type Props = {
  node: GenerationCanvasNode
  imageUrl: string
  thumbnailUrl?: string
  compact: boolean
  visibilityRoot?: Element | null
  labelKind?: '图片' | '视频封面'
}

export function StoryboardImagePreview({
  node,
  imageUrl,
  thumbnailUrl,
  compact,
  visibilityRoot,
  labelKind = '图片',
}: Props): JSX.Element {
  useTranslation()
  const configuredAspectRatio = readStoryboardMediaAspectRatio(node)
  const [aspectRatio, setAspectRatio] = React.useState(configuredAspectRatio)
  const [lightboxOpen, setLightboxOpen] = React.useState(false)
  const label = node.shotIndex ? i18n.t("canvasComponents.shot549", { v0: node.shotIndex, v1: translateCanvasComponentText(labelKind) }) : node.title || translateCanvasComponentText(labelKind)
  const frameStyle = fitStoryboardMediaPreview(aspectRatio, compact ? 72 : 104)
  const previewUrl = localAssetThumbnailUrl(
    thumbnailUrl || imageUrl,
    compact ? COMPACT_THUMBNAIL_SIZE : EXPANDED_THUMBNAIL_SIZE,
  )

  React.useEffect(() => setAspectRatio(configuredAspectRatio), [configuredAspectRatio, imageUrl])

  const closeLightbox = React.useCallback(() => setLightboxOpen(false), [])

  return (
    <>
      <button
        type="button"
        data-storyboard-media-preview="image"
        data-media-aspect-ratio={aspectRatio}
        aria-label={i18n.t("canvasComponents.preview", { v0: label })}
        title={i18n.t("canvasComponents.doubleClickToEnlargeTheImagePreview")}
        style={frameStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          if (event.detail === 0) setLightboxOpen(true)
        }}
        onDoubleClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setLightboxOpen(true)
        }}
        className={cn(
          'relative block shrink-0 cursor-zoom-in overflow-hidden rounded-nomi-sm border-0 bg-nomi-ink-05 p-0 outline-none',
          'focus-visible:ring-2 focus-visible:ring-nomi-accent/70',
        )}
      >
        <DeferredNodeImage
          src={imageUrl}
          thumbnailSrc={previewUrl || undefined}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
          placeholderClassName="!absolute !inset-0 !z-auto h-full w-full shrink-0 before:hidden after:hidden"
          visibilityRoot={visibilityRoot}
          draggable={false}
          onLoad={(event) => {
            const width = event.currentTarget.naturalWidth
            const height = event.currentTarget.naturalHeight
            if (width > 0 && height > 0) setAspectRatio(width / height)
          }}
        />
      </button>
      <StoryboardMediaLightbox
        open={lightboxOpen}
        type="image"
        src={imageUrl}
        label={label}
        onClose={closeLightbox}
      />
    </>
  )
}
