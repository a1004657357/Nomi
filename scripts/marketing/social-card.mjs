import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dataUri = (relativePath, mediaType) => `data:${mediaType};base64,${fs.readFileSync(path.join(root, relativePath)).toString('base64')}`
const logo = dataUri('marketing/assets/nomi-logo.svg', 'image/svg+xml')
const canvas = dataUri('marketing/assets/screen-canvas.png', 'image/png')

const copy = {
  'zh-CN': {
    eyebrow: '本地优先 · 开源 · AI 视频导演工作台',
    lead: '把镜头讲清楚，',
    emphasis: '不让模型猜。',
    agentic: '一句话 → Nomi MCP + Skills → 可编辑初稿',
  },
  en: {
    eyebrow: 'LOCAL-FIRST · OPEN SOURCE · AI VIDEO WORKBENCH',
    lead: 'Direct the shot.',
    emphasis: 'Not just the prompt.',
    agentic: 'ONE SENTENCE → NOMI MCP + SKILLS → EDITABLE FIRST CUT',
  },
}

export function renderSocialCard(locale) {
  const content = copy[locale]
  if (!content) throw new Error(`Unknown social-card locale: ${locale}`)
  return `<!doctype html>
<html lang="${locale === 'en' ? 'en' : 'zh-CN'}">
<head><meta charset="utf-8" /><style>
*{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden}body{background:#f2efe8;color:#1a1816;font-family:"Avenir Next","PingFang SC",sans-serif}.card{position:relative;display:grid;grid-template-columns:57% 43%;width:100%;height:100%;border:18px solid #1a1816}.copy{position:relative;padding:52px 48px 42px 54px;background:#f2efe8}.identity{display:flex;align-items:center;gap:13px;font:30px/1 Georgia,serif}.identity img{width:42px;height:42px}.eyebrow{margin:66px 0 22px;color:#c7563d;font:11px/1.4 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}.claim{margin:0;font:400 74px/.87 Georgia,"Songti SC",serif;letter-spacing:-.045em}.claim em{display:block;color:#c7563d;font-style:italic}.agentic{position:absolute;left:54px;bottom:48px;margin:0;padding-top:14px;border-top:1px solid #8a8278;font:10px/1.5 ui-monospace,monospace;letter-spacing:.08em}.monitor{position:relative;display:flex;align-items:center;padding:54px 42px;background:#222220}.frame{position:relative;width:100%;padding:14px;background:#0f0f10;border:1px solid rgba(255,255,255,.28);box-shadow:18px 18px 0 rgba(0,0,0,.2)}.frame img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;border:1px solid rgba(255,255,255,.14)}.frame::after{content:"";position:absolute;inset:10%;border:2px solid #e8765a}.timecode{position:absolute;right:42px;top:30px;color:#e8765a;font:10px ui-monospace,monospace;letter-spacing:.1em}.rail{position:absolute;left:0;right:0;bottom:0;height:18px;background:#e8765a}
</style></head>
<body><main class="card">
  <section class="copy">
    <div class="identity"><img src="${logo}" alt="" /><span>Nomi</span></div>
    <p class="eyebrow">${content.eyebrow}</p>
    <h1 class="claim">${content.lead}<em>${content.emphasis}</em></h1>
    <p class="agentic">${content.agentic}</p>
  </section>
  <section class="monitor">
    <span class="timecode">REC · 00:00:14:22</span>
    <div class="frame"><img src="${canvas}" alt="" /></div>
  </section>
  <div class="rail"></div>
</main></body></html>`
}
