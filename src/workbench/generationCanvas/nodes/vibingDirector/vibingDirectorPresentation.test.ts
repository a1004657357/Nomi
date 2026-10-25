import { describe, expect, it } from 'vitest'
import {
  formatVibingDirectorNodeStats,
  summarizeVibingDirectorSpatialReport,
} from './vibingDirectorPresentation'
import { createVibingDirectorState } from './vibingDirectorState'

describe('VIBING Director presentation', () => {
  it('includes persistent relations in the compact canvas-node summary', () => {
    const state = createVibingDirectorState()
    state.assets = [{
      id: 'asset-1',
      name: '咖啡桌',
      fileName: 'table.glb',
      format: 'glb',
      source: 'local',
      license: 'CC0',
      importedAt: 1,
    }]
    state.objects = [{
      id: 'actor-A',
      name: '角色A',
      kind: 'marker',
      role: 'actor_seated',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }]
    state.relations = [{
      id: 'actor-facing',
      kind: 'facing',
      subjectRef: 'actor-A',
      targetRef: 'actor-B',
    }]
    state.beats = [{
      id: 'beat-1',
      title: '开场',
      action: '',
      cameraNote: '',
      durationSec: 3,
    }]

    expect(formatVibingDirectorNodeStats(state)).toBe('1 资产 · 1 对象 · 1 关系 · 1 节拍')
  })

  it('summarizes passed, warning and failed spatial checks with actionable issues', () => {
    const summary = summarizeVibingDirectorSpatialReport({
      version: 1,
      passed: false,
      checks: [
        { relationId: 'cup-support', kind: 'support', status: 'passed', message: '咖啡杯已落在桌面。' },
        { relationId: 'actor-distance', kind: 'distance', status: 'warning', message: '人物距离偏差 0.08m。' },
        { relationId: 'actor-facing', kind: 'facing', status: 'failed', message: '角色A没有朝向角色B。' },
      ],
    })

    expect(summary).toEqual({
      status: 'failed',
      total: 3,
      passed: 1,
      warning: 1,
      failed: 1,
      label: '空间关系未通过',
      issues: [
        '人物距离偏差 0.08m。',
        '角色A没有朝向角色B。',
      ],
    })
  })

  it('reports an idle state before Blender has returned spatial evidence', () => {
    expect(summarizeVibingDirectorSpatialReport(undefined)).toEqual({
      status: 'idle',
      total: 0,
      passed: 0,
      warning: 0,
      failed: 0,
      label: '尚无空间检测',
      issues: [],
    })
  })
})
