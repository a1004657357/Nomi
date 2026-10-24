import { createHash } from 'node:crypto'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n, { setAppLocale } from './index'
import { translateCanvasComponentText } from './CanvasComponentText'
import { translateCapabilityWorkflowText } from './capabilityWorkflowText'
import { zhCapabilityWorkflow, enCapabilityWorkflow } from './locales/capabilityWorkflow'
import { canvasSourceDefaults, createRecipeCameraOutputs, generationModeRationale, scene3dCaptureSource } from '../../electron/shared/canvas/sourceDefaults'
import { directorActionSource, directorProtocolSource } from '../../electron/shared/blenderDirectorProtocolText'
import { generationPromptSource } from '../../electron/shared/generationPromptText'
import { setDesktopLocale } from '../../electron/desktopLocale'
import { desktopT } from '../../electron/desktopStrings'
import { isAllowedBrowserTarget } from '../../electron/browser/core/browserAllowlist'
import type { RecipeRunPlan } from '../config/capabilityRecipes'
import type { CapabilityRecipeTask } from '../workbench/generationCanvas/runner/capabilityRecipeRunner'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../workbench/generationCanvas/model/generationCanvasTypes'
import { compileCapabilityRecipePrompt } from '../workbench/generationCanvas/runner/capabilityRecipePrompt'
import { resolveGenerationReferences } from '../workbench/generationCanvas/runner/generationReferenceResolver'
import { PROP_KINDS, PROP_SPECS, makePropObject } from '../workbench/generationCanvas/nodes/scene3d/scene3dPropSpecs'
import { MODEL3D_GRID9_CAMERA_PRESETS } from '../workbench/generationCanvas/nodes/model3d/model3dCamera'
import { createVibingDirectorState, applyVibingDirectorPlan } from '../workbench/generationCanvas/nodes/vibingDirector/vibingDirectorState'
import { evaluateVibingDirectorToolCall, resolveVibingDirectorStructuredPlan } from '../workbench/generationCanvas/nodes/vibingDirector/vibingDirectorAgentProtocol'
import { EditableNodeTitle } from '../workbench/generationCanvas/nodes/render/EditableNodeTitle'
import { CapabilityCameraOutputsEditor } from '../workbench/generationCanvas/components/CapabilityCameraOutputsEditor'
import { CapabilityResultCollection } from '../workbench/generationCanvas/nodes/CapabilityResultCollection'
import { scene3dTaskLabel, scene3dTaskShortLabel } from '../workbench/generationCanvas/nodes/scene3d/scene3dTaskMode'
import { referenceSlotForScene3DCaptureTitle } from '../workbench/generationCanvas/nodes/scene3d/scene3dReferenceDirector'

