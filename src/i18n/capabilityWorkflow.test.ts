import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import i18n from './index'
import { translateModelDisplayText } from './modelDisplayText'
import { translateCapabilityWorkflowText } from './capabilityWorkflowText'
import { BUILTIN_CAPABILITY_RECIPES, buildRecipeRunPlan } from '../config/capabilityRecipes'
import { GPT_IMAGE_2_ARCHETYPE } from '../../electron/shared/modelArchetypes/gptImage2'
import { SEMANTIC_TOOL_MAP } from '../workbench/domain/semanticAgentTools'
import { evaluateCapabilityRecipeCollection } from '../workbench/generationCanvas/runner/capabilityRecipeQuality'
import { compileCapabilityRecipePrompt } from '../workbench/generationCanvas/runner/capabilityRecipePrompt'
import type { GenerationResultCollection } from '../workbench/generationCanvas/model/generationCanvasTypes'
import { createMoodExpressionVisionComparator } from '../workbench/generationCanvas/quality/moodExpressionVisionReview'
import { createMultiviewSubjectVisionComparator } from '../workbench/generationCanvas/quality/multiviewSubjectVisionReview'

const han = /[\u3400-\u9fff]/u
function expectEnglish(value: string) {
  expect(han.test(value)).toBe(false)
  expect(value).not.toContain('capabilityWorkflow.')
  expect(value).not.toMatch(/\{\{v\d+\}\}/)
}
afterEach(async () => { await i18n.changeLanguage('zh-CN') })

const modelLabels = [
  '即梦 Web（网页登录实验）', 'Pavo Web（网页登录）',
  'VIP快速', '上传参考图并在即梦网页中生成新图片', '使用已登录的即梦网页生成图片',
  '即梦 Seedance 2.5（高级会员）', '即梦 Web Seedance 2.0', '即梦 Web Seedance 2.0（实验）',
  '即梦 Web 图片', '即梦 Web 图片（实验）', '参考图 / 视频 / 音频（图≤9 视频≤3 音频≤3）',
  '参考图改图', '图片 3.0', '图片 3.1', '图片 4.0', '图片 4.1', '图片 4.5', '图片 4.6',
  '图片 4.7', '图片 5.0 Lite', '图片 5.0 Pro', '提示词优化(Context-IR)', '生成数量',
  '纯文字生成视频，720P–2K，4–15 秒', '返回尾帧图', '首帧 + 尾帧锁定变化',
]

function gridPlan() {
  return buildRecipeRunPlan({
    id: 'i18n-grid', recipe: BUILTIN_CAPABILITY_RECIPES.find(recipe => recipe.id === 'image.multiview.grid9')!,
    archetype: GPT_IMAGE_2_ARCHETYPE, modeId: 'i2i', vendorKey: 'test', modelKey: 'gpt-image-2',
    sourceNodeIds: ['source'], resourceIds: [], params: { shotSize: '中景' }, createdAt: 1,
  })
}

