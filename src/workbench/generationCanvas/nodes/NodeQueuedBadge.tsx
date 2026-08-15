// 「排队中」角标：已被登记进批次、但还没轮到它开跑的节点。
// 在此之前后续波次的节点在 store 里还是 idle，画布上毫无表示 —— 用户以为自己漏点了。
// 方案：docs/plan/2026-08-02-task-center-queue.md
import { useTranslation } from 'react-i18next'
import { IconClock } from '@tabler/icons-react'

export function NodeQueuedBadge(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="absolute left-2 top-2 z-[3] inline-flex items-center gap-1 rounded-full bg-nomi-paper/85 px-2 py-0.5 text-micro text-nomi-ink-60 shadow-nomi-sm"
      aria-label={t('taskCenter.nodeQueued')}
    >
      <IconClock size={11} stroke={1.8} />
      {t('taskCenter.nodeQueued')}
    </div>
  )
}
