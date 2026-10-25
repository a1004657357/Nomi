import { execFileSync } from 'node:child_process'

import { gitPaths } from './lib/gitPaths.mjs'

// A long integration may add and remove a path that is absent from its net diff.
export function historicalRemovedPaths(baseRef, candidates, { cwd = process.cwd() } = {}) {
  const paths = [...new Set(candidates)]
  if (paths.length === 0) return []
  const commits = execFileSync('git', [
    'log', '--full-history', '-m', '--diff-filter=D', '--format=%H', `${baseRef}..HEAD`, '--', ...paths,
  ], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n').filter(Boolean)
  const expected = new Set(paths)
  const removed = new Set()
  for (const commit of new Set(commits)) {
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid Git deletion evidence commit')
    for (const file of gitPaths([
      'diff-tree', '-r', '-m', '--no-commit-id', '--no-renames', '--diff-filter=D', '--name-only', commit, '--', ...paths,
    ], { cwd })) {
      if (expected.has(file)) removed.add(file)
    }
  }
  return [...removed].sort()
}
