// UE 素体 spike lab —— 仅 dev（vite build 只吃 index.html，不进 prod）。
// 目的：把 3d-director-desk 的 UE 人偶+姿势（ueSpike/ 摘录）与我们 X Bot+现有姿势并排渲染，
// 近机位截图给「直接用他们的模型+姿势」的收编评估当样张。?set=pairs（成对对比）|extra（他们独有姿势）。
import React, { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import { Html, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Mannequin } from '../workbench/generationCanvas/nodes/scene3d/scene3dObjects'
import { MANNEQUIN_POSE_PRESETS as OUR_PRESETS } from '../workbench/generationCanvas/nodes/scene3d/scene3dConstants'
import { UE4_MANNEQUIN_MODEL_URL } from '../workbench/generationCanvas/nodes/scene3d/ueSpike/ue4MannequinRig'
import {
  applyUE4RestPoseAndRig,
  captureUE4RestPose,
} from '../workbench/generationCanvas/nodes/scene3d/ueSpike/ue4MannequinPoseApplication'
import { MANNEQUIN_POSE_PRESETS as UE_PRESETS } from '../workbench/generationCanvas/nodes/scene3d/ueSpike/mannequinPosePresets'
import { alignUE4MannequinToGround } from '../workbench/generationCanvas/nodes/scene3d/ueSpike/ueGrounding'

const params = new URLSearchParams(window.location.search)
const set = params.get('set') ?? 'pairs'

// [UE preset id, 我们的 preset id]；null = 我们没有对应姿势
const PAIRS: Array<[string, string | null]> = [
  ['stand', 'standing'],
  ['sit', 'sit'],
  ['wave', 'wave'],
  ['kneel-one', 'single-knee'],
]
const EXTRA_UE = ['fight', 'phone', 'think', 'bow', 'lean', 'throw', 'crouch', 'hands-on-hips']

const OUR_HEIGHT = 1.87 // 把我们的单位高假人放大到与 UE 原生身高一致，公平对比

function Label({ text, y = 2.1 }: { text: string; y?: number }): JSX.Element {
  return (
    <Html position={[0, y, 0]} center style={{ pointerEvents: 'none' }}>
      <div style={{ fontFamily: 'system-ui', fontSize: '13px', fontWeight: 600, color: '#1f2937', whiteSpace: 'nowrap', background: 'rgba(246,243,238,0.9)', padding: '2px 6px', borderRadius: '4px' }}>
        {text}
      </div>
    </Html>
  )
}

function UeFigure({ presetId, x }: { presetId: string; x: number }): JSX.Element {
  const { scene } = useGLTF(UE4_MANNEQUIN_MODEL_URL)
  const model = React.useMemo(() => {
    const cloned = cloneSkeleton(scene)
    const restPose = captureUE4RestPose(cloned)
    const preset = UE_PRESETS.find((item) => item.id === presetId)
    applyUE4RestPoseAndRig(cloned, { controls: preset?.controls ?? {}, restPose })
    const holder = new THREE.Group()
    holder.add(cloned)
    holder.updateMatrixWorld(true)
    alignUE4MannequinToGround(cloned)
    cloned.traverse((o) => {
      if (o instanceof THREE.Mesh) o.frustumCulled = false
    })
    return holder
  }, [scene, presetId])
  return (
    <group position={[x, 0, 0]}>
      <primitive object={model} />
      <Label text={`UE·${presetId}`} />
    </group>
  )
}

function OurFigure({ presetId, x }: { presetId: string; x: number }): JSX.Element {
  const preset = OUR_PRESETS.find((item) => item.id === presetId)
  return (
    <group position={[x, OUR_HEIGHT * 0.5, 0]} scale={OUR_HEIGHT}>
      <Mannequin color="#8a8f98" pose={preset?.pose} />
      <Label text={`我们·${presetId}`} y={0.62} />
    </group>
  )
}

function CameraRig({ width }: { width: number }): null {
  const camera = useThree((state) => state.camera)
  React.useLayoutEffect(() => {
    const dist = Math.max(6.5, width * 0.62)
    camera.position.set(0, 1.55, dist)
    camera.lookAt(0, 0.95, 0)
    camera.updateProjectionMatrix()
  }, [camera, width])
  return null
}

function UeSpikeLab(): JSX.Element {
  const columns: JSX.Element[] = []
  let x = 0
  const step = 1.35
  if (set === 'pairs') {
    for (const [ueId, ourId] of PAIRS) {
      columns.push(<UeFigure key={`ue-${ueId}`} presetId={ueId} x={x} />)
      x += step
      if (ourId) {
        columns.push(<OurFigure key={`our-${ourId}`} presetId={ourId} x={x} />)
        x += step
      }
      x += 0.45 // 组间距
    }
  } else {
    for (const ueId of EXTRA_UE) {
      columns.push(<UeFigure key={`ue-${ueId}`} presetId={ueId} x={x} />)
      x += step
    }
  }
  const width = x
  return (
    <Canvas camera={{ fov: 38, near: 0.01, far: 100, position: [0, 1.55, 9] }} gl={{ preserveDrawingBuffer: true, antialias: true }} style={{ height: '100vh', width: '100vw' }}>
      <color attach="background" args={['#f6f3ee']} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[4, 6, 5]} intensity={1.15} />
      <directionalLight position={[-4, 3, -3]} intensity={0.4} />
      <gridHelper args={[60, 60, '#b6bdc9', '#d8dde5']} position={[0, 0, 0]} />
      <group position={[-width / 2 + 0.6, 0, 0]}>
        <Suspense fallback={null}>{columns}</Suspense>
      </group>
      <CameraRig width={width} />
    </Canvas>
  )
}

createRoot(document.getElementById('ue-spike-lab-root') as HTMLElement).render(<UeSpikeLab />)
