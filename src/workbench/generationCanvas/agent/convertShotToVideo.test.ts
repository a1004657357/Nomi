import { beforeEach, describe, expect, it } from 'vitest'
import { convertImageShotToVideo, convertImageShotsToVideos } from './convertShotToVideo'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { isShotNumberedNode } from '../model/shotNumbering'
import { resolveShotIdentities } from '../model/shotNumbering'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
})

function seedImageShot() {
  const store = useGenerationCanvasStore.getState()
  const node = store.addNode({ kind: 'image', title: '镜头 3', prompt: '静态画面', categoryId: 'shots' })
  // 模拟真实场景：这是第 3 号镜头（前面还有别的镜头占了 1/2）。
  useGenerationCanvasStore.getState().updateNode(node.id, {
    shotIndex: 3,
    result: { id: 'r1', type: 'image', url: 'nomi-local://fake.png', createdAt: 1 },
  })
  return useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)!
}

describe('convertImageShotToVideo（image-first 桥）', () => {
  it('建派生视频节点：继承镜号 + 全能参考构图边 + sourceNodeId 指回源图', () => {
    const image = seedImageShot()
    const { nodeId, existed } = convertImageShotToVideo(image)
    expect(existed).toBe(false)
    const state = useGenerationCanvasStore.getState()
    const video = state.nodes.find((n) => n.id === nodeId)!
    expect(video.kind).toBe('video')
    expect(video.shotIndex).toBe(3) // 继承源图镜号（同镜两阶段，排片落剧本位置）
    expect(state.nodes.find(node => node.id === image.id)?.shotIndex).toBeUndefined()
    expect(resolveShotIdentities(state.nodes, state.edges).get(image.id)).toMatchObject({ shotIndex: 3, shotOwnerNodeIds: [video.id] })
    expect(video.meta?.sourceNodeId).toBe(image.id) // 整理布局紧跟源镜头
    expect(video.meta?.storyboardVideoReferenceStrategy).toBe('full_reference')
    expect(video.meta?.storyboardVideoPromptSource).toBe('compiled_image_fallback')
    expect(video.meta?.videoPromptNeedsReview).toBe(true)
    expect(video.prompt).not.toBe(image.prompt)
    expect(video.prompt).toContain('不是静态图片的运动化')
    expect(video.prompt).toContain('明确动作链')
    expect(video.title).toBe('镜头 3 · 视频')
    expect(state.edges.some((e) => e.source === image.id && e.target === nodeId && e.mode === 'composition_ref')).toBe(true)
  })

  it('分镜表所属图片转视频时使用结构化 videoPrompt，不复用图片 prompt', () => {
    const store = useGenerationCanvasStore.getState()
    const table = store.addNode({
      kind: 'text',
      title: '分镜脚本',
      meta: {
        storyboardGroup: true,
        storyboardPlanSnapshot: {
          title: '广告',
          anchors: [],
          shots: [{
            index: 3,
            shotKind: 'video',
            durationSec: 6,
            anchorIds: [],
            prompt: '静态中景构图',
            imagePrompt: '老板站在货架前的静态中景',
            scene: '月饼工作室',
            cameraMove: '跟随横移',
            characters: '老板',
            performance: '老板走到空货架前停下并确认缺货',
          }],
        },
      },
    })
    const image = seedImageShot()
    useGenerationCanvasStore.getState().updateNode(image.id, {
      meta: {
        storyboardContainedByNodeId: table.id,
        storyboardContainedRowIndex: 3,
        storyboardContainedRole: 'image',
      },
    })

    const result = convertImageShotToVideo(
      useGenerationCanvasStore.getState().nodes.find((node) => node.id === image.id)!,
    )
    const video = useGenerationCanvasStore.getState().nodes.find((node) => node.id === result.nodeId)!
    expect(video.meta?.storyboardVideoPromptSource).toBe('storyboard_plan')
    expect(video.meta?.videoPromptNeedsReview).toBeUndefined()
    expect(video.prompt).toContain('图生视频导演提示词：镜头 3')
    expect(video.prompt).toContain('老板走到空货架前停下并确认缺货')
    expect(video.prompt).not.toBe(image.prompt)
  })

  it('幂等：已转过 → 返回已有视频节点，不重复建', () => {
    const image = seedImageShot()
    const first = convertImageShotToVideo(image)
    const again = convertImageShotToVideo(
      useGenerationCanvasStore.getState().nodes.find((n) => n.id === image.id)!,
    )
    expect(again.existed).toBe(true)
    expect(again.nodeId).toBe(first.nodeId)
    const videos = useGenerationCanvasStore.getState().nodes.filter((n) => n.kind === 'video')
    expect(videos).toHaveLength(1)
  })

  it('普通 reference 边不是已转换标记，仍创建带 composition_ref 的视频节点', () => {
    const image = seedImageShot()
    const unrelatedVideo = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: '参考目标' })
    useGenerationCanvasStore.getState().connectNodes(image.id, unrelatedVideo.id, 'reference')

    const result = convertImageShotToVideo(image)
    const state = useGenerationCanvasStore.getState()
    expect(result.existed).toBe(false)
    expect(result.nodeId).not.toBe(unrelatedVideo.id)
    expect(state.edges).toContainEqual(expect.objectContaining({
      source: image.id,
      target: result.nodeId,
      mode: 'composition_ref',
    }))
  })

  it('把角色、场景和道具参考直接复制到全能参考视频节点', () => {
    const image = seedImageShot()
    const state = useGenerationCanvasStore.getState()
    const character = state.addNode({ kind: 'character', title: '老板角色卡' })
    const scene = useGenerationCanvasStore.getState().addNode({ kind: 'scene', title: '烘焙工作室' })
    const prop = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: '月饼道具卡' })
    useGenerationCanvasStore.getState().connectNodes(character.id, image.id, 'character_ref')
    useGenerationCanvasStore.getState().connectNodes(scene.id, image.id, 'style_ref')
    useGenerationCanvasStore.getState().connectNodes(prop.id, image.id, 'reference')

    const result = convertImageShotToVideo(
      useGenerationCanvasStore.getState().nodes.find((node) => node.id === image.id)!,
    )
    const incoming = useGenerationCanvasStore.getState().edges
      .filter((edge) => edge.target === result.nodeId)
      .map((edge) => ({ source: edge.source, mode: edge.mode }))

    expect(incoming).toEqual([
      { source: character.id, mode: 'character_ref' },
      { source: scene.id, mode: 'style_ref' },
      { source: prop.id, mode: 'reference' },
      { source: image.id, mode: 'composition_ref' },
    ])
  })

  it('批量转视频：跳过非镜头节点，复用已有视频，并选中新视频集合', () => {
    const imageA = seedImageShot()
    const imageB = seedImageShot()
    useGenerationCanvasStore.getState().updateNode(imageB.id, { shotIndex: 4, title: '镜头 4' })
    const reference = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: '参考卡', meta: { referenceSheet: true } })
    useGenerationCanvasStore.getState().updateNode(reference.id, { shotIndex: 99 })
    const first = convertImageShotToVideo(imageA)

    const result = convertImageShotsToVideos([
      useGenerationCanvasStore.getState().nodes.find((n) => n.id === imageA.id)!,
      useGenerationCanvasStore.getState().nodes.find((n) => n.id === imageB.id)!,
      useGenerationCanvasStore.getState().nodes.find((n) => n.id === reference.id)!,
    ])

    expect(result).toMatchObject({ created: 1, existing: 1, skipped: 1 })
    expect(result.nodeIds).toHaveLength(2)
    expect(result.nodeIds).toContain(first.nodeId)
    const videos = useGenerationCanvasStore.getState().nodes.filter((n) => n.kind === 'video')
    expect(videos).toHaveLength(2)
    expect([...useGenerationCanvasStore.getState().selectedNodeIds].sort()).toEqual([...result.nodeIds].sort())
  })
})

describe('参考卡不占镜号（meta.referenceSheet，R13 走查抓出的编号错位）', () => {
  it('meta.referenceSheet=true 的 image 节点在 shots 分类不参与编号', () => {
    expect(isShotNumberedNode({ kind: 'image', categoryId: 'shots', meta: { referenceSheet: true } })).toBe(false)
    expect(isShotNumberedNode({ kind: 'image', categoryId: 'shots' })).toBe(true)
    expect(isShotNumberedNode({ kind: 'image', categoryId: 'shots', meta: {} })).toBe(true)
  })

  it('addNode 带 referenceSheet meta → 不分配 shotIndex；镜头节点照常从 1 编起', () => {
    const store = useGenerationCanvasStore.getState()
    const propCard = store.addNode({ kind: 'image', title: '道具卡', categoryId: 'shots', meta: { referenceSheet: true } })
    const shot1 = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: '镜头 1', categoryId: 'shots' })
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.find((n) => n.id === propCard.id)?.shotIndex).toBeUndefined()
    expect(state.nodes.find((n) => n.id === shot1.id)?.shotIndex).toBe(1) // 道具卡没吃掉 1 号
  })
})
