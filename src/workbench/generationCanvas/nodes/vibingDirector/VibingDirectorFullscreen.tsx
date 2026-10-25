import { NODE_SCROLL_REGION_CLASS_NAME } from '../nodeScrollRegionClassName'
import { useTranslation } from 'react-i18next'
import i18n from '../../../../i18n'
import type { JSX } from 'react'
import React from 'react'
import { createPortal } from 'react-dom'
import {
  IconAlertTriangle,
  IconBrandBlender,
  IconCircleCheck,
  IconCube,
  IconLayoutGrid,
  IconMovie,
  IconPhoto,
  IconRefresh,
  IconX,
} from '@tabler/icons-react'
import type { VibingDirectorCatalogAsset } from '../../../../desktop/vibingDirectorBridgeTypes'
import { NomiLoadingMark, WorkbenchIconButton } from '../../../../design'
import { toast } from '../../../../ui/toast'
import { cn } from '../../../../utils/cn'
import Model3DViewer from '../model3d/Model3DViewer'
import VibingDirectorAssetLibrary from './VibingDirectorAssetLibrary'
import VibingDirectorAssistantPanel from './VibingDirectorAssistantPanel'
import {
  createCoffeeConversationLayoutPlan,
  normalizeVibingDirectorState,
  type BlenderDirectorAsset,
  type BlenderDirectorAssetSource,
  type VibingDirectorPlan,
  type VibingDirectorPlanResult,
  type VibingDirectorState,
} from './vibingDirectorState'
import { summarizeVibingDirectorSpatialReport } from './vibingDirectorPresentation'

type VibingDirectorFullscreenProps = {
  directorNodeId: string
  nodeTitle: string
  initialState: VibingDirectorState
  readOnly?: boolean
  onClose: () => void
  onStateChange: (state: VibingDirectorState) => void
  onApplyPlan: (state: VibingDirectorState, plan: VibingDirectorPlan) => Promise<VibingDirectorPlanResult>
  onImportAsset: (source: BlenderDirectorAssetSource, license?: string) => Promise<BlenderDirectorAsset | null>
  onListCatalogAssets: (query: string) => Promise<VibingDirectorCatalogAsset[]>
  onImportCatalogAsset: (catalogAssetId: string) => Promise<BlenderDirectorAsset>
  onOpenBlender: (state: VibingDirectorState) => void
  onCancelBlender?: () => void
  onOpenAssetSource: (source: Exclude<BlenderDirectorAssetSource, 'local'>) => void
}

function stateSummary(state: VibingDirectorState): string {
  if (state.output?.blenderVersion) return `Blender ${state.output.blenderVersion}`
  if (state.output) return i18n.t("canvasComponents.blenderPreviewReceived")
  return i18n.t("canvasComponents.waitingForTheFirstBlenderPlan")
}

