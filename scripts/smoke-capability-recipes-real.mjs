// Gate 8 real-provider harness. Default is a zero-spend compatibility inspection.
// Paid execution requires NOMI_ALLOW_PAID_EVAL=1 (or --allow-paid) and still
// confirms every batch through Nomi's product spend dialog.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import {
  CAPABILITY_REAL_SMOKE_HELP,
  classifyProviderFailure,
  createSmokeState,
  describeMissingCompatibleModel,
  effectiveProviderCooldownMs,
  extractSmokePhaseTimings,
  markSmokeCaseSucceeded,
  mergeSmokeState,
  parseSmokeConfig,
  parseSmokeModelOptionValue,
  plannedProviderCallsForRecipe,
  providerCallsFromSpendDialog,
  sanitizeSmokeReport,
  smokeQualityDisposition,
  smokePatternMatches,
  smokeHelpRequested,
  shouldRetryProviderFailure,
} from './capability-real-smoke-policy.mjs'

if (smokeHelpRequested()) {
  console.log(CAPABILITY_REAL_SMOKE_HELP)
  process.exit(0)
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = parseSmokeConfig()
const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
const runDir = config.runDir
  ? path.resolve(process.cwd(), config.runDir)
  : path.join(repoRoot, 'evals', 'runs', `${stamp}-capability-recipes-real-smoke`)
const evidenceDir = path.join(runDir, 'evidence')
const statePath = path.join(runDir, 'state.json')
const reportPath = path.join(runDir, 'report.json')
const reportMarkdownPath = path.join(runDir, 'report.md')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-capability-real-smoke-'))
fs.mkdirSync(evidenceDir, { recursive: true })

const RECIPE_CASES = {
  'image.multiview.custom': {
    label: '自定义机位',
    sourceNodeId: 'real-smoke-image-source',
    expectedOutputs: 1,
  },
  'image.multiview.grid9': {
    label: '九宫格多视角',
    sourceNodeId: 'real-smoke-image-source',
    expectedOutputs: 9,
  },
  'scene.panorama.2to1': {
    label: '2:1 全景',
    sourceNodeId: 'real-smoke-image-source',
    expectedOutputs: 1,
  },
  'portrait.refine': {
    label: '人像真实化',
    sourceNodeId: 'real-smoke-portrait-source',
    expectedOutputs: 1,
  },
  'portrait.mood': {
    label: '5×5 人物情绪',
    sourceNodeId: 'real-smoke-portrait-source',
    expectedOutputs: 5,
  },
  'image.style.transfer': {
    label: '图像风格迁移',
    sourceNodeId: 'real-smoke-image-source',
    resourceLabel: 'Smoke style',
    expectedOutputs: 1,
  },
  'video.look.apply': {
    label: '图生视频·视觉风格',
    sourceNodeId: 'real-smoke-image-source',
    resourceLabel: 'Smoke style',
    expectedOutputs: 1,
  },
  'video.effect.reference': {
    label: '图生视频·效果参考',
    sourceNodeId: 'real-smoke-image-source',
    resourceLabel: 'Smoke effect',
    expectedOutputs: 1,
  },
  'video.edit.look': {
    label: '视频转视频·视觉风格',
    sourceNodeId: 'real-smoke-video-source',
    resourceLabel: 'Smoke style',
    expectedOutputs: 1,
  },
  'video.edit.effect': {
    label: '视频转视频·时序效果',
    sourceNodeId: 'real-smoke-video-source',
    resourceLabel: 'Smoke effect',
    expectedOutputs: 1,
  },
  'image.multiview.reconstruct3d': {
    label: '图生 3D',
    sourceNodeId: 'real-smoke-image-source',
    expectedOutputs: 1,
  },
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, `${JSON.stringify(sanitizeSmokeReport(value), null, 2)}\n`)
  fs.renameSync(tempPath, filePath)
}

function persistState(state) {
  state.updatedAt = new Date().toISOString()
  writeJsonAtomic(statePath, state)
}

function caseByRecipe(recipeId) {
  const definition = RECIPE_CASES[recipeId]
  if (!definition) throw new Error(`Missing real smoke fixture for ${recipeId}`)
  const expectedOutputs = recipeId === 'image.multiview.custom'
    ? config.customViewCount
    : definition.expectedOutputs
  return {
    ...definition,
    expectedOutputs,
    plannedProviderCalls: recipeId === 'image.multiview.custom'
      ? expectedOutputs
      : plannedProviderCallsForRecipe(recipeId),
  }
}

