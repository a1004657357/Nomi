import type { JSX } from 'react'
import React from 'react'
import { IconPaperclip } from '@tabler/icons-react'
import { getDesktopBridge } from '../../../desktop/bridge'
import { toast } from '../../../ui/toast'
import { cn } from '../../../utils/cn'

let assetDragErrorSubscribed = false

function ensureAssetDragErrorSubscription(): void {
  if (assetDragErrorSubscribed) return
  const subscribe = getDesktopBridge()?.browser?.onAssetDragError
  if (!subscribe) return
  assetDragErrorSubscribed = true
  subscribe((event) => toast(event.message || '素材拖入网页失败', 'error'))
}

export type NodeBrowserUploadDragHandleProps = {
  url: string
}

export function NodeBrowserUploadDragHandle({ url }: NodeBrowserUploadDragHandleProps): JSX.Element | null {
  React.useEffect(ensureAssetDragErrorSubscription, [])
  if (!url.startsWith('nomi-local://asset/')) return null

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    getDesktopBridge()?.browser?.startAssetDrag?.({ url })
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      className={cn(
        'absolute left-2 top-[-10px] z-[10] grid size-7 place-items-center rounded-full',
        'pointer-events-none border border-nomi-line bg-nomi-paper text-nomi-ink-60 opacity-0 shadow-nomi-sm',
        'cursor-grab transition-[opacity,color,box-shadow] duration-150 active:cursor-grabbing',
        'group-hover/node:pointer-events-auto group-hover/node:opacity-100',
        'group-focus-within/node:pointer-events-auto group-focus-within/node:opacity-100',
        'hover:text-nomi-ink hover:shadow-nomi-md',
        'focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent',
      )}
      aria-label="拖到网页上传"
      title="拖到 ChatGPT 或即梦上传区"
      onClick={(event) => event.stopPropagation()}
      onDragStart={handleDragStart}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <IconPaperclip size={15} stroke={1.8} aria-hidden="true" />
    </div>
  )
}