function ArtifactPreview({ state }: { state: VibingDirectorState }): JSX.Element {
  useTranslation()
  const output = state.output
  const hasSceneModel = Boolean(output?.modelUrl)
  const spatial = summarizeVibingDirectorSpatialReport(output?.spatialReport)
  const [mode, setMode] = React.useState<'scene' | 'render'>(() => hasSceneModel ? 'scene' : 'render')
  const [sceneViewKey, setSceneViewKey] = React.useState(0)

  React.useEffect(() => {
    setMode(hasSceneModel ? 'scene' : 'render')
    setSceneViewKey((value) => value + 1)
  }, [hasSceneModel, output?.jobId])

  if (output?.previewUrl) {
    return (
      <div className="relative h-full w-full">
        {mode === 'scene' && output.modelUrl ? (
          <Model3DViewer
            key={`${output.modelUrl}:${sceneViewKey}`}
            url={output.modelUrl}
            autoRotate={false}
            enablePan
          />
        ) : (
          <img
            className="h-full w-full object-contain"
            src={output.previewUrl}
            alt={i18n.t("canvasComponents.blenderCameraRenderPreview")}
            draggable={false}
          />
        )}
        {hasSceneModel ? (
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-nomi-sm border border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] p-1 shadow-nomi-sm">
            <WorkbenchIconButton
              label={i18n.t("canvasComponents.inspectTheBlenderScene")}
              icon={<IconCube size={16} />}
              aria-pressed={mode === 'scene'}
              className={cn(mode === 'scene' && 'bg-[var(--workbench-hover)] text-[var(--workbench-ink)]')}
              onClick={() => setMode('scene')}
            />
            <WorkbenchIconButton
              label={i18n.t("canvasComponents.viewTheBlenderCameraRender")}
              icon={<IconPhoto size={16} />}
              aria-pressed={mode === 'render'}
              className={cn(mode === 'render' && 'bg-[var(--workbench-hover)] text-[var(--workbench-ink)]')}
              onClick={() => setMode('render')}
            />
            {mode === 'scene' ? (
              <WorkbenchIconButton
                label={i18n.t("canvasComponents.resetSceneView")}
                icon={<IconRefresh size={16} />}
                onClick={() => setSceneViewKey((value) => value + 1)}
              />
            ) : null}
          </div>
        ) : null}
        {spatial.status !== 'idle' ? (
          <div
            className={cn(
              'absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-nomi-sm border px-2 py-1 text-micro shadow-nomi-sm',
              spatial.status === 'passed'
                ? 'border-workbench-success/30 bg-workbench-success-soft text-workbench-success'
                : spatial.status === 'warning'
                  ? 'border-[var(--tc-color-warning)] bg-[var(--workbench-surface-solid)] text-[var(--tc-color-warning)]'
                  : 'border-workbench-danger/30 bg-workbench-danger-soft text-workbench-danger',
            )}
          >
            {spatial.status === 'passed'
              ? <IconCircleCheck size={14} />
              : <IconAlertTriangle size={14} />}
            {spatial.label}
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 text-[var(--workbench-muted)]">
      <IconBrandBlender size={52} stroke={1.25} />
      <span className="text-caption">{i18n.t("canvasComponents.waitingForABlenderPreview")}</span>
    </div>
  )
}

export default function VibingDirectorFullscreen({
  directorNodeId,
  nodeTitle,
  initialState,
  readOnly = false,
  onClose,
  onStateChange,
  onApplyPlan,
  onImportAsset,
  onListCatalogAssets,
  onImportCatalogAsset,
  onOpenBlender,
  onCancelBlender,
  onOpenAssetSource,
}: VibingDirectorFullscreenProps): JSX.Element | null {
  useTranslation()
  const [state, setState] = React.useState(() => normalizeVibingDirectorState(initialState))
  const [planApplying, setPlanApplying] = React.useState(false)
  const stateRef = React.useRef(state)

  const commit = React.useCallback((next: VibingDirectorState) => {
    const normalized = normalizeVibingDirectorState(next)
    stateRef.current = normalized
    setState(normalized)
    onStateChange(normalized)
  }, [onStateChange])

  React.useEffect(() => {
    const normalized = normalizeVibingDirectorState(initialState)
    stateRef.current = normalized
    setState(normalized)
  }, [initialState])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const applyPlan = React.useCallback(async (plan: VibingDirectorPlan): Promise<VibingDirectorPlanResult> => {
    setPlanApplying(true)
    try {
      const result = await onApplyPlan(stateRef.current, plan)
      commit(result.state)
      return result
    } finally {
      setPlanApplying(false)
    }
  }, [commit, onApplyPlan])

  const addImportedAsset = React.useCallback((asset: BlenderDirectorAsset) => {
    if (stateRef.current.assets.some((candidate) => candidate.id === asset.id)) return
    commit({
      ...stateRef.current,
      assets: [...stateRef.current.assets, asset],
      updatedAt: Date.now(),
    })
  }, [commit])

  const rebuildCoffeeConversation = React.useCallback(() => {
    if (readOnly || planApplying) return
    void applyPlan(createCoffeeConversationLayoutPlan(stateRef.current))
      .then(() => toast(i18n.t("canvasComponents.rebuiltBlenderBlockingForATwoPersonConversation"), 'success'))
      .catch((error: unknown) => toast(error instanceof Error ? error.message : i18n.t("canvasComponents.failedToRebuildBlenderBlocking"), 'error'))
  }, [applyPlan, planApplying, readOnly])

  const canRebuildCoffeeConversation = state.stagePreset === 'coffee_shop' || /咖啡|coffee/i.test(state.brief)
  const spatial = summarizeVibingDirectorSpatialReport(state.output?.spatialReport)

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="workbench-shell fixed inset-0 isolate flex h-[100dvh] w-screen flex-col overflow-hidden bg-[var(--workbench-bg)] text-[var(--workbench-ink)] font-[var(--nomi-font-sans)]"
      style={{ zIndex: 9999 }}
      role="dialog"
      aria-modal="true"
      aria-label={i18n.t("canvasComponents.blenderDirectorWorkspace", { v0: nodeTitle })}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="relative z-[2] flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] px-4 shadow-nomi-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IconBrandBlender size={18} className="shrink-0 text-[var(--workbench-muted)]" />
          <div className="min-w-0">
            <div className="truncate text-body-sm font-medium">{nodeTitle}</div>
            <div className="truncate text-micro text-[var(--workbench-muted)]">{stateSummary(state)}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!readOnly && canRebuildCoffeeConversation ? (
            <WorkbenchIconButton
              label={i18n.t("canvasComponents.rebuildBlockingForTwoPeopleAtACoffeeTable")}
              icon={<IconLayoutGrid size={17} />}
              disabled={planApplying}
              onClick={rebuildCoffeeConversation}
            />
          ) : null}
          {state.output ? (
            <WorkbenchIconButton
              label={i18n.t("canvasComponents.openTheCurrentProjectInBlender")}
              icon={<IconBrandBlender size={17} />}
              onClick={() => onOpenBlender(stateRef.current)}
            />
          ) : null}
          <WorkbenchIconButton label={i18n.t("canvasComponents.closeDirector")} icon={<IconX size={17} />} onClick={onClose} />
        </div>
      </header>

      <main className={`${NODE_SCROLL_REGION_CLASS_NAME} grid min-h-0 flex-1 grid-cols-1 overflow-auto xl:grid-cols-[minmax(280px,0.76fr)_minmax(0,1.5fr)_minmax(280px,0.76fr)] xl:overflow-hidden`}>
        <aside className="min-h-[360px] border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] xl:min-h-0 xl:border-b-0 xl:border-r">
          <VibingDirectorAssistantPanel
            directorNodeId={directorNodeId}
            state={state}
            applying={planApplying}
            onApplyPlan={applyPlan}
            onCancelBlender={onCancelBlender}
          />
        </aside>

        <section className="flex min-h-[560px] min-w-0 flex-col bg-[var(--workbench-bg)] xl:min-h-0">
          <div className="min-h-0 flex-1 p-4">
            <div className="relative h-full min-h-[360px] overflow-hidden border border-[var(--workbench-border)] bg-[var(--nomi-ink-05)]">
              <ArtifactPreview state={state} />
              {planApplying ? (
                <div className="absolute inset-0 grid place-items-center bg-[var(--nomi-ink)]/45 text-[var(--nomi-paper)]">
                  <div className="flex items-center gap-2 text-caption"><NomiLoadingMark size={17} />{i18n.t("canvasComponents.blenderIsExecutingTheDirectorPlan")}</div>
                </div>
              ) : null}
            </div>
          </div>

          <section className="shrink-0 border-t border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)]">
            <div className="grid grid-cols-2 divide-x divide-y divide-[var(--workbench-border)] md:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
              <div className="px-4 py-3"><div className="text-micro text-[var(--workbench-muted)]">{i18n.t("canvasComponents.scene")}</div><div className="mt-1 truncate text-caption font-medium">{state.stagePreset}</div></div>
              <div className="px-4 py-3"><div className="text-micro text-[var(--workbench-muted)]">{i18n.t("canvasComponents.assets")}</div><div className="mt-1 text-caption font-medium">{state.assets.length}</div></div>
              <div className="px-4 py-3"><div className="text-micro text-[var(--workbench-muted)]">{i18n.t("canvasComponents.stagedObjects")}</div><div className="mt-1 text-caption font-medium">{state.objects.length}</div></div>
              <div className="px-4 py-3"><div className="text-micro text-[var(--workbench-muted)]">{i18n.t("canvasComponents.spatialRelationships")}</div><div className="mt-1 text-caption font-medium">{state.relations.length}</div></div>
              <div className="px-4 py-3"><div className="text-micro text-[var(--workbench-muted)]">{i18n.t("canvasComponents.shotBeats")}</div><div className="mt-1 text-caption font-medium">{state.beats.length}</div></div>
              <div className="px-4 py-3">
                <div className="text-micro text-[var(--workbench-muted)]">{i18n.t("canvasComponents.spatialQuality")}</div>
                <div className={cn(
                  'mt-1 truncate text-caption font-medium',
                  spatial.status === 'failed' && 'text-workbench-danger',
                  spatial.status === 'warning' && 'text-[var(--tc-color-warning)]',
                  spatial.status === 'passed' && 'text-workbench-success',
                )}>
                  {spatial.label}
                </div>
              </div>
            </div>
            {spatial.issues.length ? (
              <div className="border-t border-[var(--workbench-border)] px-4 py-2">
                <div className={cn(
                  'flex items-start gap-2 text-micro leading-5',
                  spatial.status === 'warning' ? 'text-[var(--tc-color-warning)]' : 'text-workbench-danger',
                )}>
                  <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{spatial.issues.join('；')}</span>
                </div>
              </div>
            ) : null}
          </section>

          <section className="shrink-0 border-t border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)]">
            <div className="flex items-center gap-2 px-4 py-2.5"><IconMovie size={15} className="text-[var(--workbench-muted)]" /><span className="text-caption font-medium">{i18n.t("canvasComponents.shotBeats")}</span></div>
            <div className={`${NODE_SCROLL_REGION_CLASS_NAME} max-h-48 overflow-y-auto border-t border-[var(--workbench-border)]`}>
              {state.beats.length ? state.beats.map((beat, index) => (
                <div key={beat.id} className="grid grid-cols-[32px_minmax(0,1fr)_72px] items-center gap-2 border-b border-[var(--workbench-border)] px-4 py-2.5 last:border-b-0">
                  <span className="text-micro text-[var(--workbench-muted)]">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0"><div className="truncate text-caption font-medium">{beat.title}</div><div className="truncate text-micro text-[var(--workbench-muted)]">{beat.action || beat.cameraNote || i18n.t("canvasComponents.performanceAndCameraDetailsNeeded")}</div></div>
                  <span className="text-right text-micro text-[var(--workbench-muted)]">{beat.durationSec}{i18n.t('canvasComponents.secondsSuffix')}</span>
                </div>
              )) : <div className="px-4 py-5 text-caption text-[var(--workbench-muted)]">{i18n.t("canvasComponents.directorAgentWillWriteShotBeatsHereAlongWithThe")}</div>}
            </div>
          </section>
        </section>

        <VibingDirectorAssetLibrary
          assets={state.assets}
          readOnly={readOnly}
          onImportAsset={onImportAsset}
          onListCatalogAssets={onListCatalogAssets}
          onImportCatalogAsset={onImportCatalogAsset}
          onAssetImported={addImportedAsset}
          onOpenAssetSource={onOpenAssetSource}
        />
      </main>
    </div>,
    document.body,
  )
}
