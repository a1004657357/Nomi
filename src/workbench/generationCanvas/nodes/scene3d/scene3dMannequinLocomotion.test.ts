import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  findSkinnedMesh,
  retargetMannequinAnimationClip,
} from './scene3dMannequinLocomotion'

function loadGlb(relativePath: string): Promise<GLTF> {
  const bytes = fs.readFileSync(path.resolve(process.cwd(), relativePath))
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
      resolve,
      reject,
    )
  })
}

function quaternionTrackVariation(values: ArrayLike<number>): number {
  let variation = 0
  for (let index = 4; index < values.length; index += 4) {
    variation = Math.max(
      variation,
      Math.abs(values[index] - values[0])
        + Math.abs(values[index + 1] - values[1])
        + Math.abs(values[index + 2] - values[2])
        + Math.abs(values[index + 3] - values[3]),
    )
  }
  return variation
}

describe('mannequin locomotion asset contract', () => {
  it('retargets walk and run onto same-name bones with changing leg motion', async () => {
    const [model, animations] = await Promise.all([
      loadGlb('src/assets/nomi-mannequin.glb'),
      loadGlb('src/assets/nomi-mannequin-animations.glb'),
    ])
    const target = findSkinnedMesh(model.scene)
    const source = findSkinnedMesh(cloneSkeleton(animations.scene))

    expect(target).not.toBeNull()
    expect(source).not.toBeNull()
    if (!target || !source) return

    for (const clipName of ['walk', 'run']) {
      const sourceClip = animations.animations.find((clip) => clip.name === clipName)
      expect(sourceClip, `missing source clip ${clipName}`).toBeTruthy()
      if (!sourceClip) continue

      const retargeted = retargetMannequinAnimationClip(target, source, sourceClip)
      expect(retargeted.tracks.some((track) => track.name.includes('[undefined]'))).toBe(false)
      const legTrack = retargeted.tracks.find(
        (track) => track.name === '.bones[mixamorigLeftUpLeg].quaternion',
      )
      expect(legTrack, `missing retargeted leg track ${clipName}`).toBeTruthy()
      expect(quaternionTrackVariation(legTrack?.values ?? [])).toBeGreaterThan(0.05)
    }
  }, 30_000)
})
