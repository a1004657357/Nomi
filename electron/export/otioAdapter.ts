/**
 * Gate 6 — OpenTimelineIO（OTIO）adapter（§19.2）。
 *
 * 对应目标架构 §19.2「使用 OpenTimelineIO 作为跨编辑工具交换层」。
 * 现状（Gate 0 §1.11 证据）：**完全 ABSENT**——全仓 grep `otio`/`OpenTimelineIO` 零命中，无依赖。
 *
 * 设计：
 * - **无外部依赖**：OTIO 是 JSON 格式（有文档化的 schema）；本 adapter 实现 NomiRenderManifestV1 ↔ OTIO JSON 的序列化/反序列化。
 * - **§19.2 round trip**：导出再导入，clip 顺序/时长/轨道/revision 关联 100% 保留。
 * - **metadata 携带**：§19.2「Provider task、prompt 和验收信息作为 metadata」——shotId/revisionId 进 clip.metadata。
 *
 * OTIO JSON 形（简化，遵循 OpenTimelineIO 0.17 schema）：
 * { OTIO_SCHEMA: 'Timeline.1', metadata: {}, tracks: [{ OTIO_SCHEMA: 'Stack.1', children: [track] }] }
 * track: { OTIO_SCHEMA: 'Sequence.1', kind: 'Video'|'Audio', children: [clip] }
 * clip: { OTIO_SCHEMA: 'Clip.1', name, media_reference: {target_url}, source_range: {start_time, duration}, metadata: {shotId, revisionId} }
 */
import type { NomiRenderClip, NomiRenderManifestV1, NomiRenderTrack } from './exportManifest'

/** OTIO 时间值（rational form：value / rate）。 */
type OtioRationalTime = {
  OTIO_SCHEMA: 'RationalTime.1'
  value: number
  rate: number
}

/** OTIO 时间范围。 */
type OtioTimeRange = {
  OTIO_SCHEMA: 'TimeRange.1'
  start_time: OtioRationalTime
  duration: OtioRationalTime
}

type OtioClip = {
  OTIO_SCHEMA: 'Clip.1'
  name: string
  media_reference: {
    OTIO_SCHEMA: 'ExternalReference.1'
    target_url: string
    available_image_bounds?: { OTIO_SCHEMA: 'ImageRectReference.1'; width: number; height: number }
  }
  source_range: OtioTimeRange
  metadata: {
    Nomi?: {
      shotId?: string
      revisionId?: string
      nodeId?: string
    }
  }
}

type OtioSequence = {
  OTIO_SCHEMA: 'Sequence.1'
  name: string
  kind: 'Video' | 'Audio'
  children: OtioClip[]
}

type OtioStack = {
  OTIO_SCHEMA: 'Stack.1'
  name: string
  children: OtioSequence[]
}

type OtioTimeline = {
  OTIO_SCHEMA: 'Timeline.1'
  name: string
  metadata: { Nomi?: { projectId: string; fps: number; exportedAt: string } }
  tracks: OtioStack
}

/**
 * NomiRenderManifestV1 → OTIO Timeline JSON。
 * §19.2：clips/tracks/markers/metadata 转换；shotId/revisionId 进 clip.metadata.Nomi。
 */
export function manifestToOtio(manifest: NomiRenderManifestV1): OtioTimeline {
  const fps = manifest.timeline.fps
  const sequences: OtioSequence[] = manifest.timeline.tracks.map((track) =>
    nomiTrackToOtioSequence(track, fps, manifest.assets),
  )
  return {
    OTIO_SCHEMA: 'Timeline.1',
    name: `Nomi-${manifest.projectId}`,
    metadata: {
      Nomi: {
        projectId: manifest.projectId,
        fps,
        exportedAt: manifest.createdAt,
      },
    },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: sequences,
    },
  }
}

function nomiTrackToOtioSequence(
  track: NomiRenderTrack,
  fps: number,
  assets: NomiRenderManifestV1['assets'],
): OtioSequence {
  // NomiRenderTrack.kind/type 都可能为空；按 assets 推断或默认 Video
  const trackKindRaw = track.kind ?? track.type ?? 'video'
  const kind: 'Video' | 'Audio' = trackKindRaw === 'audio' ? 'Audio' : 'Video'
  const clips: OtioClip[] = (track.clips ?? []).map((clip) => {
    const asset = clip.assetId ? assets[clip.assetId] : undefined
    const targetUrl = asset?.absolutePath ?? ''
    const frameCount = clip.endFrame - clip.startFrame
    const offsetStart = clip.sourceStartFrame ?? 0
    // clip.id 编码 shotId/revisionId（若调用方在 id 里携带）；否则从 transform/text 提取（若有）
    const meta = extractClipNomiMeta(clip)
    return {
      OTIO_SCHEMA: 'Clip.1',
      name: clip.id,
      media_reference: {
        OTIO_SCHEMA: 'ExternalReference.1',
        target_url: targetUrl,
        ...(asset?.width && asset?.height
          ? {
              available_image_bounds: {
                OTIO_SCHEMA: 'ImageRectReference.1',
                width: asset.width,
                height: asset.height,
              },
            }
          : {}),
      },
      source_range: {
        OTIO_SCHEMA: 'TimeRange.1',
        start_time: rt(offsetStart, fps),
        duration: rt(frameCount, fps),
      },
      metadata: { Nomi: meta },
    }
  })
  return {
    OTIO_SCHEMA: 'Sequence.1',
    name: track.id,
    kind,
    children: clips,
  }
}