function makeDataUrl(filePath, mimeType) {
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`
}

function makeTinyVideo() {
  const outputPath = path.join(tempRoot, 'source.mp4')
  const systemFfmpeg = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : null
  const ffmpegPath = systemFfmpeg || require('@ffmpeg-installer/ffmpeg').path
  execFileSync(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=0x334455:s=320x180:r=12:d=2',
    '-vf', 'drawbox=x=20+70*t:y=55:w=52:h=70:color=0xe8a45d:t=fill',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ])
  return makeDataUrl(outputPath, 'video/mp4')
}

function projectPayload() {
  const now = Date.now()
  const portraitPath = path.join(repoRoot, 'evals/fixtures/portrait-woman-public-domain.jpg')
  const requestedRobotPath = path.join(repoRoot, 'src/workbench/onboarding/assets/robot/robot.jpg')
  const requestedStylePath = path.join(repoRoot, 'src/workbench/onboarding/assets/robot/shot-2.jpg')
  const requestedEffectPath = path.join(repoRoot, 'src/workbench/onboarding/assets/robot/shot-4.jpg')
  const robotFixtureAvailable = fs.existsSync(requestedRobotPath)
  const robotPath = robotFixtureAvailable ? requestedRobotPath : portraitPath
  const stylePath = fs.existsSync(requestedStylePath) ? requestedStylePath : portraitPath
  const effectPath = fs.existsSync(requestedEffectPath) ? requestedEffectPath : portraitPath
  const robotUrl = makeDataUrl(robotPath, 'image/jpeg')
  const portraitUrl = makeDataUrl(portraitPath, 'image/jpeg')
  const styleUrl = makeDataUrl(stylePath, 'image/jpeg')
  const effectUrl = makeDataUrl(effectPath, 'image/jpeg')
  const videoUrl = makeTinyVideo()
  const imageResult = { id: 'real-smoke-image-result', type: 'image', url: robotUrl, thumbnailUrl: robotUrl, createdAt: now }
  const videoResult = {
    id: 'real-smoke-video-result',
    type: 'video',
    url: videoUrl,
    thumbnailUrl: robotUrl,
    durationSeconds: 2,
    createdAt: now,
  }
  return {
    generationCanvas: {
      nodes: [
        {
          id: 'real-smoke-image-source',
          kind: 'image',
          title: 'Real smoke image source',
          position: { x: 80, y: 100 },
          size: { width: 320, height: 320 },
          prompt: robotFixtureAvailable
            ? 'Keep this exact small white robot, its proportions, worn metal material, amber chest light, pose, and environment.'
            : 'Keep this exact adult woman, facial identity, hair, clothing, pose, framing, lighting, and environment.',
          result: imageResult,
          history: [imageResult],
          status: 'success',
          categoryId: 'shots',
          renderKind: 'shot-frame',
        },
        {
          id: 'real-smoke-video-source',
          kind: 'video',
          title: 'Real smoke video source',
          position: { x: 460, y: 100 },
          size: { width: 360, height: 240 },
          prompt: 'Retain the source timing and left-to-right block motion.',
          result: videoResult,
          history: [videoResult],
          status: 'success',
          categoryId: 'shots',
          renderKind: 'shot-frame',
        },
        {
          id: 'real-smoke-portrait-source',
          kind: 'image',
          title: 'Real smoke portrait source',
          position: { x: 840, y: 100 },
          size: { width: 320, height: 320 },
          prompt:
            'Keep this exact adult woman, facial identity, hair, expression baseline, clothing, framing, lighting, and neutral background.',
          result: {
            id: 'real-smoke-portrait-result',
            type: 'image',
            url: portraitUrl,
            thumbnailUrl: portraitUrl,
            createdAt: now,
          },
          history: [],
          status: 'success',
          categoryId: 'shots',
          renderKind: 'shot-frame',
        },
        {
          id: 'real-smoke-style-resource',
          kind: 'resource',
          title: 'Smoke style',
          position: { x: 80, y: 520 },
          size: { width: 260, height: 220 },
          prompt: 'warm cinematic side light, fine texture, restrained contrast',
          result: { id: 'style-result', type: 'image', url: styleUrl, thumbnailUrl: styleUrl, createdAt: now },
          history: [],
          status: 'success',
          categoryId: 'scene',
          creativeResource: {
            id: 'real-smoke-style-resource',
            kind: 'style',
            label: 'Smoke style',
            description: 'Warm cinematic side light with fine texture.',
            promptTokens: ['warm side light', 'fine texture', 'restrained contrast'],
            assetIds: [],
            license: { source: 'repository test fixture', commercialUse: 'allowed' },
            createdAt: now,
            updatedAt: now,
          },
        },
        {
          id: 'real-smoke-effect-resource',
          kind: 'resource',
          title: 'Smoke effect',
          position: { x: 380, y: 520 },
          size: { width: 260, height: 220 },
          prompt: 'subtle moving light sweep with stable geometry and no frozen output',
          result: { id: 'effect-result', type: 'image', url: effectUrl, thumbnailUrl: effectUrl, createdAt: now },
          history: [],
          status: 'success',
          categoryId: 'scene',
          creativeResource: {
            id: 'real-smoke-effect-resource',
            kind: 'effect',
            label: 'Smoke effect',
            description: 'Subtle moving light sweep.',
            promptTokens: ['moving light sweep', 'stable geometry', 'continuous motion'],
            assetIds: [],
            license: { source: 'repository test fixture', commercialUse: 'allowed' },
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
      edges: [],
      selectedNodeIds: ['real-smoke-image-source'],
      groups: [],
    },
  }
}

function copyUserCatalogIfRequested(settingsDir) {
  if (!config.useUserSettings) return false
  const source = path.join(os.homedir(), 'Library', 'Application Support', 'nomi', 'model-catalog.json')
  if (!fs.existsSync(source)) throw new Error('User model catalog was requested but does not exist')
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.copyFileSync(source, path.join(settingsDir, 'model-catalog.json'))
  return true
}

function copyUserJimengSessionIfRequested(userDataDir) {
  if (!config.useUserSettings) return false
  const sourceRoot = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'nomi',
    'Partitions',
    'nomi-jimeng-runner',
  )
  if (!fs.existsSync(sourceRoot)) return false
  const destinationRoot = path.join(userDataDir, 'Partitions', 'nomi-jimeng-runner')
  fs.mkdirSync(destinationRoot, { recursive: true })
  const entries = ['Cookies', 'Cookies-journal', 'Local Storage', 'IndexedDB']
  let copied = false
  for (const entry of entries) {
    const source = path.join(sourceRoot, entry)
    if (!fs.existsSync(source)) continue
    fs.cpSync(source, path.join(destinationRoot, entry), {
      recursive: fs.statSync(source).isDirectory(),
      force: true,
    })
    copied = true
  }
  return copied
}

function findProjectDir(projectsDir) {
  if (!fs.existsSync(projectsDir)) return null
  const candidates = fs.readdirSync(projectsDir)
    .map((name) => path.join(projectsDir, name))
    .filter((dir) => fs.existsSync(path.join(dir, '.nomi', 'project.json')))
  return candidates.length === 1 ? candidates[0] : null
}

function readProjectRecord(projectDir) {
  return readJson(path.join(projectDir, '.nomi', 'project.json'))
}

function canvasNodes(record) {
  const canvas = record?.payload?.generationCanvas ?? record?.generationCanvas
  return Array.isArray(canvas?.nodes) ? canvas.nodes : []
}

function targetNodeIds(record, recipeId) {
  return new Set(
    canvasNodes(record)
      .filter((node) => node?.meta?.capabilityRecipe?.recipeId === recipeId)
      .map((node) => node.id),
  )
}

function listFilesDetailed(rootDir) {
  if (!fs.existsSync(rootDir)) return []
  const files = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(fullPath)
      else {
        const stat = fs.statSync(fullPath)
        files.push({
          path: path.relative(rootDir, fullPath),
          absolutePath: fullPath,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
        })
      }
    }
  }
  visit(rootDir)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function retainGeneratedFiles(generatedFiles, recipeId, attempt) {
  const destinationRoot = path.join(
    evidenceDir,
    'assets',
    recipeId.replaceAll('.', '-'),
    `attempt-${attempt}`,
  )
  fs.mkdirSync(destinationRoot, { recursive: true })
  return generatedFiles.map((file) => {
    const destinationPath = path.join(destinationRoot, path.basename(file.path))
    fs.copyFileSync(file.absolutePath, destinationPath)
    return {
      path: path.relative(runDir, destinationPath),
      absolutePath: destinationPath,
      sizeBytes: fs.statSync(destinationPath).size,
    }
  })
}

function probeFile(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.webm', '.mkv'].includes(extension)) {
    return { kind: extension === '.glb' ? 'model3d' : 'unknown' }
  }
  const ffprobePath = require('@ffprobe-installer/ffprobe').path
  try {
    const raw = execFileSync(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height,duration:format=duration,size',
      '-of', 'json',
      filePath,
    ], { encoding: 'utf8', timeout: 30_000 })
    return JSON.parse(raw)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

async function waitForTerminalRecipeNode(win, projectDir, recipeId, knownNodeIds, timeoutMs) {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  while (Date.now() < deadline) {
    const record = readProjectRecord(projectDir)
    const targets = canvasNodes(record).filter((node) => (
      node?.meta?.capabilityRecipe?.recipeId === recipeId && !knownNodeIds.has(node.id)
    ))
    const target = targets.at(-1)
    if (target && ['success', 'error', 'recoverable'].includes(target.status)) {
      return { record, target, elapsedMs: Date.now() - startedAt }
    }
    await win.waitForTimeout(2000)
  }
  throw new Error(`Real capability smoke timed out after ${Math.round(timeoutMs / 1000)} seconds`)
}

function optionValueParts(value) {
  return parseSmokeModelOptionValue(value)
}

function selectCompatibleModel(options) {
  return options.find((option) => {
    const { vendorKey, modelKey } = optionValueParts(option.value)
    if (!smokePatternMatches(config.providerPattern, vendorKey, option.text)) return false
    if (!smokePatternMatches(config.modelPattern, modelKey, option.text)) return false
    return true
  }) || null
}

async function closeInspector(inspector) {
  const cancel = inspector.getByRole('button', { name: '取消', exact: true }).first()
  if (await cancel.count()) await cancel.click()
}

async function configureRecipe(win, inspector, recipeId, definition) {
  if (recipeId === 'image.multiview.custom') {
    const cameras = [
      { label: 'Right profile', azimuth: 90, elevation: 0 },
      { label: 'Left profile', azimuth: -90, elevation: 0 },
      { label: 'Front', azimuth: 0, elevation: 0 },
      { label: 'Back', azimuth: 180, elevation: 0 },
      { label: 'High angle', azimuth: 45, elevation: 25 },
      { label: 'Low angle', azimuth: -45, elevation: -20 },
    ]
    await win.getByLabel('输出数量').fill(String(definition.expectedOutputs))
    for (let index = 0; index < definition.expectedOutputs; index += 1) {
      const camera = cameras[index]
      await win.getByLabel(`机位 ${index + 1} 名称`).fill(camera.label)
      await win.getByLabel(`机位 ${index + 1} 方位角`).fill(String(camera.azimuth))
      await win.getByLabel(`机位 ${index + 1} 仰俯角`).fill(String(camera.elevation))
    }
  }
  if (recipeId === 'portrait.mood') {
    await inspector.getByLabel('生成范围').click()
    await win.getByRole('option', { name: '五格试跑', exact: true }).click()
  }
  if (definition.resourceLabel) {
    const resource = inspector.getByRole('checkbox', { name: definition.resourceLabel, exact: true })
    await resource.waitFor({ state: 'visible', timeout: 5000 })
    await resource.check()
  }
}

async function openRecipeInspector(win, recipeId) {
  const definition = caseByRecipe(recipeId)
  await win.evaluate(({ nodeId, requestedRecipeId }) => {
    window.dispatchEvent(new CustomEvent('nomi-open-capability-recipes', {
      detail: { nodeId, recipeId: requestedRecipeId },
    }))
  }, { nodeId: definition.sourceNodeId, requestedRecipeId: recipeId })
  const inspector = win.locator('[data-capability-recipe-inspector="true"]')
  await inspector.waitFor({ state: 'visible', timeout: 8000 })

  await inspector.getByLabel('能力配方').click()
  const escapedRecipeId = recipeId.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  const recipeOption = win.locator(`[role="option"][value="${escapedRecipeId}"]`)
  try {
    await recipeOption.waitFor({ state: 'visible', timeout: 5000 })
  } catch (error) {
    const availableOptions = await win.locator('[role="option"]').evaluateAll((elements) => elements.map((element) => ({
      value: element.getAttribute('value') || '',
      text: element.textContent?.replace(/\s+/g, ' ').trim() || '',
    })))
    throw new Error(
      `Capability recipe option ${recipeId} was not visible. Available options: ${JSON.stringify(availableOptions)}`,
      { cause: error },
    )
  }
  const disabled = (await recipeOption.getAttribute('data-combobox-disabled')) !== null
    || (await recipeOption.getAttribute('aria-disabled')) === 'true'
  if (disabled) {
    await win.keyboard.press('Escape')
    return { inspector, definition, recipeDisabled: true, options: [], selectedModel: null }
  }
  await recipeOption.click()
  const modelSelect = inspector.getByLabel('模型与模式')
  if (await modelSelect.isDisabled()) {
    return { inspector, definition, recipeDisabled: false, options: [], selectedModel: null }
  }
  await modelSelect.click()
  const options = await win.locator('[role="option"][value*="::"]').evaluateAll((elements) => elements.map((element) => ({
    value: element.getAttribute('value') || '',
    text: element.textContent?.replace(/\s+/g, ' ').trim() || '',
    disabled: element.hasAttribute('data-combobox-disabled') || element.getAttribute('aria-disabled') === 'true',
  })))
  await win.keyboard.press('Escape')
  const usableOptions = options.filter((option) => !option.disabled)
  return {
    inspector,
    definition,
    recipeDisabled: false,
    options: usableOptions,
    selectedModel: selectCompatibleModel(usableOptions),
  }
}

async function chooseModel(win, inspector, selectedModel) {
  await inspector.getByLabel('模型与模式').click()
  const escaped = selectedModel.value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  const option = win.locator(`[role="option"][value="${escaped}"]`)
  await option.waitFor({ state: 'visible', timeout: 5000 })
  await option.click()
}

function attemptEvidence(target, definition, generatedFiles, elapsedMs) {
  const collections = Array.isArray(target.resultCollections) ? target.resultCollections : []
  const collection = [...collections].reverse().find((entry) => entry.recipeId === target.meta?.capabilityRecipe?.recipeId)
  const items = Array.isArray(collection?.items) ? collection.items : []
  const successCount = items.filter((item) => item.status === 'success' && item.result?.url).length
  const failureCount = items.filter((item) => item.status === 'error').length
  const phaseTimings = items
    .map((item) => extractSmokePhaseTimings(item))
    .filter(Boolean)
  const providerCandidateCounts = items.map((item) => ({
    itemId: item.id,
    count: Array.isArray(item.candidates) ? item.candidates.length : item.result ? 1 : 0,
    selectedResultId: item.selectedResultId || item.result?.id || null,
  }))
  return {
    targetNodeId: target.id,
    targetStatus: target.status,
    targetError: target.error || null,
    elapsedMs,
    expectedOutputs: definition.expectedOutputs,
    outputCount: items.length,
    successCount,
    failureCount,
    quality: collection?.quality ?? null,
    providerCandidateCounts,
    phaseTimings,
    generatedFiles: generatedFiles.map((file) => ({
      path: file.path,
      sizeBytes: file.sizeBytes,
      probe: probeFile(file.absolutePath),
    })),
  }
}

async function runPaidAttempt({
  win,
  inspector,
  selectedModel,
  definition,
  recipeId,
  projectDir,
  state,
  caseState,
}) {
  await chooseModel(win, inspector, selectedModel)
  await configureRecipe(win, inspector, recipeId, definition)
  const beforeRecord = readProjectRecord(projectDir)
  const knownNodeIds = targetNodeIds(beforeRecord, recipeId)
  const assetRoot = path.join(projectDir, 'assets')
  const beforeFiles = new Set(listFilesDetailed(assetRoot).map((file) => file.path))
  const startedAt = Date.now()
  await inspector.getByRole('button', { name: '生成新结果', exact: true }).click()
  const spendMessage = win.getByText(/将生成 \d+ (张画面|段视频)/, { exact: false }).first()
  await spendMessage.waitFor({ state: 'visible', timeout: 5000 })
  const spendDialog = spendMessage.locator('..')
  const spendText = (await spendDialog.textContent())?.replace(/\s+/g, ' ').trim() || ''
  const actualProviderCalls = providerCallsFromSpendDialog(
    spendText,
    definition.plannedProviderCalls,
  )
  if (actualProviderCalls !== definition.plannedProviderCalls) {
    throw new Error(
      `Spend dialog task count mismatch: expected ${definition.plannedProviderCalls}, got ${actualProviderCalls}`,
    )
  }
  await spendDialog.getByRole('button', { name: '生成新结果', exact: true }).click()

  state.providerCalls += actualProviderCalls
  caseState.providerCalls += actualProviderCalls
  const modelCallKey = `${optionValueParts(selectedModel.value).vendorKey}/${optionValueParts(selectedModel.value).modelKey}`
  state.providerCallsByModel[modelCallKey] = (
    Number(state.providerCallsByModel[modelCallKey]) || 0
  ) + actualProviderCalls
  persistState(state)
  const terminal = await waitForTerminalRecipeNode(
    win,
    projectDir,
    recipeId,
    knownNodeIds,
    config.timeoutMs,
  )
  const generatedFiles = listFilesDetailed(assetRoot).filter((file) => !beforeFiles.has(file.path))
  const retainedFiles = retainGeneratedFiles(
    generatedFiles,
    recipeId,
    caseState.attempts,
  )
  const screenshotPath = path.join(
    evidenceDir,
    `${recipeId.replaceAll('.', '-')}-attempt-${caseState.attempts}.png`,
  )
  await win.screenshot({ path: screenshotPath })
  const evidence = attemptEvidence(terminal.target, definition, retainedFiles, terminal.elapsedMs)
  evidence.spendDialog = spendText
  evidence.model = { ...optionValueParts(selectedModel.value), display: selectedModel.text }
  evidence.latencyMs = {
    providerAndPostprocess: terminal.elapsedMs,
    totalAttempt: Date.now() - startedAt,
  }
  evidence.screenshot = path.relative(runDir, screenshotPath)
  return evidence
}

function markdownReport(report) {
  const rows = report.cases.map((entry) => {
    const model = entry.selectedModel
      ? `${entry.selectedModel.vendorKey}/${entry.selectedModel.modelKey}/${entry.selectedModel.modeId}`
      : '-'
    const blocker = entry.blocker?.code || '-'
    const cooldown = entry.ratePolicy
      ? `${entry.ratePolicy.effectiveCooldownMs}ms${entry.ratePolicy.enforcedMinimum ? ' floor' : ''}`
      : '-'
    return `| \`${entry.recipeId}\` | ${entry.status} | ${entry.attempts} | ${entry.providerCalls} | ${model} | ${cooldown} | ${blocker} |`
  })
  const blockers = report.cases
    .filter((entry) => entry.blocker)
    .map((entry) => `- \`${entry.recipeId}\`: ${entry.blocker.code} — ${entry.blocker.remediation}`)
  return [
    '# Capability Recipes Real Smoke',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Updated: ${report.updatedAt}`,
    `- Mode: ${report.paidEvaluation ? 'paid, spend-confirmed' : 'zero-spend inspection'}`,
    `- Status: ${report.status}`,
    `- Provider calls: ${report.providerCalls}/${report.maxProviderCalls}`,
    `- Provider calls by model: ${JSON.stringify(report.providerCallsByModel || {})}`,
    `- User settings copied into isolation: ${report.userSettingsCopied ? 'yes' : 'no'}`,
    `- Stop reason: ${report.stopReason || '-'}`,
    '',
    '| Recipe | Status | Attempts | Provider calls | Selected model | Effective cooldown | Blocker |',
    '| --- | --- | ---: | ---: | --- | ---: | --- |',
    ...rows,
    '',
    ...(blockers.length > 0 ? ['## Blockers', '', ...blockers, ''] : []),
    'No API keys, cookies, authorization headers, or account identifiers are included in this report.',
    '',
  ].join('\n')
}

function finalizeStatus(state) {
  if (state.stopReason?.startsWith('rate_limit')) return 'stopped_rate_limit'
  if (state.cases.some((entry) => entry.status === 'failed')) return 'failed'
  if (state.cases.some((entry) => entry.status === 'inspection_required')) return 'partial'
  if (state.cases.some((entry) => [
    'pending',
    'blocked_no_model',
    'budget_exhausted',
    'budget_exhausted_model',
  ].includes(entry.status))) {
    return 'partial'
  }
  return 'passed'
}

function tempEntries(prefix) {
  try {
    return new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix)))
  } catch {
    return new Set()
  }
}

function remainingChildProcesses(marker) {
  try {
    return execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.includes(marker) && !line.includes('ps -axo'))
      .map((line) => line.trim())
  } catch {
    return []
  }
}

const freshState = createSmokeState({
  generatedAt: new Date().toISOString(),
  recipes: config.recipes,
  allowPaid: config.allowPaid,
  maxProviderCalls: config.maxProviderCalls,
  maxProviderCallsPerModel: config.maxProviderCallsPerModel,
})
const state = config.resume ? mergeSmokeState(freshState, readJson(statePath)) : freshState
state.policy = {
  maxAttemptsPerRecipe: config.maxAttemptsPerRecipe,
  customViewCount: config.customViewCount,
  maxProviderCallsPerModel: config.maxProviderCallsPerModel,
  retryLimit: config.retryLimit,
  requestedCooldownMs: config.cooldownMs,
  timeoutMs: config.timeoutMs,
  rateLimitSources: [
    {
      provider: 'agnes',
      auditedAt: '2026-07-17',
      source: 'https://github.com/AgnesAI-Labs/AgnesAI-Models/blob/main/MODEL_CATALOG.md',
      publicFreeDefaultActualRpm: {
        text: 20,
        image1k: 20,
        image2k: 10,
        video: 1,
      },
    },
  ],
}
persistState(state)

// 预拷贝用户 catalog/即梦会话到隔离目录后再启动（launchNomiApp 只建目录不清空，先种后起安全）。
const settingsDir = path.join(tempRoot, 'settings')
const userDataDir = path.join(tempRoot, 'user-data')
const userSettingsCopied = copyUserCatalogIfRequested(settingsDir)
const userJimengSessionCopied = copyUserJimengSessionIfRequested(userDataDir)
const codexHomesBefore = tempEntries('nomi-codex-home-')
const { app } = await launchNomiApp({
  name: 'nomi-capability-recipes-real-smoke',
  tempRoot,
  settingsDir,
  userDataDir,
  env: {
    NOMI_CODEX_IMG2_TIMEOUT_MS: process.env.NOMI_CODEX_IMG2_TIMEOUT_MS || String(config.timeoutMs),
    NOMI_SOURCE_RUN: '1',
    NOMI_CAPABILITY_DIR: path.join(tempRoot, 'capability-core'),
  },
})
const electronProcess = app.process()
const pageErrors = []
let appClosed = false
let forcedKill = false
let projectDir = null

try {
  const win = await app.firstWindow()
  win.on('pageerror', (error) => pageErrors.push(String(error?.message || error)))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)
  const created = await win.evaluate(
    ({ payload }) => {
      localStorage.setItem('nomi:splash:v1', 'seen')
      localStorage.setItem('nomi:journey-tour:v1', 'seen')
      localStorage.setItem('nomi:canvas-gesture-hint:v1', 'seen')
      return window.nomiDesktop.projects.create({
        name: 'Capability Recipe Real Smoke',
        version: 1,
        payload,
      })
    },
    { payload: projectPayload() },
  )
  if (!created?.id) throw new Error('Failed to create isolated smoke project')
  projectDir = findProjectDir(launch.paths.projectsDir)
  if (!projectDir) throw new Error('Could not locate isolated smoke project directory')

  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  const card = win.locator('[data-project-card]', { hasText: 'Capability Recipe Real Smoke' }).first()
  await card.waitFor({ state: 'visible', timeout: 10_000 })
  await card.click()
  await win.waitForTimeout(500)
  const continueButton = win.getByText('继续创作', { exact: false }).first()
  if (await continueButton.count()) await continueButton.click().catch(() => undefined)
  await win.waitForTimeout(2000)
  await win.getByRole('button', { name: '生成', exact: false }).first().click().catch(() => undefined)
  await win.waitForTimeout(1000)

  for (const caseState of state.cases) {
    if (['success', 'inspection_passed', 'skipped'].includes(caseState.status)) continue
    const recipeId = caseState.recipeId
    const definition = caseByRecipe(recipeId)
    let caseCooldownMs = config.cooldownMs
    if (state.stopReason) break
    if (
      config.allowPaid
      && state.providerCalls + definition.plannedProviderCalls > config.maxProviderCalls
    ) {
      caseState.status = 'budget_exhausted'
      persistState(state)
      continue
    }

    let inspection = await openRecipeInspector(win, recipeId)
    const availabilityScreenshot = path.join(evidenceDir, `${recipeId.replaceAll('.', '-')}-availability.png`)
    await win.screenshot({ path: availabilityScreenshot })
    caseState.compatibleModels = inspection.options.map((option) => ({
      ...optionValueParts(option.value),
      display: option.text,
    }))
    caseState.selectedModel = inspection.selectedModel
      ? { ...optionValueParts(inspection.selectedModel.value), display: inspection.selectedModel.text }
      : null
    if (caseState.selectedModel) {
      caseCooldownMs = effectiveProviderCooldownMs(config.cooldownMs, caseState.selectedModel)
      const modelCallKey = `${caseState.selectedModel.vendorKey}/${caseState.selectedModel.modelKey}`
      const previousModelCalls = Number(state.providerCallsByModel[modelCallKey]) || 0
      caseState.modelCallBudget = {
        key: modelCallKey,
        previousCalls: previousModelCalls,
        plannedCalls: definition.plannedProviderCalls,
        limit: config.maxProviderCallsPerModel,
      }
      caseState.ratePolicy = {
        requestedCooldownMs: config.cooldownMs,
        effectiveCooldownMs: caseCooldownMs,
        enforcedMinimum: caseCooldownMs > config.cooldownMs,
        appliedDuringThisRun: config.allowPaid && caseCooldownMs > 0,
      }
    }
    caseState.evidence = Array.from(new Set([
      ...(caseState.evidence || []),
      path.relative(runDir, availabilityScreenshot),
    ]))
    if (inspection.recipeDisabled || inspection.options.length === 0 || !inspection.selectedModel) {
      caseState.status = 'blocked_no_model'
      const filterMismatch = inspection.options.length > 0 && !inspection.selectedModel
      caseState.blocker = describeMissingCompatibleModel(recipeId, { filterMismatch })
      caseState.error = filterMismatch
        ? 'No compatible model matched the requested provider/model filter'
        : 'No connected compatible model'
      await closeInspector(inspection.inspector)
      persistState(state)
      continue
    }
    if (!config.allowPaid) {
      caseState.status = 'inspection_passed'
      await closeInspector(inspection.inspector)
      persistState(state)
      continue
    }
    if (
      caseState.modelCallBudget
      && caseState.modelCallBudget.previousCalls + caseState.modelCallBudget.plannedCalls
        > caseState.modelCallBudget.limit
    ) {
      caseState.status = 'budget_exhausted_model'
      caseState.error = `Per-model call budget exceeded for ${caseState.modelCallBudget.key}`
      await closeInspector(inspection.inspector)
      persistState(state)
      continue
    }

    let completed = false
    while (!completed && caseState.attempts < config.maxAttemptsPerRecipe) {
      caseState.status = 'running'
      caseState.attempts += 1
      persistState(state)
      try {
        const attempt = await runPaidAttempt({
          win,
          inspector: inspection.inspector,
          selectedModel: inspection.selectedModel,
          definition,
          recipeId,
          projectDir,
          state,
          caseState,
        })
        caseState.attemptEvidence = [...(caseState.attemptEvidence || []), attempt]
        caseState.evidence = Array.from(new Set([
          ...(caseState.evidence || []),
          attempt.screenshot,
          ...attempt.generatedFiles.map((file) => file.path),
        ]))
        const successful = attempt.targetStatus === 'success'
          && attempt.successCount === definition.expectedOutputs
          && attempt.failureCount === 0
        const selectedVendor = optionValueParts(inspection.selectedModel.value).vendorKey
        const fourCandidateContract = selectedVendor !== 'jimeng-web'
          || attempt.providerCandidateCounts.every((item) => item.count === 4)
        if (!successful || !fourCandidateContract) {
          throw new Error(attempt.targetError || `Output contract failed: ${JSON.stringify(attempt)}`)
        }
        const qualityDisposition = smokeQualityDisposition(attempt.quality)
        if (qualityDisposition === 'failed') {
          throw new Error(`Output quality failed: ${JSON.stringify(attempt.quality)}`)
        }
        if (qualityDisposition === 'manual_review') {
          caseState.status = 'inspection_required'
          caseState.error = `Automated quality status is ${attempt.quality?.status || 'unavailable'}; manual review required`
          caseState.failureKind = 'quality_review'
        } else {
          markSmokeCaseSucceeded(caseState)
        }
        completed = true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const kind = classifyProviderFailure(message)
        caseState.error = message
        caseState.failureKind = kind
        if (kind === 'rate_limit') {
          caseState.status = 'rate_limited'
          state.stopReason = `rate_limit:${recipeId}`
          completed = true
        } else {
          const retry = caseState.attempts < config.maxAttemptsPerRecipe
            && shouldRetryProviderFailure({
              kind,
              attempt: caseState.attempts,
              retryLimit: config.retryLimit,
            })
          caseState.status = retry ? 'pending' : 'failed'
          completed = !retry
          if (retry) {
            await win.waitForTimeout(caseCooldownMs)
            inspection = await openRecipeInspector(win, recipeId)
            if (!inspection.selectedModel) {
              caseState.status = 'blocked_no_model'
              completed = true
            }
          }
        }
      }
      persistState(state)
    }
    if (!state.stopReason && caseCooldownMs > 0) await win.waitForTimeout(caseCooldownMs)
  }
} catch (error) {
  state.status = 'failed'
  state.stopReason = state.stopReason || `harness:${error instanceof Error ? error.message : String(error)}`
  process.exitCode = 1
} finally {
  const closed = await Promise.race([
    app.close().then(() => true, () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ])
  appClosed = closed
  if (!closed && electronProcess.exitCode == null) {
    forcedKill = electronProcess.kill('SIGKILL')
    await Promise.race([
      new Promise((resolve) => electronProcess.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ])
  }

  const codexHomesAfter = tempEntries('nomi-codex-home-')
  const newCodexHomes = [...codexHomesAfter].filter((name) => !codexHomesBefore.has(name))
  state.status = state.status === 'failed' ? 'failed' : finalizeStatus(state)
  if (!appClosed || forcedKill) {
    state.status = 'failed'
    state.stopReason = state.stopReason || 'cleanup:electron_close_timeout'
  }
  state.pageErrors = pageErrors
  state.userSettingsCopied = userSettingsCopied
  state.userJimengSessionCopied = userJimengSessionCopied
  state.cleanup = {
    appClosed,
    forcedKill,
    electronExitCode: electronProcess.exitCode,
    temporaryCodexHomesRemaining: newCodexHomes.length,
    spawnedChildrenRemaining: remainingChildProcesses(tempRoot).length,
    temporaryRootRemoved: false,
  }
  state.ephemeral = {
    projectCreated: Boolean(projectDir),
    generatedAssetCount: projectDir
      ? listFilesDetailed(path.join(projectDir, 'assets')).length
      : 0,
  }
  persistState(state)
  const report = sanitizeSmokeReport(state)
  writeJsonAtomic(reportPath, report)
  fs.writeFileSync(reportMarkdownPath, `${markdownReport(report)}\n`)
  fs.rmSync(tempRoot, { recursive: true, force: true })
  state.cleanup.temporaryRootRemoved = !fs.existsSync(tempRoot)
  persistState(state)
  writeJsonAtomic(reportPath, sanitizeSmokeReport(state))

  console.log(`Capability real smoke: ${state.status}`)
  console.log(`Mode: ${config.allowPaid ? 'paid, spend-confirmed' : 'zero-spend inspection'}`)
  console.log(`Provider calls: ${state.providerCalls}/${state.maxProviderCalls}`)
  console.log(`Report: ${reportPath}`)
  if (state.stopReason) console.log(`Stop reason: ${state.stopReason}`)
}

process.exit(process.exitCode ?? (state.status === 'failed' ? 1 : 0))
