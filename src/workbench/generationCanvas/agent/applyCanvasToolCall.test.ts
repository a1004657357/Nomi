import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_READ_CAPABILITY } from '../../../../electron/shared/agentCapabilities/canvasRead'

// 仅替换需要桌面 IPC 的目录读取；方案投影继续使用真实档案纯函数。
vi.mock('./availableModels', async (importOriginal) => ({
  ...await importOriginal<typeof import('./availableModels')>(),
  listAvailableModelsForAgent: vi.fn(async () => []),
}))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))
vi.mock('../runner/capabilityRecipeController', () => ({ runCapabilityRecipeOnNode: vi.fn() }))
vi.mock('../../api/taskApi', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/taskApi')>(), mintSpendGrant: vi.fn(),
}))
vi.mock('../quality/visionReviewModels', () => ({ listVisionReviewModelOptions: vi.fn(async () => []) }))
vi.mock('../quality/multiviewSubjectVisionReviewService', () => ({ createWorkbenchMultiviewSubjectComparator: vi.fn() }))
vi.mock('./model3dHandoff', () => ({ handoffModel3dNode: vi.fn() }))
vi.mock('../../ai/agentLoopMode', () => ({ runSingleShotAgent: vi.fn() }))

import {
  applyCanvasToolCall,
  parseCameraMoveSpec,
  parseStagingSpec,
  resetClientIdRegistry,
  resolveCanvasToolNodeId,
} from './applyCanvasToolCall'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { createProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { selectActiveStoryboardDesign } from '../../workbenchDocumentSlice'
import { tryAttachExternalImage } from './externalImageToolHandler'
import { runStoryboardTableAutofill } from './storyboardTableAutofill'
import { runSingleShotAgent } from '../../ai/agentLoopMode'
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
let projectSession: ReturnType<typeof createProjectSessionTestHarness> | null = null
afterEach(() => { projectSession?.dispose(); projectSession = null })

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
  projectSession?.dispose()
  projectSession = createProjectSessionTestHarness()
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
    modelId: 'gpt-image-2',
    modelAlias: 'GPT Image 2',
    vendor: 'openai',
    label: 'GPT Image 2',
    kind: 'image',
    archetypeId: 'gpt-image-2',
    defaultModeId: 't2i',
    modes: [
      { modeId: 't2i', vendorTerm: '文生图', intent: 'text', hint: '', params: [], slots: [] },
      {
        modeId: 'i2i', vendorTerm: '图生图', intent: 'single', hint: '', params: [],
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

  // 2026-09-25 用户拍板「程序不再主动平移 / 缩放画布」：Agent 建卡（单个、批量、跨分类）一律不请求适应、
  // 不派发聚焦、不切分类——屏外 / 别的分类的新节点由画布边缘提示指路。
  it('reported case: creating nodes never moves the viewport, focuses a node, or switches category', async () => {
    // 聚焦事件这一侧由 canvasViewportMovers.structure.test.ts 的名单守（这里是 node 环境，没有 window）。
    await applyCanvasToolCall('create_canvas_nodes', { nodes: [{ clientId: 'solo', kind: 'image', title: '单节点', prompt: 'p' }] })
    await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'batch-1', kind: 'image', title: '批量 1', prompt: 'p1' },
        { clientId: 'batch-2', kind: 'video', title: '批量 2', prompt: 'p2' },
      ],
    })
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(0)
  })

  it('class: nodes landing in another category leave the active category and viewport alone', async () => {
    useWorkbenchStore.getState().setActiveCategoryId('audio')
    await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'cast-1', kind: 'character', title: '角色', prompt: 'p1' },
        { clientId: 'shot-1', kind: 'video', title: '镜头', prompt: 'p2' },
      ],
    })
    expect(useWorkbenchStore.getState().activeCategoryId).toBe('audio')
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(0)
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

  it.each([CANVAS_READ_CAPABILITY.id, CANVAS_READ_CAPABILITY.aliases.pi, CANVAS_READ_CAPABILITY.aliases.mcp])(
    'rejects read route %s because reads belong to the main capability executor',
    async (toolName) => {
      await expect(applyCanvasToolCall(toolName, {})).rejects.toThrow(`unknown tool ${toolName}`)
    },
  )

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

