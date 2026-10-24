import { stationTimeout } from './_station-budget.mjs'
// Gate 8 capability recipe UI verification. Isolated, deterministic, and zero-spend:
// it marks a seeded provider as connected with a fake key but never clicks generation.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-capability-recipes-e2e-'))
const evidenceDir = path.resolve(
  process.env.NOMI_CAPABILITY_RECIPES_EVIDENCE_DIR?.trim()
    || path.join(tempRoot, 'evidence'),
)
const projectExportDir = process.env.NOMI_CAPABILITY_RECIPES_PROJECT_EXPORT_DIR?.trim()
  ? path.resolve(process.env.NOMI_CAPABILITY_RECIPES_PROJECT_EXPORT_DIR.trim())
  : ''
fs.mkdirSync(evidenceDir, { recursive: true })
const evidenceUsesTempRoot = (() => {
  const relative = path.relative(tempRoot, evidenceDir)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
})()

let passed = 0
let runPassed = false
let createdProjectId = ''
function assert(condition, label) {
  if (!condition) throw new Error(`CAPABILITY E2E FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const pngDataUrl = (relativePath) =>
  `data:image/png;base64,${fs.readFileSync(path.join(repoRoot, relativePath)).toString('base64')}`
const PORTRAIT_SOURCE_PATH = path.join(repoRoot, 'tests/ux/_stagingshot/01-standing__front.png')
const PORTRAIT_REFINED_PATH = path.join(repoRoot, 'tests/ux/_stagingshot/01-standing__q3.png')
const PORTRAIT_SOURCE = pngDataUrl('tests/ux/_stagingshot/01-standing__front.png')
const PORTRAIT_REFINED = pngDataUrl('tests/ux/_stagingshot/01-standing__q3.png')
const DEMO_VIDEO_PATH = path.join(repoRoot, 'marketing/assets/demo.mp4')
const now = Date.now()
const makeResult = (id, url = TINY_PNG) => ({ id, type: 'image', url, thumbnailUrl: url, createdAt: now })
const collectionItems = ['正面', '右前侧', '右侧', '右后侧', '背面', '左后侧', '左侧', '左前侧', '俯视'].map(
  (label, index) => ({
    id: `view-${index + 1}`,
    label,
    status: 'success',
    result: makeResult(`view-result-${index + 1}`),
  }),
)
const moodItems = Array.from({ length: 25 }, (_, index) => {
  const energy = Math.floor(index / 5)
  const affinity = index % 5
  return {
    id: `mood-e${energy}-a${affinity}`,
    label: `能量 ${energy} · 亲和 ${affinity}`,
    energy,
    affinity,
    status: 'success',
    result: makeResult(
      `mood-result-${energy}-${affinity}`,
      energy === 2 && affinity === 2 ? PORTRAIT_REFINED : TINY_PNG,
    ),
  }
})

const projectPayload = {
  generationCanvas: {
    nodes: [
      {
        id: 'capability-source',
        kind: 'image',
        title: '人像源图',
        position: { x: 60, y: 80 },
        size: { width: 300, height: 300 },
        prompt: '同一位人物站在自然侧光中，保持身份和服装。',
        result: makeResult('source-result', PORTRAIT_SOURCE),
        history: [makeResult('source-result', PORTRAIT_SOURCE)],
        status: 'success',
        categoryId: 'shots',
        renderKind: 'shot-frame',
      },
      {
        id: 'capability-grid',
        kind: 'image',
        title: '九宫格结果集合',
        position: { x: 430, y: 80 },
        size: { width: 520, height: 520 },
        prompt: '固定九个机位',
        result: collectionItems[0].result,
        history: collectionItems.map((item) => item.result),
        resultCollections: [
          {
            id: 'grid-collection',
            recipeId: 'image.multiview.grid9',
            createdAt: now,
            quality: {
              version: 1,
              kind: 'grid9',
              evaluator: 'grid9-local-v1',
              status: 'warning',
              evaluatedAt: now,
              checks: [
                {
                  id: 'view-contract',
                  label: '机位槽位',
                  status: 'pass',
                  summary: '9 个机位按约定顺序和角度元数据完整',
                },
                {
                  id: 'view-diversity',
                  label: '视角差异',
                  status: 'warning',
                  summary: '发现 1 组高度相似画面，建议确认机位是否真的变化',
                  details: ['正面 ↔ 右前侧'],
                  itemIds: ['view-1', 'view-2'],
                },
                {
                  id: 'subject-continuity-proxy',
                  label: '主体连续性代理',
                  status: 'pass',
                  summary: '未发现整体色彩或构图分布的极端漂移',
                },
              ],
            },
            items: collectionItems,
          },
        ],
        status: 'success',
        categoryId: 'shots',
        renderKind: 'shot-frame',
        meta: { previewHeight: 520 },
      },
      {
        id: 'capability-panorama',
        kind: 'panorama',
        title: '360° 全景结果',
        position: { x: 1020, y: 80 },
        size: { width: 520, height: 260 },
        prompt: '咖啡馆室内等距柱状全景',
        result: makeResult('panorama-result'),
        history: [makeResult('panorama-result')],
        resultCollections: [
          {
            id: 'panorama-collection',
            recipeId: 'scene.panorama.2to1',
            createdAt: now,
            quality: {
              version: 1,
              kind: 'panorama',
              evaluator: 'panorama-local-v1',
              status: 'fail',
              evaluatedAt: now,
              checks: [
                {
                  id: 'panorama-aspect',
                  label: '2:1 画幅',
                  status: 'pass',
                  summary: '输出尺寸 2048x1024，符合 2:1',
                },
                {
                  id: 'panorama-normalization',
                  label: '原生全景来源',
                  status: 'warning',
                  summary: '输出通过中心裁切归一为 2:1，裁掉约 8.2% 原图面积',
                },
                {
                  id: 'panorama-seam',
                  label: '左右接缝',
                  status: 'fail',
                  summary: '左右边缘差异过大，环绕时很可能出现明显断层',
                  itemIds: ['panorama'],
                },
                {
                  id: 'panorama-poles',
                  label: '极点风险',
                  status: 'warning',
                  summary: '顶部或底部纹理变化偏大，建议检查天顶与地面扭曲',
                  itemIds: ['panorama'],
                },
                {
                  id: 'panorama-projection-proxy',
                  label: '投影可用性',
                  status: 'pass',
                  summary: '画面覆盖和细节满足本地等距柱状代理检查',
                },
              ],
            },
            items: [{
              id: 'panorama',
              label: '360° 全景',
              status: 'success',
              result: makeResult('panorama-result'),
            }],
          },
        ],
        status: 'success',
        categoryId: 'shots',
        meta: { previewHeight: 260 },
      },
      {
        id: 'capability-portrait',
        kind: 'image',
        title: '人像真实化结果',
        position: { x: 60, y: 690 },
        size: { width: 360, height: 360 },
        prompt: '保持同一人物身份，保留自然毛孔与细小纹理。',
        result: makeResult('portrait-refined-result', PORTRAIT_REFINED),
        history: [makeResult('portrait-refined-result', PORTRAIT_REFINED)],
        resultCollections: [
          {
            id: 'portrait-collection',
            recipeId: 'portrait.refine',
            createdAt: now,
            source: {
              nodeId: 'capability-source',
              resultId: 'source-result',
              label: '人像源图',
              url: PORTRAIT_SOURCE,
              thumbnailUrl: PORTRAIT_SOURCE,
            },
            quality: {
              version: 1,
              kind: 'portrait',
              evaluator: 'portrait-local-v1',
              status: 'unavailable',
              evaluatedAt: now,
              checks: [
                {
                  id: 'portrait-source',
                  label: '来源人像',
                  status: 'pass',
                  summary: '已保留可比较的原始人像快照',
                },
                {
                  id: 'portrait-identity',
                  label: '身份保护',
                  status: 'unavailable',
                  summary: '当前没有人脸身份比较器，像素代理不能证明人物身份一致',
                },
                {
                  id: 'portrait-skin-texture',
                  label: '肤质与细节',
                  status: 'pass',
                  summary: '中心区域纹理变化处于合理范围',
                },
              ],
            },
            items: [{
              id: 'portrait-refined',
              label: '人像真实化',
              status: 'success',
              result: makeResult('portrait-refined-result', PORTRAIT_REFINED),
            }],
          },
        ],
        status: 'success',
        categoryId: 'shots',
        renderKind: 'shot-frame',
        meta: { previewHeight: 360 },
      },
      {
        id: 'capability-style',
        kind: 'image',
        title: '图像风格迁移结果',
        position: { x: 1020, y: 380 },
        size: { width: 520, height: 260 },
        prompt: '保持人物和构图，迁移夏日海报色彩与质感。',
        result: makeResult('style-result', PORTRAIT_REFINED),
        history: [makeResult('style-result', PORTRAIT_REFINED)],
        resultCollections: [
          {
            id: 'style-collection',
            recipeId: 'image.style.transfer',
            createdAt: now,
            source: {
              nodeId: 'capability-source',
              resultId: 'source-result',
              label: '人像源图',
              url: PORTRAIT_SOURCE,
              thumbnailUrl: PORTRAIT_SOURCE,
            },
            quality: {
              version: 1,
              kind: 'style',
              evaluator: 'style-transfer-local-v1',
              status: 'warning',
              evaluatedAt: now,
              checks: [
                {
                  id: 'style-output',
                  label: '风格化结果',
                  status: 'pass',
                  summary: '已保留可读取的风格化图片结果',
                },
                {
                  id: 'style-image-content',
                  label: '画面有效性',
                  status: 'pass',
                  summary: '输出包含有效像素和可见细节',
                },
                {
                  id: 'style-aspect-retention',
                  label: '画幅保留',
                  status: 'pass',
                  summary: '结果保持了源图画幅',
                },
                {
                  id: 'style-content-retention',
                  label: '内容保留代理',
                  status: 'pass',
                  summary: '中心区域结构与源图保持接近',
                },
                {
                  id: 'style-transfer-proxy',
                  label: '风格迁移代理',
                  status: 'warning',
                  summary: '结果没有明显向风格参考靠近，建议人工预览或重新生成',
                },
              ],
            },
            items: [{
              id: 'styled',
              label: '风格化图片',
              status: 'success',
              result: makeResult('style-result', PORTRAIT_REFINED),
            }],
          },
        ],
        status: 'success',
        categoryId: 'shots',
        renderKind: 'shot-frame',
        meta: { previewHeight: 260 },
      },
      {
        id: 'capability-mood',
        kind: 'image',
        title: '5×5 人物情绪',
        position: { x: 500, y: 690 },
        size: { width: 620, height: 620 },
        prompt: '固定人物身份，按能量和亲和坐标改变表演。',
        result: moodItems[12].result,
        history: moodItems.map((item) => item.result),
        resultCollections: [
          {
            id: 'mood-collection',
            recipeId: 'portrait.mood',
            createdAt: now,
            source: {
              nodeId: 'capability-source',
              resultId: 'source-result',
              label: '人像源图',
              url: PORTRAIT_SOURCE,
              thumbnailUrl: PORTRAIT_SOURCE,
            },
            quality: {
              version: 1,
              kind: 'mood',
              evaluator: 'portrait-mood-local-v1',
              status: 'warning',
              evaluatedAt: now,
              checks: [
                {
                  id: 'portrait-identity',
                  label: '身份保护',
                  status: 'warning',
                  summary: '2 个高能量结果建议人工复核身份',
                  itemIds: ['mood-e4-a0', 'mood-e4-a4'],
                },
                {
                  id: 'mood-coordinate-contract',
                  label: '情绪坐标',
                  status: 'pass',
                  summary: '25 个情绪坐标按 5×5 行列顺序完整',
                },
                {
                  id: 'mood-expression-distinction',
                  label: '表情区分度',
                  status: 'warning',
                  summary: '发现 2 组高度相似的情绪结果',
                  itemIds: ['mood-e0-a0', 'mood-e0-a1'],
                },
              ],
            },
            items: moodItems,
          },
        ],
        status: 'success',
        categoryId: 'shots',
        renderKind: 'shot-frame',
        meta: { previewHeight: 620 },
      },
      {
        id: 'palette-resource',
        kind: 'resource',
        title: '夏日色板',
        position: { x: 80, y: 80 },
        size: { width: 260, height: 220 },
        prompt: '清透青绿, 柔和暖白',
        result: makeResult('palette-result'),
        history: [makeResult('palette-result')],
        status: 'success',
        categoryId: 'scene',
        creativeResource: {
          id: 'palette-resource',
          kind: 'palette',
          label: '夏日色板',
          description: '清透青绿与柔和暖白',
          promptTokens: ['清透青绿', '柔和暖白'],
          assetIds: ['palette-asset'],
          license: { source: 'E2E fixture', commercialUse: 'allowed' },
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
    edges: [],
    selectedNodeIds: ['capability-source'],
    groups: [],
  },
}

const { app, projectsDir } = await launchNomiApp({
  name: 'nomi-capability-recipes-e2e',
  tempRoot,
  env: { NOMI_SOURCE_RUN: '1', NOMI_CAPABILITY_DIR: path.join(tempRoot, 'capability-core') },
})
const electronProcess = app.process()
const pageErrors = []

try {
  const win = await app.firstWindow()
  win.on('pageerror', (error) => pageErrors.push(String(error?.message || error)))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1400)

  const jimengWebModels = await win.evaluate(() =>
    window.nomiDesktop.modelCatalog.listModels({ vendorKey: 'jimeng-web' }),
  )
  const jimengWebSeedance = jimengWebModels.find(
    (model) => model.modelKey === 'jimeng-web-seedance-2.0',
  )
  const jimengWebImage = jimengWebModels.find(
    (model) => model.modelKey === 'jimeng-web-image',
  )
  assert(
    jimengWebSeedance?.meta?.archetypeId === 'jimeng-web-seedance-2',
    '即梦 Web 真实目录使用只暴露图片/视频参考的受限 Seedance 档案',
  )
  assert(
    jimengWebImage?.kind === 'image'
      && jimengWebImage?.meta?.archetypeId === 'jimeng-web-image',
    '即梦 Web 图片模型已进入真实主进程目录并绑定独立图片档案',
  )

  const created = await win.evaluate(
    async ({ payload, stamp, demoVideoPath, portraitSourcePath, portraitRefinedPath }) => {
      window.localStorage.setItem('nomi:splash:v1', 'seen')
      window.localStorage.setItem('nomi:journey-tour:v1', 'seen')
      window.localStorage.setItem('nomi:canvas-gesture-hint:v1', 'seen')
      // This only makes the seeded catalog entry visible to compatibility selection.
      // No generation action is executed in this test.
      window.nomiDesktop.modelCatalog.upsertVendorApiKey('apimart', {
        apiKey: `e2e-never-send-${stamp}`,
        enabled: true,
      })
      window.nomiDesktop.modelCatalog.upsertModel({
        vendorKey: 'apimart',
        modelKey: 'doubao-seed-2.0-lite',
        labelZh: 'Doubao Seed 2.0 Lite',
        kind: 'text',
        enabled: true,
      })
      const project = window.nomiDesktop.projects.create({
        name: '创作能力 E2E',
        version: 1,
        payload,
      })
      const visionSourceAsset = await window.nomiDesktop.assets.importLocalPath({
        projectId: project.id,
        path: portraitSourcePath,
        kind: 'generated',
        fileName: 'vision-review-source.jpg',
        contentType: 'image/png',
      })
      const visionResultAsset = await window.nomiDesktop.assets.importLocalPath({
        projectId: project.id,
        path: portraitRefinedPath,
        kind: 'generated',
        fileName: 'vision-review-result.jpg',
        contentType: 'image/png',
      })
      const videoAsset = await window.nomiDesktop.assets.importLocalPath({
        projectId: project.id,
        path: demoVideoPath,
        kind: 'generated',
        fileName: 'capability-video-demo.mp4',
        contentType: 'video/mp4',
      })
      const videoUrl = String(videoAsset?.data?.url || '')
      if (!videoUrl) throw new Error('视频 E2E 素材导入失败')
      const videoInspection = await window.nomiDesktop.assets.inspectVideo({ url: videoUrl })
      const record = window.nomiDesktop.projects.read(project.id)
      const result = {
        id: 'capability-video-result',
        type: 'video',
        url: videoUrl,
        createdAt: stamp,
      }
      const blackCheck = videoInspection.checks.find((check) => check.id === 'black-frames')
      const freezeCheck = videoInspection.checks.find((check) => check.id === 'frozen-video')
      const metadata = videoInspection.metadata || {}
      const gridNode = record.payload.generationCanvas.nodes.find((node) => node.id === 'capability-grid')
      const gridCollection = gridNode?.resultCollections?.find((item) => item.id === 'grid-collection')
      const visionSourceUrl = String(visionSourceAsset?.data?.url || '')
      const visionResultUrl = String(visionResultAsset?.data?.url || '')
      if (!gridCollection || !visionSourceUrl || !visionResultUrl) {
        throw new Error('多视角视觉复核 E2E 素材导入失败')
      }
      gridCollection.source = {
        nodeId: 'capability-source',
        resultId: 'source-result',
        label: '来源主体',
        url: visionSourceUrl,
        thumbnailUrl: visionSourceUrl,
      }
      for (const item of gridCollection.items) {
        if (!item.result) continue
        item.result.url = visionResultUrl
        item.result.thumbnailUrl = visionResultUrl
      }
      record.payload.generationCanvas.nodes.push({
        id: 'capability-video',
        kind: 'video',
        title: '视频视觉风格结果',
        position: { x: 1180, y: 690 },
        size: { width: 440, height: 280 },
        prompt: '保持画面主体，应用参考视觉风格。',
        result,
        history: [result],
        resultCollections: [{
          id: 'video-collection',
          recipeId: 'video.look.apply',
          createdAt: stamp,
          quality: {
            version: 1,
            kind: 'video',
            evaluator: 'video-local-v1',
            status: blackCheck?.suspect || freezeCheck?.suspect ? 'warning' : 'unavailable',
            evaluatedAt: stamp,
            checks: [
              {
                id: 'video-output',
                label: '视频结果',
                status: 'pass',
                summary: '已保留可播放的视频结果',
              },
              {
                id: 'video-technical',
                label: '媒体信息',
                status: metadata.kind === 'video' ? 'pass' : 'fail',
                summary: `${metadata.width || 0}x${metadata.height || 0} · ${metadata.durationSeconds || 0} 秒`,
              },
              {
                id: 'video-black-frames',
                label: '黑帧',
                status: blackCheck?.suspect ? 'warning' : 'pass',
                summary: blackCheck?.detail || '黑帧检测完成',
              },
              {
                id: 'video-motion',
                label: '运动连续性',
                status: freezeCheck?.suspect ? 'warning' : 'pass',
                summary: freezeCheck?.detail || '冻结画面检测完成',
              },
              {
                id: 'video-reference-adherence',
                label: '风格与效果符合度',
                status: 'unavailable',
                summary: '本地技术检查不能证明视觉风格符合参考',
              },
            ],
          },
          items: [{
            id: 'video',
            label: '视频结果',
            status: 'success',
            result,
          }],
        }],
        status: 'success',
        categoryId: 'shots',
        renderKind: 'shot-frame',
        meta: { previewHeight: 280 },
      })
      window.nomiDesktop.projects.save(project.id, record)
      return { ...project, videoInspection }
    },
    {
      payload: projectPayload,
      stamp: now,
      demoVideoPath: DEMO_VIDEO_PATH,
      portraitSourcePath: PORTRAIT_SOURCE_PATH,
      portraitRefinedPath: PORTRAIT_REFINED_PATH,
    },
  )
  assert(Boolean(created?.id), '隔离项目创建成功')
  createdProjectId = String(created?.id || '')
  const jimengImageSpendGuard = await win.evaluate(async (projectId) => {
    try {
      await window.nomiDesktop.tasks.run({
        vendor: 'jimeng-web',
        request: {
          kind: 'text_to_image',
          prompt: '零消耗即梦图片运行时验收',
          extras: {
            projectId,
            nodeId: 'jimeng-web-image-e2e',
            modelKey: 'jimeng-web-image',
          },
        },
      })
      return { blocked: false, error: '' }
    } catch (error) {
      return { blocked: true, error: String(error?.message || error) }
    }
  }, createdProjectId)
  assert(
    jimengImageSpendGuard.blocked
      && jimengImageSpendGuard.error.includes('未经用户确认')
      && !jimengImageSpendGuard.error.includes('只支持视频'),
    '即梦 Web 文生图已进入图片运行时分支，并在本地桥调用前被付费确认硬闸拦截',
  )
  assert(created?.videoInspection?.metadata?.kind === 'video', '主进程真实探测本地视频媒体信息')
  const demoFreezeRatio = created?.videoInspection?.checks
    ?.find((check) => check.id === 'frozen-video')
    ?.metrics?.freezeRatio
  assert(
    Number.isFinite(demoFreezeRatio) && demoFreezeRatio > 0.2 && demoFreezeRatio < 0.5,
    `主进程真实计算视频冻结占比：${Math.round((demoFreezeRatio || 0) * 100)}%`,
  )
  assert(await win.evaluate(() => window.nomiDesktop?.runtime?.sourceRun === true), '源码测试运行时已明确暴露')

  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByText('项目库', { exact: false }).first().waitFor({ timeout: stationTimeout() })
  const card = win.locator('[data-project-card]', { hasText: '创作能力 E2E' }).first()
  await card.waitFor({ state: 'visible', timeout: stationTimeout() })
  await card.click()
  await win.waitForTimeout(500)
  const continueButton = win.getByText('继续创作', { exact: false }).first()
  if (await continueButton.count()) await continueButton.click().catch(() => undefined)
  await win.waitForTimeout(2200)
  await win
    .getByRole('button', { name: '生成', exact: false })
    .first()
    .click()
    .catch(() => undefined)
  await win.waitForTimeout(1200)

  const canvas = win.locator('[aria-label="AI 影像创作画布"]')
  await canvas.waitFor({ state: 'visible', timeout: stationTimeout() })
  await win.getByRole('button', { name: '能力组件', exact: true }).click()
  const builtinComponentsTab = win.getByRole('tab', { name: '内置组件', exact: true })
  assert(
    (await builtinComponentsTab.getAttribute('aria-selected')) === 'true',
    '能力组件侧栏默认打开内置组件，不先落到我的技能',
  )
  const grid9ComponentCard = win.locator('[data-capability-recipe-id="image.multiview.grid9"]')
  const customViewComponentCard = win.locator('[data-capability-recipe-id="image.multiview.custom"]')
  const imageTo3dComponentCard = win.locator('[data-capability-recipe-id="image.multiview.reconstruct3d"]')
  await grid9ComponentCard.waitFor({ state: 'visible', timeout: stationTimeout() })
  const componentPaletteScreenshotPath = path.join(evidenceDir, 'skill-component-palette.png')
  const componentPaletteScreenshot = await win.screenshot({ path: componentPaletteScreenshotPath })
  assert(componentPaletteScreenshot.byteLength > 20_000, '能力组件面板展开截图非空')
  assert(
    (await grid9ComponentCard.getAttribute('data-canvas-skill-enabled')) === 'true',
    '内置九宫格配方声明为独立画布组件',
  )
  assert(await customViewComponentCard.isVisible(), '自定义机位作为独立组件可见')
  assert(await imageTo3dComponentCard.isVisible(), '图片转 3D 作为独立组件可见')
  assert(
    await grid9ComponentCard.getByText('图像', { exact: true }).isVisible()
      && await imageTo3dComponentCard.getByText('3D', { exact: true }).isVisible(),
    '原子组件只显示自身需要的 Provider 类型',
  )
  await grid9ComponentCard.locator('[data-skill-use="true"]').click()
  const canvasSkillNode = win.locator('[data-canvas-skill-node="true"]', { hasText: '多机位九宫格' }).first()
  await canvasSkillNode.waitFor({ state: 'visible', timeout: stationTimeout() })
  const multiviewRecipeButton = canvasSkillNode.getByRole(
    'button',
    { name: '配置并运行 多机位九宫格', exact: true },
  )
  assert(await multiviewRecipeButton.isVisible(), '原子组件节点在画布展示自身配方')
  assert(
    (await canvasSkillNode.getByRole('button', { name: '自定义机位', exact: true }).count()) === 0
      && (await canvasSkillNode.getByRole('button', { name: '图片转 3D', exact: true }).count()) === 0,
    '九宫格节点不再夹带同一父 Skill 的其他配方',
  )
  assert(await canvasSkillNode.getByRole('button', { name: /用 Agent 推进/ }).isVisible(), 'SkillNode 提供画布 Agent 入口')
  assert(
    await canvasSkillNode.getByText('等待连接图片输入', { exact: true }).isVisible(),
    'SkillNode 明确显示类型化输入连线状态',
  )
  assert(
    (await multiviewRecipeButton.getAttribute('data-recipe-ready')) === 'false'
      && await multiviewRecipeButton.isDisabled(),
    '未连接图片时九宫格配方明确标记为不可执行',
  )
  assert(
    await multiviewRecipeButton.getByText('缺图片', { exact: true }).isVisible(),
    '配方按钮直接显示缺少的输入类型',
  )
  const componentNodeScreenshotPath = path.join(evidenceDir, 'skill-component-node.png')
  const componentNodeScreenshot = await win.screenshot({ path: componentNodeScreenshotPath })
  assert(componentNodeScreenshot.byteLength > 20_000, '画布能力组件节点截图非空')
  await win.getByRole('button', { name: '收起侧栏', exact: true }).first().click()
  await win.getByRole('button', { name: '适应视图', exact: true }).click()
  await win.waitForTimeout(700)
  const sourceNode = win.locator('[data-node-id="capability-source"]')
  const sourceOutputHandle = sourceNode.locator('.generation-canvas-v2-node__handle--output')
  const skillNodeShell = canvasSkillNode.locator('xpath=ancestor::article[1]')
  const skillInputHandle = skillNodeShell.locator('.generation-canvas-v2-node__handle--input')
  await sourceOutputHandle.hover()
  await win.mouse.down()
  await win.waitForFunction(() => (
    Array.from(document.querySelectorAll(
      '[data-kind="skill"] .generation-canvas-v2-node__handle--input',
    )).some((element) => element.getAttribute('aria-label') === '连接到此节点')
  ), undefined, { timeout: 4000 })
  const skillInputBox = await skillInputHandle.boundingBox()
  assert(Boolean(skillInputBox), 'SkillNode 输入端口具有可交互尺寸')
  await win.mouse.move(
    skillInputBox.x + skillInputBox.width / 2,
    skillInputBox.y + skillInputBox.height / 2,
  )
  await win.mouse.up()
  await canvasSkillNode.getByText('已连接 1 个输入', { exact: true }).waitFor({
    state: 'visible',
    timeout: 4000,
  })
  assert(
    await canvasSkillNode.getByText('已连接 1 个输入', { exact: true }).isVisible(),
    '素材节点可连接到 SkillNode 输入',
  )
  await win.waitForFunction(
    (button) => button?.getAttribute('data-recipe-ready') === 'true' && !button.disabled,
    await multiviewRecipeButton.elementHandle(),
    { timeout: 4000 },
  )
  assert(
    (await multiviewRecipeButton.getAttribute('data-recipe-ready')) === 'true'
      && !(await multiviewRecipeButton.isDisabled()),
    '连接正确图片后九宫格配方立即可执行',
  )
  assert(
    await multiviewRecipeButton.getByText('已就绪', { exact: true }).isVisible(),
    '配方按钮直接显示已就绪状态',
  )
  await multiviewRecipeButton.click()
  const skillInspector = win.locator('[data-capability-recipe-inspector="true"]')
  await skillInspector.waitFor({ state: 'visible', timeout: stationTimeout() })
  assert(
    (await skillInspector.getByLabel('能力配方').textContent())?.includes('多机位九宫格'),
    'SkillNode 打开共享配方面板并预选自身配方',
  )
  assert(
    await skillInspector.getByText('人像源图', { exact: true }).isVisible(),
    'SkillNode 将已连接素材预选为配方来源',
  )
  await win.keyboard.press('Escape')
  await skillInspector.waitFor({ state: 'hidden', timeout: 4000 })
  await canvasSkillNode.click({ position: { x: 12, y: 12 } })
  await win.getByRole('button', { name: '适应视图', exact: true }).click()
  await win.waitForTimeout(500)
  const collection = win.locator('[data-capability-result-collection="grid-collection"]')
  await collection.waitFor({ state: 'visible', timeout: stationTimeout() })
  assert((await collection.getAttribute('data-collection-columns')) === '3', '九个结果按 3 列网格展示')
  assert((await collection.getByRole('listitem').count()) === 9, '九宫格保留九个有序结果')

  const gridNode = win.locator('[data-node-id="capability-grid"]')
  const qualityButton = gridNode.getByRole('button', { name: '查看质量报告：需检查' })
  await qualityButton.click()
  const qualityReport = gridNode.locator('[data-capability-quality-report="grid9"]')
  await qualityReport.waitFor({ state: 'visible', timeout: 4000 })
  assert(await qualityReport.getByText('视角差异', { exact: true }).isVisible(), '九宫格可展开查看视角质量诊断')
  assert(await qualityReport.getByText('主体连续性代理', { exact: true }).isVisible(), '质量报告明确展示连续性代理指标')
  const humanReview = qualityReport.locator('[data-quality-human-review]')
  const humanReviewNote = humanReview.getByLabel('人工验收备注')
  await humanReviewNote.fill('右前侧主体身份需要重新生成')
  await humanReview.getByRole('button', { name: '拒绝', exact: true }).click()
  await humanReview.waitFor({ state: 'visible' })
  assert(
    (await humanReview.getAttribute('data-quality-human-review')) === 'rejected',
    '人工拒绝结论独立写入质量报告',
  )
  assert(
    (await qualityButton.getAttribute('data-capability-quality-status')) === 'warning',
    '人工结论不覆盖自动质量状态',
  )
  await win.keyboard.press('Meta+z')
  await win.waitForFunction(
    () => document.querySelector('[data-capability-quality-report="grid9"] [data-quality-human-review]')
      ?.getAttribute('data-quality-human-review') === 'unreviewed',
    undefined,
    { timeout: 4000 },
  )
  assert(
    (await humanReview.getAttribute('data-quality-human-review')) === 'unreviewed',
    '撤销只回退人工结论并保留质量报告',
  )
  await humanReviewNote.fill('人工确认主体、构图和机位可用')
  await humanReview.getByRole('button', { name: '通过', exact: true }).click()
  assert(
    (await humanReview.getAttribute('data-quality-human-review')) === 'accepted',
    '人工通过结论可在同一报告原位重写',
  )
  await win.waitForTimeout(1200)
  const persistedHumanReview = await win.evaluate((projectId) => {
    const record = window.nomiDesktop.projects.read(projectId)
    return record?.payload?.generationCanvas?.nodes
      ?.find((node) => node.id === 'capability-grid')
      ?.resultCollections?.find((collection) => collection.id === 'grid-collection')
      ?.quality?.humanReview
  }, created.id)
  assert(
    persistedHumanReview?.verdict === 'accepted'
      && persistedHumanReview?.note === '人工确认主体、构图和机位可用',
    '人工视觉验收随项目持久化且保留备注',
  )
  const visionReviewModel = qualityReport.getByLabel('视觉复核模型')
  await visionReviewModel.waitFor({ state: 'visible', timeout: 4000 })
  const visionReviewModelLabels = await visionReviewModel.locator('option').allTextContents()
  assert(
    visionReviewModelLabels.some((label) => label.includes('Doubao Seed 2.0 Lite')),
    `已连接 Doubao Seed 2.0 Lite 自动进入视觉复核模型下拉：${visionReviewModelLabels.join('、')}`,
  )
  assert(
    (await win.getByText('视觉模型复核多视角', { exact: true }).count()) === 0,
    '打开质量报告不会自动触发视觉模型费用确认',
  )
  await qualityReport.getByRole('button', { name: '视觉模型复核', exact: true }).click()
  const visionSpendMessage = win.getByText('将把 1 张来源图和 9 张结果图发送给', { exact: false })
  await visionSpendMessage.waitFor({ state: 'visible', timeout: 4000 })
  const visionSpendDialog = visionSpendMessage.locator('..')
  assert(
    await visionSpendDialog.getByText('1 次批量视觉复核', { exact: true }).isVisible(),
    '视觉复核在发送前明确为一次批量模型调用',
  )
  assert(
    await visionSpendDialog.getByText('10 张本地图片', { exact: true }).isVisible(),
    '视觉复核费用确认明确本地附件数量',
  )
  await visionSpendDialog.getByRole('button', { name: '取消', exact: true }).click()
  assert((await collection.locator('[data-result-quality-status="warning"]').count()) === 2, '异常机位直接显示质量标记')
  const qualityScreenshotPath = path.join(evidenceDir, 'capability-quality-report.png')
  const qualityScreenshot = await win.screenshot({ path: qualityScreenshotPath })
  assert(qualityScreenshot.byteLength > 20_000, '质量报告展开截图非空')
  await qualityButton.click()

  const panoramaQualityButton = win.getByRole('button', { name: '查看质量报告：未通过' })
  await panoramaQualityButton.click()
  const panoramaQualityReport = win.locator('[data-capability-quality-report="panorama"]')
  await panoramaQualityReport.waitFor({ state: 'visible', timeout: 4000 })
  assert(await panoramaQualityReport.getByText('左右接缝', { exact: true }).isVisible(), '单结果全景节点可查看左右接缝诊断')
  assert(await panoramaQualityReport.getByText('极点风险', { exact: true }).isVisible(), '全景质量报告包含极点风险')
  const panoramaScreenshotPath = path.join(evidenceDir, 'panorama-quality-report.png')
  const panoramaScreenshot = await win.screenshot({ path: panoramaScreenshotPath })
  assert(panoramaScreenshot.byteLength > 20_000, '全景质量报告展开截图非空')
  await panoramaQualityButton.click()

  const portraitNode = win.locator('[data-node-id="capability-portrait"]')
  const portraitQualityButton = portraitNode.getByRole('button', { name: '查看质量报告：未完成' })
  await portraitQualityButton.click()
  const portraitQualityReport = portraitNode.locator('[data-capability-quality-report="portrait"]')
  await portraitQualityReport.waitFor({ state: 'visible', timeout: 4000 })
  assert(await portraitQualityReport.getByText('身份保护', { exact: true }).isVisible(), '人像报告明确区分身份保护未验证状态')
  assert(await portraitQualityReport.getByText('肤质与细节', { exact: true }).isVisible(), '人像报告包含肤质细节检查')
  await portraitQualityButton.click()

  const styleNode = win.locator('[data-node-id="capability-style"]')
  const styleQualityButton = styleNode.getByRole('button', { name: '查看质量报告：需检查' })
  await styleQualityButton.click()
  const styleQualityReport = styleNode.locator('[data-capability-quality-report="style"]')
  await styleQualityReport.waitFor({ state: 'visible', timeout: 4000 })
  assert(await styleQualityReport.getByText('内容保留代理', { exact: true }).isVisible(), '风格报告显示主体与构图保留代理')
  assert(await styleQualityReport.getByText('风格迁移代理', { exact: true }).isVisible(), '风格报告显示向参考图靠近程度')
  const styleQualityScreenshotPath = path.join(evidenceDir, 'style-quality-report.png')
  const styleQualityScreenshot = await win.screenshot({ path: styleQualityScreenshotPath })
  assert(styleQualityScreenshot.byteLength > 20_000, '风格质量报告展开截图非空')
  await styleQualityButton.click()

  const videoNode = win.locator('[data-node-id="capability-video"]')
  await videoNode.waitFor({ state: 'visible', timeout: 4000 })
  assert((await videoNode.locator('video').count()) > 0, '视频配方结果在画布中使用视频预览')
  const videoQualityButton = videoNode.locator('[data-capability-quality-status]').first()
  await videoQualityButton.click()
  const videoQualityReport = videoNode.locator('[data-capability-quality-report="video"]')
  await videoQualityReport.waitFor({ state: 'visible', timeout: 4000 })
  assert(await videoQualityReport.getByText('媒体信息', { exact: true }).isVisible(), '视频报告显示时长和尺寸检查')
  assert(await videoQualityReport.getByText('运动连续性', { exact: true }).isVisible(), '视频报告显示冻结画面检查')
  assert(await videoQualityReport.getByText('风格与效果符合度', { exact: true }).isVisible(), '视频报告诚实标记参考符合度边界')
  const videoQualityScreenshotPath = path.join(evidenceDir, 'video-quality-report.png')
  const videoQualityScreenshot = await win.screenshot({ path: videoQualityScreenshotPath })
  assert(videoQualityScreenshot.byteLength > 20_000, '视频质量报告展开截图非空')
  await videoQualityButton.click()

  const moodNode = win.locator('[data-node-id="capability-mood"]')
  const moodCollection = moodNode.locator('[data-capability-result-collection="mood-collection"]')
  await moodCollection.waitFor({ state: 'visible', timeout: 4000 })
  assert((await moodCollection.getAttribute('data-collection-columns')) === '5', '完整情绪矩阵固定为 5 列')
  assert((await moodCollection.getByRole('listitem').count()) === 25, '情绪矩阵显示 25 个有序坐标')
  assert(await moodNode.getByText('能量 0 → 4', { exact: true }).isVisible(), '情绪矩阵显示能量轴')
  assert(await moodNode.getByText('亲和 0 → 4', { exact: true }).isVisible(), '情绪矩阵显示亲和轴')
  const moodQualityButton = moodNode.getByRole('button', { name: '查看质量报告：需检查' })
  await moodQualityButton.click()
  const moodQualityReport = moodNode.locator('[data-capability-quality-report="mood"]')
  await moodQualityReport.waitFor({ state: 'visible', timeout: 4000 })
  assert(await moodQualityReport.getByText('身份保护', { exact: true }).isVisible(), '情绪报告保留身份保护检查')
  assert(await moodQualityReport.getByText('表情区分度', { exact: true }).isVisible(), '情绪报告包含表情区分度')
  await moodQualityButton.click()

  await moodNode.getByRole('button', { name: '与原图对比' }).click()
  const comparisonDialog = win.locator('[data-portrait-comparison-dialog="true"]')
  await comparisonDialog.waitFor({ state: 'visible', timeout: 4000 })
  const sourceComparison = comparisonDialog.locator('[data-comparison-image="source"]')
  const resultComparison = comparisonDialog.locator('[data-comparison-image="result"]')
  const portraitComparisonScreenshotPath = path.join(evidenceDir, 'portrait-comparison.png')
  const portraitComparisonScreenshot = await win.screenshot({ path: portraitComparisonScreenshotPath })
  assert(portraitComparisonScreenshot.byteLength > 20_000, '人像对比截图非空')
  const comparisonGeometry = await comparisonDialog.evaluate((element) => (
    Array.from(element.querySelectorAll('[data-comparison-image]')).map((image) => {
      const rect = image.getBoundingClientRect()
      return { id: image.getAttribute('data-comparison-image'), width: rect.width, height: rect.height }
    })
  ))
  assert(
    comparisonGeometry.length === 2 && comparisonGeometry.every((rect) => rect.width > 0 && rect.height > 0),
    `原图与当前情绪结果并排可见：${JSON.stringify(comparisonGeometry)}`,
  )
  await comparisonDialog.getByRole('button', { name: '放大对比图', exact: true }).click()
  assert(
    (await sourceComparison.getAttribute('data-comparison-zoom')) === '1.25'
      && (await resultComparison.getAttribute('data-comparison-zoom')) === '1.25',
    '原图与结果使用同一缩放比例',
  )
  await comparisonDialog.getByRole('button', { name: '关闭原图对比' }).click()

  await collection.getByRole('listitem').first().dblclick()
  const lightbox = win.locator('[data-storyboard-media-lightbox="image"]')
  await lightbox.waitFor({ state: 'visible', timeout: 4000 })
  assert(await lightbox.isVisible(), '双击结果可放大预览')
  await win.getByRole('button', { name: '关闭预览' }).click()

  await sourceNode.click({ position: { x: 40, y: 40 } })
  const capabilityTrigger = win.locator('[data-capability-recipe-trigger="true"]')
  await capabilityTrigger.waitFor({ state: 'visible', timeout: 4000 })
  assert(!(await capabilityTrigger.isDisabled()), '选中节点后创作能力入口可用')
  const triggerOverlap = await win.evaluate(() => {
    const trigger = document.querySelector('[data-capability-recipe-trigger="true"]')?.getBoundingClientRect()
    const agent = document.querySelector('[aria-label="生成区 AI 侧栏"]')?.getBoundingClientRect()
    if (!trigger || !agent) return false
    return (
      trigger.left < agent.right &&
      trigger.right > agent.left &&
      trigger.top < agent.bottom &&
      trigger.bottom > agent.top
    )
  })
  assert(!triggerOverlap, '创作能力入口不与 Agent 侧栏重叠')
  await win.evaluate(() => {
    window.dispatchEvent(new CustomEvent('nomi-open-capability-recipes', {
      detail: { nodeId: 'capability-source' },
    }))
  })
  const inspector = win.locator('[data-capability-recipe-inspector="true"]')
  await inspector.waitFor({ state: 'visible', timeout: stationTimeout() })
  assert(await inspector.getByText('人像源图', { exact: true }).isVisible(), '分镜行可通过节点事件直接打开对应创作能力')
  await win.keyboard.press('Escape')
  await inspector.waitFor({ state: 'hidden', timeout: 4000 })
  assert(!(await inspector.isVisible()), '创作能力事件入口仍可正常关闭')
  await capabilityTrigger.click()

  await inspector.waitFor({ state: 'visible', timeout: stationTimeout() })
  assert(await win.getByLabel('模型与模式').isEnabled(), '兼容模型模式可选')
  const outputCount = win.getByLabel('输出数量')
  assert((await outputCount.inputValue()) === '9' && (await outputCount.isDisabled()), '九宫格输出数固定为 9')

  const recipeSelect = win.getByLabel('能力配方')
  await recipeSelect.click()
  assert(
    await win.getByRole('option', { name: /图生视频·视觉风格/ }).isVisible(),
    '配方目录明确标识图生视频视觉风格',
  )
  assert(
    await win.getByRole('option', { name: /图生视频·效果参考/ }).isVisible(),
    '配方目录明确标识图生视频效果参考',
  )
  const videoEditOption = win.getByRole('option', { name: /视频转视频·视觉风格/ })
  assert(await videoEditOption.isVisible(), '配方目录独立列出视频转视频视觉风格')
  assert(
    await win.getByRole('option', { name: /视频转视频·时序效果/ }).isVisible(),
    '配方目录独立列出视频转视频时序效果',
  )
  await videoEditOption.click()
  const videoEditGuidance = inspector.locator('[data-capability-model-guidance="video.edit.look"]')
  await videoEditGuidance.waitFor({ state: 'visible', timeout: 4000 })
  assert(await videoEditGuidance.getByText('KIE', { exact: false }).isVisible(), '无 v2v 模型时提示连接 KIE HappyHorse')
  assert(
    await videoEditGuidance.getByRole('button', { name: /去模型接入：KIE · HappyHorse/ }).isVisible(),
    'v2v 缺模型提示提供直接模型接入入口',
  )
  await videoEditGuidance.getByRole('button', { name: /去模型接入：KIE · HappyHorse/ }).click()
  const modelSettings = win.getByRole('dialog', { name: '模型设置' })
  await modelSettings.waitFor({ state: 'visible', timeout: 4000 })
  const generationProviders = modelSettings.getByRole('button', { name: /接入生成模型/ })
  if ((await generationProviders.getAttribute('aria-expanded')) !== 'true') {
    await generationProviders.click()
  }
  const kieCard = modelSettings.getByRole('button', { name: /Kie\.ai.*待接入/ })
  if ((await kieCard.getAttribute('aria-expanded')) !== 'true') {
    await kieCard.click()
  }
  const kieKeyInput = modelSettings.getByLabel('Kie.ai API Key')
  await kieKeyInput.fill(`e2e-never-send-kie-${now}`)
  await kieKeyInput.locator('..').getByRole('button', { name: '解锁' }).click()
  await videoEditGuidance.waitFor({ state: 'hidden', timeout: 4000 })
  await inspector.getByText('HappyHorse 1.0 · 视频编辑', { exact: true }).waitFor({
    state: 'visible',
    timeout: 4000,
  })
  assert(await win.getByLabel('模型与模式').isEnabled(), '接入 KIE 后当前配方无需重启即可选择模型')
  assert(
    await inspector.getByText('HappyHorse 1.0 · 视频编辑', { exact: true }).isVisible(),
    '接入 KIE 后当前创作抽屉原位刷新为 HappyHorse 视频编辑',
  )
  await win.evaluate(() => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  await modelSettings.waitFor({ state: 'hidden', timeout: 4000 })

  await recipeSelect.click()
  await win.getByRole('option', { name: /图片转 3D/ }).click()
  const model3dGuidance = inspector.locator('[data-capability-model-guidance="image.multiview.reconstruct3d"]')
  await model3dGuidance.waitFor({ state: 'visible', timeout: 4000 })
  assert(await model3dGuidance.getByText('RunningHub', { exact: false }).isVisible(), '无图生 3D 模型时提示 RunningHub 候选')
  assert(
    await model3dGuidance.getByText('Enterprise-Shared', { exact: false }).isVisible(),
    '图生 3D 提示明确企业级共享 Key 要求',
  )

  await recipeSelect.click()
  await win.getByRole('option', { name: /多机位九宫格/ }).click()
  await win.waitForTimeout(200)
  assert(
    await inspector.locator('[data-capability-experimental-warning="true"]').isVisible(),
    '通用图片模型运行九宫格时明确标为实验能力',
  )
  assert(
    await inspector.getByText('逐机位生成（9 次）', { exact: true }).isVisible()
      && await inspector.getByText('保留原场景', { exact: true }).isVisible(),
    '九宫格默认逐机位生成并保留原场景',
  )

  const autoVisionReview = inspector.getByLabel('生成后自动视觉复核')
  await autoVisionReview.waitFor({ state: 'visible', timeout: 4000 })
  assert(await autoVisionReview.isEnabled(), '已连接视觉模型时九宫格可启用生成后自动复核')
  await autoVisionReview.check()
  const autoVisionReviewModel = inspector.getByLabel('视觉复核模型')
  await autoVisionReviewModel.waitFor({ state: 'visible', timeout: 4000 })
  await autoVisionReviewModel.click()
  assert(
    await win.getByRole('option', { name: /Doubao Seed 2\.0 Lite/ }).isVisible(),
    '自动复核仅列出已连接且支持图片输入的文本模型',
  )
  await win.keyboard.press('Escape')
  assert(
    await inspector.getByText('整批增加 1 次多图请求，复核失败不会重新生成。', { exact: true }).isVisible(),
    '自动复核在提交前明示额外请求和无重试语义',
  )

  await inspector.getByRole('button', { name: '生成新结果' }).click()
  const spendMessage = win.getByText('将生成 9 张画面', { exact: false })
  await spendMessage.waitFor({ state: 'visible', timeout: 4000 })
  const spendDialog = spendMessage.locator('..')
  assert(await spendMessage.isVisible(), '精确九宫格费用按九次逐机位请求估算')
  assert(
    await spendDialog.getByText('9 次独立请求', { exact: false }).isVisible(),
    '九宫格确认框说明真实逐机位请求数量',
  )
  assert(
    await spendDialog.getByText('生成完成后额外执行 1 次批量视觉复核', { exact: false }).isVisible()
      && await spendDialog.getByText('整批 1 次', { exact: false }).isVisible(),
    '生成费用确认同时披露自动视觉复核的一次额外调用',
  )
  await spendDialog.getByRole('button', { name: '取消', exact: true }).click()
  await autoVisionReview.uncheck()

  const gridMode = inspector.getByLabel('生成方式')
  await gridMode.click()
  await win.getByRole('option', { name: '接触表草稿（1 次）', exact: true }).click()
  await inspector.getByRole('button', { name: '生成新结果' }).click()
  const draftSpendMessage = win.getByText('将生成 1 张画面', { exact: false })
  await draftSpendMessage.waitFor({ state: 'visible', timeout: 4000 })
  const draftSpendDialog = draftSpendMessage.locator('..')
  assert(
    await draftSpendDialog.getByText('1 次请求，本地拆分为 9 个结果', { exact: true }).isVisible(),
    '接触表草稿明确说明一次请求和本地拆分数量',
  )
  await draftSpendDialog.getByRole('button', { name: '取消', exact: true }).click()

  await win.getByLabel('能力配方').click()
  await win.getByRole('option', { name: /图像风格迁移/ }).click()
  const generateButton = inspector.getByRole('button', { name: '生成新结果' })
  assert(await inspector.getByText('夏日色板', { exact: true }).isVisible(), '风格配方接受色板资源')
  assert(await generateButton.isDisabled(), '未选择必需资源时在费用确认前禁用生成')
  await inspector.getByText('夏日色板', { exact: true }).click()
  assert(await generateButton.isEnabled(), '选择色板资源后配方就绪')

  await win.getByLabel('能力配方').click()
  await win.getByRole('option', { name: /人像真实化/ }).click()
  assert(await inspector.getByText('真实化强度', { exact: true }).isVisible(), '人像真实化控制项可见')
  assert(await inspector.getByText('锁定身份', { exact: true }).isVisible(), '身份保护默认控制项可见')

  await win.getByLabel('能力配方').click()
  await win.getByRole('option', { name: /5×5 人物情绪/ }).click()
  const moodMode = inspector.getByLabel('生成范围')
  await moodMode.click()
  await win.getByRole('option', { name: '完整 5×5', exact: true }).click()
  await win.waitForTimeout(200)
  assert((await outputCount.inputValue()) === '25' && (await outputCount.isDisabled()), '完整情绪矩阵输出数固定为 25')
  assert(
    await inspector.getByText('25 次独立请求 · 最多 2 路并发', { exact: true }).isVisible(),
    '情绪矩阵在执行前显示真实请求数和并发上限',
  )
  assert(
    (await inspector.locator('[data-mood-coordinate][aria-pressed="true"]').count()) === 25,
    '完整模式高亮全部 25 个情绪坐标',
  )
  assert((await inspector.getByText('平静到激动', { exact: true }).count()) === 0, '完整矩阵隐藏不适用的单点能量控制')
  await inspector.getByRole('button', { name: '生成新结果' }).click()
  const moodSpendMessage = win.getByText('将生成 25 张画面', { exact: false })
  await moodSpendMessage.waitFor({ state: 'visible', timeout: 4000 })
  const moodSpendDialog = moodSpendMessage.locator('..')
  assert(
    await moodSpendDialog.getByText('25 次独立请求 · 最多 2 路并发', { exact: true }).isVisible(),
    '付费确认再次明确 25 次独立请求',
  )
  await moodSpendDialog.getByRole('button', { name: '取消', exact: true }).click()

  await win.getByLabel('能力配方').click()
  await win.getByRole('option', { name: /自定义机位/ }).click()
  await outputCount.fill('3')
  await win.waitForTimeout(200)
  assert((await inspector.locator('input[aria-label$="方位角"]').count()) === 3, '自定义机位按输出数显示三行参数')
  const geometry = await inspector.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    rect: element.getBoundingClientRect().toJSON(),
    viewportWidth: window.innerWidth,
  }))
  assert(geometry.scrollWidth <= geometry.clientWidth + 1, '配方抽屉没有横向溢出')
  assert(geometry.rect.right <= geometry.viewportWidth + 1, '配方抽屉完整位于窗口内')

  await inspector.getByRole('button', { name: '保存资源' }).last().click()
  await inspector.getByLabel('名称').fill('E2E 测试风格')
  await inspector.getByLabel('描述').fill('自然高光与细颗粒')
  await inspector.getByLabel('提示词标签').fill('natural highlight, fine grain')
  await inspector.getByRole('button', { name: '保存资源' }).last().click()
  await win.waitForTimeout(1000)
  const resourceNode = win.locator('[data-kind="resource"]', { hasText: 'E2E 测试风格' }).first()
  await resourceNode.waitFor({ state: 'visible', timeout: stationTimeout() })
  assert(await resourceNode.isVisible(), '保存资源通过真实共享动作落成画布节点')

  const screenshotPath = path.join(evidenceDir, 'capability-recipes.png')
  const screenshot = await win.screenshot({ path: screenshotPath })
  assert(screenshot.byteLength > 20_000, 'Electron 截图非空')
  assert(pageErrors.length === 0, `渲染进程无 pageerror${pageErrors.length ? `：${pageErrors.join(' | ')}` : ''}`)
  runPassed = true

  console.log(`\nCAPABILITY RECIPES E2E PASS: ${passed} assertions`)
  if (evidenceUsesTempRoot) {
    console.log('Evidence: transient evidence will be cleaned after this successful run')
  } else {
    console.log(`Evidence: ${screenshotPath}`)
    console.log(`Component palette evidence: ${componentPaletteScreenshotPath}`)
    console.log(`Component node evidence: ${componentNodeScreenshotPath}`)
    console.log(`Quality evidence: ${qualityScreenshotPath}`)
    console.log(`Panorama evidence: ${panoramaScreenshotPath}`)
    console.log(`Style quality evidence: ${styleQualityScreenshotPath}`)
    console.log(`Portrait comparison evidence: ${portraitComparisonScreenshotPath}`)
    console.log(`Video quality evidence: ${videoQualityScreenshotPath}`)
  }
} catch (error) {
  console.error(`\n${error?.stack || error}`)
  process.exitCode = 1
} finally {
  const closed = await Promise.race([
    app.close().then(
      () => true,
      () => false,
    ),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (!closed && electronProcess.exitCode == null) electronProcess.kill('SIGKILL')
  if (runPassed && projectExportDir && createdProjectId) {
    try {
      const exportRelative = path.relative(tempRoot, projectExportDir)
      if (exportRelative === '' || (!exportRelative.startsWith('..') && !path.isAbsolute(exportRelative))) {
        throw new Error('项目导出目录不能位于 E2E 临时目录内')
      }
      const sourceProjectDir = fs.readdirSync(projectsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(projectsDir, entry.name))
        .find((candidate) => {
          const manifestPath = path.join(candidate, '.nomi', 'project.json')
          if (!fs.existsSync(manifestPath)) return false
          try {
            return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).id === createdProjectId
          } catch {
            return false
          }
        })
      if (!sourceProjectDir) throw new Error(`找不到隔离测试项目：${createdProjectId}`)
      fs.rmSync(projectExportDir, { recursive: true, force: true })
      fs.mkdirSync(path.dirname(projectExportDir), { recursive: true })
      fs.cpSync(sourceProjectDir, projectExportDir, { recursive: true })
      console.log(`Inspection project export: ${projectExportDir}`)
    } catch (error) {
      console.error(`项目副本导出失败：${error?.message || error}`)
      process.exitCode = 1
    }
  }
  if (!evidenceUsesTempRoot || runPassed) fs.rmSync(tempRoot, { recursive: true, force: true })
}

process.exit(process.exitCode ?? 0)
