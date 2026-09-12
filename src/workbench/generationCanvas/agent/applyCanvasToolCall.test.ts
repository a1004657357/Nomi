import { beforeEach, describe, expect, it, vi } from 'vitest'

// availableModels 链路走 window.nomiDesktop IPC,node 测试环境不存在——mock 掉
// (本测试的 case 不带 modelKey,真实代码路径也不会调它)。
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: vi.fn(async () => []) }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))
vi.mock('../runner/capabilityRecipeController', () => ({
  runCapabilityRecipeOnNode: vi.fn(async (_sourceNodeId: string, plan: { id: string }, options: { onTargetCreated?: (nodeId: string) => void }) => {
    options.onTargetCreated?.('derived-recipe-node')
    return { nodeId: 'derived-recipe-node', collectionId: plan.id, successCount: 1, failureCount: 0 }
  }),
}))
vi.mock('../../api/taskApi', () => ({ mintSpendGrant: vi.fn(async () => 'grant-1') }))
vi.mock('../quality/visionReviewModels', () => ({ listVisionReviewModelOptions: vi.fn(async () => []) }))
vi.mock('../quality/multiviewSubjectVisionReviewService', () => ({
  createWorkbenchMultiviewSubjectComparator: vi.fn(() => vi.fn()),
}))
vi.mock('./model3dHandoff', () => ({
  handoffModel3dNode: vi.fn(async () => ({ targetNodeId: 'director-node', objectId: 'object-1', createdTarget: true })),
}))

import {
  applyCanvasToolCall,
  parseCameraMoveSpec,
  parseStagingSpec,
  resetClientIdRegistry,
  resolveCanvasToolNodeId,
} from './applyCanvasToolCall'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { setDesktopActiveProjectId } from '../../../desktop/activeProject'
import { getDesktopBridge, type DesktopBridge } from '../../../desktop/bridge'
import type { StoryboardPlan } from './storyboardPlan'
import { STORYBOARD_TABLE_DEFAULT_SIZE } from '../model/storyboardTableSizing'
import { listAvailableModelsForAgent, type AgentModelEntry } from './availableModels'
import { runCapabilityRecipeOnNode } from '../runner/capabilityRecipeController'
import { mintSpendGrant } from '../../api/taskApi'
import { handoffModel3dNode } from './model3dHandoff'
import { listVisionReviewModelOptions } from '../quality/visionReviewModels'
import { createWorkbenchMultiviewSubjectComparator } from '../quality/multiviewSubjectVisionReviewService'

const mockedGetDesktopBridge = vi.mocked(getDesktopBridge)
const mockedListAvailableModels = vi.mocked(listAvailableModelsForAgent)
const mockedRunCapabilityRecipe = vi.mocked(runCapabilityRecipeOnNode)
const mockedMintSpendGrant = vi.mocked(mintSpendGrant)
const mockedHandoffModel3d = vi.mocked(handoffModel3dNode)
const mockedListVisionReviewModels = vi.mocked(listVisionReviewModelOptions)
const mockedCreateVisionComparator = vi.mocked(createWorkbenchMultiviewSubjectComparator)

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
  setDesktopActiveProjectId(null)
  mockedGetDesktopBridge.mockReset()
  mockedListAvailableModels.mockReset()
  mockedListAvailableModels.mockResolvedValue([])
  mockedRunCapabilityRecipe.mockClear()
  mockedMintSpendGrant.mockClear()
  mockedHandoffModel3d.mockClear()
  mockedListVisionReviewModels.mockReset()
  mockedListVisionReviewModels.mockResolvedValue([])
  mockedCreateVisionComparator.mockClear()
}

const capabilityModels: AgentModelEntry[] = [
  {
    modelKey: 'gpt-image-2',
    modelAlias: 'GPT Image 2',
    vendor: 'openai',
    label: 'GPT Image 2',
    kind: 'image',
    archetypeId: 'gpt-image-2',
    defaultModeId: 't2i',
    modes: [
      { modeId: 't2i', vendorTerm: '文生图', intent: 'text', hint: '', params: [], slots: [], capabilities: [] },
      {
        modeId: 'i2i', vendorTerm: '图生图', intent: 'single', hint: '', params: [], capabilities: [],
        slots: [{ kind: 'image_ref', label: '输入图', max: 1 }],
      },
    ],
    variants: [],
  },
]

