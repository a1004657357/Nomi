import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addProjectNodes,
  connectProjectNodes,
  createNamedProject,
  deleteProjectNodes,
  generateOnProject,
  listAvailableModels,
  listAllProjects,
  readProjectCanvas,
  referencesFromEdges,
  renderDirectorOnProject,
  resolveCapabilityPollIntervalMs,
  setProjectNodePrompt,
} from './core'
import { createDiskGateway, type PlanConfirmInfo, type ProjectGateway } from './gateway'

describe('referencesFromEdges（连参考边=喂参考图，headless 兜底）', () => {
  const snap = {
    nodes: [
      { id: 'a', kind: 'image', result: { url: 'nomi-local://a.png' } },
      { id: 'b', kind: 'image' },
      { id: 'c', kind: 'image', url: 'nomi-local://c.png' },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', mode: 'reference', order: 1 },
      { id: 'e2', source: 'c', target: 'b', mode: 'character_ref', order: 0 },
    ],
    groups: [],
    selectedNodeIds: [],
  } as never
  it('收集指向目标节点的参考类入边的源资产，按 order 排', () => {
    expect(referencesFromEdges(snap, 'b')).toEqual(['nomi-local://c.png', 'nomi-local://a.png'])
  })
  it('无入边目标返回空', () => {
    expect(referencesFromEdges(snap, 'a')).toEqual([])
  })
  it('非参考类边（first_frame 等）不计入此兜底', () => {
    const s = { ...(snap as object), edges: [{ id: 'e', source: 'a', target: 'b', mode: 'first_frame', order: 0 }] } as never
    expect(referencesFromEdges(s, 'b')).toEqual([])
  })
})

const tempRoots: string[] = []
let mockedDocumentsRoot = ''
let mockedUserDataRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'documents') return mockedDocumentsRoot
      return mockedUserDataRoot
    },
    getAppPath: () => process.cwd(),
  },
}))

function makeTempDir(name = 'nomi-capcore-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name))
  tempRoots.push(dir)
  return dir
}

beforeEach(() => {
  mockedDocumentsRoot = makeTempDir('nomi-capcore-documents-')
  mockedUserDataRoot = makeTempDir('nomi-capcore-user-data-')
  delete process.env.NOMI_PROJECTS_DIR
})

