// scripts/merge-preflight.mjs 的行为测试：四类判定、设计卡格子、独立验收、逃逸合同。
// 纯规则 + 真临时 Git + 隔离 gh 的实际 CLI；不访问网络或启动 App。
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as preflight from './merge-preflight.mjs'
import { gitNameStatus } from './lib/gitPaths.mjs'
import {
  checkDesignCard,
  checkEscapeContract,
  checkIndependentAcceptance,
  classifyChange,
  extractSection,
  implementationLine,
  isGrandfathered,
  renderReport,
} from './merge-preflight.mjs'

const FULL_CARD = [
  '## 设计卡',
  '线/负责人：线 A',
  '| ★1 用户怎么用 | 谁在什么时刻 | 当创作者批量生成时我想先看到总价以便决定 | 人工 |',
  '| ★2 谁说了算 | 状态归谁 | 生成批次归 production.run 主进程 owner | door-map |',
  '| ★3 一致与复用 | 同类别处 | 复用 spendCard，没有第二份定义 | git grep |',
  '| ★4 全状态 | 每个状态 | 空 加载 成功 失败 取消中 各一句话 | 截图 |',
  '| 5 中途表 | 打断 | 关窗时不扣费，回执在账本 | 脚本 |',
  '| 6 外部数据与失败 | 外部来源 | 供应商返回异常时提示重试，不甩锅给 key | 文档 |',
  '| 7 性能预算 | 规模 | 不适用：本改动不碰渲染热路径 | 人工 |',
  '| 8 真实条件 | 条件 | Windows 英文界面最小窗口已跑 | 截图 |',
  '| ★9 验收与回滚 | 验收 | 另一条线跑 pnpm run test:core-smoke，回滚 revert 本提交 | 命令 |',
  '',
  '## 独立验收',
  '报告：https://example.com/report 验收线：线 B',
].join('\n')

test('四类判定：按路径命中花钱 / 长跑 / 可打断 / 新界面，普通改动不命中', () => {
  assert.deepEqual(classifyChange([{ path: 'electron/productionRun/productionRunService.ts', status: 'M' }]).classes, ['长跑'])
  assert.ok(classifyChange([{ path: 'electron/generation/spendLedger.ts', status: 'M' }]).classes.includes('花钱'))
  assert.ok(classifyChange([{ path: 'src/workbench/ai/cancelGeneration.ts', status: 'M' }]).classes.includes('可打断'))
  assert.ok(classifyChange([{ path: 'src/workbench/NewPanel.tsx', status: 'A' }]).classes.includes('新界面'))
  assert.ok(classifyChange([{ path: 'src/design/tokens.ts', status: 'M' }]).classes.includes('新界面'))
  assert.ok(classifyChange([{ path: 'src/utils/format.ts', status: 'M' }], '+const c = new AbortController()').classes.includes('可打断'))
  assert.equal(classifyChange([{ path: 'src/utils/format.ts', status: 'M' }, { path: 'docs/x.md', status: 'M' }, { path: 'electron/productionRun/queue.test.ts', status: 'M' }]).fourClass, false)
})

test('设计卡：四类 9 格填全 → 过；缺格 → 红并指名；非四类只查 ★ 格', () => {
  assert.equal(checkDesignCard(FULL_CARD, { fourClass: true }).ok, true)
  const noFive = FULL_CARD.replace(/^\| 5 中途表.*$/m, '| 5 中途表 | 打断 |')
  const missing = checkDesignCard(noFive, { fourClass: true })
  assert.equal(missing.ok, false)
  assert.match(missing.lines.join('\n'), /缺格：5/)
  // 非四类：第 5 格空着也过，★ 格空着不过
  assert.equal(checkDesignCard(noFive, { fourClass: false }).ok, true)
  const noStar = FULL_CARD.replace(/^\| ★9 验收与回滚.*$/m, '')
  assert.match(checkDesignCard(noStar, { fourClass: false }).lines.join('\n'), /缺格：9/)
  assert.equal(checkDesignCard('## 做了什么\n随便', { fourClass: false }).ok, false)
})

test('设计卡：「不适用：理由」算填了，「不适用」不带理由不算', () => {
  const reasoned = FULL_CARD.replace(/^\| 7 性能预算.*$/m, '| 7 性能预算 | 规模 | 不适用：本改动不碰渲染热路径 | 人工 |')
  assert.equal(checkDesignCard(reasoned, { fourClass: true }).ok, true)
  const bare = FULL_CARD.replace(/^\| 7 性能预算.*$/m, '| 7 性能预算 | 不适用 |')
  assert.match(checkDesignCard(bare, { fourClass: true }).lines.join('\n'), /缺格：7/)
})