// Characterized from 21c4de6ea589c78a6318f6f89d210a72d2e68604, not the new helpers.
const PROMPT_CASES = [
  ['image.multiview.grid9', 'eb4c20604811f356d7dfba1c371f2a4bec5da1853695b0658823ffb794cbdb24', 'eb4c20604811f356d7dfba1c371f2a4bec5da1853695b0658823ffb794cbdb24'],
  ['image.multiview.custom', '47c1ed3716755df80e6fd553a3ed667c05541de6cae83cef1a1e4ae3482cf285', '47c1ed3716755df80e6fd553a3ed667c05541de6cae83cef1a1e4ae3482cf285'],
  ['image.multiview.reconstruct3d', '6db0ff49b80d861f79f018f3626e5b223865201f8d4f39db23685f2c441e5f2e', '6db0ff49b80d861f79f018f3626e5b223865201f8d4f39db23685f2c441e5f2e'],
  ['scene.panorama.2to1', '9fcea49a8d53fd11c9e49f8139bb317d7937a8a2880df17c0f75af08e64656ca', '9fcea49a8d53fd11c9e49f8139bb317d7937a8a2880df17c0f75af08e64656ca'],
  ['portrait.refine', 'e82ad2155d699b85e99dc093d3959a2ed3d6085c5b80a4651fc3e1b52e480d49', '5a0c6bcff26699a7b3a5c560dab065e8c9e4c935cc97a6fdf4ec6df6c293ad5b'],
  ['portrait.mood', 'a8fd1753dc28c3300ea53e3ea66323ecff5ab8b323f46056a5ee5b120715a142', '8d62b077738bc804d80020e206cac39027c7dbb1c8355ef92940ded56c9ffe4d'],
  ['image.style.transfer', '08b7ec98e3040e84acaacf8d55a7c33328b624a61fccdbca144d0f16fa4de3b0', '08b7ec98e3040e84acaacf8d55a7c33328b624a61fccdbca144d0f16fa4de3b0'],
  ['video.look.apply', 'e5e2e5013f45a94e7a672b10a2441c1c80b2ee3dbd3d2bfeb44b7c83f8ae3cd3', 'e5e2e5013f45a94e7a672b10a2441c1c80b2ee3dbd3d2bfeb44b7c83f8ae3cd3'],
  ['video.effect.reference', 'a1234a215f8e634d119154901634c86fd79ac1ed3bee5e57e9b141f970ec6bfa', 'a1234a215f8e634d119154901634c86fd79ac1ed3bee5e57e9b141f970ec6bfa'],
  ['video.edit.look', '4ab9f7fb251f274067a546119d57ddb0ef9627a026d57c43793762ef8b749012', '4ab9f7fb251f274067a546119d57ddb0ef9627a026d57c43793762ef8b749012'],
  ['video.edit.effect', '36b0b217f8fa57338db6553fc4cf8920e06da766e8855ae5389c698e0ccd900e', '36b0b217f8fa57338db6553fc4cf8920e06da766e8855ae5389c698e0ccd900e'],
  ['custom.recipe', '763feb8b82f4dfb9d7b73574c78d0b8f299e7111040e632e82edc8d0267a210a', '763feb8b82f4dfb9d7b73574c78d0b8f299e7111040e632e82edc8d0267a210a'],
] as const

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

function recipePlan(recipeId: string, identityLock: boolean): RecipeRunPlan {
  return {
    id: 'i18n-source', recipeId, recipeVersion: 1, outputKind: 'image_collection',
    sourceNodeIds: ['source-1'], resourceIds: [],
    model: { vendorKey: 'provider-a', modelKey: 'model-a', archetypeId: 'image-edit', modeId: 'edit', compatibilityTier: 'compatible' },
    params: { identityLock, viewGenerationMode: 'independent', sourceWidth: 1920, sourceHeight: 1080, sourceAspectRatio: 16 / 9, energy: 4, affinity: 0 },
    outputCount: 1, taskCount: 1,
    outputs: [{ id: 'view-1', label: '机位 1', azimuth: 0, elevation: 0, shotSize: '中景' }],
    createdAt: 100,
  }
}

function recipeTask(plan: RecipeRunPlan): CapabilityRecipeTask {
  return { id: plan.id + ':task-1', itemIds: plan.outputs.map(output => output.id), outputs: plan.outputs, plan }
}

afterEach(() => {
  setAppLocale('zh-CN')
  setDesktopLocale('zh-CN')
})

