import { createRecipeCameraOutputs } from '../../../../electron/shared/canvas/sourceDefaults'
import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
import { Drawer } from '@mantine/core'
import type { JSX } from 'react'
import React from 'react'
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconPhoto,
  IconPlayerPlay,
  IconPlugConnected,
  IconRotate,
  IconSparkles,
} from '@tabler/icons-react'
import { NomiSelect, WorkbenchButton } from '../../../design'
import { recipeTaskCount } from '../../../config/capabilityRecipes'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'
import { isCapabilityRecipesEnabled } from '../../../config/featureFlags'
import { cn } from '../../../utils/cn'
import { toast } from '../../../ui/toast'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { listAvailableModelsForAgent } from '../agent/availableModels'
import {
  listCapabilityRecipesForAgent,
  type AgentCapabilityRecipe,
  type AgentRecipeCompatibleModel,
} from '../agent/capabilityRecipeAgent'
import { applyCanvasToolCall } from '../agent/applyCanvasToolCall'
import { describeGenerationCost, useSpendConfirmStore } from '../spend/spendConfirm'
import { useWorkbenchStore } from '../../workbenchStore'
import { capabilityRecipeInputReadiness, isCreativeResourceCandidate } from './capabilityRecipeReadiness'
import {
  capabilityRecipeConnectionGuidance,
  moodCoordinatesForMode,
  moodOutputCountForMode,
  moodRequestSummary,
  normalizeMoodGenerationMode,
} from './capabilityRecipeInspectorModel'
import {
  OPEN_CAPABILITY_RECIPE_EVENT,
  type OpenCapabilityRecipeEventDetail,
} from './capabilityRecipeEvents'
import { recordCanvasSkillOutput } from '../skills/canvasSkillModel'
import {
  CapabilityAutoVisionReviewControl,
  type CapabilityVisionReviewSelection,
} from './CapabilityAutoVisionReviewControl'
import {
  CapabilityCameraOutputsEditor,
  type CameraOutput,
} from './CapabilityCameraOutputsEditor'

type InspectorView = 'recipes' | 'resource'

const RESOURCE_KIND_OPTIONS = [
  { value: 'style', get label() { return i18n.t("canvasComponents.style") } },
  { value: 'effect', get label() { return i18n.t("canvasComponents.effect") } },
  { value: 'identity', get label() { return i18n.t("canvasComponents.identity") } },
  { value: 'palette', get label() { return i18n.t("canvasComponents.palette") } },
]
function targetValue(target: AgentRecipeCompatibleModel): string {
  return `${target.vendorKey}::${target.modelKey}::${target.variantId ?? ''}::${target.modeId}`
}

function controlDefaults(controls: readonly ModelParameterControl[]): Record<string, string | number | boolean> {
  return Object.fromEntries(
    controls
      .filter((control) => control.defaultValue !== undefined)
      .map((control) => [control.key, control.defaultValue]),
  ) as Record<string, string | number | boolean>
}

function mergeControls(...groups: ReadonlyArray<readonly ModelParameterControl[]>): ModelParameterControl[] {
  const byKey = new Map<string, ModelParameterControl>()
  for (const controls of groups) {
    for (const control of controls) byKey.set(control.key, control)
  }
  return Array.from(byKey.values())
}


function inputClass(): string {
  return 'h-8 min-w-0 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-caption text-nomi-ink outline-none focus:border-nomi-accent'
}

