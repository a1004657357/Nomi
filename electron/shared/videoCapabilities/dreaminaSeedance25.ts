// 即梦官方 dreamina CLI 1.4.15 的 Seedance 2.5 视频档案。
// 2.5 与 2.0 的时长、清晰度及全能参考输入上限不同，因此保留为独立 catalog 模型，避免能力误报。
import type { ModelParameterControl } from './types'
import type { ModelArchetype } from './types'

const opt = (values: Array<string | number>): ModelParameterControl['options'] =>
  values.map((value) => ({ value, label: String(value) }))

const RATIO: ModelParameterControl = {
  key: 'ratio',
  label: '比例',
  type: 'select',
  options: opt(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']),
  defaultValue: '16:9',
}
const RESOLUTION: ModelParameterControl = {
  key: 'video_resolution',
  label: '清晰度',
  type: 'select',
  options: opt(['480p', '720p']),
  defaultValue: '720p',
}
const DURATION: ModelParameterControl = {
  key: 'duration',
  label: '时长(秒)',
  type: 'number',
  options: [],
  min: 4,
  max: 30,
  defaultValue: 5,
}

const PARAMS_WITH_RATIO: ModelParameterControl[] = [RATIO, RESOLUTION, DURATION]
const PARAMS_NO_RATIO: ModelParameterControl[] = [RESOLUTION, DURATION]

export const DREAMINA_SEEDANCE_25_ARCHETYPE: ModelArchetype = {
  id: 'dreamina-seedance-2.5',
  family: 'seedance',
  label: '即梦 Seedance 2.5',
  kind: 'video',
  defaultModeId: 't2v',
  transportTaskKind: 'text_to_video',
  identifierPatterns: ['dreamina-seedance-2.5', 'seedance2.5'],
  modes: [
    {
      id: 't2v',
      intent: 'text',
      vendorTerm: '文生视频',
      hint: '用即梦高级会员积分，纯文字生成 Seedance 2.5 视频',
      promptRequired: true,
      modelEnum: 'seedance2.5',
      transportTaskKind: 'text_to_video',
      fixedParams: { dreamina_cmd: 'text2video' },
      slots: [],
      params: PARAMS_WITH_RATIO,
    },
    {
      id: 'i2v',
      intent: 'single',
      vendorTerm: '图生视频',
      hint: '单张首帧图驱动生成，比例随输入图',
      promptRequired: true,
      modelEnum: 'seedance2.5',
      transportTaskKind: 'image_to_video',
      fixedParams: { dreamina_cmd: 'image2video' },
      slots: [{ kind: 'first_frame', label: '首帧', min: 1, max: 1, inputKey: 'i2v_image' }],
      params: PARAMS_NO_RATIO,
    },
    {
      id: 'firstlast',
      intent: 'firstlast',
      vendorTerm: '首尾帧',
      hint: '首帧 + 尾帧生成中间过程，比例随首帧',
      promptRequired: true,
      modelEnum: 'seedance2.5',
      transportTaskKind: 'image_to_video',
      fixedParams: { dreamina_cmd: 'frames2video' },
      slots: [
        { kind: 'first_frame', label: '首帧', min: 1, max: 1, inputKey: 'frames_first' },
        { kind: 'last_frame', label: '尾帧', min: 1, max: 1, inputKey: 'frames_last' },
      ],
      params: PARAMS_NO_RATIO,
    },
    {
      id: 'multimodal',
      intent: 'character',
      vendorTerm: '全能参考',
      hint: '最多 30 图 / 10 视频 / 10 音频；支持纯音频输入，单项及总参考音视频需为 2–30 秒',
      promptRequired: false,
      modelEnum: 'seedance2.5',
      transportTaskKind: 'image_to_video',
      fixedParams: { dreamina_cmd: 'multimodal2video' },
      slots: [
        { kind: 'image_ref', label: '图片参考', min: 0, max: 30, characterIndexed: true, inputKey: 'mm_images' },
        { kind: 'video_ref', label: '参考视频', min: 0, max: 10, inputKey: 'mm_videos' },
        { kind: 'audio_ref', label: '参考音频', min: 0, max: 10, inputKey: 'mm_audios' },
      ],
      params: PARAMS_WITH_RATIO,
    },
  ],
}
