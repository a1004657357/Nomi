#!/usr/bin/env node
// 合并前扫描（协调会话的工具，2026-10-02）。输入 PR 号，用 gh 读 PR 正文和改动文件，只打印结论，**不合并**。
// 它取代原来的交工前评审收据：不再问「有没有跑过评审」，而是问两个暂停点有没有真的发生——
//   ① 暂停点①设计卡：PR 正文 `## 设计卡` 是否填全（四类 9 格，其余只查 ★ 格 1、2、3、4、9）；
//   ② 暂停点②独立验收：四类的 PR 正文 `## 独立验收` 是否带报告链接，且验收线编号不同于实现线；
//   ③ 修的是逃逸 bug 时，有没有带 detected_by 的根因合同。
// 判四类的字符串规则与设计卡模板末尾那段一致（docs/engineering/design-card.md），宁可多报；误报由协调会话人工划掉。
//
// 用法：node scripts/merge-preflight.mjs <PR 号> [--repo owner/name]
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gitNameStatus, splitNulPaths } from './lib/gitPaths.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GIT_MAX_BUFFER = 64 * 1024 * 1024
const gitEnvironment = () => ({
  ...process.env, GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1',
  GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1',
})

export const STAR_CELLS = [1, 2, 3, 4, 9]
export const ALL_CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const FOUR_CLASS_RULES = [
  { name: '花钱', pattern: /(?:^|\/)(?:spend[^/]*|[^/]*pricing[^/]*|[^/]*variant[^/]*|[^/]*credits[^/]*|[^/]*charge[^/]*|generationScheduler[^/]*)$/i, scope: /^(?:src|electron)\// },
  { name: '长跑', pattern: /(?:^|\/)[^/]*(?:task|queue|production|retriev|export|import)[^/]*$/i, scope: /^(?:src|electron)\// },
  { name: '可打断', pattern: /(?:^|\/)[^/]*(?:cancel|resume|stop|abort)[^/]*$/i, scope: /^(?:src|electron)\// },
]

const TEST_FILE = /\.(?:test|spec)\.[^.]+$|\.node-test\.[cm]?js$|(?:^|\/)(?:tests?|__tests__)\//
const CANCELLATION_SYMBOLS = { constructor: 'AbortController', signal: 'AbortSignal' }
const CANCELLATION_GIT_PATTERN = Object.values(CANCELLATION_SYMBOLS).join('|')
const CANCELLATION_ADDED_PATTERN = new RegExp(`\\bnew\\s+${CANCELLATION_SYMBOLS.constructor}\\b|\\b${CANCELLATION_SYMBOLS.signal}\\b`)

/** files: [{ path, status }]；addedLines: diff 里新增行的文本（用来认 AbortController）。 */
export function classifyChange(files, addedLines = '') {
  const hits = []
  for (const file of files) {
    const p = file.path
    if (TEST_FILE.test(p) || p.endsWith('.md') || p.endsWith('.json')) continue
    for (const rule of FOUR_CLASS_RULES) {
      if (rule.scope.test(p) && rule.pattern.test(p)) hits.push({ cls: rule.name, path: p })
    }
    if (/^src\/design\//.test(p)) hits.push({ cls: '新界面', path: p })
    if (/^src\/.*\.tsx$/s.test(p) && file.status === 'A') hits.push({ cls: '新界面', path: p })
  }
  if (CANCELLATION_ADDED_PATTERN.test(addedLines)) hits.push({ cls: '可打断', path: '(diff 新增 AbortController)' })
  const classes = [...new Set(hits.map((hit) => hit.cls))]
  return { fourClass: classes.length > 0, classes, hits }
}

/** 取 `## 标题` 到下一个同级标题之间的正文；没有这一节返回 null。 */
export function extractSection(body, heading) {
  const lines = String(body || '').split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`).test(line.trim()))
  if (start < 0) return null
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break
    out.push(line)
  }
  return out.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim()
}

const PLACEHOLDER = /^(?:待填|待定|tbd|todo|\.{2,}|…+|-+|n\/a)$/i

/** 在设计卡正文里找格 n（★n / n 开头的行或表格行），返回该格的内容（去掉标签）；找不到返回 null。 */
export function cellContent(section, n) {
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*|\\|\\s*)?(?:★\\s*)?${n}(?![0-9])[\\s.:：、|]*(.*)$`)
  for (const line of String(section || '').split(/\r?\n/)) {
    const match = pattern.exec(line)
    if (!match) continue
    // 表格行：把行内的格分隔去掉，最后一列之前的标题也算内容的一部分——只要标签之后有实质字符就算填了
    const rest = match[1].replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
    return rest
  }
  return null
}

/** 一格是否「填了」：标签之后除了问题标题还有实质内容，或明写「不适用：理由」。 */
export function cellFilled(content) {
  if (content === null) return false
  if (PLACEHOLDER.test(content)) return false
  const na = /不适用\s*[:：]\s*(\S.*)/.exec(content)
  if (na) return na[1].trim().length >= 2
  // 只有标签（如「用户怎么用」「谁说了算」）没有后文，不算填
  return content.replace(/^\S{1,8}\s*/, '').trim().length >= 6 || content.length >= 14
}

export function checkDesignCard(body, { fourClass }) {
  const section = extractSection(body, '设计卡')
  const required = fourClass ? ALL_CELLS : STAR_CELLS
  if (section === null) return { ok: false, lines: [`✖ PR 正文没有 \`## 设计卡\` 一节（${fourClass ? '四类，9 格' : '★ 格 1、2、3、4、9'}）`] }
  const link = /https?:\/\/\S+|docs\/\S+\.md/.exec(section)
  const missing = required.filter((n) => !cellFilled(cellContent(section, n)))
  if (missing.length === 0) return { ok: true, lines: [`✅ 设计卡：${required.length} 格都填了`] }
  if (link && missing.length === required.length) {
    return { ok: true, lines: [`⚠ 设计卡只放了链接（${link[0]}），格子内容要人工到链接里核对（${required.join('、')}）`] }
  }
  return { ok: false, lines: [`✖ 设计卡缺格：${missing.join('、')}（要求：${fourClass ? '四类 9 格全填' : '★ 格 1、2、3、4、9'}；确实不适用写「不适用：理由」）`] }
}

/** 实现线编号：设计卡里的「线/负责人：X」或正文里的「实现线：X」。 */
export function implementationLine(body) {
  const match = /(?:实现线|线\/负责人)\s*[:：]\s*([^，,；;|\r\n]+)/.exec(String(body || ''))
  return match ? match[1].trim() : null
}

export function checkIndependentAcceptance(body) {
  const section = extractSection(body, '独立验收')
  if (section === null) return { ok: false, lines: ['✖ 四类改动缺 `## 独立验收` 一节（报告链接 + 验收线编号）'] }
  const lines = []
  let ok = true
  if (!/https?:\/\/\S+|docs\/\S+\.md/.test(section)) {
    ok = false
    lines.push('✖ 独立验收没有带报告链接')
  }
  const verifier = /验收线\s*(?:编号)?\s*[:：]\s*([^，,；;|\r\n]+)/.exec(section)
  if (!verifier) {
    ok = false
    lines.push('✖ 独立验收没写验收线编号（格式：验收线：<编号>）')
  } else {
    const implementer = implementationLine(body)
    const verifierId = verifier[1].trim()
    if (!implementer) lines.push(`⚠ 验收线 ${verifierId}：正文里没找到实现线编号（设计卡「线/负责人」或「实现线：」），无法核对是否同一条，请人工核`)
    else if (implementer === verifierId) {
      ok = false
      lines.push(`✖ 验收线编号 ${verifierId} 和实现线相同——验收必须另一条线做`)
    } else lines.push(`✅ 验收线 ${verifierId} ≠ 实现线 ${implementer}`)
  }
  if (ok && lines.every((line) => !line.startsWith('✖'))) lines.unshift('✅ 独立验收：带报告链接和验收线编号')
  return { ok, lines }
}

const ESCAPE_SIGNAL = /detected_by\s*[:：]\s*["']?(?:user|post-release)|逃逸|用户反馈|发版后|post-release/i

/** contracts: [{ file, detected_by }]，来自本 PR 新增 / 改动的 docs/fixes/*.root-cause.json。 */
export function checkEscapeContract(body, contracts) {
  if (!ESCAPE_SIGNAL.test(String(body || ''))) return { applicable: false, ok: true, lines: ['· 未发现逃逸 bug 信号（正文没写 detected_by: user / post-release、逃逸、用户反馈、发版后），合同检查跳过'] }
  const withField = contracts.filter((contract) => ['user', 'post-release', 'walkthrough', 'ci', 'review'].includes(contract.detected_by))
  if (withField.length === 0) {
    return { applicable: true, ok: false, lines: ['✖ 看起来修的是逃逸 bug，但本 PR 没带含 detected_by 的根因合同（docs/fixes/*.root-cause.json）'] }
  }
  return { applicable: true, ok: true, lines: [`✅ 逃逸 bug：带了含 detected_by 的合同（${withField.map((contract) => contract.file).join('、')}）`] }
}

/**
 * 规则生效时刻 = 引入本套规则的 PR（#961）的合并时间。比它更早开的 PR（#947、#962 等）没有机会照新模板写，
 * 只给警告、不判红。参考 PR 不存在、未合并或时间无效时不能证明历史豁免，按严格规则检查。
 */
export const RULES_INTRODUCED_BY_PR = 961
export function isGrandfathered({ createdAt, effectiveAt }) {
  if (typeof createdAt !== 'string' || typeof effectiveAt !== 'string') return false
  const created = Date.parse(createdAt)
  const effective = Date.parse(effectiveAt)
  return Number.isFinite(created) && Number.isFinite(effective) && created < effective
}

export function renderReport({ pr, classification, design, acceptance, escape, grandfathered = false }) {
  const lines = [`合并前扫描 · PR #${pr}`]
  lines.push(classification.fourClass
    ? `· 四类：命中（${classification.classes.join('、')}）——${classification.hits.slice(0, 5).map((hit) => hit.path).join('、')}${classification.hits.length > 5 ? ' …' : ''}`
    : '· 四类：未命中，只查设计卡 ★ 格')
  const soften = (list) => (grandfathered ? list.map((line) => line.replace(/^✖/, '⚠')) : list)
  lines.push(...soften(design.lines))
  if (classification.fourClass) lines.push(...soften(acceptance.lines))
  lines.push(...soften(escape.lines))
  if (grandfathered) lines.push('· 这是规则生效（#961 合并）之前开的 PR：缺项只给警告，不判红')
  const blocked = !grandfathered && (!design.ok || (classification.fourClass && !acceptance.ok) || !escape.ok)
  lines.push(blocked ? '结论：✖ 有项没过，先别合（脚本只打印结论，不合并）' : '结论：✅ 扫描干净（脚本只打印结论，不合并；其余合并条件仍看 CI 与收据）')
  return { text: lines.join('\n'), blocked }
}

function gh(args) {
  return execFileSync('gh', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function git(args, cwd, input) {
  return execFileSync('git', args, {
    cwd, input, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER,
    env: gitEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function repositorySlug(repo) {
  const fullName = repo?.full_name
  if (typeof fullName !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(fullName)
    || typeof repo.name !== 'string' || typeof repo.owner?.login !== 'string'
    || `${repo.owner.login}/${repo.name}`.toLowerCase() !== fullName.toLowerCase()) {
    throw new Error('缺少或不匹配的 PR 双端 repo 身份元数据')
  }
  return fullName
}

function readCompleteTrees(commits, cwd) {
  const trees = new Map()
  const blobs = new Set()
  for (const commit of new Set(commits)) {
    const tree = new Map()
    for (const record of splitNulPaths(git(['ls-tree', '-r', '-z', '--full-tree', commit], cwd))) {
      const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(record)
      if (!match || tree.has(match[4]) || (match[2] === 'commit' && match[1] !== '160000')) {
        throw new Error('无法解析完整 Git tree 或路径重复')
      }
      tree.set(match[4], `${match[1]} ${match[2]} ${match[3]}`)
      // Gitlinks name another repository's commit, not a required local blob.
      if (match[2] === 'blob') blobs.add(match[3])
    }
    trees.set(commit, tree)
  }
  if (blobs.size) {
    const ids = [...blobs]
    const checked = git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], cwd, `${ids.join('\n')}\n`).trimEnd().split('\n')
    if (checked.length !== ids.length || checked.some((line, i) => line !== `${ids[i]} blob`)) {
      throw new Error('缺少或无效的 Git blob 对象，无法证明完整树')
    }
  }
  return trees
}

function readCancellationPatch({ range, options, files, before, after, cwd }) {
  const filtered = [...options, '-G', CANCELLATION_GIT_PATTERN]
  const candidates = gitNameStatus(['diff', ...filtered, '--name-status', range, '--'], {
    cwd, env: gitEnvironment(), maxBuffer: GIT_MAX_BUFFER,
  })
  const rawByPath = new Map(files.map(file => [file.path, file.status]))
  const candidateByPath = new Map(candidates.map(file => [file.path, file.status]))
  if (candidateByPath.size !== candidates.length || candidates.some(file => rawByPath.get(file.path) !== file.status)) {
    throw new Error('取消文本候选不是完整 raw 清单的唯一同状态子集')
  }
  // Native Git emits the NUL-safe raw identities and their patches together.
  // Successful bounded capture, not a hand-parsed filename header, owns the read.
  const output = git(['diff', ...filtered, '--patch-with-raw', '-z', '--no-abbrev',
    '--output-indicator-new=>', '--unified=0', range, '--'], cwd)
  if (!candidates.length) {
    if (output.length) throw new Error('空取消候选却返回非空 patch')
    return { addedLines: '', cancellationPaths: [] }
  }
  const boundary = output.indexOf('\0\0')
  if (boundary < 0 || !output.slice(boundary + 2).startsWith('diff --git ')) {
    throw new Error('取消候选缺少完整 raw 身份或 patch 正文')
  }
  const identities = splitNulPaths(output.slice(0, boundary + 1))
  const seen = new Set()
  for (let i = 0; i < identities.length; i += 2) {
    const match = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([ADMT])$/.exec(identities[i])
    const file = identities[i + 1]
    const old = before.get(file)?.split(' ') ?? ['000000', '', '0'.repeat(40)]
    const next = after.get(file)?.split(' ') ?? ['000000', '', '0'.repeat(40)]
    if (!match || seen.has(file) || candidateByPath.get(file) !== match[5]
      || match[1] !== old[0] || match[2] !== next[0] || match[3] !== old[2] || match[4] !== next[2]) {
      throw new Error('取消候选 raw 身份与完整 tree/候选清单不匹配')
    }
    seen.add(file)
  }
  if (seen.size !== candidates.length) throw new Error('取消候选 patch 清单不完整')
  const patch = output.slice(boundary + 2)
  const addedLines = patch.split('\n').filter(line => line.startsWith('>')).map(line => line.slice(1)).join('\n')
  return { addedLines, cancellationPaths: candidates.map(file => file.path) }
}

/** Exact immutable PR comparison; a missing local object is not an empty diff. */
export function readPullRequestChanges(view, { cwd = repoRoot } = {}) {
  const base = view.base?.sha
  const head = view.head?.sha
  if (![base, head].every(sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error('缺少或无效的 PR base/head SHA，无法完整检查')
  }
  if (!Number.isSafeInteger(view.changed_files) || view.changed_files < 0) {
    throw new Error('缺少或无效的 PR changed_files，无法核对完整性')
  }
  git(['cat-file', '-e', `${base}^{commit}`], cwd)
  git(['cat-file', '-e', `${head}^{commit}`], cwd)
  const ancestors = git(['merge-base', '--all', base, head], cwd).trim().split(/\s+/).filter(Boolean)
  if (ancestors.length !== 1) throw new Error('无法证明唯一 PR 共同祖先，不能完整检查')
  const mergeBase = ancestors[0]
  const trees = readCompleteTrees([base, head, mergeBase], cwd)
  const before = trees.get(mergeBase)
  const after = trees.get(head)
  const changedPaths = new Set([...before.keys(), ...after.keys()].filter(file => before.get(file) !== after.get(file)))
  const range = `${base}...${head}`
  const options = ['--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--text', '--submodule=short']
  const files = gitNameStatus(['diff', ...options, '--name-status', range, '--'], {
    cwd, env: gitEnvironment(), maxBuffer: GIT_MAX_BUFFER,
  })
  if (files.length !== changedPaths.size || new Set(files.map(file => file.path)).size !== files.length
    || files.some(file => !changedPaths.has(file.path) || (!before.has(file.path) ? file.status !== 'A'
      : !after.has(file.path) ? file.status !== 'D' : !['M', 'T'].includes(file.status)))) {
    throw new Error('PR 原始 diff 与完整 tree 变化路径不匹配、缺项或重复')
  }
  const added = files.filter(file => file.status === 'A').length
  const deleted = files.filter(file => file.status === 'D').length
  // Each rename can fold exactly one A/D pair; no similarity threshold is assumed.
  const counts = { rawTotal: files.length, added, deleted, min: files.length - Math.min(added, deleted), max: files.length, reported: view.changed_files }
  if (counts.reported < counts.min || counts.reported > counts.max) {
    throw new Error(`PR 展示计数超出可证 rename 分组范围：${counts.reported} 不在 [${counts.min},${counts.max}]`)
  }
  const { addedLines, cancellationPaths } = readCancellationPatch({ range, options, files, before, after, cwd })
  return { files, addedLines, cancellationPaths, counts, mergeBase }
}

export function main(argv = process.argv.slice(2), { cwd = repoRoot, runGh = gh, log = console.log, error = console.error } = {}) {
  const prArg = argv.find((arg) => /^\d+$/.test(arg))
  const repoIndex = argv.indexOf('--repo')
  const repo = repoIndex >= 0 ? argv[repoIndex + 1] : undefined
  if (!prArg) {
    error('用法：node scripts/merge-preflight.mjs <PR 号> [--repo owner/name]')
    return 2
  }
  try {
    const slug = repoIndex >= 0 ? repo : runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim()
    if (typeof slug !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(slug)) throw new Error('缺少或无效的目标仓库 owner/name')
    const view = JSON.parse(runGh(['api', `repos/${slug}/pulls/${prArg}`]))
    const baseRepo = repositorySlug(view.base?.repo)
    const headRepo = repositorySlug(view.head?.repo)
    if (view.number !== Number(prArg) || baseRepo.toLowerCase() !== slug.toLowerCase()) {
      throw new Error('PR 元数据与目标仓库或 PR 编号不匹配')
    }
    const { files, addedLines, cancellationPaths, counts, mergeBase } = readPullRequestChanges(view, { cwd })
    const classification = classifyChange(files, addedLines)
    const body = view.body ?? ''
    const contracts = []
    for (const file of files.filter(entry => entry.status !== 'D' && /^docs\/fixes\/.+\.root-cause\.json$/.test(entry.path))) {
      try {
        const text = git(['show', `${view.head.sha}:${file.path}`], cwd)
        contracts.push({ file: file.path, detected_by: JSON.parse(text).detected_by })
      } catch {
        contracts.push({ file: file.path, detected_by: undefined })
      }
    }

    let effectiveAt = null
    try {
      const policy = JSON.parse(runGh(['api', `repos/${slug}/pulls/${RULES_INTRODUCED_BY_PR}`]))
      if (policy.number === RULES_INTRODUCED_BY_PR) effectiveAt = policy.merged_at
    } catch {
      // Unknown policy history never grants a historical exemption.
    }
    log(`· PR 绑定：${slug} #${prArg} base=${baseRepo}@${view.base.sha} head=${headRepo}@${view.head.sha} merge-base=${mergeBase}`)
    log(`· 完整 tree/diff 原始路径 ${counts.rawTotal}（A=${counts.added},D=${counts.deleted}）；GitHub=${counts.reported}，rename 分组范围 [${counts.min},${counts.max}]`)
    log(`· 取消文本候选 ${cancellationPaths.length}；仅内容 patch 使用 -G 超集预筛，raw tree 不裁剪`)
    if (typeof effectiveAt !== 'string' || !Number.isFinite(Date.parse(effectiveAt))) {
      log(`⚠ 无法取得有效 #${RULES_INTRODUCED_BY_PR} 生效时间，按严格规则检查，不适用历史豁免`)
    }
    const report = renderReport({
      pr: prArg,
      grandfathered: Number(prArg) !== RULES_INTRODUCED_BY_PR && isGrandfathered({ createdAt: view.created_at, effectiveAt }),
      classification,
      design: checkDesignCard(body, classification),
      acceptance: checkIndependentAcceptance(body),
      escape: checkEscapeContract(body, contracts),
    })
    log(report.text)
    return report.blocked ? 1 : 0
  } catch (failure) {
    error(`✖ 合并前扫描失败，无法完成完整检查：${failure.message}`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