test('设计卡只放链接 → 不判红，提示人工到链接里核对', () => {
  const result = checkDesignCard('## 设计卡\ndocs/plan/2026-10-05-foo.md', { fourClass: true })
  assert.equal(result.ok, true)
  assert.match(result.lines.join('\n'), /人工到链接里核对/)
})

test('独立验收：要有报告链接和验收线编号，且不同于实现线', () => {
  assert.equal(checkIndependentAcceptance(FULL_CARD).ok, true)
  assert.equal(implementationLine(FULL_CARD), '线 A')
  const same = FULL_CARD.replace('线/负责人：线 A', '实现线：线B').replace('验收线：线 B', '验收线：线B')
  const sameResult = checkIndependentAcceptance(same)
  assert.equal(sameResult.ok, false)
  assert.match(sameResult.lines.join('\n'), /相同/)
  const noLink = FULL_CARD.replace('https://example.com/report', '见群里')
  assert.match(checkIndependentAcceptance(noLink).lines.join('\n'), /没有带报告链接/)
  assert.equal(checkIndependentAcceptance('## 设计卡\nx').ok, false)
})

test('逃逸合同：正文有逃逸信号时必须带含 detected_by 的合同', () => {
  const body = '修用户反馈的卡死\ndetected_by: user'
  assert.equal(checkEscapeContract(body, []).ok, false)
  assert.equal(checkEscapeContract(body, [{ file: 'docs/fixes/2026-10-05-x.root-cause.json' }]).ok, false)
  assert.equal(checkEscapeContract(body, [{ file: 'docs/fixes/2026-10-05-x.root-cause.json', detected_by: 'user' }]).ok, true)
  assert.equal(checkEscapeContract('普通重构', []).applicable, false)
})

test('报告：非四类只查 ★ 格；四类缺验收则结论红；扫描干净才写「扫描干净」', () => {
  const clean = renderReport({
    pr: 1,
    classification: classifyChange([{ path: 'src/utils/format.ts', status: 'M' }]),
    design: checkDesignCard(FULL_CARD, { fourClass: false }),
    acceptance: checkIndependentAcceptance(FULL_CARD),
    escape: checkEscapeContract('普通', []),
  })
  assert.equal(clean.blocked, false)
  assert.match(clean.text, /未命中，只查设计卡 ★ 格/)
  assert.match(clean.text, /扫描干净/)
  const four = classifyChange([{ path: 'electron/productionRun/productionRunService.ts', status: 'M' }])
  const noAcceptance = FULL_CARD.split('## 独立验收')[0]
  const blocked = renderReport({
    pr: 2,
    classification: four,
    design: checkDesignCard(noAcceptance, four),
    acceptance: checkIndependentAcceptance(noAcceptance),
    escape: checkEscapeContract('普通', []),
  })
  assert.equal(blocked.blocked, true)
  assert.match(blocked.text, /缺 `## 独立验收`/)
})

test('extractSection：取到下一个二级标题为止，HTML 注释不算内容', () => {
  const body = '## 设计卡\n<!-- 模板说明 -->\n内容\n## 验证\nx'
  assert.equal(extractSection(body, '设计卡'), '内容')
  assert.equal(extractSection(body, '独立验收'), null)
})

test('旧 PR（规则生效前开的）缺项只给警告、不判红；新 PR 照判', () => {
  assert.equal(isGrandfathered({ createdAt: '2026-10-02T10:00:00Z', effectiveAt: '2026-10-04T00:00:00Z' }), true)
  assert.equal(isGrandfathered({ createdAt: '2026-10-05T10:00:00Z', effectiveAt: '2026-10-04T00:00:00Z' }), false)
  assert.equal(isGrandfathered({ createdAt: '2026-10-05T10:00:00Z', effectiveAt: null }), false, '未知生效时间必须严格检查')
  const four = classifyChange([{ path: 'electron/productionRun/productionRunService.ts', status: 'M' }])
  const input = { pr: 947, classification: four, design: checkDesignCard('随便', four), acceptance: checkIndependentAcceptance('随便'), escape: checkEscapeContract('普通', []) }
  const old = renderReport({ ...input, grandfathered: true })
  assert.equal(old.blocked, false)
  assert.doesNotMatch(old.text, /✖/)
  assert.match(old.text, /⚠ PR 正文没有/)
  assert.equal(renderReport({ ...input, grandfathered: false }).blocked, true)
})

