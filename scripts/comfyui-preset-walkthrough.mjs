// R13 真机走查：ComfyUI 预置模板（WAN2.2）缺件闸。
// 场景：① 点开模板 → 缺 6 个模型（红 chip + 逐文件 ✗/目录/复制/下载链，启用禁点）；
//       ② mock 端「装好」全部文件 → 重新检测 → 全部就绪 chip + 启用可点；
//       ③ 一键启用 → workflow 行出现在卡里（已启用 chip）。
// 用法：pnpm build && node scripts/comfyui-preset-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.comfyui-preset-walk')
mkdirSync(outDir, { recursive: true })
const settingsDir = mkdtempSync(path.join(os.tmpdir(), 'comfyui-preset-walk-'))
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

const WAN_FILES = [
  'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
  'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
  'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
  'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
  'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  'wan_2.1_vae.safetensors',
]
let installed = false // false = 缺全部 wan 文件；true = 全装好（经 /__walk/enrich 翻转）
const objectInfo = () => {
  const files = installed ? WAN_FILES : ['placeholder.safetensors']
  const enums = (key) => ({ input: { required: { [key]: [files] } } })
  return {
    LoadImage: { input: { required: {} } },
    CLIPTextEncode: { input: { required: {} } },
    ModelSamplingSD3: { input: { required: {} } },
    WanImageToVideo: { input: { required: {} } },
    VAEDecode: { input: { required: {} } },
    CreateVideo: { input: { required: {} } },
    SaveVideo: { input: { required: {} } },
    KSamplerAdvanced: { input: { required: { sampler_name: [['euler']], scheduler: [['simple']], add_noise: [['enable', 'disable']], return_with_leftover_noise: [['enable', 'disable']] } } },
    CLIPLoader: enums('clip_name'),
    VAELoader: enums('vae_name'),
    UNETLoader: enums('unet_name'),
    LoraLoaderModelOnly: enums('lora_name'),
  }
}

const mock = http.createServer((req, res) => {
  const url = req.url || ''
  if (url.startsWith('/system_stats')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ system: { python_version: '3.11.9', comfyui_version: '0.3.30' }, devices: [{ name: 'cuda:0', vram_total: 1 }] }))
    return
  }
  if (url.startsWith('/__walk/enrich')) { installed = true; res.writeHead(200); res.end('ok'); return }
  if (url.startsWith('/object_info')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(objectInfo()))
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => mock.listen(8188, '127.0.0.1', r))

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: repoRoot,
  env: {
    ...process.env,
    NOMI_E2E: '1',
    NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
    NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html'),
    NOMI_SETTINGS_DIR: settingsDir,
    NOMI_PROJECTS_DIR: mkdtempSync(path.join(os.tmpdir(), 'comfyui-preset-proj-')),
  },
})
const errors = []
try {
  const win = await app.firstWindow()
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)

  await win.getByRole('button', { name: '接入模型', exact: false }).first().click()
  await win.waitForTimeout(1000)
  await win.getByText('有本地 ComfyUI', { exact: false }).first().click()
  await win.waitForTimeout(500)
  await win.getByText('ComfyUI · 本地', { exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('button', { name: '启用 ComfyUI', exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.getByText('ComfyUI · 本地', { exact: false }).first().click()
  await win.waitForTimeout(600)

  // ── ① 缺件态 ──
  await win.getByText('WAN2.2 图生视频 · 14B', { exact: false }).first().click()
  await win.waitForTimeout(1500) // 等 reconcile
  await win.getByText('缺', { exact: false }).first().scrollIntoViewIfNeeded()
  await shot(win, '01-preset-missing-6.png') // 验：红 chip「缺 6 项」+ 逐文件 ✗ + 目录 + 复制/下载钮 + 启用禁点

  // ── ② mock 装好 → 重新检测 ──
  await fetch('http://127.0.0.1:8188/__walk/enrich')
  await win.getByRole('button', { name: '重新检测', exact: true }).first().click()
  await win.waitForTimeout(1500)
  await shot(win, '02-preset-all-ready.png') // 验：绿 chip「全部就绪」+ 逐文件 ✓ + 启用可点

  // ── ③ 一键启用 ──
  await win.getByRole('button', { name: '一键启用模板', exact: true }).click()
  await win.waitForTimeout(1500)
  await win.getByText('WAN2.2 图生视频 · 14B', { exact: false }).first().scrollIntoViewIfNeeded()
  await shot(win, '03-preset-enabled-row.png') // 验：workflow 行出现（视频类型）+ 模板行 chip 变「已启用」

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 8).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
  mock.close()
}
