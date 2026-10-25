import { afterEach, describe, expect, it } from 'vitest'
import i18n, { DEFAULT_LOCALE } from './index'
import { tagNomiError, matchNomiErrorCode, type NomiErrorCode } from '../../electron/shared/nomiErrorCodes'
import { imageEditGuardError } from '../../electron/catalog/taskParams'
import { describeEmptyAgentReply } from '../../electron/ai/agentError'
import { classifyGenerationError } from '../workbench/observability/classifyError'
import { isRetryableGenerationError } from '../workbench/generationCanvas/runner/generationRetryPolicy'
import { scene3dCaptureSource } from '../../electron/shared/canvas/sourceDefaults'
import { referenceSlotForScene3DCaptureTitle } from '../workbench/generationCanvas/nodes/scene3d/scene3dReferenceDirector'
import { compileVideoPromptForReferences } from '../workbench/generationCanvas/runner/videoPromptCompiler'
import { computeAttachCameraMove as attachDirectorCameraMove } from '../workbench/generationCanvas/nodes/director/agent/attachCameraMoveToTarget'
import { computeAttachCameraMove as attachLegacyCameraMove } from '../workbench/generationCanvas/nodes/scene3d/attachCameraMoveToTarget'
import type { GenerationCanvasNode } from '../workbench/generationCanvas/model/generationCanvasTypes'

afterEach(async () => { await i18n.changeLanguage(DEFAULT_LOCALE) })