// 回归锁(评测 sb-001 抓出):agent 用 clientId(n1/n2)连边,渲染层曾不翻译直接
// 入 store → 落盘 "n1→n2" 吊边(指向不存在节点,连线静默丢失)。
describe('applyCanvasToolCall clientId 翻译', () => {
  beforeEach(() => {
    resetCanvas()
    useWorkbenchStore.setState({ activeCategoryId: 'shots', canvasFitNonce: 0, canvasFitCategoryId: null })
  })

  it('批量创建节点后请求一次适应视图，单节点不打断当前视口', async () => {
    await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'solo', kind: 'image', title: '单节点', prompt: 'p' }],
    })
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(0)

    await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'batch-1', kind: 'image', title: '批量 1', prompt: 'p1' },
        { clientId: 'batch-2', kind: 'video', title: '批量 2', prompt: 'p2' },
      ],
    })
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(1)
    expect(useWorkbenchStore.getState().canvasFitCategoryId).toBe('shots')
  })

  it('批量节点不在当前分类时切到包含新节点的主分类再 fit', async () => {
    useWorkbenchStore.getState().setActiveCategoryId('audio')
    await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'cast-1', kind: 'character', title: '角色', prompt: 'p1' },
        { clientId: 'shot-1', kind: 'video', title: '镜头', prompt: 'p2' },
      ],
    })
    expect(useWorkbenchStore.getState().activeCategoryId).toBe('shots')
    expect(useWorkbenchStore.getState().canvasFitCategoryId).toBe('shots')
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(1)
  })

  it('create_canvas_nodes 尊重 Agent 指定的角色/场景/道具分类', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'cast-1', kind: 'character', title: '老板', prompt: '角色参考图', categoryId: 'cast' },
        { clientId: 'scene-1', kind: 'scene', title: '月饼店', prompt: '场景参考图', categoryId: 'scene' },
        { clientId: 'prop-1', kind: 'image', title: '月饼盒', prompt: '道具参考图', categoryId: 'prop' },
      ],
    })) as { clientIdToNodeId: Record<string, string> }

    const nodes = useGenerationCanvasStore.getState().nodes
    expect(nodes.find((node) => node.id === created.clientIdToNodeId['cast-1'])?.categoryId).toBe('cast')
    expect(nodes.find((node) => node.id === created.clientIdToNodeId['scene-1'])?.categoryId).toBe('scene')
    expect(nodes.find((node) => node.id === created.clientIdToNodeId['prop-1'])?.categoryId).toBe('prop')
  })

  it('resetClientIdRegistry 清表后旧 clientId 不再解析到旧项目节点(P1 治跨项目串台)', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'n1', kind: 'image', title: '镜头 1', prompt: 'p1' }],
    })) as { clientIdToNodeId: Record<string, string> }
    // 注册后:resolveCanvasToolNodeId('n1') 翻译成真实 id。
    expect(resolveCanvasToolNodeId('n1')).toBe(created.clientIdToNodeId.n1)
    expect(resolveCanvasToolNodeId('n1')).not.toBe('n1')
    // 切项目会调它:清表后 'n1' 不再解析到旧项目节点(返回自身=未注册),杜绝跨项目误连/误删。
    resetClientIdRegistry()
    expect(resolveCanvasToolNodeId('n1')).toBe('n1')
  })

  it('connect_canvas_edges 用 clientId 连边 → store 里是真实节点 id', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'n1', kind: 'image', title: '镜头 1', prompt: 'p1' },
        { clientId: 'n2', kind: 'image', title: '镜头 2', prompt: 'p2' },
      ],
    })) as { createdNodeIds: string[]; clientIdToNodeId: Record<string, string> }
    expect(created.clientIdToNodeId.n1).toBeTruthy()

    const connected = (await applyCanvasToolCall('connect_canvas_edges', {
      edges: [{ sourceClientId: 'n1', targetClientId: 'n2' }],
    })) as { connectedCount: number; skippedEdges?: unknown[] }
    expect(connected.connectedCount).toBe(1)
    expect(connected.skippedEdges).toBeUndefined()

    const edges = useGenerationCanvasStore.getState().edges
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(created.clientIdToNodeId.n1)
    expect(edges[0].target).toBe(created.clientIdToNodeId.n2)
    // 吊边绝不入 store
    expect(edges.some((e) => e.source === 'n1' || e.target === 'n2')).toBe(false)
  })

  it('create_canvas_nodes 随计划携带 edges → 节点+边一次落地（用户拍板：不分两步）', async () => {
    const result = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'a1', kind: 'character', title: '男主', prompt: 'p0' },
        { clientId: 'a2', kind: 'image', title: '镜头 1 关键帧', prompt: 'p2' },
        { clientId: 'a3', kind: 'video', title: '镜头 1 视频', prompt: 'p3' },
      ],
      edges: [
        { sourceClientId: 'a1', targetClientId: 'a2', mode: 'character_ref' },
        { sourceClientId: 'a2', targetClientId: 'a3', mode: 'first_frame' },
      ],
    })) as { createdNodeIds: string[]; clientIdToNodeId: Record<string, string>; connectedCount?: number }
    expect(result.createdNodeIds).toHaveLength(3)
    expect(result.connectedCount).toBe(2)

    const state = useGenerationCanvasStore.getState()
    expect(state.edges).toHaveLength(2)
    expect(state.edges[0].source).toBe(result.clientIdToNodeId.a1)
    // T1：边语义随计划原样落 store（生成期参考槽分流依赖它）
    expect(state.edges.map((e) => e.mode)).toEqual(['character_ref', 'first_frame'])
    // 吊边绝不入 store（clientId 已全部翻译成真实 id）
    expect(state.edges.some((e) => /^a\d$/.test(e.source) || /^a\d$/.test(e.target))).toBe(false)
  })

  it('无 groupCategoryId：按 kind 归类（角色→cast）——agent 直接建卡不受影响', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'c1', kind: 'character', title: '男主', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === created.clientIdToNodeId.c1)
    expect(node?.categoryId).toBe('cast')
  })

  it('带 groupCategoryId=shots：整批落分镜（角色/场景与镜头同处，用户拍板 A）', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      groupCategoryId: 'shots',
      nodes: [
        { clientId: 'g1', kind: 'character', title: '男主', prompt: 'p' },
        { clientId: 'g2', kind: 'scene', title: '天台', prompt: 'p' },
        { clientId: 'g3', kind: 'video', title: '镜头 1', prompt: 'p' },
      ],
    })) as { clientIdToNodeId: Record<string, string> }
    const state = useGenerationCanvasStore.getState()
    const cat = (id: string) => state.nodes.find((n) => n.id === id)?.categoryId
    expect(cat(created.clientIdToNodeId.g1)).toBe('shots')
    expect(cat(created.clientIdToNodeId.g2)).toBe('shots')
    expect(cat(created.clientIdToNodeId.g3)).toBe('shots')
  })

  it('分镜组节点透传 storyboardPlanSnapshot 到 meta，并使用表格节点初始尺寸', async () => {
    const snapshot: StoryboardPlan = {
      title: '咖啡广告',
      anchors: [],
      shots: [
        {
          index: 1,
          shotKind: 'image',
          durationSec: 0,
          anchorIds: [],
          prompt: '咖啡杯特写',
          scene: '咖啡馆窗边',
          shotSize: '特写',
        },
      ],
    }
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      groupCategoryId: 'shots',
      nodes: [
        {
          clientId: 'storyboard-group',
          kind: 'text',
          title: '分镜组：咖啡广告',
          prompt: '分镜组',
          storyboardGroup: true,
          storyboardPlanSnapshot: snapshot,
        },
      ],
    })) as { clientIdToNodeId: Record<string, string> }
    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === created.clientIdToNodeId['storyboard-group'])
    expect(node?.meta?.storyboardGroup).toBe(true)
    expect(node?.meta?.storyboardPlanSnapshot).toEqual(snapshot)
    expect(node?.size).toEqual(STORYBOARD_TABLE_DEFAULT_SIZE)
  })

  it('非法 mode 按通用参考处理（不抛、不静默改语义）', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'b1', kind: 'image', title: 'x', prompt: 'p' },
        { clientId: 'b2', kind: 'image', title: 'y', prompt: 'p' },
      ],
      edges: [{ sourceClientId: 'b1', targetClientId: 'b2', mode: 'made_up_mode' }],
    })) as { connectedCount?: number }
    expect(created.connectedCount).toBe(1)
    // store 对缺省 mode 落 'reference'（通用参考）——非法值不得伪装成任何具体语义
    expect(useGenerationCanvasStore.getState().edges[0].mode ?? 'reference').toBe('reference')
  })

  it('端点不存在的边被跳过并如实回报,不入 store', async () => {
    const result = (await applyCanvasToolCall('connect_canvas_edges', {
      edges: [{ sourceClientId: 'ghost-a', targetClientId: 'ghost-b' }],
    })) as { connectedCount: number; skippedEdges?: unknown[] }
    expect(result.connectedCount).toBe(0)
    expect(result.skippedEdges).toHaveLength(1)
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(0)
  })

  it('set_node_prompt / delete_canvas_nodes 同样接受 clientId', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'n9', kind: 'image', title: 'X', prompt: 'old' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const realId = created.clientIdToNodeId.n9

    await applyCanvasToolCall('set_node_prompt', { nodeId: 'n9', prompt: 'new prompt' })
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === realId)?.prompt).toBe('new prompt')

    const deleted = (await applyCanvasToolCall('delete_canvas_nodes', { nodeIds: ['n9'] })) as {
      deletedNodeIds: string[]
    }
    expect(deleted.deletedNodeIds).toEqual([realId])
  })
})

