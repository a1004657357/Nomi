import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const gate = fileURLToPath(new URL('./check-fresh-base.mjs', import.meta.url))
const target = 'a1004657357/Nomi'
const upstream = 'aqm857886159/Nomi'
const url = repo => `https://github.com/${repo}.git`
const cleanEnv = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file' }
for (const key of ['GH_REPO', 'GITHUB_REPOSITORY', 'CI', 'GITHUB_ACTIONS', 'GITHUB_BASE_REF', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'BASE_REF', 'ROOT_CAUSE_BASE_REF', 'SELF_WRITTEN_BASE_REF', 'FRESH_BASE_REF']) delete cleanEnv[key]
const git = (cwd, args) => execFileSync('git', args, { cwd, env: cleanEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function fixture(t, remotes = [['origin', target]]) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-fresh-base-target-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  git(cwd, ['init', '--initial-branch=main'])
  git(cwd, ['config', 'user.name', 'Nomi Fixture'])
  git(cwd, ['config', 'user.email', 'fixture@example.invalid'])
  git(cwd, ['commit', '--allow-empty', '-m', 'base'])
  const base = git(cwd, ['rev-parse', 'HEAD'])
  for (const [remote, repo] of remotes) {
    git(cwd, ['remote', 'add', remote, url(repo)])
    git(cwd, ['update-ref', `refs/remotes/${remote}/main`, base])
  }
  git(cwd, ['switch', '-c', 'codex/fresh-base-fixture'])
  git(cwd, ['commit', '--allow-empty', '-m', 'task'])
  return { cwd, base }
}
function advance(f, remote) {
  const tree = git(f.cwd, ['rev-parse', 'HEAD^{tree}'])
  const commit = git(f.cwd, ['commit-tree', tree, '-p', f.base, '-m', 'target main advanced'])
  git(f.cwd, ['update-ref', `refs/remotes/${remote}/main`, commit])
  return commit
}
function run(f, env = {}, args = []) {
  const before = {
    config: fs.readFileSync(path.join(f.cwd, '.git/config'), 'utf8'),
    refs: git(f.cwd, ['for-each-ref', '--format=%(refname) %(objectname)']),
    head: git(f.cwd, ['rev-parse', 'HEAD']),
  }
  const result = spawnSync(process.execPath, [gate, ...args], { cwd: f.cwd, env: { ...cleanEnv, ...env }, encoding: 'utf8', timeout: 10_000 })
  assert.ifError(result.error)
  assert.equal(fs.readFileSync(path.join(f.cwd, '.git/config'), 'utf8'), before.config, 'gate must not edit remote config')
  assert.equal(git(f.cwd, ['for-each-ref', '--format=%(refname) %(objectname)']), before.refs, 'gate must not fetch, merge or update refs')
  assert.equal(git(f.cwd, ['rev-parse', 'HEAD']), before.head)
  return result
}
const output = result => result.stdout + result.stderr
const rejected = (result, pattern) => {
  assert.equal(result.status, 1, output(result))
  if (pattern) assert.match(output(result), pattern)
}

test('same-repository origin main remains accepted', t => {
  const f = fixture(t)
  const result = run(f, { GH_REPO: target })
  assert.equal(result.status, 0, output(result))
  assert.match(output(result), /origin\/main/)
})

test('a single remote can infer its repository without GH_REPO', t => {
  assert.equal(run(fixture(t)).status, 0)
})

test('GH_REPO selects fork/main instead of an unrelated newer official origin/main', t => {
  const f = fixture(t, [['origin', upstream], ['fork', target]])
  advance(f, 'origin')
  const result = run(f, { GH_REPO: target })
  assert.equal(result.status, 0, output(result))
  assert.match(output(result), /fork\/main/)
  assert.match(output(result), /a1004657357\/Nomi/)
})

test('a newer target main must reject stale HEAD even when origin/main is an ancestor and trees match', t => {
  const f = fixture(t, [['origin', upstream], ['fork', target]])
  const newer = advance(f, 'fork')
  assert.equal(git(f.cwd, ['rev-parse', `${newer}^{tree}`]), git(f.cwd, ['rev-parse', 'HEAD^{tree}']))
  rejected(run(f, { GH_REPO: target }), /fork\/main/)
})

test('CI=true cannot turn a stale branch into a pass', t => {
  const f = fixture(t)
  advance(f, 'origin')
  rejected(run(f, { GH_REPO: target, GITHUB_REPOSITORY: target, GITHUB_ACTIONS: 'true', CI: 'true' }), /origin\/main/)
})

test('normal same-repository GitHub checkout still passes using origin, without a CI skip', t => {
  const result = run(fixture(t), { GITHUB_REPOSITORY: target, GITHUB_ACTIONS: 'true', CI: 'true' })
  assert.equal(result.status, 0, output(result))
  assert.match(output(result), /origin\/main/)
  assert.doesNotMatch(output(result), /跳过|skipp/i)
})

test('wrong target repository cannot fall back to an ancestor origin/main', t => {
  rejected(run(fixture(t), { GH_REPO: 'someone/another-repository' }), /remote|仓库/)
})

test('missing fetch remote is rejected even if an orphan origin/main tracking ref exists', t => {
  const f = fixture(t, [])
  git(f.cwd, ['update-ref', 'refs/remotes/origin/main', f.base])
  rejected(run(f, { GH_REPO: target }), /remote/)
})

test('missing target main ref cannot use a local branch or another repository baseline', t => {
  const f = fixture(t, [['origin', upstream], ['fork', target]])
  git(f.cwd, ['update-ref', '-d', 'refs/remotes/fork/main'])
  git(f.cwd, ['update-ref', 'refs/heads/fork/main', f.base])
  rejected(run(f, { GH_REPO: target }), /fork\/main/)
})

test('a local branch shadow cannot hide a newer remote target main', t => {
  const f = fixture(t, [['origin', upstream], ['fork', target]])
  advance(f, 'fork')
  git(f.cwd, ['update-ref', 'refs/heads/fork/main', f.base])
  rejected(run(f, { GH_REPO: target }), /fork\/main/)
})

test('different repository remotes require explicit target context', t => {
  rejected(run(fixture(t, [['origin', upstream], ['fork', target]])), /ambig|歧义|GH_REPO/i)
})

test('multiple matching aliases are ambiguous until a matching remote is explicit', t => {
  const f = fixture(t, [['origin', upstream], ['fork', target], ['mirror', target]])
  rejected(run(f, { GH_REPO: target }), /ambig|歧义/i)
  assert.equal(run(f, { GH_REPO: target }, ['--remote', 'fork', '--base', 'main']).status, 0)
})

test('an explicit remote must agree with repository context', t => {
  rejected(run(fixture(t, [['origin', upstream], ['fork', target]]), { GH_REPO: target }, ['--remote', 'origin']), /mismatch|匹配|仓库/i)
})

test('conflicting GH_REPO and GitHub repository context fail closed', t => {
  rejected(run(fixture(t, [['origin', upstream], ['fork', target]]), { GH_REPO: target, GITHUB_REPOSITORY: upstream }), /conflict|冲突/i)
})

test('a push URL cannot claim ownership of another repository fetch baseline', t => {
  const f = fixture(t, [['origin', upstream]])
  git(f.cwd, ['remote', 'set-url', '--push', 'origin', url(target)])
  rejected(run(f, { GH_REPO: target }), /remote|仓库/)
})

test('relative fetch paths are not GitHub identities even when they look like repository context', t => {
  const f = fixture(t)
  for (const localPath of [target, `github.com/${target}`]) {
    git(f.cwd, ['remote', 'set-url', 'origin', localPath])
    rejected(run(f, { GH_REPO: target }), /remote|仓库/)
    rejected(run(f), /remote|repository/i)
  }
})

test('multiple different fetch repositories on one remote are ambiguous', t => {
  const f = fixture(t)
  git(f.cwd, ['remote', 'set-url', '--add', 'origin', url(upstream)])
  rejected(run(f, { GH_REPO: target }), /ambig|歧义/i)
})

test('GitHub host-qualified context and SSH remote identity use the existing repository parser', t => {
  const f = fixture(t)
  git(f.cwd, ['remote', 'set-url', 'origin', 'git@github.com:A1004657357/nomi.git'])
  assert.equal(run(f, { GH_REPO: `github.com/${target}` }).status, 0)
})

test('arbitrary HEAD/old-ancestor environment refs cannot replace the real target main', t => {
  const f = fixture(t)
  advance(f, 'origin')
  rejected(run(f, { GH_REPO: target, BASE_REF: 'HEAD', ROOT_CAUSE_BASE_REF: f.base, SELF_WRITTEN_BASE_REF: f.base, FRESH_BASE_REF: f.base }), /origin\/main/)
})

test('the freshness gate does not accept a different branch, HEAD or an old SHA as main', t => {
  const f = fixture(t)
  for (const base of ['HEAD', f.base, 'other-branch']) rejected(run(f, { GH_REPO: target }, ['--base', base]), /main|base/i)
})

test('unsupported/missing CLI arguments and missing explicit remotes fail closed', t => {
  const f = fixture(t)
  rejected(run(f, { GH_REPO: target }, ['--remote']))
  rejected(run(f, { GH_REPO: target }, ['--remote', 'missing-remote']))
  rejected(run(f, { GH_REPO: target }, ['--expected-sha', f.base]))
})
