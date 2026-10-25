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
import { inspectGlb } from '../assets/glbValidation'

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

function createProviderLikeGlb(root: string): string {
  const outputPath = path.join(root, 'provider-bottle.glb')
  const scriptPath = path.join(root, 'create-provider-fixture.py')
  fs.writeFileSync(scriptPath, `
import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

def material(name, color, metallic=0.0, roughness=0.45):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.metallic = metallic
    value.roughness = roughness
    return value

body_material = material("Bottle Glass", (0.08, 0.32, 0.55), 0.15, 0.2)
label_material = material("Bottle Label", (0.9, 0.22, 0.12), 0.0, 0.5)
cap_material = material("Bottle Cap", (0.08, 0.09, 0.12), 0.7, 0.25)

bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.52, depth=1.45, location=(0.0, 0.0, 0.725))
body = bpy.context.active_object
body.name = "Provider Bottle Body"
body.data.materials.append(body_material)
bpy.ops.object.shade_smooth()

bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.535, depth=0.36, location=(0.0, 0.0, 0.78))
label = bpy.context.active_object
label.name = "Provider Bottle Label"
label.data.materials.append(label_material)
bpy.ops.object.shade_smooth()

bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.31, depth=0.28, location=(0.0, 0.0, 1.59))
cap = bpy.context.active_object
cap.name = "Provider Bottle Cap"
cap.data.materials.append(cap_material)
bpy.ops.object.shade_smooth()

bpy.ops.export_scene.gltf(filepath=${JSON.stringify(outputPath)}, export_format="GLB")
`, 'utf8')
  const run = spawnSync(blenderPath, ['--background', '--factory-startup', '--python', scriptPath], {
    encoding: 'utf8',
    timeout: 60_000,
  })
  expect(run.error).toBeUndefined()
  expect(run.status, `${run.stderr}\n${run.stdout}`).toBe(0)
  return outputPath
}

