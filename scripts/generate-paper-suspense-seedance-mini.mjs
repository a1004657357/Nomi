#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DREAMINA = '/Users/huawuer/.local/bin/dreamina'
const PROJECT_ID = 'workspace-8fc380eb-098e-450b-b57d-138ac8f758f9'

function die(message) {
  throw new Error(message)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function nodeIdForGroup(index) {
  return `paper-video-group-${String(index).padStart(2, '0')}-dreamina-mini`
}

function localAssetPath(projectRoot, url) {
  const prefix = `nomi-local://asset/${PROJECT_ID}/`
  if (!url.startsWith(prefix)) die(`不是本项目本地资产：${url}`)
  const file = path.join(projectRoot, decodeURIComponent(url.slice(prefix.length)))
  if (!existsSync(file)) die(`参考图不存在：${file}`)
  return file
}

function projectPrompt(prompt, orderedUrls) {
  return prompt.replace(/@\[asset:([^\]]+)\]/g, (_full, encoded) => {
    const url = decodeURIComponent(encoded)
    const index = orderedUrls.indexOf(url)
    if (index < 0) die(`提示词中的@资产未上传：${url}`)
    return `@image${index + 1}`
  })
}

function collectObjects(value, output = []) {
  if (!value || typeof value !== 'object') return output
  output.push(value)
  if (Array.isArray(value)) value.forEach((item) => collectObjects(item, output))
  else Object.values(value).forEach((item) => collectObjects(item, output))
  return output
}

function balancedJsonEnd(text, start) {
  const stack = []
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') {
      stack.pop()
      if (!stack.length) return index
    }
  }
  return -1
}

function extractJsonValues(text) {
  const source = String(text || '').trim()
  if (!source) return []
  try { return [JSON.parse(source)] } catch { /* mixed human text and JSON */ }
  const values = []
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '{' && source[index] !== '[') continue
    const end = balancedJsonEnd(source, index)
    if (end < 0) continue
    try {
      values.push(JSON.parse(source.slice(index, end + 1)))
      index = end
    } catch { /* keep scanning */ }
  }
  return values
}

function parseDreaminaOutput(stdout, stderr) {
  const parsed = extractJsonValues(`${stdout}\n${stderr}`)
  const objects = parsed.flatMap((value) => collectObjects(value))
  const first = (keys) => {
    for (const object of objects) {
      for (const key of keys) {
        if (typeof object?.[key] === 'string' && object[key].trim()) return object[key].trim()
      }
    }
    return ''
  }
  return {
    submitId: first(['submit_id', 'task_id']),
    status: first(['gen_status', 'status']).toLowerCase(),
    failReason: first(['fail_reason', 'error_message', 'message']),
  }
}

