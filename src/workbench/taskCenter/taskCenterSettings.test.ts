// 提醒通道的选择规则：窗口在前台一律不打扰（已有 toast），失焦才发；
// 系统通知开着时用 OS 自己的提示音（silent=!sound），不叠自制音效——否则会「叮」两下。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyBatchFinished } from './taskCenterSettings'
import * as bridge from '../../desktop/bridge'

const shown: Array<{ title: string; body?: string; silent?: boolean }> = []

function mockBridge(withNotifications: boolean) {
  vi.spyOn(bridge, 'getDesktopBridge').mockReturnValue(
    (withNotifications
      ? {
          notifications: {
            show: async (payload: { title: string; body?: string; silent?: boolean }) => {
              shown.push(payload)
              return { ok: true }
            },
          },
        }
      : {}) as ReturnType<typeof bridge.getDesktopBridge>,
  )
}

// vitest 环境是 node（仓库没装 jsdom）→ 自己桩 document.hasFocus。
function setFocus(focused: boolean) {
  ;(globalThis as unknown as { document?: unknown }).document = { hasFocus: () => focused }
}

describe('notifyBatchFinished', () => {
  beforeEach(() => {
    shown.length = 0
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as unknown as { document?: unknown }).document
  })

  it('窗口在前台 → 什么都不做（现有 toast 已经在说话了，别重复轰炸）', () => {
    setFocus(true)
    mockBridge(true)
    expect(notifyBatchFinished({ title: 'x', body: 'y', prefs: { sound: true, notify: true } })).toBe('none')
    expect(shown).toHaveLength(0)
  })

  it('失焦 + 通知开 + 声音开 → 发系统通知且不静音（用 OS 的提示音，不另放自制音效）', () => {
    setFocus(false)
    mockBridge(true)
    expect(notifyBatchFinished({ title: '完成', body: '12 个', prefs: { sound: true, notify: true } })).toBe('notification')
    expect(shown[0]).toMatchObject({ title: '完成', body: '12 个', silent: false })
  })

  it('失焦 + 通知开 + 声音关 → 发通知但静音', () => {
    setFocus(false)
    mockBridge(true)
    expect(notifyBatchFinished({ title: '完成', body: '', prefs: { sound: false, notify: true } })).toBe('notification')
    expect(shown[0]?.silent).toBe(true)
  })

  it('失焦 + 通知关 + 声音开 → 退回自制提示音', () => {
    setFocus(false)
    mockBridge(true)
    expect(notifyBatchFinished({ title: '完成', body: '', prefs: { sound: true, notify: false } })).toBe('chime')
    expect(shown).toHaveLength(0)
  })

  it('没有通知桥（老 preload / 浏览器环境）→ 降级到提示音，不静默失败', () => {
    setFocus(false)
    mockBridge(false)
    expect(notifyBatchFinished({ title: '完成', body: '', prefs: { sound: true, notify: true } })).toBe('chime')
  })

  it('两个都关 → 彻底安静', () => {
    setFocus(false)
    mockBridge(true)
    expect(notifyBatchFinished({ title: '完成', body: '', prefs: { sound: false, notify: false } })).toBe('none')
  })
})
