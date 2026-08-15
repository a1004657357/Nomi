import React from 'react'
import { cn } from '../../utils/cn'
import { NomiImage } from '../../design/media'
import { useFilmstrip } from '../../media/useFilmstrip'
import type { AssetRef } from './assetTypes'

/**
 * 视频素材封面的唯一渲染点（素材库瀑布流 / 方格 / 选择器共用）。
 *
 * 为什么需要它：导入的视频没有 thumbUrl（导入链路不抽封面），此前一律是空灰块——
 * 素材库里所有视频长得一模一样，用户认不出哪个是哪个，等于"看不到素材"（2026-08-01 真机实测）。
 * 复用时间轴那份胶片条缓存（16 帧拼条，落 .nomi/cache 不进素材库），取第 1 格当封面：
 * 同一个视频在时间轴和素材库只抽一次。
 */
export function AssetVideoCover({ asset, className }: { asset: AssetRef; className?: string }): JSX.Element {
  // 已有封面就不抽（传空串给 hook = 不排队）
  const filmstrip = useFilmstrip(
    asset.thumbUrl ? '' : asset.renderUrl,
    asset.origin.source === 'project' ? asset.origin.projectId : undefined,
  )

  if (asset.thumbUrl) {
    return <NomiImage className={cn('h-full w-full object-cover', className)} src={asset.thumbUrl} alt={asset.name} />
  }
  if (filmstrip?.status === 'ready') {
    return (
      <div
        className={cn('h-full w-full bg-nomi-ink-05', className)}
        style={{
          backgroundImage: `url(${JSON.stringify(filmstrip.url)})`,
          // 条图含 tiles 格：放大 tiles 倍后停在第 1 格 = 视频首帧
          backgroundSize: `${filmstrip.tiles * 100}% 100%`,
          backgroundPosition: 'left center',
          backgroundRepeat: 'no-repeat',
        }}
        aria-hidden="true"
      />
    )
  }
  return <div className={cn('h-full w-full bg-nomi-ink-05', className)} aria-hidden="true" />
}
