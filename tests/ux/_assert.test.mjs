// 断言层自己的契约测试。
//
// 这里钉的不是「helper 能跑」，而是**它必须拦得住那种写法**：
// `expectAbsent` 没有 provenBy 就得当场抛错。这条一旦松了，整套加固就退回成一句口号——
// 因为「没有基线的『没看到』」正是本仓 94% 的「不存在」断言在犯的错，也是我两天内栽的两次。
import { describe, expect, it, vi } from 'vitest'
import { errors as playwrightErrors } from '@playwright/test'
import { errors as runtimeErrors } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { installFeelObserver } from './_feel-observer.mjs'
import { expectAbsent, holdAbsent, proveProbe, screenshotSettled, stripCommentsAndStrings, waitForVisualQuiescence } from './_assert.mjs'

/** 假 locator：这些测试只验签名契约，不碰真浏览器。 */
const fakeLocator = { toString: () => 'locator(fake)' }

describe('expectAbsent 强制要基线', () => {
  it('不给 provenBy → 抛错（而不是默默通过）', async () => {
    await expect(expectAbsent(fakeLocator)).rejects.toThrow(/需要 provenBy/)
  })

  it('给个随手编的对象也不认 —— 必须是 proveProbe 真跑出来的证明', async () => {
    // 关键：不能让人用 `{ provenBy: true }` 之类糊过去，那等于把门开回原样。
    await expect(expectAbsent(fakeLocator, { provenBy: true })).rejects.toThrow(/需要 provenBy/)
    await expect(expectAbsent(fakeLocator, { provenBy: { label: '我说有就有' } })).rejects.toThrow(/需要 provenBy/)
  })

  it('报错信息要给出可照抄的正确写法（不是只骂一句「缺参数」）', async () => {
    const error = await expectAbsent(fakeLocator).catch((e) => e)
    expect(error.message).toContain('proveProbe')
    expect(error.message).toContain('provenBy: proof')
    // 还要讲清「为什么」，不然下一个人只会照着补个参数、不理解拦的是什么。
    expect(error.message).toContain('空洞的通过')
  })
})

describe('expectAbsent 的保持窗口：「不存在」必须持续成立，不是此刻恰好没看见', () => {
  // 这一组钉的是 2026-08-25 三起事故的共同根因：**测量发生在被测物安顿之前**。
  //
  // 旧实现只有一句 `expect(locator).toHaveCount(0, { timeout })`。Playwright 的 web-first
  // 断言是「重试到条件成立为止」——期望值 0、现场此刻也是 0，于是**第一次取样就通过**，
  // 那个 15 秒 timeout 一秒都没用上。它证的是「此刻没有」，不是「一直没有」。
  //
  // 测的是 holdAbsent（expectAbsent 的第二段）：这次新增的行为全在这一段。
  // 第一段用的是 Playwright 断言，只认真的 Locator，喂假对象会当场抛类型错——
  // 硬给假对象套一层 Locator 协议的壳，测的就成了那层壳自己。

  /** count() 在 delayMs 后由 0 翻成 1——模拟异步挂载、晚到一步的元素。 */
  function lateMountingLocator(delayMs) {
    const born = Date.now()
    return {
      count: async () => (Date.now() - born >= delayMs ? 1 : 0),
      toString: () => `locator(late@${delayMs}ms)`,
    }
  }

  it('先不在、200ms 后冒出来 → 报红（这正是旧版会放过去的那一族）', async () => {
    const error = await holdAbsent(lateMountingLocator(200), '它不该出现').catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('保持窗口')
    // 报错要讲清楚「别把窗口调小来让它变绿」，否则下一个人就是这么修的。
    expect(error.message).toContain('别把窗口调小')
  })

  it('真的一直不存在 → 照常通过', async () => {
    await holdAbsent({ count: async () => 0, toString: () => 'never' }, '它确实不在')
  })

  it('窗口内每一次取样都算数：只在最后一刻闪现也要抓到', async () => {
    // 只有窗口快结束时才冒出来——单次取样必然漏掉，必须靠连续取样才抓得住。
    const error = await holdAbsent(lateMountingLocator(600), '晚到 600ms').catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('保持窗口')
  })
})