describe.each(['zh-CN', 'en'] as const)('canonical workflow data in %s', locale => {
  beforeEach(() => {
    setAppLocale(locale)
    setDesktopLocale(locale)
  })

  it.each(Array.from({ length: 10 }, (_, count) => count))('keeps authored camera defaults and geometry for %i outputs', count => {
    const outputs = createRecipeCameraOutputs(count, [])
    const angles = [0, 45, 90, 135, 180, -90, 180, 180, 180]
    expect(outputs).toEqual(Array.from({ length: count }, (_, index) => ({
      id: 'view-' + (index + 1), label: '机位 ' + (index + 1),
      azimuth: angles[index], elevation: 0, shotSize: '中景',
    })))
  })

  it('retains an explicitly edited camera record, including custom label and geometry', () => {
    const edited = Object.freeze({ id: 'custom', label: '用户的侧面机位', azimuth: -13, elevation: 7, shotSize: '全景' })
    const outputs = createRecipeCameraOutputs(3, [edited])
    expect(outputs[0]).toBe(edited)
    expect(createRecipeCameraOutputs(1, outputs)).toEqual([edited])
    expect(translateCanvasComponentText(edited.label)).toBe(edited.label)
    expect(translateCanvasComponentText(outputs[1].label)).toBe(locale === 'en' ? 'View 2' : '机位 2')
    expect(outputs[1].label).toBe('机位 2')
  })

  it('keeps all 16 prop geometries, colors and serialized source names byte-identical', () => {
    const geometry = Object.fromEntries(PROP_KINDS.map(kind => {
      const spec = PROP_SPECS[kind]
      return [kind, {
        spec: { defaultColor: spec.defaultColor, footprint: spec.footprint, parts: spec.parts },
        object: { ...makePropObject(kind), id: undefined },
      }]
    }))
    expect(hash(geometry)).toBe('2123b4e96a2ef2d1868b25ff04565b3a64342c6eb19cb4b5a397028edcc36f15')
  })

  it('keeps grid9 labels and camera parameters canonical while displaying translated names', () => {
    expect(hash(MODEL3D_GRID9_CAMERA_PRESETS)).toBe('012e46e5d91adbd51d768593bfa4ca884ab6573a3e56f1cd759041e66a3cfb9a')
    expect(MODEL3D_GRID9_CAMERA_PRESETS[0].label).toBe('正面')
    expect(translateCanvasComponentText(MODEL3D_GRID9_CAMERA_PRESETS[0].label)).toBe(locale === 'en' ? 'Front' : '正面')
  })

  it('preserves authored node titles, denial and pending status bytes', () => {
    const stored = {
      title: canvasSourceDefaults.scene3dTitle(),
      progress: directorProtocolSource.running(),
      denial: directorProtocolSource.declined(),
      shot: canvasSourceDefaults.shotTitle(3),
      actor: canvasSourceDefaults.actorName(26),
    }
    const before = JSON.stringify(stored)
    expect(stored).toEqual({
      title: '3D 导演台', progress: 'Blender 正在执行导演计划',
      denial: '用户没有确认这次 Blender 导演计划', shot: '镜 3', actor: '角色A1',
    })
    expect(translateCanvasComponentText(stored.title)).toBe(locale === 'en' ? '3D director workspace' : stored.title)
    expect(translateCanvasComponentText(stored.denial)).toBe(locale === 'en' ? 'The user did not confirm this Blender director plan' : stored.denial)
    expect(translateCanvasComponentText(stored.actor)).toBe(locale === 'en' ? 'Actor A1' : stored.actor)
    expect(JSON.stringify(stored)).toBe(before)
  })

  it('keeps historical capture titles and prompt data canonical after restoring the locale namespace', () => {
    expect(scene3dCaptureSource.stagingReference()).toBe('站位参考')
    expect(scene3dCaptureSource.stagingPrompt()).toBe('3D 站位参考（站位 + 动作 + 机位）')
    expect(scene3dCaptureSource.cameraMoveReference()).toBe('运镜参考')
    expect(scene3dCaptureSource.viewportTitle()).toBe('3D截图 - 当前视口')
    expect(scene3dCaptureSource.cameraTitle('用户镜头')).toBe('3D截图 - 用户镜头')
    expect(scene3dCaptureSource.recordedTakeTitle()).toBe('录制走位参考')
    expect(scene3dCaptureSource.screenshotPrompt()).toBe('3D 场景截图')
    expect(scene3dCaptureSource.panoramaName()).toBe('全景图')
    const first = scene3dCaptureSource.cameraMoveFrameTitle('用户镜头', scene3dCaptureSource.firstFrame())
    const last = scene3dCaptureSource.cameraMoveFrameTitle('用户镜头', scene3dCaptureSource.lastFrame())
    expect(first).toBe('用户镜头 · 运镜首帧')
    expect(last).toBe('用户镜头 · 运镜尾帧')
    expect(referenceSlotForScene3DCaptureTitle(first)).toBe('first_frame')
    expect(referenceSlotForScene3DCaptureTitle(last)).toBe('last_frame')
    expect(translateCanvasComponentText(first)).toBe(locale === 'en' ? '用户镜头 · Camera move first frame' : first)
    expect(translateCanvasComponentText(last)).toBe(locale === 'en' ? '用户镜头 · Camera move last frame' : last)
    expect(translateCanvasComponentText('用户镜头 · 运镜自定')).toBe('用户镜头 · 运镜自定')
  })

  it('renders an existing persisted node title without writing its displayed English back', () => {
    const value = canvasSourceDefaults.scene3dTitle()
    const markup = renderToStaticMarkup(React.createElement(EditableNodeTitle, { nodeId: 'not-in-store', value }))
    expect(markup).toContain(locale === 'en' ? '3D director workspace' : '3D 导演台')
    expect(value).toBe('3D 导演台')
  })

  it('keeps wrong-node/read-before-edit protocol responses stable without granting permission', () => {
    const state = createVibingDirectorState(100)
    const request = { directorNodeId: 'elsewhere', summary: '用户自己的计划', plan: { mode: 'amend', actions: [] } }
    const result = resolveVibingDirectorStructuredPlan(JSON.stringify(request), 'here', state)
    expect(result).toEqual({
      ok: false, code: 'wrong_node_id',
      message: 'Blender 导演计划目标是「elsewhere」，当前节点是「here」。',
    })
    const decision = evaluateVibingDirectorToolCall({
      toolName: 'apply_vibing_director_plan', args: request, directorNodeId: 'here', state, inspected: false,
    })
    expect(decision).toEqual(expect.objectContaining({ kind: 'reject', inspected: false }))
    expect(JSON.stringify(decision)).toContain('修改 Blender 场景前必须先读取当前 Director 状态')
  })

  it('renders the actual camera editor and result collection without rewriting stored labels', () => {
    const outputs = Object.freeze(createRecipeCameraOutputs(2, []))
    const before = JSON.stringify(outputs)
    const editor = renderToStaticMarkup(React.createElement(MantineProvider, null,
      React.createElement(CapabilityCameraOutputsEditor, {
        outputs, count: 2, onChange: () => { throw new Error('render must not save') },
      }),
    ))
    expect(editor).toContain(locale === 'en' ? 'value="View 1"' : 'value="机位 1"')
    const node: GenerationCanvasNode = {
      id: 'collection', kind: 'image', title: '用户标题', prompt: '', position: { x: 0, y: 0 }, size: { width: 100, height: 100 },
      resultCollections: [{
        id: 'collection-1', recipeId: 'image.multiview.custom', createdAt: 100,
        items: outputs.map(output => ({ ...output, status: 'pending' })),
      }],
    }
    const stored = JSON.stringify(node)
    const collection = renderToStaticMarkup(React.createElement(MantineProvider, null,
      React.createElement(CapabilityResultCollection, { node, readOnly: true, mediaPreviewPriority: false }),
    ))
    expect(collection).toContain(locale === 'en' ? 'View 1' : '机位 1')
    expect(collection).toContain(locale === 'en' ? 'View 2' : '机位 2')
    expect(JSON.stringify(outputs)).toBe(before)
    expect(JSON.stringify(node)).toBe(stored)
  })

  it('keeps actual Director action summaries and user-authored names canonical', () => {
    const result = applyVibingDirectorPlan(createVibingDirectorState(100), {
      mode: 'amend', actions: [{ op: 'add_marker', id: 'custom', name: '自定角色', position: [1, 0, 2] }],
    })
    expect(result.applied).toEqual(['添加走位标记：自定角色'])
    expect(result.state.objects.find(object => object.id === 'custom')?.name).toBe('自定角色')
    expect(directorActionSource.addMarker('自定角色')).toBe('添加走位标记：自定角色')
  })

  it.each(PROMPT_CASES)('keeps %s prompt bytes with identity lock on/off', (recipeId, lockedHash, softHash) => {
    for (const [identityLock, expectedHash] of [[true, lockedHash], [false, softHash]] as const) {
      const plan = recipePlan(recipeId, identityLock)
      const before = JSON.stringify(plan)
      expect(hash(compileCapabilityRecipePrompt('主角站在原有场景里。', plan, recipeTask(plan)))).toBe(expectedHash)
      expect(JSON.stringify(plan)).toBe(before)
    }
  })

  it('preserves model reference instructions, purpose, ordering and original title', () => {
    const source: GenerationCanvasNode = {
      id: 'source', kind: 'image', title: '角色定妆图', prompt: '', position: { x: 0, y: 0 }, size: { width: 100, height: 100 },
      result: { id: 'result', type: 'image', url: 'nomi-local://asset/p/raw.png', createdAt: 0 },
    }
    const target: GenerationCanvasNode = { id: 'target', kind: 'video', title: '镜头', prompt: '', position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }
    const edges: GenerationCanvasEdge[] = [{ id: 'edge', source: source.id, target: target.id, mode: 'character_ref' }]
    const before = JSON.stringify({ source, target, edges })
    const references = resolveGenerationReferences(target, { nodes: [source, target], edges })
    expect(references.referenceImages).toEqual(['nomi-local://asset/p/raw.png'])
    expect(references.referenceImagePurposes).toEqual(['character'])
    expect(references.referenceImageRoles).toEqual(['角色「角色定妆图」的身份、脸、发型和服装参考，不锁定动作与构图'])
    expect(JSON.stringify({ source, target, edges })).toBe(before)
    expect(translateCanvasComponentText(generationPromptSource.character('角色定妆图'))).toBe(generationPromptSource.character('角色定妆图'))
    expect(generationModeRationale('first-frame')).toBe('有首帧图，first-frame 锁起始构图')
  })

  it('uses the existing desktop route without changing allowlist decisions', () => {
    expect(isAllowedBrowserTarget('https://evil.example/').allowed).toBe(false)
    expect(isAllowedBrowserTarget('https://evil.example/').reason).toContain(locale === 'en' ? 'not in the allowlist' : '不在 allowlist')
    expect(isAllowedBrowserTarget('file:///private/secret').allowed).toBe(false)
    expect(isAllowedBrowserTarget('https://jimeng.jianying.com/').allowed).toBe(true)
    expect(desktopT('custom.workflow.timelineShot', { value0: '03' })).toBe(locale === 'en' ? 'Shot 03' : '镜头 03')
  })

  it('resolves restored Scene3D task and interpolation resources', () => {
    expect(scene3dTaskLabel('compose')).toBe(locale === 'en' ? 'Compose a shot' : '摆一张构图图')
    expect(scene3dTaskShortLabel('move')).toBe(locale === 'en' ? 'Camera move' : '运镜参考')
    expect(i18n.t('scene3d.environment.nonStandardImported', { width: 3000, height: 1000 })).toContain('3000×1000')
    expect(i18n.t('scene3d.moveHub.selectCamera', { camera: '用户命名' })).toContain('用户命名')
  })
})

it('keeps unknown/custom text and malformed source-shaped labels unchanged', () => {
  setAppLocale('en')
  for (const text of ['自定镜头（不要改名）', '机位 左侧', '角色AB', '机位 0', '镜 3 自定', 'UNREGISTERED', '']) {
    expect(translateCanvasComponentText(text)).toBe(text)
    expect(translateCapabilityWorkflowText(text)).toBe(text)
  }
})

it('maps the complete existing recipe display dictionary through typed full keys', () => {
  setAppLocale('en')
  for (const [key, source] of Object.entries(zhCapabilityWorkflow)) {
    expect(translateCapabilityWorkflowText(source), key).toBe(enCapabilityWorkflow[key as keyof typeof enCapabilityWorkflow])
  }
})
