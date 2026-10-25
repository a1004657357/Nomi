import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
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
  subscribe((event) => toast(event.message || i18n.t("canvasComponents.failedToDragTheAssetIntoTheWebpage"), 'error'))
}

export type NodeBrowserUploadDragHandleProps = {
  url: string
}

export function NodeBrowserUploadDragHandle({ url }: NodeBrowserUploadDragHandleProps): JSX.Element | null {
  useTranslation()
  React.useEffect(ensureAssetDragErrorSubscription, [])
  if (!url.startsWith('nomi-local://asset/')) return null

  const handleDragStart = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    try {
      await getDesktopBridge()?.browser?.startAssetDrag?.({ url })
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : i18n.t('taskCenter.actionFailed'), 'error')
    }
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
      aria-label={i18n.t("canvasComponents.dragToUploadOnAWebpage")}
      title={i18n.t("canvasComponents.dragToTheChatGPTOrJimengUploadArea")}
      onClick={(event) => event.stopPropagation()}
      onDragStart={handleDragStart}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <IconPaperclip size={15} stroke={1.8} aria-hidden="true" />
    </div>
  )
}
