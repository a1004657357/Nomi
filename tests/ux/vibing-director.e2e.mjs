// Gate 8 zero-spend VIBING Director UI smoke.
// Seeds one Blender-return node, opens the fullscreen Director, verifies the
// spatial-quality UI, and drags the real R3F model preview.
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { launchNomiApp } from './_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-vibing-director-e2e-'))
const evidenceDir = path.resolve(
  process.env.NOMI_VIBING_DIRECTOR_EVIDENCE_DIR
    || path.join(tempRoot, 'evidence'),
)
fs.mkdirSync(evidenceDir, { recursive: true })
const evidenceUsesTempRoot = (() => {
  const relative = path.relative(tempRoot, evidenceDir)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
})()

let assertions = 0
function assert(condition, label) {
  if (!condition) throw new Error(`VIBING DIRECTOR E2E FAIL: ${label}`)
  assertions += 1
  console.log(`  ✓ ${label}`)
}

async function analyzeSceneFraming(win, png) {
  return win.evaluate(async (encodedPng) => {
    const image = new Image()
    image.src = `data:image/png;base64,${encodedPng}`
    await image.decode()
    const surface = document.createElement('canvas')
    surface.width = image.naturalWidth
    surface.height = image.naturalHeight
    const context = surface.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas context unavailable for framing analysis')
    context.drawImage(image, 0, 0)
    const { data, width, height } = context.getImageData(0, 0, surface.width, surface.height)
    const background = [223, 230, 234]
    const xStart = Math.floor(width * 0.18)
    const xEnd = Math.ceil(width * 0.82)
    const yStart = Math.floor(height * 0.16)
    const yEnd = Math.ceil(height * 0.96)
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    let pixels = 0
    for (let y = yStart; y < yEnd; y += 1) {
      for (let x = xStart; x < xEnd; x += 1) {
        const offset = (y * width + x) * 4
        const difference = Math.abs(data[offset] - background[0])
          + Math.abs(data[offset + 1] - background[1])
          + Math.abs(data[offset + 2] - background[2])
        if (data[offset + 3] < 200 || difference <= 55) continue
        pixels += 1
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    if (!pixels || maxX < minX || maxY < minY) return { pixels: 0, framed: false }
    const centerX = (minX + maxX) / 2 / width
    const centerY = (minY + maxY) / 2 / height
    const widthRatio = (maxX - minX + 1) / width
    const heightRatio = (maxY - minY + 1) / height
    return {
      pixels,
      centerX,
      centerY,
      widthRatio,
      heightRatio,
      framed:
        pixels > 2000
        && centerX >= 0.25
        && centerX <= 0.75
        && centerY >= 0.2
        && centerY <= 0.8
        && widthRatio >= 0.08
        && heightRatio >= 0.35
        && minY > height * 0.02
        && maxY < height * 0.98,
    }
  }, png.toString('base64'))
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const request = http.get(url, (response) => {
        response.destroy()
        resolve(true)
      })
      request.on('error', () => {
        if (Date.now() > deadline) reject(new Error('Vite did not become ready'))
        else setTimeout(tick, 350)
      })
      request.setTimeout(1500, () => request.destroy())
    }
    tick()
  })
}

async function waitForChildExit(child, timeoutMs = 2500) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

async function dismissStartup(win) {
  await win.keyboard.press('Escape').catch(() => {})
  const splashSkip = win.locator('[data-splash-skip="true"]').first()
  if ((await splashSkip.count()) > 0) await splashSkip.click().catch(() => {})
  await win.locator('.nomi-splash').first().waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
}

async function waitForCanvasStore(win) {
  for (let index = 0; index < 24; index += 1) {
    const ready = await win.evaluate(async () => {
      try {
        const module = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
        return Boolean(module.useGenerationCanvasStore?.getState)
      } catch {
        return false
      }
    }).catch(() => false)
    if (ready) return true
    await win.waitForTimeout(400)
  }
  return false
}

const previewDataUrl = `data:image/jpeg;base64,${fs.readFileSync(
  path.join(repoRoot, 'src/workbench/onboarding/assets/robot/shot-2.jpg'),
).toString('base64')}`
const previousPreviewDataUrl = `data:image/jpeg;base64,${fs.readFileSync(
  path.join(repoRoot, 'src/workbench/onboarding/assets/robot/shot-1.jpg'),
).toString('base64')}`
const modelBase64 = fs.readFileSync(
  path.join(repoRoot, 'src/assets/nomi-mannequin.glb'),
).toString('base64')