function latestVideo(directory) {
  if (!existsSync(directory)) return ''
  const files = readdirSync(directory)
    .map((name) => path.join(directory, name))
    .filter((file) => statSync(file).isFile() && /\.(mp4|mov|webm)$/i.test(file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return files[0] || ''
}

async function runCli(args, timeout = 180_000) {
  try {
    const { stdout, stderr } = await execFileAsync(DREAMINA, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout,
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return {
      code: Number.isInteger(error?.code) ? error.code : 1,
      stdout: String(error?.stdout || ''),
      stderr: String(error?.stderr || error?.message || ''),
    }
  }
}

async function generateGroup(context, index) {
  const key = String(index)
  const node = context.project.payload.generationCanvas.nodes.find((candidate) => candidate.id === nodeIdForGroup(index))
  if (!node) die(`缺少已准备的 Dreamina 节点：${nodeIdForGroup(index)}`)
  const urls = Array.isArray(node.meta?.referenceImageUrls) ? node.meta.referenceImageUrls.map(String) : []
  if (!urls.length || urls.length > 9) die(`视频组 ${index} 参考图数量非法：${urls.length}`)
  const imagePaths = urls.map((url) => localAssetPath(context.projectRoot, url))
  const prompt = projectPrompt(String(node.prompt || ''), urls)
  for (let n = 1; n <= urls.length; n += 1) {
    if (!prompt.includes(`@image${n}`)) die(`视频组 ${index} 缺少 @image${n} 用途标注`)
  }
  if (prompt.includes('@[asset:') || prompt.includes('AGNES')) die(`视频组 ${index} 提示词仍含未编译标记或 AGNES 旧约束`)

  if (process.env.NOMI_DREAMINA_PREFLIGHT_ONLY === '1') {
    return {
      group: index,
      preflight: true,
      references: urls.length,
      promptChars: prompt.length,
      modelVersion: 'seedance2.0mini',
      mode: 'multimodal2video',
      ratio: '9:16',
      resolution: '720p',
      duration: 15,
    }
  }

  const outputDir = path.join(
    context.projectRoot,
    'assets', 'generated', '2026-08-07', 'seedance-mini', `group-${String(index).padStart(2, '0')}`,
  )
  mkdirSync(outputDir, { recursive: true })
  let entry = context.ledger.groups[key]
  if (!entry) {
    entry = {
      group: index,
      nodeId: node.id,
      state: 'submitting',
      references: urls.length,
      modelVersion: 'seedance2.0mini',
      mode: 'multimodal2video',
      submissionRetryCount: 0,
      startedAt: Date.now(),
    }
    context.ledger.groups[key] = entry
    writeJson(context.ledgerFile, context.ledger)
    const args = [
      'multimodal2video',
      ...imagePaths.map((file) => `--image=${file}`),
      `--prompt=${prompt}`,
      '--duration=15',
      '--ratio=9:16',
      '--video_resolution=720p',
      '--model_version=seedance2.0mini',
      '--poll=30',
    ]
    process.stdout.write(`[group ${index}] submit once: refs=${urls.length}, promptChars=${prompt.length}\n`)
    const submitted = await runCli(args, 180_000)
    const parsed = parseDreaminaOutput(submitted.stdout, submitted.stderr)
    if (!parsed.submitId) {
      entry.state = 'submit-response-unknown'
      entry.failedAt = Date.now()
      entry.error = parsed.failReason || `dreamina exit ${submitted.code}`
      writeJson(context.ledgerFile, context.ledger)
      die(`视频组 ${index} 未取得 submit_id；为避免重复扣积分，已停止且不会自动重提：${entry.error}`)
    }
    entry.submitId = parsed.submitId
    entry.state = parsed.status || 'querying'
    entry.acceptedAt = Date.now()
    writeJson(context.ledgerFile, context.ledger)
  } else if (!entry.submitId) {
    die(`视频组 ${index} 留有未知提交状态；为避免重复扣积分，拒绝自动重提`)
  }

  process.stdout.write(`[group ${index}] accepted submitId=${entry.submitId}; polling only\n`)
  const deadline = Date.now() + 35 * 60_000
  while (Date.now() < deadline) {
    const queried = await runCli([
      'query_result',
      `--submit_id=${entry.submitId}`,
      `--download_dir=${outputDir}`,
    ], 180_000)
    const parsed = parseDreaminaOutput(queried.stdout, queried.stderr)
    const videoPath = latestVideo(outputDir)
    if (videoPath && ['success', 'completed', 'succeeded', ''].includes(parsed.status)) {
      entry.state = 'success'
      entry.completedAt = Date.now()
      entry.videoPath = videoPath
      writeJson(context.ledgerFile, context.ledger)
      process.stdout.write(`[group ${index}] success ${videoPath}\n`)
      return { group: index, submitId: entry.submitId, videoPath }
    }
    if (['fail', 'failed', 'error'].includes(parsed.status)) {
      entry.state = 'failed'
      entry.failedAt = Date.now()
      entry.error = parsed.failReason || 'Dreamina generation failed'
      writeJson(context.ledgerFile, context.ledger)
      die(`视频组 ${index} 生成失败：${entry.error}`)
    }
    entry.state = parsed.status || 'querying'
    entry.lastPolledAt = Date.now()
    writeJson(context.ledgerFile, context.ledger)
    await new Promise((resolve) => setTimeout(resolve, 20_000))
  }
  die(`视频组 ${index} 超过35分钟仍未完成；任务已受理，只停止轮询，不会重提`)
}

async function runPool(items, concurrency, worker) {
  const results = []
  const errors = []
  let cursor = 0
  async function next() {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      try {
        results.push(await worker(item))
      } catch (error) {
        errors.push({ item, error })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()))
  if (errors.length) {
    throw new Error(errors.map(({ item, error }) => `视频组 ${item}：${error?.message || error}`).join('\n'))
  }
  return results.sort((a, b) => a.group - b.group)
}

const [projectRootRaw, groupListRaw, concurrencyRaw = '2'] = process.argv.slice(2)
if (!projectRootRaw || !groupListRaw) die('用法：generate-paper-suspense-seedance-mini.mjs <projectRoot> <1,3,5> [concurrency=2]')
if (!existsSync(DREAMINA)) die(`未安装即梦 CLI：${DREAMINA}`)
const projectRoot = path.resolve(projectRootRaw)
const projectFile = path.join(projectRoot, '.nomi', 'project.json')
const packageDir = path.join(projectRoot, 'assets', 'suspense-storyboard-2026-08-07')
const ledgerFile = path.join(packageDir, 'seedance-mini-generation-ledger.json')
const project = readJson(projectFile)
if (project.id !== PROJECT_ID) die(`项目 ID 不匹配：${project.id}`)
const groups = groupListRaw.split(',').map(Number)
if (!groups.length || groups.some((index) => !Number.isInteger(index) || index < 1 || index > 6)) die('视频组必须是1到6')
const concurrency = Math.max(1, Math.min(2, Number(concurrencyRaw) || 2))
const ledger = existsSync(ledgerFile)
  ? readJson(ledgerFile)
  : { version: 1, projectId: PROJECT_ID, groups: {} }
const context = { projectRoot, project, ledgerFile, ledger }
const results = await runPool(groups, concurrency, (index) => generateGroup(context, index))
process.stdout.write(`${JSON.stringify({ ok: true, concurrency, results }, null, 2)}\n`)
