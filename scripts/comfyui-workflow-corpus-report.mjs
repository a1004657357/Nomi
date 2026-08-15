// ComfyUI 工作流语料兼容性报告（可复跑）。
//
// 用**落 main 的真实实现**（electron/catalog/comfyuiWorkflowImport.ts +
// electron/comfyuiObjectInfo.ts）跑一大批真实 ComfyUI 官方模板，量化 Nomi 导入
// 分析器认得出多少、认不出的为什么、该怎么修。诚实报告：识别率低就直说。
//
// 前置（都由脚本外准备好，见报告开头）：
//   1) 真 ComfyUI 跑在 127.0.0.1:8188（提供 /object_info 做缺件对账 + 结构校验 oracle）
//   2) /tmp/comfy-api-converted.json —— scripts/comfyui-ui-to-api.py 把官方 UI 模板
//      转成「Export (API)」等价的 API 格式（官方模板包 100% 是 UI 格式，用户导入的却是
//      API 格式，故必须先复刻这步转换）。每条带 {file, ok, api, raw_format, uses_subgraph,…}。
//   3) /tmp/comfy-fidelity.json —— 把每张转换图提交真 /prompt，用服务器校验判定「转换是否
//      忠实」：accepted 或只报缺模型/缺文件 = 忠实；报 required_input_missing 等结构错 =
//      转换器对动态 widget 力有未逮（诚实剔除，不赖到 Nomi 头上）。
//
// 用法：node scripts/comfyui-ui-to-api.py <templates_dir> > /tmp/comfy-api-converted.json
//       （fidelity 步骤见报告脚本注释；或直接跑 run-corpus.sh 一条龙）
//       npx tsx scripts/comfyui-workflow-corpus-report.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const BASE = process.env.COMFY_BASE || 'http://127.0.0.1:8188'

// ── 被测的真实实现（纯函数，从 electron 源直接 import）──
const { parseComfyApiWorkflow, analyzeComfyWorkflow, buildImportedWorkflow, reconcileComfyWorkflow } =
  await import('../electron/catalog/comfyuiWorkflowImport.ts')
const { parseObjectInfoIndex } = await import('../electron/comfyuiObjectInfo.ts')

// ── 语料 + 忠实度判定 ──
const converted = JSON.parse(fs.readFileSync('/tmp/comfy-api-converted.json', 'utf8'))
const fidelity = await loadOrBuildFidelity(converted)
const fidelityByFile = new Map(fidelity.map((f) => [f.file, f]))

// 本机能力索引（缺件对账用）
const rawInfo = await (await fetch(`${BASE}/object_info`)).json()
const index = parseObjectInfoIndex(rawInfo)

