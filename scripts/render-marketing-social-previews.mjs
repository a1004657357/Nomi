import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { renderSocialCard } from './marketing/social-card.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputs = [
  { locale: 'zh-CN', path: 'marketing/assets/social-preview-zh.jpg' },
  { locale: 'en', path: 'marketing/assets/social-preview-en.jpg' },
]

const browser = await chromium.launch({ headless: true })
try {
  for (const output of outputs) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
    await page.setContent(renderSocialCard(output.locale), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const target = path.join(root, output.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    await page.screenshot({ path: target, type: 'jpeg', quality: 92 })
    await page.close()
    console.log(`Rendered ${output.path}`)
  }
} finally {
  await browser.close()
}
