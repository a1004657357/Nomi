import { describe, expect, it } from 'vitest'
import { evaluateGate } from './gate'

describe('evaluateGate — 统一求值流(§6.1)', () => {
  it('① policy:只读工具直通 allow', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'read_canvas_state', args: {} })).toEqual({ outcome: 'allow' })
  })

  it('① policy:propose_storyboard_plan 免费可改(不写画布/不花钱)→ allow', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'propose_storyboard_plan', args: {} })).toEqual({
      outcome: 'allow',
    })
  })

  it('① policy:能力配方目录只读直通 allow', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'list_capability_recipes', args: {} })).toEqual({
      outcome: 'allow',
    })
  })

  it('③ ask:执行能力配方会创建节点并调用模型', () => {
    expect(
      evaluateGate({
        kind: 'tool-call',
        toolName: 'apply_capability_recipe',
        args: { sourceNodeId: 'n1', recipeId: 'portrait.refine' },
      }),
    ).toEqual({ outcome: 'ask' })
  })

  it('③ ask:保存创作资源会写画布但不花模型额度', () => {
    expect(evaluateGate({
      kind: 'tool-call', toolName: 'save_creative_resource',
      args: { sourceNodeId: 'n1', kind: 'style', label: '胶片' },
    })).toEqual({ outcome: 'ask' })
  })

  it('③ ask:3D 模型交接会写导演台但不调用付费模型', () => {
    expect(evaluateGate({
      kind: 'tool-call', toolName: 'handoff_model3d',
      args: { sourceNodeId: 'model-1', target: 'scene3d' },
    })).toEqual({ outcome: 'ask' })
  })

  it('③ ask:写工具排队等点头', () => {
    for (const toolName of ['update_storyboard_shot', 'batch_update_storyboard_shots', 'create_canvas_nodes', 'connect_canvas_edges', 'set_node_prompt', 'attach_external_image_to_node']) {
      expect(evaluateGate({ kind: 'tool-call', toolName, args: {} })).toEqual({ outcome: 'ask' })
    }
  })

  it('破坏性工具同样 ask(确认门管同一条)', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'delete_canvas_nodes', args: { nodeIds: ['n1'] } })).toEqual({
      outcome: 'ask',
    })
  })

  it('② invariant:不认识的工具 deny,reason 是人话', () => {
    const decision = evaluateGate({ kind: 'tool-call', toolName: 'rm_rf_everything', args: {} })
    expect(decision.outcome).toBe('deny')
    if (decision.outcome === 'deny') expect(decision.reason).toContain('rm_rf_everything')
  })

  it('纯函数:同入参恒同出参', () => {
    const intent = { kind: 'tool-call' as const, toolName: 'set_node_prompt', args: { nodeId: 'n1', prompt: 'x' } }
    expect(evaluateGate(intent)).toEqual(evaluateGate(intent))
  })

  describe('S6-4 锁不变量(N11):AI 硬禁,出边放行', () => {
    const ctx = {
      lockedNodes: new Map([['real-1', '女主角定妆卡']]),
      // clientId 翻译:LLM 口中的 c1 = real-1。
      resolveNodeId: (id: string) => (id === 'c1' ? 'real-1' : id),
    }

    it('改锁住节点的 prompt → deny,reason 人话点名节点+解锁路径', () => {
      const decision = evaluateGate(
        { kind: 'tool-call', toolName: 'set_node_prompt', args: { nodeId: 'real-1', prompt: 'x' } },
        ctx,
      )
      expect(decision.outcome).toBe('deny')
      if (decision.outcome === 'deny') {
        expect(decision.reason).toContain('女主角定妆卡')
        expect(decision.reason).toContain('解锁')
      }
    })

    it('LLM 用 clientId 指代锁住节点 → 翻译后照样 deny', () => {
      const decision = evaluateGate(
        { kind: 'tool-call', toolName: 'delete_canvas_nodes', args: { nodeIds: ['c1'] } },
        ctx,
      )
      expect(decision.outcome).toBe('deny')
    })

    it('入边(target=锁节点)deny;出边(source=锁节点,被引用)allow→ask', () => {
      const inbound = evaluateGate(
        { kind: 'tool-call', toolName: 'connect_canvas_edges', args: { edges: [{ source: 'n9', target: 'real-1' }] } },
        ctx,
      )
      expect(inbound.outcome).toBe('deny')
      const outbound = evaluateGate(
        { kind: 'tool-call', toolName: 'connect_canvas_edges', args: { edges: [{ source: 'real-1', target: 'n9' }] } },
        ctx,
      )
      expect(outbound).toEqual({ outcome: 'ask' })
    })

    it('不碰锁节点的写操作不受影响', () => {
      expect(
        evaluateGate({ kind: 'tool-call', toolName: 'set_node_prompt', args: { nodeId: 'n2', prompt: 'x' } }, ctx),
      ).toEqual({ outcome: 'ask' })
      expect(
        evaluateGate({ kind: 'tool-call', toolName: 'create_canvas_nodes', args: { nodes: [] } }, ctx),
      ).toEqual({ outcome: 'ask' })
    })

    it('覆盖锁住节点的外部图片结果 → deny', () => {
      const decision = evaluateGate(
        { kind: 'tool-call', toolName: 'attach_external_image_to_node', args: { nodeId: 'c1', sourceType: 'url', source: 'https://example.com/out.png' } },
        ctx,
      )
      expect(decision.outcome).toBe('deny')
      if (decision.outcome === 'deny') expect(decision.reason).toContain('覆盖它的图片结果')
    })
  })

  it('batch-run / spend intent 先一律 ask(S6b/S7 落地语义)', () => {
    expect(evaluateGate({ kind: 'batch-run', nodeIds: ['n1', 'n2'] })).toEqual({ outcome: 'ask' })
    expect(evaluateGate({ kind: 'spend', estimatedCost: 1.5 })).toEqual({ outcome: 'ask' })
  })
})
