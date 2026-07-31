import { describe, expect, it } from 'vitest'
import { buildProfileTaskResult } from '../tasks/profileTaskExecution'
import { RUNNINGHUB_3D_CURATED_MAPPINGS } from './runninghub3d'

const mapping = RUNNINGHUB_3D_CURATED_MAPPINGS.find(
  (candidate) => candidate.modelKey === 'hunyuan3d-v3.1' && candidate.taskKind === 'image_to_3d',
)!
const operation = mapping.query!

describe('RunningHub 3D query result', () => {
  it('selects the GLB result even when a preview image appears first', async () => {
    const normalized = await buildProfileTaskResult({
      response: {
        taskId: 'rh-task-1',
        status: 'SUCCESS',
        results: [
          { fileUrl: 'https://cdn.example/preview.png', fileType: 'png' },
          { fileUrl: 'https://cdn.example/model.glb', fileType: 'glb' },
        ],
      },
      mapping,
      operation,
      request: {
        kind: 'image_to_3d',
        prompt: '',
        extras: { modelKey: 'hunyuan3d-v3.1' },
      },
      taskIdFallback: 'fallback',
      wantedKind: 'model3d',
    })

    expect(normalized.result.assets).toEqual([
      {
        type: 'model3d',
        url: 'https://cdn.example/model.glb',
        thumbnailUrl: null,
      },
    ])
  })

  it('does not pass a preview image downstream as a model when no GLB exists', async () => {
    const normalized = await buildProfileTaskResult({
      response: {
        taskId: 'rh-task-2',
        status: 'SUCCESS',
        results: [{ fileUrl: 'https://cdn.example/preview.png', fileType: 'png' }],
      },
      mapping,
      operation,
      request: {
        kind: 'image_to_3d',
        prompt: '',
        extras: { modelKey: 'hunyuan3d-v3.1' },
      },
      taskIdFallback: 'fallback',
      wantedKind: 'model3d',
    })

    expect(normalized.result.assets).toEqual([])
  })
})
