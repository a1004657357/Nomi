// 任务跑完的提醒（声音 / 系统通知）。持久化统一归主进程自动化设置，任务中心不再另存一份。
// 方案：docs/plan/2026-08-02-task-center-queue.md
//
// 规则：**只在窗口失焦时打扰**。窗口开着就走现有的 toast（batchPlanPreview 里那条汇总），
// 不重复轰炸 —— 一个事件一个通道。
//
// 声音怎么发：系统通知开着时用 OS 自己的提示音（Electron Notification 的 silent 选项，
// 查过官方文档 electron/docs/api/notification.md），不叠加自制音效、不会"叮"两下；
// 只有「要声音但关了通知」才用 WebAudio 合成一声。**全程不打包音频文件** ——
// 既不增产物体积，也避开 bundle-asset-url-must-not-persist 那个坑。
import { getDesktopBridge } from '../../desktop/bridge'

export type TaskCenterPrefs = {
  sound: boolean
  notify: boolean
}

const DEFAULT_PREFS: TaskCenterPrefs = { sound: true, notify: true }
let cachedPrefs = DEFAULT_PREFS

export function getTaskCenterPrefsSnapshot(): TaskCenterPrefs {
  return cachedPrefs
}

export async function readTaskCenterPrefs(): Promise<TaskCenterPrefs> {
  try {
    const stored = await getDesktopBridge()?.settings?.automationPolicy?.get()
    cachedPrefs = stored
      ? { sound: stored.notificationSound, notify: stored.systemNotifications }
      : DEFAULT_PREFS
  } catch {
    cachedPrefs = DEFAULT_PREFS
  }
  return cachedPrefs
}

/** 窗口在不在前台。失焦才提醒的判据。 */
export function isWindowFocused(): boolean {
  try {
    return typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true
  } catch {
    return true
  }
}

/** WebAudio 合成两声短音（不打包音频文件）。测试环境无 AudioContext 时静默降级。 */
export function playCompletionChime(): void {
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const start = ctx.currentTime
    ;[0, 0.16].forEach((offset, index) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = index === 0 ? 660 : 880
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.12, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.14)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start + offset)
      osc.stop(start + offset + 0.16)
    })
    window.setTimeout(() => {
      try {
        void ctx.close()
      } catch {
        /* ignore */
      }
    }, 600)
  } catch {
    /* 没有音频设备 / 被策略拦：静默，不该因为提示音失败影响生成收尾。 */
  }
}

/**
 * 批次跑完的提醒。窗口在前台 → 什么都不做（已有 toast）。
 * 返回实际用了哪条通道，便于测试断言与走查核对。
 */
export function notifyBatchFinished(input: {
  title: string
  body: string
  prefs: TaskCenterPrefs
}): 'none' | 'notification' | 'chime' {
  if (isWindowFocused()) return 'none'
  const { prefs } = input
  if (prefs.notify) {
    const bridge = getDesktopBridge()
    if (bridge?.notifications?.show) {
      // silent = 不要 OS 提示音。用户开着「声音」就让 OS 自己响，别再叠一层自制音效。
      void bridge.notifications.show({ title: input.title, body: input.body, silent: !prefs.sound }).catch(() => undefined)
      return 'notification'
    }
  }
  if (prefs.sound) {
    playCompletionChime()
    return 'chime'
  }
  return 'none'
}
