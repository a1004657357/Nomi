import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LANE_MODEL_TOOL_CATALOG, LANE_DEFERRED_TOOL_CATALOG, LANE_NATIVE_TOOL_CATALOG } from '../agentLane/laneToolCatalog'
import { parseSkillFrontmatter } from './skillFrontmatter'
import { readSkillManifest } from './skillManifestSchema'

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
  it.each(SKILL_DIRS)('%s keeps its provider-independent metadata in frontmatter', (directory) => {
    const skillDir = path.resolve(process.cwd(), 'skills', directory)
    const front = parseSkillFrontmatter(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'))
    expect(front.values.name).toBe(directory)
    expect(fs.existsSync(path.join(skillDir, 'skill.json'))).toBe(false)
    const { manifest, error } = readSkillManifest(front)
    expect(error, directory).toBeUndefined()
    expect(manifest).not.toBeNull()
    if (!manifest) return
    expect(manifest.selectableInWorkbench).toBe(true)
    expect(manifest.stages?.length).toBeGreaterThan(0)
    expect(manifest.canvas).toBeDefined()
    expect(manifest.canvas?.defaultRecipeId ?? null).toSatisfy(
      (value: string | null) => value === null || manifest.canvas?.recipeIds.includes(value) === true,
    )
  })

  it.each([...SKILL_DIRS, 'creative-video-deconstruction', 'workbench-cinematic-director', 'workbench-vibing-director'])(
    '%s declares only tools wired into the unified Agentlane', (directory) => {
    const front = parseSkillFrontmatter(fs.readFileSync(path.resolve('skills', directory, 'SKILL.md'), 'utf8'))
    const declared = (front.values.metadata as { nomi: { tools: string[]; stages?: { tools: string[] }[] } }).nomi
    const registered = new Set([...LANE_MODEL_TOOL_CATALOG, ...LANE_DEFERRED_TOOL_CATALOG, ...LANE_NATIVE_TOOL_CATALOG].map(tool => tool.name))
    for (const name of declared.tools) expect(registered.has(name), `${directory}: ${name}`).toBe(true)
    const top = new Set(declared.tools)
    for (const stage of declared.stages ?? []) {
      for (const name of stage.tools) expect(top.has(name), `${directory}: stage tool ${name}`).toBe(true)
    }
  })

  it('uses the standard six-section playbook body for every skill', () => {
    for (const directory of SKILL_DIRS) {
      const body = fs.readFileSync(path.resolve(process.cwd(), 'skills', directory, 'SKILL.md'), 'utf8')
      for (const section of REQUIRED_SECTIONS) expect(body, `${directory}: ${section}`).toContain(section)
      expect(body.split('\n').length, `${directory}: length`).toBeLessThanOrEqual(200)
    }
  })
})