const TARGET_REPO = 'a1004657357/Nomi'
let fixture
test.before(() => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-preflight-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
    fs.writeFileSync(path.join(cwd, file), text)
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Preflight fixture')
  git('config', 'user.email', 'preflight@example.invalid')
  git('config', 'core.quotePath', 'true')
  write('src/utils/existing.ts', 'export const stable = 1\n')
  write('src/workbench/Existing.tsx', 'export const existing = 1\n')
  write('src/workbench/OldPanel.tsx', 'export const renamedPanel = "preserve the entire original source"\n')
  write('src/utils/removed.ts', 'export const removed = 1\n')
  const editedRenames = ['Alpha', 'Beta']
  for (const name of editedRenames) {
    write(`src/utils/Old${name}.ts`, Array.from({ length: 80 }, (_, i) => `export const ${name}${i} = ${i}\n`).join(''))
  }
  git('add', '--all')
  git('commit', '-m', 'shared ancestor')
  const ancestor = git('rev-parse', 'HEAD')
  git('checkout', '-b', 'pr-head')
  const addedPaths = Array.from({ length: 310 }, (_, i) => `docs/fillers/${i}.md`)
  addedPaths.push('src/workbench/New\nPanel.tsx', 'src/中文 file.ts', 'docs/fixes/fixture.root-cause.json')
  for (const file of addedPaths) write(file, file.endsWith('.json') ? '{"detected_by":"ci"}' : 'new content\n')
  write('src/utils/existing.ts', 'export const stable = 1\nexport const signal = new AbortController()\n')
  write('src/workbench/Existing.tsx', 'export const existing = 1\nexport const appended = 2\n')
  fs.renameSync(path.join(cwd, 'src/workbench/OldPanel.tsx'), path.join(cwd, 'src/workbench/Renamed\nPanel.tsx'))
  fs.unlinkSync(path.join(cwd, 'src/utils/removed.ts'))
  for (const name of editedRenames) {
    const old = path.join(cwd, `src/utils/Old${name}.ts`)
    write(`src/utils/New${name}.ts`, fs.readFileSync(old, 'utf8').replace('= 79', '= 999'))
    fs.unlinkSync(old)
  }
  git('add', '--all')
  git('commit', '-m', '322 raw paths with exact and edited renames')
  const head = git('rev-parse', 'HEAD')
  git('checkout', 'main')
  write('src/base-only.ts', 'export const baseOnly = true\n')
  git('add', '--all')
  git('commit', '-m', 'base advanced independently')
  const base = git('rev-parse', 'HEAD')
  // The checkout intentionally stays on base, not the PR head.
  const view = {
    number: 2, body: FULL_CARD, created_at: '2026-10-25T00:00:00Z',
    base: { sha: base, repo: { full_name: TARGET_REPO, name: 'Nomi', owner: { login: 'a1004657357' } } },
    head: { sha: head, repo: { full_name: 'contributor/Nomi', name: 'Nomi', owner: { login: 'contributor' } } },
    // Neither -M50% (319) nor -M100% (321), but a valid grouping of raw 322.
    changed_files: 320,
  }
  const emptyTree = execFileSync('git', ['mktree'], { cwd, input: '', encoding: 'utf8' }).trim()
  const unrelated = git('commit-tree', emptyTree, '-m', 'unrelated root')
  const blob = text => execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd, input: text, encoding: 'utf8' }).trim()
  const tree = text => execFileSync('git', ['mktree'], { cwd, input: text, encoding: 'utf8' }).trim()
  const missingBlob = blob('unavailable unchanged blob in both trees')
  const brokenBaseTree = tree(`100644 blob ${missingBlob}\tunchanged.bin\n100644 blob ${blob('before')}\tchanged.ts\n`)
  const brokenHeadTree = tree(`100644 blob ${missingBlob}\tunchanged.bin\n100644 blob ${blob('after')}\tchanged.ts\n`)
  const brokenBase = git('commit-tree', brokenBaseTree, '-p', ancestor, '-m', 'base with missing unchanged object')
  const brokenHead = git('commit-tree', brokenHeadTree, '-p', brokenBase, '-m', 'head with missing unchanged object')
  fs.unlinkSync(path.join(cwd, '.git/objects', missingBlob.slice(0, 2), missingBlob.slice(2)))
  const opaqueTree = tree(`100644 blob ${blob('\0const signal = AbortSignal.any([])\n++AbortSignal\n')}\topaque.data\n`)
  const opaqueHead = git('commit-tree', opaqueTree, '-p', ancestor, '-m', 'binary non-source-extension content')
  const absentTree = tree(`100644 blob ${blob('unique missing tree content')}\tabsent-tree.txt\n`)
  const absentTreeHead = git('commit-tree', absentTree, '-p', ancestor, '-m', 'missing tree object')
  fs.unlinkSync(path.join(cwd, '.git/objects', absentTree.slice(0, 2), absentTree.slice(2)))
  const ghFiles = addedPaths.map(file => ({ path: file, additions: 1, deletions: 0 }))
  ghFiles.push(
    { path: 'src/utils/existing.ts', additions: 1, deletions: 0 },
    { path: 'src/workbench/Existing.tsx', additions: 1, deletions: 0 },
    { path: 'src/workbench/Renamed\nPanel.tsx', additions: 0, deletions: 0 },
    { path: 'src/utils/removed.ts', additions: 0, deletions: 1 },
  )
  fixture = { cwd, view, ancestor, unrelated, ghFiles, brokenBase, brokenHead, missingBlob, opaqueHead, absentTreeHead }
})
test.after(() => { if (fixture) fs.rmSync(fixture.cwd, { recursive: true, force: true }) })

