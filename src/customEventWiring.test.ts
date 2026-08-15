import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 自定义事件接线不变量（2026-08-02 控件层级梳理的结构保证）。
 *
 * 这次盘点挖出的死码里有一整类是「接线断了但看不出来」：
 *  - **有监听、无派发** → 面板永远打不开。实例：提示词库 / 技能库各有一个 960px 全屏 modal，
 *    只在 NomiStudioApp 里 addEventListener('nomi-open-prompt-library' / 'nomi-open-skill-library')，
 *    全仓零 dispatch，用户从来没见过它们（活的是侧栏 compact 版）。
 *  - **有派发、无监听** → 点了没反应。实例：顶栏「导出」在预览页派 nomi-request-export，
 *    §1.5「一功能一个家」落地后顶栏那颗不再渲染，监听就成了孤儿。
 *
 * 这两种都编译得过、五门全绿、单测全绿——只有真人点一遍才发现。所以焊一道闸：
 * 每个 `nomi-*` 自定义事件必须**既有派发方、又有监听方**。
 *
 * 事件名常写成模块常量（`const FOCUS_EVENT = 'nomi-focus-generation-node'`），
 * 所以要先解析单层常量再判断，否则会把用常量注册的监听误判成孤儿（写这道闸时就误报过一次）。
 */

const SRC = path.resolve(__dirname)
const EVENT_RE = /^nomi-[a-z0-9-]+$/

/** 派发方/监听方都拿不到、但确实由别处（主进程 / preload / DOM 原生）驱动的事件。 */
const EXTERNALLY_DRIVEN = new Set<string>([])

type Wiring = { dispatchers: Map<string, Set<string>>; listeners: Map<string, Set<string>> }

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function collect(): Wiring {
  const dispatchers = new Map<string, Set<string>>()
  const listeners = new Map<string, Set<string>>()
  const files = sourceFiles(SRC)
  const texts = new Map<string, string>(files.map((file) => [file, fs.readFileSync(file, 'utf8')]))

  // 常量表建成**全局**的：事件名常量经常跨文件 import
  // （`MODEL_REFRESH_EVENT` 定义在 modelCatalogCache.ts、监听在 useModelOptions.ts），
  // 只按单文件解析会把它误判成孤儿——写这道闸时就误报过。
  // 同名标识符指向不同事件时放宽成「命中任一」：闸的价值在于零误报，宁可漏也不能瞎叫。
  const constants = new Map<string, Set<string>>()
  for (const text of texts.values()) {
    for (const m of text.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*['"](nomi-[a-z0-9-]+)['"]/g)) {
      const set = constants.get(m[1]) ?? new Set<string>()
      set.add(m[2])
      constants.set(m[1], set)
    }
  }

  const resolve = (token: string): string[] => {
    const literal = token.match(/^['"](nomi-[a-z0-9-]+)['"]$/)
    if (literal) return [literal[1]]
    return [...(constants.get(token) ?? [])]
  }

  const add = (map: Map<string, Set<string>>, event: string, file: string): void => {
    if (!EVENT_RE.test(event)) return
    const set = map.get(event) ?? new Set<string>()
    set.add(path.relative(SRC, file))
    map.set(event, set)
  }

  for (const [file, text] of texts) {
    for (const m of text.matchAll(/addEventListener\(\s*([^,)\s]+)/g)) {
      for (const event of resolve(m[1].trim())) add(listeners, event, file)
    }
    // 泛型要放行：`new CustomEvent<Detail>(EVENT, …)` 很常见，漏了会把它误判成没人派发。
    for (const m of text.matchAll(/new\s+(?:Custom)?Event\s*(?:<[^>]*>)?\s*\(\s*([^,)\s]+)/g)) {
      for (const event of resolve(m[1].trim())) add(dispatchers, event, file)
    }
  }

  return { dispatchers, listeners }
}

const describeWiring = (event: string, where: Map<string, Set<string>>): string =>
  `${event}（${[...(where.get(event) ?? [])].join(', ')}）`

describe('自定义事件接线不变量', () => {
  const { dispatchers, listeners } = collect()

  it('扫得到事件（防正则失效后闸变空转）', () => {
    expect(dispatchers.size).toBeGreaterThan(3)
    expect(listeners.size).toBeGreaterThan(3)
  })

  it('每个 nomi-* 事件都有派发方——有监听没派发＝这个入口永远打不开', () => {
    const orphans = [...listeners.keys()]
      .filter((event) => !dispatchers.has(event) && !EXTERNALLY_DRIVEN.has(event))
      .map((event) => describeWiring(event, listeners))
    expect(orphans, `这些事件只有监听、没人派发（对应的 UI 打不开，删掉死码或补上入口）：\n${orphans.join('\n')}`).toEqual([])
  })

  it('每个 nomi-* 事件都有监听方——有派发没监听＝用户点了没反应', () => {
    const orphans = [...dispatchers.keys()]
      .filter((event) => !listeners.has(event) && !EXTERNALLY_DRIVEN.has(event))
      .map((event) => describeWiring(event, dispatchers))
    expect(orphans, `这些事件派发出去没人接（用户点了没反应，补监听或删按钮）：\n${orphans.join('\n')}`).toEqual([])
  })
})