const port = await findFreePort()
const devUrl = `http://127.0.0.1:${port}`
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: repoRoot,
  env: { ...process.env },
  stdio: 'ignore',
})
await waitForUrl(devUrl, 60_000)

const { app } = await launchNomiApp({
  name: 'nomi-vibing-director-e2e',
  tempRoot,
  env: {
    NOMI_DESKTOP_DEV: '1',
    VITE_DEV_SERVER_URL: devUrl,
    NOMI_E2E_SMOKE: '1',
    NOMI_SOURCE_RUN: '1',
    NOMI_CAPABILITY_DIR: path.join(tempRoot, 'capability-core'),
  },
})
const electronProcess = app.process()
const rendererErrors = []

try {
  const win = await app.firstWindow()
  win.on('pageerror', (error) => rendererErrors.push(String(error)))
  win.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text())
  })
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'light')
  })
  await win.waitForTimeout(1600)
  await dismissStartup(win)

  const projectCard = win.locator('[data-project-card]').first()
  if ((await projectCard.count()) > 0) await projectCard.click()
  else await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2200)
  await dismissStartup(win)
  assert(/projectId=/.test(win.url()), 'opened an isolated project')

  await win.getByRole('button', { name: '生成', exact: false }).first().click()
  await win.waitForTimeout(900)
  assert(await waitForCanvasStore(win), 'generation canvas store is available')

  const seededNodes = await win.evaluate(async ({ previewUrl, previousPreviewUrl, modelBase64: encodedModel }) => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const {
      hostedAssetUrl,
      importWorkbenchLocalAssetFile,
    } = await import('/src/workbench/api/assetUploadApi.ts')
    const canvas = useGenerationCanvasStore.getState()
    const now = Date.now()
    const modelBytes = Uint8Array.from(atob(encodedModel), (value) => value.charCodeAt(0))
    const importedModel = await importWorkbenchLocalAssetFile(
      new File([modelBytes], 'nomi-mannequin.glb', { type: 'model/gltf-binary' }),
      'nomi-mannequin.glb',
    )
    const modelUrl = hostedAssetUrl(importedModel)
    if (!modelUrl.startsWith('nomi-local://')) {
      throw new Error(`VIBING Director E2E expected a persisted model URL, received ${modelUrl || 'empty'}`)
    }
    const currentState = {
      version: 2,
      backend: 'blender',
      brief: '咖啡店双人对话预演',
      stagePreset: 'coffee_shop',
      assets: [],
      objects: [
        { id: 'actor-A', name: '角色A', kind: 'marker', role: 'actor_seated', position: [0, 0, 1.25], rotation: [0, 180, 0], scale: [1, 1, 1] },
        { id: 'actor-B', name: '角色B', kind: 'marker', role: 'actor_seated', position: [0, 0, -1.25], rotation: [0, 0, 0], scale: [1, 1, 1] },
        { id: 'table-main', name: '咖啡桌', kind: 'marker', role: 'table', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      ],
      relations: [
        { id: 'actors-distance', kind: 'distance', subjectRef: 'actor-A', targetRef: 'actor-B', distance: 2.5 },
        { id: 'actors-facing', kind: 'facing', subjectRef: 'actor-A', targetRef: 'actor-B', mutual: true },
      ],
      camera: {
        id: 'director-camera',
        name: '双人主机位',
        position: [7, 3.5, 7],
        lookAt: [0, 0.9, 0],
        fov: 45,
        aspectRatio: '16:9',
        framing: 'all',
      },
      beats: [{
        id: 'beat-1',
        title: '双人中景',
        action: '角色A递出咖啡，角色B伸手接杯。',
        cameraNote: '稳定双人中景，轻微推进。',
        dialogue: '请慢用。',
        durationSec: 4,
      }],
      output: {
        jobId: 'director-e2e',
        previewUrl,
        blendUrl: 'nomi://vibing-director/scene.blend',
        modelUrl,
        blendRelativePath: '.nomi/vibing-director/director-e2e/scene.blend',
        blenderVersion: '4.0.1',
        spatialReport: {
          version: 1,
          passed: true,
          checks: [
            { relationId: 'actors-distance', kind: 'distance', status: 'passed', message: '水平距离 2.5m', measured: 2.5, expected: 2.5 },
            { relationId: 'actors-facing', kind: 'facing', status: 'passed', message: '朝向误差 0.2°', measured: 0.2, expected: 0 },
          ],
        },
        createdAt: now,
      },
      updatedAt: now,
    }
    const previousState = {
      ...currentState,
      brief: '上一个可回滚版本',
      stagePreset: 'studio',
      relations: [currentState.relations[0]],
      beats: [{
        id: 'beat-previous',
        title: '旧版单人中景',
        action: '角色A停在桌边。',
        cameraNote: '固定中景。',
        durationSec: 3,
      }],
      output: {
        ...currentState.output,
        jobId: 'director-e2e-previous',
        previewUrl: previousPreviewUrl,
        blendUrl: 'nomi://vibing-director/previous.blend',
        blendRelativePath: '.nomi/vibing-director/director-e2e-previous/scene.blend',
        spatialReport: {
          version: 1,
          passed: true,
          checks: [currentState.output.spatialReport.checks[0]],
        },
        createdAt: now - 1_000,
      },
      updatedAt: now - 1_000,
    }
    const resultForState = (state) => ({
      id: `vibing-director-director-e2e-${state.output.jobId}`,
      type: 'image',
      url: state.output.previewUrl,
      taskKind: 'model3d',
      raw: {
        source: 'vibing-director',
        jobId: state.output.jobId,
        blendUrl: state.output.blendUrl,
        modelUrl: state.output.modelUrl,
        blendRelativePath: state.output.blendRelativePath,
        blenderVersion: state.output.blenderVersion,
        directorState: state,
      },
      createdAt: state.output.createdAt,
    })
    const node = canvas.addNode({
      kind: 'vibingDirector',
      title: '咖啡店 VIBING Director',
      categoryId: 'shots',
      position: { x: 180, y: 140 },
      exactPosition: true,
      select: false,
      meta: {
        vibingDirectorState: currentState,
      },
    })
    const currentResult = resultForState(currentState)
    const previousResult = resultForState(previousState)
    canvas.updateNode(node.id, {
      result: currentResult,
      history: [currentResult, previousResult],
      status: 'success',
    })
    const hiddenMeta = {
      storyboardContainedByNodeId: 'storyboard-table-e2e',
      storyboardContainedRowIndex: 0,
      storyboardContainedExpanded: false,
    }
    const hiddenModel = canvas.addNode({
      kind: 'model3d',
      title: '收纳的 3D 结果',
      categoryId: 'shots',
      position: { x: 760, y: 120 },
      exactPosition: true,
      select: false,
      meta: { ...hiddenMeta, storyboardContainedRole: 'image' },
    })
    canvas.updateNode(hiddenModel.id, {
      result: {
        id: 'hidden-model-result',
        type: 'model3d',
        url: modelUrl,
        createdAt: now,
      },
      history: [],
      status: 'success',
    })
    const hiddenVideo = canvas.addNode({
      kind: 'video',
      title: '收纳的视频结果',
      categoryId: 'shots',
      position: { x: 760, y: 520 },
      exactPosition: true,
      select: false,
      meta: { ...hiddenMeta, storyboardContainedRole: 'video' },
    })
    canvas.updateNode(hiddenVideo.id, {
      result: {
        id: 'hidden-video-result',
        type: 'video',
        url: 'https://example.invalid/hidden-video.mp4',
        createdAt: now,
      },
      history: [],
      status: 'success',
    })
    canvas.setCanvasTransform(1, { x: 0, y: 0 })
    return {
      nodeId: node.id,
      hiddenModelNodeId: hiddenModel.id,
      hiddenVideoNodeId: hiddenVideo.id,
    }
  }, { previewUrl: previewDataUrl, previousPreviewUrl: previousPreviewDataUrl, modelBase64 })
  const { nodeId, hiddenModelNodeId, hiddenVideoNodeId } = seededNodes

  await win.waitForTimeout(400)
  const containment = await win.evaluate(({ modelNodeId, videoNodeId }) => ({
    hiddenModelMounted: Boolean(document.querySelector(`[data-node-id="${modelNodeId}"]`)),
    hiddenVideoMounted: Boolean(document.querySelector(`[data-node-id="${videoNodeId}"]`)),
    canvasCount: document.querySelectorAll('canvas').length,
    videoCount: document.querySelectorAll('video').length,
  }), { modelNodeId: hiddenModelNodeId, videoNodeId: hiddenVideoNodeId })
  assert(
    !containment.hiddenModelMounted
      && !containment.hiddenVideoMounted
      && containment.canvasCount === 0
      && containment.videoCount === 0,
    `collapsed storyboard outputs mount no live media (${JSON.stringify(containment)})`,
  )

  const node = win.locator(`[data-node-id="${nodeId}"]`)
  await node.waitFor({ state: 'visible', timeout: 8000 })
  const openDirectorButton = node.getByRole('button', { name: '打开 VIBING Director' })
  await openDirectorButton.waitFor({ state: 'visible', timeout: 12_000 })
  const nodeState = await win.evaluate(async (id) => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
    const director = current?.meta?.vibingDirectorState
    return {
      kind: current?.kind,
      categoryId: current?.categoryId,
      relationCount: Array.isArray(director?.relations) ? director.relations.length : -1,
      objectCount: Array.isArray(director?.objects) ? director.objects.length : -1,
      beatCount: Array.isArray(director?.beats) ? director.beats.length : -1,
    }
  }, nodeId)
  const nodeText = await node.innerText()
  fs.writeFileSync(
    path.join(evidenceDir, '01-canvas-node-debug.json'),
    `${JSON.stringify({ nodeId, nodeState, nodeText }, null, 2)}\n`,
  )
  await win.screenshot({ path: path.join(evidenceDir, '01-canvas-node.png') })
  assert(nodeState.relationCount === 2, 'canvas store preserves Director relations')
  assert(nodeText.includes('2 关系'), 'canvas node summary includes persistent relations')

  await openDirectorButton.click()
  const dialog = win.locator('[role="dialog"][aria-label*="Blender 导演台"]').last()
  await dialog.waitFor({ state: 'visible', timeout: 15_000 })
  assert(await dialog.getByLabel('VIBING Director Agent').isVisible(), 'Director Agent panel is visible')
  assert(await dialog.getByLabel('向 Director Agent 发送消息').isVisible(), 'Director Agent composer is usable')
  assert((await dialog.getByText('空间关系', { exact: true }).count()) > 0, 'spatial relation count is visible')
  assert((await dialog.getByText('空间关系已通过', { exact: true }).count()) > 0, 'spatial quality status is visible')
  assert((await dialog.getByText('镜头节拍', { exact: true }).count()) > 0, 'shot beats are visible')
  const assetCatalog = dialog.locator('[data-director-asset-catalog="kenney"]')
  await assetCatalog.waitFor({ state: 'visible', timeout: 5000 })
  assert(await dialog.getByText('Kenney Furniture Kit 1.0 · CC0', { exact: true }).isVisible(), 'audited CC0 catalog is visible')
  const assetSearch = dialog.getByLabel('搜索开源三维资产')
  await assetSearch.fill('咖啡')
  const coffeeMachine = assetCatalog.locator('[data-catalog-asset-id="kenney:furniture-kit:kitchenCoffeeMachine"]')
  await coffeeMachine.waitFor({ state: 'visible', timeout: 5000 })
  assert(await coffeeMachine.getByText('Kitchen Coffee Machine', { exact: true }).isVisible(), 'Chinese catalog search finds a coffee asset')
  assert(await coffeeMachine.getByRole('button', { name: '导入 Kitchen Coffee Machine' }).isEnabled(), 'catalog asset exposes an import action')

  const sceneButton = dialog.getByRole('button', { name: '检查 Blender 场景' })
  const renderButton = dialog.getByRole('button', { name: '查看 Blender 相机渲染' })
  assert(await sceneButton.isVisible() && await renderButton.isVisible(), 'scene and render preview modes are available')

  const canvas = dialog.locator('canvas').first()
  await canvas.waitFor({ state: 'visible', timeout: 12_000 })
  await win.waitForTimeout(2500)
  const before = await canvas.screenshot()
  assert(before.length > 5000, '3D canvas renders nonblank pixels')
  fs.writeFileSync(path.join(evidenceDir, '02-scene-before-drag.png'), before)
  const beforeFraming = await analyzeSceneFraming(win, before)
  assert(beforeFraming.framed, `initial 3D subject is framed (${JSON.stringify(beforeFraming)})`)
  const box = await canvas.boundingBox()
  assert(Boolean(box && box.width > 300 && box.height > 240), '3D canvas has a stable interactive frame')
  if (box) {
    await win.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
    await win.mouse.down()
    await win.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.42, { steps: 10 })
    await win.mouse.up()
  }
  await win.waitForTimeout(700)
  const after = await canvas.screenshot()
  assert(!before.equals(after), 'dragging the preview changes the rendered camera view')
  const afterFraming = await analyzeSceneFraming(win, after)
  assert(afterFraming.framed, `dragged 3D subject remains framed (${JSON.stringify(afterFraming)})`)
  fs.writeFileSync(path.join(evidenceDir, '02-scene-after-drag.png'), after)

  const sceneControlsBox = await sceneButton.boundingBox()
  const qualityBadge = dialog.getByText('空间关系已通过', { exact: true }).first()
  const qualityBox = await qualityBadge.boundingBox()
  assert(
    Boolean(sceneControlsBox && qualityBox && sceneControlsBox.x + sceneControlsBox.width < qualityBox.x),
    'preview controls and spatial-quality badge do not overlap',
  )

  await renderButton.click()
  await win.waitForTimeout(500)
  await dialog.screenshot({ path: path.join(evidenceDir, '03-render-mode.png') })
  assert((await dialog.locator('img[alt="Blender 相机渲染预览"]').count()) === 1, 'render mode shows the Blender camera image')

  await win.setViewportSize({ width: 1100, height: 760 })
  await win.waitForTimeout(500)
  const layout = await dialog.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  assert(layout.scrollWidth <= layout.clientWidth + 1, 'compact desktop layout has no horizontal overflow')
  await dialog.screenshot({ path: path.join(evidenceDir, '04-compact-layout.png') })

  await dialog.getByRole('button', { name: '关闭 Director' }).click()
  await dialog.waitFor({ state: 'hidden', timeout: 5000 })
  await win.evaluate(async (id) => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    useGenerationCanvasStore.getState().selectNode(id)
  }, nodeId)
  const stackButton = node.getByRole('button', { name: '2 张堆叠图片' })
  await stackButton.waitFor({ state: 'visible', timeout: 5000 })
  await stackButton.click()
  const stack = node.getByRole('list', { name: '可切换的堆叠图片' })
  await stack.waitFor({ state: 'visible', timeout: 5000 })
  await stack.getByRole('button', { name: '设为主图' }).click()
  await win.waitForTimeout(400)
  const rolledBackText = await node.innerText()
  assert(
    rolledBackText.includes('上一个可回滚版本') && rolledBackText.includes('1 关系'),
    'selecting an older result restores the Director node snapshot',
  )
  await node.getByRole('button', { name: '打开 VIBING Director' }).click()
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  const rolledBackRender = dialog.locator('img[alt="Blender 相机渲染预览"]')
  await dialog.getByRole('button', { name: '查看 Blender 相机渲染' }).click()
  assert(
    (await rolledBackRender.getAttribute('src')) === previousPreviewDataUrl,
    'rollback opens the previous Blender preview artifact',
  )
  const rolledBackRelationStat = dialog.getByText('空间关系', { exact: true }).locator('..')
  assert(
    (await rolledBackRelationStat.getByText('1', { exact: true }).count()) === 1,
    'rollback restores the previous relation count',
  )
  await dialog.screenshot({ path: path.join(evidenceDir, '05-rolled-back-director.png') })

  const relevantErrors = rendererErrors.filter((message) => (
    !/favicon|DevTools|Download the React DevTools/i.test(message)
  ))
  assert(relevantErrors.length === 0, `renderer has no relevant errors (${relevantErrors.join(' | ') || 'none'})`)
  console.log(`\nVIBING DIRECTOR E2E PASS: ${assertions} assertions`)
  console.log(`Evidence: ${evidenceDir}`)
} catch (error) {
  const pages = app.windows()
  const activeWindow = pages.at(-1)
  if (activeWindow) {
    await activeWindow.screenshot({ path: path.join(evidenceDir, 'failure-window.png') }).catch(() => {})
  }
  fs.writeFileSync(
    path.join(evidenceDir, 'renderer-errors.json'),
    `${JSON.stringify(rendererErrors, null, 2)}\n`,
  )
  console.error(`\n${error?.stack || error}`)
  process.exitCode = 1
} finally {
  const closed = await Promise.race([
    app.close().then(() => true, () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ])
  if (!closed && electronProcess.exitCode == null) electronProcess.kill('SIGKILL')
  await waitForChildExit(electronProcess)
  vite.kill('SIGTERM')
  await waitForChildExit(vite)
  if (!evidenceUsesTempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
}

process.exit(process.exitCode ?? 0)