function runCliFixture({ view = fixture.view, gitFault, extraEnv = {} } = {}) {
  const sourceRoot = path.dirname(fileURLToPath(import.meta.url))
  fs.mkdirSync(path.join(fixture.cwd, 'scripts/lib'), { recursive: true })
  fs.copyFileSync(path.join(sourceRoot, 'merge-preflight.mjs'), path.join(fixture.cwd, 'scripts/merge-preflight.mjs'))
  fs.copyFileSync(path.join(sourceRoot, 'lib/gitPaths.mjs'), path.join(fixture.cwd, 'scripts/lib/gitPaths.mjs'))
  const bin = path.join(fixture.cwd, 'fake-bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.rmSync(path.join(bin, 'git'), { force: true })
  const nativeGit = process.env.PATH.split(path.delimiter).map(dir => path.join(dir, 'git')).find(file => fs.existsSync(file))
  if (gitFault) fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env node
const {spawnSync} = require('node:child_process')
const fs = require('node:fs')
const args = process.argv.slice(2)
if (process.env.PREFLIGHT_GIT_FAULT === 'old-git-transport') delete process.env.GIT_NO_LAZY_FETCH
const result = spawnSync(process.env.PREFLIGHT_NATIVE_GIT, args, {input: fs.readFileSync(0)})
let out = result.stdout || Buffer.alloc(0)
if (args[0] === 'diff' && args.includes('--unified=0')) {
  if (process.env.PREFLIGHT_GIT_FAULT === 'patch-empty') out = Buffer.alloc(0)
  if (process.env.PREFLIGHT_GIT_FAULT === 'patch-error') process.exit(1)
  if (process.env.PREFLIGHT_GIT_FAULT === 'patch-body-empty') out = out.subarray(0, out.indexOf(Buffer.from([0, 0])) + 2)
  if (process.env.PREFLIGHT_GIT_FAULT === 'patch-identity') {
    const boundary = out.indexOf(Buffer.from([0, 0]))
    const meta = out.subarray(0, boundary).toString('utf8').split('\\0')
    meta[1] = 'invented/not-in-tree.ts'
    out = Buffer.concat([Buffer.from(meta.join('\\0')), out.subarray(boundary)])
  }
  if (process.env.PREFLIGHT_GIT_FAULT === 'patch-oid') {
    const text = out.toString('utf8')
    out = Buffer.from(text.replace(/(:[0-7]{6} [0-7]{6} )[a-f0-9]{40}/, '$1' + 'f'.repeat(40)))
  }
}
if (args[0] === 'diff' && args.includes('-G') && args.includes('--name-status')) {
  const parts = out.toString('utf8').split('\\0')
  if (process.env.PREFLIGHT_GIT_FAULT === 'candidate-dropped') parts.splice(0, 2)
  if (process.env.PREFLIGHT_GIT_FAULT === 'candidate-foreign') parts.splice(0, 0, 'A', 'invented/not-in-tree.ts')
  if (process.env.PREFLIGHT_GIT_FAULT === 'candidate-status') parts[0] = 'D'
  if (process.env.PREFLIGHT_GIT_FAULT === 'candidate-duplicate') parts.splice(0, 0, ...parts.slice(0, 2))
  out = Buffer.from(parts.join('\\0'))
}
if (args[0] === 'diff' && args.includes('--name-status')) {
  const parts = out.toString('utf8').split('\\0')
  if (process.env.PREFLIGHT_GIT_FAULT === 'path-replaced') parts[1] = 'invented/not-in-tree.ts'
  if (process.env.PREFLIGHT_GIT_FAULT === 'path-dropped') parts.splice(0, 2)
  if (process.env.PREFLIGHT_GIT_FAULT === 'path-duplicate') parts[3] = parts[1]
  out = Buffer.from(parts.join('\\0'))
}
process.stdout.write(out)
process.stderr.write(result.stderr || '')
process.exit(result.status ?? 1)
`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('961') || args.some(arg => arg.endsWith('/pulls/961'))) {
  console.error('GraphQL: Could not resolve PullRequest #961'); process.exit(1)
}
if (args[0] === 'pr' && args[1] === 'diff') {
  console.error('HTTP 406: diff exceeds 300 files'); process.exit(1)
}
if (args[0] === 'api' || (args[0] === 'pr' && args[1] === 'view')) {
  console.log(process.env.PREFLIGHT_PR_JSON); process.exit(0)
}
process.exit(2)
`, { mode: 0o755 })
  const result = spawnSync(process.execPath, ['scripts/merge-preflight.mjs', '2', '--repo', TARGET_REPO], {
    cwd: fixture.cwd, encoding: 'utf8',
    env: { ...process.env, ...extraEnv, PATH: `${bin}${path.delimiter}${extraEnv.PATH || process.env.PATH}`, PREFLIGHT_NATIVE_GIT: nativeGit,
      PREFLIGHT_GIT_FAULT: gitFault || '', PREFLIGHT_PR_JSON: JSON.stringify({
      ...view, files: fixture.ghFiles,
      headRefOid: view.head.sha, createdAt: view.created_at,
    }) },
  })
  return result
}

