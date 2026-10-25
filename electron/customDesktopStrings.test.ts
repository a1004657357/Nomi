import { describe, expect, it } from 'vitest'
import { desktopT } from './desktopStrings'
import { enCustomIntegrations, zhCustomIntegrations } from './locales/customIntegrations'

const WORKFLOW_KEYS = [
  'custom.workflow.blockingUrl', 'custom.workflow.blockingCall', 'custom.workflow.blockingAbsolutePath',
  'custom.workflow.browserHostDenied', 'custom.workflow.browserMatched', 'custom.workflow.browserProtocol',
  'custom.workflow.browserInvalidUrl', 'custom.workflow.gate8PlanReview', 'custom.workflow.gate8Fullscreen',
  'custom.workflow.gate8BlenderPreview', 'custom.workflow.gate8Export', 'custom.workflow.gate8Import',
  'custom.workflow.gate8Image', 'custom.workflow.gate8Video', 'custom.workflow.gate8Assets',
  'custom.workflow.timelineImageTrack', 'custom.workflow.timelineVideoTrack', 'custom.workflow.timelineShot',
  'custom.workflow.timelineAudioTrack',
] as const

describe('custom desktop integration translations', () => {
  it('keeps every existing Chinese message and its English counterpart', () => {
    const keys = Object.keys(zhCustomIntegrations) as (keyof typeof zhCustomIntegrations)[]
    expect(keys).toHaveLength(202 + WORKFLOW_KEYS.length)
    expect(keys.filter(key => key.startsWith('custom.workflow.')).sort()).toEqual([...WORKFLOW_KEYS].sort())
    expect(Object.keys(enCustomIntegrations).sort()).toEqual([...keys].sort())
    const placeholders = (text: string) => [...text.matchAll(/\{\{[^}]+\}\}/g)].map(match => match[0]).sort()
    for (const key of keys) {
      expect(desktopT(key, {}, 'zh-CN')).toBe(zhCustomIntegrations[key])
      expect(desktopT(key, {}, 'en')).toBe(enCustomIntegrations[key])
      expect(enCustomIntegrations[key]).not.toMatch(/[\u3400-\u9fff]/)
      expect(placeholders(enCustomIntegrations[key])).toEqual(placeholders(zhCustomIntegrations[key]))
    }
  })

  it('inserts values literally without replacement tokens or recursive interpolation', () => {
    const value0 = '$& $$ $1 {{value1}}'
    expect(desktopT('custom.runtime.text4', { value0, value1: 'network detail' }, 'zh-CN'))
      .toBe(`${value0} 扩展运行器启动失败：network detail`)
    expect(desktopT('custom.runtime.text4', { value0, value1: 'network detail' }, 'en'))
      .toBe(`The ${value0} extension runner failed to start: network detail`)
  })

  it('keeps the existing task mismatch explanation in Chinese by default', () => {
    expect(desktopT('custom.pavoWeb.bridge.text21', {}, 'zh-CN')).toBe('Pavo Web 返回的任务标识不匹配')
    expect(desktopT('custom.ai.codexImagegenRunner.text3', { value0: 300 }, 'zh-CN'))
      .toBe('Codex Img2 长时间无进展（300 秒没有输出）')
  })
})