afterEach(() => {
  delete process.env.NOMI_PROJECTS_DIR
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('capabilityCore/core (磁盘网关：直写 project.json)', () => {
  it('AGNES 视频 headless 轮询使用保守间隔，其他慢道保持既有间隔', () => {
    expect(resolveCapabilityPollIntervalMs('image_to_video', 'agnes')).toBe(15_000)
    expect(resolveCapabilityPollIntervalMs('text_to_video', 'kie')).toBe(3_000)
    expect(resolveCapabilityPollIntervalMs('text_to_image', 'agnes')).toBe(1_500)
  })

  it('models 只暴露已连接供应商的启用模型', () => {
    const now = '2026-07-17T00:00:00.000Z'
    const vendor = (key: string, patch: Record<string, unknown> = {}) => ({
      key,
      name: key,
      enabled: true,
      authType: 'bearer',
      baseUrlHint: `https://${key}.example`,
      createdAt: now,
      updatedAt: now,
      ...patch,
    })
    const model = (modelKey: string, vendorKey: string, patch: Record<string, unknown> = {}) => ({
      modelKey,
      vendorKey,
      labelZh: modelKey,
      kind: 'image',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      ...patch,
    })
    fs.writeFileSync(path.join(mockedUserDataRoot, 'model-catalog.json'), JSON.stringify({
      version: 5,
      vendors: [
        vendor('local', { authType: 'none' }),
        vendor('connected'),
        vendor('missing-key'),
        vendor('disabled-vendor', { enabled: false, authType: 'none' }),
      ],
      models: [
        model('local-image', 'local'),
        model('connected-image', 'connected'),
        model('missing-key-image', 'missing-key'),
        model('disabled-vendor-image', 'disabled-vendor'),
        model('disabled-model', 'local', { enabled: false }),
      ],
      mappings: [],
      apiKeysByVendor: {
        connected: {
          vendorKey: 'connected',
          apiKey: 'opaque-test-value',
          enc: 'plain',
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }), 'utf8')

    expect(listAvailableModels().map((entry) => `${entry.vendor}/${entry.modelKey}`)).toEqual([
      'local/local-image',
      'connected/connected-image',
    ])
  })

  it('建项目 → 加节点 → 连线 → 改提示词 → 读画布，全程落盘且重读一致', async () => {
    const project = createNamedProject('能力核测试项目')
    expect(project.id).toBeTruthy()
    expect(listAllProjects().some((item) => item.id === project.id)).toBe(true)
    const gateway = createDiskGateway(project.id)

    const { ids } = await addProjectNodes(gateway, [
      { kind: 'text', prompt: '一句产品脚本' },
      { kind: 'image', title: '镜头 1' },
    ])
    expect(ids).toHaveLength(2)

    const connected = await connectProjectNodes(gateway, [{ source: ids[0], target: ids[1], mode: 'reference' }])
    expect(connected.edgeIds).toHaveLength(1)
    expect(connected.skipped).toHaveLength(0)

    const prompted = await setProjectNodePrompt(gateway, ids[1], '电影感写实，黄昏光线')
    expect(prompted.changed).toBe(true)

    // 重新读（从盘）—— 验证持久化往返一致。
    const canvas = await readProjectCanvas(createDiskGateway(project.id))
    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.edges).toHaveLength(1)
    const shot = canvas.nodes.find((node) => node.id === ids[1])
    expect(shot?.prompt).toBe('电影感写实，黄昏光线')
  })

  it('方案门（Phase B）：≥2 节点弹门确认，批准落画布 / 拒绝不落回 cancelled / 单节点不弹', async () => {
    function mockGateway(planApproved: boolean) {
      const planCalls: PlanConfirmInfo[] = []
      let applyCount = 0
      const gateway: ProjectGateway = {
        readDoc: async () => ({ nodes: [], edges: [] }),
        apply: async () => { applyCount += 1 },
        confirmSpend: async () => null,
        confirmPlan: async (info) => { planCalls.push(info); return planApproved },
      }
      return { gateway, planCalls, getApplyCount: () => applyCount }
    }

    // 批准 → 落画布，方案门带对齐的 nodeCount/titles/projectId。
    const approved = mockGateway(true)
    const okRes = await addProjectNodes(approved.gateway, [{ kind: 'image', title: '镜 1' }, { kind: 'image', title: '镜 2' }], 'proj-1')
    expect(approved.planCalls).toHaveLength(1)
    expect(approved.planCalls[0]).toMatchObject({ nodeCount: 2, projectId: 'proj-1', titles: ['镜 1', '镜 2'] })
    expect(okRes.ids).toHaveLength(2)
    expect(okRes.cancelled).toBeUndefined()
    expect(approved.getApplyCount()).toBe(1)

    // 拒绝 → 不落画布（apply 零调用）、回 cancelled。
    const rejected = mockGateway(false)
    const noRes = await addProjectNodes(rejected.gateway, [{ kind: 'image' }, { kind: 'video' }], 'proj-1')
    expect(rejected.planCalls).toHaveLength(1)
    expect(noRes.cancelled).toBe(true)
    expect(noRes.ids).toEqual([])
    expect(rejected.getApplyCount()).toBe(0)

    // 单节点不算「方案」→ 不弹门，直落。
    const single = mockGateway(true)
    const oneRes = await addProjectNodes(single.gateway, [{ kind: 'image', title: '一张图' }], 'proj-1')
    expect(single.planCalls).toHaveLength(0)
    expect(oneRes.ids).toHaveLength(1)
  })

  it('删节点连带清边，落盘后边为空', async () => {
    const project = createNamedProject('删节点测试')
    const gateway = createDiskGateway(project.id)
    const { ids } = await addProjectNodes(gateway, [{ kind: 'image' }, { kind: 'video' }])
    await connectProjectNodes(gateway, [{ source: ids[0], target: ids[1] }])
    const removed = await deleteProjectNodes(gateway, [ids[0]])
    expect(removed.deleted).toEqual([ids[0]])
    const canvas = await readProjectCanvas(createDiskGateway(project.id))
    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.edges).toHaveLength(0)
  })

  it('generate 构造正确请求体（注入 runTask 不打 vendor）并把结果落回节点', async () => {
    const project = createNamedProject('生成测试')
    const captured: Array<{ vendor: string; request: unknown }> = []
    const fakeRunTask = async (payload: { vendor: string; request: unknown }) => {
      captured.push(payload)
      return {
        id: 'task-xyz',
        status: 'succeeded',
        assets: [{ type: 'image', url: 'nomi-local://asset/p/img.png', providerUrl: 'https://cdn/img.png' }],
      }
    }

    const out = await generateOnProject(
      { projectId: project.id, intent: 'image', prompt: '一只赛博朋克猫', vendor: 'apimart', modelKey: 'seedream-4', references: ['https://cdn/ref.png'] },
      createDiskGateway(project.id),
      fakeRunTask,
    )

    expect(out.status).toBe('succeeded')
    expect(captured).toHaveLength(1)
    // 请求体：高层 TaskRequest，extras 带 modelKey/projectId/nodeId/referenceImages，kind 由 intent 推。
    const req = captured[0].request as { kind: string; prompt: string; extras: Record<string, unknown> }
    expect(captured[0].vendor).toBe('apimart')
    // ⚠️ 这条**曾经断言 text_to_image**——本用例明明传了 references，却把「参考图被丢掉」写成了规范，
    // 于是 bug 有测试保护、一直没人发现。真生成实测才暴露：喂「橘猫戴红围巾坐雪景窗台」的照片说
    // 「把围巾改成蓝色」，出来的是另一只白猫的插画（火山 Seedream 与 apimart 两条路都中招）。
    // 带参考图 = 改图，与 video 那支对称。
    expect(req.kind).toBe('image_edit')
    expect(req.prompt).toBe('一只赛博朋克猫')
    expect(req.extras.modelKey).toBe('seedream-4')
    expect(req.extras.projectId).toBe(project.id)
    expect(req.extras.nodeId).toBe(out.nodeId)
    expect(req.extras.referenceImages).toEqual(['https://cdn/ref.png'])

    // 结果落回节点：重读画布该节点 hasResult。
    const canvas = await readProjectCanvas(createDiskGateway(project.id))
    expect(canvas.nodes.find((node) => node.id === out.nodeId)?.hasResult).toBe(true)
  })

  it('generate：image + 没有参考图 → text_to_image（别反过来把纯文生也当改图）', async () => {
    const project = createNamedProject('纯文生图意图测试')
    let kind = ''
    await generateOnProject(
      { projectId: project.id, intent: 'image', prompt: '一只赛博朋克猫', vendor: 'apimart', modelKey: 'seedream-4' },
      createDiskGateway(project.id),
      async (payload) => {
        kind = (payload.request as { kind: string }).kind
        return { id: 't', status: 'succeeded', assets: [] }
      },
    )
    expect(kind).toBe('text_to_image')
  })

  it('generate：video + 有参考图 → image_to_video', async () => {
    const project = createNamedProject('视频意图测试')
    let kind = ''
    await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: '镜头推进', vendor: 'apimart', modelKey: 'seedance', references: ['https://cdn/first.png'] },
      createDiskGateway(project.id),
      async (payload) => {
        kind = (payload.request as { kind: string }).kind
        return { id: 't', status: 'succeeded', assets: [] }
      },
    )
    expect(kind).toBe('image_to_video')
  })

  it('generate：异步结果查询被限流时只退避续查，不重复 create', async () => {
    vi.useFakeTimers()
    try {
      const project = createNamedProject('AGNES 限流续查测试')
      const runTask = vi.fn(async () => ({ id: 'agnes-task-1', status: 'queued', assets: [] }))
      const fetchTaskResult = vi.fn()
        .mockRejectedValueOnce(new Error('HTTP 429 rate limit exceeded'))
        .mockResolvedValueOnce({ result: { id: 'agnes-task-1', status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://asset/p/video.mp4' }] } })
      const pending = generateOnProject(
        { projectId: project.id, intent: 'video', prompt: '人物转身', vendor: 'agnes', modelKey: 'agnes-video-v2.0', references: ['https://cdn/ref.png'] },
        createDiskGateway(project.id),
        runTask,
        fetchTaskResult,
      )

      await vi.runAllTimersAsync()
      await expect(pending).resolves.toMatchObject({ status: 'succeeded' })
      expect(runTask).toHaveBeenCalledTimes(1)
      expect(fetchTaskResult).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('generate：同画布参考资产会持久化到目标节点并自动建立 reference 血缘边', async () => {
    const project = createNamedProject('参考血缘测试')
    const gateway = createDiskGateway(project.id)
    const sourceUrl = 'nomi-local://asset/project/assets/source.png'
    const snapshot = await gateway.readDoc()
    snapshot.nodes.push({
      id: 'source-image',
      kind: 'image',
      title: '角色定妆',
      position: { x: 0, y: 0 },
      result: { id: 'source-result', type: 'image', url: sourceUrl, createdAt: 1 },
    })
    await gateway.apply(snapshot)

    const output = await generateOnProject(
      {
        projectId: project.id,
        intent: 'video',
        prompt: '角色转身看向镜头',
        vendor: 'agnes',
        modelKey: 'agnes-video-v2.0',
        references: [sourceUrl],
      },
      gateway,
      async () => ({ id: 'task-lineage', status: 'succeeded', assets: [] }),
    )

    const persisted = await gateway.readDoc()
    expect(persisted.nodes.find((node) => node.id === output.nodeId)?.references).toEqual([sourceUrl])
    expect(persisted.edges).toEqual([
      expect.objectContaining({ source: 'source-image', target: output.nodeId, mode: 'reference' }),
    ])
  })

  it('generate：参考 URL 同时匹配多个来源节点时不猜来源、不自动连线', async () => {
    const project = createNamedProject('歧义参考测试')
    const gateway = createDiskGateway(project.id)
    const sourceUrl = 'nomi-local://asset/project/assets/shared.png'
    const snapshot = await gateway.readDoc()
    snapshot.nodes.push(
      { id: 'source-a', kind: 'image', title: 'A', position: { x: 0, y: 0 }, result: { url: sourceUrl } },
      { id: 'source-b', kind: 'image', title: 'B', position: { x: 0, y: 320 }, result: { url: sourceUrl } },
    )
    await gateway.apply(snapshot)

    await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: '镜头推进', vendor: 'agnes', modelKey: 'agnes-video-v2.0', references: [sourceUrl] },
      gateway,
      async () => ({ id: 'task-ambiguous', status: 'succeeded', assets: [] }),
    )

    expect((await gateway.readDoc()).edges).toHaveLength(0)
  })

  it('director render 只读取 scene3d 状态，并把预演图与 GLB 作为连接输出回写画布', async () => {
    const project = createNamedProject('导演桥接测试')
    const gateway = createDiskGateway(project.id)
    const snapshot = await gateway.readDoc()
    snapshot.nodes.push({
      id: 'scene-node',
      kind: 'scene3d',
      title: '咖啡广告导演台',
      position: { x: 120, y: 240 },
      meta: {
        scene3dState: {
          objects: [],
          cameras: [],
          trajectories: [],
          trajectoryBindings: [],
          sceneTimeline: { totalDuration: 3 },
          environment: {},
          editorCamera: {},
        },
      },
    })
    await gateway.apply(snapshot)
    const calls: Array<Record<string, unknown>> = []

    const output = await renderDirectorOnProject(
      { projectId: project.id, sourceNodeId: 'scene-node', stagePreset: 'coffee_shop' },
      gateway,
      async (input) => {
        calls.push(input)
        return {
          jobId: 'director-job',
          blenderVersion: '4.0.1',
          preview: { url: 'nomi-local://asset/p/director-preview.png', assetId: 'preview-asset' },
          blend: { url: 'nomi-local://asset/p/director-scene.blend', assetId: 'blend-asset' },
          model: { url: 'nomi-local://asset/p/director-scene.glb', assetId: 'model-asset' },
        }
      },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ projectId: project.id, ownerNodeId: 'scene-node', stagePreset: 'coffee_shop' })
    expect(output).toMatchObject({ jobId: 'director-job', sourceNodeId: 'scene-node' })
    const persisted = await gateway.readDoc()
    const preview = persisted.nodes.find((node) => node.id === output.previewNodeId)
    const model = persisted.nodes.find((node) => node.id === output.modelNodeId)
    expect(preview).toMatchObject({ kind: 'image', title: 'Blender 导演预演', status: 'success', result: { type: 'image' } })
    expect(model).toMatchObject({ kind: 'model3d', title: 'Blender 导演场景', status: 'success', result: { type: 'model3d' } })
    expect(persisted.edges.filter((edge) => edge.source === 'scene-node')).toHaveLength(2)
    expect((persisted.nodes.find((node) => node.id === 'scene-node')?.meta?.scene3dState as { lastThumbnail?: string }).lastThumbnail).toContain('director-preview.png')
  })

  it('director render 为外部刚创建的空 scene3d 节点补一个标准灰模初始状态', async () => {
    const project = createNamedProject('空导演台')
    const gateway = createDiskGateway(project.id)
    const snapshot = await gateway.readDoc()
    snapshot.nodes.push({ id: 'scene-node', kind: 'scene3d', title: '空导演台', position: { x: 0, y: 0 } })
    await gateway.apply(snapshot)
    let capturedScene: unknown

    await renderDirectorOnProject(
      { projectId: project.id, sourceNodeId: 'scene-node' },
      gateway,
      async (input) => {
        capturedScene = input.scene
        return {
          jobId: 'director-default',
          preview: { url: 'nomi-local://asset/p/default-preview.png' },
          blend: { url: 'nomi-local://asset/p/default-scene.blend' },
          model: { url: 'nomi-local://asset/p/default-scene.glb' },
        }
      },
    )

    expect(capturedScene).toMatchObject({ objects: [{ type: 'mannequin' }], cameras: [{ aspectRatio: '16:9' }] })
    expect((await gateway.readDoc()).nodes.find((node) => node.id === 'scene-node')?.meta?.scene3dState).toBeTruthy()
  })

  // 病根回归：轮询到点旧版只 break，result 保持 queued 且不带 error —— 调用方（MCP/agent/CLI）
  // 拿到一个**永远非终态**的结果，等同「一直转圈但没人告诉你出了什么事」。到点必须落终态。
  it('generate：轮询超时必须落 failed + 诚实原因，不能静默返回 queued', async () => {
    const project = createNamedProject('轮询超时测试')
    const previous = process.env.NOMI_POLL_TIMEOUT_MS
    process.env.NOMI_POLL_TIMEOUT_MS = '1'
    try {
      let polls = 0
      const out = await generateOnProject(
        { projectId: project.id, intent: 'image', prompt: '一只猫', vendor: 'apimart', modelKey: 'seedream-4' },
        createDiskGateway(project.id),
        async () => ({ id: 'task-stuck', status: 'queued', assets: [] }),
        async () => {
          polls += 1
          return { result: { id: 'task-stuck', status: 'queued', assets: [] } }
        },
      )
      expect(polls).toBeGreaterThan(0)
      expect(out.status).toBe('failed')
    } finally {
      if (previous === undefined) delete process.env.NOMI_POLL_TIMEOUT_MS
      else process.env.NOMI_POLL_TIMEOUT_MS = previous
    }
  })

  it('未知项目抛清晰错误', async () => {
    await expect(readProjectCanvas(createDiskGateway('ghost-id'))).rejects.toThrow(/项目不存在/)
  })
})
