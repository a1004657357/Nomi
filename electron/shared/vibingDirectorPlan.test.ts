import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { applyVibingDirectorPlanParamsSchema, parseVibingDirectorPlanRequest, readVibingDirectorParamsSchema } from './vibingDirectorPlan'
import * as native from '../ai/vibingDirectorTools'
import { parseVibingDirectorPlanRequest as parseStructured } from '../../src/workbench/generationCanvas/nodes/vibingDirector/vibingDirectorStructuredProtocol'
import { toPublishedJsonSchema } from './agentCapabilities/modelVisibleJsonSchema'
import { directorProtocolSource } from './blenderDirectorProtocolText'

const request = (actions: unknown[]) => ({ directorNodeId: '导演原ID', summary: '保留用户原文', plan: { mode: 'amend', brief: '原始意图', actions } })
const actions = [
  { op: 'set_stage', preset: 'coffee_shop' },
  { op: 'set_blocking_layout', template: 'coffee_two_person_conversation', actorAName: '全景', actorBName: '角色 B' },
  { op: 'place_asset', id: 'asset-1', assetId: 'local.asset', name: '机位 1', position: [-1, 2, 3], rotation: [0, 90, 0], scale: [1, 1, 1] },
  { op: 'add_marker', id: 'actor-A', name: '中景', role: 'actor_seated', color: '#aBcD12' },
  { op: 'move_object', objectRef: 'actor-A', name: '原名', position: [1, 2, 3] },
  { op: 'remove_object', objectRef: 'asset-1' },
  { op: 'set_relation', id: 'relation-1', kind: 'distance', subjectRef: 'actor-A', targetRef: 'actor-B', distance: 2, mutual: true },
  { op: 'remove_relation', relationRef: 'relation-1' },
  { op: 'set_camera', cameraRef: 'director-camera', name: '全景', lookAt: [0, 1, 0], fov: 45, aspectRatio: '16:9', framing: 'target', targetRef: 'actor-A' },
  { op: 'set_camera_path', cameraRef: 'director-camera', points: [[1, 2, 3], [4, 5, 6]], durationSec: 3 },
  { op: 'set_beat', id: 'beat-1', title: '机位 1', action: '用户动作', cameraNote: '用户机位', dialogue: '用户对白', notes: '用户备注', durationSec: 4 },
]

describe('strict Director plan ownership characterization', () => {
  it('retains native export identity instead of a parallel parser or wire schema', () => {
    expect(native.parseVibingDirectorPlanRequest).toBe(parseVibingDirectorPlanRequest)
    expect(native.applyVibingDirectorPlanParamsSchema).toBe(applyVibingDirectorPlanParamsSchema)
    expect(native.readVibingDirectorParamsSchema).toBe(readVibingDirectorParamsSchema)
    expect(native.vibingDirectorToolNames).toEqual(['read_vibing_director', 'apply_vibing_director_plan'])
  })

  it('keeps the full neutral parser import closure process-free', () => {
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      for (const node of source.statements) {
        if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue
        if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue
        const specifier = node.moduleSpecifier.text
        if (!specifier.startsWith('.')) {
          expect(specifier).toBe('zod')
          continue
        }
        const target = path.resolve(path.dirname(file), `${specifier}.ts`)
        expect(target.startsWith(path.resolve('electron/shared') + path.sep), target).toBe(true)
        visit(target)
      }
    }
    visit(path.resolve('electron/shared/vibingDirectorPlan.ts'))
    expect(seen.size).toBe(3)
  })

  it('preserves all eleven operations, authored values, geometry and input bytes', () => {
    const input = request(actions)
    const before = JSON.stringify(input)
    expect(parseVibingDirectorPlanRequest(input)).toEqual(input)
    expect(parseStructured(input)).toEqual(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it.each([
    { op: 'move_object', objectRef: 'actor-A' },
    { op: 'set_camera' },
    { op: 'set_camera', framing: 'target' },
    { op: 'set_relation', id: 'r', kind: 'distance', subjectRef: 'a', targetRef: 'b' },
    { op: 'set_relation', id: 'r', kind: 'facing', subjectRef: 'a', targetRef: 'a' },
    { op: 'set_beat', id: 'beat' },
    { op: 'set_beat', id: 'beat', title: '' },
    { op: 'set_camera_path', points: [[0, 0, 0]], durationSec: 1 },
    { op: 'add_marker', id: 'a', name: 'A', position: [Infinity, 0, 0] },
    { op: 'place_asset', id: 'a', assetId: 'https://example.invalid/model.glb', name: 'A' },
    { op: 'place_asset', id: 'a', assetId: 'file:/model.glb', name: 'A' },
    { op: 'run_python', script: 'not executable' },
  ])('rejects malformed strict action $op without recovery', action => {
    expect(parseVibingDirectorPlanRequest(request([action]))).toBeNull()
  })

  it('does not import structured legacy recovery into strict native/display parsing', () => {
    const input = { directorNodeId: '导演原ID', summary: '旧计划', patches: [{ type: 'addBeat', id: 'beat', title: '原标题', dialogue: '原对白' }] }
    expect(parseVibingDirectorPlanRequest(input)).toBeNull()
    expect(parseStructured(input)?.plan.actions).toEqual([{ op: 'set_beat', id: 'beat', title: '原标题', dialogue: '原对白' }])
  })

  it('preserves stripping of unknown nested credentials and transport metadata', () => {
    const input = { ...request([{ ...actions[10], apiKey: 'SECRET' }]), apiKey: 'SECRET' }
    const before = JSON.stringify(input)
    expect(parseVibingDirectorPlanRequest(input)).toEqual(request([actions[10]]))
    expect(JSON.stringify(input)).toBe(before)
  })

  it('keeps the exact e102 flat wire fields, descriptions, bounds and order', () => {
    const wire = JSON.stringify([toPublishedJsonSchema(readVibingDirectorParamsSchema), toPublishedJsonSchema(applyVibingDirectorPlanParamsSchema)])
    expect(createHash('sha256').update(wire).digest('hex')).toBe('f28461a2dc39d496be87bc6ebee5c87852613abd19866b21d4b769b711af53d4')
    // The wire remains deliberately flat, but the strict parser is authoritative.
    const incomplete = request([{ op: 'set_beat', id: 'beat' }])
    expect(applyVibingDirectorPlanParamsSchema.safeParse(incomplete).success).toBe(true)
    expect(parseVibingDirectorPlanRequest(incomplete)).toBeNull()
  })

  it('keeps canonical validation messages byte-identical', () => {
    expect([
      directorProtocolSource.moveRequiresField(), directorProtocolSource.cameraRequiresField(),
      directorProtocolSource.cameraTargetRequired(), directorProtocolSource.distanceRequired(), directorProtocolSource.distinctObjectsRequired(),
    ]).toEqual([
      'move_object 至少需要一个要修改的字段', 'set_camera 至少需要一个要修改的字段', 'target 取景必须指定 targetRef',
      'distance 空间关系必须指定 distance', '空间关系不能引用同一个对象',
    ])
  })
})
