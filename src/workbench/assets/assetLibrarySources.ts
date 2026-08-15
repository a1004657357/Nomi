import type { AssetRef } from './assetTypes'

export function filterImageVideoAssets(assets: readonly AssetRef[]): AssetRef[] {
  return assets.filter((asset) => asset.kind === 'image' || asset.kind === 'video')
}

/** 图/视频/音频都放行——剪辑页左栏用（音频=配乐来源，见 AssetLibraryContent 的 includeAudio）。 */
export function filterPlayableAssets(assets: readonly AssetRef[]): AssetRef[] {
  return assets.filter((asset) => asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio')
}