test('真实 CLI：HTTP406 清空 diff + missing #961，保留 files 仍必须阻断', () => {
  const result = runCliFixture({ view: { ...fixture.view, body: '旧实现会因未知规则时间放过这份空卡' } })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /四类：命中/)
  assert.match(result.stdout, /可打断/)
  assert.doesNotMatch(result.stdout, /扫描干净|之前开的 PR/)
})

function runPreflight({ view = fixture.view, policy = '2026-10-04T00:00:00Z', metadataError, cwd = fixture.cwd } = {}) {
  // Before implementation this guard fails without ever running the real gh CLI.
  assert.equal(typeof preflight.readPullRequestChanges, 'function')
  const logs = []
  const errors = []
  const calls = []
  const code = preflight.main(['2', '--repo', TARGET_REPO], {
    cwd,
    log: (text) => logs.push(text), error: (text) => errors.push(text),
    runGh: (args) => {
      calls.push(args)
      if (args[0] === 'api' && args[1] === `repos/${TARGET_REPO}/pulls/2`) {
        if (metadataError) throw metadataError
        return JSON.stringify(view)
      }
      if (args[0] === 'api' && args[1] === `repos/${TARGET_REPO}/pulls/961`) {
        if (policy instanceof Error) throw policy
        return JSON.stringify({ number: 961, merged_at: policy })
      }
      throw new Error('HTTP 406: diff exceeds 300 files; no unbound diff fallback is allowed')
    },
  })
  return { code, text: logs.join('\n'), errors: errors.join('\n'), calls }
}

test('真实 322 路径完整 Git 三点 diff：NUL 路径、保留 rename 双端 A/D，绑定 SHA 而非 HEAD', () => {
  assert.equal(typeof preflight.readPullRequestChanges, 'function')
  const result = preflight.readPullRequestChanges(fixture.view, { cwd: fixture.cwd })
  assert.equal(result.files.length, 322)
  assert.equal(result.files.find(x => x.path === 'src/workbench/New\nPanel.tsx').status, 'A')
  assert.equal(result.files.find(x => x.path === 'src/workbench/Renamed\nPanel.tsx').status, 'A')
  assert.equal(result.files.find(x => x.path === 'src/workbench/OldPanel.tsx').status, 'D')
  assert.equal(result.files.find(x => x.path === 'src/workbench/Existing.tsx').status, 'M')
  assert.equal(result.files.find(x => x.path === 'src/utils/removed.ts').status, 'D')
  assert.ok(result.files.some(x => x.path === 'src/中文 file.ts'))
  assert.ok(!result.files.some(x => x.path === 'src/base-only.ts'))
  assert.match(result.addedLines, /new AbortController/)
  assert.deepEqual(classifyChange(result.files, result.addedLines).classes.sort(), ['可打断', '新界面'].sort())
})

test('大 PR 不依赖 gh diff 或截断 files；缺独立验收必须红', () => {
  const result = runPreflight({ view: { ...fixture.view, files: [], body: FULL_CARD.split('## 独立验收')[0] } })
  assert.equal(result.code, 1)
  assert.match(result.text, /四类：命中/)
  assert.match(result.text, /缺 `## 独立验收`/)
  assert.ok(result.calls.every(args => args[0] === 'api'))
})

test('missing policy anchor/未合并/损坏日期：严格检查，不得转成旧 PR clean', async t => {
  for (const policy of [new Error('GraphQL: Could not resolve PullRequest #961'), null, '', 'invalid-date']) {
    await t.test(String(policy), () => {
      const result = runPreflight({ view: { ...fixture.view, body: '缺少设计卡' }, policy })
      assert.notEqual(result.code, 0)
      assert.match(result.text, /严格/)
      assert.doesNotMatch(result.text, /之前开的 PR|扫描干净/)
    })
  }
})

