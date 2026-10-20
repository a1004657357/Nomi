import type { JSX } from 'react'
import React from 'react'
import { Popover } from '@mantine/core'
import { IconAdjustmentsHorizontal, IconPlayerPlay } from '@tabler/icons-react'
import { NomiSelect, WorkbenchButton } from '../../../design'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'
import { formatVideoOptionLabel } from '../../../config/modelCatalogMeta'
import type { DynamicModelControl } from '../nodes/controls/parameterControlModel'
import {
  catalogControlInitialValue,
  controlInitialValue,
  controlValueToString,
  isParameterControl,
  optionLabel,
  optionValue,
} from '../nodes/controls/parameterControlModel'
import { chooseDefaultModelOption, resolveRenderedControls } from '../nodes/nodeModelArchetype'
import { findModelOptionByIdentifier, useGenerationModelOptionsState, deriveGenerationModelCatalogStatus } from '../adapters/modelOptionsAdapter'
import { isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from '../model/generationNodeKinds'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { expandNodeIdsWithUngeneratedReferenceAncestors } from '../runner/referenceAncestors'
import { confirmAndRunPlan } from './batchPlanPreview'
import { useDedupedModelSelect } from '../../common/useDedupedModelSelect'
import { cn } from '../../../utils/cn'
import {
  type BatchMediaKind,
  applyBatchSettingsToNode,
  createBatchDraftMeta,
  patchForBatchControlValue,
} from '../runner/batchImageSettings'
import { toast } from '../../../ui/toast'

type Props = {
  selectedNodeIds: readonly string[]
}

function hasResult(node: { result?: { url?: string; thumbnailUrl?: string; providerUrl?: string } }): boolean {
  return Boolean(node.result?.url || node.result?.thumbnailUrl || node.result?.providerUrl)
}

function firstSelectedModelValue(nodes: readonly GenerationCanvasNode[], mediaKind: BatchMediaKind): string {
  for (const node of nodes) {
    const meta = node.meta || {}
    const value = mediaKind === 'video'
      ? meta.modelKey || meta.modelAlias || meta.videoModel
      : meta.modelKey || meta.modelAlias || meta.imageModel
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function targetKindLabel(mediaKind: BatchMediaKind): string {
  return mediaKind === 'video' ? '视频' : '图片'
}

function isTargetKindNode(node: GenerationCanvasNode, mediaKind: BatchMediaKind): boolean {
  return mediaKind === 'video' ? isVideoLikeGenerationNodeKind(node.kind) : isImageLikeGenerationNodeKind(node.kind)
}

export function BatchGenerateSettingsButton({ selectedNodeIds }: Props): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [skipExisting, setSkipExisting] = React.useState(true)
  const [targetKind, setTargetKind] = React.useState<BatchMediaKind>('image')
  const [modelValue, setModelValue] = React.useState('')
  const [draftMeta, setDraftMeta] = React.useState<Record<string, unknown>>({})
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const imageModelState = useGenerationModelOptionsState('image')
  const videoModelState = useGenerationModelOptionsState('video')
  const activeModelState = targetKind === 'video' ? videoModelState : imageModelState
  const modelOptions = activeModelState.options
  const modelCatalogStatus = deriveGenerationModelCatalogStatus(targetKind, activeModelState)

  const selectedIdSet = React.useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])
  const selectedImageNodes = React.useMemo(
    () => nodes.filter((node) => selectedIdSet.has(node.id) && isImageLikeGenerationNodeKind(node.kind)),
    [nodes, selectedIdSet],
  )
  const selectedVideoNodes = React.useMemo(
    () => nodes.filter((node) => selectedIdSet.has(node.id) && isVideoLikeGenerationNodeKind(node.kind)),
    [nodes, selectedIdSet],
  )
  const selectedTargetNodes = targetKind === 'video' ? selectedVideoNodes : selectedImageNodes
  const selectedModelOption = findModelOptionByIdentifier(modelOptions, modelValue)
  const renderedControls = React.useMemo(
    () => resolveRenderedControls(selectedModelOption, draftMeta, targetKind === 'image', targetKind === 'video'),
    [draftMeta, selectedModelOption, targetKind],
  )

  React.useEffect(() => {
    if (targetKind === 'image' && selectedImageNodes.length === 0 && selectedVideoNodes.length > 0) setTargetKind('video')
    if (targetKind === 'video' && selectedVideoNodes.length === 0 && selectedImageNodes.length > 0) setTargetKind('image')
  }, [selectedImageNodes.length, selectedVideoNodes.length, targetKind])

  const syncDraftFromSelection = React.useCallback(() => {
    const firstNode = selectedTargetNodes[0]
    const nextValue = firstSelectedModelValue(selectedTargetNodes, targetKind) || chooseDefaultModelOption(modelOptions, targetKind === 'image', targetKind === 'video')?.value || ''
    const nextOption = findModelOptionByIdentifier(modelOptions, nextValue)
    const draft = createBatchDraftMeta({
      option: nextOption,
      value: nextValue,
      mediaKind: targetKind,
      sourceMeta: firstNode?.meta || {},
    })
    setModelValue(nextOption?.value || nextValue)
    setDraftMeta(draft.meta)
  }, [modelOptions, selectedTargetNodes, targetKind])

  React.useEffect(() => {
    if (open) syncDraftFromSelection()
  }, [open, syncDraftFromSelection])

  const handleModelChange = React.useCallback((value: string) => {
    const nextOption = findModelOptionByIdentifier(modelOptions, value)
    const nextDraft = createBatchDraftMeta({ option: nextOption, value, mediaKind: targetKind })
    setModelValue(nextOption?.value || value)
    setDraftMeta(nextDraft.meta)
  }, [modelOptions, targetKind])

  const modelSelect = useDedupedModelSelect(modelOptions, selectedModelOption?.value || modelValue, handleModelChange)

  const patchControl = React.useCallback((control: DynamicModelControl, value: string) => {
    setDraftMeta((current) => ({ ...current, ...patchForBatchControlValue(control, value) }))
  }, [])

  const applyAndMaybeRun = React.useCallback(async (run: boolean) => {
    const state = useGenerationCanvasStore.getState()
    const selectedTargets = state.nodes.filter((node) => selectedIdSet.has(node.id) && isTargetKindNode(node, targetKind))
    const label = targetKindLabel(targetKind)
    if (!selectedTargets.length) {
      toast(`没有可批量设置的${label}节点`, 'warning')
      return
    }
    const generationTargets = run ? selectedTargets.filter((node) => !skipExisting || !hasResult(node)) : selectedTargets
    if (run && !generationTargets.length) {
      toast(`选中的${label}节点都已经有结果`, 'warning')
      return
    }
    const regenerationTargetIds = new Set(
      run ? generationTargets.filter(hasResult).map((node) => node.id) : [],
    )
    const expandedIds = expandNodeIdsWithUngeneratedReferenceAncestors(generationTargets.map((node) => node.id), { nodes: state.nodes, edges: state.edges })
    const applySet = new Set(run
      ? [...selectedTargets.map((node) => node.id), ...expandedIds]
      : selectedTargets.map((node) => node.id))
    const applyTargets = state.nodes.filter((node) => applySet.has(node.id) && isTargetKindNode(node, targetKind))
    const nextOption = findModelOptionByIdentifier(modelOptions, modelValue)
    const applySettings = (
      node: GenerationCanvasNode,
      contextNodes: readonly GenerationCanvasNode[],
      contextEdges: typeof state.edges,
    ) => {
      const currentValue = firstSelectedModelValue([node], targetKind)
      const currentOption = findModelOptionByIdentifier(modelOptions, currentValue)
      updateNode(node.id, {
        meta: applyBatchSettingsToNode({
          node,
          nodes: contextNodes,
          edges: contextEdges,
          modelOption: nextOption,
          currentModelOption: currentOption,
          draftMeta,
          mediaKind: targetKind,
        }),
      })
    }
    for (const node of applyTargets) {
      applySettings(node, state.nodes, state.edges)
    }
    if (!run) {
      toast(`已应用到 ${applyTargets.length} 个${label}节点`, 'success')
      setOpen(false)
      return
    }
    const afterState = useGenerationCanvasStore.getState()
    const plan = buildDependencyWaves(expandedIds, { nodes: afterState.nodes, edges: afterState.edges })
    setOpen(false)
    await confirmAndRunPlan(plan, {
      initiator: 'user',
    })
  }, [draftMeta, modelOptions, modelValue, selectedIdSet, skipExisting, targetKind, updateNode])

  const renderControl = (control: DynamicModelControl): JSX.Element => {
    if (!isParameterControl(control)) {
      return (
        <NomiSelect
          key={control.key}
          ariaLabel={control.label}
          leadingLabel={control.label}
          value={catalogControlInitialValue(control, draftMeta)}
          options={control.options.map((option) => ({ value: optionValue(option), label: optionLabel(option) }))}
          onChange={(value) => patchControl(control, value)}
          className="max-w-full"
        />
      )
    }
    if (control.type === 'boolean') {
      return (
        <NomiSelect
          key={control.key}
          ariaLabel={control.label}
          leadingLabel={control.label}
          value={controlInitialValue(control, draftMeta) || 'false'}
          options={[{ value: 'true', label: '开' }, { value: 'false', label: '关' }]}
          onChange={(value) => patchControl(control, value)}
        />
      )
    }
    if (control.options.length > 0) {
      return (
        <NomiSelect
          key={control.key}
          ariaLabel={control.label}
          leadingLabel={control.label}
          value={controlInitialValue(control, draftMeta)}
          options={control.options.map((option) => ({ value: controlValueToString(option.value), label: formatVideoOptionLabel(option.label, option.priceLabel) }))}
          onChange={(value) => patchControl(control, value)}
        />
      )
    }
    return (
      <label key={control.key} className={cn('inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-full border border-nomi-line bg-nomi-paper min-w-0 focus-within:border-nomi-accent')}>
        <span className={cn('shrink-0 text-micro leading-none text-nomi-ink-40')}>{control.label}</span>
        <input
          className={cn('appearance-none bg-transparent border-0 outline-0 text-caption text-nomi-ink-80 min-w-0', control.type === 'number' ? 'w-[64px]' : 'w-[160px]')}
          aria-label={control.label}
          type={control.type === 'number' ? 'number' : 'text'}
          value={controlInitialValue(control, draftMeta)}
          min={(control as ModelParameterControl).min}
          max={(control as ModelParameterControl).max}
          step={(control as ModelParameterControl).step}
          placeholder={(control as ModelParameterControl).placeholder}
          onChange={(event) => patchControl(control, event.target.value)}
        />
      </label>
    )
  }

  const runnableCount = selectedTargetNodes.filter((node) => !skipExisting || !hasResult(node)).length
  const hasMixedTargetKinds = selectedImageNodes.length > 0 && selectedVideoNodes.length > 0
  const targetLabel = targetKindLabel(targetKind)

  return (
    <Popover opened={open} onChange={setOpen} position="top" offset={8} withinPortal shadow="md" radius="md" trapFocus>
      <Popover.Target>
        <button
          type="button"
          data-storyboard-batch-settings="true"
          className={cn(
            'inline-flex items-center gap-2 h-9 px-4 rounded-full border-0 cursor-pointer',
            'bg-nomi-ink text-nomi-paper text-body font-medium hover:bg-nomi-accent',
            'transition-colors duration-[var(--nomi-transition-fast)] disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          title="批量设置模型和参数"
          disabled={selectedImageNodes.length === 0 && selectedVideoNodes.length === 0}
          onClick={() => setOpen((value) => !value)}
        >
          <IconAdjustmentsHorizontal size={16} stroke={1.6} aria-hidden />
          批量设置
        </button>
      </Popover.Target>
      <Popover.Dropdown
        className={cn('w-[360px] max-w-[calc(100vw-32px)]')}
        styles={{
          dropdown: {
            padding: 12,
            border: '1px solid var(--nomi-line)',
            borderRadius: 'var(--nomi-radius-lg)',
            background: 'var(--nomi-paper)',
            boxShadow: 'var(--workbench-shadow-pop)',
          },
        }}
      >
        <div className={cn('flex flex-col gap-3')}>
          <div className={cn('flex items-center justify-between gap-3')}>
            <div className={cn('min-w-0')}>
              <div className={cn('text-body-sm font-medium text-nomi-ink')}>批量生成设置</div>
              <div className={cn('text-caption text-nomi-ink-50')}>{selectedTargetNodes.length} 个{targetLabel}节点</div>
            </div>
            <label className={cn('inline-flex items-center gap-1.5 text-caption text-nomi-ink-70 select-none')}>
              <input
                type="checkbox"
                checked={skipExisting}
                onChange={(event) => setSkipExisting(event.target.checked)}
              />
              {targetKind === 'video' ? '只生成未成片' : '只生成未出图'}
            </label>
          </div>

          {hasMixedTargetKinds ? (
            <div className={cn('flex flex-wrap items-center gap-2')}>
              <NomiSelect
                ariaLabel="类型"
                leadingLabel="类型"
                value={targetKind}
                options={[{ value: 'image', label: '图片' }, { value: 'video', label: '视频' }]}
                onChange={(value) => setTargetKind(value === 'video' ? 'video' : 'image')}
              />
            </div>
          ) : null}

          {modelOptions.length === 0 ? (
            <button
              type="button"
              className={cn('inline-flex items-center justify-center h-8 px-3 rounded-full border border-nomi-accent/30 bg-nomi-accent-soft text-nomi-accent text-body-sm font-medium')}
              onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))}
            >
              {modelCatalogStatus.message}
            </button>
          ) : (
            <div className={cn('flex flex-wrap items-center gap-2')}>
              <NomiSelect
                ariaLabel="模型"
                placeholder="选择模型"
                triggerMaxWidth={210}
                value={modelSelect.modelValue}
                options={modelSelect.modelOptions}
                onChange={modelSelect.onModelPick}
              />
              {modelSelect.providerOptions.length > 0 ? (
                <NomiSelect
                  ariaLabel="供应商"
                  leadingLabel="供应商"
                  value={modelSelect.providerValue}
                  options={modelSelect.providerOptions}
                  onChange={modelSelect.onProviderPick}
                />
              ) : null}
            </div>
          )}

          {renderedControls.length > 0 ? (
            <div className={cn('flex flex-wrap items-center gap-2')}>
              {renderedControls.map((control) => renderControl(control))}
            </div>
          ) : null}

          <div className={cn('flex items-center justify-end gap-2 pt-1')}>
            <WorkbenchButton className={cn('h-8 min-h-8 px-3 cursor-pointer')} onClick={() => void applyAndMaybeRun(false)} disabled={selectedTargetNodes.length === 0}>
              应用参数
            </WorkbenchButton>
            <WorkbenchButton
              className={cn('h-8 min-h-8 px-3 cursor-pointer bg-nomi-ink text-nomi-paper border-nomi-ink hover:bg-nomi-ink hover:text-nomi-paper')}
              onClick={() => void applyAndMaybeRun(true)}
              disabled={runnableCount === 0 || modelOptions.length === 0}
            >
              <IconPlayerPlay size={14} stroke={1.7} aria-hidden />
              应用并生成
            </WorkbenchButton>
          </div>
        </div>
      </Popover.Dropdown>
    </Popover>
  )
}