describe('applyCanvasToolCall attach_external_image_to_node', () => {
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
  })

  it('导入本地 Codex/imagegen 图片路径并写回图片节点 result', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'shot1', kind: 'image', title: '咖啡镜头 1', prompt: '热咖啡产品图' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const nodeId = created.clientIdToNodeId.shot1
    const importLocalPath = vi.fn(async () => ({
      id: 'asset-codex-1',
      name: 'coffee.png',
      userId: 'local',
      projectId: 'project-1',
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
      data: {
        url: 'nomi-local://asset/project-1/assets/generated/2026-07-04/coffee.png',
        relativePath: 'assets/generated/2026-07-04/coffee.png',
        contentType: 'image/png',
      },
    }))
    mockedGetDesktopBridge.mockReturnValue({
      assets: {
        importLocalPath,
        importRemoteUrl: vi.fn(),
      },
    } as unknown as DesktopBridge)
    setDesktopActiveProjectId('project-1')

    const result = (await applyCanvasToolCall('attach_external_image_to_node', {
      nodeId: 'shot1',
      sourceType: 'local_path',
      source: '/tmp/codex-imagegen/coffee.png',
      fileName: 'coffee.png',
      prompt: 'cinematic coffee ad',
      provider: 'codex-imagegen',
      modelKey: 'gpt-image-2',
    })) as { nodeId: string; assetId: string; relativePath: string }

    expect(importLocalPath).toHaveBeenCalledWith({
      projectId: 'project-1',
      kind: 'generated',
      fileName: 'coffee.png',
      ownerNodeId: nodeId,
      path: '/tmp/codex-imagegen/coffee.png',
    })
    expect(result).toMatchObject({ nodeId, assetId: 'asset-codex-1', relativePath: 'assets/generated/2026-07-04/coffee.png' })
    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    expect(node?.status).toBe('success')
    expect(node?.result).toMatchObject({
      type: 'image',
      url: 'nomi-local://asset/project-1/assets/generated/2026-07-04/coffee.png',
      assetId: 'asset-codex-1',
      provenance: {
        provider: 'codex-imagegen',
        modelKey: 'gpt-image-2',
        prompt: 'cinematic coffee ad',
      },
    })
    expect(node?.history?.[0]?.id).toBe(node?.result?.id)
  })

  it('拒绝把图片结果写到非图片类节点', async () => {
    await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'copy', kind: 'text', title: '文案', prompt: 'p' }],
    })
    setDesktopActiveProjectId('project-1')
    await expect(
      applyCanvasToolCall('attach_external_image_to_node', {
        nodeId: 'copy',
        sourceType: 'url',
        source: 'https://example.com/out.png',
      }),
    ).rejects.toThrow('target_node_not_image_like')
  })
})

// S2:propose_storyboard_plan 不碰画布——把结构化方案落创作 store 并切回创作区(规划免费可改)。
describe('applyCanvasToolCall propose_storyboard_plan', () => {
  const PLAN: StoryboardPlan = {
    title: '雨夜追凶',
    anchors: [{ id: 'a1', kind: 'character', name: '林夏', description: '红色校服', carrier: 'visual' }],
    shots: [
      { index: 1, durationSec: 5, anchorIds: ['a1'], prompt: '推镜' },
      { index: 2, durationSec: 8, anchorIds: ['a1'], prompt: '跟拍' },
    ],
  }

  beforeEach(() => {
    resetCanvas()
    useWorkbenchStore.getState().setStoryboardPlan(null)
    useWorkbenchStore.getState().setWorkspaceMode('generation')
  })

  it('合法方案 → 落创作 store + 切回创作区 + 不动画布,回执含计数', async () => {
    const ack = (await applyCanvasToolCall('propose_storyboard_plan', PLAN)) as string
    const ws = useWorkbenchStore.getState()
    expect(ws.storyboardPlan).toEqual(PLAN)
    expect(ws.workspaceMode).toBe('creation')
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0) // 规划不碰画布
    expect(ack).toContain('1 个锚')
    expect(ack).toContain('2 个镜头')
  })

  it('畸形方案 → throw,不落 store(调用方映射成 tool error 回喂 LLM)', async () => {
    await expect(
      applyCanvasToolCall('propose_storyboard_plan', { title: 't', anchors: [{ id: 'x', kind: 'bad' }], shots: [] }),
    ).rejects.toThrow()
    expect(useWorkbenchStore.getState().storyboardPlan).toBeNull()
  })
})