describe('proveProbe 要求说人话的 label', () => {
  it('不给 label → 抛错：失败信息里没有人话，等于让人对着 selector 猜', async () => {
    await expect(proveProbe(fakeLocator)).rejects.toThrow(/label 必填/)
    await expect(proveProbe(fakeLocator, '')).rejects.toThrow(/label 必填/)
  })
})

describe('stripCommentsAndStrings', () => {
  // 结构测试扫源码找违禁串时不剥注释，会**反噬文档**：
  // 我本轮就被自己写的、专门记录该 bug 的注释打红过（注释里出现 'assets' → 命中「禁止硬编码模式名」）。
  it('剥掉行注释和块注释，只留代码', () => {
    const source = [
      "// 旧代码硬编码了 onModeChange('assets')，这行是注释不该被扫到",
      '/* 块注释里也提到 assets */',
      "const real = 'story'",
    ].join('\n')
    const stripped = stripCommentsAndStrings(source)
    expect(stripped).not.toContain('assets')
    expect(stripped).toContain("'story'")
  })
})

describe('waitForVisualQuiescence / screenshotSettled error ownership', () => {
  it('canonical TimeoutError 是真实 Playwright 运行时的同一构造器', () => {
    expect(playwrightErrors.TimeoutError).toBe(runtimeErrors.TimeoutError)
  })
  it('真实 FEEL wait 包装成功等待后抛字体 drift：保留错误对象，不追加几何诊断', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-quiescence-feel-'))
    try {
      const findings = Array.from({ length: 4 }, () => ({ rule: 'font-size', target: ['span'], text: ['Badge'], fontSizes: [11] }))
      const screenshot = vi.fn(async () => Buffer.from('not-an-image'))
      const page = {
        screenshot,
        evaluate: vi.fn().mockResolvedValueOnce({ label: 'smoke:waitForFunction', findings }).mockResolvedValueOnce([]).mockResolvedValue([]),
        waitForFunction: vi.fn(async () => undefined),
        waitForSelector: vi.fn(async () => undefined),
        waitForLoadState: vi.fn(async () => undefined),
      }
      installFeelObserver(page, {
        name: 'smoke', outputDir, exemptions: { entries: [] },
        baseline: { entries: [{ journey: 'smoke', screenshotName: 'waitForFunction.png', rule: 'font-size', count: 0 }] },
      })
      const observedWait = page.waitForFunction
      let originalError
      page.waitForFunction = async (...args) => {
        try { return await observedWait(...args) } catch (error) { originalError = error; throw error }
      }
      const caught = await screenshotSettled(page, { path: 'must-not-be-created.png' }).catch(error => error)
      expect(originalError).toBeInstanceOf(Error)
      expect(originalError.message).toContain('Feel baseline drift')
      expect(originalError.message).toContain('"actual":4,"allowed":0')
      expect(caught).toBe(originalError)
      expect(caught.message).not.toMatch(/视觉安定|几何一直在变/)
      expect(page.evaluate).toHaveBeenCalledTimes(2)
      expect(screenshot).toHaveBeenCalledTimes(1) // Only FEEL's checkpoint, not the settled screenshot.
      expect(fs.readdirSync(outputDir).some(file => file.endsWith('.png'))).toBe(false)
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
  })

  const upstreamCause = new Error('original upstream cause')
  const namedTimeout = Object.assign(new Error('Timeout 5000ms exceeded', { cause: upstreamCause }), { name: 'TimeoutError' })
  for (const [label, error] of [
    ['FEEL with cause', new Error('Feel baseline drift: font-size 4>0', { cause: upstreamCause })],
    ['AbortError', new DOMException('operation aborted', 'AbortError')],
    ['ordinary timeout wording', new Error('timeout while reading checkpoint', { cause: upstreamCause })],
    ['spoofed TimeoutError name', namedTimeout],
    ['TypeError', new TypeError('checkpoint contract failed', { cause: upstreamCause })],
    ['non-Error rejection', 'timeout is not an error type'],
  ]) {
    it(`${label}: 原身份/信息/cause 直接拒绝，不读诊断或截图`, async () => {
      const page = {
        waitForFunction: vi.fn(async () => { throw error }),
        evaluate: vi.fn(async () => []),
        screenshot: vi.fn(async () => undefined),
      }
      await expect(screenshotSettled(page)).rejects.toBe(error)
      expect(page.evaluate).not.toHaveBeenCalled()
      expect(page.screenshot).not.toHaveBeenCalled()
      if (error instanceof Error && error.cause) expect(error.cause).toBe(upstreamCause)
    })
  }

  for (const animations of [[], ['DIV.toast-enter']]) {
    it(`真实 Playwright TimeoutError：保留 cause 和${animations.length ? '动画' : '几何'}诊断`, async () => {
      const original = new playwrightErrors.TimeoutError('page.waitForFunction: Timeout 5000ms exceeded')
      const page = {
        waitForFunction: vi.fn(async () => { throw original }),
        evaluate: vi.fn(async () => animations),
      }
      const caught = await waitForVisualQuiescence(page).catch(error => error)
      expect(caught).toBeInstanceOf(Error)
      expect(caught).not.toBe(original)
      expect(caught.cause).toBe(original)
      expect(caught.message).toContain('仍未视觉安定')
      expect(caught.message).toContain('别调大 timeout')
      expect(caught.message).toContain(animations.length ? 'DIV.toast-enter' : '几何一直在变')
      expect(page.evaluate).toHaveBeenCalledTimes(1)
      expect(page.waitForFunction.mock.calls[0][1]).toBe(3)
      expect(page.waitForFunction.mock.calls[0][2]).toEqual({ timeout: 5000, polling: 'raf' })
    })
  }

  it('真实 timeout 的诊断读取失败仍保留原 timeout cause', async () => {
    const original = new playwrightErrors.TimeoutError('Timeout 5000ms exceeded')
    const page = {
      waitForFunction: vi.fn(async () => { throw original }),
      evaluate: vi.fn(async () => { throw new Error('diagnostic target unavailable') }),
    }
    const caught = await waitForVisualQuiescence(page).catch(error => error)
    expect(caught.cause).toBe(original)
    expect(caught.message).toContain('仍未视觉安定')
  })

  it('成功清 fingerprint 后才截图；默认3帧/5000ms和截图参数不变', async () => {
    const state = { __nomiQuiescence: { fingerprint: 'old', stable: 3 } }
    const sequence = []
    const page = {
      waitForFunction: vi.fn(async () => { sequence.push('wait') }),
      evaluate: vi.fn(async callback => {
        sequence.push('cleanup')
        return runInNewContext(`(${callback.toString()})()`, { window: state })
      }),
      screenshot: vi.fn(async () => { sequence.push('screenshot'); return 'shot-result' }),
    }
    const result = await screenshotSettled(page, { path: 'evidence.png', fullPage: true })
    expect(result).toBe('shot-result')
    expect(state).not.toHaveProperty('__nomiQuiescence')
    expect(sequence).toEqual(['wait', 'cleanup', 'screenshot'])
    expect(page.waitForFunction.mock.calls[0][1]).toBe(3)
    expect(page.waitForFunction.mock.calls[0][2]).toEqual({ timeout: 5000, polling: 'raf' })
    expect(page.screenshot).toHaveBeenCalledWith({ path: 'evidence.png', fullPage: true })
  })
})