describe('applyCanvasToolCall canonical nomi_canvas_plan patch_shots', () => {
  const plan: StoryboardPlan = {
    title: '雨夜追凶',
    anchors: [{ id: 'a1', kind: 'character', name: '林夏', description: '红色校服', carrier: 'visual' }],
    shots: [
      { index: 1, durationSec: 5, anchorIds: ['a1'], prompt: '推镜' },
      { index: 2, durationSec: 8, anchorIds: ['a1'], prompt: '跟拍', params: { aspect_ratio: '16:9', quality: 'high' } },
      { index: 3, durationSec: 5, anchorIds: [], prompt: '远景' },
    ],
  }

  beforeEach(() => {
    resetCanvas()
    useWorkbenchStore.getState().hydrateWorkbenchDocuments(
      [{ id: 'doc-1', version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }],
      'doc-1',
    )
    useWorkbenchStore.getState().hydrateStoryboardDesigns({ 'doc-1': [{ id: 'test-doc-1', documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] })
  })

  const shots = () => useWorkbenchStore.getState().storyboardDesignsByDocumentId['doc-1']?.[0]?.plan.shots ?? []
  const patch = (input: Record<string, unknown>) => applyCanvasToolCall('nomi_canvas_plan', { operation: 'patch_shots', ...input }, undefined, undefined, 'doc-1')

  it('applies promptAppend to the selected rows and returns a canonical receipt payload', async () => {
    const result = await patch({ select: { kind: 'indexes', indexes: [3, 1] }, patch: { promptAppend: '雨天' } }) as Record<string, unknown>
    expect(shots().map((shot) => shot.prompt)).toEqual(['推镜，雨天', '跟拍', '远景，雨天'])
    expect(result).toMatchObject({ status: 'applied', changedShotIndexes: [1, 3], changedFields: ['prompt'] })
  })

  it('preserves every unselected shot and every unselected field', async () => {
    const before = structuredClone(shots())
    await patch({ select: { kind: 'indexes', indexes: [2] }, patch: { aspectRatio: '9:16' } })
    expect(shots()[0]).toEqual(before[0])
    expect(shots()[2]).toEqual(before[2])
    expect(shots()[1]).toMatchObject({ prompt: before[1]?.prompt, durationSec: before[1]?.durationSec, anchorIds: before[1]?.anchorIds, params: { aspect_ratio: '9:16', quality: 'high' } })
  })

  it('rejects the retired public tool name and stale shot indexes without mutating state', async () => {
    const before = structuredClone(shots())
    await expect(applyCanvasToolCall('patch_shots', { select: { kind: 'all' }, patch: { prompt: 'x' } }, undefined, undefined, 'doc-1')).rejects.toThrow(/unknown tool/)
    await expect(patch({ select: { kind: 'indexes', indexes: [9] }, patch: { prompt: 'x' } })).rejects.toMatchObject({ code: 'capability_target_stale' })
    expect(shots()).toEqual(before)
  })

  it('fails closed when there is no storyboard plan', async () => {
    useWorkbenchStore.getState().hydrateStoryboardDesigns({})
    await expect(patch({ select: { kind: 'all' }, patch: { prompt: 'x' } })).rejects.toMatchObject({ code: 'capability_target_stale' })
  })
})

// 图片+视频分镜落画布的镜号语义：首帧图带 storyboardKeyframe 标记不自动领号，
// 落地后 UI/Agent 按 first_frame 边共用所属视频的镜号，不存第二份号码——
// 否则 N 镜领出 1..2N 交错编号，角标与「镜头 N 首帧」标题错位（A2 类编号 bug）。
describe('applyCanvasToolCall 图片+视频分镜镜号', () => {
  beforeEach(resetCanvas)

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
    await projectSession!.open('project-1')

    const attached = await tryAttachExternalImage({
      project: withProjectAction(project => project)!,
      toolName: 'attach_external_image_to_node',
      mutate: operation => operation(),
      record: {
      nodeId: 'shot1',
      sourceType: 'local_path',
      source: '/tmp/codex-imagegen/coffee.png',
      fileName: 'coffee.png',
      prompt: 'cinematic coffee ad',
      provider: 'codex-imagegen',
      modelKey: 'gpt-image-2',
      },
    })
    expect(attached.handled).toBe(true)
    if (!attached.handled) throw new Error('external image owner did not handle the import')
    const result = attached.value as { nodeId: string; assetId: string; relativePath: string }

    expect(importLocalPath).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', kind: 'generated', fileName: 'coffee.png',
      projectBinding: expect.objectContaining({ projectId: 'project-1' }),
      ownerNodeId: nodeId, path: '/tmp/codex-imagegen/coffee.png',
    }))
    expect(result).toMatchObject({ nodeId, assetId: 'asset-codex-1', relativePath: 'assets/generated/2026-07-04/coffee.png' })
    const node = useGenerationCanvasStore.getState().nodes.find(candidate => candidate.id === nodeId)
    expect(node?.status).toBe('success')
    expect(node?.result).toMatchObject({
      type: 'image', url: 'nomi-local://asset/project-1/assets/generated/2026-07-04/coffee.png',
      assetId: 'asset-codex-1', provenance: { provider: 'codex-imagegen', modelKey: 'gpt-image-2', prompt: 'cinematic coffee ad' },
    })
    expect(node?.history?.[0].id).toBe(node?.result?.id)
  })
})

