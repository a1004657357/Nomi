import type { JSX } from 'react'
import React from 'react'
import { createPortal } from 'react-dom'
import {
  IconArrowsDiff,
  IconColumns,
  IconLayersIntersect,
  IconMaximize,
  IconRefresh,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import {
  resolveImageComparisonInputs,
  type ImageComparisonInput,
} from './imageComparisonModel'

type ComparisonMode = 'wipe' | 'side' | 'overlay'

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-nomi-sm border-0 cursor-pointer',
        active ? 'bg-nomi-accent text-white' : 'bg-nomi-ink-05 text-nomi-ink-60 hover:text-nomi-ink',
      )}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  )
}

function ComparisonSurface({
  inputs,
  mode,
  position,
  overlayOpacity,
  zoom,
  onPositionChange,
}: {
  inputs: ImageComparisonInput[]
  mode: ComparisonMode
  position: number
  overlayOpacity: number
  zoom: number
  onPositionChange: (value: number) => void
}): JSX.Element {
  if (inputs.length < 2) {
    return (
      <div className="grid h-full w-full place-items-center bg-nomi-ink-05 px-6 text-center text-small text-nomi-ink-60">
        {inputs.length === 0 ? '连接两张图片进行对比' : '再连接一张图片'}
      </div>
    )
  }
  const imageClass = 'h-full w-full select-none object-contain'
  if (mode === 'side') {
    return (
      <div className="grid h-full w-full grid-cols-2 gap-px bg-nomi-line">
        {inputs.map((input, index) => (
          <div key={input.nodeId} className="relative min-h-0 overflow-hidden bg-black">
            <img src={input.url} alt="" draggable={false} className={imageClass} style={{ transform: `scale(${zoom})` }} />
            <span className="absolute left-2 top-2 rounded-nomi-sm bg-black/65 px-2 py-1 text-micro text-white">
              {index === 0 ? 'A' : 'B'} · {input.title}
            </span>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <img src={inputs[0].url} alt="" draggable={false} className={imageClass} style={{ transform: `scale(${zoom})` }} />
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={mode === 'wipe'
          ? { clipPath: `inset(0 ${100 - position}% 0 0)` }
          : { opacity: overlayOpacity / 100 }}
      >
        <img src={inputs[1].url} alt="" draggable={false} className={imageClass} style={{ transform: `scale(${zoom})` }} />
      </div>
      {mode === 'wipe' ? (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-white shadow" style={{ left: `${position}%` }} />
          <input
            type="range"
            min={0}
            max={100}
            value={position}
            aria-label="图像对比位置"
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
            onChange={(event) => onPositionChange(Number(event.target.value))}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </>
      ) : null}
      <span className="absolute left-2 top-2 rounded-nomi-sm bg-black/65 px-2 py-1 text-micro text-white">A · {inputs[0].title}</span>
      <span className="absolute right-2 top-2 rounded-nomi-sm bg-black/65 px-2 py-1 text-micro text-white">B · {inputs[1].title}</span>
    </div>
  )
}

export default function ImageComparisonNodeBody({ node }: { node: GenerationCanvasNode }): JSX.Element {
  const inputs = useGenerationCanvasStore((state) => resolveImageComparisonInputs(node.id, state.nodes, state.edges))
  const [mode, setMode] = React.useState<ComparisonMode>('wipe')
  const [position, setPosition] = React.useState(50)
  const [overlayOpacity, setOverlayOpacity] = React.useState(50)
  const [zoom, setZoom] = React.useState(1)
  const [fullscreen, setFullscreen] = React.useState(false)

  React.useEffect(() => {
    if (!fullscreen) return undefined
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [fullscreen])

  const controls = (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-nomi-line bg-nomi-paper px-2">
      <IconButton label="滑杆对比" active={mode === 'wipe'} onClick={() => setMode('wipe')}>
        <IconArrowsDiff size={16} stroke={1.8} />
      </IconButton>
      <IconButton label="并排对比" active={mode === 'side'} onClick={() => setMode('side')}>
        <IconColumns size={16} stroke={1.8} />
      </IconButton>
      <IconButton label="叠加对比" active={mode === 'overlay'} onClick={() => setMode('overlay')}>
        <IconLayersIntersect size={16} stroke={1.8} />
      </IconButton>
      {mode === 'overlay' ? (
        <input
          type="range"
          min={0}
          max={100}
          value={overlayOpacity}
          aria-label="叠加图透明度"
          className="mx-2 min-w-20 flex-1 accent-nomi-accent"
          onChange={(event) => setOverlayOpacity(Number(event.target.value))}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : <span className="flex-1" />}
      <IconButton label="缩小" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>
        <IconZoomOut size={16} stroke={1.8} />
      </IconButton>
      <IconButton label="重置缩放" onClick={() => setZoom(1)}>
        <IconRefresh size={16} stroke={1.8} />
      </IconButton>
      <IconButton label="放大" onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>
        <IconZoomIn size={16} stroke={1.8} />
      </IconButton>
      {!fullscreen ? (
        <IconButton label="全屏对比" onClick={() => setFullscreen(true)}>
          <IconMaximize size={16} stroke={1.8} />
        </IconButton>
      ) : null}
    </div>
  )
  const surface = (
    <ComparisonSurface
      inputs={inputs}
      mode={mode}
      position={position}
      overlayOpacity={overlayOpacity}
      zoom={zoom}
      onPositionChange={setPosition}
    />
  )

  return (
    <>
      <div className="flex h-full w-full flex-col overflow-hidden rounded-nomi bg-nomi-paper ring-1 ring-inset ring-nomi-line">
        {controls}
        <div className="min-h-0 flex-1">{surface}</div>
      </div>
      {fullscreen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[10030] flex h-[100dvh] w-screen flex-col bg-black text-white"
              role="dialog"
              aria-modal="true"
              aria-label="全屏图像对比"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex min-h-12 min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b border-white/15 bg-black px-3">
                <span className="min-w-0 max-w-full text-body-sm font-medium [overflow-wrap:anywhere]">图像对比</span>
                <div className="shrink-0">
                  <IconButton label="关闭全屏对比" onClick={() => setFullscreen(false)}>
                    <IconX size={17} stroke={1.8} />
                  </IconButton>
                </div>
              </div>
              <div className="bg-nomi-paper text-nomi-ink">{controls}</div>
              <div className="min-h-0 flex-1">{surface}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
