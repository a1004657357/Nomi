import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUILTIN_CAPABILITY_RECIPES,
  buildRecipeRunPlan,
  creativeResourceSchema,
  resolveRecipeCompatibility,
  type RecipeRunPlan,
} from '../src/config/capabilityRecipes'
import { GPT_IMAGE_2_ARCHETYPE } from '../electron/shared/modelArchetypes/gptImage2'
import { HAPPYHORSE_ARCHETYPE } from '../electron/shared/videoCapabilities/happyhorse'
import { centeredCropForAspectRatio } from '../src/workbench/generationCanvas/runner/capabilityRecipePostprocess'
import { compileCapabilityRecipePrompt } from '../src/workbench/generationCanvas/runner/capabilityRecipePrompt'
import {
  runCapabilityRecipePlan,
  type CapabilityRecipeTask,
} from '../src/workbench/generationCanvas/runner/capabilityRecipeRunner'
import type {
  GenerationNodeResult,
  GenerationResultCollection,
} from '../src/workbench/generationCanvas/model/generationCanvasTypes'
import {
  hasMediaLocator,
} from '../src/workbench/generationCanvas/quality/capabilityQualityUtils'
import {
  evaluateCustomViewCollection,
} from '../src/workbench/generationCanvas/quality/customViewQuality'
import {
  evaluateModel3dCollection,
} from '../src/workbench/generationCanvas/quality/model3dRecipeQuality'
import {
  evaluateMultiviewContinuityProxy,
} from '../src/workbench/generationCanvas/quality/multiviewContinuityQuality'
import {
  evaluateCapabilityRecipeCollection,
} from '../src/workbench/generationCanvas/runner/capabilityRecipeQuality'
import { evaluateVisionReviewAdapterContract } from './eval/capabilityVisionReviewCase'

type EvalAssertion = {
  label: string
  passed: boolean
  evidence?: string
}

type EvalCase = {
  id: string
  label: string
  status: 'passed' | 'failed'
  assertions: EvalAssertion[]
  error?: string
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replace(/\.\d{3}Z$/, 'Z')
const outArg = process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)
const runDir = outArg
  ? path.resolve(process.cwd(), outArg)
  : path.join(repoRoot, 'evals', 'runs', `${stamp}-capability-recipes-contract`)

function recipe(recipeId: string) {
  const found = BUILTIN_CAPABILITY_RECIPES.find((entry) => entry.id === recipeId)
  if (!found) throw new Error(`Missing recipe: ${recipeId}`)
  return found
}

function buildPlan(
  recipeId: string,
  params: Record<string, string | number | boolean> = {},
  options: {
    requestedOutputs?: number
    outputs?: RecipeRunPlan['outputs']
    resourceIds?: string[]
  } = {},
): RecipeRunPlan {
  return buildRecipeRunPlan({
    id: `eval-${recipeId}-${Math.random().toString(36).slice(2)}`,
    recipe: recipe(recipeId),
    archetype: GPT_IMAGE_2_ARCHETYPE,
    modeId: 'i2i',
    vendorKey: 'eval-provider',
    modelKey: 'eval-image-edit',
    sourceNodeIds: ['source-image'],
    resourceIds: options.resourceIds ?? [],
    params,
    ...(options.requestedOutputs ? { requestedOutputs: options.requestedOutputs } : {}),
    ...(options.outputs ? { outputs: options.outputs } : {}),
    createdAt: 1,
  })
}

function taskForPlan(plan: RecipeRunPlan): CapabilityRecipeTask {
  return {
    id: `${plan.id}:task-1`,
    itemIds: plan.outputs.map((output) => output.id),
    outputs: plan.outputs,
    plan,
  }
}

function deterministicHash(seed: number): string {
  let state = seed + 1
  return Array.from({ length: 256 }, () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state >>> 31 ? '1' : '0'
  }).join('')
}