export function CapabilityRecipeInspector({
  selectedNodeId,
  triggerVariant = 'floating',
}: {
  selectedNodeId: string | null
  triggerVariant?: 'floating' | 'toolbar'
}): JSX.Element | null {
  useTranslation()
  const enabled = isCapabilityRecipesEnabled()
  const [open, setOpen] = React.useState(false)
  const [view, setView] = React.useState<InspectorView>('recipes')
  const [recipes, setRecipes] = React.useState<AgentCapabilityRecipe[]>([])
  const [loading, setLoading] = React.useState(false)
  const [catalogError, setCatalogError] = React.useState('')
  const [recipeId, setRecipeId] = React.useState('')
  const [modelValue, setModelValue] = React.useState('')
  const [params, setParams] = React.useState<Record<string, string | number | boolean>>({})
  const [outputCount, setOutputCount] = React.useState(2)
  const [cameraOutputs, setCameraOutputs] = React.useState<CameraOutput[]>(createRecipeCameraOutputs(2, []))
  const [resourceIds, setResourceIds] = React.useState<string[]>([])
  const [running, setRunning] = React.useState(false)
  const [resourceKind, setResourceKind] = React.useState('style')
  const [resourceLabel, setResourceLabel] = React.useState('')
  const [resourceDescription, setResourceDescription] = React.useState('')
  const [resourceTokens, setResourceTokens] = React.useState('')
  const [commercialUse, setCommercialUse] = React.useState('unknown')
  const [originSkillNodeId, setOriginSkillNodeId] = React.useState<string | null>(null)
  const [visionReview, setVisionReview] = React.useState<CapabilityVisionReviewSelection>({ enabled: false })
  const catalogRequestId = React.useRef(0)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const source = nodes.find((node) => node.id === selectedNodeId) ?? null
  const availableResources = nodes.filter((node) => Boolean(node.creativeResource))
  const selectedRecipe = recipes.find((recipe) => recipe.id === recipeId)
  const isMoodRecipe = selectedRecipe?.id === 'portrait.mood'
  const moodGenerationMode = normalizeMoodGenerationMode(params.generationMode)
  const moodOutputCount = moodOutputCountForMode(moodGenerationMode)
  const moodCoordinates = moodCoordinatesForMode(moodGenerationMode, params.energy, params.affinity)
  const selectedTarget = selectedRecipe?.compatibleModels.find((target) => targetValue(target) === modelValue)
  const isMultiviewRecipe = Boolean(
    selectedRecipe && ['image.multiview.grid9', 'image.multiview.custom'].includes(selectedRecipe.id),
  )
  const selectedVisionReviewModel = visionReview.model
  const controls = React.useMemo(
    () => mergeControls(selectedTarget?.params ?? [], selectedRecipe?.controls ?? []),
    [selectedRecipe?.controls, selectedTarget?.params],
  )
  const sourceId = source?.id
  const sourceTitle = source?.title

  React.useEffect(() => {
    if (!sourceId) setOpen(false)
    if (sourceId) setResourceLabel(`${sourceTitle} 资源`)
  }, [sourceId, sourceTitle])

  React.useEffect(() => {
    if (!enabled) return
    const handleOpenRequest = (event: Event) => {
      const detail = (event as CustomEvent<OpenCapabilityRecipeEventDetail>).detail
      const requestedNodeId = typeof detail?.nodeId === 'string' ? detail.nodeId.trim() : ''
      if (requestedNodeId) {
        const store = useGenerationCanvasStore.getState()
        if (!store.nodes.some((candidate) => candidate.id === requestedNodeId)) {
          toast(i18n.t("canvasComponents.theSourceNodeForCreativeCapabilitiesNoLongerExists"), 'warning')
          return
        }
        store.selectNode(requestedNodeId)
      }
      const requestedRecipeId = typeof detail?.recipeId === 'string' ? detail.recipeId.trim() : ''
      if (requestedRecipeId) setRecipeId(requestedRecipeId)
      setOriginSkillNodeId(typeof detail?.skillNodeId === 'string' ? detail.skillNodeId : null)
      setResourceIds(Array.isArray(detail?.resourceIds) ? detail.resourceIds.filter((id): id is string => typeof id === 'string') : [])
      setView('recipes')
      setOpen(true)
    }
    window.addEventListener(OPEN_CAPABILITY_RECIPE_EVENT, handleOpenRequest)
    return () => window.removeEventListener(OPEN_CAPABILITY_RECIPE_EVENT, handleOpenRequest)
  }, [enabled])
  const refreshRecipes = React.useCallback(async () => {
    const requestId = catalogRequestId.current + 1
    catalogRequestId.current = requestId
    setLoading(true)
    setCatalogError('')
    try {
      const models = await listAvailableModelsForAgent()
      if (requestId !== catalogRequestId.current) return
      const next = listCapabilityRecipesForAgent(models)
      setRecipes(next)
      const first = next.find((recipe) => recipe.compatibleModels.length > 0)
      setRecipeId((current) => (
        next.some((recipe) => recipe.id === current) ? current : (first?.id ?? next[0]?.id ?? '')
      ))
    } catch (error) {
      if (requestId === catalogRequestId.current) {
        setCatalogError(error instanceof Error ? error.message : i18n.t("canvasComponents.failedToLoadTheModelCatalog"))
      }
    } finally {
      if (requestId === catalogRequestId.current) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!open || !enabled) return
    void refreshRecipes()
  }, [enabled, open, refreshRecipes])

  React.useEffect(() => {
    if (!isMultiviewRecipe) setVisionReview({ enabled: false })
  }, [isMultiviewRecipe])

  React.useEffect(() => {
    if (!open || !enabled) return
    const handleCatalogChanged = () => void refreshRecipes()
    window.addEventListener('nomi-model-catalog-changed', handleCatalogChanged)
    return () => window.removeEventListener('nomi-model-catalog-changed', handleCatalogChanged)
  }, [enabled, open, refreshRecipes])

  React.useEffect(() => {
    if (!selectedRecipe) return
    const firstTarget = selectedRecipe.compatibleModels[0]
    if (!selectedRecipe.compatibleModels.some((target) => targetValue(target) === modelValue)) {
      setModelValue(firstTarget ? targetValue(firstTarget) : '')
    }
  }, [modelValue, selectedRecipe])

  React.useEffect(() => {
    setParams(controlDefaults(controls))
  }, [controls])

  React.useEffect(() => {
    const max = isMoodRecipe
      ? 25
      : Math.max(1, Math.min(6, selectedRecipe?.output.maxItems ?? 1, selectedTarget?.maxOutputs ?? 6))
    const nextCount =
      selectedRecipe?.id === 'image.multiview.grid9'
        ? Math.min(9, selectedRecipe.output.maxItems ?? 9)
        : isMoodRecipe
          ? moodOutputCount
        : Math.min(Math.max(1, outputCount), max)
    if (nextCount !== outputCount) setOutputCount(nextCount)
    if (selectedRecipe?.id === 'image.multiview.custom') {
      setCameraOutputs((current) => createRecipeCameraOutputs(nextCount, current))
    }
  }, [isMoodRecipe, moodOutputCount, outputCount, selectedRecipe, selectedTarget?.maxOutputs])
  const resourceCandidates = selectedRecipe
    ? availableResources.filter((node) => isCreativeResourceCandidate(selectedRecipe, node))
    : []
  const resourceCandidateIds = new Set(resourceCandidates.map((node) => node.id))
  const applicableResourceIds = resourceIds.filter((id) => resourceCandidateIds.has(id))
  const selectedResources = resourceCandidates.filter((node) => applicableResourceIds.includes(node.id))
  const inputReadiness = selectedRecipe
    ? capabilityRecipeInputReadiness(selectedRecipe, source, selectedResources)
    : { ready: false as const, message: i18n.t("canvasComponents.selectACapabilityRecipe") }
  const connectionGuidance = selectedRecipe && selectedRecipe.compatibleModels.length === 0
    ? capabilityRecipeConnectionGuidance(selectedRecipe.id)
    : null

  if (!enabled) return null
  const recipeOptions = recipes.map((recipe) => ({
    value: recipe.id,
    label: recipe.label,
    trailing: recipe.compatibleModels.length ? i18n.t("canvasComponents.modes", { v0: recipe.compatibleModels.length }) : i18n.t("canvasComponents.noCompatibleModels"),
    trailingTone: recipe.compatibleModels.some((model) => model.tier === 'native')
      ? ('accent' as const)
      : ('muted' as const),
  }))
  const modelOptions = (selectedRecipe?.compatibleModels ?? []).map((target) => ({
    value: targetValue(target),
    label: `${target.modelLabel} · ${target.modeLabel}`,
    trailing: target.tier === 'native' ? i18n.t("canvasComponents.native") : target.tier === 'experimental' ? i18n.t("canvasComponents.experimental") : i18n.t("canvasComponents.compatible"),
    trailingTone: target.tier === 'native' ? ('accent' as const) : ('muted' as const),
  }))
  const maxOutputs = isMoodRecipe
    ? 25
    : Math.max(1, Math.min(6, selectedRecipe?.output.maxItems ?? 1, selectedTarget?.maxOutputs ?? 6))
  const isCustomCamera = selectedRecipe?.id === 'image.multiview.custom'
  const isCollection = selectedRecipe?.output.kind === 'image_collection'
  const visibleControls = controls.filter(
    (control) => !(isMoodRecipe && moodGenerationMode !== 'single' && ['energy', 'affinity'].includes(control.key)),
  )
  const patchParam = (control: ModelParameterControl, raw: string | boolean) => {
    const value = control.type === 'number' ? Number(raw) : control.type === 'boolean' ? Boolean(raw) : String(raw)
    setParams((current) => ({ ...current, [control.key]: value }))
  }
  const startRecipe = async () => {
    if (!source || !selectedRecipe || !selectedTarget || running) return
    if (!inputReadiness.ready) {
      toast(inputReadiness.message, 'warning')
      return
    }
    if (visionReview.enabled && !selectedVisionReviewModel) {
      toast(i18n.t("canvasComponents.automaticVisualReviewRequiresAConnectedTextModelThatSupports"), 'warning')
      return
    }
    const count = selectedRecipe.id === 'image.multiview.grid9'
      ? 9
      : isMoodRecipe
        ? moodOutputCount
        : isCollection
          ? outputCount
          : 1
    const taskCount = recipeTaskCount(selectedRecipe, params, count)
    const generationCost = describeGenerationCost(
      taskCount,
      selectedRecipe.output.kind === 'video' ? 'video' : 'image',
    )
    const ok = await useSpendConfirmStore.getState().requestConfirm({
      title: i18n.t("canvasComponents.generate", { v0: selectedRecipe.label }),
      message: visionReview.enabled
        ? i18n.t("canvasComponents.oneAdditionalBatchVisualReviewWillRunAfterGeneration", { v0: generationCost })
        : generationCost,
      confirmLabel: i18n.t("canvasComponents.generateNewResults"),
      source: 'user',
      details: [
        { label: i18n.t("canvasComponents.sourceNode"), value: source.title },
        { label: i18n.t("canvasComponents.model"), value: `${selectedTarget.modelLabel} · ${selectedTarget.modeLabel}` },
        ...(taskCount !== count
          ? [{ label: i18n.t("canvasComponents.generationTasks"), value: i18n.t("canvasComponents.requestsSplitLocallyIntoResults", { v0: taskCount, v1: count }) }]
          : selectedRecipe.id === 'image.multiview.grid9'
            ? [{ label: i18n.t("canvasComponents.generationTasks"), value: i18n.t("canvasComponents.separateRequests", { v0: taskCount }) }]
          : isMoodRecipe
            ? [{ label: i18n.t("canvasComponents.generationTasks"), value: moodRequestSummary(moodGenerationMode) }]
            : []),
        ...(visionReview.enabled && selectedVisionReviewModel
          ? [{ label: i18n.t("canvasComponents.visualReview"), value: i18n.t("canvasComponents.onceForTheEntireBatch", { v0: selectedVisionReviewModel.label }) }]
          : []),
      ],
    })
    if (!ok) return
    setRunning(true)
    try {
      const outcome = (await applyCanvasToolCall('apply_capability_recipe', {
        sourceNodeId: source.id,
        recipeId: selectedRecipe.id,
        modelKey: selectedTarget.modelKey,
        ...(selectedTarget.variantId ? { variantId: selectedTarget.variantId } : {}),
        modeId: selectedTarget.modeId,
        params,
        requestedOutputs: count,
        resourceIds: applicableResourceIds,
        ...(isCustomCamera ? { outputs: cameraOutputs.slice(0, count) } : {}),
        ...(visionReview.enabled && selectedVisionReviewModel ? {
          visionReview: {
            vendorKey: selectedVisionReviewModel.vendorKey,
            modelKey: selectedVisionReviewModel.modelKey,
          },
        } : {}),
      })) as { targetNodeId?: string }
      if (outcome.targetNodeId && originSkillNodeId) {
        recordCanvasSkillOutput({
          skillNodeId: originSkillNodeId,
          outputNodeId: outcome.targetNodeId,
          recipeId: selectedRecipe.id,
          sourceNodeId: source.id,
        })
      }
      toast(outcome.targetNodeId ? i18n.t("canvasComponents.createdAResultNodeFor", { v0: selectedRecipe.label }) : i18n.t("canvasComponents.recipeTaskAccepted"), 'success')
      setOpen(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : i18n.t("canvasComponents.recipeExecutionFailed"), 'error')
    } finally {
      setRunning(false)
    }
  }
  const saveResource = async () => {
    if (!source) return
    try {
      const result = (await applyCanvasToolCall('save_creative_resource', {
        sourceNodeId: source.id,
        kind: resourceKind,
        label: resourceLabel,
        description: resourceDescription,
        promptTokens: resourceTokens
          .split(/[，,\n]/)
          .map((token) => token.trim())
          .filter(Boolean),
        license: { source: '用户自有素材', commercialUse },
      })) as { nodeId: string }
      useWorkbenchStore.getState().setActiveCategoryId('scene')
      useWorkbenchStore.getState().requestCanvasFit()
      toast(i18n.t("canvasComponents.savedCreativeResource", { v0: resourceLabel }), 'success')
      setOpen(false)
      useGenerationCanvasStore.getState().selectNode(result.nodeId)
    } catch (error) {
      toast(error instanceof Error ? error.message : i18n.t("canvasComponents.failedToSaveTheResource"), 'error')
    }
  }

  return (
    <>
      <button
        type="button"
        data-capability-recipe-trigger="true"
        className={cn(
          triggerVariant === 'toolbar'
            ? [
                'grid size-8 min-h-8 place-items-center rounded-nomi-sm border-0 bg-transparent p-0',
                'text-nomi-ink-60 cursor-pointer transition-colors hover:bg-nomi-ink-05 hover:text-nomi-accent',
                'disabled:cursor-not-allowed disabled:opacity-35 [&>svg]:size-[18px] [&>svg]:stroke-[1.8]',
              ]
            : [
                'absolute left-[320px] top-4 z-[18] inline-flex h-9 items-center gap-2 rounded-nomi-sm px-3',
                'border border-nomi-line bg-nomi-paper text-body-sm font-medium text-nomi-ink shadow-nomi-sm',
                'cursor-pointer hover:border-nomi-accent hover:text-nomi-accent disabled:cursor-not-allowed disabled:opacity-45',
              ],
        )}
        disabled={!source}
        title={source ? i18n.t("canvasComponents.creativeCapabilities") : i18n.t("canvasComponents.selectANodeFirst")}
        onClick={() => {
          setOriginSkillNodeId(null)
          setOpen(true)
        }}
      >
        <IconSparkles size={16} stroke={1.7} aria-hidden />
        <span className={triggerVariant === 'toolbar' ? 'sr-only' : undefined}>{i18n.t("canvasComponents.creativeCapabilities")}</span>
      </button>
      <Drawer
        opened={open}
        onClose={() => setOpen(false)}
        position="right"
        size={440}
        title={i18n.t("canvasComponents.creativeCapabilities")}
        overlayProps={{ backgroundOpacity: 0.12, blur: 0 }}
        styles={{ body: { padding: 0 }, header: { borderBottom: '1px solid var(--nomi-line)' } }}
      >
        <div data-capability-recipe-inspector="true" className="flex min-h-[calc(100vh-70px)] flex-col bg-nomi-paper">
          <div className="flex items-center gap-3 border-b border-nomi-line px-4 py-3">
            <span className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink-05 text-nomi-ink-60">
              <IconPhoto size={19} stroke={1.6} aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="truncate text-body-sm font-medium text-nomi-ink">{source?.title ?? i18n.t("canvasComponents.noNodeSelected")}</div>
              <div className="truncate text-caption text-nomi-ink-60">
                {source?.result ? i18n.t("canvasComponents.generatedResultAvailable") : i18n.t("canvasComponents.noGeneratedResultYet")}
              </div>
            </div>
          </div>

          <div className="mx-4 mt-3 grid h-8 grid-cols-2 rounded-nomi-sm bg-nomi-ink-05 p-0.5">
            {(
              [
                ['recipes', i18n.t("canvasComponents.capabilityRecipes")],
                ['resource', i18n.t("canvasComponents.saveResource")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={cn(
                  'rounded-nomi-sm border-0 text-caption cursor-pointer',
                  view === key
                    ? 'bg-nomi-paper font-medium text-nomi-ink shadow-nomi-sm'
                    : 'bg-transparent text-nomi-ink-60',
                )}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {view === 'recipes' ? (
            <div className="flex flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-nomi-line px-4 py-4">
                <NomiSelect
                  ariaLabel={i18n.t("canvasComponents.capabilityRecipes")}
                  leadingLabel={i18n.t("canvasComponents.recipe")}
                  value={recipeId}
                  options={recipeOptions}
                  placeholder={loading ? i18n.t("canvasComponents.loading") : i18n.t("canvasComponents.selectARecipe")}
                  disabled={loading || recipeOptions.length === 0}
                  triggerMaxWidth={180}
                  onChange={setRecipeId}
                />
                <NomiSelect
                  ariaLabel={i18n.t("canvasComponents.modelAndMode")}
                  leadingLabel={i18n.t("canvasComponents.model")}
                  value={modelValue}
                  options={modelOptions}
                  placeholder={i18n.t("canvasComponents.noCompatibleModels")}
                  disabled={modelOptions.length === 0}
                  triggerMaxWidth={210}
                  onChange={setModelValue}
                />
                {catalogError ? <div className="w-full text-caption text-workbench-danger">{catalogError}</div> : null}
              </div>

              {connectionGuidance ? (
                <div
                  data-capability-model-guidance={selectedRecipe?.id}
                  className="flex items-start gap-3 border-b border-nomi-line bg-nomi-ink-05 px-4 py-3"
                >
                  <IconPlugConnected className="mt-0.5 shrink-0 text-nomi-accent" size={17} stroke={1.7} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-body-sm font-medium text-nomi-ink">{connectionGuidance.title}</div>
                    <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-60">
                      {connectionGuidance.description}
                    </div>
                  </div>
                  <WorkbenchButton
                    aria-label={i18n.t("canvasComponents.connectModels", { v0: connectionGuidance.vendorLabel })}
                    onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))}
                  >
                    <IconPlugConnected size={14} stroke={1.7} aria-hidden />
                    {i18n.t("canvasComponents.connectModels51")}</WorkbenchButton>
                </div>
              ) : null}

              {selectedTarget && selectedTarget.tier !== 'native' ? (
                <div
                  data-capability-experimental-warning="true"
                  className="flex items-start gap-2 border-b border-nomi-line bg-nomi-ink-05 px-4 py-3"
                >
                  <IconAlertTriangle className="mt-0.5 shrink-0 text-workbench-warning-ink" size={16} stroke={1.7} aria-hidden />
                  <p className="text-caption leading-relaxed text-nomi-ink-60">{i18n.t("canvasComponents.thisModelDoesNotDeclareNativeSupportForThisCapability")}</p>
                </div>
              ) : null}

              {visibleControls.length ? (
                <div className="grid grid-cols-2 gap-3 border-b border-nomi-line px-4 py-4">
                  {visibleControls.map((control) => (
                    <label key={control.key} className="flex min-w-0 flex-col gap-1.5 text-caption text-nomi-ink-60">
                      <span>{control.label}</span>
                      {control.type === 'boolean' ? (
                        <span className="inline-flex h-8 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={params[control.key] === true}
                            onChange={(event) => patchParam(control, event.target.checked)}
                          />
                          <span>{params[control.key] === true ? i18n.t("canvasComponents.on") : i18n.t("canvasComponents.off")}</span>
                        </span>
                      ) : control.options.length ? (
                        <NomiSelect
                          ariaLabel={control.label}
                          value={String(params[control.key] ?? control.defaultValue ?? '')}
                          options={control.options.map((option) => ({
                            value: String(option.value),
                            label: option.label,
                          }))}
                          onChange={(value) => patchParam(control, value)}
                        />
                      ) : control.type === 'number' ? (
                        <div className="flex h-8 items-center gap-2">
                          <input
                            className="min-w-0 flex-1 accent-[var(--nomi-accent)]"
                            type="range"
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            value={Number(params[control.key] ?? control.defaultValue ?? 0)}
                            onChange={(event) => patchParam(control, event.target.value)}
                          />
                          <input
                            className={cn(inputClass(), 'w-[64px]')}
                            type="number"
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            value={Number(params[control.key] ?? control.defaultValue ?? 0)}
                            onChange={(event) => patchParam(control, event.target.value)}
                          />
                        </div>
                      ) : (
                        <input
                          className={inputClass()}
                          value={String(params[control.key] ?? control.defaultValue ?? '')}
                          onChange={(event) => patchParam(control, event.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              ) : null}

              {isCollection ? (
                <div className="border-b border-nomi-line px-4 py-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-2 text-body-sm font-medium text-nomi-ink [overflow-wrap:anywhere]">
                      <IconRotate size={16} stroke={1.7} className="shrink-0" aria-hidden />
                      {isMoodRecipe ? i18n.t("canvasComponents.outputEmotions") : i18n.t("canvasComponents.outputCameraAngles")}
                    </span>
                    <input
                      className={cn(inputClass(), 'w-[72px] shrink-0')}
                      aria-label={i18n.t("canvasComponents.outputCount")}
                      type="number"
                      min={1}
                      max={selectedRecipe?.id === 'image.multiview.grid9' ? 9 : isMoodRecipe ? 25 : maxOutputs}
                      disabled={selectedRecipe?.id === 'image.multiview.grid9' || isMoodRecipe}
                      value={selectedRecipe?.id === 'image.multiview.grid9' ? 9 : isMoodRecipe ? moodOutputCount : outputCount}
                      onChange={(event) =>
                        setOutputCount(Math.max(1, Math.min(maxOutputs, Number(event.target.value) || 1)))
                      }
                    />
                  </div>
                  {isMoodRecipe ? (
                    <div className="mt-3 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 p-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption [overflow-wrap:anywhere]">
                        <span className="text-nomi-ink-60">{i18n.t("canvasComponents.rowsEnergyColumnsAffinity")}</span>
                        <span
                          data-mood-request-summary="true"
                          className="min-w-0 max-w-full font-medium text-nomi-ink"
                        >
                          {moodRequestSummary(moodGenerationMode)}
                        </span>
                      </div>
                      <div
                        data-mood-coordinate-map={moodGenerationMode}
                        className="mt-2 grid grid-cols-[22px_repeat(5,minmax(0,1fr))] gap-1"
                      >
                        <span aria-hidden />
                        {Array.from({ length: 5 }, (_, affinity) => (
                          <span
                            key={`affinity-${affinity}`}
                            className="grid h-5 place-items-center text-micro tabular-nums text-nomi-ink-40"
                          >
                            {affinity}
                          </span>
                        ))}
                        {Array.from({ length: 5 }, (_, energy) => (
                          <React.Fragment key={`energy-${energy}`}>
                            <span className="grid h-7 place-items-center text-micro tabular-nums text-nomi-ink-40">
                              {energy}
                            </span>
                            {Array.from({ length: 5 }, (_, affinity) => {
                              const selected = moodCoordinates.some(
                                (coordinate) => coordinate.energy === energy && coordinate.affinity === affinity,
                              )
                              return (
                                <button
                                  key={`mood-${energy}-${affinity}`}
                                  type="button"
                                  data-mood-coordinate={`${energy}-${affinity}`}
                                  aria-label={i18n.t("canvasComponents.energyAffinity", { v0: energy, v1: affinity })}
                                  aria-pressed={selected}
                                  disabled={moodGenerationMode !== 'single'}
                                  className={cn(
                                    'grid h-7 min-w-0 place-items-center rounded-nomi-sm border text-micro tabular-nums',
                                    selected
                                      ? 'border-nomi-accent bg-nomi-accent-soft font-medium text-nomi-accent'
                                      : 'border-nomi-line bg-nomi-paper text-nomi-ink-40',
                                    moodGenerationMode === 'single' && 'cursor-pointer hover:border-nomi-accent',
                                  )}
                                  onClick={() => {
                                    if (moodGenerationMode !== 'single') return
                                    setParams((current) => ({ ...current, energy, affinity }))
                                  }}
                                >
                                  {selected ? '●' : '·'}
                                </button>
                              )
                            })}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {isCustomCamera ? (
                    <CapabilityCameraOutputsEditor
                      outputs={cameraOutputs}
                      count={outputCount}
                      onChange={(index, patch) => setCameraOutputs((current) => (
                        current.map((item, position) => position === index ? { ...item, ...patch } : item)
                      ))}
                    />
                  ) : null}
                </div>
              ) : null}

              {isMultiviewRecipe ? (
                <CapabilityAutoVisionReviewControl onChange={setVisionReview} />
              ) : null}

              {resourceCandidates.length ? (
                <div className="border-b border-nomi-line px-4 py-4">
                  <div className="mb-2 text-body-sm font-medium text-nomi-ink">{i18n.t("canvasComponents.creativeResources")}</div>
                  <div className="flex flex-wrap gap-2">
                    {resourceCandidates.map((node) => {
                      const checked = resourceIds.includes(node.id)
                      return (
                        <label
                          key={node.id}
                          className={cn(
                            'inline-flex h-8 items-center gap-2 rounded-nomi-sm border px-2 text-caption',
                            checked
                              ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent'
                              : 'border-nomi-line text-nomi-ink-60',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setResourceIds((current) =>
                                checked ? current.filter((id) => id !== node.id) : [...current, node.id],
                              )
                            }
                          />
                          {node.creativeResource?.label}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {!inputReadiness.ready && selectedRecipe ? (
                <div
                  data-capability-input-warning="true"
                  className="border-b border-nomi-line px-4 py-3 text-caption text-workbench-warning-ink"
                >
                  {inputReadiness.message}
                </div>
              ) : null}

              <div className="mt-auto flex items-center justify-end gap-2 px-4 py-4">
                <WorkbenchButton onClick={() => setOpen(false)}>{i18n.t("canvasComponents.cancel")}</WorkbenchButton>
                <WorkbenchButton
                  className="bg-nomi-ink text-nomi-paper border-nomi-ink hover:bg-nomi-ink hover:text-nomi-paper"
                  disabled={!source || !selectedRecipe || !selectedTarget || !inputReadiness.ready || running}
                  onClick={() => void startRecipe()}
                >
                  <IconPlayerPlay size={15} stroke={1.7} aria-hidden />
                  {running ? i18n.t("canvasComponents.submitting") : i18n.t("canvasComponents.generateNewResults")}
                </WorkbenchButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col px-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-caption text-nomi-ink-60">
                  <span>{i18n.t("canvasComponents.resourceType")}</span>
                  <NomiSelect
                    ariaLabel={i18n.t("canvasComponents.resourceType")}
                    value={resourceKind}
                    options={RESOURCE_KIND_OPTIONS}
                    onChange={setResourceKind}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-caption text-nomi-ink-60">
                  <span>{i18n.t("canvasComponents.commercialLicense")}</span>
                  <NomiSelect
                    ariaLabel={i18n.t("canvasComponents.commercialLicense")}
                    value={commercialUse}
                    options={[
                      { value: 'allowed', label: i18n.t("canvasComponents.allowed") },
                      { value: 'restricted', label: i18n.t("canvasComponents.restricted") },
                      { value: 'unknown', label: i18n.t("canvasComponents.toBeConfirmed") },
                    ]}
                    onChange={setCommercialUse}
                  />
                </label>
              </div>
              <label className="mt-4 flex flex-col gap-1.5 text-caption text-nomi-ink-60">
                <span>{i18n.t("canvasComponents.name")}</span>
                <input
                  className={inputClass()}
                  value={resourceLabel}
                  onChange={(event) => setResourceLabel(event.target.value)}
                />
              </label>
              <label className="mt-4 flex flex-col gap-1.5 text-caption text-nomi-ink-60">
                <span>{i18n.t("canvasComponents.description")}</span>
                <textarea
                  className={cn(inputClass(), 'h-20 resize-none py-2')}
                  value={resourceDescription}
                  onChange={(event) => setResourceDescription(event.target.value)}
                />
              </label>
              <label className="mt-4 flex flex-col gap-1.5 text-caption text-nomi-ink-60">
                <span>{i18n.t("canvasComponents.promptTags")}</span>
                <textarea
                  className={cn(inputClass(), 'h-24 resize-none py-2')}
                  value={resourceTokens}
                  onChange={(event) => setResourceTokens(event.target.value)}
                />
              </label>
              <div className="mt-auto flex justify-end gap-2 pt-4">
                <WorkbenchButton onClick={() => setOpen(false)}>{i18n.t("canvasComponents.cancel")}</WorkbenchButton>
                <WorkbenchButton
                  className="bg-nomi-ink text-nomi-paper border-nomi-ink hover:bg-nomi-ink hover:text-nomi-paper"
                  disabled={!source?.result?.url || !resourceLabel.trim()}
                  onClick={() => void saveResource()}
                >
                  <IconDeviceFloppy size={15} stroke={1.7} aria-hidden />
                  {i18n.t("canvasComponents.saveResource")}</WorkbenchButton>
              </div>
            </div>
          )}
        </div>
      </Drawer>
    </>
  )
}

export default CapabilityRecipeInspector
