import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canvasToolNames } from '../ai/canvasTools'
import { parseSkillManifest } from './skillManifestSchema'

const SKILL_DIRS = [
  'creative-multiview',
  'creative-panorama',
  'creative-portrait-realism',
  'creative-mood-identity',
  'creative-style-resource',
  'creative-video-look-effect',
] as const

const REQUIRED_SECTIONS = [
  '## 流程规划',
  '## 素材分析',
  '## 故事板设计',
  '## 媒体生成',
  '## 提示词写法',
  '## 视频剪辑',
] as const

describe('creative capability Skill Playbooks', () => {
  it('ships six valid provider-independent manifests using only registered canvas tools', () => {
    const names = new Set<string>()
    for (const directory of SKILL_DIRS) {
      const skillDir = path.resolve(process.cwd(), 'skills', directory)
      const raw = JSON.parse(fs.readFileSync(path.join(skillDir, 'skill.json'), 'utf8')) as unknown
      const parsed = parseSkillManifest(raw)
      expect(parsed.ok, directory).toBe(true)
      if (!parsed.ok) continue
      expect(names.has(parsed.manifest.name), parsed.manifest.name).toBe(false)
      names.add(parsed.manifest.name)
      expect(parsed.manifest.stages?.length).toBeGreaterThan(0)
      expect(parsed.manifest.tools.every((toolName) => canvasToolNames.includes(toolName as typeof canvasToolNames[number]))).toBe(true)
      expect(parsed.manifest.canvas).toBeDefined()
      expect(parsed.manifest.canvas?.defaultRecipeId ?? null).toSatisfy(
        (value: string | null) => value === null || parsed.manifest.canvas?.recipeIds.includes(value) === true,
      )
    }
    expect(names.size).toBe(6)
  })

  it('uses the standard six-section playbook body for every skill', () => {
    for (const directory of SKILL_DIRS) {
      const body = fs.readFileSync(path.resolve(process.cwd(), 'skills', directory, 'SKILL.md'), 'utf8')
      for (const section of REQUIRED_SECTIONS) expect(body, `${directory}: ${section}`).toContain(section)
      expect(body.split('\n').length, `${directory}: length`).toBeLessThanOrEqual(200)
    }
  })
})