function runBridge(input: {
  root: string
  jobId: string
  plan: unknown
  existingBlendPath?: string
  assets?: Array<{ id: string; path: string }>
}): ReturnType<typeof parseVibingDirectorBridgeOutput> {
  const outputDir = path.join(input.root, input.jobId)
  const planPath = path.join(input.root, `${input.jobId}.json`)
  const scriptPath = path.join(input.root, 'apply-director.py')
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(planPath, JSON.stringify({
    jobId: input.jobId,
    plan: input.plan,
    assets: input.assets ?? [],
  }), 'utf8')
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

    expect(first.previewCamera).toEqual(expect.objectContaining({
      framing: 'all',
      aspectRatio: '16:9',
    }))
    expect(first.previewCamera?.lookAt[0]).toBeCloseTo(-1, 1)
    expect(first.previewCamera?.lookAt[1]).toBeGreaterThan(0.2)

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
          { op: 'add_marker', id: 'chair-B', name: '椅子B', role: 'chair', position: [0, 0, -1.25], rotation: [0, 0, 0] },
          { op: 'add_marker', id: 'actor-B', name: '角色B', role: 'actor_seated', position: [0, 0, -1.25], rotation: [0, 0, 0] },
          { op: 'set_relation', id: 'cup-on-table', kind: 'support', subjectRef: 'cup-A', targetRef: 'table-main' },
          { op: 'set_relation', id: 'actors-distance', kind: 'distance', subjectRef: 'actor-A', targetRef: 'actor-B', distance: 2.5 },
          { op: 'set_relation', id: 'chair-A-follows-actor-A', kind: 'offset', subjectRef: 'chair-A', targetRef: 'actor-A' },
          { op: 'set_relation', id: 'chair-B-follows-actor-B', kind: 'offset', subjectRef: 'chair-B', targetRef: 'actor-B' },
          { op: 'set_relation', id: 'actors-facing', kind: 'facing', subjectRef: 'actor-A', targetRef: 'actor-B', mutual: true },
          { op: 'set_camera', framing: 'target', targetRef: 'actor-A' },
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
    expect(result.spatialReport).toEqual(expect.objectContaining({
      passed: true,
      checks: expect.arrayContaining([
        expect.objectContaining({ relationId: 'cup-on-table', status: 'passed' }),
        expect.objectContaining({ relationId: 'actors-distance', status: 'passed' }),
        expect.objectContaining({ relationId: 'chair-A-follows-actor-A', kind: 'offset', status: 'passed', rotationMeasured: 0 }),
        expect.objectContaining({ relationId: 'chair-B-follows-actor-B', kind: 'offset', status: 'passed', rotationMeasured: 0 }),
        expect.objectContaining({ relationId: 'actors-facing', status: 'passed' }),
      ]),
    }))
    expect(result.previewCamera).toEqual(expect.objectContaining({
      framing: 'target',
      targetRef: 'actor-A',
    }))

    const amended = runBridge({
      root,
      jobId: 'semantic-coffee-layout-amended',
      existingBlendPath: result.artifacts.blend,
      plan: {
        mode: 'amend',
        actions: [
          { op: 'move_object', objectRef: 'table-main', position: [1, 0, 0] },
          { op: 'move_object', objectRef: 'actor-B', position: [2, 0, -1.25] },
          { op: 'set_camera', framing: 'all' },
        ],
      },
    })
    const amendedInspect = spawnSync(blenderPath, [
      '--background', amended.artifacts.blend,
      '--python-expr',
      [
        'import bpy, math',
        "cup=next(o for o in bpy.data.objects if o.get('nomi_director_id')=='cup-A')",
        "a=next(o for o in bpy.data.objects if o.get('nomi_director_id')=='actor-A')",
        "b=next(o for o in bpy.data.objects if o.get('nomi_director_id')=='actor-B')",
        "chair=next(o for o in bpy.data.objects if o.get('nomi_director_id')=='chair-A')",
        "chair_b=next(o for o in bpy.data.objects if o.get('nomi_director_id')=='chair-B')",
        "print('NOMI_CUP=' + ','.join(str(round(v, 2)) for v in cup.location))",
        "print('NOMI_ACTOR_DISTANCE=' + str(round(math.hypot(a.location.x-b.location.x,a.location.y-b.location.y),2)))",
        "print('NOMI_CHAIR_ACTOR_DELTA=' + str(round((chair.location-a.location).length,4)))",
        "print('NOMI_CHAIR_B_ACTOR_B_DELTA=' + str(round((chair_b.location-b.location).length,4)))",
        "print('NOMI_CHAIR_A_YAW_DELTA=' + str(round(math.degrees(math.atan2(math.sin(chair.rotation_euler.z-a.rotation_euler.z),math.cos(chair.rotation_euler.z-a.rotation_euler.z))),3)))",
        "print('NOMI_CHAIR_B_YAW_DELTA=' + str(round(math.degrees(math.atan2(math.sin(chair_b.rotation_euler.z-b.rotation_euler.z),math.cos(chair_b.rotation_euler.z-b.rotation_euler.z))),3)))",
        'bpy.ops.wm.quit_blender()',
      ].join(';'),
    ], { encoding: 'utf8', timeout: 60_000 })
    expect(amendedInspect.status, amendedInspect.stderr).toBe(0)
    expect(amendedInspect.stdout).toContain('NOMI_CUP=0.62,-0.22,0.85')
    expect(amendedInspect.stdout).toContain('NOMI_ACTOR_DISTANCE=2.5')
    expect(amendedInspect.stdout).toContain('NOMI_CHAIR_ACTOR_DELTA=0.0')
    expect(amendedInspect.stdout).toContain('NOMI_CHAIR_B_ACTOR_B_DELTA=0.0')
    expect(amendedInspect.stdout).toContain('NOMI_CHAIR_A_YAW_DELTA=0.0')
    expect(amendedInspect.stdout).toContain('NOMI_CHAIR_B_YAW_DELTA=0.0')
    expect(amended.spatialReport?.passed).toBe(true)
    const returnedCup = amended.objectTransforms?.find((object) => object.id === 'cup-A')
    expect(returnedCup?.position[0]).toBeCloseTo(0.62, 2)
    expect(returnedCup?.position[1]).toBeCloseTo(0.85, 2)
    expect(returnedCup?.position[2]).toBeCloseTo(0.22, 2)
    const returnedActor = amended.objectTransforms?.find((object) => object.id === 'actor-A')
    const returnedChair = amended.objectTransforms?.find((object) => object.id === 'chair-A')
    const returnedActorB = amended.objectTransforms?.find((object) => object.id === 'actor-B')
    const returnedChairB = amended.objectTransforms?.find((object) => object.id === 'chair-B')
    expect(returnedChair?.position).toEqual(returnedActor?.position)
    expect(returnedChairB?.position).toEqual(returnedActorB?.position)
    expect(amended.previewCamera).toEqual(expect.objectContaining({ framing: 'all' }))

    const evidenceRoot = String(process.env.NOMI_REAL_BLENDER_EVIDENCE_DIR || '').trim()
    if (evidenceRoot) {
      const relationEvidenceRoot = path.join(evidenceRoot, 'relations')
      fs.mkdirSync(relationEvidenceRoot, { recursive: true })
      const artifacts = {
        preview: path.join(relationEvidenceRoot, 'preview.png'),
        blend: path.join(relationEvidenceRoot, 'scene.blend'),
        model: path.join(relationEvidenceRoot, 'scene.glb'),
      }
      fs.copyFileSync(amended.artifacts.preview, artifacts.preview)
      fs.copyFileSync(amended.artifacts.blend, artifacts.blend)
      fs.copyFileSync(amended.artifacts.model, artifacts.model)
      fs.writeFileSync(path.join(relationEvidenceRoot, 'report.json'), `${JSON.stringify({
        status: 'passed',
        blenderPath,
        scenario: 'persistent-coffee-conversation-relations',
        output: {
          preview: path.basename(artifacts.preview),
          blend: path.basename(artifacts.blend),
          model: path.basename(artifacts.model),
          validation: inspectGlb(fs.readFileSync(artifacts.model)),
        },
        spatialReport: amended.spatialReport,
        objectTransforms: amended.objectTransforms,
        previewCamera: amended.previewCamera,
      }, null, 2)}\n`)
    }
  }, 180_000)

  realIt('imports a validated GLB, preserves its transform, and amends the same editable blend', () => {
    const root = tempDir()
    const sourceGlb = createProviderLikeGlb(root)
    const sourceValidation = inspectGlb(fs.readFileSync(sourceGlb))
    expect(sourceValidation.meshCount).toBeGreaterThan(0)

    const first = runBridge({
      root,
      jobId: 'generated-model-import',
      assets: [{ id: 'generated-model', path: sourceGlb }],
      plan: {
        mode: 'replace',
        actions: [
          { op: 'set_stage', preset: 'studio' },
          {
            op: 'place_asset',
            id: 'generated-object',
            assetId: 'generated-model',
            name: 'Generated Product Bottle',
            position: [2, 0.5, -1],
            rotation: [0, 90, 0],
            scale: [0.75, 0.75, 0.75],
          },
          {
            op: 'set_camera',
            cameraRef: 'director-camera',
            position: [5, 2.4, 6],
            lookAt: [2, 1, -1],
            aspectRatio: '16:9',
          },
        ],
      },
    })

    expect(pngSize(first.artifacts.preview)).toEqual([960, 540])
    expect(inspectGlb(fs.readFileSync(first.artifacts.model)).meshCount).toBeGreaterThan(0)
    const firstInspect = spawnSync(blenderPath, [
      '--background', first.artifacts.blend,
      '--python-expr',
      [
        "import bpy",
        "o=next(o for o in bpy.data.objects if o.get('nomi_director_id')=='generated-object')",
        "print('NOMI_IMPORTED_LOCATION=' + ','.join(str(round(v, 2)) for v in o.location))",
        "print('NOMI_IMPORTED_SCALE=' + ','.join(str(round(v, 2)) for v in o.scale))",
        "print('NOMI_IMPORTED_MESHES=' + str(sum(1 for c in o.children_recursive if c.type=='MESH')))",
        'bpy.ops.wm.quit_blender()',
      ].join(';'),
    ], { encoding: 'utf8', timeout: 60_000 })
    expect(firstInspect.status, firstInspect.stderr).toBe(0)
    expect(firstInspect.stdout).toContain('NOMI_IMPORTED_LOCATION=2.0,1.0,0.5')
    expect(firstInspect.stdout).toContain('NOMI_IMPORTED_SCALE=0.75,0.75,0.75')
    expect(firstInspect.stdout).toMatch(/NOMI_IMPORTED_MESHES=[3-9]/)

    const second = runBridge({
      root,
      jobId: 'generated-model-amend',
      existingBlendPath: first.artifacts.blend,
      plan: {
        mode: 'amend',
        actions: [{
          op: 'move_object',
          objectRef: 'generated-object',
          position: [-1, 0, 2],
          rotation: [0, -45, 0],
          scale: [1, 1, 1],
        }],
      },
    })
    const secondInspect = spawnSync(blenderPath, [
      '--background', second.artifacts.blend,
      '--python-expr',
      [
        "import bpy",
        "o=next(o for o in bpy.data.objects if o.get('nomi_director_id')=='generated-object')",
        "print('NOMI_AMENDED_LOCATION=' + ','.join(str(round(v, 2)) for v in o.location))",
        "print('NOMI_AMENDED_SCALE=' + ','.join(str(round(v, 2)) for v in o.scale))",
        'bpy.ops.wm.quit_blender()',
      ].join(';'),
    ], { encoding: 'utf8', timeout: 60_000 })
    expect(secondInspect.status, secondInspect.stderr).toBe(0)
    expect(secondInspect.stdout).toContain('NOMI_AMENDED_LOCATION=-1.0,-2.0,0.0')
    expect(secondInspect.stdout).toContain('NOMI_AMENDED_SCALE=1.0,1.0,1.0')
    expect(second.previewCamera).toEqual(expect.objectContaining({
      framing: 'all',
      aspectRatio: '16:9',
    }))
    expect(second.previewCamera?.lookAt[0]).toBeCloseTo(-1, 1)
    expect(second.previewCamera?.lookAt[1]).toBeGreaterThan(0.2)
    expect(second.previewCamera?.lookAt[2]).toBeCloseTo(2, 1)

    const evidenceRoot = String(process.env.NOMI_REAL_BLENDER_EVIDENCE_DIR || '').trim()
    if (evidenceRoot) {
      const modelEvidenceRoot = path.join(evidenceRoot, 'model3d')
      fs.mkdirSync(modelEvidenceRoot, { recursive: true })
      const artifacts = {
        preview: path.join(modelEvidenceRoot, 'preview.png'),
        blend: path.join(modelEvidenceRoot, 'scene.blend'),
        model: path.join(modelEvidenceRoot, 'scene.glb'),
      }
      fs.copyFileSync(second.artifacts.preview, artifacts.preview)
      fs.copyFileSync(second.artifacts.blend, artifacts.blend)
      fs.copyFileSync(second.artifacts.model, artifacts.model)
      fs.writeFileSync(path.join(modelEvidenceRoot, 'report.json'), `${JSON.stringify({
        status: 'passed',
        blenderPath,
        source: {
          fileName: path.basename(sourceGlb),
          fixture: 'provider-like-multi-material-product',
          validation: sourceValidation,
        },
        output: {
          preview: path.basename(artifacts.preview),
          blend: path.basename(artifacts.blend),
          model: path.basename(artifacts.model),
          validation: inspectGlb(fs.readFileSync(artifacts.model)),
        },
        transformEvidence: {
          initialBlenderLocation: [2, 1, 0.5],
          initialScale: [0.75, 0.75, 0.75],
          amendedBlenderLocation: [-1, -2, 0],
          amendedScale: [1, 1, 1],
        },
        previewCamera: second.previewCamera,
      }, null, 2)}\n`)
    }
  }, 180_000)
})
