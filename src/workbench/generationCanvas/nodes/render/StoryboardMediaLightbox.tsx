import type { JSX } from 'react'
import React from 'react'
import { IconX } from '@tabler/icons-react'
import { NomiImage } from '../../../../design/media'
import { BodyPortal } from '../../../../design/portal'

type Props = {
  open: boolean
  type: 'image' | 'video'
  src: string
  poster?: string
  label: string
  onClose: () => void
}

export function StoryboardMediaLightbox({
  open,
  type,
  src,
  poster,
  label,
  onClose,
}: Props): JSX.Element | null {
  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [onClose, open])

  if (!open) return null

  return (
    <BodyPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${label}放大预览`}
        data-storyboard-media-lightbox={type}
        className="fixed inset-0 flex items-center justify-center bg-black/90 p-12"
        style={{ zIndex: 9000 }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <button
          type="button"
          aria-label="关闭预览"
          title="关闭预览"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-nomi-sm bg-black/65 text-white hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <IconX size={22} stroke={1.8} />
        </button>
        {type === 'image' ? (
          <NomiImage
            src={src}
            alt={label}
            eager
            className="block max-h-[calc(100vh-96px)] max-w-[calc(100vw-96px)] object-contain"
          />
        ) : (
          <video
            src={src}
            poster={poster}
            controls
            autoPlay
            playsInline
            aria-label={`${label}播放器`}
            className="block max-h-[calc(100vh-96px)] max-w-[calc(100vw-96px)] bg-black object-contain"
            onPointerDown={(event) => event.stopPropagation()}
          />
        )}
      </div>
    </BodyPortal>
  )
}
