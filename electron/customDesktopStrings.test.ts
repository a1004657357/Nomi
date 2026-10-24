import { describe, expect, it } from 'vitest'
import { desktopT } from './desktopStrings'
import { enCustomIntegrations, zhCustomIntegrations } from './locales/customIntegrations'

describe('custom desktop integration translations', () => {
  it('keeps every existing Chinese message and its English counterpart', () => {
    const keys = Object.keys(zhCustomIntegrations) as (keyof typeof zhCustomIntegrations)[]
    expect(keys).toHaveLength(202)
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
