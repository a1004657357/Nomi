import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { resolveReachable } from './check-gates-chain.mjs'

describe('merged gate command ownership', () => {
  test('counts the actual sitemap child of the upstream site runner', () => {
    expect(resolveReachable({
      gates: 'pnpm run check:site',
      'check:site': 'node scripts/check-site.mjs',
      'check:sitemap': 'node scripts/build-marketing-sitemap.mjs --check',
    }, 'gates').has('check:sitemap')).toBe(true)
  })

  test('does not invent checks or borrow flags from another site child', () => {
    const reachable = resolveReachable({
      gates: 'node scripts/check-site.mjs',
      'check:fiction': 'node scripts/not-a-site-check.mjs --check',
      'check:sitemap:strict': 'node scripts/build-marketing-sitemap.mjs --strict',
    }, 'gates')
    expect(reachable.has('check:fiction')).toBe(false)
    expect(reachable.has('check:sitemap:strict')).toBe(false)
  })

  test('does not count a runner that is merely mentioned', () => {
    expect(resolveReachable({
      gates: 'echo node scripts/check-site.mjs',
      'check:sitemap': 'node scripts/build-marketing-sitemap.mjs --check',
    }, 'gates').has('check:sitemap')).toBe(false)
  })

  test('keeps live checks reachable and preserves the upstream generated-defaults autosync owner', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))
    for (const obsolete of ['check:archetype-sources', 'check:handbook', 'check:audit', 'check:archetype-defaults']) {
      expect(scripts[obsolete], obsolete).toBeUndefined()
    }
    expect(scripts['build:handbook']).toBeUndefined()
    const reachable = resolveReachable(scripts, 'gates')
    for (const check of ['check:third-party', 'check:tool-face', 'check:agent-tool-face-usecases']) {
      expect(reachable.has(check), check).toBe(true)
    }
    expect(scripts['gen:archetype-defaults']).toBe('tsx scripts/gen-archetype-wire-defaults.ts')
  })
})
