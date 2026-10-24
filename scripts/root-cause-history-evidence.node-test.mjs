import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { historicalRemovedPaths } from './root-cause-history-evidence.mjs'

test('integration history proves an added-then-removed path without inventing other removals', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-contract-history-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    git('init')
    git('config', 'user.name', 'Nomi fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    fs.writeFileSync(path.join(cwd, 'base.txt'), 'base\n')
    git('add', '.')
    git('commit', '-m', 'base')
    const base = git('rev-parse', 'HEAD')
    const removed = 'legacy with space\nand-unicode-测试.ts'
    fs.writeFileSync(path.join(cwd, removed), 'export const legacy = true\n')
    git('add', '.')
    git('commit', '-m', 'add legacy')
    fs.unlinkSync(path.join(cwd, removed))
    git('add', '-u')
    git('commit', '-m', 'remove legacy')
  assert.equal(git('diff', '-z', '--name-only', base, 'HEAD'), '')
    assert.deepEqual(historicalRemovedPaths(base, [removed, 'never-existed.ts', 'base.txt'], { cwd }), [removed])
    assert.deepEqual(historicalRemovedPaths('HEAD', [removed], { cwd }), [])
    assert.throws(() => historicalRemovedPaths('missing-base', [removed], { cwd }))
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