test('时间未知不影响已满足严格规则的 PR；可证明旧 PR 保留兼容', () => {
  const strict = runPreflight({ policy: new Error('HTTP 404') })
  assert.equal(strict.code, 0)
  assert.match(strict.text, /严格/)
  assert.doesNotMatch(strict.text, /之前开的 PR/)
  const legacy = runPreflight({ view: { ...fixture.view, created_at: '2026-10-01T00:00:00Z', body: '旧模板' } })
  assert.equal(legacy.code, 0)
  assert.match(legacy.text, /之前开的 PR/)
})

test('逃逸合同从绑定的 head SHA 读取，不读当前 checkout 或猜 head 仓库', () => {
  const result = runPreflight({ view: { ...fixture.view, body: `${FULL_CARD}\n用户反馈：需要保留根因合同` } })
  assert.equal(result.code, 0)
  assert.match(result.text, /带了含 detected_by 的合同/)
})

test('元数据异常、缺/无效 SHA、缺对象、无共同祖先及文件数不符均不得分类假绿', async t => {
  const mutations = [
    { base: undefined }, { head: undefined },
    { base: { ...fixture.view.base, sha: undefined } },
    { head: { ...fixture.view.head, sha: 'HEAD' } },
    { head: { ...fixture.view.head, sha: 'f'.repeat(40) } },
    { head: { ...fixture.view.head, sha: fixture.unrelated }, changed_files: 0 },
    { changed_files: 323 }, { changed_files: 317 }, { changed_files: undefined },
    { number: 3 }, { base: { ...fixture.view.base, repo: { full_name: 'wrong/repo' } } },
    { head: { ...fixture.view.head, repo: undefined } },
    { head: { ...fixture.view.head, repo: { ...fixture.view.head.repo, full_name: 'other/Nomi' } } },
    { base: { ...fixture.view.base, repo: { ...fixture.view.base.repo, owner: { login: 'other' } } } },
  ]
  for (const [i, mutation] of mutations.entries()) {
    await t.test(`invalid metadata ${i + 1}`, () => {
      const result = runPreflight({ view: { ...fixture.view, ...mutation, created_at: '2026-10-01T00:00:00Z' } })
      assert.notEqual(result.code, 0)
      assert.match(result.errors, /无法|失败|缺少|不匹配|无效|完整/)
      assert.doesNotMatch(result.text, /四类：未命中|扫描干净/)
    })
  }
  const error = runPreflight({ metadataError: new Error('HTTP 503: unavailable') })
  assert.notEqual(error.code, 0)
  assert.doesNotMatch(error.text, /扫描干净|四类/)
})

test('不同合法 rename 分组计数接受；两套 native 算法不决定 GitHub 阈值', () => {
  const options = { cwd: fixture.cwd, encoding: 'utf8' }
  const range = `${fixture.view.base.sha}...${fixture.view.head.sha}`
  for (const [mode, expected] of [['-M50%', 319], ['-M100%', 321], ['--no-renames', 322]]) {
    const records = execFileSync('git', ['diff', '--name-status', '-z', mode, range], options).split('\0').filter(Boolean)
    let count = 0
    for (let i = 0; i < records.length;) { const status = records[i]; i += /^R/.test(status) ? 3 : 2; count += 1 }
    assert.equal(count, expected)
  }
  // A=316, D=4, M=2 => complete raw=322, valid grouping interval=[318,322].
  for (const changed_files of [318, 319, 320, 321, 322]) {
    const result = preflight.readPullRequestChanges({ ...fixture.view, changed_files }, { cwd: fixture.cwd })
    assert.equal(result.files.length, 322)
    assert.deepEqual(result.counts, { rawTotal: 322, added: 316, deleted: 4, min: 318, max: 322, reported: changed_files })
  }
})

test('缺少未变化 blob 也不能仅凭成功 patch 放行', () => {
  const result = runPreflight({ view: { ...fixture.view,
    base: { ...fixture.view.base, sha: fixture.brokenBase },
    head: { ...fixture.view.head, sha: fixture.brokenHead }, changed_files: 1,
  } })
  assert.notEqual(result.code, 0)
  assert.match(result.errors, /对象|完整/)
  assert.doesNotMatch(result.text, /扫描干净/)
})

test('丢 patch/原生命令失败/漏路径/相同条数替换路径/重复路径全部拒绝', async t => {
  for (const gitFault of ['patch-empty', 'patch-error', 'path-dropped', 'path-replaced', 'path-duplicate']) {
    await t.test(gitFault, () => {
      const result = runCliFixture({ gitFault })
      assert.equal(result.status, 2, result.stdout + result.stderr)
      assert.match(result.stderr, /无法|完整|失败/)
      assert.doesNotMatch(result.stdout, /扫描干净/)
    })
  }
})

