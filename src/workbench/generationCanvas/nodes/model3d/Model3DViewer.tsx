import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useThree } from '@react-three/fiber'
import { FencedCanvas } from '../fencedCanvas'
import { Bounds, OrbitControls, useGLTF } from '@react-three/drei'
import { Box3, PerspectiveCamera, Sphere } from 'three'
import { cn } from '../../../../utils/cn'
import { attachWebGLContextRecovery } from '../scene3d/scene3dContextRecovery'
import { captureScene } from '../scene3d/scene3dMath'
import {
  cameraPositionFromState,
  cameraStateFromPosition,
  type Model3DCameraState,
} from './model3dCamera'
import type { Model3DCameraCaptureFrame } from './model3dCameraCapture'
import { validateGlbStructure } from '../../../../../electron/assets/model3dValidation'
import { logRendererError } from '../../../../desktop/rendererLog'

/**
 * 生成出的 3D 模型（.glb）的卡内交互预览。
 *
 * 复用导演台同一套 R3F + drei + three 栈（CSP 已为 Three.js WASM/blob 放行，见 electron/main.ts），
 * 但**不引 Environment/Stage 的远程 HDR 预设**——那会去 CDN 拉 .hdr，触 CSP/离线失败，违 local-first。
 * 改用手动三点光。Bounds 自动取景、OrbitControls 让用户拖转、autoRotate 给转盘感。
 *
 * 只吃 glTF/glb（useGLTF = three GLTFLoader）；.obj 不在栈里（MVP 不做）。
 */

export type Model3DViewerHandle = {
  capture: (input: { width: number; height: number }) => Model3DCameraCaptureFrame | null
  captureAt: (
    camera: Model3DCameraState,
    input: { width: number; height: number },
  ) => Model3DCameraCaptureFrame | null
}

type Model3DViewerProps = {
  url: string
  autoRotate?: boolean
  enablePan?: boolean
  cameraState?: Model3DCameraState | null
  onCameraStateChange?: (state: Model3DCameraState) => void
}

type Model3DCaptureCallback = (input: {
  width: number
  height: number
  cameraState?: Model3DCameraState
}) => Model3DCameraCaptureFrame | null

export function orbitDistanceLimitsForRadius(radius: number | undefined): {
  minDistance: number
  maxDistance: number
} {
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
    return {
      minDistance: 0,
      maxDistance: Number.POSITIVE_INFINITY,
    }
  }
  return {
    minDistance: radius * 0.05,
    maxDistance: radius * 20,
  }
}

export function shouldAutoFitModelCamera(cameraState?: Model3DCameraState | null): boolean {
  return !cameraState
}

function Glb({
  url,
  onRadius,
}: {
  url: string
  onRadius: (radius: number) => void
}): JSX.Element {
  const { scene } = useGLTF(url)
  // clone：同一 glb 被多个节点引用时不共享 mutable 场景（与 Mannequin 同款防串改）。
  const object = React.useMemo(() => scene.clone(true), [scene])
  const radius = React.useMemo(() => {
    const sphere = new Box3().setFromObject(object).getBoundingSphere(new Sphere())
    return Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1
  }, [object])
  React.useEffect(() => onRadius(radius), [onRadius, radius])
  return <primitive object={object} />
}

function ConnectedOrbitControls({
  autoRotate,
  enablePan,
  modelRadius,
  cameraState,
  onCameraStateChange,
  captureCallbackRef,
}: {
  autoRotate: boolean
  enablePan: boolean
  modelRadius: number | undefined
  cameraState?: Model3DCameraState | null
  onCameraStateChange?: (state: Model3DCameraState) => void
  captureCallbackRef: React.MutableRefObject<Model3DCaptureCallback | null>
}): JSX.Element {
  const eventSource = useThree((state) => state.events.connected)
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const controlsRef = React.useRef<React.ElementRef<typeof OrbitControls>>(null)
  const initializedRef = React.useRef(false)
  const limits = orbitDistanceLimitsForRadius(modelRadius)

  const readCameraState = React.useCallback((): Model3DCameraState | null => {
    const controls = controlsRef.current
    if (!controls) return null
    const target = controls.target.toArray() as [number, number, number]
    const position = camera.position.toArray() as [number, number, number]
    return cameraStateFromPosition({
      position,
      target,
      fov: camera instanceof PerspectiveCamera ? camera.fov : 45,
    })
  }, [camera])

  React.useEffect(() => {
    if (!modelRadius || !controlsRef.current) return
    if (cameraState) {
      const position = cameraPositionFromState(cameraState)
      camera.position.set(...position)
      camera.up.set(0, 1, 0)
      controlsRef.current.target.set(...cameraState.target)
      if (camera instanceof PerspectiveCamera) {
        camera.fov = cameraState.fov
        camera.updateProjectionMatrix()
      }
      controlsRef.current.update()
      invalidate()
      initializedRef.current = true
      return
    }
    if (initializedRef.current || !onCameraStateChange) return
    initializedRef.current = true
    const frame = requestAnimationFrame(() => {
      const current = readCameraState()
      if (current) onCameraStateChange(current)
    })
    return () => cancelAnimationFrame(frame)
  }, [camera, cameraState, invalidate, modelRadius, onCameraStateChange, readCameraState])

  React.useEffect(() => {
    captureCallbackRef.current = ({ width, height, cameraState: captureCameraState }) => {
      if (!(camera instanceof PerspectiveCamera) || width <= 0 || height <= 0) return null
      const controls = controlsRef.current
      const previousAspect = camera.aspect
      const previousFov = camera.fov
      const previousPosition = camera.position.clone()
      const previousUp = camera.up.clone()
      const previousTarget = controls?.target.clone()
      try {
        if (captureCameraState && controls) {
          camera.position.set(...cameraPositionFromState(captureCameraState))
          camera.up.set(0, 1, 0)
          camera.fov = captureCameraState.fov
          controls.target.set(...captureCameraState.target)
          controls.update()
        }
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        const capture = captureScene(
          gl,
          scene,
          camera,
          Math.round(width),
          Math.round(height),
          '3D 机位回拍',
          'scene3d-camera',
          true,
        )
        return capture
          ? {
              dataUrl: capture.dataUrl,
              width: capture.width,
              height: capture.height,
            }
          : null
      } finally {
        camera.position.copy(previousPosition)
        camera.up.copy(previousUp)
        camera.fov = previousFov
        if (controls && previousTarget) {
          controls.target.copy(previousTarget)
          controls.update()
        }
        camera.aspect = previousAspect
        camera.updateProjectionMatrix()
        invalidate()
      }
    }
    return () => {
      captureCallbackRef.current = null
    }
  }, [camera, captureCallbackRef, gl, invalidate, scene])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      domElement={(eventSource as HTMLElement | undefined) ?? undefined}
      enablePan={enablePan}
      autoRotate={autoRotate}
      autoRotateSpeed={1.1}
      minDistance={limits.minDistance}
      maxDistance={limits.maxDistance}
      onEnd={() => {
        const current = readCameraState()
        if (current) onCameraStateChange?.(current)
      }}
    />
  )
}

