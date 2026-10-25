import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = []
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

function fixtureCheck(patterns) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-product-alias-'))
  temporary.push(dir)
  for (const folder of ['scripts', 'electron/shared/modelArchetypes']) fs.mkdirSync(path.join(dir, folder), { recursive: true })
  fs.copyFileSync(path.join(root, 'scripts/check-platform-archetypes.mjs'), path.join(dir, 'scripts/check-platform-archetypes.mjs'))
  const aliases = 'electron/shared/modelArchetypes/identifierAliases.ts'
  if (fs.existsSync(path.join(root, aliases))) fs.copyFileSync(path.join(root, aliases), path.join(dir, aliases))
  fs.writeFileSync(path.join(dir, 'scripts/platform-archetypes-baseline.json'), JSON.stringify({ platformArchetypes: [] }))
  fs.writeFileSync(path.join(dir, 'electron/shared/modelArchetypes/fixture.ts'),
    `export const fixture = { id: 'gpt-image-2', identifierPatterns: ${JSON.stringify(patterns)} }`)
  return spawnSync(process.execPath, [path.join(dir, 'scripts/check-platform-archetypes.mjs')], { encoding: 'utf8' })
}

describe('platform archetype product identity', () => {
  it('accepts all existing names of the same GPT Image 2 product', () => {
    const result = fixtureCheck(['gpt-image-2', 'gpt-4o-image', 'codex-img2', 'codex-imagegen-img2'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('1 个档案')
  })

  it('still rejects unrelated products added to the same profile', () => {
    const result = fixtureCheck(['gpt-image-2', 'seedance-2', 'suno-v4'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('gpt-image-2')
    expect(result.stderr).toContain('seedance')
    expect(result.stderr).toContain('suno')
  })

  it('does not grant an archetype-wide exemption for unknown alias-like products', () => {
    const result = fixtureCheck(['gpt-image-2', 'codex-img25', 'codex-imagegen-img25'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('codeximg')
    expect(result.stderr).toContain('codeximagegenimg')
  })
})