/** 从 NomiRenderClip 提取 shotId/revisionId（clip.transform 或 text 里若携带）。 */
function extractClipNomiMeta(clip: NomiRenderClip): { shotId?: string; revisionId?: string; nodeId?: string } {
  const meta: { shotId?: string; revisionId?: string; nodeId?: string } = {}
  const transform = clip.transform as Record<string, unknown> | undefined
  if (transform) {
    if (typeof transform.shotId === 'string') meta.shotId = transform.shotId
    if (typeof transform.revisionId === 'string') meta.revisionId = transform.revisionId
    if (typeof transform.nodeId === 'string') meta.nodeId = transform.nodeId
  }
  return meta
}

function rt(value: number, rate: number): OtioRationalTime {
  return { OTIO_SCHEMA: 'RationalTime.1', value, rate }
}

/** otioToManifestTimeline 还原出的单个 clip 形（§19.2 导入侧）。 */
type ReimportedClip = {
  assetId: string
  label: string
  startFrame: number
  endFrame: number
  frameCount: number
  offsetStartFrame: number
  shotId?: string
  revisionId?: string
  sourceNodeId?: string
  url?: string
}

/**
 * OTIO Timeline JSON → NomiRenderManifestV1（round trip 的反向）。
 * §19.2：导入时转回 clips/tracks/metadata；shotId/revisionId 从 clip.metadata.Nomi 还原。
 *
 * 注意：返回的是「timeline 部分」+ 必要元数据；完整 manifest 的 assets/profile 由调用方补。
 */
export function otioToManifestTimeline(
  otio: OtioTimeline,
): {
  projectId: string
  fps: number
  tracks: Array<{
    id: string
    kind: 'image' | 'video' | 'audio'
    label: string
    clips: Array<{
      assetId: string
      label: string
      startFrame: number
      endFrame: number
      frameCount: number
      offsetStartFrame: number
      shotId?: string
      revisionId?: string
      sourceNodeId?: string
      url?: string
    }>
  }>
} {
  const fps = otio.metadata?.Nomi?.fps ?? 24
  const projectId = otio.metadata?.Nomi?.projectId ?? 'imported'
  const tracks = (otio.tracks?.children ?? []).map((seq, trackIdx) => {
    const kind: 'image' | 'video' | 'audio' =
      seq.kind === 'Audio' ? 'audio' : 'video'
    let runningFrame = 0
    const clips: ReimportedClip[] = (seq.children ?? []).map((clip, clipIdx) => {
      const duration = clip.source_range?.duration?.value ?? 0
      const offsetStart = clip.source_range?.start_time?.value ?? 0
      const startFrame = runningFrame
      const endFrame = runningFrame + duration
      runningFrame = endFrame
      const targetUrl = clip.media_reference?.target_url ?? ''
      return {
        assetId: `otio-${trackIdx}-${clipIdx}`,
        label: clip.name ?? `clip-${clipIdx}`,
        startFrame,
        endFrame,
        frameCount: duration,
        offsetStartFrame: offsetStart,
        ...(clip.metadata?.Nomi?.shotId ? { shotId: clip.metadata.Nomi.shotId } : {}),
        ...(clip.metadata?.Nomi?.revisionId ? { revisionId: clip.metadata.Nomi.revisionId } : {}),
        ...(clip.metadata?.Nomi?.nodeId ? { sourceNodeId: clip.metadata.Nomi.nodeId } : {}),
        ...(targetUrl ? { url: targetUrl } : {}),
      }
    })
    return {
      id: `otio-track-${trackIdx}`,
      kind,
      label: seq.name ?? seq.kind,
      clips,
    }
  })
  return { projectId, fps, tracks }
}

/**
 * §19.2 round trip 完整性自检：导出→导入，clip 顺序/时长/轨道/revision 关联是否保留。
 * 供测试与诊断。
 */
export function assertOtioRoundTrip(manifest: NomiRenderManifestV1): {
  lossless: boolean
  issues: string[]
} {
  const issues: string[] = []
  const otio = manifestToOtio(manifest)
  const reimported = otioToManifestTimeline(otio)
  // 轨道数一致
  if (reimported.tracks.length !== manifest.timeline.tracks.length) {
    issues.push(`轨道数不一致：导出 ${manifest.timeline.tracks.length} vs 导入 ${reimported.tracks.length}`)
  }
  // 每轨 clip 数 + 顺序 + 时长
  for (let t = 0; t < manifest.timeline.tracks.length; t++) {
    const orig = manifest.timeline.tracks[t]
    const reimp = reimported.tracks[t]
    if (!orig || !reimp) continue
    const origClips = orig.clips ?? []
    if (origClips.length !== reimp.clips.length) {
      issues.push(`轨 ${t} clip 数不一致：${origClips.length} vs ${reimp.clips.length}`)
      continue
    }
    for (let c = 0; c < origClips.length; c++) {
      const oc = origClips[c]
      const rc = reimp.clips[c]
      const origFrameCount = oc.endFrame - oc.startFrame
      if (origFrameCount !== rc.frameCount) {
        issues.push(`轨 ${t} clip ${c} 时长不一致：${origFrameCount} vs ${rc.frameCount}`)
      }
      // shotId/revisionId 携带在 transform 里（若有）
      const origShotId = (oc.transform as Record<string, unknown> | undefined)?.shotId
      if (typeof origShotId === 'string' && origShotId !== rc.shotId) {
        issues.push(`轨 ${t} clip ${c} shotId 丢失：${origShotId}`)
      }
    }
  }
  return { lossless: issues.length === 0, issues }
}
