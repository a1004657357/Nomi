import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconBrandBlender, IconCube, IconDownload } from '@tabler/icons-react'
import { useResultDownload } from './useResultDownload'
import { FloatingToolbarShell, TOOLBAR_ICON as I, ToolbarButton, ToolbarDivider } from './NodeFloatingToolbar'
import NodeVideoFrameToolbar from './NodeVideoFrameToolbar'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { handoffModel3dNode, type Model3dHandoffTarget } from '../agent/model3dHandoff'
import { toast } from '../../../ui/toast'
import { isCapabilityRecipesEnabled } from '../../../config/featureFlags'

// 非图片结果（视频等）的浮条：视频结果 → 抽首帧/抽尾帧 + 下载（NodeVideoFrameToolbar）；
// 其它非图片结果 → 仅下载。图片结果的下载在 NodeImageEditToolbar。仅在选中且有可下载结果时渲染。

type Props = {
  node: GenerationCanvasNode
  selected: boolean
  onPreview: () => void
}

export default function NodeResultDownloadButton({ node, selected, onPreview }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const { canDownload, downloading, download } = useResultDownload(node)
  const [handoffBusy, setHandoffBusy] = React.useState<Model3dHandoffTarget | null>(null)
  const handoff = React.useCallback((target: Model3dHandoffTarget) => {
    if (handoffBusy) return
    setHandoffBusy(target)
    void handoffModel3dNode({ sourceNodeId: node.id, target })
      .then(() => toast(target === 'scene3d' ? '已送入 3D 导演台' : '已送入 Blender Director', 'success'))
      .catch((error: unknown) => toast(error instanceof Error ? error.message : '3D 模型交接失败', 'error'))
      .finally(() => setHandoffBusy(null))
  }, [handoffBusy, node.id])
  if (!selected || !canDownload || node.result?.type === 'image') return null

  // 视频结果 → 专用浮条（抽首/尾帧 + 下载）。
  if (node.result?.type === 'video') {
    return <NodeVideoFrameToolbar node={node} downloading={downloading} onDownload={download} onPreview={onPreview} />
  }

  if (node.result?.type === 'model3d' && isCapabilityRecipesEnabled()) {
    return (
      <FloatingToolbarShell ariaLabel="3D 模型操作">
        <ToolbarButton
          icon={<IconCube size={I.size} stroke={I.stroke} />}
          label="送入 3D 导演台"
          title="创建可交互的 Scene3D 导演台节点"
          disabled={Boolean(handoffBusy)}
          onClick={() => handoff('scene3d')}
        />
        <ToolbarDivider />
        <ToolbarButton
          icon={<IconBrandBlender size={I.size} stroke={I.stroke} />}
          label="送入 Blender Director"
          title="复制到 Blender Director 资产库并创建摆位对象"
          disabled={Boolean(handoffBusy)}
          onClick={() => handoff('vibingDirector')}
        />
        <ToolbarDivider />
        <ToolbarButton
          icon={<IconDownload size={I.size} stroke={I.stroke} />}
          label="下载"
          title="下载 / 另存到本地"
          disabled={downloading || Boolean(handoffBusy)}
          onClick={download}
        />
      </FloatingToolbarShell>
    )
  }

  return (
    <FloatingToolbarShell ariaLabel={t('generationCommon.resultDownload.actions')}>
      <ToolbarButton
        icon={<IconDownload size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.resultDownload.download')}
        title={t('generationCommon.resultDownload.downloadHint')}
        disabled={downloading}
        onClick={download}
      />
    </FloatingToolbarShell>
  )
}
