/**
 * Gate 2 Slice 4 测试：§11.2 语义工具分类 → §11.3 权限矩阵 gate。
 *
 * 验收（§11.3）：
 * - read 类（read_shot_spec/read_film_bible）→ allow（读取免确认）。
 * - propose 类（propose_storyboard_plan/propose_shot_patch）→ allow（提案免确认、不改画布）。
 * - apply 类（apply_storyboard_patch/select_asset_revision）→ ask（本地修改需确认）。
 * - paid 类（submit_generation_intent）→ ask（付费必确认）。
 * - 未知名 → deny（防 typo 静默放行）。
 * - 既有 canvas 工具名也正确分类（run_generation_batch → paid → ask）。
 * - 既有 evaluateGate 行为不回归。
 */
import { describe, expect, it } from 'vitest'
import { evaluateGate, evaluateSemanticToolGate, gateDecisionForCategory } from './gate'

describe('§11.3 权限矩阵：分类 → gate 决策', () => {
  it('read → allow (读取免确认)', () => {
    expect(evaluateSemanticToolGate('read_shot_spec').outcome).toBe('allow')
    expect(evaluateSemanticToolGate('read_film_bible').outcome).toBe('allow')
    expect(evaluateSemanticToolGate('read_asset_registry').outcome).toBe('allow')
    expect(evaluateSemanticToolGate('read_provider_capabilities').outcome).toBe('allow')
  })

  it('propose → allow (提案免确认、不改画布、不花费)', () => {
    expect(evaluateSemanticToolGate('propose_storyboard_plan').outcome).toBe('allow')
    expect(evaluateSemanticToolGate('propose_shot_patch').outcome).toBe('allow')
    expect(evaluateSemanticToolGate('propose_film_bible_patch').outcome).toBe('allow')
  })

  it('apply → ask (本地修改需确认)', () => {
    expect(evaluateSemanticToolGate('apply_storyboard_patch').outcome).toBe('ask')
    expect(evaluateSemanticToolGate('select_asset_revision').outcome).toBe('ask')
    expect(evaluateSemanticToolGate('archive_asset_revision').outcome).toBe('ask')
    expect(evaluateSemanticToolGate('apply_vibing_director_plan').outcome).toBe('ask')
  })

  it('paid → ask (付费必确认)', () => {
    expect(evaluateSemanticToolGate('submit_generation_intent').outcome).toBe('ask')
    expect(evaluateSemanticToolGate('cancel_provider_task').outcome).toBe('ask')
  })
})

describe('语义 gate 兼容既有 canvas 工具名', () => {
  it('run_generation_batch → paid → ask', () => {
    expect(evaluateSemanticToolGate('run_generation_batch').outcome).toBe('ask')
  })

  it('update_storyboard_shot 是本地修改 → ask', () => {
    expect(evaluateSemanticToolGate('update_storyboard_shot').outcome).toBe('ask')
  })
})

describe('语义 gate 拒绝未知名（防 typo）', () => {
  it('unknown tool name → deny', () => {
    const decision = evaluateSemanticToolGate('nonexistent_tool')
    expect(decision.outcome).toBe('deny')
    if (decision.outcome === 'deny') {
      expect(decision.reason).toContain('nonexistent_tool')
    }
  })
})

describe('gateDecisionForCategory — 直接按分类判定', () => {
  it('read/propose → allow, apply/paid → ask', () => {
    expect(gateDecisionForCategory('read').outcome).toBe('allow')
    expect(gateDecisionForCategory('propose').outcome).toBe('allow')
    expect(gateDecisionForCategory('apply').outcome).toBe('ask')
    expect(gateDecisionForCategory('paid').outcome).toBe('ask')
  })
})

describe('既有 evaluateGate 行为不回归（Slice 4 不破坏既有）', () => {
  it('read_canvas_state 仍 allow', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'read_canvas_state', args: {} }).outcome).toBe('allow')
  })
  it('run_generation_batch 仍 ask (costy)', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'run_generation_batch', args: { nodeIds: ['n1'] } }).outcome).toBe('ask')
  })
  it('delete_canvas_nodes 仍 ask (destructive)', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'delete_canvas_nodes', args: { nodeIds: ['n1'] } }).outcome).toBe('ask')
  })
  it('unknown canvas tool 仍 deny', () => {
    const d = evaluateGate({ kind: 'tool-call', toolName: 'ghost_tool', args: {} })
    expect(d.outcome).toBe('deny')
  })

  it('真实入口识别语义工具：read/propose 直通，apply/paid 必问', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'read_film_bible', args: {} }).outcome).toBe('allow')
    expect(evaluateGate({ kind: 'tool-call', toolName: 'propose_shot_patch', args: {} }).outcome).toBe('allow')
    expect(evaluateGate({ kind: 'tool-call', toolName: 'apply_film_bible_patch', args: {} }).outcome).toBe('ask')
    expect(evaluateGate({ kind: 'tool-call', toolName: 'submit_generation_intent', args: { nodeIds: ['n1'] } }).outcome).toBe('ask')
    expect(evaluateGate({ kind: 'tool-call', toolName: 'cancel_provider_task', args: { vendor: 'codex', runId: 'r1' } }).outcome).toBe('ask')
  })
})
