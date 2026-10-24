import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const canvas = 'src/workbench/generationCanvas/'
export const contentFlowCases = [
  { id: 'codex', file: 'src/ui/onboarding/CodexImagegenManage.tsx', anchors: ['本机 Codex 图片通道', '无需 API Key'], width: 480 },
  { id: 'batch', file: canvas + 'components/BatchGenerateSettingsButton.tsx', anchors: ['批量生成设置', 'checked={skipExisting}'], width: 360 },
  { id: 'auto-review', file: canvas + 'components/CapabilityAutoVisionReviewControl.tsx', anchors: ['aria-label="生成后自动视觉复核"', '<IconEye'], width: 440 },
  { id: 'output-count', file: canvas + 'components/CapabilityRecipeInspector.tsx', anchors: ['aria-label="输出数量"', '<IconRotate'], width: 440 },
  { id: 'mood-summary', file: canvas + 'components/CapabilityRecipeInspector.tsx', anchors: ['data-mood-request-summary', '行：能量 · 列：亲和'], width: 440 },
  { id: 'human-reviewed', file: canvas + 'nodes/CapabilityHumanReviewControl.tsx', anchors: ['人工视觉验收', 'reviewLabel(review)'], width: 300 },
  { id: 'human-unreviewed', file: canvas + 'nodes/CapabilityHumanReviewControl.tsx', anchors: ['人工视觉验收', 'reviewLabel(review)'], width: 300 },
  { id: 'quality', file: canvas + 'nodes/CapabilityQualityReportPopover.tsx', anchors: ['本地质量报告', 'qualityLabel(report.status)'], width: 300 },
  { id: 'matrix-axes', file: canvas + 'nodes/CapabilityResultCollection.tsx', anchors: ['能量 0 → 4', '亲和 0 → 4'], width: 360 },
  { id: 'candidate', file: canvas + 'nodes/CapabilityResultCollection.tsx', anchors: ['候选 {index + 1}', 'selected ? <IconCheck'], width: 180, overlay: true },
  { id: 'portrait', file: canvas + 'nodes/PortraitComparisonDialog.tsx', tag: 'header', anchors: ['aria-label="关闭原图对比"', '原图对比'], width: 1200, dark: true },
  { id: 'keyframe-header', file: canvas + 'nodes/VideoKeyframeInspectorDialog.tsx', anchors: ['视频关键帧检查器</h2>', 'onClick={onClose}'], width: 980 },
  { id: 'keyframe-selection', file: canvas + 'nodes/VideoKeyframeInspectorDialog.tsx', anchors: ['抽帧数量</span>', '已选 {selected.size}'], width: 980 },
  { id: 'keyframe-check', file: canvas + 'nodes/VideoKeyframeInspectorDialog.tsx', anchors: ['formatVideoFrameTime(frame.timeSeconds)', 'checked ? <IconCheck'], width: 220 },
  { id: 'camera-target', file: canvas + 'nodes/model3d/Model3DCameraNodeBody.tsx', anchors: ['title="相机目标点"', 'label="复位机位"'], width: 640 },
  { id: 'image-close', file: canvas + 'nodes/render/ImageComparisonNodeBody.tsx', anchors: ['图像对比</span>', 'label="关闭全屏对比"'], width: 900, dark: true },
  { id: 'storyboard', file: canvas + 'nodes/render/StoryboardTableNode.tsx', anchors: ['aria-label="拖动分镜表节点"', 'Agent补表'], width: 1000 },
]

export const contentFlowFiles = [...new Set(contentFlowCases.map((entry) => entry.file))]

export function findContentFlowRow(root, entry) {
  const source = ts.createSourceFile(entry.file, fs.readFileSync(path.join(root, entry.file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const matches = []
  const visit = (node) => {
    if (ts.isJsxElement(node) && (!entry.tag || node.openingElement.tagName.getText(source) === entry.tag)
      && entry.anchors.every((anchor) => node.getText(source).includes(anchor))) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  matches.sort((a, b) => a.getWidth(source) - b.getWidth(source))
  if (!matches.length) throw new Error(`Missing actual JSX row: ${entry.id}`)
  return { source, node: matches[0], text: matches[0].getText(source) }
}

export function withoutLayoutClasses(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const transformed = ts.transform(source, [(context) => {
    const visit = (node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === 'className') return undefined
      return ts.visitEachChild(node, visit, context)
    }
    return (node) => ts.visitNode(node, visit)
  }])
  try {
    return ts.createPrinter().printFile(transformed.transformed[0])
  } finally {
    transformed.dispose()
  }
}
