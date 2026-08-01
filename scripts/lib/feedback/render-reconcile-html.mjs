#!/usr/bin/env node
// 微信反馈对账表 → 自包含 HTML（零依赖）。给 nomi-wechat-feedback 工作流出「可点着一条条看」的可视化表。
// 输入 = 分诊结构化 JSON（LLM 梳理产出），输出 = 单文件 HTML（内联样式，本地双击即看）。
//
// 用法: node scripts/lib/feedback/render-reconcile-html.mjs <分诊>.json <输出>.html
//
// 输入 JSON schema：
// { title, range, count, imageStatus, legend:[...],
//   sections:[ { key, label, columns:[...], rows:[ {cells:[...], priority?:"P0|P1|P2"} | [...] ] } ],
//   imagePending?: { columns:[...], rows:[[...]] } }
import fs from 'node:fs'

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('用法: node render-reconcile-html.mjs <分诊>.json <输出>.html')
  process.exit(1)
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const data = JSON.parse(fs.readFileSync(inPath, 'utf8'))
const cells = (row) => (Array.isArray(row) ? { cells: row } : row)

function renderSection(sec) {
  const rows = (sec.rows || []).map(cells)
  if (!rows.length) return ''
  const head = (sec.columns || []).map((c) => `<th>${esc(c)}</th>`).join('')
  const body = rows
    .map((r) => {
      const pr = r.priority ? ` class="pri-${esc(r.priority)}" data-pri="${esc(r.priority)}"` : ''
      const tds = (r.cells || []).map((c) => `<td>${esc(c)}</td>`).join('')
      return `<tr${pr}>${tds}</tr>`
    })
    .join('\n')
  return `<section class="blk">
  <h2>${esc(sec.label || sec.key || '')} <span class="n">${rows.length}</span></h2>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</section>`
}

const sections = (data.sections || []).map(renderSection).join('\n')
const imgBlk = data.imagePending && (data.imagePending.rows || []).length
  ? renderSection({ label: '📷 图片待解清单（内容未解密 · 请指认后手发）', columns: data.imagePending.columns, rows: data.imagePending.rows })
  : ''
const legend = (data.legend || []).map((l) => `<span class="lg">${esc(l)}</span>`).join('')

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(data.title || '微信反馈对账表')}</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;padding:24px 28px;font:14px/1.55 -apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  background:#faf9f7;color:#1c1a17}
@media(prefers-color-scheme:dark){body{background:#17151a;color:#e8e4de}
  table{background:#1f1c22}th{background:#26222a}tr:hover td{background:#2a2630}.blk h2{color:#e8e4de}}
h1{font-size:20px;margin:0 0 4px}
.meta{color:#8a837a;font-size:12.5px;margin-bottom:6px}
.imgstat{background:#fff5e6;border-left:3px solid #e8a13c;padding:7px 11px;border-radius:6px;font-size:12.5px;margin:10px 0}
@media(prefers-color-scheme:dark){.imgstat{background:#2e2413}}
.legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin:10px 0 18px;font-size:12px;color:#8a837a}
.blk{margin:0 0 26px}
.blk h2{font-size:15px;margin:0 0 8px;padding-bottom:5px;border-bottom:1px solid #e5e0d8;color:#1c1a17}
.blk h2 .n{color:#a49a8c;font-weight:400;font-size:12px;margin-left:4px}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden;font-size:13px}
th,td{text-align:left;padding:7px 10px;vertical-align:top;border-bottom:1px solid #efeae2}
th{background:#f3efe8;font-weight:600;white-space:nowrap;position:sticky;top:0}
td:first-child{color:#a49a8c;font-variant-numeric:tabular-nums;white-space:nowrap}
tr:hover td{background:#f8f5f0}
tr.pri-P0{border-left:3px solid #d84545}tr.pri-P1{border-left:3px solid #e8873c}tr.pri-P2{border-left:3px solid #d8bf45}
td:last-child{white-space:nowrap;font-weight:600}
.pri-P0 td:last-child{color:#d84545}.pri-P1 td:last-child{color:#e8873c}.pri-P2 td:last-child{color:#b89a20}
</style></head><body>
<h1>${esc(data.title || '微信群反馈对账表')}</h1>
<div class="meta">区间 ${esc(data.range || '')} · 共 ${esc(data.count ?? '')} 条 · 数据源：nomi画布群（decrypt_wechat.py 全量导出）</div>
${data.imageStatus ? `<div class="imgstat">📷 ${esc(data.imageStatus)}</div>` : ''}
<div class="legend">${legend}</div>
${sections}
${imgBlk}
</body></html>`

fs.writeFileSync(outPath, html)
console.log(`✓ 已渲染 ${(data.sections || []).length} 个分区 → ${outPath}`)