describe('applyCanvasToolCall update_storyboard_shot', () => {
  const PLAN: StoryboardPlan = {
    title: '咖啡广告',
    anchors: [],
    shots: [
      { index: 1, shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '旧视频提示词', imagePrompt: '旧首帧', videoPrompt: '旧视频提示词' },
      { index: 2, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: '旧图片提示词', imagePrompt: '旧图片提示词' },
    ],
  }

  beforeEach(() => {
    resetCanvas()
    useWorkbenchStore.getState().setStoryboardPlan(PLAN)
    useWorkbenchStore.getState().setWorkspaceMode('generation')
  })

  it('改视频提示词会更新分镜方案源头并镜像 prompt', async () => {
    const result = (await applyCanvasToolCall('update_storyboard_shot', {
      shotIndex: 1,
      videoPrompt: '咖啡杯热气升腾，镜头缓慢推进到杯口',
      modelKey: 'agnes-video-v2.0',
      params: { duration: 5, aspect_ratio: '16:9' },
    })) as { shotIndex: number; updated: string[] }

    expect(result.shotIndex).toBe(1)
    expect(result.updated).toContain('videoPrompt')
    const shot = useWorkbenchStore.getState().storyboardPlan?.shots[0]
    expect(shot?.videoPrompt).toBe('咖啡杯热气升腾，镜头缓慢推进到杯口')
    expect(shot?.prompt).toBe('咖啡杯热气升腾，镜头缓慢推进到杯口')
    expect(shot?.modelKey).toBe('agnes-video-v2.0')
    expect(shot?.params).toEqual({ duration: 5, aspect_ratio: '16:9' })
    expect(useWorkbenchStore.getState().workspaceMode).toBe('creation')
  })

  it('改图片镜头 prompt 会同步 imagePrompt', async () => {
    await applyCanvasToolCall('update_storyboard_shot', { shotIndex: 2, prompt: '俯拍咖啡豆铺满桌面' })
    const shot = useWorkbenchStore.getState().storyboardPlan?.shots[1]
    expect(shot?.prompt).toBe('俯拍咖啡豆铺满桌面')
    expect(shot?.imagePrompt).toBe('俯拍咖啡豆铺满桌面')
  })

  it('可直接更新分镜表结构化列', async () => {
    const result = (await applyCanvasToolCall('update_storyboard_shot', {
      shotIndex: 1,
      scene: '咖啡馆窗边',
      shotSize: '中近景',
      cameraAngle: '正面平视',
      cameraMove: '缓慢推进',
      characters: '咖啡师',
      performance: '端起咖啡闻香',
      dialogue: '今天的第一杯，给自己。',
      props: '白瓷咖啡杯',
      sound: '轻柔爵士乐',
      notes: '手机背面朝向镜头时不写屏幕内容',
    })) as { updated: string[] }
    expect(result.updated).toEqual(expect.arrayContaining(['scene', 'shotSize', 'cameraAngle', 'cameraMove', 'dialogue', 'sound']))
    const shot = useWorkbenchStore.getState().storyboardPlan?.shots[0]
    expect(shot).toMatchObject({
      scene: '咖啡馆窗边',
      shotSize: '中近景',
      cameraAngle: '正面平视',
      cameraMove: '缓慢推进',
      characters: '咖啡师',
      performance: '端起咖啡闻香',
      dialogue: '今天的第一杯，给自己。',
      props: '白瓷咖啡杯',
      sound: '轻柔爵士乐',
      notes: '手机背面朝向镜头时不写屏幕内容',
    })
  })

  it('批量填表默认只补空字段，并确定性派生视频提示词同步到表格节点和视频节点', async () => {
    const canvas = useGenerationCanvasStore.getState()
    const group = canvas.addNode({
      kind: 'text',
      title: '分镜组：咖啡广告',
      prompt: '旧分镜脚本',
      meta: { storyboardGroup: true, storyboardPlanSnapshot: PLAN },
    })
    const videoNode = canvas.addNode({ kind: 'video', title: '镜头 1 视频', prompt: '旧视频节点提示词' })
    canvas.updateNode(videoNode.id, { shotIndex: 1 })

    const result = (await applyCanvasToolCall('batch_update_storyboard_shots', {
      overwriteExisting: false,
      deriveVideoPrompts: true,
      shots: [
        {
          shotIndex: 1,
          scene: '清晨咖啡馆吧台',
          shotSize: '中近景',
          cameraAngle: '吧台正面平视',
          cameraMove: '缓慢推近到咖啡杯',
          characters: '咖啡师',
          performance: '把刚萃取的浓缩咖啡端到吧台中央',
          dialogue: '您的拿铁好了。',
          props: '白瓷咖啡杯、拉花钢杯、木质吧台',
          sound: '轻柔爵士乐与咖啡机蒸汽声',
          notes: '保持手部动作清楚',
        },
        {
          shotIndex: 2,
          imagePrompt: '不应覆盖旧图片提示词',
          scene: '咖啡豆麻袋旁',
        },
      ],
    })) as { updatedShotCount: number; updatedShotIndices: number[] }

    expect(result.updatedShotCount).toBe(2)
    expect(result.updatedShotIndices).toEqual([1, 2])
    const nextPlan = useWorkbenchStore.getState().storyboardPlan
    const shot1 = nextPlan?.shots[0]
    const shot2 = nextPlan?.shots[1]
    expect(shot1?.scene).toBe('清晨咖啡馆吧台')
    expect(shot1?.videoPrompt).toContain('图生视频导演提示词：镜头 1，时长 5 秒')
    expect(shot1?.videoPrompt).toContain('首帧继承：以已连接的首帧作为唯一视觉起点')
    expect(shot1?.prompt).toBe(shot1?.videoPrompt)
    expect(shot2?.imagePrompt).toBe('旧图片提示词')
    expect(shot2?.scene).toBe('咖啡豆麻袋旁')

    const syncedGroup = useGenerationCanvasStore.getState().nodes.find((node) => node.id === group.id)
    const syncedVideo = useGenerationCanvasStore.getState().nodes.find((node) => node.id === videoNode.id)
    expect(syncedGroup?.meta?.storyboardPlanSnapshot).toEqual(nextPlan)
    expect(syncedGroup?.prompt).toContain('镜头 1')
    expect(syncedVideo?.prompt).toBe(shot1?.videoPrompt)
  })

  it('批量填表 overwriteExisting=true 时覆盖已有字段', async () => {
    await applyCanvasToolCall('batch_update_storyboard_shots', {
      overwriteExisting: true,
      deriveVideoPrompts: false,
      shots: [{ shotIndex: 1, videoPrompt: '覆盖后的视频提示词', scene: '新的咖啡馆外景' }],
    })
    const shot = useWorkbenchStore.getState().storyboardPlan?.shots[0]
    expect(shot?.scene).toBe('新的咖啡馆外景')
    expect(shot?.videoPrompt).toBe('覆盖后的视频提示词')
    expect(shot?.prompt).toBe('覆盖后的视频提示词')
  })

  it('无当前方案或镜号不存在时抛错', async () => {
    useWorkbenchStore.getState().setStoryboardPlan(null)
    await expect(applyCanvasToolCall('update_storyboard_shot', { shotIndex: 1, prompt: 'x' })).rejects.toThrow('storyboard_plan_not_found')
    useWorkbenchStore.getState().setStoryboardPlan(PLAN)
    await expect(applyCanvasToolCall('update_storyboard_shot', { shotIndex: 9, prompt: 'x' })).rejects.toThrow('storyboard_shot_not_found')
  })
})