describe('local workflow identity is independent of display prose', () => {
  it.each(['zh-CN', 'en-US'])('preserves Chinese authored movement and screen rules byte-for-byte: %s', async locale => {
    await i18n.changeLanguage(locale)
    for (const prompt of ['人物推门', '人物推门\n镜头运动：用户手写推拉，不得覆盖']) {
      const target: GenerationCanvasNode = {
        id: 'video', kind: 'video', title: '用户镜头', position: { x: 0, y: 0 },
        prompt, status: 'idle', meta: {}, references: [], history: [],
      }
      const modern = attachDirectorCameraMove(target, 'fixture-camera.mp4', 'push_in')
      const legacy = attachLegacyCameraMove(target, 'fixture-camera.mp4', 'push_in')
      expect(modern.kind).toBe('patch')
      expect(legacy.kind).toBe('patch')
      if (modern.kind !== 'patch' || legacy.kind !== 'patch') throw new Error('Expected prompt fallback')
      const expected = prompt === '人物推门'
        ? '人物推门\n镜头运动：推近（相机正面推近主体，逐渐放大主体、强化压迫感或聚焦。）'
        : prompt
      expect(modern.patch.prompt).toBe(expected)
      expect(legacy.patch.prompt).toBe(expected)
    }
    const authored = '人物看手机\n屏幕可见性硬规则（用户自定）：只拍手机背面。'
    const compiled = compileVideoPromptForReferences({ prompt: authored, strategy: 'text_only' })
    expect(compiled.startsWith(authored)).toBe(true)
    expect(compiled.match(/屏幕可见性硬规则/g)).toHaveLength(1)
    expect(compileVideoPromptForReferences({ prompt: compiled, strategy: 'text_only' })).toBe(compiled)
    for (const prompt of ['人物看手机', 'a person holding a phone']) {
      expect(compileVideoPromptForReferences({ prompt, strategy: 'text_only' })).toContain('屏幕可见性硬规则')
    }
  })
  it.each(['zh-CN', 'en-US'])('classifies source codes without reading human words: %s', async locale => {
    await i18n.changeLanguage(locale)
    for (const kind of ['output-truncated', 'codex-network', 'codex-timeout'] as const) {
      const report = classifyGenerationError(tagNomiError(kind as NomiErrorCode, 'Localized detail with no source keywords'))
      expect(report.kind).toBe(kind)
      expect(report.raw).not.toContain('NOMI_ERR::')
    }
    for (const [code, scenario] of [['image-edit-missing-reference', 'image_edit'], ['image-video-missing-reference', 'image_to_video']] as const) {
      const report = classifyGenerationError(tagNomiError(code as NomiErrorCode, 'Localized detail'))
      expect(report.kind).toBe('input')
      expect(report.reason).toBe(i18n.t(scenario === 'image_edit'
        ? 'generationCommon.composer.imageConnectionRequired'
        : 'generationCommon.composer.videoFirstFrameRequired'))
      expect(report.vendorSide).toBe(false)
      expect(report.raw).not.toContain('NOMI_ERR::')
    }
  })

  it.each(['image_edit', 'image_to_video'])('tags the actual input guard before IPC: %s', kind => {
    const raw = imageEditGuardError(kind, {}, true, 'Selected model')!
    expect(matchNomiErrorCode(raw)).toBe(kind === 'image_edit' ? 'image-edit-missing-reference' : 'image-video-missing-reference')
    expect(raw).toContain(kind === 'image_edit' ? '图生图缺少参考图' : '图生视频缺少参考图')
  })

  it('uses the Agent finish reason as truncation identity without changing authored detail', () => {
    const raw = describeEmptyAgentReply('length', { modelLabel: 'model-x', agentNote: '用户保留的说明' })
    expect(matchNomiErrorCode(raw)).toBe('output-truncated')
    expect(raw).toContain('模型「model-x」这一轮达到了输出长度上限，内容被截断，没能完整返回。')
    expect(raw).toContain('用户保留的说明')
    expect(describeEmptyAgentReply('stop', { modelLabel: 'model-x' })).toBe('')
  })

  it.each(['codex-timeout', 'codex-network', 'operation-cancelled'] as const)('never resubmits a coded uncertain/cancelled outcome: %s', code => {
    const error = Object.assign(new Error(tagNomiError(code as NomiErrorCode, 'Rate limit; fetch failed; temporarily unavailable')), {
      status: 503, structured: { retryable: true, category: 'network' },
    })
    expect(isRetryableGenerationError(error, 'image')).toBe(false)
    expect(isRetryableGenerationError(error, 'text')).toBe(false)
  })

  it.each([
    ['图生图缺少参考图：这次请求里没有任何图片可以发给模型。', 'input'],
    ['图生视频缺少参考图：这次请求里没有任何图片可以发给模型。', 'input'],
    ['模型「old-model」这一轮达到了输出长度上限，内容被截断，没能完整返回。', 'output-truncated'],
    ['Codex Img2 网络请求失败：503 Service Unavailable', 'codex-network'],
    ['Codex Img2 生成超时（300 秒）', 'codex-timeout'],
    ['Codex Img2 长时间无进展（120 秒没有输出）', 'codex-timeout'],
    ['Codex Img2 generation timed out (300 seconds)', 'codex-timeout'],
    ['Codex Img2 has made no progress (no output for 120 seconds)', 'codex-timeout'],
  ])('reads the historical source record without rewriting it: %s', (raw, kind) => {
    expect(classifyGenerationError(raw).kind).toBe(kind)
    expect(classifyGenerationError(raw).raw).toBe(raw)
    expect(classifyGenerationError(`Error invoking remote method 'task:create': Error: ${raw}`).kind).toBe(kind)
    if (kind === 'codex-timeout') expect(isRetryableGenerationError(Object.assign(new Error(raw), { status: 503 }), 'text')).toBe(false)
  })

  it.each(['账户余额不足', '余额不足，请充值', '该账户已欠费', '活动会员金额不支持 API 调用，请充值'])('retains actionable Chinese billing evidence: %s', raw => {
    expect(classifyGenerationError(raw).kind).toBe('balance')
  })

  it('does not turn an incidental mention of balance into a billing failure', () => {
    const transportKind = classifyGenerationError('fetch failed').kind
    expect(transportKind).not.toBe('balance')
    expect(classifyGenerationError('fetch failed；余额说明在帮助页').kind).toBe(transportKind)
  })

  it.each(['Blender 渲染已取消', 'Blender rendering was cancelled'])('reads pre-code cancellation in either display language: %s', raw => {
    expect(matchNomiErrorCode(raw)).toBe('operation-cancelled')
    expect(matchNomiErrorCode(`Error invoking remote method 'scene3d:render': Error: ${raw}`)).toBe('operation-cancelled')
  })

  it('does not reinterpret a quoted historical local phrase as source identity', () => {
    expect(matchNomiErrorCode('用户创作文本：Codex Img2 生成超时（300 秒）')).toBeNull()
    expect(matchNomiErrorCode('用户创作文本：图生图缺少参考图')).toBeNull()
  })

  it.each(['zh-CN', 'en-US'])('keeps canonical capture source and historical Chinese title recognition: %s', async locale => {
    await i18n.changeLanguage(locale)
    expect(scene3dCaptureSource.cameraMoveFrameTitle('相机 A', scene3dCaptureSource.firstFrame())).toBe('相机 A · 运镜首帧')
    expect(referenceSlotForScene3DCaptureTitle('用户保留 · 运镜首帧 · 说明')).toBe('first_frame')
    expect(referenceSlotForScene3DCaptureTitle('用户保留 · 运镜尾帧 · 说明')).toBe('last_frame')
  })
})
