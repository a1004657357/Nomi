import { stationTimeout } from './_station-budget.mjs'
// Goal feature smoke: isolated Electron, local files only, no provider requests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-goal-feature-smoke-'))
const evidencePath = path.join(os.tmpdir(), 'nomi-goal-feature-smoke-evidence.png')
const scriptPath = path.join(tempRoot, '咖啡短片.md')
const demoVideoPath = path.join(repoRoot, 'marketing/assets/demo.mp4')
fs.writeFileSync(scriptPath, '# 第一场\n\n咖啡师把咖啡杯放到窗边桌面。\n\n- 角色：咖啡师\n- 场景：咖啡馆\n- 道具：咖啡杯\n')

let passed = 0
function assert(condition, label) {
  if (!condition) throw new Error(`GOAL FEATURE SMOKE FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

const { app } = await launchNomiApp({
  name: 'nomi-goal-feature-smoke',
  tempRoot,
  env: {
    NOMI_E2E_SMOKE: '1',
    NOMI_SOURCE_RUN: '1',
    NOMI_CAPABILITY_DIR: path.join(tempRoot, 'capability-core'),
  },
})
const electronProcess = app.process()

try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  const projectName = `Goal 功能验收 ${Date.now()}`
  const fixture = await win.evaluate(async ({ projectName, demoVideoPath }) => {
    window.localStorage.setItem('nomi:splash:v1', 'seen')
    window.localStorage.setItem('nomi:journey-tour:v1', 'seen')
    window.localStorage.setItem('nomi:canvas-gesture-hint:v1', 'seen')
    const now = Date.now()
    const id = `goal-feature-${now}`
    const record = window.nomiDesktop.projects.create({
      id,
      name: projectName,
      version: 1,
      createdAt: now,
      updatedAt: now,
      savedAt: now,
      revision: 0,
      payload: {
        workbenchDocument: {
          version: 1,
          title: '',
          contentJson: { type: 'doc', content: [] },
          updatedAt: now,
        },
        generationCanvas: {
          nodes: [],
          edges: [],
          selectedNodeIds: [],
          groups: [],
        },
      },
    })
    const imported = await window.nomiDesktop.assets.importLocalPath({
      projectId: record.id,
      path: demoVideoPath,
      kind: 'generated',
      fileName: 'goal-feature-demo.mp4',
      contentType: 'video/mp4',
    })
    const videoUrl = String(imported?.data?.url || '')
    if (!videoUrl) throw new Error('本地测试视频导入失败')
    const inspection = await window.nomiDesktop.assets.inspectVideo({ url: videoUrl })
    const durationSeconds = Number(inspection?.metadata?.durationSeconds)
    const saved = window.nomiDesktop.projects.read(record.id)
    saved.payload.generationCanvas.nodes.push({
      id: 'goal-local-video',
      kind: 'video',
      title: '本地演示视频',
      position: { x: 80, y: 80 },
      size: { width: 420, height: 300 },
      prompt: '本地关键帧检查，不调用生成模型。',
      categoryId: 'shots',
      status: 'success',
      result: {
        id: 'goal-local-video-result',
        type: 'video',
        url: videoUrl,
        createdAt: now,
        durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 4,
      },
    }, {
      id: 'goal-image-compare',
      kind: 'compare',
      title: '本地图像对比',
      position: { x: 560, y: 80 },
      size: { width: 520, height: 360 },
      categoryId: 'shots',
      prompt: '',
      status: 'idle',
    }, {
      id: 'goal-output-collector',
      kind: 'output',
      title: '本地输出收集',
      position: { x: 1120, y: 80 },
      size: { width: 560, height: 420 },
      categoryId: 'shots',
      prompt: '',
      status: 'idle',
    })
    window.nomiDesktop.projects.save(record.id, saved)
    return {
      projectId: record.id,
      videoUrl,
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 4,
    }
  }, { projectName, demoVideoPath })

  await win.reload()
  await win.getByText('项目库', { exact: false }).first().waitFor({ timeout: stationTimeout() })
  await win.locator('[data-project-card]', { hasText: projectName }).first().click()
  const creationTab = win.getByRole('button', { name: '创作', exact: false }).first()
  await creationTab.waitFor({ timeout: stationTimeout() })
  await creationTab.click()

  const importButton = win.locator('button[aria-label="导入剧本"]')
  await importButton.waitFor({ timeout: stationTimeout() })
  assert(await importButton.isVisible(), '创作区存在可见的剧本导入入口')
  const importInput = win.locator('input[type="file"][aria-label="选择剧本文件"]')
  assert(await importInput.count() === 1, '创作区挂载剧本文件选择器')
  await importInput.setInputFiles(scriptPath)
  await win.getByText('咖啡师把咖啡杯放到窗边桌面。', { exact: true }).waitFor({ timeout: stationTimeout() })
  assert(
    !(await win.getByRole('button', { name: '提取设定', exact: true }).isDisabled()),
    '导入后角色/场景/道具提取入口可用',
  )

  await win.getByRole('button', { name: '生成', exact: false }).first().click()
  await win.locator('[aria-label="AI 影像创作画布"]').waitFor({ timeout: stationTimeout() })

  const performanceButton = win.locator('button[aria-label*="流畅模式"]')
  await performanceButton.click()
  assert(await performanceButton.getAttribute('aria-pressed') === 'true', '画布流畅模式可切换')
  await performanceButton.click()
  assert(await performanceButton.getAttribute('aria-pressed') === 'false', '流畅模式关闭后恢复完整节点内容')

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', {
    detail: { nodeId: 'goal-image-compare' },
  })))
  await win.locator('[data-node-id="goal-image-compare"][data-kind="compare"]').waitFor({ timeout: stationTimeout() })
  const compareEmptyState = win.getByText('连接两张图片进行对比', { exact: true })
  await compareEmptyState.waitFor({ timeout: stationTimeout() })
  assert(await compareEmptyState.isVisible(), '图像对比节点真实渲染')

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', {
    detail: { nodeId: 'goal-output-collector' },
  })))
  await win.locator('[data-node-id="goal-output-collector"][data-kind="output"]').waitFor({ timeout: stationTimeout() })
  const collectorEmptyState = win.getByText('把已有结果的图片或视频节点连接到这里。', { exact: true })
  await collectorEmptyState.waitFor({ timeout: stationTimeout() })
  assert(await collectorEmptyState.isVisible(), '输出收集节点真实渲染')

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', {
    detail: { nodeId: 'goal-local-video' },
  })))
  const localVideoNode = win.locator('[data-node-id="goal-local-video"]')
  await localVideoNode.waitFor({ timeout: stationTimeout() })
  await localVideoNode.click()
  const extracted = await win.evaluate(async ({ projectId, videoUrl, durationSeconds }) => {
    const count = 8
    const end = Math.max(0, durationSeconds - Math.min(0.25, durationSeconds / 10))
    const times = Array.from({ length: count }, (_, index) => Math.round((end * index / (count - 1)) * 1000) / 1000)
    return window.nomiDesktop.video.extractFrames({ projectId, videoUrl, times })
  }, fixture)
  assert(extracted.frames.filter((frame) => frame.url).length === 8, 'Electron 批量抽帧桥返回 8 张真实帧')
  const inspectButton = win.getByRole('button', { name: '检查关键帧' })
  await inspectButton.waitFor({ timeout: stationTimeout() })
  await inspectButton.click()
  const inspector = win.getByRole('dialog', { name: '视频关键帧检查器' })
  await inspector.waitFor({ timeout: stationTimeout() })
  const createFrames = inspector.getByRole('button', { name: /创建 8 个关键帧节点/ })
  await createFrames.waitFor({ timeout: stationTimeout() })
  await createFrames.click()
  await win.locator('[data-kind="keyframe"]').first().waitFor({ timeout: stationTimeout() })
  assert(await win.locator('[data-kind="keyframe"]').count() === 8, '关键帧检查器从本地视频创建 8 个节点')

  await win.getByRole('button', { name: '技能库', exact: true }).click()
  const skillLibrary = win.getByRole('region', { name: '技能库' })
  await skillLibrary.waitFor({ timeout: stationTimeout() })
  await skillLibrary.getByText('Nomi 内置', { exact: true }).click()
  await skillLibrary.getByText('视频拆解与提示词反推', { exact: true }).waitFor({ timeout: stationTimeout() })
  assert(true, '视频拆解与提示词反推 Skill 在技能库可见')

  await win.screenshot({ path: evidencePath, fullPage: false })
  console.log(`\nGOAL FEATURE SMOKE PASS: ${passed} assertions`)
  console.log(`Evidence: ${evidencePath}`)
} catch (error) {
  try {
    const win = app.windows()[0]
    if (win) await win.screenshot({ path: evidencePath, fullPage: false })
  } catch {
    // Keep the original assertion error.
  }
  console.error(`\n${error?.message || error}`)
  console.error(`Evidence: ${evidencePath}`)
  if (process.env.NOMI_E2E_KEEP_TEMP === '1') console.error(`Preserved temp root: ${tempRoot}`)
  process.exitCode = 1
} finally {
  const closed = await Promise.race([
    app.close().then(() => true, () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (!closed && electronProcess.exitCode == null) electronProcess.kill('SIGKILL')
  if (process.env.NOMI_E2E_KEEP_TEMP !== '1') fs.rmSync(tempRoot, { recursive: true, force: true })
}

process.exit(process.exitCode ?? 0)
