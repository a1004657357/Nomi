import { describe, expect, it } from 'vitest'
import { generationSpendsCredits } from './spendConfirm'

const node = (vendor?: string) => ({ meta: vendor ? { modelVendor: vendor } : {} })

describe('本地 ComfyUI 不花额度 → 不该弹付费确认卡（真机走查抓到的假话+白挡一次点击）', () => {
  it('本地 ComfyUI：不花', () => {
    expect(generationSpendsCredits([node('comfyui-local')])).toBe(false)
  })

  it('第 2 台起的实例同样不花（前缀派生）', () => {
    expect(generationSpendsCredits([node('comfyui-local-workstation')])).toBe(false)
  })

  it('批量全是本地 → 不花', () => {
    expect(generationSpendsCredits([node('comfyui-local'), node('comfyui-local-b')])).toBe(false)
  })

  it('批量里混了一个云端 → 照弹（一旦有要花钱的就必须问）', () => {
    expect(generationSpendsCredits([node('comfyui-local'), node('apimart')])).toBe(true)
  })

  it('不回归：云端模型照弹', () => {
    expect(generationSpendsCredits([node('volcengine')])).toBe(true)
  })

  it('保守兜底：认不出供应商 → 当付费（宁可多问一次，不可偷偷花钱）', () => {
    expect(generationSpendsCredits([node()])).toBe(true)
    expect(generationSpendsCredits([undefined])).toBe(true)
    expect(generationSpendsCredits([])).toBe(true)
  })
})
