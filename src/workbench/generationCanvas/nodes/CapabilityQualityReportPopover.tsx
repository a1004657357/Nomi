import type { JSX } from 'react'
import React from 'react'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type {
  GenerationQualityReport,
  GenerationQualityStatus,
} from '../model/generationCanvasTypes'
import { qualityLabel } from './capabilityQualityPresentation'

function qualityTone(status: GenerationQualityStatus): string {
  if (status === 'pass') return 'text-workbench-success'
  if (status === 'warning') return 'text-nomi-accent'
  if (status === 'fail') return 'text-workbench-danger'
  return 'text-nomi-ink-60'
}

function qualityKindLabel(kind: GenerationQualityReport['kind']): string {
  if (kind === 'grid9') return '九宫格'
  if (kind === 'multiview') return '自定义机位'
  if (kind === 'panorama') return '全景'
  if (kind === 'portrait') return '人像'
  if (kind === 'mood') return '情绪'
  if (kind === 'style') return '风格'
  if (kind === 'video') return '视频'
  return '3D'
}

export function CapabilityQualityStatusIcon({
  status,
  size = 14,
}: {
  status: GenerationQualityStatus
  size?: number
}): JSX.Element {
  const className = cn('shrink-0', qualityTone(status))
  if (status === 'pass') return <IconCircleCheck size={size} stroke={1.9} className={className} aria-hidden="true" />
  if (status === 'warning') return <IconAlertTriangle size={size} stroke={1.9} className={className} aria-hidden="true" />
  if (status === 'fail') return <IconAlertCircle size={size} stroke={1.9} className={className} aria-hidden="true" />
  return <IconInfoCircle size={size} stroke={1.9} className={className} aria-hidden="true" />
}

export function CapabilityQualityReportPopover({
  report,
  className,
  actions,
}: {
  report: GenerationQualityReport
  className?: string
  actions?: React.ReactNode
}): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const kindLabel = qualityKindLabel(report.kind)
  return (
    <div
      className={cn('absolute right-1.5 top-1.5 z-[12]', className)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        data-capability-quality-status={report.status}
        aria-label={`查看质量报告：${qualityLabel(report.status)}`}
        aria-expanded={open}
        title={`${kindLabel}质量报告：${qualityLabel(report.status)}`}
        className={cn(
          'grid size-7 place-items-center rounded-nomi-sm border border-white/70 bg-nomi-paper shadow-nomi-md',
          'hover:bg-nomi-ink-05 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent',
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <CapabilityQualityStatusIcon status={report.status} size={16} />
      </button>
      {open ? (
        <section
          data-capability-quality-report={report.kind}
          className="mt-1.5 max-h-[360px] w-[300px] overflow-auto rounded-nomi border border-nomi-line bg-nomi-paper p-2.5 shadow-nomi-md"
          aria-label={`${kindLabel}质量报告`}
        >
          <header className="mb-2 flex items-center gap-1.5 border-b border-nomi-line pb-2">
            <CapabilityQualityStatusIcon status={report.status} size={16} />
            <span className="text-caption font-semibold text-nomi-ink">本地质量报告</span>
            <span className={cn('ml-auto text-micro font-medium', qualityTone(report.status))}>
              {qualityLabel(report.status)}
            </span>
          </header>
          <div className="space-y-2">
            {report.checks.map((check) => (
              <div key={check.id} data-quality-check={check.id} className="flex items-start gap-1.5">
                <CapabilityQualityStatusIcon status={check.status} size={13} />
                <div className="min-w-0">
                  <div className="text-micro font-semibold text-nomi-ink-80">{check.label}</div>
                  <div className="mt-0.5 text-micro leading-[1.35] text-nomi-ink-60">{check.summary}</div>
                  {check.details?.slice(0, 3).map((detail) => (
                    <div key={detail} className="mt-0.5 text-micro leading-[1.35] text-nomi-ink-40">
                      {detail}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {actions ? (
            <div className="mt-2.5 border-t border-nomi-line pt-2.5">
              {actions}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