async function evaluateCase(
  id: string,
  label: string,
  run: (check: (condition: boolean, assertionLabel: string, evidence?: string) => void) => void | Promise<void>,
): Promise<EvalCase> {
  const assertions: EvalAssertion[] = []
  const check = (condition: boolean, assertionLabel: string, evidence?: string) => {
    assertions.push({ label: assertionLabel, passed: condition, ...(evidence ? { evidence } : {}) })
  }
  let error: string | undefined
  try {
    await run(check)
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  const status =
    !error && assertions.length > 0 && assertions.every((assertion) => assertion.passed) ? 'passed' : 'failed'
  return { id, label, status, assertions, ...(error ? { error } : {}) }
}

async function main(): Promise<void> {
  const cases: EvalCase[] = []

  cases.push(
    await evaluateCase('multiview-grid9', 'Nine-view camera fidelity and cost contract', (check) => {
      const plan = buildPlan('image.multiview.grid9', {
        viewGenerationMode: 'independent',
        backgroundPolicy: 'preserve_scene',
      })
      const prompt = compileCapabilityRecipePrompt('Keep the same subject and set.', plan, {
        ...taskForPlan(plan),
        itemIds: [plan.outputs[8]!.id],
        outputs: [plan.outputs[8]!],
      })
      const draftPlan = buildPlan('image.multiview.grid9', {
        viewGenerationMode: 'contact_sheet',
        backgroundPolicy: 'preserve_scene',
      })
      const draftPrompt = compileCapabilityRecipePrompt(
        'Keep the same subject and set.',
        draftPlan,
        taskForPlan(draftPlan),
      )
      const cameraPairs = plan.outputs.map((output) => `${output.azimuth}/${output.elevation}`)

      check(plan.outputCount === 9, 'Produces nine ordered output descriptors', String(plan.outputCount))
      check(plan.taskCount === 9, 'Accurate mode uses one provider task per camera', String(plan.taskCount))
      check(draftPlan.taskCount === 1, 'Draft mode uses one provider task before local splitting', String(draftPlan.taskCount))
      check(new Set(plan.outputs.map((output) => output.id)).size === 9, 'Every view has a stable unique id')
      check(
        cameraPairs.join(',') === '0/0,45/0,90/0,135/0,180/0,-135/0,-90/0,-45/0,0/75',
        'Camera azimuth and elevation coverage matches the row-major contract',
        cameraPairs.join(','),
      )
      check(
        prompt.includes('只输出一张完整的单幅画面')
          && prompt.includes('方位角 0°，仰俯角 75°')
          && prompt.includes('不得生成分屏、拼图、接触表'),
        'Accurate prompt requests one exact camera frame',
      )
      check(
        prompt.includes('不得替换成白色、纯色、透明、影棚或商品转台背景')
          && prompt.includes('场景透视与遮挡'),
        'Accurate prompt preserves the source scene instead of a white studio background',
      )
      check(
        draftPrompt.includes('严格 3x3 九宫格') && draftPrompt.includes('从左到右、从上到下'),
        'Draft prompt keeps the low-cost contact-sheet layout',
      )
      check(
        draftPrompt.includes('每格只改变相机机位') && draftPrompt.includes('物体之间的关系'),
        'Draft prompt still locks subject geometry and object relationships',
      )
    }),
  )

  cases.push(
    await evaluateCase('multiview-center-drift', 'Center-subject drift fails closed across matching backgrounds', async (check) => {
      const plan = buildPlan('image.multiview.grid9')
      const inspect = (output: RecipeRunPlan['outputs'][number], drifted: boolean) => {
        return {
          item: {
            ...output,
            status: 'success' as const,
            result: {
              id: `result-${output.id}`,
              type: 'image' as const,
              url: `nomi-local://${output.id}.png`,
              createdAt: 1,
            },
          },
          inspection: {
            width: 1024,
            height: 1024,
            opaqueRatio: 1,
            meanLuma: 0.46,
            lumaStdDev: 0.18,
            edgeEnergy: 0.12,
            averageRgb: [0.45, 0.45, 0.45] as [number, number, number],
            perceptualHash: output.id.repeat(32),
            centerRegion: {
              lumaStdDev: drifted ? 0.72 : 0.18,
              edgeEnergy: drifted ? 0.64 : 0.12,
              averageRgb: (drifted
                ? [0.95, 0.05, 0.08]
                : [0.46, 0.44, 0.42]) as [number, number, number],
              perceptualHash: (drifted ? '1' : '0').repeat(256),
            },
          },
        }
      }
      const inspected = plan.outputs.map((output) => inspect(output, output.id === 'rear'))
      const continuity = evaluateMultiviewContinuityProxy(inspected)

      check(continuity.status === 'warning', 'Compound center-subject drift cannot pass the local quality report')
      check(
        continuity.itemIds?.length === 1 && continuity.itemIds[0] === 'rear',
        'The drifting view is isolated without flagging stable views',
        continuity.itemIds?.join(','),
      )
      check(
        continuity.metrics?.proxyMode === 'center-composite'
          && continuity.metrics.visualOutlierCount === 1,
        'The report records the center-composite evaluator and outlier count',
      )
      check(
        continuity.details?.some((detail) => detail.includes('不能证明人物、物体身份或三维几何一致')) === true,
        'The proxy does not overclaim semantic identity or geometry verification',
      )

      const customOutputs = [
        { id: 'camera-a', label: 'Camera A', azimuth: 0, elevation: 0, shotSize: 'medium' },
        { id: 'camera-b', label: 'Camera B', azimuth: 60, elevation: 5, shotSize: 'close' },
        { id: 'camera-c', label: 'Camera C', azimuth: -30, elevation: 35, shotSize: 'wide' },
      ]
      const customPlan = buildPlan(
        'image.multiview.custom',
        {},
        { requestedOutputs: customOutputs.length, outputs: customOutputs },
      )
      const customInspected = customOutputs.map((output) => inspect(output, output.id === 'camera-b'))
      const inspections = new Map(customInspected.map((entry) => [entry.item.result!.id, entry.inspection]))
      const customCollection: GenerationResultCollection = {
        id: customPlan.id,
        recipeId: customPlan.recipeId,
        createdAt: 1,
        items: customInspected.map((entry) => entry.item),
      }
      const customQuality = await evaluateCustomViewCollection(
        customPlan,
        customCollection,
        async (result) => inspections.get(result.id)!,
        1,
      )
      const customContinuity = customQuality.quality?.checks.find(
        (entry) => entry.id === 'subject-continuity-proxy',
      )
      check(
        customQuality.quality?.evaluator === 'custom-view-local-v2',
        'Custom camera reports use the versioned compound continuity evaluator',
      )
      check(
        customContinuity?.status === 'warning' && customContinuity.itemIds?.[0] === 'camera-b',
        'Custom camera quality wiring isolates the drifting camera output',
        customContinuity?.itemIds?.join(','),
      )
    }),
  )

  cases.push(
    await evaluateCase('multiview-semantic-contract', 'Batch semantic identity and geometry fail-closed contract', async (check) => {
      const plan = buildPlan('image.multiview.grid9')
      const source: GenerationNodeResult = {
        id: 'semantic-source',
        type: 'image',
        url: 'nomi-local://semantic-source.png',
        createdAt: 1,
      }
      const collection: GenerationResultCollection = {
        id: plan.id,
        recipeId: plan.recipeId,
        createdAt: 1,
        items: plan.outputs.map((output) => ({
          ...output,
          status: 'success',
          result: {
            id: output.id,
            type: 'image',
            url: `nomi-local://${output.id}.png`,
            createdAt: 1,
          },
        })),
      }
      const inspectImage = async (result: GenerationNodeResult) => {
        const index = plan.outputs.findIndex((output) => output.id === result.id)
        return {
          width: 1024,
          height: 1024,
          opaqueRatio: 1,
          meanLuma: 0.46,
          lumaStdDev: 0.18,
          edgeEnergy: 0.12,
          averageRgb: [0.45, 0.44, 0.43] as [number, number, number],
          borderAverageRgb: [0.43, 0.42, 0.41] as [number, number, number],
          borderNearWhiteRatio: 0.03,
          perceptualHash: deterministicHash(index),
          centerRegion: {
            lumaStdDev: 0.18,
            edgeEnergy: 0.12,
            averageRgb: [0.46, 0.44, 0.42] as [number, number, number],
            perceptualHash: '0'.repeat(256),
          },
        }
      }
      const unavailable = await evaluateCapabilityRecipeCollection(
        plan,
        collection,
        inspectImage,
        1,
        { sourceResult: source },
      )
      const unavailableIdentity = unavailable.quality?.checks.find(
        (entry) => entry.id === 'subject-semantic-identity',
      )
      const unavailableGeometry = unavailable.quality?.checks.find(
        (entry) => entry.id === 'subject-geometry-consistency',
      )
      check(
        unavailable.quality?.status === 'unavailable'
          && unavailable.quality.metrics?.semanticComparatorAvailable === false,
        'Pixel-only quality cannot pass semantic identity or geometry',
      )
      check(
        unavailableIdentity?.status === 'unavailable' && unavailableGeometry?.status === 'unavailable',
        'Both semantic checks remain explicitly unavailable without a comparator',
      )

      let comparatorCalls = 0
      const verified = await evaluateCapabilityRecipeCollection(
        plan,
        collection,
        inspectImage,
        2,
        {
          sourceResult: source,
          compareMultiviewSubjects: async (input) => {
            comparatorCalls += 1
            return {
              evaluator: 'deterministic-subject-v1',
              sourceSubjectDetected: true,
              items: input.outputs.map((output) => ({
                itemId: output.itemId,
                outputSubjectDetected: true,
                sameSubject: true,
                identityScore: 0.91,
                geometryConsistent: true,
                geometryScore: 0.86,
                cameraMatches: true,
                cameraScore: 0.9,
                backgroundCompliant: true,
                backgroundScore: 0.88,
              })),
            }
          },
        },
      )
      check(comparatorCalls === 1, 'All nine views are compared in one batch call', String(comparatorCalls))
      check(
        verified.quality?.status === 'pass'
          && verified.quality.metrics?.semanticComparatorEvaluator === 'deterministic-subject-v1',
        'A complete comparator result can pass the full multiview report',
      )
      check(
        verified.quality?.checks
          .filter((entry) => entry.id.startsWith('subject-') && entry.id !== 'subject-continuity-proxy')
          .every((entry) => entry.status === 'pass') === true,
        'Identity and geometry pass as separate semantic checks',
      )

      const rejected = await evaluateCapabilityRecipeCollection(
        plan,
        collection,
        inspectImage,
        3,
        {
          sourceResult: source,
          compareMultiviewSubjects: async (input) => ({
            evaluator: 'deterministic-subject-v1',
            sourceSubjectDetected: true,
            items: input.outputs.map((output) => ({
              itemId: output.itemId,
              outputSubjectDetected: true,
              sameSubject: output.itemId !== 'rear',
              geometryConsistent: output.itemId !== 'top',
              cameraMatches: true,
              backgroundCompliant: true,
            })),
          }),
        },
      )
      const rejectedIdentity = rejected.quality?.checks.find(
        (entry) => entry.id === 'subject-semantic-identity',
      )
      const rejectedGeometry = rejected.quality?.checks.find(
        (entry) => entry.id === 'subject-geometry-consistency',
      )
      check(rejected.quality?.status === 'fail', 'A rejected semantic view fails the full report')
      check(
        rejectedIdentity?.status === 'fail' && rejectedIdentity.itemIds?.join(',') === 'rear',
        'Identity rejection names only the failed rear view',
        rejectedIdentity?.itemIds?.join(','),
      )
      check(
        rejectedGeometry?.status === 'fail' && rejectedGeometry.itemIds?.join(',') === 'top',
        'Geometry rejection names only the failed top view',
        rejectedGeometry?.itemIds?.join(','),
      )
    }),
  )

  cases.push(
    await evaluateCase('multiview-vision-adapter', 'Production vision-review adapter contract', async (check) => {
      const assertions = await evaluateVisionReviewAdapterContract()
      assertions.forEach((assertion) => check(assertion.passed, assertion.label, assertion.evidence))
    }),
  )

  cases.push(
    await evaluateCase('custom-camera-single-frame', 'Custom camera single-frame contract', (check) => {
      const plan = buildPlan(
        'image.multiview.custom',
        {},
        {
          requestedOutputs: 1,
          outputs: [{ id: 'right-profile', label: 'Right profile', azimuth: 90, elevation: 0, shotSize: '中景' }],
        },
      )
      const prompt = compileCapabilityRecipePrompt('Keep the same subject and set.', plan, taskForPlan(plan))

      check(plan.outputCount === 1 && plan.taskCount === 1, 'Plans exactly one output and one provider task')
      check(
        prompt.includes('方位角 90°') && prompt.includes('Right profile'),
        'Prompt preserves the requested camera descriptor',
      )
      check(prompt.includes('只输出一张完整的单幅画面'), 'Prompt requires one complete frame')
      check(
        prompt.includes('不得生成分屏、拼图、接触表、转台图或同时出现多个机位'),
        'Prompt rejects multi-view layouts',
      )
    }),
  )

  cases.push(
    await evaluateCase('panorama-2to1', 'Panorama projection and dimension contract', (check) => {
      const plan = buildPlan('scene.panorama.2to1', { aspectRatio: '2:1' })
      const prompt = compileCapabilityRecipePrompt('A small cafe interior.', plan, taskForPlan(plan))
      const landscape = centeredCropForAspectRatio(1537, 1025, 2)
      const portrait = centeredCropForAspectRatio(1025, 1537, 2)

      check(plan.params.aspectRatio === '2:1', 'Run plan persists the exact 2:1 parameter')
      check(
        landscape.width / landscape.height === 2,
        'Landscape normalization produces exact 2:1 pixels',
        `${landscape.width}x${landscape.height}`,
      )
      check(
        portrait.width / portrait.height === 2,
        'Portrait normalization produces exact 2:1 pixels',
        `${portrait.width}x${portrait.height}`,
      )
      check(
        prompt.includes('等距柱状投影') && prompt.includes('普通广角照片'),
        'Prompt distinguishes equirectangular output from a wide photo',
      )
      check(
        prompt.includes('左右边缘无缝衔接') && prompt.includes('顶部与底部极点连续'),
        'Prompt covers seam, horizon, and pole continuity',
      )
    }),
  )

  cases.push(
    await evaluateCase('portrait-realism', 'Identity protection and skin realism contract', (check) => {
      const plan = buildPlan('portrait.refine', {
        sceneBlend: '自然融合',
        lightingMatch: '自然匹配',
        skinTexture: '真实肌理',
        surfaceTexture: '自然纹理',
        sharpness: '标准清晰',
        realismStrength: 70,
        identityLock: true,
      })
      const prompt = compileCapabilityRecipePrompt('Refine the portrait.', plan, taskForPlan(plan))

      check(prompt.includes('锁定人物身份'), 'Identity lock is explicit')
      check(prompt.includes('不改变五官几何、脸型、年龄和可识别特征'), 'Protected facial attributes are enumerated')
      check(prompt.includes('自然毛孔、细小纹理和合理瑕疵'), 'Positive skin-detail constraints are present')
      check(prompt.includes('塑料皮肤、过度锐化和美容滤镜感'), 'Negative skin artifacts are rejected')
      check(
        plan.sourceNodeIds.length === 1 && plan.sourceNodeIds[0] === 'source-image',
        'Source identity reference remains in the run plan',
      )
    }),
  )

  cases.push(
    await evaluateCase('mood-grid-5x5', 'Five-by-five mood control space', (check) => {
      const plan = buildPlan('portrait.mood', {
        generationMode: 'matrix5x5',
        expressionStrength: 50,
        identityLock: true,
      })
      const prompts = plan.outputs.map((output, index) => compileCapabilityRecipePrompt(
        'Portrait close-up.',
        plan,
        {
          id: `${plan.id}:task-${index + 1}`,
          itemIds: [output.id],
          outputs: [output],
          plan,
        },
      ))

      check(plan.outputCount === 25, 'Full matrix plans 25 ordered outputs', String(plan.outputCount))
      check(plan.taskCount === 25, 'Full matrix exposes the real 25-request cost', String(plan.taskCount))
      check(prompts.length === 25, 'Enumerates all 25 mood coordinates', String(prompts.length))
      check(
        new Set(prompts).size === 25,
        'Every mood coordinate compiles to a distinct prompt',
        String(new Set(prompts).size),
      )
      check(
        prompts.every((prompt) => prompt.includes('不得改变五官几何或人物身份')),
        'Identity protection survives every mood coordinate',
      )
      check(
        prompts[0]?.includes('情绪能量 0/4') === true && prompts[24]?.includes('情绪能量 4/4') === true,
        'Energy endpoints remain distinguishable',
      )
      check(
        prompts[0]?.includes('关系亲和度 0/4') === true && prompts[4]?.includes('关系亲和度 4/4') === true,
        'Affinity endpoints remain distinguishable',
      )
      check(
        plan.outputs[0]?.id === 'mood-e0-a0' && plan.outputs[24]?.id === 'mood-e4-a4',
        'Output ids preserve row-major coordinate order',
      )
    }),
  )

  cases.push(
    await evaluateCase('provider-independent-registry', 'Provider-independent recipe registry', (check) => {
      const serialized = JSON.stringify(BUILTIN_CAPABILITY_RECIPES)
      const ids = BUILTIN_CAPABILITY_RECIPES.map((entry) => entry.id)
      const expected = [
        'image.multiview.grid9',
        'image.multiview.custom',
        'image.multiview.reconstruct3d',
        'scene.panorama.2to1',
        'portrait.refine',
        'portrait.mood',
        'image.style.transfer',
        'video.look.apply',
        'video.effect.reference',
        'video.edit.look',
        'video.edit.effect',
      ]

      check(
        expected.every((id) => ids.includes(id)),
        'Registry contains every planned capability recipe',
      )
      check(
        !/vendorKey|modelKey|apiKey|https?:\/\//i.test(serialized),
        'Recipe definitions contain no provider, model, credential, or endpoint binding',
      )
      check(new Set(ids).size === ids.length, 'Recipe ids are unique')
    }),
  )

  cases.push(
    await evaluateCase('video-contract-split', 'Image-driven and video-to-video contracts stay distinct', (check) => {
      const imageLook = recipe('video.look.apply')
      const videoLook = recipe('video.edit.look')
      const imageOnEdit = resolveRecipeCompatibility(imageLook, HAPPYHORSE_ARCHETYPE, 'edit')
      const videoOnEdit = resolveRecipeCompatibility(videoLook, HAPPYHORSE_ARCHETYPE, 'edit')
      const videoOnImage = resolveRecipeCompatibility(videoLook, HAPPYHORSE_ARCHETYPE, 'i2v')

      check(imageLook.inputSlots.some((slot) => slot.kind === 'source_image'), 'Image-driven look requires a source image')
      check(!imageLook.inputSlots.some((slot) => slot.kind === 'source_video'), 'Image-driven look does not claim a source video')
      check(videoLook.inputSlots.some((slot) => slot.kind === 'source_video'), 'Video edit look requires a source video')
      check(!imageOnEdit.supported, 'Image-driven look rejects a source-video edit mode')
      check(videoOnEdit.supported, 'Video-to-video look accepts a real source-video edit mode')
      check(!videoOnImage.supported, 'Video-to-video look rejects an image-to-video mode')
    }),
  )

  cases.push(
    await evaluateCase('license-provenance', 'Creative resource license provenance', (check) => {
      const parsed = creativeResourceSchema.safeParse({
        id: 'style-owned',
        kind: 'style',
        label: 'Owned style reference',
        promptTokens: ['soft side light', 'fine grain'],
        assetIds: ['asset-1'],
        license: {
          source: 'user-owned',
          license: 'owned',
          commercialUse: 'allowed',
          attribution: 'User source',
        },
        createdAt: 1,
        updatedAt: 1,
      })
      const invalid = creativeResourceSchema.safeParse({
        id: 'style-invalid',
        kind: 'style',
        label: 'Invalid rights state',
        license: { commercialUse: 'assumed' },
        createdAt: 1,
        updatedAt: 1,
      })

      check(parsed.success, 'A declared commercial-use record validates')
      check(parsed.success && parsed.data.license?.source === 'user-owned', 'Source provenance is preserved')
      check(parsed.success && parsed.data.license?.attribution === 'User source', 'Attribution is preserved')
      check(!invalid.success, 'Unknown ad-hoc rights values are rejected instead of treated as allowed')
    }),
  )

  cases.push(
    await evaluateCase('bounded-execution', 'Bounded parallel execution and zero-spend eval', async (check) => {
      const outputs = Array.from({ length: 6 }, (_, index) => ({ id: `view-${index}`, label: `View ${index}` }))
      const plan = buildPlan('image.multiview.custom', {}, { requestedOutputs: 6, outputs })
      let active = 0
      let peak = 0
      let simulatedCalls = 0
      const collection = await runCapabilityRecipePlan(plan, {
        concurrency: 99,
        executeTask: async (task) => {
          simulatedCalls += 1
          active += 1
          peak = Math.max(peak, active)
          await new Promise((resolve) => setTimeout(resolve, 5))
          active -= 1
          return [
            {
              id: `result-${task.id}`,
              type: 'image',
              url: `nomi-local://${task.id}.png`,
              createdAt: 1,
            },
          ]
        },
      })

      check(plan.taskCount === 6, 'Custom camera plans one task per requested view', String(plan.taskCount))
      check(peak === 4, 'Explicitly oversized concurrency is hard-capped at four', String(peak))
      check(simulatedCalls === 6, 'The deterministic executor covers every planned task', String(simulatedCalls))
      check(
        collection.items.every((item) => item.status === 'success'),
        'All simulated outputs settle successfully',
      )
    }),
  )

  cases.push(
    await evaluateCase('media-locator-fail-closed', 'Type-aware media locator and stale GLB fail-closed contract', (check) => {
      const staleModel: GenerationNodeResult = {
        id: 'stale-model',
        type: 'model3d',
        thumbnailUrl: 'nomi-local://asset/project/model-preview.png',
        createdAt: 1,
        model3dValidation: {
          version: 1,
          glbVersion: 2,
          byteLength: 1024,
          meshCount: 1,
          primitiveCount: 1,
          nodeCount: 1,
          materialCount: 1,
          textureCount: 0,
          imageCount: 0,
          embeddedImageCount: 0,
          externalImageCount: 0,
          externalImageUris: [],
          externalBufferCount: 0,
          externalBufferUris: [],
          animationCount: 0,
          skinCount: 0,
          bounds: {
            min: [0, 0, 0],
            max: [1, 1, 1],
            size: [1, 1, 1],
            diagonal: Math.sqrt(3),
          },
          warnings: [],
        },
      }
      const collection: GenerationResultCollection = {
        id: 'stale-model-run',
        recipeId: 'image.multiview.reconstruct3d',
        createdAt: 1,
        items: [{
          id: 'model3d',
          label: '3D 模型',
          status: 'success',
          result: staleModel,
        }],
      }
      const evaluated = evaluateModel3dCollection(collection, 1)
      const outputCheck = evaluated.quality?.checks.find((entry) => entry.id === 'model3d-output')
      const structuralChecks = evaluated.quality?.checks.filter((entry) => entry.id.startsWith('glb-')) ?? []

      check(
        hasMediaLocator({
          id: 'image-preview',
          type: 'image',
          thumbnailUrl: 'nomi-local://asset/project/image-preview.png',
          createdAt: 1,
        }),
        'An image may use a thumbnail locator as its readable fallback',
      )
      check(
        !hasMediaLocator({
          id: 'video-poster',
          type: 'video',
          thumbnailUrl: 'nomi-local://asset/project/video-poster.jpg',
          createdAt: 1,
        }),
        'A video poster cannot masquerade as a playable video',
      )
      check(!hasMediaLocator(staleModel), 'A model preview cannot masquerade as a GLB')
      check(evaluated.quality?.status === 'fail', 'A stale GLB summary without a model address fails the report')
      check(outputCheck?.status === 'fail', 'The model output check identifies the missing GLB address')
      check(
        structuralChecks.length === 4 && structuralChecks.every((entry) => entry.status === 'unavailable'),
        'Stale GLB structural metadata is not reused after the model address is lost',
      )
    }),
  )

  const passedCases = cases.filter((entry) => entry.status === 'passed').length
  const failedCases = cases.length - passedCases
  const assertionCount = cases.reduce((sum, entry) => sum + entry.assertions.length, 0)
  const failedAssertions = cases.reduce(
    (sum, entry) => sum + entry.assertions.filter((assertion) => !assertion.passed).length,
    0,
  )
  const gitCommit = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
    } catch {
      return 'unknown'
    }
  })()
  const report = {
    schemaVersion: 1,
    evalId: 'capability-recipes-contract-v2',
    generatedAt: new Date().toISOString(),
    gitCommit,
    scope: 'deterministic-contract',
    providerCalls: 0,
    summary: {
      status: failedCases === 0 ? 'passed' : 'failed',
      cases: cases.length,
      passedCases,
      failedCases,
      assertions: assertionCount,
      failedAssertions,
    },
    cases,
  }

  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  const markdown = [
    '# Capability Recipe Contract Eval',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Commit: ${gitCommit}`,
    '- Provider calls: 0',
    `- Result: ${passedCases}/${cases.length} cases; ${assertionCount - failedAssertions}/${assertionCount} assertions`,
    '',
    '| Case | Result | Assertions |',
    '| --- | --- | ---: |',
    ...cases.map(
      (entry) =>
        `| ${entry.label} | ${entry.status} | ${entry.assertions.filter((assertion) => assertion.passed).length}/${entry.assertions.length} |`,
    ),
    '',
    ...cases.flatMap((entry) => {
      const failures = entry.assertions.filter((assertion) => !assertion.passed)
      if (!entry.error && failures.length === 0) return []
      return [
        `## ${entry.label}`,
        '',
        ...(entry.error ? [`- Error: ${entry.error}`] : []),
        ...failures.map(
          (assertion) => `- Failed: ${assertion.label}${assertion.evidence ? ` (${assertion.evidence})` : ''}`,
        ),
        '',
      ]
    }),
  ].join('\n')
  fs.writeFileSync(path.join(runDir, 'report.md'), `${markdown}\n`)

  console.log(
    `Capability recipe contract eval: ${passedCases}/${cases.length} cases, ${assertionCount - failedAssertions}/${assertionCount} assertions`,
  )
  console.log(`Provider calls: 0`)
  console.log(`Report: ${path.relative(repoRoot, runDir)}`)
  if (failedCases > 0) process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