function ValidatedGlb({ url, onRadius }: { url: string; onRadius: (radius: number) => void }): JSX.Element | null {
  const [validatedUrl, setValidatedUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState<unknown>(null)
  React.useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    setValidatedUrl(null)
    setError(null)
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('MODEL3D_FETCH_FAILED')
        const bytes = new Uint8Array(await response.arrayBuffer())
        validateGlbStructure(bytes)
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }))
        setValidatedUrl(objectUrl)
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])
  if (error) throw error
  return validatedUrl ? <Glb url={validatedUrl} onRadius={onRadius} /> : null
}

class GlbBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(error: unknown): void {
    logRendererError('model3d-load-failed', error)
  }
  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const Model3DViewer = React.forwardRef<Model3DViewerHandle, Model3DViewerProps>(function Model3DViewer({
  url,
  autoRotate = true,
  enablePan = false,
  cameraState,
  onCameraStateChange,
}, forwardedRef): JSX.Element {
  const { t } = useTranslation()
  const [modelRadius, setModelRadius] = React.useState<number>()
  const captureCallbackRef = React.useRef<Model3DCaptureCallback | null>(null)
  React.useImperativeHandle(forwardedRef, () => ({
    capture: (input) => captureCallbackRef.current?.(input) ?? null,
    captureAt: (captureCamera, input) => (
      captureCallbackRef.current?.({ ...input, cameraState: captureCamera }) ?? null
    ),
  }), [])
  // The viewer can live inside a draggable React Flow node. Let R3F receive its
  // event first, then keep the canvas from claiming the pointer for node drag.
  const keepPointerInViewer = (event: React.SyntheticEvent): void => {
    event.stopPropagation()
  }

  return (
    <div
      className={cn('w-full h-full select-none touch-none bg-nomi-ink-05')}
      onContextMenu={keepPointerInViewer}
      onPointerDown={keepPointerInViewer}
      onWheel={keepPointerInViewer}
    >
      <GlbBoundary
        key={url}
        fallback={
          <div className={cn('flex h-full w-full items-center justify-center text-caption text-nomi-ink-40')}>
            {t('generationCommon.node.model3dLoadFailed')}
          </div>
        }
      >
        <FencedCanvas
          camera={{ position: [2.4, 1.8, 3.2], fov: 45 }}
          dpr={[1, 2]}
          fence={
            <div className="flex h-full w-full items-center justify-center text-caption text-nomi-ink-40">
              3D 场景加载中
            </div>
          }
          frameloop="demand"
          style={{ touchAction: 'none', userSelect: 'none' }}
          onCreated={({ gl, invalidate }) => attachWebGLContextRecovery(gl.domElement, invalidate)}
        >
          <color attach="background" args={['#dfe6ea']} />
          <ambientLight intensity={0.75} />
          <directionalLight position={[3, 5, 2]} intensity={1.1} castShadow />
          <directionalLight position={[-3, 2, -2]} intensity={0.4} />
          <React.Suspense fallback={null}>
            <Bounds fit={shouldAutoFitModelCamera(cameraState)} clip observe margin={1.25}>
              <ValidatedGlb url={url} onRadius={setModelRadius} />
            </Bounds>
          </React.Suspense>
          <ConnectedOrbitControls
            autoRotate={autoRotate}
            enablePan={enablePan}
            modelRadius={modelRadius}
            cameraState={cameraState}
            onCameraStateChange={onCameraStateChange}
            captureCallbackRef={captureCallbackRef}
          />
        </FencedCanvas>
      </GlbBoundary>
    </div>
  )
})

Model3DViewer.displayName = 'Model3DViewer'

export default Model3DViewer
