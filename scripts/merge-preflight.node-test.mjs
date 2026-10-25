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
  git('add', '--all')
  git('commit', '-m', '317 changed files including unusual paths')
  const head = git('rev-parse', 'HEAD')
  git('checkout', 'main')
  write('src/base-only.ts', 'export const baseOnly = true\n')
  git('add', '--all')
  git('commit', '-m', 'base advanced independently')
  const base = git('rev-parse', 'HEAD')
  // The checkout intentionally stays on base, not the PR head.
  const view = {
    number: 2, body: FULL_CARD, created_at: '2026-10-25T00:00:00Z',
    base: { sha: base, repo: { full_name: TARGET_REPO } },
    head: { sha: head, repo: { full_name: 'contributor/Nomi' } },
    changed_files: addedPaths.length + 4,
  }
  const emptyTree = execFileSync('git', ['mktree'], { cwd, input: '', encoding: 'utf8' }).trim()
  const unrelated = git('commit-tree', emptyTree, '-m', 'unrelated root')
  const ghFiles = addedPaths.map(file => ({ path: file, additions: 1, deletions: 0 }))
  ghFiles.push(
    { path: 'src/utils/existing.ts', additions: 1, deletions: 0 },
    { path: 'src/workbench/Existing.tsx', additions: 1, deletions: 0 },
    { path: 'src/workbench/Renamed\nPanel.tsx', additions: 0, deletions: 0 },
    { path: 'src/utils/removed.ts', additions: 0, deletions: 1 },
  )
  fixture = { cwd, view, ancestor, unrelated, ghFiles }
})
test.after(() => { if (fixture) fs.rmSync(fixture.cwd, { recursive: true, force: true }) })

test('真实 CLI：HTTP406 清空 diff + missing #961，保留 files 仍必须阻断', () => {
  const sourceRoot = path.dirname(fileURLToPath(import.meta.url))
  fs.mkdirSync(path.join(fixture.cwd, 'scripts/lib'), { recursive: true })
  fs.copyFileSync(path.join(sourceRoot, 'merge-preflight.mjs'), path.join(fixture.cwd, 'scripts/merge-preflight.mjs'))
  fs.copyFileSync(path.join(sourceRoot, 'lib/gitPaths.mjs'), path.join(fixture.cwd, 'scripts/lib/gitPaths.mjs'))
  const bin = path.join(fixture.cwd, 'fake-bin')
  fs.mkdirSync(bin, { recursive: true })
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
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PREFLIGHT_PR_JSON: JSON.stringify({
      ...fixture.view, body: '旧实现会因未知规则时间放过这份空卡', files: fixture.ghFiles,
      headRefOid: fixture.view.head.sha, createdAt: fixture.view.created_at,
    }) },
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /四类：命中/)
  assert.match(result.stdout, /可打断/)
  assert.doesNotMatch(result.stdout, /扫描干净|之前开的 PR/)
})

function runPreflight({ view = fixture.view, policy = '2026-10-04T00:00:00Z', metadataError } = {}) {
  // Before implementation this guard fails without ever running the real gh CLI.
  assert.equal(typeof preflight.readPullRequestChanges, 'function')
  const logs = []
  const errors = []
  const calls = []
  const code = preflight.main(['2', '--repo', TARGET_REPO], {
    cwd: fixture.cwd,
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

test('真实 317 文件 Git 三点 diff：NUL 路径、重命名、准确状态，绑定 PR SHA 而非 HEAD', () => {
  assert.equal(typeof preflight.readPullRequestChanges, 'function')
  const result = preflight.readPullRequestChanges(fixture.view, { cwd: fixture.cwd })
  assert.equal(result.files.length, 317)
  assert.equal(result.files.find(x => x.path === 'src/workbench/New\nPanel.tsx').status, 'A')
  assert.match(result.files.find(x => x.path === 'src/workbench/Renamed\nPanel.tsx').status, /^R/)
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
    { changed_files: fixture.view.changed_files + 1 }, { changed_files: undefined },
    { number: 3 }, { base: { ...fixture.view.base, repo: { full_name: 'wrong/repo' } } },
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

test('legacy 时间证据必须都有效且严格早于生效时间', () => {
  for (const [createdAt, effectiveAt] of [
    [undefined, '2026-10-04T00:00:00Z'], ['invalid', '2026-10-04T00:00:00Z'],
    ['2026-10-01T00:00:00Z', 'invalid'], ['2026-10-04T00:00:00Z', '2026-10-04T00:00:00Z'],
  ]) assert.equal(isGrandfathered({ createdAt, effectiveAt }), false)
})
