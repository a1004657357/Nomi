import i18n from './index'
import type { TranslationKey } from './translationKey'

const displayKeys = new Map<string, TranslationKey>([
  ['特写', 'canvasComponents.closeUp'],
  ['近景', 'canvasComponents.mediumCloseUp'],
  ['中景', 'canvasComponents.mediumShot'],
  ['全景', 'canvasComponents.wideShot'],
  ['图片', 'canvasComponents.image'],
  ['视频封面', 'canvasComponents.videoPoster'],
  ['ChatGPT 图像', 'canvasComponents.chatgptImages'],
  ['即梦 Web', 'canvasComponents.jimengWeb'],
  ['Blender 正在执行导演计划', 'canvasComponents.blenderIsExecutingTheDirectorPlan'],
])

/** Localize only known display copies; callers keep the original stored value. */
export function translateCanvasComponentText(source: string): string {
  const key = displayKeys.get(source)
  return key ? i18n.t(key) : source
}