// S4 运镜参考解析器：容错提取，非法/缺省由 builder 兜默认（与 parseStagingSpec 同例）。
describe('parseCameraMoveSpec — 容错解析运镜参数', () => {
  it('完整参数原样落 spec', () => {
    expect(parseCameraMoveSpec({ move: 'orbit_left', speed: 'slow', shot: 'wide', subjectPose: 'walk' })).toEqual({
      move: 'orbit_left',
      speed: 'slow',
      shot: 'wide',
      subjectPose: 'walk',
      customMove: undefined,
    })
  })

  it('缺 move/customMove → 全 undefined（执行器据此判 词表内/外/缺一）', () => {
    expect(parseCameraMoveSpec({})).toEqual({
      move: undefined,
      speed: undefined,
      shot: undefined,
      subjectPose: undefined,
      customMove: undefined,
    })
  })

  it('词表外逃生口：customMove 原样落，move 仍可空（不硬塞 enum）', () => {
    expect(parseCameraMoveSpec({ customMove: '希区柯克式眩晕变焦' })).toEqual({
      move: undefined,
      speed: undefined,
      shot: undefined,
      subjectPose: undefined,
      customMove: '希区柯克式眩晕变焦',
    })
  })

  it('customMove 会清掉模型从上一轮残留的 move enum', () => {
    expect(parseCameraMoveSpec({ move: 'push_in', customMove: '快速甩镜到窗外街景' })).toMatchObject({
      move: undefined,
      customMove: '快速甩镜到窗外街景',
    })
  })

  it('空串/非串值按缺省处理，不抛', () => {
    expect(parseCameraMoveSpec({ move: '   ', speed: 42 as unknown as string })).toEqual({
      move: undefined,
      speed: undefined,
      shot: undefined,
      subjectPose: undefined,
      customMove: undefined,
    })
  })

  it('灰模布景字段：sceneTemplate + props 与站位同解析（共享 parseSceneBackdrop）', () => {
    const spec = parseCameraMoveSpec({
      move: 'push_in',
      sceneTemplate: 'street',
      props: [{ kind: 'car', position: [2, 1], rotationY: 30 }, { kind: 'tree' }],
    })
    expect(spec.sceneTemplate).toBe('street')
    expect(spec.props).toEqual([
      { kind: 'car', position: [2, 1], rotationY: 30, scale: undefined },
      { kind: 'tree', position: undefined, rotationY: undefined, scale: undefined },
    ])
  })

  it('无布景字段 → sceneTemplate/props 均 undefined（老行为）', () => {
    const spec = parseCameraMoveSpec({ move: 'orbit_left' })
    expect(spec.sceneTemplate).toBeUndefined()
    expect(spec.props).toBeUndefined()
  })
})

// T2 站位解析器：新增布景字段（sceneTemplate/props）容错提取。
describe('parseStagingSpec — 灰模布景字段', () => {
  it('sceneTemplate + props（含位置/朝向/缩放）原样落 spec', () => {
    const spec = parseStagingSpec({
      characters: [{ pose: 'standing' }],
      sceneTemplate: 'street',
      props: [{ kind: 'car', position: [3, -1], rotationY: 90, scale: 1.2 }, { kind: 'tree' }],
    })
    expect(spec.sceneTemplate).toBe('street')
    expect(spec.props).toEqual([
      { kind: 'car', position: [3, -1], rotationY: 90, scale: 1.2 },
      { kind: 'tree', position: undefined, rotationY: undefined, scale: undefined },
    ])
  })

  it('无布景字段 → sceneTemplate/props 均 undefined（老行为不变）', () => {
    const spec = parseStagingSpec({ characters: [{ pose: 'standing' }] })
    expect(spec.sceneTemplate).toBeUndefined()
    expect(spec.props).toBeUndefined()
  })

  it('props 缺 kind / 位置非法 → 丢该件 / 位置置空，不抛', () => {
    const spec = parseStagingSpec({
      characters: [{}],
      props: [{ rotationY: 10 }, { kind: 'wall', position: [1] }],
    })
    expect(spec.props).toEqual([{ kind: 'wall', position: undefined, rotationY: undefined, scale: undefined }])
  })
})

