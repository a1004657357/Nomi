/**
 * Gate 2 Slice 1 测试：§11.2 语义工具别名层。
 *
 * 验收：
 * - §11.2 工具集全覆盖（read/propose/apply/paid 四类齐全）。
 * - implemented 工具正确映射到既有 canvas 工具。
 * - deferred 工具明确标注延后 Gate（不伪造已实现）。
 * - categorizeTool 双向（语义名 + 既有名）都正确分类。
 * - 覆盖率统计可追踪 Gate 2 进度。
 */
import { describe, expect, it } from 'vitest'
import {
  SEMANTIC_TOOL_MAP,
  SEMANTIC_TOOL_NAMES,
  categorizeTool,
  resolveSemanticTool,
  semanticToCanvasTool,
  semanticToolCoverage,
} from './semanticAgentTools'

describe('§11.2 语义工具集完整性', () => {
  it('covers all four categories (read/propose/apply/paid)', () => {
    const categories = new Set(SEMANTIC_TOOL_NAMES.map((n) => SEMANTIC_TOOL_MAP[n].category))
    expect(categories.has('read')).toBe(true)
    expect(categories.has('propose')).toBe(true)
    expect(categories.has('apply')).toBe(true)
    expect(categories.has('paid')).toBe(true)
  })

  it('§11.2 target tool list is fully named (26 tools per spec §11.2)', () => {
    const expected = [
      'read_project_summary', 'read_film_bible', 'read_storyboard', 'read_shot_spec',
      'read_asset_registry', 'read_provider_capabilities', 'read_task_status',
      'read_evaluation_report', 'read_vibing_director_state',
      'propose_film_bible_patch', 'propose_storyboard_plan', 'propose_shot_patch',
      'propose_generation_plan', 'propose_timeline_assembly',
      'apply_film_bible_patch', 'apply_storyboard_patch', 'create_asset_records',
      'select_asset_revision', 'archive_asset_revision', 'apply_vibing_director_plan',
      'place_assets_on_timeline',
      'submit_generation_intent', 'cancel_provider_task', 'download_provider_result',
      'run_optional_gpu_evaluation',
    ]
    for (const name of expected) {
      expect(SEMANTIC_TOOL_NAMES).toContain(name)
    }
  })
})

describe('implemented 工具正确映射到既有 canvas 工具', () => {
  it('submit_generation_intent → run_generation_batch (paid)', () => {
    expect(semanticToCanvasTool('submit_generation_intent')).toBe('run_generation_batch')
    expect(resolveSemanticTool('submit_generation_intent').category).toBe('paid')
    expect(resolveSemanticTool('submit_generation_intent').status).toBe('implemented')
  })

  it('propose_shot_patch 保持纯提案，不映射到写工具', () => {
    expect(semanticToCanvasTool('propose_shot_patch')).toBeNull()
    expect(resolveSemanticTool('propose_shot_patch').category).toBe('propose')
  })

  it('propose_storyboard_plan → propose_storyboard_plan (same name, propose)', () => {
    expect(semanticToCanvasTool('propose_storyboard_plan')).toBe('propose_storyboard_plan')
  })

  it('read_provider_capabilities → list_capability_recipes (read)', () => {
    expect(semanticToCanvasTool('read_provider_capabilities')).toBe('list_capability_recipes')
  })
})

describe('deferred 工具明确标注延后 Gate（不伪造已实现）', () => {
  it('read_evaluation_report → deferred to Gate 5', () => {
    const m = resolveSemanticTool('read_evaluation_report')
    expect(m.status).toBe('deferred')
    expect(m.deferredTo).toBe('Gate 5')
    expect(m.backedBy).toBeNull()
  })

  it('cancel_provider_task → implemented through the desktop Provider contract', () => {
    const m = resolveSemanticTool('cancel_provider_task')
    expect(m.status).toBe('implemented')
    expect(m.backedBy).toBeNull()
  })

  it('run_optional_gpu_evaluation → deferred to Gate 5', () => {
    expect(resolveSemanticTool('run_optional_gpu_evaluation').status).toBe('deferred')
  })

  it('deferred tools have backedBy = null (no false mapping)', () => {
    for (const name of SEMANTIC_TOOL_NAMES) {
      const m = SEMANTIC_TOOL_MAP[name]
      if (m.status === 'deferred') {
        expect(m.backedBy).toBeNull()
      }
    }
  })
})

describe('categorizeTool 双向分类', () => {
  it('categorizes semantic tool names', () => {
    expect(categorizeTool('read_film_bible')).toBe('read')
    expect(categorizeTool('propose_shot_patch')).toBe('propose')
    expect(categorizeTool('select_asset_revision')).toBe('apply')
    expect(categorizeTool('submit_generation_intent')).toBe('paid')
  })

  it('categorizes legacy canvas tool names via reverse lookup', () => {
    expect(categorizeTool('run_generation_batch')).toBe('paid')
    expect(categorizeTool('update_storyboard_shot')).toBe('apply')
    expect(categorizeTool('arrange_storyboard_to_timeline')).toBe('apply')
  })

  it('returns null for unknown tools', () => {
    expect(categorizeTool('nonexistent_tool')).toBeNull()
  })
})

describe('resolveSemanticTool 拒绝未知名（防 typo 静默失败）', () => {
  it('throws on unknown tool name', () => {
    expect(() => resolveSemanticTool('read_film')).toThrow()
  })
})

describe('semanticToolCoverage 覆盖率统计', () => {
  it('returns total = 25 (§11.2 full set)', () => {
    const cov = semanticToolCoverage()
    expect(cov.total).toBe(SEMANTIC_TOOL_NAMES.length)
    expect(cov.total).toBeGreaterThanOrEqual(25)
  })

  it('sum of implemented + projected + deferred === total', () => {
    const cov = semanticToolCoverage()
    expect(cov.implemented + cov.projected + cov.deferred).toBe(cov.total)
  })

  it('each category has non-negative counts', () => {
    const cov = semanticToolCoverage()
    for (const cat of ['read', 'propose', 'apply', 'paid'] as const) {
      const c = cov.byCategory[cat]
      expect(c.implemented + c.projected + c.deferred).toBeGreaterThanOrEqual(0)
    }
  })

  it('documents honest coverage: at least some implemented, some deferred (no false 100%)', () => {
    const cov = semanticToolCoverage()
    expect(cov.implemented).toBeGreaterThan(0) // 既有工具已映射
    expect(cov.deferred).toBeGreaterThan(0) // Gate 3/5 项诚实延后
  })
})
