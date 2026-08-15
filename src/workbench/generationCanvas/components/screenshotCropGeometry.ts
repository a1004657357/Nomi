/**
 * 全局截图选区的纯几何 + 裁切。
 *
 * 选区一律用**归一化坐标**（0-1）而不是像素：抓到的图是物理像素（Retina 上是逻辑尺寸的 2 倍），
 * 而用户是在一张被 object-contain 缩放过的预览上拖的。存归一化值，两边就都不用关心缩放倍数了。
 */

export type SelectionRect = { x: number; y: number; width: number; height: number }

/** 两个拖拽端点 → 归一化矩形（反向拖也要正常出矩形，别出负宽高）。 */
export function normalizeSelectionRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): SelectionRect {
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const x1 = clamp(start.x)
  const y1 = clamp(start.y)
  const x2 = clamp(end.x)
  const y2 = clamp(end.y)
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

/** 归一化选区 → 源图像素矩形（至少 1px，避免 drawImage 拿到 0 宽高画出空白）。 */
export function selectionToPixelRect(
  selection: SelectionRect,
  imageWidth: number,
  imageHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.max(0, Math.min(imageWidth - 1, Math.round(selection.x * imageWidth)))
  const sy = Math.max(0, Math.min(imageHeight - 1, Math.round(selection.y * imageHeight)))
  const sw = Math.max(1, Math.min(imageWidth - sx, Math.round(selection.width * imageWidth)))
  const sh = Math.max(1, Math.min(imageHeight - sy, Math.round(selection.height * imageHeight)))
  return { sx, sy, sw, sh }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load screenshot.'))
    if (!url.startsWith('data:') && !url.startsWith('blob:')) image.crossOrigin = 'anonymous'
    image.src = url
  })
}

export async function cropScreenshotRegion(
  url: string,
  selection: SelectionRect,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null
  const image = await loadImage(url).catch(() => null)
  if (!image) return null
  const imageWidth = image.naturalWidth || image.width
  const imageHeight = image.naturalHeight || image.height
  if (!imageWidth || !imageHeight) return null
  const { sx, sy, sw, sh } = selectionToPixelRect(selection, imageWidth, imageHeight)
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)
  return { dataUrl: canvas.toDataURL('image/png'), width: sw, height: sh }
}