// S4 执行分支：建 scene3d 节点 + 打 cameraMoveAutoCapture 标志（targetNodeId/fps/frameCount/move），不渲染。
describe('applyCanvasToolCall create_camera_move 执行', () => {
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
  })

  it('建 scene3d 节点，标志含解析出的真实 targetNodeId + frameCount=duration*12', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v1', kind: 'video', title: '镜头 1', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const targetId = created.clientIdToNodeId.v1

    const res = (await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v1',
      move: 'push_in',
      speed: 'fast', // 3s × 24fps = 72 帧（Seedance 要求 ≥23.8fps）
    })) as { cameraMoveNodeId: string; targetNodeId: string | null }

    expect(res.targetNodeId).toBe(targetId)
    const scene3d = useGenerationCanvasStore.getState().nodes.find((n) => n.id === res.cameraMoveNodeId)
    expect(scene3d?.kind).toBe('scene3d')
    const flag = scene3d?.meta?.cameraMoveAutoCapture as Record<string, unknown> | undefined
    expect(flag).toMatchObject({ targetNodeId: targetId, fps: 24, frameCount: 72, move: 'push_in' })
    expect(scene3d?.meta?.scene3dState).toBeTruthy()
  })

  // 词表外逃生口：只给 customMove → 不建 scene3d 节点、不渲，运镜指令追加进目标视频节点 prompt（诚实降级）。
  it('customMove（词表外）→ 不建 scene3d，运镜指令追加进视频节点 prompt + 打幂等标志', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v9', kind: 'video', title: '镜头 1', prompt: '女孩站在窗边的特写' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const targetId = created.clientIdToNodeId.v9

    const res = (await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v9',
      customMove: '快速甩镜到窗外街景（whip pan）',
    })) as { cameraMoveNodeId: string | null; targetNodeId: string | null; degraded?: boolean }

    expect(res.cameraMoveNodeId).toBeNull() // 不渲、不建 scene3d 节点
    expect(res.degraded).toBe(true)
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.filter((n) => n.kind === 'scene3d')).toHaveLength(0)
    const target = state.nodes.find((n) => n.id === targetId)
    expect(target?.prompt).toContain('快速甩镜')
    expect(target?.prompt).toContain('女孩站在窗边的特写') // 不覆盖原 prompt，追加
    expect((target?.meta as Record<string, unknown>)?.cameraMovePromptApplied).toBe('快速甩镜到窗外街景（whip pan）')

    // 幂等：同指令再来一次不重复追加
    await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v9',
      customMove: '快速甩镜到窗外街景（whip pan）',
    })
    const after = useGenerationCanvasStore.getState().nodes.find((n) => n.id === targetId)
    expect(((after?.prompt ?? '').match(/快速甩镜/g) || []).length).toBe(1)
  })

  it('move 与 customMove 都缺 → 抛错（不静默兜 push_in 硬塞运镜）', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v8', kind: 'video', title: '镜头', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    void created
    await expect(applyCanvasToolCall('create_camera_move', { shotClientId: 'v8' })).rejects.toThrow()
  })

  it('move 与 customMove 同时存在 → customMove 优先，不执行残留 enum', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v10', kind: 'video', title: '镜头', prompt: 'p' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const result = (await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v10',
      move: 'push_in',
      customMove: '快速甩镜',
    })) as { cameraMoveNodeId: string | null; degraded?: boolean }

    expect(result).toMatchObject({ cameraMoveNodeId: null, degraded: true })
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.filter((node) => node.kind === 'scene3d')).toHaveLength(0)
    expect(state.nodes.find((node) => node.id === created.clientIdToNodeId.v10)?.prompt).toContain('快速甩镜')
  })
})