// 忠实度门：把每张转换图提交真 /prompt，用服务器校验判定转换是否结构合法。
// accepted 或只报缺模型/文件 = 忠实；报 required_input_missing 等结构错 = 转换器
// 对动态 widget 力有未逮（诚实剔除）。结果缓存到 /tmp/comfy-fidelity.json 供复跑。
async function loadOrBuildFidelity(convItems) {
  const CACHE = '/tmp/comfy-fidelity.json'
  if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  const MODEL_ERRS = new Set(['value_not_in_list', 'custom_validation_failed', 'exception_during_validation'])
  const items = convItems.filter((c) => c.ok && c.api && Object.keys(c.api).length > 0)
  const results = []
  for (const c of items) {
    const rec = { file: c.file, api_named: c.is_api_named, uses_subgraph: c.uses_subgraph, node_count: Object.keys(c.api).length }
    try {
      const res = await fetch(`${BASE}/prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: c.api, client_id: 'corpus-fidelity' }),
      })
      if (res.ok) { rec.verdict = 'accepted'; rec.struct_errs = [] } else {
        const body = await res.json().catch(() => null)
        if (!body) { rec.verdict = 'non-json-400'; rec.struct_errs = ['?'] } else {
          const types = new Set()
          for (const err of Object.values(body.node_errors || {})) for (const x of err.errors || []) types.add(x.type)
          const s = [...types].filter((t) => !MODEL_ERRS.has(t)).sort()
          rec.struct_errs = s
          rec.verdict = s.length === 0 ? 'faithful' : 'converter-imperfect'
        }
      }
    } catch (ex) { rec.verdict = 'error'; rec.struct_errs = [String(ex).slice(0, 40)] }
    results.push(rec)
  }
  fs.writeFileSync(CACHE, JSON.stringify(results))
  return results
}

const out = []
const log = (s) => out.push(s)

log('# ComfyUI 工作流语料 · Nomi 导入分析器兼容性报告')
log('')
log(`> 生成时间：${new Date().toISOString()} · ComfyUI @ ${BASE} · 本机 /object_info 节点类 ${index.classNames.size} 个`)
log('')

// ── §0 语料规模 ──
const total = converted.length
const apiNamed = converted.filter((c) => c.is_api_named).length
const usesSubgraph = converted.filter((c) => c.uses_subgraph).length
log('## 0. 语料规模（ComfyUI 0.29 官方模板包全量）')
log('')
log('| 维度 | 数量 |')
log('|---|---|')
log(`| 官方模板总数（去掉 index/manifest/fuse_options 后） | ${total} |`)
log(`| 文件名带 \`api_\` 前缀（**用云端/付费 API 节点**，非「API 导出格式」） | ${apiNamed} |`)
log(`| 用 subgraph（节点 type 是 UUID，官方新模板大量用） | ${usesSubgraph} |`)
log(`| 原始格式为「UI 保存格式」（nodes[]/links[]） | ${converted.filter((c) => c.raw_format === 'ui').length} |`)
log(`| 原始格式为「API 格式」（node-id → class_type 映射） | ${converted.filter((c) => c.raw_format === 'api').length} |`)
log('')
log('**关键事实（贯穿全报告）**：官方模板包里 **0 张是 API 格式**——全是 UI 格式（哪怕 `api_*.json` 也是 UI 格式，`api_` 指「用云端节点」）。')
log('但 Nomi 导入器收的是用户从 ComfyUI 菜单「Export (API)」导出的 **API 格式**。所以：')
log('- **UI 原样粘贴** → 分析器应报「请导出 API 格式」（预期行为，见 §3，单独统计不算失败）。')
log('- 要测**分析器真本事**，必须先把 UI 模板转成 Export-API 等价的 API 格式（`scripts/comfyui-ui-to-api.py`，复刻前端 `graphToPrompt`：丢 bypass 节点、widget/link 对齐、subgraph 递归展平）。')
log('')

// ── §1 转换忠实度（诚实剔除转换器力有未逮的） ──
const okConv = converted.filter((c) => c.ok && c.api && Object.keys(c.api).length > 0)
const faithful = okConv.filter((c) => {
  const f = fidelityByFile.get(c.file)
  return f && (f.verdict === 'accepted' || f.verdict === 'faithful')
})
const imperfect = okConv.filter((c) => {
  const f = fidelityByFile.get(c.file)
  return f && f.verdict === 'converter-imperfect'
})
log('## 1. 转换忠实度门（用真 ComfyUI `/prompt` 校验做 oracle）')
log('')
log('把每张转换图提交真服务器：`accepted` 或**只报缺模型/缺文件** = 转换忠实；报 `required_input_missing`/`invalid_input_type` 等**结构错** = 转换器对**动态 widget**（`COMFY_DYNAMICCOMBO_V3`/`COMFY_AUTOGROW_V3`，选项会展开成子输入、`widgets_values` 错位）力有未逮。**这些诚实剔除**，不当作 Nomi 的锅。')
log('')
log('| 判定 | 数量 | 占比 |')
log('|---|---|---|')
log(`| ✅ 转换忠实（进 §2 真测分析器） | ${faithful.length} | ${Math.round((100 * faithful.length) / okConv.length)}% |`)
log(`| ⚠️ 转换器力有未逮（动态 widget，剔除不测） | ${imperfect.length} | ${Math.round((100 * imperfect.length) / okConv.length)}% |`)
log('')
log(`**忠实语料 = ${faithful.length} 张**（远超 30+ 目标），下面 §2 全部量化基于它——任何识别失败都是 Nomi 的、不是转换器的。`)
log('')

// ── §2 分析器真测（忠实语料）──
function runAnalyzer(api) {
  // 走用户真实路径：JSON.stringify(api) → parseComfyApiWorkflow → analyze → build
  const text = JSON.stringify(api)
  const graph = parseComfyApiWorkflow(text) // 忠实 API 图必过
  const analysis = analyzeComfyWorkflow(graph)
  const built = buildImportedWorkflow(graph, analysis.suggested)
  const rec = reconcileComfyWorkflow(graph, index)
  return { graph, analysis, built, rec }
}

const rows = []
for (const c of faithful) {
  let r
  try {
    r = runAnalyzer(c.api)
  } catch (e) {
    rows.push({ file: c.file, parseError: String(e).slice(0, 120), uses_subgraph: c.uses_subgraph })
    continue
  }
  const a = r.analysis
  const s = a.suggested
  rows.push({
    file: c.file,
    uses_subgraph: c.uses_subgraph,
    api_named: c.is_api_named,
    nodeCount: Object.keys(c.api).length,
    hasPrompt: Boolean(s.promptNodeId),
    promptClass: s.promptNodeId ? c.api[s.promptNodeId]?.class_type : null,
    hasFirstFrame: Boolean(s.firstFrameNodeId),
    hasOutput: Boolean(s.outputNodeId),
    outputClass: s.outputNodeId ? c.api[s.outputNodeId]?.class_type : null,
    outputKind: s.outputKind ?? null,
    numParams: (s.params ?? []).length,
    taskKind: r.built.taskKind,
    builtKind: r.built.kind,
    unknownNodeTypes: r.rec.unknownNodeTypes.length,
    missingModels: r.rec.missingEnumValues.length,
    // 分析出的原始类目（用于「为什么没认出」诊断）
    textInputCount: a.textInputs.length,
    outputNodeCount: a.outputNodes.length,
    imageInputCount: a.imageInputs.length,
  })
}

const analyzed = rows.filter((r) => !r.parseError)
const parseFailed = rows.filter((r) => r.parseError)
const promptOk = analyzed.filter((r) => r.hasPrompt).length
const outputOk = analyzed.filter((r) => r.hasOutput).length

log('## 2. 分析器识别率（忠实 API 语料，用户真实导入路径）')
log('')
log('| 指标 | 数 | 率 |')
log('|---|---|---|')
log(`| 忠实语料进测 | ${rows.length} | 100% |`)
log(`| \`parseComfyApiWorkflow\` 解析通过 | ${analyzed.length} | ${pct(analyzed.length, rows.length)} |`)
log(`| **识别出提示词节点**（可绑 {{request.prompt}}） | ${promptOk} | ${pct(promptOk, analyzed.length)} |`)
log(`| **识别出输出节点**（判成图/视频） | ${outputOk} | ${pct(outputOk, analyzed.length)} |`)
log(`| 识别出首帧输入（图生视频/图生图必需） | ${analyzed.filter((r) => r.hasFirstFrame).length} | ${pct(analyzed.filter((r) => r.hasFirstFrame).length, analyzed.length)} |`)
log('')

// taskKind 分布
const tkDist = tally(analyzed.map((r) => r.taskKind))
log('### taskKind 分布（buildImportedWorkflow 判定）')
log('')
log('| taskKind | 数量 |')
log('|---|---|')
for (const [k, v] of Object.entries(tkDist).sort((a, b) => b[1] - a[1])) log(`| \`${k}\` | ${v} |`)
log('')

// 输出 kind 分布
const okDist = tally(analyzed.map((r) => r.outputKind ?? '(无输出)'))
log('### 输出判定（图/视频）分布')
log('')
log('| outputKind | 数量 |')
log('|---|---|')
for (const [k, v] of Object.entries(okDist).sort((a, b) => b[1] - a[1])) log(`| ${k} | ${v} |`)
log('')

// 参数建议
const paramCounts = analyzed.map((r) => r.numParams)
const avgParams = paramCounts.length ? (paramCounts.reduce((a, b) => a + b, 0) / paramCounts.length).toFixed(1) : '0'
log(`### 参数建议：平均每张建议 **${avgParams}** 个可调参数（seed/steps/cfg/…）。0 参数的图：${analyzed.filter((r) => r.numParams === 0).length} 张。`)
log('')

// ── §3 缺件对账（打真 /object_info）──
const withUnknown = analyzed.filter((r) => r.unknownNodeTypes > 0).length
const withMissingModel = analyzed.filter((r) => r.missingModels > 0).length
log('## 3. 缺件对账（reconcileComfyWorkflow 打真本机 /object_info）')
log('')
log('（本机是**空 models 目录**的纯净 ComfyUI，故「缺模型」率会很高——这正是真实首跑场景：用户装了自定义节点却没下模型。）')
log('')
log('| 指标 | 数 | 率 |')
log('|---|---|---|')
log(`| 图里含**本机没装的节点类**（缺自定义节点包） | ${withUnknown} | ${pct(withUnknown, analyzed.length)} |`)
log(`| 图里含**本机没有的模型/文件名** | ${withMissingModel} | ${pct(withMissingModel, analyzed.length)} |`)
log('')

// ── §4 UI 格式拒绝路径（全 493 张原样 UI 粘贴）──
let uiRejectedCorrectly = 0
let uiParsedUnexpectedly = 0
const uiRejectExamples = []
for (const c of converted) {
  if (c.raw_format !== 'ui') continue
  // 找到原始 UI 文件重读（api 字段是转换后的；这里要测原样 UI 粘贴）
  const uiPath = findTemplate(c.file)
  if (!uiPath) continue
  const uiText = fs.readFileSync(uiPath, 'utf8')
  try {
    parseComfyApiWorkflow(uiText)
    uiParsedUnexpectedly += 1
  } catch (e) {
    const msg = String(e)
    if (msg.includes('界面保存') || msg.includes('Export (API)')) {
      uiRejectedCorrectly += 1
      if (uiRejectExamples.length < 1) uiRejectExamples.push(msg.replace(/^Error:\s*/, ''))
    } else {
      uiParsedUnexpectedly += 1 // 报了别的错（不是「请导出 API」）——算没对上
    }
  }
}
log('## 4. UI 格式拒绝路径（用户直接粘贴 UI 保存格式——最常见误操作）')
log('')
log('| 指标 | 数 | 率 |')
log('|---|---|---|')
log(`| 原样 UI 粘贴 → 正确报「请 Export (API)」 | ${uiRejectedCorrectly} | ${pct(uiRejectedCorrectly, uiRejectedCorrectly + uiParsedUnexpectedly)} |`)
log(`| 未给出该提示（漏网/报了别的错） | ${uiParsedUnexpectedly} | — |`)
log('')
if (uiRejectExamples[0]) {
  log('拒绝提示原文（人话，可行动）：')
  log('')
  log(`> ${uiRejectExamples[0]}`)
  log('')
}

// ── §5 识别失败逐个列 + 为什么 ──
log('## 5. 识别失败逐个剖析（忠实语料里没认全的）')
log('')
const noPrompt = analyzed.filter((r) => !r.hasPrompt)
const noOutput = analyzed.filter((r) => !r.hasOutput)

log(`### 5a. 没识别出提示词节点（${noPrompt.length} 张）`)
log('')
if (noPrompt.length === 0) log('（无）')
else {
  log('| 文件 | 节点数 | subgraph | 图里 class_type（截样） | 推断原因 |')
  log('|---|---|---|---|---|')
  for (const r of noPrompt.slice(0, 40)) {
    const c = faithful.find((x) => x.file === r.file)
    const classes = topClasses(c.api, 6)
    log(`| ${r.file} | ${r.nodeCount} | ${r.uses_subgraph ? 'Y' : ''} | ${classes} | ${whyNoPrompt(c.api)} |`)
  }
  if (noPrompt.length > 40) log(`| …还有 ${noPrompt.length - 40} 张 | | | | |`)
}
log('')

log(`### 5b. 没识别出输出节点（${noOutput.length} 张）`)
log('')
if (noOutput.length === 0) log('（无）')
else {
  log('| 文件 | 节点数 | subgraph | 图里 class_type（截样） | 推断原因 |')
  log('|---|---|---|---|---|')
  for (const r of noOutput.slice(0, 40)) {
    const c = faithful.find((x) => x.file === r.file)
    const classes = topClasses(c.api, 6)
    log(`| ${r.file} | ${r.nodeCount} | ${r.uses_subgraph ? 'Y' : ''} | ${classes} | ${whyNoOutput(c.api)} |`)
  }
  if (noOutput.length > 40) log(`| …还有 ${noOutput.length - 40} 张 | | | | |`)
}
log('')

// ── §6 缺口聚类 + top5 该修 ──
log('## 6. 缺口聚类：哪些 class_type 反复没被认出')
log('')
// 收集：所有「有提示词性质却没被 promptNodeId 命中」的候选 class + 所有没被判成 output 的疑似输出类
const missedPromptClasses = tally(noPrompt.flatMap((r) => {
  const c = faithful.find((x) => x.file === r.file)
  return promptishClasses(c.api)
}))
const missedOutputClasses = tally(noOutput.flatMap((r) => {
  const c = faithful.find((x) => x.file === r.file)
  return outputishClasses(c.api)
}))
log('### 疑似「提示词源」但没被识别的 class_type（出现次数）')
log('')
log(tableFromTally(missedPromptClasses) || '（无）')
log('')
log('### 疑似「输出/保存」但没被识别的 class_type（出现次数）')
log('')
log(tableFromTally(missedOutputClasses) || '（无）')
log('')

fs.writeFileSync('/tmp/comfy-corpus-rows.json', JSON.stringify({ analyzed, noPrompt, noOutput }, null, 0))

// 脚本只重写「自动生成的数据段」（§0-§6），标记以下的人工分析结论（§7-§10）原样保留——
// 复跑刷新数据不会抹掉人写的判断。首次运行若无标记则整篇写入数据段。
const MARKER = '<!-- ===== AUTO-GENERATED DATA ABOVE · MANUAL ANALYSIS BELOW (preserved across re-runs) ===== -->'
const md = out.join('\n')
const reportPath = path.join(REPO, 'docs/research/2026-08-01-comfyui-workflow-corpus-report.md')
let manualTail = ''
if (fs.existsSync(reportPath)) {
  const prev = fs.readFileSync(reportPath, 'utf8')
  const idx = prev.indexOf(MARKER)
  if (idx >= 0) manualTail = prev.slice(idx + MARKER.length)
}
fs.writeFileSync(reportPath, `${md}\n\n${MARKER}\n${manualTail || '\n'}`)
console.log(md)
console.log(`\n---\n报告已写入：${reportPath}`)

// ── helpers ──
function pct(n, d) { return d ? `${Math.round((100 * n) / d)}%` : '—' }
function tally(arr) {
  const m = {}
  for (const x of arr) m[x] = (m[x] || 0) + 1
  return m
}
function tableFromTally(m) {
  const e = Object.entries(m).sort((a, b) => b[1] - a[1])
  if (e.length === 0) return ''
  return ['| class_type | 次数 |', '|---|---|', ...e.map(([k, v]) => `| \`${k}\` | ${v} |`)].join('\n')
}
function topClasses(api, n) {
  const cs = [...new Set(Object.values(api).map((x) => x.class_type))]
  return cs.slice(0, n).map((x) => `\`${x}\``).join(' ') + (cs.length > n ? ' …' : '')
}
function findTemplate(file) {
  const dir = process.env.TEMPLATES_DIR ||
    '/tmp/comfyui-venv/lib/python3.14/site-packages/comfyui_workflow_templates_json/templates'
  const p = path.join(dir, file)
  return fs.existsSync(p) ? p : null
}
// 诊断：图里有哪些「像提示词源」的节点（CLIPTextEncode 系 / String 系 / TextEncode 系）
function promptishClasses(api) {
  const re = /textencode|cliptext|encode.*text|primitive.*string|string.*multiline|stringinput|textinput|prompt/i
  return [...new Set(Object.values(api).filter((n) => re.test(n.class_type || '')).map((n) => n.class_type))]
}
function outputishClasses(api) {
  const re = /save|preview|output|combine|createvideo|export/i
  return [...new Set(Object.values(api).filter((n) => re.test(n.class_type || '')).map((n) => n.class_type))]
}
function whyNoPrompt(api) {
  const pc = promptishClasses(api)
  if (pc.length === 0) return '图里无任何 text-encode/string 源（纯 API 节点/纯图输入）'
  // 有 CLIPTextEncode 但没被认出 → 多半是 text 直接是 widget 值但 positive 追溯没命中，或用了变体类名
  const hasClipText = pc.some((c) => /cliptext|textencode/i.test(c))
  if (hasClipText) return `有 ${pc.join('/')} 但 text 输入既非 widget 也没追溯到源（可能 text 连到未覆盖的自定义源节点）`
  return `疑似源类名不在识别正则内：${pc.join('/')}`
}
function whyNoOutput(api) {
  const oc = outputishClasses(api)
  if (oc.length === 0) return '图里无任何 save/preview/combine 类（可能只到 latent/上传云端就结束）'
  const known = /saveimage|savevideo|videocombine|saveanimated|savewebp|createvideo/i
  const unknownOut = oc.filter((c) => !known.test(c))
  if (unknownOut.length) return `输出类名不在识别正则内：${unknownOut.map((c) => '`' + c + '`').join(' ')}`
  return `有 ${oc.join('/')} 但未命中（待查）`
}