describe('functional workflow display boundaries', () => {
  it('keeps assigned scanner findings at zero without changing the electron baseline', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const baseline = new URL('../../scripts/i18n-electron-baseline.json', import.meta.url)
    const before = fs.readFileSync(baseline)
    const report = execFileSync(process.execPath, ['scripts/check-i18n-visible-text.mjs', '--report'], {
      cwd: root, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024,
    })
    const assigned = report.split('\n').filter(line => /src\/(?:config\/capabilityRecipes\/|workbench\/domain\/semanticAgentTools\.ts|workbench\/generationCanvas\/(?:quality\/|runner\/capabilityRecipeQuality\.ts))/.test(line))
    expect(assigned).toEqual([])
    expect(report).not.toContain('Missing model-display translations:')
    expect(report).not.toContain('- 即梦 Web（网页登录实验）')
    expect(report).not.toContain('- Pavo Web（网页登录）')
    expect(fs.readFileSync(baseline)).toEqual(before)
  })

  it('updates recipe and control display labels after language switches without changing option values', async () => {
    await i18n.changeLanguage('zh-CN')
    const sourceValues = BUILTIN_CAPABILITY_RECIPES.map(recipe => recipe.controls.map(control => ({
      key: control.key, defaultValue: control.defaultValue, values: control.options.map(option => option.value),
    })))
    const recipe = BUILTIN_CAPABILITY_RECIPES[0]!
    expect(createHash('sha256').update(JSON.stringify(BUILTIN_CAPABILITY_RECIPES)).digest('hex'))
      .toBe('e1e3337582610c28da443c218a561a78e7de1cbc9281df434a9e90d506f25b4b')
    expect(recipe.label).toBe('多机位九宫格')
    await i18n.changeLanguage('en')
    for (const entry of BUILTIN_CAPABILITY_RECIPES) {
      expectEnglish(entry.label)
      expectEnglish(entry.description ?? '')
      for (const control of entry.controls) {
        expectEnglish(control.label)
        for (const option of control.options) expectEnglish(option.label)
      }
    }
    expect(BUILTIN_CAPABILITY_RECIPES.map(entry => entry.controls.map(control => ({
      key: control.key, defaultValue: control.defaultValue, values: control.options.map(option => option.value),
    })))).toEqual(sourceValues)
    await i18n.changeLanguage('zh-CN')
    expect(recipe.label).toBe('多机位九宫格')
  })

  it.each(modelLabels)('translates the existing model label %s without altering Chinese source', async source => {
    await i18n.changeLanguage('en')
    expect(han.test(translateModelDisplayText(source))).toBe(false)
    await i18n.changeLanguage('zh-CN')
    expect(translateModelDisplayText(source)).toBe(source)
  })

  it('preserves Agent metadata and generated plan/prompt bytes across languages', async () => {
    const protocolDigest = () => createHash('sha256').update(JSON.stringify(SEMANTIC_TOOL_MAP)).digest('hex')
    await i18n.changeLanguage('zh-CN')
    const original = gridPlan()
    const prompt = compileCapabilityRecipePrompt('Original prompt', original, {
      id: 'task', itemIds: original.outputs.map(output => output.id), outputs: original.outputs, plan: original,
    })
    await i18n.changeLanguage('en')
    const translated = gridPlan()
    expect(translated).toEqual(original)
    expect(compileCapabilityRecipePrompt('Original prompt', translated, {
      id: 'task', itemIds: translated.outputs.map(output => output.id), outputs: translated.outputs, plan: translated,
    })).toBe(prompt)
    expect(protocolDigest()).toBe('93daa8f839e0b83310a022a3150491652ef90f5c73005b521aa160f3489072e5')
  })

  it.each(['zh-CN', 'en'])('preserves exact visual-judge protocol bytes under %s', async language => {
    await i18n.changeLanguage(language)
    const result = { id: 'image', type: 'image' as const, url: 'nomi-local://test.png', createdAt: 1 }
    let moodRequest: unknown
    const mood = createMoodExpressionVisionComparator({ evaluator: 'test', judge: async request => {
      moodRequest = request
      return JSON.stringify({ items: [] })
    } })
    await mood({ source: result, outputs: [{ itemId: 'one', label: 'View', result, energy: 2, affinity: 3 }] })
    expect(createHash('sha256').update(JSON.stringify(moodRequest)).digest('hex'))
      .toBe('f48878cc598089051dd7b95d4afe0965dd9d677d527807ac9f7d719699f3537c')
    let multiviewRequest: unknown
    const multiview = createMultiviewSubjectVisionComparator({ evaluator: 'test', judge: async request => {
      multiviewRequest = request
      return JSON.stringify({ sourceSubjectDetected: true, items: [] })
    } })
    await multiview({ source: result, outputs: [{ itemId: 'one', label: 'View', result, azimuth: 0, elevation: 0 }], backgroundPolicy: 'preserve_scene' })
    expect(createHash('sha256').update(JSON.stringify(multiviewRequest)).digest('hex'))
      .toBe('ef5e5cc984ee86dfb09dd52ce726f80d381a7eff5e039cb36ad8bad13f22ff4b')
  })

  it('translates known camera names inside English quality details without changing stored labels', async () => {
    await i18n.changeLanguage('en')
    const plan = gridPlan()
    const collection: GenerationResultCollection = {
      id: 'grid', recipeId: plan.recipeId, createdAt: 1,
      items: plan.outputs.map(output => ({ ...output, status: 'success', result: {
        id: output.id, type: 'image', url: `nomi-local://${output.id}.png`, createdAt: 1,
      } })),
    }
    const evaluated = await evaluateCapabilityRecipeCollection(plan, collection, undefined, 123)
    expect(evaluated.items.map(item => item.label)).toEqual(plan.outputs.map(output => output.label))
    for (const check of evaluated.quality?.checks ?? []) {
      expectEnglish([check.label, check.summary, ...(check.details ?? [])].join(' '))
    }
  })

  it('translates generated mood/result labels only at display time and preserves custom text', async () => {
    await i18n.changeLanguage('en')
    expect(translateCapabilityWorkflowText('能量 2 · 亲和 3')).toBe('Energy 2 · Affinity 3')
    expect(translateCapabilityWorkflowText('结果 12')).toBe('Result 12')
    expect(translateCapabilityWorkflowText('我的自定义角色')).toBe('我的自定义角色')
    await i18n.changeLanguage('zh-CN')
    expect(translateCapabilityWorkflowText('能量 2 · 亲和 3')).toBe('能量 2 · 亲和 3')
    expect(translateCapabilityWorkflowText('结果 12')).toBe('结果 12')
  })

  it.each(BUILTIN_CAPABILITY_RECIPES.map(recipe => recipe.id))('localizes unavailable quality reports for %s without changing verdicts', async recipeId => {
    const plan = { ...gridPlan(), recipeId }
    const collection: GenerationResultCollection = { id: 'empty', recipeId, createdAt: 1, items: [] }
    await i18n.changeLanguage('zh-CN')
    const zh = await evaluateCapabilityRecipeCollection(plan, collection, undefined, 123)
    await i18n.changeLanguage('en')
    const en = await evaluateCapabilityRecipeCollection(plan, collection, undefined, 123)
    for (const check of en.quality?.checks ?? []) {
      expectEnglish([check.label, check.summary, ...(check.details ?? [])].join(' '))
    }
    const verdict = (value: typeof zh) => ({
      status: value.quality?.status, metrics: value.quality?.metrics,
      checks: value.quality?.checks.map(({ id, status, metrics, itemIds }) => ({ id, status, metrics, itemIds })),
    })
    expect(verdict(en)).toEqual(verdict(zh))
  })
})
