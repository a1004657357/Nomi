import { directorProtocolSource } from '../../../../electron/shared/blenderDirectorProtocolText'
import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
import type { JSX } from 'react'
import React from 'react'
import { IconBrandBlender, IconMaximize } from '@tabler/icons-react'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { VibingDirectorCatalogAsset } from '../../../desktop/vibingDirectorBridgeTypes'
import { lazyWithChunkBoundary } from '../../../ui/chunkBoundary'
import { toast } from '../../../ui/toast'
import { cn } from '../../../utils/cn'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { isProjectExecutionContextCurrent, withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  applyVibingDirectorPlan,
  materializeVibingDirectorPlan,
  normalizeVibingDirectorState,
  type BlenderDirectorAsset,
  type BlenderDirectorAssetSource,
  type BlenderDirectorOutput,
  type VibingDirectorPlan,
  type VibingDirectorPlanResult,
  type VibingDirectorState,
} from './vibingDirector/vibingDirectorState'
import { formatVibingDirectorNodeStats } from './vibingDirector/vibingDirectorPresentation'

const VibingDirectorFullscreen = lazyWithChunkBoundary(
  'VIBING Director',
  () => import('./vibingDirector/VibingDirectorFullscreen'),
)

type VibingDirectorEditorProps = {
  node: GenerationCanvasNode
  width: number
  height: number
  readOnly?: boolean
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Explicitly reads its own Blender-return document only; old scene3d metadata is ignored. */
export function readVibingDirectorState(node: GenerationCanvasNode): VibingDirectorState {
  const current = normalizeVibingDirectorState(node.meta?.vibingDirectorState)
  const selectedResult = node.result
  const raw = record(selectedResult?.raw)
  if (raw.source !== 'vibing-director') return current

  const snapshot = record(raw.directorState)
  if (snapshot.version === 2 && snapshot.backend === 'blender') {
    return normalizeVibingDirectorState(snapshot)
  }

  const previewUrl = stringValue(selectedResult?.url)
  const blendUrl = stringValue(raw.blendUrl)
  const modelUrl = stringValue(raw.modelUrl)
  const blendRelativePath = stringValue(raw.blendRelativePath)
  if (!previewUrl || !blendUrl || !modelUrl || !blendRelativePath) return current
  return {
    ...current,
    output: {
      jobId: stringValue(raw.jobId) || selectedResult?.id || `director-history-${selectedResult?.createdAt || Date.now()}`,
      previewUrl,
      blendUrl,
      modelUrl,
      blendRelativePath,
      ...(stringValue(raw.blenderVersion) ? { blenderVersion: stringValue(raw.blenderVersion) } : {}),
      createdAt: selectedResult?.createdAt || Date.now(),
    },
  }
}

export function createVibingDirectorPreviewResult(
  nodeId: string,
  state: VibingDirectorState & { output: BlenderDirectorOutput },
): GenerationNodeResult {
  const output = state.output
  return {
    id: `vibing-director-${nodeId}-${output.jobId}`,
    type: 'image',
    url: output.previewUrl,
    ...(output.previewAssetId ? { assetId: output.previewAssetId } : {}),
    taskKind: 'model3d',
    raw: {
      source: 'vibing-director',
      jobId: output.jobId,
      blendUrl: output.blendUrl,
      modelUrl: output.modelUrl,
      blendRelativePath: output.blendRelativePath,
      blenderVersion: output.blenderVersion,
      directorState: state,
    },
    createdAt: output.createdAt,
  }
}

function VibingDirectorEditor({ node, readOnly = false }: VibingDirectorEditorProps): JSX.Element {
  useTranslation()
  const [fullscreen, setFullscreen] = React.useState(false)
  const [blenderJobId, setBlenderJobId] = React.useState<string | null>(null)
  const blenderJobIdRef = React.useRef<string | null>(null)
  const editorProjectRef = React.useRef<ProjectExecutionContext | null>(null)
  const updateNode = useGenerationCanvasStore((store) => store.updateNode)
  const state = React.useMemo(() => readVibingDirectorState(node), [node])
  const thumbnailUrl = state.output?.previewUrl ?? node.result?.url

  React.useEffect(() => () => {
    const jobId = blenderJobIdRef.current
    if (jobId) void getDesktopBridge()?.vibingDirector.cancelBlenderPlan(jobId).catch(() => {})
  }, [])

  const persistDirectorState = React.useCallback((nextState: VibingDirectorState, project: ProjectExecutionContext) => {
    project.assertCurrent()
    const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
    const previous = normalizeVibingDirectorState(current?.meta?.vibingDirectorState)
    const patch: Partial<GenerationCanvasNode> = {
      meta: {
        ...(current?.meta || {}),
        vibingDirectorState: nextState,
      },
    }
    if (nextState.output && nextState.output.jobId !== previous.output?.jobId) {
      const result = createVibingDirectorPreviewResult(
        node.id,
        nextState as VibingDirectorState & { output: BlenderDirectorOutput },
      )
      patch.result = result
      patch.history = [result, ...(current?.history || []).filter((item) => item.id !== result.id)].slice(0, 20)
      patch.status = 'success'
      patch.error = undefined
      patch.progress = undefined
    }
    updateNode(node.id, patch)
  }, [node.id, updateNode])

  const applyPlan = React.useCallback((
    directorState: VibingDirectorState,
    plan: VibingDirectorPlan,
  ): Promise<VibingDirectorPlanResult> => withProjectAction(async project => {
    if (!editorProjectRef.current) throw new Error('project_identity_unavailable')
    editorProjectRef.current.assertCurrent()
    project.assertCurrent()
    const desktop = getDesktopBridge()
    if (!desktop?.vibingDirector) throw new Error(i18n.t("canvasComponents.thisEnvironmentDoesNotSupportBlenderDirector"))
    const projectId = project.binding.projectId
    if (blenderJobIdRef.current) throw new Error(i18n.t("canvasComponents.blenderDirectorIsExecutingAnotherPlan"))

    const executablePlan = materializeVibingDirectorPlan(plan)
    const preflight = applyVibingDirectorPlan(directorState, executablePlan)
    if (preflight.rejected.length) throw new Error(preflight.rejected.join('；'))

    const jobId = `director-${crypto.randomUUID()}`
    blenderJobIdRef.current = jobId
    setBlenderJobId(jobId)
    updateNode(node.id, {
      status: 'running',
      error: undefined,
      progress: { phase: 'blender', message: directorProtocolSource.running(), updatedAt: Date.now() },
    })
    try {
      const payload = {
        jobId,
        projectId,
        projectBinding: project.binding,
        directorNodeId: node.id,
        plan: executablePlan,
        assets: directorState.assets.map((asset) => ({ id: asset.id, fileName: asset.fileName })),
        ...(executablePlan.mode === 'amend' && directorState.output?.blendRelativePath
          ? { existingBlendRelativePath: directorState.output.blendRelativePath }
          : {}),
      }
      const result = await desktop.vibingDirector.applyBlenderPlan(payload)
      project.assertCurrent()
      const output: BlenderDirectorOutput = {
        jobId: result.jobId,
        previewUrl: result.preview.url,
        ...(result.preview.assetId ? { previewAssetId: result.preview.assetId } : {}),
        blendUrl: result.blend.url,
        ...(result.blend.assetId ? { blendAssetId: result.blend.assetId } : {}),
        modelUrl: result.model.url,
        ...(result.model.assetId ? { modelAssetId: result.model.assetId } : {}),
        blendRelativePath: result.blendRelativePath,
        ...(result.blenderVersion ? { blenderVersion: result.blenderVersion } : {}),
        ...(result.previewCamera ? { previewCamera: result.previewCamera } : {}),
        ...(result.spatialReport ? { spatialReport: result.spatialReport } : {}),
        ...(result.objectTransforms ? { objectTransforms: result.objectTransforms } : {}),
        createdAt: Date.now(),
      }
      const applied = applyVibingDirectorPlan(directorState, executablePlan, output)
      if (applied.rejected.length) throw new Error(applied.rejected.join('；'))
      persistDirectorState(applied.state, project)
      await persistActiveWorkbenchProjectNow()
      project.assertCurrent()
      toast(i18n.t("canvasComponents.blenderDirectorPreviewReturnedToTheCurrentNode"), 'success')
      return applied
    } catch (error: unknown) {
      if (!isProjectExecutionContextCurrent(project)) throw error
      const message = error instanceof Error ? error.message : String(error)
      updateNode(node.id, { status: 'error', error: message, progress: undefined })
      throw error
    } finally {
      if (blenderJobIdRef.current === jobId) blenderJobIdRef.current = null
      if (isProjectExecutionContextCurrent(project)) setBlenderJobId(null)
    }
  }, () => { throw new Error(i18n.t("canvasComponents.openALocalProjectFirst")) }), [node.id, persistDirectorState, updateNode])

  const cancelBlender = React.useCallback(() => {
    const jobId = blenderJobIdRef.current
    if (!jobId) return
    void getDesktopBridge()?.vibingDirector.cancelBlenderPlan(jobId).catch(() => {})
  }, [])

  const importAsset = React.useCallback((
    source: BlenderDirectorAssetSource,
    license?: string,
  ): Promise<BlenderDirectorAsset | null> => withProjectAction(async project => {
    if (!editorProjectRef.current) throw new Error('project_identity_unavailable')
    editorProjectRef.current.assertCurrent()
    project.assertCurrent()
    const desktop = getDesktopBridge()
    if (!desktop?.vibingDirector) throw new Error(i18n.t("canvasComponents.thisEnvironmentDoesNotSupportTheBlenderAssetLibrary"))
    const payload = { projectId: project.binding.projectId, projectBinding: project.binding, directorNodeId: node.id, source, ...(license ? { license } : {}) }
    const result = await desktop.vibingDirector.importAsset(payload)
    project.assertCurrent()
    return result.canceled ? null : result.asset ?? null
  }, () => { throw new Error(i18n.t("canvasComponents.openALocalProjectFirst")) }), [node.id])

  const listCatalogAssets = React.useCallback(async (query: string): Promise<VibingDirectorCatalogAsset[]> => {
    const director = getDesktopBridge()?.vibingDirector
    if (!director) throw new Error(i18n.t("canvasComponents.thisEnvironmentDoesNotSupportTheDirectorOpenSourceAsset"))
    return director.listCatalogAssets({ query, limit: 60 })
  }, [])

  const importCatalogAsset = React.useCallback((catalogAssetId: string): Promise<BlenderDirectorAsset> => withProjectAction(async project => {
    if (!editorProjectRef.current) throw new Error('project_identity_unavailable')
    editorProjectRef.current.assertCurrent()
    project.assertCurrent()
    const director = getDesktopBridge()?.vibingDirector
    if (!director) throw new Error(i18n.t("canvasComponents.thisEnvironmentDoesNotSupportTheDirectorOpenSourceAsset"))
    const payload = {
      projectId: project.binding.projectId,
      projectBinding: project.binding,
      directorNodeId: node.id,
      catalogAssetId,
    }
    const result = await director.importCatalogAsset(payload)
    project.assertCurrent()
    return result.asset
  }, () => { throw new Error(i18n.t("canvasComponents.openALocalProjectFirst")) }), [node.id])

  const openBlender = React.useCallback((directorState: VibingDirectorState) => withProjectAction(project => {
    if (!editorProjectRef.current) throw new Error('project_identity_unavailable')
    editorProjectRef.current.assertCurrent()
    project.assertCurrent()
    const output = directorState.output
    if (!output) {
      toast(i18n.t("canvasComponents.askDirectorAgentToApplyABlenderPlanFirst"), 'info')
      return
    }
    const desktop = getDesktopBridge()
    if (!desktop?.vibingDirector) {
      toast(i18n.t("canvasComponents.thisEnvironmentCannotOpenBlenderProjects"), 'error')
      return
    }
    const payload = { projectId: project.binding.projectId, projectBinding: project.binding, directorNodeId: node.id, blendRelativePath: output.blendRelativePath }
    void desktop.vibingDirector.openBlender(payload)
      .then(() => { project.assertCurrent(); toast(i18n.t("canvasComponents.openedTheDirectorProjectInBlender"), 'success') })
      .catch((error: unknown) => { if (isProjectExecutionContextCurrent(project)) toast(error instanceof Error ? error.message : i18n.t("canvasComponents.cannotOpenTheBlenderProject"), 'error') })
  }), [node.id])

  const openAssetSource = React.useCallback((source: Exclude<BlenderDirectorAssetSource, 'local'>) => {
    void getDesktopBridge()?.vibingDirector.openAssetSource(source).catch((error: unknown) => {
      toast(error instanceof Error ? error.message : i18n.t("canvasComponents.cannotOpenTheAssetSource"), 'error')
    })
  }, [])

  const openDirector = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    withProjectAction(project => {
      editorProjectRef.current = project
      setFullscreen(true)
    }, () => { toast(i18n.t("canvasComponents.openALocalProjectFirst"), 'error') })
  }, [])

  return (
    <>
      <button
        className={cn(
          'group relative flex h-full w-full flex-col overflow-hidden bg-[var(--workbench-surface-solid)] text-left',
          'border-0 p-0 text-[var(--workbench-ink)]',
        )}
        type="button"
        aria-label={i18n.t("canvasComponents.openVIBINGDirector")}
        onClick={openDirector}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--nomi-ink-05)]">
          {thumbnailUrl ? (
            <img className="h-full w-full object-cover" src={thumbnailUrl} alt={i18n.t("canvasComponents.vibingDirectorBlenderPreview")} draggable={false} />
          ) : (
            <div className="flex h-full items-center justify-center text-[var(--workbench-muted)]"><IconBrandBlender size={44} stroke={1.25} /></div>
          )}
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-nomi-sm bg-[var(--nomi-ink)] px-2 py-1 text-micro font-medium text-[var(--nomi-paper)]">
            <IconBrandBlender size={13} />{i18n.t('canvasComponents.vibingDirector')}
          </span>
          <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-nomi-sm bg-[var(--nomi-paper)] text-[var(--workbench-ink)] opacity-0 shadow-nomi-sm transition-opacity group-hover:opacity-100"><IconMaximize size={15} /></span>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--workbench-border)] px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-caption font-medium">{state.brief || i18n.t("canvasComponents.noCreativeBriefSet")}</div>
            <div className="mt-0.5 text-micro text-[var(--workbench-muted)]">{formatVibingDirectorNodeStats(state)}</div>
          </div>
          <IconBrandBlender size={17} className={cn('shrink-0 text-[var(--workbench-muted)]', blenderJobId && 'text-[var(--nomi-accent)]')} />
        </div>
      </button>

      {fullscreen ? (
        <React.Suspense fallback={null}>
          <VibingDirectorFullscreen
            directorNodeId={node.id}
            nodeTitle={node.title || 'VIBING Director'}
            initialState={state}
            readOnly={readOnly}
            onClose={() => {
              setFullscreen(false)
              withProjectAction(project => {
                if (!isProjectExecutionContextCurrent(editorProjectRef.current ?? undefined)) return
                project.assertCurrent()
                void persistActiveWorkbenchProjectNow().then(() => project.assertCurrent()).catch(() => {})
              })
              editorProjectRef.current = null
            }}
            onStateChange={nextState => withProjectAction(project => {
              if (!isProjectExecutionContextCurrent(editorProjectRef.current ?? undefined)) return
              persistDirectorState(nextState, project)
            })}
            onApplyPlan={applyPlan}
            onImportAsset={importAsset}
            onListCatalogAssets={listCatalogAssets}
            onImportCatalogAsset={importCatalogAsset}
            onOpenBlender={openBlender}
            onCancelBlender={cancelBlender}
            onOpenAssetSource={openAssetSource}
          />
        </React.Suspense>
      ) : null}
    </>
  )
}

export default React.memo(VibingDirectorEditor, (previous, next) => (
  previous.node.id === next.node.id &&
  previous.node.title === next.node.title &&
  previous.node.meta?.vibingDirectorState === next.node.meta?.vibingDirectorState &&
  previous.node.result === next.node.result &&
  previous.width === next.width &&
  previous.height === next.height &&
  previous.readOnly === next.readOnly
))
