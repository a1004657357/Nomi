/**
 * Gate 4 测试：ShotSpec ↔ Blender 桥接 + shotId 闭环。
 *
 * 验收：
 * - projectShotSpecToBlenderInputs 把 ShotSpec 子字段投影成 Blender plan 输入。
 * - blenderCameraToShotPatch 把回传相机关联回 ShotSpec。
 * - assertShotBlenderInputsSafe 拦截危险字段（URL/路径/shell，§14.4 执行边界）。
 * - VibingDirectorBlenderRequest 接受 optional shotId（向后兼容）。
 */
import { describe, expect, it } from 'vitest'
import {
  assertShotBlenderInputsSafe,
  blenderCameraToShotPatch,
  projectShotSpecToBlenderInputs,
} from './shotBlenderBridge'
import type { VibingDirectorBlenderRequest } from './vibingDirectorRunner'

describe('projectShotSpecToBlenderInputs — ShotSpec→Blender 投影', () => {
  it('projects cinematography/blocking/cameraMotion into Blender inputs', () => {
    const inputs = projectShotSpecToBlenderInputs({
      id: 'shot-07',
      index: 7,
      cinematography: {
        shotScale: '中景',
        cameraAngle: '过肩',
        lensMm: 35,
        cameraMotion: { type: '推', speed: '慢' },
        blocking: '林夏左、反派右',
      },
      environment: { spatialRelations: ['林夏在前景'] },
      subjects: [{ assetId: 'char-linxia', role: 'primary', performance: '转身' }],
      time: { durationSeconds: 5, startState: '背对', endState: '面对' },
    })
    expect(inputs.shotId).toBe('shot-07')
    expect(inputs.shotScale).toBe('中景')
    expect(inputs.cameraAngle).toBe('过肩')
    expect(inputs.lensMm).toBe(35)
    expect(inputs.cameraMotion?.type).toBe('推')
    expect(inputs.blocking).toBe('林夏左、反派右')
    expect(inputs.spatialRelations).toEqual(['林夏在前景'])
    expect(inputs.subjects[0].performance).toBe('转身')
    expect(inputs.durationSeconds).toBe(5)
    expect(inputs.startState).toBe('背对')
    expect(inputs.endState).toBe('面对')
  })

  it('handles minimal ShotSpec (only id + index) without throwing', () => {
    const inputs = projectShotSpecToBlenderInputs({ id: 's1', index: 1 })
    expect(inputs.shotId).toBe('s1')
    expect(inputs.spatialRelations).toEqual([])
    expect(inputs.subjects).toEqual([])
    expect(inputs.durationSeconds).toBe(0)
  })
})

describe('blenderCameraToShotPatch — 相机回传关联 ShotSpec', () => {
  it('produces a patch with blenderCamera metadata', () => {
    const patch = blenderCameraToShotPatch({
      position: [1, 2, 3],
      lookAt: [4, 5, 6],
      focalLength: 50,
    })
    expect(patch.blenderCamera.position).toEqual([1, 2, 3])
    expect(patch.blenderCamera.lookAt).toEqual([4, 5, 6])
    expect(patch.blenderCamera.focalLength).toBe(50)
  })

  it('omits undefined camera fields', () => {
    const patch = blenderCameraToShotPatch({ focalLength: 35 })
    expect(patch.blenderCamera.focalLength).toBe(35)
    expect(patch.blenderCamera.position).toBeUndefined()
  })
})

describe('assertShotBlenderInputsSafe — §14.4 执行边界', () => {
  const safeInputs = (): Parameters<typeof assertShotBlenderInputsSafe>[0] => ({
    shotId: 's1',
    index: 1,
    spatialRelations: [],
    subjects: [],
    durationSeconds: 5,
  })

  it('safe for normal blocking text', () => {
    expect(assertShotBlenderInputsSafe({ ...safeInputs(), blocking: '林夏站在桌左' }).safe).toBe(true)
  })

  it('rejects URL in blocking', () => {
    const r = assertShotBlenderInputsSafe({ ...safeInputs(), blocking: 'see https://evil.com/x' })
    expect(r.safe).toBe(false)
    expect(r.reason).toContain('URL')
  })

  it('rejects absolute path in spatialRelations', () => {
    const r = assertShotBlenderInputsSafe({ ...safeInputs(), spatialRelations: ['/etc/passwd 内容'] })
    expect(r.safe).toBe(false)
    expect(r.reason).toContain('路径')
  })

  it('rejects shell-like call in cameraMotion', () => {
    const r = assertShotBlenderInputsSafe({
      ...safeInputs(),
      cameraMotion: { type: 'system("rm -rf /")' },
    })
    expect(r.safe).toBe(false)
    expect(r.reason).toContain('可疑调用')
  })
})

describe('VibingDirectorBlenderRequest — shotId 字段（§14.2 shot 闭环）', () => {
  it('accepts optional shotId (shot-level closed loop)', () => {
    const req: VibingDirectorBlenderRequest = {
      jobId: 'j1',
      projectId: 'p1',
      directorNodeId: 'dir-1',
      plan: {},
      assets: [],
      shotId: 'shot-07',
    }
    expect(req.shotId).toBe('shot-07')
  })

  it('shotId optional (backward compat: existing directorNode-only calls)', () => {
    const req: VibingDirectorBlenderRequest = {
      jobId: 'j1',
      projectId: 'p1',
      directorNodeId: 'dir-1',
      plan: {},
      assets: [],
    }
    expect(req.shotId).toBeUndefined()
  })
})