test('gitattributes binary 标记及任意后缀 binary blob 都不能隐藏新增取消文本', t => {
  const attrs = path.join(fixture.cwd, '.gitattributes')
  fs.writeFileSync(attrs, 'src/utils/existing.ts -diff\n')
  t.after(() => fs.rmSync(attrs, { force: true }))
  const marked = preflight.readPullRequestChanges({ ...fixture.view, changed_files: 319 }, { cwd: fixture.cwd })
  assert.match(marked.addedLines, /new AbortController/)
  const opaque = preflight.readPullRequestChanges({ ...fixture.view,
    base: { ...fixture.view.base, sha: fixture.ancestor },
    head: { ...fixture.view.head, sha: fixture.opaqueHead }, changed_files: 7,
  }, { cwd: fixture.cwd })
  assert.match(opaque.addedLines, /AbortSignal/)
  assert.ok(opaque.addedLines.split('\n').includes('++AbortSignal'), 'keep raw source ++, strip only the native diff indicator')
  assert.deepEqual(classifyChange(opaque.files, opaque.addedLines).classes, ['可打断'])
})

test('非空 raw tree 允许空 cancellation patch；候选清单/身份/状态/patch 不一致仍拒绝', async t => {
  const empty = preflight.readPullRequestChanges({ ...fixture.view,
    base: { ...fixture.view.base, sha: fixture.ancestor },
    head: { ...fixture.view.head, sha: fixture.view.base.sha }, changed_files: 1,
  }, { cwd: fixture.cwd })
  assert.equal(empty.files.length, 1)
  assert.equal(empty.addedLines, '')
  assert.deepEqual(empty.cancellationPaths, [])
  for (const gitFault of ['candidate-dropped', 'candidate-foreign', 'candidate-status', 'candidate-duplicate', 'patch-body-empty', 'patch-identity', 'patch-oid']) {
    await t.test(gitFault, () => {
      const result = runCliFixture({ gitFault })
      assert.equal(result.status, 2, result.stdout + result.stderr)
      assert.match(result.stderr, /候选|patch|完整|身份/)
      assert.doesNotMatch(result.stdout, /扫描干净/)
    })
  }
})

test('65MiB 无关 binary 超原 buffer，原生 -G 只取任意后缀的跨行/++ 取消文本', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-preflight-large-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const git = (args, input) => execFileSync('git', args, {
    cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_ALLOW_PROTOCOL: '' },
  }).trim()
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Preflight fixture'])
  git(['config', 'user.email', 'preflight@example.invalid'])
  const emptyTree = git(['mktree'], '')
  const base = git(['commit-tree', emptyTree, '-m', 'empty base'])
  const payload = Buffer.alloc(1024 * 1024, 120)
  payload[0] = 0
  payload[payload.length - 1] = 10
  const binary = git(['hash-object', '-w', '--stdin'], payload)
  const code = git(['hash-object', '-w', '--stdin'], 'const controller = new\n  AbortController()\n++AbortSignal\n')
  const sourcePath = 'flow\nsource.data'
  const entries = Array.from({ length: 65 }, (_, i) => `100644 blob ${binary}\topaque-${i}.payload\0`)
  const makeHead = records => git(['commit-tree', git(['mktree', '-z'], records.join('')), '-p', base, '-m', 'generated blobs'])
  const head = makeHead([...entries, `100644 blob ${code}\t${sourcePath}\0`])
  const view = { ...fixture.view,
    base: { ...fixture.view.base, sha: base }, head: { ...fixture.view.head, sha: head }, changed_files: 66,
  }
  const outcome = run => { try { return { result: run() } } catch (error) { return { code: error.code || error.message } } }
  const baseline = outcome(() => execFileSync('git', ['diff', '--text', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--unified=0', `${base}...${head}`], {
    cwd, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_ALLOW_PROTOCOL: '' },
  }))
  assert.equal(baseline.code, 'ENOBUFS', 'real unfiltered patch must exceed the unchanged original limit')
  const filtered = outcome(() => preflight.readPullRequestChanges(view, { cwd }))
  assert.equal(filtered.code, undefined, `filtered patch failed: ${filtered.code}`)
  const result = filtered.result
  assert.equal(result.files.length, 66, 'all binary paths remain in complete raw classification')
  assert.deepEqual(result.cancellationPaths, [sourcePath])
  assert.match(result.addedLines, /new\n  AbortController/)
  assert.ok(result.addedLines.split('\n').includes('++AbortSignal'))
  assert.equal(classifyChange(result.files, result.addedLines).fourClass, true)
  const constructorOnly = git(['hash-object', '-w', '--stdin'], 'const controller = new\n  AbortController()\n')
  const crossLineHead = makeHead([`100644 blob ${constructorOnly}\t${sourcePath}\0`])
  const crossLineView = { ...view, head: { ...view.head, sha: crossLineHead }, changed_files: 1 }
  const crossLine = preflight.readPullRequestChanges(crossLineView, { cwd })
  assert.deepEqual(classifyChange(crossLine.files, crossLine.addedLines).classes, ['可打断'])
  const starOnly = FULL_CARD.replace(/^\| [5-8] .*\n/gm, '').split('## 独立验收')[0]
  const blocked = runPreflight({ cwd, view: { ...crossLineView, body: starOnly } })
  assert.equal(blocked.code, 1)
  assert.match(blocked.text, /四类：命中（可打断）/)
  assert.match(blocked.text, /缺格：5、6、7、8/)
  assert.match(blocked.text, /缺 `## 独立验收`/)
  assert.doesNotMatch(blocked.text, /扫描干净/)
  const accepted = runPreflight({ cwd, view: crossLineView })
  assert.equal(accepted.code, 0)
  assert.match(accepted.text, /设计卡：9 格都填了/)
  assert.match(accepted.text, /验收线 线 B ≠ 实现线 线 A/)
  const mention = git(['hash-object', '-w', '--stdin'], 'const constructorType = AbortController\n')
  const mentionHead = makeHead([`100644 blob ${mention}\t${sourcePath}\0`])
  const mentionOnly = preflight.readPullRequestChanges({ ...view, head: { ...view.head, sha: mentionHead }, changed_files: 1 }, { cwd })
  assert.deepEqual(mentionOnly.cancellationPaths, [sourcePath])
  assert.equal(classifyChange(mentionOnly.files, mentionOnly.addedLines).fourClass, false, '-G is only a superset, not the classifier')
  // A large relevant candidate must still hit the same cap, never truncate/pass.
  payload.write('AbortSignal', 1)
  const relevantBlob = git(['hash-object', '-w', '--stdin'], payload)
  const relevantHead = makeHead(entries.map(line => line.replace(binary, relevantBlob)))
  const capped = outcome(() => preflight.readPullRequestChanges({ ...view, head: { ...view.head, sha: relevantHead }, changed_files: 65 }, { cwd }))
  assert.equal(capped.code, 'ENOBUFS')
})