// S2:propose_storyboard_plan 不碰画布——把结构化方案落创作 store 并切回创作区(规划免费可改)。
describe('applyCanvasToolCall timeline storyboard scope', () => {
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
  })

  it('rejects Agent node ids that cross two storyboard designs before mutating the timeline', async () => {
    const canvas = useGenerationCanvasStore.getState()
    const first = canvas.addNode({ kind: 'video', title: 'A1', categoryId: 'shots' })
    const second = canvas.addNode({ kind: 'video', title: 'B1', categoryId: 'shots' })
    canvas.updateNode(first.id, { meta: { storyboardDesignId: 'design-a' } })
    canvas.updateNode(second.id, { meta: { storyboardDesignId: 'design-b' } })
    const timelineBefore = useWorkbenchStore.getState().timeline

    await expect(applyCanvasToolCall('arrange_storyboard_to_timeline', {
      nodeIds: [first.id, second.id],
    })).rejects.toThrow('mixed_storyboard_scope')
    expect(useWorkbenchStore.getState().timeline).toBe(timelineBefore)
  })
})

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
    useWorkbenchStore.getState().hydrateWorkbenchDocuments(
      [{ id: 'doc-1', version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }],
      'doc-1',
    )
    useWorkbenchStore.getState().hydrateStoryboardDesigns({})
    useWorkbenchStore.getState().setWorkspaceMode('creation')
  })

  it('合法方案 → 创作 owner + 一张表投影,不创建生成镜头,回执含计数', async () => {
    const ack = await applyCanvasToolCall('propose_storyboard_plan', PLAN)
    const ws = useWorkbenchStore.getState()
    expect(ws.storyboardDesignsByDocumentId['doc-1']?.[0]?.plan).toEqual(PLAN)
    expect(ws.workspaceMode).toBe('creation')
    expect(ws.activeStoryboardId).toBeNull() // Agent 新建的方案只进列表，打开是用户的动作
    expect(useGenerationCanvasStore.getState().nodes.map(node => node.kind)).toEqual(['shot_table']) // 只建表投影，不生成媒体
    expect(ack).toMatchObject({ status: 'applied', documentId: 'doc-1', storyboardDesignId: expect.any(String) })
    expect((ack as { message: string }).message).toContain('1 个锚')
    expect((ack as { message: string }).message).toContain('2 个镜头')
  })

  it('畸形方案 → throw,不落 store(调用方映射成 tool error 回喂 LLM)', async () => {
    await expect(
      applyCanvasToolCall('propose_storyboard_plan', { title: 't', anchors: [{ id: 'x', kind: 'bad' }], shots: [] }),
    ).rejects.toThrow()
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId['doc-1']).toBeUndefined()
  })

  it('用户正在分镜页看着方案时，Agent 写新方案不把他挪去创作页', async () => {
    useWorkbenchStore.getState().setWorkspaceMode('storyboard')
    await applyCanvasToolCall('propose_storyboard_plan', PLAN, undefined, undefined, 'doc-1')
    expect(useWorkbenchStore.getState().workspaceMode).toBe('storyboard')
  })

  it('规划期间用户切走后不抢回工作区，结果仍落原文稿', async () => {
    useWorkbenchStore.getState().setWorkspaceMode('generation')
    await applyCanvasToolCall('propose_storyboard_plan', PLAN, undefined, undefined, 'doc-1')
    const ws = useWorkbenchStore.getState()
    expect(ws.workspaceMode).toBe('generation')
    expect(ws.storyboardDesignsByDocumentId['doc-1'][0].plan).toEqual(PLAN)
  })

  it('全新拆镜不会覆盖当前已确认的分镜设计', async () => {
    const first = await applyCanvasToolCall('propose_storyboard_plan', PLAN, undefined, undefined, 'doc-1')
    const firstId = (first as { storyboardDesignId: string }).storyboardDesignId
    useWorkbenchStore.getState().commitStoryboardPlan('doc-1', firstId)

    const nextPlan = { ...PLAN, title: '另一版' }
    const result = await applyCanvasToolCall('propose_storyboard_plan', nextPlan, undefined, undefined, 'doc-1')
    const ws = useWorkbenchStore.getState()

    expect(result).toMatchObject({ status: 'applied', storyboardDesignId: expect.any(String) })
    expect((result as { storyboardDesignId: string }).storyboardDesignId).not.toBe(firstId)
    expect(ws.storyboardDesignsByDocumentId['doc-1']).toHaveLength(2)
    expect(ws.storyboardDesignsByDocumentId['doc-1'].find((design) => design.id === firstId)?.committed).toBe(true)
  })

  it('生成期间原稿被删除时不留下孤儿分镜', async () => {
    useWorkbenchStore.getState().addWorkbenchDocument()
    const deletedDocumentId = useWorkbenchStore.getState().activeDocumentId
    useWorkbenchStore.getState().deleteWorkbenchDocument(deletedDocumentId)

    const result = await applyCanvasToolCall('propose_storyboard_plan', PLAN, undefined, undefined, deletedDocumentId)

    expect(result).toMatchObject({ status: 'obsolete', documentId: deletedDocumentId })
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId[deletedDocumentId]).toBeUndefined()
  })
})

