import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildVibingDirectorBlenderArgs,
  parseVibingDirectorBridgeOutput,
  resolveVibingDirectorBlendPath,
  vibingDirectorAssetPath,
} from './vibingDirectorRunner'

describe('VIBING Director Blender runner', () => {
  it('starts a clean Blender scene for a first director plan and passes only file arguments', () => {
    const args = buildVibingDirectorBlenderArgs({
      scriptPath: '/tmp/apply-director.py',
      planPath: '/tmp/director-plan.json',
      outputDir: '/tmp/director-output',
    })

    expect(args).toEqual(expect.arrayContaining([
      '--background',
      '--factory-startup',
      '--python',
      '/tmp/apply-director.py',
      '--',
      '/tmp/director-plan.json',
      '/tmp/director-output',
    ]))
  })

  it('loads the last .blend for an amend plan instead of resetting Blender', () => {
    const existingBlendPath = '/tmp/project/.nomi/vibing-director/director-1/scene.blend'
    const args = buildVibingDirectorBlenderArgs({
      existingBlendPath,
      scriptPath: '/tmp/apply-director.py',
      planPath: '/tmp/director-plan.json',
      outputDir: '/tmp/director-output',
    })

    expect(args).toContain(existingBlendPath)
    expect(args).not.toContain('--factory-startup')
  })

  it('keeps imported model paths inside the project-scoped Director asset library', () => {
    const projectDir = '/tmp/project'
    const assetPath = vibingDirectorAssetPath(projectDir, 'director-1', {
      id: 'coffee-cup',
      fileName: 'coffee-cup.glb',
    })

    expect(assetPath).toBe(path.join(projectDir, '.nomi', 'vibing-director', 'director-1', 'assets', 'coffee-cup-coffee-cup.glb'))
    expect(() => vibingDirectorAssetPath(projectDir, '../../escape', { id: 'bad', fileName: '../escape.glb' })).toThrow(/安全/)
  })

  it('accepts only a successful bridge envelope with the three Blender artifacts', () => {
    const output = parseVibingDirectorBridgeOutput(JSON.stringify({
      ok: true,
      jobId: 'director-job-1',
      blenderVersion: '4.0.1',
      artifacts: {
        preview: '/tmp/director-output/preview.png',
        blend: '/tmp/director-output/scene.blend',
        model: '/tmp/director-output/scene.glb',
      },
    }))

    expect(output).toMatchObject({
      jobId: 'director-job-1',
      blenderVersion: '4.0.1',
      artifacts: { blend: '/tmp/director-output/scene.blend' },
    })
    expect(() => parseVibingDirectorBridgeOutput('{"ok":true,"jobId":"x","artifacts":{}}')).toThrow(/无效/)
  })

  it('finds the bridge JSON even when Blender appends a shutdown log after it', () => {
    const output = parseVibingDirectorBridgeOutput([
      'Blender 4.0.1',
      '{"ok":true,"jobId":"director-job-2","artifacts":{"preview":"/tmp/output/preview.png","blend":"/tmp/output/scene.blend","model":"/tmp/output/scene.glb"}}',
      'Blender quit',
    ].join('\n'))

    expect(output.jobId).toBe('director-job-2')
  })

  it('resolves only the current Director .blend inside its project directory', () => {
    const projectDir = '/tmp/project'
    const relativePath = '.nomi/vibing-director/director-1/exports/job-1/scene.blend'

    expect(resolveVibingDirectorBlendPath(projectDir, 'director-1', relativePath)).toBe(path.join(projectDir, relativePath))
    expect(() => resolveVibingDirectorBlendPath(projectDir, 'director-1', '../other.blend')).toThrow(/不在当前 Director/)
  })
})