describe('applyCanvasToolCall capability recipes', () => {
  beforeEach(resetCanvas)

  it('lists recipes with the connected compatible model modes', async () => {
    mockedListAvailableModels.mockResolvedValue(capabilityModels)

    const result = await applyCanvasToolCall('list_capability_recipes', {}) as {
      recipes: Array<{ id: string; compatibleModels: Array<{ modelKey: string; modeId: string }> }>
    }

    const multiview = result.recipes.find((recipe) => recipe.id === 'image.multiview.grid9')
    expect(result.recipes).toHaveLength(11)
    expect(multiview?.compatibleModels).toContainEqual(expect.objectContaining({
      modelKey: 'gpt-image-2',
      modeId: 'i2i',
    }))
  })

  it('lists connected image-capable text models for optional batch review', async () => {
    mockedListAvailableModels.mockResolvedValue(capabilityModels)
    mockedListVisionReviewModels.mockResolvedValue([{
      id: '["relay","qwen-vl-plus"]',
      vendorKey: 'relay',
      modelKey: 'qwen-vl-plus',
      label: 'Qwen VL Plus · Relay',
    }])

    const result = await applyCanvasToolCall('list_capability_recipes', {}) as {
      visionReviewModels: Array<{ modelKey: string }>
    }

    expect(result.visionReviewModels).toEqual([expect.objectContaining({ modelKey: 'qwen-vl-plus' })])
  })

  it('lists compact reusable creative resources alongside recipes', async () => {
    const created = await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'style-source', kind: 'image', title: '风格样张', prompt: 'soft film' }],
    }) as { clientIdToNodeId: Record<string, string> }
    const sourceNodeId = created.clientIdToNodeId['style-source']
    useGenerationCanvasStore.getState().addNodeResult(sourceNodeId, {
      id: 'style-result', type: 'image', url: 'nomi-local://style.png', assetId: 'asset-style', createdAt: 1,
    })
    const saved = await applyCanvasToolCall('save_creative_resource', {
      sourceNodeId,
      kind: 'style',
      label: '柔和胶片',
      description: '低反差高光',
      promptTokens: ['soft highlight', 'fine grain'],
      license: { source: '用户自有素材', commercialUse: 'allowed' },
    }) as { nodeId: string }

    const result = await applyCanvasToolCall('list_capability_recipes', {}) as {
      resources: Array<Record<string, unknown>>
    }
    expect(result.resources).toContainEqual({
      id: saved.nodeId,
      kind: 'style',
      label: '柔和胶片',
      description: '低反差高光',
      promptTokens: ['soft highlight', 'fine grain'],
      commercialUse: 'allowed',
      hasAsset: true,
    })
  })

  it('builds a run plan and starts a non-destructive background recipe run', async () => {
    mockedListAvailableModels.mockResolvedValue(capabilityModels)
    const created = await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'source-image', kind: 'image', title: '人物原图', prompt: 'same person' }],
    }) as { clientIdToNodeId: Record<string, string> }
    const sourceNodeId = created.clientIdToNodeId['source-image']
    useGenerationCanvasStore.getState().addNodeResult(sourceNodeId, {
      id: 'source-result', type: 'image', url: 'nomi-local://source.png', createdAt: 1,
    })

    const result = await applyCanvasToolCall('apply_capability_recipe', {
      sourceNodeId: 'source-image',
      recipeId: 'image.multiview.custom',
      modelKey: 'gpt-image-2',
      modeId: 'i2i',
      requestedOutputs: 2,
      params: { identityLock: true },
      outputs: [
        { id: 'front', label: '正面', azimuth: 0, elevation: 0, shotSize: '中景' },
        { id: 'side', label: '右侧', azimuth: 90, elevation: 5, shotSize: '近景' },
      ],
    }) as { accepted: boolean; targetNodeId: string; taskCount: number }

    expect(result).toMatchObject({ accepted: true, targetNodeId: 'derived-recipe-node', taskCount: 2 })
    expect(mockedRunCapabilityRecipe).toHaveBeenCalledTimes(1)
    const [calledSource, plan, options] = mockedRunCapabilityRecipe.mock.calls[0]
    expect(calledSource).toBe(sourceNodeId)
    expect(plan).toMatchObject({
      recipeId: 'image.multiview.custom',
      sourceNodeIds: [sourceNodeId],
      model: { vendorKey: 'openai', modelKey: 'gpt-image-2', modeId: 'i2i' },
      outputCount: 2,
      taskCount: 2,
      params: expect.objectContaining({ identityLock: true }),
    })
    expect(options.concurrency).toBe(2)
    await expect(options.grantFactory?.('new-node', 2)).resolves.toBe('grant-1')
    expect(mockedMintSpendGrant).toHaveBeenCalledWith(['new-node'], 2)
  })

  it('attaches one validated visual comparator to a multiview batch', async () => {
    mockedListAvailableModels.mockResolvedValue(capabilityModels)
    mockedListVisionReviewModels.mockResolvedValue([{
      id: '["relay","qwen-vl-plus"]',
      vendorKey: 'relay',
      modelKey: 'qwen-vl-plus',
      label: 'Qwen VL Plus · Relay',
    }])
    const created = await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'review-source', kind: 'image', title: '人物原图', prompt: 'same person' }],
    }) as { clientIdToNodeId: Record<string, string> }
    const sourceNodeId = created.clientIdToNodeId['review-source']
    useGenerationCanvasStore.getState().addNodeResult(sourceNodeId, {
      id: 'source-result', type: 'image', url: 'nomi-local://source.png', createdAt: 1,
    })

    const result = await applyCanvasToolCall('apply_capability_recipe', {
      sourceNodeId,
      recipeId: 'image.multiview.custom',
      modelKey: 'gpt-image-2',
      modeId: 'i2i',
      requestedOutputs: 2,
      visionReview: { vendorKey: 'relay', modelKey: 'qwen-vl-plus' },
    }) as { visionReview?: { calls: number } }

    const comparator = mockedCreateVisionComparator.mock.results[0]?.value
    expect(mockedCreateVisionComparator).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({ modelKey: 'qwen-vl-plus' }),
      sessionId: expect.stringMatching(/^recipe-run-/),
    }))
    expect(mockedRunCapabilityRecipe.mock.calls[0]?.[2].compareMultiviewSubjects).toBe(comparator)
    expect(result.visionReview).toEqual(expect.objectContaining({ calls: 1 }))
  })

  it('rejects unavailable review models before starting generation', async () => {
    mockedListAvailableModels.mockResolvedValue(capabilityModels)
    const created = await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'missing-review-source', kind: 'image', title: '人物原图', prompt: 'same person' }],
    }) as { clientIdToNodeId: Record<string, string> }
    const sourceNodeId = created.clientIdToNodeId['missing-review-source']
    useGenerationCanvasStore.getState().addNodeResult(sourceNodeId, {
      id: 'source-result', type: 'image', url: 'nomi-local://source.png', createdAt: 1,
    })

    await expect(applyCanvasToolCall('apply_capability_recipe', {
      sourceNodeId,
      recipeId: 'image.multiview.custom',
      modelKey: 'gpt-image-2',
      modeId: 'i2i',
      visionReview: { vendorKey: 'missing', modelKey: 'vision' },
    })).rejects.toThrow('未连接或不支持图片输入')
    expect(mockedRunCapabilityRecipe).not.toHaveBeenCalled()
  })

  it('rejects automatic multiview review on unrelated recipes', async () => {
    mockedListAvailableModels.mockResolvedValue(capabilityModels)
    const created = await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'portrait-review-source', kind: 'image', title: '人物原图', prompt: 'same person' }],
    }) as { clientIdToNodeId: Record<string, string> }
    const sourceNodeId = created.clientIdToNodeId['portrait-review-source']
    useGenerationCanvasStore.getState().addNodeResult(sourceNodeId, {
      id: 'source-result', type: 'image', url: 'nomi-local://source.png', createdAt: 1,
    })

    await expect(applyCanvasToolCall('apply_capability_recipe', {
      sourceNodeId,
      recipeId: 'portrait.refine',
      modelKey: 'gpt-image-2',
      modeId: 'i2i',
      visionReview: { vendorKey: 'relay', modelKey: 'qwen-vl-plus' },
    })).rejects.toThrow('只支持九宫格或自定义机位')
    expect(mockedRunCapabilityRecipe).not.toHaveBeenCalled()
  })

  it('expands an Agent-requested mood matrix to 25 ordered tasks with bounded concurrency', async () => {
    mockedListAvailableModels.mockResolvedValue(capabilityModels)
    const created = await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'portrait-source', kind: 'image', title: '人物原图', prompt: 'same person' }],
    }) as { clientIdToNodeId: Record<string, string> }
    const sourceNodeId = created.clientIdToNodeId['portrait-source']
    useGenerationCanvasStore.getState().addNodeResult(sourceNodeId, {
      id: 'portrait-source-result',
      type: 'image',
      url: 'nomi-local://portrait-source.png',
      createdAt: 1,
    })

    const result = await applyCanvasToolCall('apply_capability_recipe', {
      sourceNodeId: 'portrait-source',
      recipeId: 'portrait.mood',
      modelKey: 'gpt-image-2',
      modeId: 'i2i',
      params: {
        generationMode: 'matrix5x5',
        expressionStrength: 50,
        identityLock: true,
      },
    }) as { outputCount: number; taskCount: number }

    expect(result).toMatchObject({ outputCount: 25, taskCount: 25 })
    const [, plan, options] = mockedRunCapabilityRecipe.mock.calls[0]
    expect(plan.outputs).toHaveLength(25)
    expect(plan.outputs[0]).toMatchObject({ id: 'mood-e0-a0', energy: 0, affinity: 0 })
    expect(plan.outputs[24]).toMatchObject({ id: 'mood-e4-a4', energy: 4, affinity: 4 })
    expect(options.concurrency).toBe(2)
  })

  it('rejects unknown recipes before creating a run', async () => {
    mockedListAvailableModels.mockResolvedValue(capabilityModels)
    const created = await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'source-image', kind: 'image', title: '人物原图', prompt: 'same person' }],
    }) as { clientIdToNodeId: Record<string, string> }

    await expect(applyCanvasToolCall('apply_capability_recipe', {
      sourceNodeId: created.clientIdToNodeId['source-image'],
      recipeId: 'unknown.recipe',
    })).rejects.toThrow('未知创作能力配方')
    expect(mockedRunCapabilityRecipe).not.toHaveBeenCalled()
  })

  it('rejects missing and mismatched creative resources before starting a paid run', async () => {
    mockedListAvailableModels.mockResolvedValue(capabilityModels)
    const created = await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'source-image', kind: 'image', title: '人物原图', prompt: 'same person' }],
    }) as { clientIdToNodeId: Record<string, string> }
    const sourceNodeId = created.clientIdToNodeId['source-image']
    useGenerationCanvasStore.getState().addNodeResult(sourceNodeId, {
      id: 'source-result', type: 'image', url: 'nomi-local://source.png', createdAt: 1,
    })
    const saved = await applyCanvasToolCall('save_creative_resource', {
      sourceNodeId,
      kind: 'identity',
      label: '角色身份',
      promptTokens: ['same identity'],
      license: { source: '用户自有素材', commercialUse: 'allowed' },
    }) as { nodeId: string }

    await expect(applyCanvasToolCall('apply_capability_recipe', {
      sourceNodeId,
      recipeId: 'image.style.transfer',
      resourceIds: ['missing-resource'],
    })).rejects.toThrow(/资源不存在/)
    await expect(applyCanvasToolCall('apply_capability_recipe', {
      sourceNodeId,
      recipeId: 'image.style.transfer',
      resourceIds: [saved.nodeId],
    })).rejects.toThrow(/需要.*style.*palette|仅接受.*style.*palette/)
    expect(mockedRunCapabilityRecipe).not.toHaveBeenCalled()
  })

  it('saves a generated node as a reusable creative resource', async () => {
    const created = await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'source-style', kind: 'image', title: '风格样张', prompt: 'soft film' }],
    }) as { clientIdToNodeId: Record<string, string> }
    const sourceNodeId = created.clientIdToNodeId['source-style']
    useGenerationCanvasStore.getState().addNodeResult(sourceNodeId, {
      id: 'style-result', type: 'image', url: 'nomi-local://style.png', assetId: 'asset-style', createdAt: 1,
    })

    const result = await applyCanvasToolCall('save_creative_resource', {
      sourceNodeId: 'source-style',
      kind: 'style',
      label: '柔和胶片',
      description: '低反差高光与细颗粒',
      promptTokens: ['35mm film', 'soft highlight rolloff'],
      license: { source: '用户自有素材', commercialUse: 'allowed' },
    }) as { nodeId: string }

    const resource = useGenerationCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)
    expect(resource).toMatchObject({
      kind: 'resource',
      creativeResource: { kind: 'style', label: '柔和胶片', assetIds: ['asset-style'] },
    })
  })

  it('hands a generated model to Blender Director through the shared action', async () => {
    const created = await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'generated-model', kind: 'image', title: '生成模型', prompt: '3d' }],
    }) as { clientIdToNodeId: Record<string, string> }

    const result = await applyCanvasToolCall('handoff_model3d', {
      sourceNodeId: 'generated-model',
      target: 'vibingDirector',
      license: 'user-owned',
    })

    expect(result).toEqual({ targetNodeId: 'director-node', objectId: 'object-1', createdTarget: true })
    expect(mockedHandoffModel3d).toHaveBeenCalledWith(expect.objectContaining({
      sourceNodeId: created.clientIdToNodeId['generated-model'],
      target: 'vibingDirector',
      license: 'user-owned',
    }))
  })
})

// 词表外逃生口（站位）：只给 customBlocking → 不建 scene3d、不渲，构图指令追加进目标关键帧节点 prompt。
describe('applyCanvasToolCall create_staging_reference customBlocking 降级', () => {
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
  })

  it('customBlocking（词表外）→ 不建 scene3d，构图指令追加进关键帧节点 prompt', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'k1', kind: 'image', title: '镜头关键帧', prompt: '雨夜天台' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const targetId = created.clientIdToNodeId.k1

    const res = (await applyCanvasToolCall('create_staging_reference', {
      shotClientId: 'k1',
      customBlocking: '三层人墙的复杂队形，主角越肩构图',
    })) as { stagingNodeId: string | null; targetNodeId: string | null; degraded?: boolean }

    expect(res.stagingNodeId).toBeNull()
    expect(res.degraded).toBe(true)
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.filter((n) => n.kind === 'scene3d')).toHaveLength(0)
    const target = state.nodes.find((n) => n.id === targetId)
    expect(target?.prompt).toContain('三层人墙的复杂队形')
    expect(target?.prompt).toContain('雨夜天台')
    expect((target?.meta as Record<string, unknown>)?.stagingPromptApplied).toBeTruthy()
  })
})