describe('canonical patch_shots and storyboard autofill owners', () => {
  const PLAN: StoryboardPlan = {
    title: '咖啡广告',
    anchors: [],
    shots: [
      { index: 1, shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '旧视频提示词', imagePrompt: '旧首帧', videoPrompt: '旧视频提示词' },
      { index: 2, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: '旧图片提示词', imagePrompt: '旧图片提示词' },
    ],
  }

  beforeEach(async () => {
    resetCanvas()
    await projectSession!.open('project-1')
    useWorkbenchStore.getState().setStoryboardPlan(PLAN)
    useWorkbenchStore.getState().setWorkspaceMode('generation')
  })

  it('改视频提示词会更新分镜方案源头并镜像 prompt', async () => {
    const result = (await applyCanvasToolCall('nomi_canvas_plan', {
      operation: 'patch_shots', select: { kind: 'indexes', indexes: [1] }, patch: {
      videoPrompt: '咖啡杯热气升腾，镜头缓慢推进到杯口',
      modelKey: 'agnes-video-v2.0',
      modelVendor: 'pavo',
      durationSec: 5, aspectRatio: '16:9',
      },
    })) as { changedShotIndexes: number[]; changedFields: string[] }

    expect(result.changedShotIndexes).toEqual([1])
    expect(result.changedFields).toContain('videoPrompt')
    const shot = selectActiveStoryboardDesign(useWorkbenchStore.getState())?.plan.shots[0]
    expect(shot?.videoPrompt).toBe('咖啡杯热气升腾，镜头缓慢推进到杯口')
    expect(shot?.prompt).toBe('咖啡杯热气升腾，镜头缓慢推进到杯口')
    expect(shot?.modelKey).toBe('agnes-video-v2.0')
    expect(shot?.durationSec).toBe(5)
    expect(shot?.params).toEqual({ aspect_ratio: '16:9' })
    expect(useWorkbenchStore.getState().workspaceMode).toBe('generation')
  })

  it('改图片镜头 prompt 会同步 imagePrompt', async () => {
    await applyCanvasToolCall('nomi_canvas_plan', { operation: 'patch_shots', select: { kind: 'indexes', indexes: [2] }, patch: { prompt: '俯拍咖啡豆铺满桌面' } })
    const shot = selectActiveStoryboardDesign(useWorkbenchStore.getState())?.plan.shots[1]
    expect(shot?.prompt).toBe('俯拍咖啡豆铺满桌面')
    expect(shot?.imagePrompt).toBe('俯拍咖啡豆铺满桌面')
  })

  it('可直接更新分镜表结构化列', async () => {
    const result = (await applyCanvasToolCall('nomi_canvas_plan', {
      operation: 'patch_shots', select: { kind: 'indexes', indexes: [1] }, patch: {
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
      },
    })) as { changedFields: string[] }
    expect(result.changedFields).toEqual(expect.arrayContaining(['scene', 'shotSize', 'cameraAngle', 'cameraMove', 'dialogue', 'sound']))
    const shot = selectActiveStoryboardDesign(useWorkbenchStore.getState())?.plan.shots[0]
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

    vi.mocked(runSingleShotAgent).mockResolvedValueOnce({ text: JSON.stringify({
      shots: [
        {
          index: 1,
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
          index: 2,
          imagePrompt: '不应覆盖旧图片提示词',
          scene: '咖啡豆麻袋旁',
        },
      ],
    }), id: 'autofill-reply', status: 'finished', toolCalls: [], artifacts: [], finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 2 },
    })
    const result = await runStoryboardTableAutofill({ project: withProjectAction(project => project)!, plan: selectActiveStoryboardDesign(useWorkbenchStore.getState())!.plan, overwriteExisting: false })

    expect(result.updatedShotCount).toBe(2)
    expect(result.updatedShotIndices).toEqual([1, 2])
    const nextPlan = selectActiveStoryboardDesign(useWorkbenchStore.getState())?.plan
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
    await applyCanvasToolCall('nomi_canvas_plan', {
      operation: 'patch_shots', select: { kind: 'indexes', indexes: [1] },
      patch: { videoPrompt: '覆盖后的视频提示词', scene: '新的咖啡馆外景' },
    })
    const shot = selectActiveStoryboardDesign(useWorkbenchStore.getState())?.plan.shots[0]
    expect(shot?.scene).toBe('新的咖啡馆外景')
    expect(shot?.videoPrompt).toBe('覆盖后的视频提示词')
    expect(shot?.prompt).toBe('覆盖后的视频提示词')
  })

  it('无当前方案或镜号不存在时抛错', async () => {
    useWorkbenchStore.getState().setStoryboardPlan(null)
    await expect(applyCanvasToolCall('nomi_canvas_plan', { operation: 'patch_shots', select: { kind: 'indexes', indexes: [1] }, patch: { prompt: 'x' } })).rejects.toMatchObject({ code: 'capability_target_stale' })
    useWorkbenchStore.getState().setStoryboardPlan(PLAN)
    await expect(applyCanvasToolCall('nomi_canvas_plan', { operation: 'patch_shots', select: { kind: 'indexes', indexes: [9] }, patch: { prompt: 'x' } })).rejects.toMatchObject({ code: 'capability_target_stale' })
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

// S4 执行分支：建 director 节点 + 打 cameraMoveAutoCapture 标志（targetNodeId/fps/frameCount/move），不渲染。
describe('applyCanvasToolCall create_camera_move 执行', () => {
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
  })

  it('建 director 节点，标志含解析出的真实 targetNodeId + frameCount=duration*12', async () => {
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
    const director = useGenerationCanvasStore.getState().nodes.find((n) => n.id === res.cameraMoveNodeId)
    expect(director?.kind).toBe('director')
    const flag = director?.meta?.cameraMoveAutoCapture as Record<string, unknown> | undefined
    expect(flag).toMatchObject({ targetNodeId: targetId, fps: 24, frameCount: 72, move: 'push_in' })
    expect(director?.meta?.directorProject).toBeTruthy()
  })

  // 词表外逃生口：只给 customMove → 不建 director 节点、不渲，运镜指令追加进目标视频节点 prompt（诚实降级）。
  it('customMove（词表外）→ 不建 director，运镜指令追加进视频节点 prompt + 打幂等标志', async () => {
    const created = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [{ clientId: 'v9', kind: 'video', title: '镜头 1', prompt: '女孩站在窗边的特写' }],
    })) as { clientIdToNodeId: Record<string, string> }
    const targetId = created.clientIdToNodeId.v9

    const res = (await applyCanvasToolCall('create_camera_move', {
      shotClientId: 'v9',
      customMove: '快速甩镜到窗外街景（whip pan）',
    })) as { cameraMoveNodeId: string | null; targetNodeId: string | null; degraded?: boolean }

    expect(res.cameraMoveNodeId).toBeNull() // 不渲、不建 director 节点
    expect(res.degraded).toBe(true)
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.filter((n) => n.kind === 'director')).toHaveLength(0)
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
    expect(state.nodes.filter((node) => node.kind === 'director')).toHaveLength(0)
    expect(state.nodes.find((node) => node.id === created.clientIdToNodeId.v10)?.prompt).toContain('快速甩镜')
  })
})

// 词表外逃生口（站位）：只给 customBlocking → 不建 director、不渲，构图指令追加进目标关键帧节点 prompt。
describe('applyCanvasToolCall create_staging_reference customBlocking 降级', () => {
  beforeEach(() => {
    resetCanvas()
    resetClientIdRegistry()
  })

  it('customBlocking（词表外）→ 不建 director，构图指令追加进关键帧节点 prompt', async () => {
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
    expect(state.nodes.filter((n) => n.kind === 'director')).toHaveLength(0)
    const target = state.nodes.find((n) => n.id === targetId)
    expect(target?.prompt).toContain('三层人墙的复杂队形')
    expect(target?.prompt).toContain('雨夜天台')
    expect((target?.meta as Record<string, unknown>)?.stagingPromptApplied).toBeTruthy()
  })
})
