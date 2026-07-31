import React from 'react'
import { IconDownload, IconPhotoScan, IconPlayerTrackNext, IconPlayerTrackPrev } from '@tabler/icons-react'
import { FloatingToolbarShell, TOOLBAR_ICON as I, ToolbarButton, ToolbarDivider } from './NodeFloatingToolbar'
import { extractVideoFrameToNode } from './extractVideoFrameToNode'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import VideoKeyframeInspectorDialog from './VideoKeyframeInspectorDialog'

// 视频节点浮条（用户拍板「抽帧能力」的用户入口）：抽首帧 / 抽尾帧 ｜ 下载。
// 抽帧 = 从这段视频取首/尾一帧 → 落独立图片节点（extractVideoFrameToNode），能拿去当 Seedance 首尾帧 /
// 任何参考 / 接力源。抽首/尾用两个不同图标（⏮/⏭）一眼可分。容器/按钮走共享 NodeFloatingToolbar（token 合规）。

type Props = {
  node: GenerationCanvasNode
  downloading: boolean
  onDownload: (event: React.MouseEvent) => void
}

export default function NodeVideoFrameToolbar({ node, downloading, onDownload }: Props): JSX.Element {
  const [busy, setBusy] = React.useState<'first' | 'last' | null>(null)
  const [inspecting, setInspecting] = React.useState(false)
  const extract = (which: 'first' | 'last') => {
    if (busy) return
    setBusy(which)
    void extractVideoFrameToNode(node, which).finally(() => setBusy(null))
  }
  return (
    <>
      <FloatingToolbarShell ariaLabel="视频操作">
        <ToolbarButton
          icon={<IconPlayerTrackPrev size={I.size} stroke={I.stroke} />}
          label={busy === 'first' ? '抽帧中…' : '抽首帧'}
          title="抽取这段视频的第一帧 → 落成独立图片节点（可当首帧/参考）"
          disabled={busy !== null}
          onClick={() => extract('first')}
        />
        <ToolbarButton
          icon={<IconPlayerTrackNext size={I.size} stroke={I.stroke} />}
          label={busy === 'last' ? '抽帧中…' : '抽尾帧'}
          title="抽取这段视频的最后一帧 → 落成独立图片节点（可当尾帧/接力源/参考）"
          disabled={busy !== null}
          onClick={() => extract('last')}
        />
        <ToolbarButton
          icon={<IconPhotoScan size={I.size} stroke={I.stroke} />}
          label="检查关键帧"
          title="均匀抽取视频画面，选择后创建独立关键帧节点"
          disabled={busy !== null}
          onClick={() => setInspecting(true)}
        />
        <ToolbarDivider />
        <ToolbarButton
          icon={<IconDownload size={I.size} stroke={I.stroke} />}
          label="下载"
          title="下载 / 另存到本地"
          disabled={downloading}
          onClick={onDownload}
        />
      </FloatingToolbarShell>
      {inspecting ? <VideoKeyframeInspectorDialog node={node} onClose={() => setInspecting(false)} /> : null}
    </>
  )
}
