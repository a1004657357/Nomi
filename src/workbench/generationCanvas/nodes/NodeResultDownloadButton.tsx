import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconBrandBlender, IconCube, IconDownload } from '@tabler/icons-react'
import { useResultDownload } from './useResultDownload'
import { FloatingToolbarShell, TOOLBAR_ICON as I, ToolbarButton, ToolbarDivider, ToolbarDuplicateVariantButton, ToolbarProvenanceButton, ToolbarReshootButton } from './NodeFloatingToolbar'
import NodeVideoFrameToolbar from './NodeVideoFrameToolbar'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { handoffModel3dNode, type Model3dHandoffTarget } from '../agent/model3dHandoff'
import { toast } from '../../../ui/toast'
import { isCapabilityRecipesEnabled } from '../../../config/featureFlags'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../project/projectCanvasReadSurface'

// 非图片结果（视频等）的浮条：视频结果 → 抽首帧/抽尾帧 + 下载（NodeVideoFrameToolbar）；
// 其它非图片结果 → 仅下载。图片结果的下载在 NodeImageEditToolbar。仅在选中且有可下载结果时渲染。

type Props = {
  reportFeedback: (message: string) => void
  node: GenerationCanvasNode
  selected: boolean
  onPreview: () => void
  /** 生成记录（从卡片右上角迁来；这条链覆盖视频与其它非图片结果）。 */
  onOpenProvenance: () => void
}

export default function NodeResultDownloadButton({ reportFeedback, node, selected, onPreview, onOpenProvenance }: Props): JSX.Element | null {

  const { t } = useTranslation()
  const [handoffBusy, setHandoffBusy] = React.useState<Model3dHandoffTarget | null>(null)
  const handoff = React.useCallback((target: Model3dHandoffTarget) => withProjectAction(project => {
    project.assertCurrent()
    if (handoffBusy) return
    setHandoffBusy(target)
    void handoffModel3dNode({ project, sourceNodeId: node.id, target })
      .then(() => { project.assertCurrent(); toast(target === 'scene3d' ? '已送入 3D 导演台' : '已送入 Blender Director', 'success') })
      .catch((error: unknown) => { if (isProjectExecutionContextCurrent(project)) toast(error instanceof Error ? error.message : '3D 模型交接失败', 'error') })
      .finally(() => { if (isProjectExecutionContextCurrent(project)) setHandoffBusy(null) })
  }, () => { toast('请先打开一个本地项目', 'error') }), [handoffBusy, node.id])
  const { canDownload, downloading, download } = useResultDownload(node, reportFeedback)
  if (!selected || !canDownload || node.result?.type === 'image') return null

  // 视频结果 → 专用浮条（抽首/尾帧 + 下载）。
  if (node.result?.type === 'video') {
    return <><NodeVideoFrameToolbar reportFeedback={reportFeedback} node={node} downloading={downloading} onDownload={download} onPreview={onPreview} onOpenProvenance={onOpenProvenance} /></>
  }

  if (node.result?.type === 'model3d' && isCapabilityRecipesEnabled()) {
    return (
      <FloatingToolbarShell ariaLabel="3D 模型操作" lockNodeId={node.id}>
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
        <ToolbarProvenanceButton onOpen={onOpenProvenance} />
      </FloatingToolbarShell>
    )
  }

  return (
    <FloatingToolbarShell ariaLabel={t('generationCommon.resultDownload.actions')} lockNodeId={node.id}>

      <ToolbarButton
        icon={<IconDownload size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.resultDownload.download')}
        title={t('generationCommon.resultDownload.downloadHint')}
        disabled={downloading}
        onClick={download}
      />
      <ToolbarDuplicateVariantButton nodeId={node.id} />
      <ToolbarReshootButton nodeId={node.id} />
      <ToolbarProvenanceButton onOpen={onOpenProvenance} />
    </FloatingToolbarShell>
  )
}