test('旧 Git 忽略 NO_LAZY_FETCH 时，缺对象仍零 transport；canonical helper 同样阻断', t => {
  const cwd = fixture.cwd
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  const bin = path.join(cwd, 'transport-bin')
  const marker = path.join(cwd, 'transport-invocations')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'git-remote-canary'), `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.PREFLIGHT_TRANSPORT_MARKER, 'invoked\\n')
process.exit(1)
`, { mode: 0o755 })
  const config = {
    'core.repositoryformatversion': '1', 'extensions.partialclone': 'fixture-promisor',
    'remote.fixture-promisor.url': 'canary::no-network',
    'remote.fixture-promisor.promisor': 'true', 'remote.fixture-promisor.partialclonefilter': 'blob:none',
    'protocol.canary.allow': 'always',
  }
  for (const [key, value] of Object.entries(config)) git('config', key, value)
  t.after(() => {
    for (const key of Object.keys(config)) spawnSync('git', ['config', '--unset-all', key], { cwd })
    git('config', 'core.repositoryformatversion', '0')
  })
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    PREFLIGHT_TRANSPORT_MARKER: marker, GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: undefined,
  }
  // Positive control uses only a local fake transport, never a network endpoint.
  const positive = spawnSync('git', ['cat-file', '-e', fixture.missingBlob], {
    cwd, env: { ...env, GIT_ALLOW_PROTOCOL: 'canary' }, encoding: 'utf8',
  })
  assert.notEqual(positive.status, 0)
  assert.ok(fs.existsSync(marker), 'the fake transport must detect an allowed implicit fetch')
  fs.unlinkSync(marker)
  const result = runCliFixture({ gitFault: 'old-git-transport', extraEnv: env, view: { ...fixture.view,
    base: { ...fixture.view.base, sha: fixture.brokenBase },
    head: { ...fixture.view.head, sha: fixture.brokenHead }, changed_files: 1,
  } })
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.equal(fs.existsSync(marker), false, 'preflight must never invoke the promisor transport')
  assert.throws(() => gitNameStatus(['diff', '--name-status', '--no-renames',
    `${fixture.ancestor}...${fixture.absentTreeHead}`], { cwd, env: { ...env, GIT_ALLOW_PROTOCOL: '' } }))
  assert.equal(fs.existsSync(marker), false, 'the shared NUL reader must also inherit the protocol block')
})

test('legacy 时间证据必须都有效且严格早于生效时间', () => {
  for (const [createdAt, effectiveAt] of [
    [undefined, '2026-10-04T00:00:00Z'], ['invalid', '2026-10-04T00:00:00Z'],
    ['2026-10-01T00:00:00Z', 'invalid'], ['2026-10-04T00:00:00Z', '2026-10-04T00:00:00Z'],
  ]) assert.equal(isGrandfathered({ createdAt, effectiveAt }), false)
})
