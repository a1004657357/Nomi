import type { JSX } from 'react'
import React from 'react'
import { createPortal } from 'react-dom'
import { IconCheck, IconPhotoScan, IconRefresh, IconX } from '@tabler/icons-react'
import { getDesktopBridge } from '../../../desktop/bridge'
import { toast } from '../../../ui/toast'
import { isProjectExecutionContextCurrent, withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { createVideoKeyframeNodes } from './createVideoKeyframeNodes'
import {
  buildEvenlySpacedFrameTimes,
  formatVideoFrameTime,
  resolveVideoDurationSeconds,
  type ExtractedVideoKeyframe,
} from './videoKeyframeInspectorModel'

type Props = {
  node: GenerationCanvasNode
  onClose: () => void
}

const FRAME_COUNTS = [6, 8, 12] as const

export default function VideoKeyframeInspectorDialog({ node, onClose }: Props): JSX.Element | null {
  const [frameCount, setFrameCount] = React.useState(8)
  const [frames, setFrames] = React.useState<ExtractedVideoKeyframe[]>([])
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const framesProject = React.useRef<ProjectExecutionContext | null>(null)
  const duration = resolveVideoDurationSeconds(node)
  const videoUrl = node.result?.type === 'video' ? node.result.url : undefined

  const extract = React.useCallback((count: number) => withProjectAction(async project => {
    project.assertCurrent()
    if (!videoUrl || !duration) return
    const projectId = project.binding.projectId
    const extractFrames = getDesktopBridge()?.video?.extractFrames
    if (!extractFrames) {
      toast('关键帧检查器需要 Nomi 桌面端', 'error')
      return
    }
    setBusy(true)
    try {
      const payload = {
        videoUrl,
        projectId,
        projectBinding: project.binding,
        times: buildEvenlySpacedFrameTimes(duration, count),
      }
      const result = await extractFrames(payload)
      project.assertCurrent()
      const next = (result.frames || []).filter((frame) => frame.url)
      framesProject.current = project
      setFrames(next)
      setSelected(new Set(next.map((frame) => frame.timeSeconds)))
    } catch (error) {
      if (!isProjectExecutionContextCurrent(project)) return
      toast(`关键帧抽取失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      if (isProjectExecutionContextCurrent(project)) setBusy(false)
    }
  }, () => { toast('关键帧检查失败：请先打开当前项目', 'error') }), [duration, videoUrl])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    void extract(8)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [extract, onClose])

  if (!videoUrl) return null

  const toggle = (timeSeconds: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(timeSeconds)) next.delete(timeSeconds)
      else next.add(timeSeconds)
      return next
    })
  }

  const createSelected = () => withProjectAction(project => {
    if (!isProjectExecutionContextCurrent(framesProject.current ?? undefined)) {
      toast('项目已变化，请重新抽取关键帧', 'warning')
      return
    }
    project.assertCurrent()
    const chosen = frames.filter((frame) => selected.has(frame.timeSeconds))
    if (!chosen.length) {
      toast('请先选择至少一个关键帧', 'warning')
      return
    }
    const ids = createVideoKeyframeNodes(node, chosen)
    toast(`已创建 ${ids.length} 个关键帧节点`, 'success')
    onClose()
  })

  const dialog = (
    <div
      className="fixed inset-0 z-[3600] grid place-items-center bg-nomi-ink/45 p-5 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="视频关键帧检查器"
      onMouseDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="flex max-h-[88vh] w-[min(980px,94vw)] flex-col overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-lg">
        <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b border-nomi-line px-5 py-4">
          <div className="min-w-0 max-w-full [overflow-wrap:anywhere]">
            <h2 className="text-title-sm font-semibold text-nomi-ink">视频关键帧检查器</h2>
            <p className="mt-1 truncate text-body-sm text-nomi-ink-60">
              {node.title} · {duration ? `${duration.toFixed(2)} 秒` : '未读取到视频时长'}
            </p>
          </div>
          <button type="button" className="grid size-9 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05" onClick={onClose} aria-label="关闭">
            <IconX size={18} stroke={1.6} />
          </button>
        </header>

        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b border-nomi-line px-5 py-3">
          <span className="min-w-0 max-w-full text-body-sm text-nomi-ink-60 [overflow-wrap:anywhere]">抽帧数量</span>
          <div className="inline-flex rounded-nomi-sm border border-nomi-line p-0.5">
            {FRAME_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                className={`min-h-8 min-w-10 rounded-nomi-sm px-2 text-body-sm ${frameCount === count ? 'bg-nomi-ink text-nomi-paper' : 'text-nomi-ink-60 hover:bg-nomi-ink-05'}`}
                onClick={() => setFrameCount(count)}
              >
                {count}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-nomi-sm border border-nomi-line px-3 text-body-sm text-nomi-ink hover:bg-nomi-ink-05 disabled:opacity-45"
            disabled={busy || !duration}
            onClick={() => void extract(frameCount)}
          >
            <IconRefresh size={15} stroke={1.6} />
            {busy ? '抽帧中…' : '重新抽取'}
          </button>
          <span className="min-w-0 max-w-full text-body-sm text-nomi-ink-60 [overflow-wrap:anywhere]">已选 {selected.size} / {frames.length}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!duration ? (
            <div className="grid min-h-64 place-items-center text-body text-nomi-ink-60">请先播放一次视频，让 Nomi 读取真实时长。</div>
          ) : busy && !frames.length ? (
            <div className="grid min-h-64 place-items-center text-body text-nomi-ink-60">正在从同一视频源抽取关键帧…</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {frames.map((frame) => {
                const checked = selected.has(frame.timeSeconds)
                return (
                  <button
                    key={frame.timeSeconds}
                    type="button"
                    className={`group relative overflow-hidden rounded-nomi-sm border bg-nomi-ink-05 text-left ${checked ? 'border-nomi-accent ring-2 ring-nomi-accent/25' : 'border-nomi-line hover:border-nomi-ink-30'}`}
                    onClick={() => toggle(frame.timeSeconds)}
                    aria-pressed={checked}
                  >
                    <div className="aspect-video overflow-hidden bg-nomi-ink">
                      <img src={frame.url} alt={`${formatVideoFrameTime(frame.timeSeconds)} 关键帧`} className="size-full object-contain" draggable={false} />
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-2.5 py-2">
                      <span className="min-w-0 max-w-full font-mono text-caption text-nomi-ink-80 [overflow-wrap:anywhere]">{formatVideoFrameTime(frame.timeSeconds)}</span>
                      <span className={`grid size-5 shrink-0 place-items-center rounded-sm border ${checked ? 'border-nomi-accent bg-nomi-accent text-white' : 'border-nomi-line bg-nomi-paper'}`}>
                        {checked ? <IconCheck size={13} stroke={2} /> : null}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-nomi-line px-5 py-4">
          <button type="button" className="min-h-9 rounded-nomi-sm px-4 text-body-sm text-nomi-ink-60 hover:bg-nomi-ink-05" onClick={onClose}>取消</button>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-2 rounded-nomi-sm bg-nomi-accent px-4 text-body-sm font-medium text-white disabled:opacity-45"
            disabled={!selected.size || busy}
            onClick={createSelected}
          >
            <IconPhotoScan size={16} stroke={1.6} />
            创建 {selected.size} 个关键帧节点
          </button>
        </footer>
      </section>
    </div>
  )

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
