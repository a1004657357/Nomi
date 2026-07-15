import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildVibingDirectorBlenderArgs,
  parseVibingDirectorBridgeOutput,
  VIBING_DIRECTOR_BLENDER_SCRIPT,
} from './vibingDirectorRunner'

const blenderPath = '/Applications/Blender.app/Contents/MacOS/Blender'
const runRealBlender = process.env.NOMI_REAL_BLENDER_SMOKE === '1' && fs.existsSync(blenderPath)
const realIt = runRealBlender ? it : it.skip
const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-vibing-director-real-'))
  tempDirs.push(dir)
  return dir
}

function pngSize(filePath: string): [number, number] {
  const bytes = fs.readFileSync(filePath)
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

function runBridge(input: {
  root: string
  jobId: string
  plan: unknown
  existingBlendPath?: string
}): ReturnType<typeof parseVibingDirectorBridgeOutput> {
  const outputDir = path.join(input.root, input.jobId)
  const planPath = path.join(input.root, `${input.jobId}.json`)
  const scriptPath = path.join(input.root, 'apply-director.py')
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(planPath, JSON.stringify({ jobId: input.jobId, plan: input.plan, assets: [] }), 'utf8')
  fs.writeFileSync(scriptPath, VIBING_DIRECTOR_BLENDER_SCRIPT, 'utf8')
  const run = spawnSync(blenderPath, buildVibingDirectorBlenderArgs({
    ...(input.existingBlendPath ? { existingBlendPath: input.existingBlendPath } : {}),
    scriptPath,
    planPath,
    outputDir,
  }), { encoding: 'utf8', timeout: 90_000 })
  expect(run.error).toBeUndefined()
  expect(run.status, `${run.stderr}\n${run.stdout}`).toBe(0)
  return parseVibingDirectorBridgeOutput(run.stdout)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('VIBING Director real Blender bridge', () => {
  realIt('renders a default-camera scene, persists artifacts, and applies a vertical amend plan', () => {
    const root = tempDir()
    const first = runBridge({
      root,
      jobId: 'first-plan',
      plan: {
        mode: 'replace',
        actions: [
          { op: 'set_stage', preset: 'coffee_shop' },
          { op: 'add_marker', id: 'barista', name: '咖啡师', position: [-1, 0, 0] },
        ],
      },
    })

    expect(pngSize(first.artifacts.preview)).toEqual([960, 540])
    expect(fs.statSync(first.artifacts.blend).size).toBeGreaterThan(0)
    expect(fs.statSync(first.artifacts.model).size).toBeGreaterThan(0)

    const inspect = spawnSync(blenderPath, [
      '--background', first.artifacts.blend,
      '--python-expr', "import bpy; c=bpy.context.scene.camera; print('NOMI_CAMERA=' + ','.join(str(round(v, 1)) for v in c.location)); bpy.ops.wm.quit_blender()",
    ], { encoding: 'utf8', timeout: 60_000 })
    expect(inspect.status, inspect.stderr).toBe(0)
    expect(inspect.stdout).toContain('NOMI_CAMERA=5.0,-6.0,2.4')

    const second = runBridge({
      root,
      jobId: 'vertical-amend',
      existingBlendPath: first.artifacts.blend,
      plan: {
        mode: 'amend',
        actions: [{ op: 'set_camera', cameraRef: 'director-camera', aspectRatio: '9:16' }],
      },
    })
    expect(pngSize(second.artifacts.preview)).toEqual([540, 960])
  }, 120_000)

  realIt('builds role-specific coffee conversation proxies instead of human markers for every object', () => {
    const root = tempDir()
    const result = runBridge({
      root,
      jobId: 'semantic-coffee-layout',
      plan: {
        mode: 'replace',
        actions: [
          { op: 'set_stage', preset: 'coffee_shop' },
          { op: 'add_marker', id: 'table-main', name: '咖啡桌', role: 'table', position: [0, 0, 0] },
          { op: 'add_marker', id: 'chair-A', name: '椅子A', role: 'chair', position: [0, 0, 1.25], rotation: [0, 180, 0] },
          { op: 'add_marker', id: 'actor-A', name: '角色A', role: 'actor_seated', position: [0, 0, 1.25], rotation: [0, 180, 0] },
          { op: 'add_marker', id: 'cup-A', name: '咖啡杯A', role: 'cup', position: [-0.38, 0.76, 0.22] },
          { op: 'add_marker', id: 'laptop', name: '笔记本电脑', role: 'laptop', position: [0.54, 0.76, 0.08] },
        ],
      },
    })

    const inspect = spawnSync(blenderPath, [
      '--background', result.artifacts.blend,
      '--python-expr', "import bpy; names='|'.join(sorted(bpy.data.objects.keys())); print('NOMI_OBJECTS=' + names); print('NOMI_DEFAULT_CUBE=' + str('Cube' in bpy.data.objects)); bpy.ops.wm.quit_blender()",
    ], { encoding: 'utf8', timeout: 60_000 })
    expect(inspect.status, inspect.stderr).toBe(0)
    expect(inspect.stdout).toContain('咖啡桌 Top')
    expect(inspect.stdout).toContain('椅子A Seat')
    expect(inspect.stdout).toContain('角色A Left Arm')
    expect(inspect.stdout).toContain('咖啡杯A Handle')
    expect(inspect.stdout).toContain('笔记本电脑 Screen')
    expect(inspect.stdout).toContain('NOMI_DEFAULT_CUBE=False')
  }, 120_000)
})
