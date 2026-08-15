import { describe, expect, it } from 'vitest'
import { consumePendingCustomCallIntent, setPendingCustomCallIntent, stripCodeFences } from './customCallIntent'

describe('pending custom call intent', () => {
  it('一次性消费：set 后 consume 拿到，再 consume 为 null', () => {
    setPendingCustomCallIntent({ vendorKey: 'v', modelKey: 'm' })
    expect(consumePendingCustomCallIntent()).toEqual({ vendorKey: 'v', modelKey: 'm' })
    expect(consumePendingCustomCallIntent()).toBeNull()
  })
})

describe('stripCodeFences', () => {
  it('剥掉带语言标注的围栏', () => {
    expect(stripCodeFences('```js\nreturn 1\n```')).toBe('return 1')
    expect(stripCodeFences('```\nreturn 2\n```')).toBe('return 2')
  })
  it('无围栏原样 trim', () => {
    expect(stripCodeFences('  return 3  ')).toBe('return 3')
  })
})
