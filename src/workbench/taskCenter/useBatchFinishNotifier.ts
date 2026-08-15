// 批次跑完 → 失焦时提醒（系统通知 / 提示音）。
// 方案：docs/plan/2026-08-02-task-center-queue.md
//
// 只订阅「批次从未完成翻成已完成」这一个瞬间；窗口在前台什么都不做（已有 toast，别重复轰炸）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useGenerationQueueStore } from '../generationCanvas/runner/generationQueueStore'
import { getTaskCenterPrefsSnapshot, notifyBatchFinished, readTaskCenterPrefs } from './taskCenterSettings'

export function useBatchFinishNotifier(): void {
  const { t } = useTranslation()
  React.useEffect(() => {
    void readTaskCenterPrefs()
    // 已提醒过的批次：订阅回调可能因无关状态变化多次触发，靠这个集合保证一批只响一次。
    const announced = new Set<string>()
    for (const batch of Object.values(useGenerationQueueStore.getState().batches)) {
      if (batch.finishedAt) announced.add(batch.id)
    }
    return useGenerationQueueStore.subscribe((state) => {
      for (const batch of Object.values(state.batches)) {
        if (!batch.finishedAt || announced.has(batch.id)) continue
        announced.add(batch.id)
        const settled = state.entries.filter((entry) => entry.batchId === batch.id)
        const ok = settled.filter((entry) => entry.state === 'success').length
        const failed = settled.filter((entry) => entry.state === 'error').length
        // 单发生成也会走到这（自建 1 节点批次）——那种就别提醒了，太吵。
        if (settled.length <= 1) continue
        notifyBatchFinished({
          title: t('taskCenter.notification.title'),
          body:
            failed > 0
              ? t('taskCenter.notification.bodyWithFailures', { successes: ok, failures: failed })
              : t('taskCenter.notification.body', { count: ok }),
          prefs: getTaskCenterPrefsSnapshot(),
        })
      }
    })
  }, [t])
}
