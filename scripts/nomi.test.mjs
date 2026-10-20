import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const cli = fileURLToPath(new URL('./nomi.mjs', import.meta.url))

describe('bare-bearer CLI boundary', () => {
  test.each(['add', 'connect', 'prompt', 'delete', 'generate'])('rejects canvas %s before contacting Nomi', (operation) => {
    const result = spawnSync(process.execPath, [cli, 'canvas', operation, 'project', 'node'], {
      cwd: path.dirname(cli), encoding: 'utf8',
    })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('未知命令')
  })

  test('does not expose the custom Director write through bare bearer', () => {
    const result = spawnSync(process.execPath, [cli, 'director', 'render', 'project', 'node'], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
  })
})
