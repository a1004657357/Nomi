import React from 'react'
import {
  IconAdjustmentsHorizontal,
  IconCamera,
  IconFocusCentered,
  IconGridDots,
  IconRefresh,
} from '@tabler/icons-react'
import { NomiSelect, WorkbenchIconButton } from '../../../../design'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../ui/toast'
import { useWorkbenchStore } from '../../../workbenchStore'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import Model3DViewer, { type Model3DViewerHandle } from './Model3DViewer'
import {
  DEFAULT_MODEL3D_CAMERA_STATE,
  MODEL3D_CAPTURE_RATIOS,
  model3dGrid9CameraStates,
  model3dCaptureDimensions,
  normalizeModel3DCameraState,
  type Model3DCameraState,
  type Model3DCaptureRatio,
} from './model3dCamera'
import {
  createModel3DCameraCapture,
  createModel3DGrid9CaptureCollection,
} from './model3dCameraCapture'

const CAPTURE_LONG_EDGES = [1024, 1920, 2048] as const
const CAMERA_FIELDS = [
  { key: 'azimuth', label: '方位', min: -180, max: 180, step: 1 },
  { key: 'elevation', label: '仰俯', min: -89, max: 89, step: 1 },
  { key: 'distance', label: '距离', min: 0.01, max: 1000000, step: 0.1 },
  { key: 'fov', label: 'FOV', min: 10, max: 100, step: 1 },
] as const

function cameraEqual(a: Model3DCameraState | null, b: Model3DCameraState): boolean {
  if (!a) return false
  return (
    Math.abs(a.azimuth - b.azimuth) < 0.0001
    && Math.abs(a.elevation - b.elevation) < 0.0001
    && Math.abs(a.distance - b.distance) < 0.0001
    && Math.abs(a.fov - b.fov) < 0.0001
    && a.target.every((value, index) => Math.abs(value - b.target[index]) < 0.0001)
  )
}

function captureSettings(value: unknown): { ratio: Model3DCaptureRatio; longEdge: number } {
  if (!value || typeof value !== 'object') return { ratio: '16:9', longEdge: 1920 }
  const record = value as Record<string, unknown>
  const ratio = MODEL3D_CAPTURE_RATIOS.includes(record.ratio as Model3DCaptureRatio)
    ? record.ratio as Model3DCaptureRatio
    : '16:9'
  const requestedLongEdge = typeof record.longEdge === 'number' ? record.longEdge : 1920
  const longEdge = CAPTURE_LONG_EDGES.includes(requestedLongEdge as (typeof CAPTURE_LONG_EDGES)[number])
    ? requestedLongEdge
    : 1920
  return { ratio, longEdge }
}

function CameraNumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <label className="grid min-w-0 gap-0.5 text-micro text-nomi-ink-40">
      <span>{label}</span>
      <input
        className={cn(
          'h-7 min-w-0 w-full rounded-nomi-sm border border-nomi-line bg-nomi-paper px-1.5',
          'text-caption text-nomi-ink outline-none focus:border-nomi-accent',
        )}
        type="number"
        value={Number(value.toFixed(step < 1 ? 2 : 1))}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.currentTarget.value)
          if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)))
        }}
      />
    </label>
  )
}

