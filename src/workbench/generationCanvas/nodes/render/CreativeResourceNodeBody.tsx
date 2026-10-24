import type { JSX } from 'react'
import { IconBrush, IconPalette, IconSparkles, IconUserCheck } from '@tabler/icons-react'
import type { CreativeResource } from '../../../../config/capabilityRecipes'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { cn } from '../../../../utils/cn'
import { DeferredNodeImage } from '../DeferredNodeMedia'

const KIND_LABEL: Record<CreativeResource['kind'], string> = {
  style: '风格',
  effect: '效果',
  identity: '身份',
  palette: '色板',
}

const KIND_ICON = {
  style: IconBrush,
  effect: IconSparkles,
  identity: IconUserCheck,
  palette: IconPalette,
} as const

export function CreativeResourceNodeBody({ node }: { node: GenerationCanvasNode }): JSX.Element {
  const resource = node.creativeResource
  if (!resource) {
    return <div className="grid h-full place-items-center text-caption text-nomi-ink-40">资源数据不可用</div>
  }
  const Icon = KIND_ICON[resource.kind]
  const previewUrl = node.result?.thumbnailUrl || node.result?.url
  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-nomi bg-nomi-paper ring-1 ring-inset ring-nomi-line shadow-nomi-md')}>
      {previewUrl ? (
        <div className="h-[104px] shrink-0 overflow-hidden bg-nomi-ink-05">
          <DeferredNodeImage className="h-full w-full object-cover" src={previewUrl} priority={false} alt="" />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <span className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent">
            <Icon size={15} stroke={1.7} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="truncate text-body-sm font-medium text-nomi-ink">{resource.label}</div>
            <div className="text-micro text-nomi-ink-60">{KIND_LABEL[resource.kind]}</div>
          </div>
        </div>
        {resource.description ? <p className="m-0 line-clamp-2 text-caption leading-relaxed text-nomi-ink-60">{resource.description}</p> : null}
        {resource.promptTokens.length ? (
          <div className="flex min-h-0 flex-wrap content-start gap-1 overflow-hidden">
            {resource.promptTokens.slice(0, 6).map((token) => (
              <span key={token} className="rounded-nomi-sm bg-nomi-ink-05 px-1.5 py-0.5 text-micro text-nomi-ink-60">{token}</span>
            ))}
          </div>
        ) : null}
        <div className="mt-auto truncate text-micro text-nomi-ink-40">
          商用：{resource.license?.commercialUse === 'allowed' ? '允许' : resource.license?.commercialUse === 'restricted' ? '受限' : '待确认'}
        </div>
      </div>
    </div>
  )
}

export default CreativeResourceNodeBody
