const LOCAL_ASSET_THUMBNAIL_PARAM = 'nomi-thumbnail'

export type LocalAssetThumbnailSize = {
  width: number
  height: number
}

/**
 * Ask Electron's nomi-local protocol for a small display-only derivative.
 * The original URL remains unchanged in project data and generation inputs.
 */
export function localAssetThumbnailUrl(
  source: string,
  size: LocalAssetThumbnailSize,
): string {
  const raw = String(source || '').trim()
  if (!raw.startsWith('nomi-local://asset/')) return raw
  try {
    const url = new URL(raw)
    url.searchParams.set(LOCAL_ASSET_THUMBNAIL_PARAM, `${size.width}x${size.height}`)
    return url.toString()
  } catch {
    return raw
  }
}