export default function Model3DCameraNodeBody({
  node,
  readOnly,
}: {
  node: GenerationCanvasNode
  readOnly: boolean
}): JSX.Element {
  const viewerRef = React.useRef<Model3DViewerHandle>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [capturing, setCapturing] = React.useState(false)
  const storedCamera = normalizeModel3DCameraState(node.meta?.model3dCamera)
  const storedCapture = captureSettings(node.meta?.model3dCapture)
  const [camera, setCamera] = React.useState<Model3DCameraState | null>(storedCamera)
  const [ratio, setRatio] = React.useState<Model3DCaptureRatio>(storedCapture.ratio)
  const [longEdge, setLongEdge] = React.useState(storedCapture.longEdge)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)

  React.useEffect(() => {
    if (storedCamera && !cameraEqual(camera, storedCamera)) setCamera(storedCamera)
  }, [camera, storedCamera])

  const persistCamera = React.useCallback((next: Model3DCameraState) => {
    setCamera(next)
    const currentNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
    if (!currentNode || cameraEqual(normalizeModel3DCameraState(currentNode.meta?.model3dCamera), next)) return
    updateNode(node.id, {
      meta: {
        ...(currentNode.meta || {}),
        model3dCamera: next,
      },
    })
  }, [node.id, updateNode])

  const persistCaptureSettings = React.useCallback((nextRatio: Model3DCaptureRatio, nextLongEdge: number) => {
    const currentNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
    if (!currentNode) return
    updateNode(node.id, {
      meta: {
        ...(currentNode.meta || {}),
        model3dCapture: { ratio: nextRatio, longEdge: nextLongEdge },
      },
    })
  }, [node.id, updateNode])

  const updateCameraField = React.useCallback((
    key: 'azimuth' | 'elevation' | 'distance' | 'fov',
    value: number,
  ) => {
    const current = camera ?? DEFAULT_MODEL3D_CAMERA_STATE
    persistCamera({ ...current, [key]: value })
  }, [camera, persistCamera])

  const updateTarget = React.useCallback((index: number, value: number) => {
    const current = camera ?? DEFAULT_MODEL3D_CAMERA_STATE
    const target = [...current.target] as [number, number, number]
    target[index] = value
    persistCamera({ ...current, target })
  }, [camera, persistCamera])

  const handleReset = React.useCallback(() => {
    persistCamera({
      ...DEFAULT_MODEL3D_CAMERA_STATE,
      distance: camera?.distance ?? DEFAULT_MODEL3D_CAMERA_STATE.distance,
      target: camera?.target ?? DEFAULT_MODEL3D_CAMERA_STATE.target,
    })
  }, [camera?.distance, camera?.target, persistCamera])

  const handleCapture = React.useCallback(async () => {
    if (!camera || !viewerRef.current || capturing) return
    const dimensions = model3dCaptureDimensions(ratio, longEdge)
    const frame = viewerRef.current.capture(dimensions)
    if (!frame) {
      toast('当前 3D 画面还没有准备好，请稍后重试', 'warning')
      return
    }
    setCapturing(true)
    try {
      await createModel3DCameraCapture({
        sourceNodeId: node.id,
        camera,
        capture: frame,
      })
      useWorkbenchStore.getState().requestCanvasFit()
      toast(`已按 ${ratio} 机位创建回拍图片`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '3D 机位回拍失败', 'error')
    } finally {
      setCapturing(false)
    }
  }, [camera, capturing, longEdge, node.id, ratio])

  const handleGrid9Capture = React.useCallback(async () => {
    if (!camera || !viewerRef.current || capturing) return
    setCapturing(true)
    try {
      const dimensions = model3dCaptureDimensions(ratio, 1024)
      const frames = model3dGrid9CameraStates(camera).map((guide) => {
        const capture = viewerRef.current?.captureAt(guide.camera, dimensions)
        if (!capture) throw new Error(`机位「${guide.label}」画面尚未准备好`)
        return { ...guide, capture }
      })
      await createModel3DGrid9CaptureCollection({
        sourceNodeId: node.id,
        frames,
      })
      useWorkbenchStore.getState().requestCanvasFit()
      toast(`已创建 ${ratio} 九机位几何引导集合`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '九机位引导生成失败', 'error')
    } finally {
      setCapturing(false)
    }
  }, [camera, capturing, node.id, ratio])

  const url = node.result?.type === 'model3d' ? node.result.url : ''
  if (!url) return <div className="h-full w-full bg-nomi-ink-05" />

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Model3DViewer
        ref={viewerRef}
        url={url}
        autoRotate={false}
        enablePan={!readOnly}
        cameraState={camera}
        onCameraStateChange={readOnly ? undefined : persistCamera}
      />
      {!readOnly ? (
        <>
          <div
            className={cn(
              'absolute right-2 top-10 z-[8] inline-flex items-center gap-1 p-1',
              'rounded-nomi-sm border border-nomi-line bg-nomi-paper/[0.94] shadow-nomi-sm',
            )}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <WorkbenchIconButton
              icon={<IconAdjustmentsHorizontal />}
              label="机位设置"
              aria-pressed={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
            />
            <WorkbenchIconButton
              icon={<IconCamera />}
              label="按当前机位拍摄"
              disabled={!camera || capturing}
              onClick={() => void handleCapture()}
            />
            <WorkbenchIconButton
              icon={<IconGridDots />}
              label="生成九机位引导"
              disabled={!camera || capturing}
              onClick={() => void handleGrid9Capture()}
            />
          </div>
          {settingsOpen && camera ? (
            <div
              className={cn(
                'absolute bottom-2 left-2 right-2 z-[8] grid gap-2 p-2',
                'rounded-nomi border border-nomi-line bg-nomi-paper/[0.96] shadow-nomi-md backdrop-blur-[10px]',
              )}
              data-model3d-camera-panel="true"
              onPointerDown={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
            >
              <div className="grid grid-cols-4 gap-1.5">
                {CAMERA_FIELDS.map((field) => (
                  <CameraNumberField
                    key={field.key}
                    label={field.label}
                    value={camera[field.key]}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onChange={(value) => updateCameraField(field.key, value)}
                  />
                ))}
              </div>
              <div className="flex min-w-0 flex-wrap items-end gap-1.5">
                <span className="inline-flex shrink-0 items-center self-center text-nomi-ink-40" title="相机目标点">
                  <IconFocusCentered size={15} stroke={1.6} />
                </span>
                {camera.target.map((value, index) => (
                  <CameraNumberField
                    key={index}
                    label={['X', 'Y', 'Z'][index]}
                    value={value}
                    min={-100000}
                    max={100000}
                    step={0.1}
                    onChange={(next) => updateTarget(index, next)}
                  />
                ))}
                <div className="ml-auto inline-flex items-center gap-1">
                  <div className="inline-flex overflow-hidden rounded-nomi-sm border border-nomi-line">
                    {MODEL3D_CAPTURE_RATIOS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={cn(
                          'h-7 border-0 px-2 text-micro cursor-pointer',
                          ratio === option
                            ? 'bg-nomi-ink text-nomi-paper'
                            : 'bg-nomi-paper text-nomi-ink-60 hover:bg-nomi-ink-05',
                        )}
                        aria-pressed={ratio === option}
                        title={`回拍画幅 ${option}`}
                        onClick={() => {
                          setRatio(option)
                          persistCaptureSettings(option, longEdge)
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <NomiSelect
                    value={String(longEdge)}
                    ariaLabel="回拍分辨率"
                    leadingLabel="尺寸"
                    size="xs"
                    options={CAPTURE_LONG_EDGES.map((value) => ({
                      value: String(value),
                      label: value === 1024 ? '1K' : value === 2048 ? '2K' : '1920',
                    }))}
                    onChange={(value) => {
                      const next = Number(value)
                      setLongEdge(next)
                      persistCaptureSettings(ratio, next)
                    }}
                  />
                  <WorkbenchIconButton
                    icon={<IconRefresh />}
                    label="复位机位"
                    onClick={handleReset}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
