#!/usr/bin/env node
// 文件体积门岗 —— 落实 CLAUDE.md 规则 12（约束代码量、防巨型文件）。
//
// 机制（棘轮，只减不增）：
//   1. 任何非测试的 .ts/.tsx，行数不得超过 MAX_LINES（硬上限）。
//   2. 现存已超限的"巨壳"列入 ALLOWLIST 并记录基线行数；它们：
//        - 超过基线 → 红牌（你把已知巨壳改得更大了：拆分或精简，别再喂）。
//        - 低于基线 → 黄牌提示（你瘦身了，请把基线下调以锁定战果）。
//      目标是逐步把 ALLOWLIST 清空。
//   3. 新文件不得超过 MAX_LINES —— 想新增超限文件 = 先拆，或人工评审后入白名单。
//
// CSS 文件由规则 10 单独治理（只可减不可增），不在本门岗范围。
//
// 用法：node ./scripts/check-file-sizes.mjs

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAX_LINES = 800
const SCAN_DIRS = ['src', 'electron']

// 现存巨壳的基线行数（棘轮上限）。清空此表 = 巨壳债还清。
// 改小某个数 = 你成功瘦身后锁定的新上限。新增条目应经人工评审。
const ALLOWLIST = {
  // 2026-08-01 定制分支合并官方 45 提交时完成逐项人工复核：下列 10 个巨壳均已存在于合并前定制版，
  // 其中 bridge / generationCommon / onboardingProviders 吸收官方桥接与设置能力后增长，其余 7 个本轮零增长。
  // 先以合并后精确行数建立棘轮，避免把历史架构债伪装成此次 Seedance 2.5 回归；后续只能拆小，不能再增长。
  // 2026-08-15 合并 v0.19.0 后逐项复核：官方生产运行/模型接入与定制 Director/任务调度取并集。
  // 这些值是合并后的精确棘轮；后续只能降低。generated 档案由生成器维护，不宜手工拆分。
  // 2026-09-12 接入 Pixstag（MiniMax-H3）：generated 档案随生成器 +22 行、onboardingProviders
  // 精确吸收 Pixstag 接入卡 zh/en 18 行，重新锁定。
  // v0.21 integration split the affected modules; lock in the reduced sizes.
  'electron/ai/agentChatV2.ts': 745,
  'electron/catalog/archetypeWireDefaults.generated.ts': 76,
  'src/desktop/bridge.ts': 957,
  // 官方 PR #82 增加剪辑节点连续预览与分段导出文案，精确吸收 18 行后重新锁定。
  'src/i18n/locales/generationCommon.ts': 2216,
  'src/i18n/locales/onboardingProviders.ts': 1379,
  'src/i18n/locales/scene3d.ts': 835,
  'src/workbench/generationCanvas/agent/applyCanvasToolCall.ts': 728,
  'src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx': 755,
  'src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx': 801,
  'src/workbench/generationCanvas/components/GenerationCanvas.tsx': 798,
  'src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx': 600,
  'src/workbench/generationCanvas/nodes/scene3d/Scene3DFullscreen.tsx': 848,
  'src/workbench/generationCanvas/runner/generationRunController.ts': 827,
  'src/workbench/workbenchStore.ts': 813,
  "electron/runtime.ts": 525, // Official request dispatch integrated into the existing task module.
  "src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx": 671, // Preview rendering is delegated to GenerationNodePreviewBody.
  // PR#21 白板节点引入（2026-06-25）：WhiteboardDrawingTool（1032）与 WhiteboardLeaferCanvas（3406）两巨壳
  // 已按 Rule 9 全部拆完、双双出白名单。LeaferCanvas → whiteboardCanvasTypes/Export/NodeOps/Geometry 四纯模块
  // + whiteboardSceneRender（渲染树）+ useWhiteboardDrawing/BoxSelection/SelectionActions/SceneSync 四交互 hook，
  // 壳缩到 740 < 800。DrawingTool → WhiteboardToolbarControls + whiteboardStateOps，壳 760。
  // generationCanvasStore.ts 曾 871 行（巨壳）；S5-0 按 zustand slice 模式拆出 canvasStoreTypes.ts +
  // canvasNodeActions.ts + canvasGraphActions.ts + canvasRunActions.ts 后壳文件缩到 161 < 800，已出白名单。
  // NodeParameterControls.tsx 曾 1097 行（巨壳）；C2b 抽出 controls/parameterControlModel.ts +
  // archetypeMeta.ts + ModeBar.tsx 后缩到 605 < 800 硬上限，已出白名单（Rule 12：逐步清空白名单）。
  // Scene3DFullscreen.tsx 曾 3822 行（最大巨壳）；#10b 拆出 scene3dToolbar/inspector/objects/
  // viewControllers/sceneView/sceneContent/cameraPreview 七个子模块后壳缩到 771 < 800，已出白名单。
}

export function listSourceFiles({ root = ROOT, scanDirs = SCAN_DIRS } = {}) {
  // 同时扫描受跟踪和新建源码；--exclude-standard 继续排除 node_modules、dist 和 .gitignore 内容。
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...scanDirs], {
    cwd: root,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .filter((f) => !/\.d\.ts$/.test(f))
    .sort()
}

function countLines(absPath) {
  // 与 `wc -l` 一致：统计换行符数量。
  const content = fs.readFileSync(absPath, 'utf8')
  return (content.match(/\n/g) || []).length
}

export function auditFileSizes({ root = ROOT, scanDirs = SCAN_DIRS } = {}) {
  const errors = []
  const warnings = []
  const files = listSourceFiles({ root, scanDirs })
  for (const rel of files) {
    const lines = countLines(path.join(root, rel))
    const baseline = ALLOWLIST[rel]
    if (baseline !== undefined) {
      if (lines > baseline) {
        errors.push(`✗ ${rel}: ${lines} 行 > 基线 ${baseline}（已知巨壳又长大了 —— 拆分或精简，别再喂）`)
      } else if (lines < baseline) {
        warnings.push(
          `↓ ${rel}: ${lines} 行 < 基线 ${baseline}（已瘦身，请把 check-file-sizes.mjs 里的基线下调到 ${lines} 以锁定）`,
        )
      }
    } else if (lines > MAX_LINES) {
      errors.push(`✗ ${rel}: ${lines} 行 > 上限 ${MAX_LINES}（新巨型文件 —— 请拆分；确需保留须人工评审后入 ALLOWLIST）`)
    }
  }
  return { errors, warnings, files }
}

function runCli() {
  const { errors, warnings, files } = auditFileSizes()
  for (const warning of warnings) console.warn(warning)

  if (errors.length > 0) {
    console.error('\n文件体积门岗未通过（规则 12）：\n' + errors.join('\n') + '\n')
    process.exitCode = 1
    return
  }

  console.log(
    `✓ 文件体积门岗通过：扫描 ${files.length} 个源码文件，上限 ${MAX_LINES} 行，` +
      `巨壳白名单 ${Object.keys(ALLOWLIST).length} 个（棘轮只减不增）。`,
  )
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  runCli()
}
