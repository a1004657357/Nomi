import { describe, expect, it } from 'vitest'
import {
  buildAnchorSheetPrompt,
  buildDetailedStoryboardShotVideoPrompt,
  parseStoryboardPlan,
  storyboardPlanToCreateNodesArgs,
  storyboardShotImagePrompt,
  storyboardShotVideoPrompt,
  type StoryboardPlan,
} from './storyboardPlan'

const PLAN: StoryboardPlan = {
  title: '雨夜追凶',
  anchors: [
    { id: 'a-linxia', kind: 'character', name: '林夏', description: '齐肩黑发，红色校服', carrier: 'visual' },
    { id: 'a-roof', kind: 'scene', name: '天台', description: '夜晚水泥护栏，城市霓虹', carrier: 'visual' },
    { id: 'a-bag', kind: 'prop', name: '红书包', description: '深红双肩，星星挂饰', carrier: 'visual' },
    { id: 'a-style', kind: 'style', name: '全片风格', description: '冷色调、胶片颗粒', carrier: 'text', scope: 'all' },
  ],
  shots: [
    { index: 1, durationSec: 5, anchorIds: ['a-linxia', 'a-roof', 'a-style'], prompt: '林夏倚护栏远望，镜头缓推' },
    { index: 2, durationSec: 8, anchorIds: ['a-linxia', 'a-bag'], prompt: '林夏背起书包向楼梯走，跟拍' },
  ],
}

describe('storyboardPlanToCreateNodesArgs', () => {
  it('视觉锚 → 卡片节点（clientId=anchor.id），文本锚不建节点', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN)
    const anchorNodes = nodes.filter((n) => n.clientId.startsWith('a-'))
    expect(anchorNodes.map((n) => [n.clientId, n.kind, n.title])).toEqual([
      ['a-linxia', 'character', '林夏'],
      ['a-roof', 'scene', '天台'],
      ['a-bag', 'image', '红书包'], // 道具无专用节点种类 → image（通用参考图），防 registry 查不到崩
    ]) // a-style(文本锚)不在
  })

  it('定妆卡提示词：角色含身份锁+多视图+变体行（变体来自 anchor.variants）', () => {
    const p = buildAnchorSheetPrompt({
      id: 'a', kind: 'character', name: '林夏', description: '齐肩黑发，红校服', carrier: 'visual', variants: ['成年', '童年'],
    })
    expect(p).toContain('角色定妆参考卡')
    expect(p).toContain('林夏')
    expect(p).toContain('齐肩黑发')
    expect(p).toContain('正面全身 A-Pose')
    expect(p).toContain('变体行：成年、童年')
  })

  it('场景卡提示词：含多角度（远景/近景/俯视），无变体则不出变体行', () => {
    const p = buildAnchorSheetPrompt({ id: 's', kind: 'scene', name: '天台', description: '夜晚霓虹', carrier: 'visual' })
    expect(p).toContain('场景参考卡')
    expect(p).toContain('远景 establishing')
    expect(p).not.toContain('变体行')
  })

  it('视觉锚落画布用定妆卡提示词 + 锁 GPT Image 2（defaultImageModelKey 注入）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN, { defaultImageModelKey: 'gpt-image-2', defaultImageModeId: 'default' })
    const linxia = nodes.find((n) => n.clientId === 'a-linxia')
    expect(linxia?.modelKey).toBe('gpt-image-2')
    expect(linxia?.prompt).toContain('角色定妆参考卡')
    // 文本锚（风格）仍不建节点
    expect(nodes.some((n) => n.clientId === 'a-style')).toBe(false)
  })

  it('整批落「分镜」分类（用户拍板 A：角色/场景/镜头落在一起，参考边同屏可连）', () => {
    expect(storyboardPlanToCreateNodesArgs(PLAN).groupCategoryId).toBe('shots')
  })

  it('anchorCount = 分镜组总控卡 + 视觉锚数（落画布布局据此分「参考行 / 镜头网格」）', () => {
    const { nodes, anchorCount } = storyboardPlanToCreateNodesArgs(PLAN)
    // PLAN：1 个分镜组总控卡 + 3 视觉锚（角色/场景/道具）+ 2 镜头；文本锚（风格）不建节点
    expect(anchorCount).toBe(4)
    expect(nodes[0]).toMatchObject({ clientId: 'storyboard-group', kind: 'text', storyboardGroup: true })
    expect(nodes[0].storyboardPlanSnapshot).toEqual(PLAN)
    // 前 anchorCount 个是分镜组/锚、其后是镜头（标题「镜头 N」）——布局角色边界的契约
    expect(nodes.slice(0, anchorCount).every((n) => !n.title.startsWith('镜头'))).toBe(true)
    expect(nodes.slice(anchorCount).every((n) => n.title.startsWith('镜头'))).toBe(true)
  })

  it('镜头乱序吐出 → 按 shot.index 排序后建节点（审计 A5：钉死数组序=镜序）', () => {
    const shuffled: StoryboardPlan = {
      ...PLAN,
      shots: [
        { index: 3, durationSec: 4, anchorIds: [], prompt: '镜三' },
        { index: 1, durationSec: 5, anchorIds: [], prompt: '镜一' },
        { index: 2, durationSec: 6, anchorIds: [], prompt: '镜二' },
      ],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(shuffled)
    const shotNodes = nodes.filter((n) => n.clientId.startsWith('shot-'))
    expect(shotNodes.map((n) => n.title)).toEqual(['镜头 1', '镜头 2', '镜头 3'])
  })

  it('镜头 → video 节点（用户拍板 B-clean），duration 写进 params，默认视频模型可注入', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN, {
      defaultImageModelKey: 'gpt-image-2',
      defaultVideoModelKey: 'seedance-2',
      defaultVideoModeId: 'i2v',
    })
    const shotNodes = nodes.filter((n) => n.clientId.startsWith('shot-'))
    expect(shotNodes).toHaveLength(2)
    // 镜头是视频节点；时长写进 duration 参数（落画布按所选模型控件钳值）。
    expect(shotNodes[0]).toMatchObject({ clientId: 'shot-1', kind: 'video', title: '镜头 1', modelKey: 'seedance-2', modeId: 'i2v' })
    expect(shotNodes[0].params).toEqual({ duration: 5 })
    expect(shotNodes[1]).toMatchObject({ clientId: 'shot-2', kind: 'video', modelKey: 'seedance-2', params: { duration: 8 } })
  })

  it('用户为某镜选了模型 → 用所选模型，且不套默认模型的 modeId（防张冠李戴，由下游按所选模型取默认模式）', () => {
    const plan: StoryboardPlan = {
      title: 't',
      anchors: [],
      shots: [
        { index: 1, durationSec: 5, anchorIds: [], prompt: '镜一', modelKey: 'kling-3', modeId: 'kling-i2v' }, // 用户选了模型+模式
        { index: 2, durationSec: 5, anchorIds: [], prompt: '镜二', modelKey: 'kling-3' }, // 选了模型没指定模式
        { index: 3, durationSec: 5, anchorIds: [], prompt: '镜三' }, // 没选 → 默认
      ],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(plan, { defaultVideoModelKey: 'seedance-2', defaultVideoModeId: 'seedance-i2v' })
    const shots = nodes.filter((n) => n.clientId.startsWith('shot-'))
    expect(shots[0]).toMatchObject({ modelKey: 'kling-3', modeId: 'kling-i2v' })
    expect(shots[1].modelKey).toBe('kling-3')
    expect(shots[1].modeId).toBeUndefined() // 选了别的模型却没指定模式 → 不套默认模型的 modeId
    expect(shots[2]).toMatchObject({ modelKey: 'seedance-2', modeId: 'seedance-i2v' }) // 没选 → 默认模型+默认模式
  })

  it('分镜方案中的型号 variantId 会随镜头节点落到 create_canvas_nodes', () => {
    const plan: StoryboardPlan = {
      title: '即梦型号',
      anchors: [],
      shots: [{
        index: 1,
        shotKind: 'image',
        durationSec: 0,
        anchorIds: [],
        prompt: '夏日街道',
        modelKey: 'jimeng-web-image',
        variantId: 'v5_0_lite',
        modeId: 't2i',
        params: { ratio: '9:16', resolution_type: '4K' },
      }],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(plan)
    const shot = nodes.find((node) => node.clientId === 'shot-1')

    expect(shot).toMatchObject({
      modelKey: 'jimeng-web-image',
      variantId: 'v5_0_lite',
      modeId: 't2i',
      params: { ratio: '9:16', resolution_type: '4K' },
    })
  })

  it('文本锚描述拼进引用它的镜头 prompt（不建边）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN)
    const shot1 = nodes.find((n) => n.clientId === 'shot-1')!
    expect(shot1.prompt).toContain('林夏倚护栏远望，镜头缓推')
    expect(shot1.prompt).toContain('全片风格：冷色调、胶片颗粒') // style 文本锚拼入
    const shot2 = nodes.find((n) => n.clientId === 'shot-2')!
    expect(shot2.prompt).toBe('林夏背起书包向楼梯走，跟拍') // 镜2 没引用 style → prompt 不变
  })

  it('镜头提示词优先使用 imagePrompt / videoPrompt，prompt 只做旧字段兜底', () => {
    const plan: StoryboardPlan = {
      title: '提示词双轨',
      anchors: [],
      shots: [
        { index: 1, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: '旧字段', imagePrompt: '静态关键帧' },
        { index: 2, shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '旧字段', imagePrompt: '首帧图', videoPrompt: '镜头缓慢推进' },
      ],
    }
    const { nodes } = storyboardPlanToCreateNodesArgs(plan)
    expect(nodes.find((n) => n.clientId === 'shot-1')?.prompt).toBe('静态关键帧')
    expect(nodes.find((n) => n.clientId === 'shot-2')?.prompt).toBe('镜头缓慢推进')
    expect(nodes.find((n) => n.clientId === 'storyboard-group')?.prompt).toContain('图片提示词：首帧图')
    expect(nodes.find((n) => n.clientId === 'storyboard-group')?.prompt).toContain('视频提示词：镜头缓慢推进')
  })

  it('imagePrompt / videoPrompt 为空字符串时，从结构化分镜列兜底生成提示词', () => {
    const shot = {
      index: 1,
      shotKind: 'video' as const,
      durationSec: 5,
      anchorIds: [],
      prompt: '',
      imagePrompt: '',
      videoPrompt: '',
      scene: '咖啡馆窗边',
      shotSize: '中近景',
      cameraAngle: '正面平视',
      cameraMove: '缓慢推进',
      characters: '咖啡师',
      performance: '端起咖啡闻香，微笑看向窗外',
      dialogue: '今天的第一杯，给自己。',
      props: '白瓷咖啡杯、木桌',
      sound: '轻柔爵士乐',
      notes: '手机背面朝向镜头时禁止写屏幕内容',
    }
    expect(storyboardShotImagePrompt(shot)).toContain('景别：中近景')
    expect(storyboardShotImagePrompt(shot)).toContain('表演：端起咖啡闻香，微笑看向窗外')
    expect(storyboardShotVideoPrompt(shot)).toContain('运镜：缓慢推进')
    expect(storyboardShotVideoPrompt(shot)).toContain('对白：今天的第一杯，给自己。')

    const { nodes } = storyboardPlanToCreateNodesArgs({ title: '结构化列', anchors: [], shots: [shot] })
    const shotNode = nodes.find((n) => n.clientId === 'shot-1')!
    expect(shotNode.prompt).toContain('运镜：缓慢推进')
    expect(shotNode.prompt).toContain('声音：轻柔爵士乐')
  })

  it('可把表格列作为关键词润色成十分具体的视频生成提示词', () => {
    const prompt = buildDetailedStoryboardShotVideoPrompt({
      index: 4,
      shotKind: 'image',
      durationSec: 6,
      anchorIds: [],
      prompt: '咖啡师把刚做好的拿铁推到顾客面前',
      imagePrompt: '暖色咖啡馆吧台，中近景，咖啡师双手推杯',
      modeId: 'omni',
      scene: '清晨咖啡馆吧台，窗外有柔和自然光',
      shotSize: '中近景',
      cameraAngle: '吧台正面平视',
      cameraMove: '缓慢推近后轻微下摇到咖啡杯',
      characters: '咖啡师、顾客的手部',
      performance: '咖啡师双手稳稳推杯，顾客手指轻轻接住杯碟',
      dialogue: '您的拿铁好了。',
      props: '白瓷拿铁杯、杯碟、木质吧台、拉花',
      sound: '轻柔爵士乐、咖啡机低频蒸汽声',
      notes: '商业广告质感，动作干净，杯子不能变形',
    })

    expect(prompt).toContain('全能参考视频导演提示词：镜头 4，时长 6 秒')
    expect(prompt).toContain('分镜图片只表达景别、机位、空间关系和动作意图，不作为首帧')
    expect(prompt).toContain('最强、最清楚的主体动作立即开始')
    expect(prompt).toContain('这是一段真实叙事视频，不是照片动效')
    expect(prompt).not.toContain('首帧基准：暖色咖啡馆吧台，中近景，咖啡师双手推杯')
    expect(prompt).toContain('表演动机：主体为「咖啡师、顾客的手部」')
    expect(prompt).toContain('动作时间线：0-0.9 秒')
    expect(prompt).toContain('运镜响应：缓慢推近后轻微下摇到咖啡杯')
    expect(prompt).toContain('道具物理：涉及「白瓷拿铁杯、杯碟、木质吧台、拉花」')
    expect(prompt).toContain('对白表演：角色说「您的拿铁好了。」')
    expect(prompt).toContain('连续性约束：锁定参考图中的脸型、服装、道具造型、场景参照物')
  })

  it('画外音不驱动人物口型，图生视频提示词不重复完整图片提示词', () => {
    const imagePrompt = '9:16竖屏，海军蓝围裙老板站在工作台前，左侧馅料盒见底，背景是未完成礼盒。'
    const prompt = buildDetailedStoryboardShotVideoPrompt({
      index: 2,
      shotKind: 'video',
      durationSec: 8,
      anchorIds: [],
      prompt: '团购做到一半突然缺料',
      imagePrompt,
      scene: '私房烘焙工作室',
      shotSize: '中近景',
      cameraAngle: '平视',
      cameraMove: '固定机位',
      characters: '海军蓝围裙老板',
      performance: '只完成一次压模，看到见底馅料盒后停住',
      dialogue: '画外音：做到一半馅料不够。',
      props: '月饼模具、见底馅料盒',
    })

    expect(prompt).not.toContain(imagePrompt)
    expect(prompt).toContain('声音与口型：画外音：做到一半馅料不够。')
    expect(prompt).toContain('这是后期声音，不驱动角色口型')
    expect(prompt).not.toContain('角色说「画外音')
  })

  it('没有图片参考时保留场景与构图建立信息', () => {
    const prompt = buildDetailedStoryboardShotVideoPrompt({
      index: 1,
      shotKind: 'video',
      durationSec: 5,
      anchorIds: [],
      prompt: '人物走进空旷仓库',
      scene: '清晨空旷仓库',
      shotSize: '全景',
      cameraAngle: '平视',
      performance: '人物沿安全线走到货架前停住',
    })

    expect(prompt).toContain('文生视频导演提示词：镜头 1，时长 5 秒')
    expect(prompt).toContain('视觉建立：地点为「清晨空旷仓库」；使用「全景，平视」')
    expect(prompt).not.toContain('首帧继承')
  })

  it('极短镜头的动作时间线仍保持正序', () => {
    const prompt = buildDetailedStoryboardShotVideoPrompt({
      index: 1,
      shotKind: 'video',
      durationSec: 1,
      anchorIds: [],
      prompt: '人物抬眼',
      imagePrompt: '人物低头的首帧',
      performance: '人物抬眼看向镜头外',
    })

    expect(prompt).toContain('动作时间线：0-0.2 秒')
    expect(prompt).toContain('0.2-0.8 秒')
    expect(prompt).toContain('0.8-1 秒')
  })

  it('涉及手机/电脑屏幕的镜头 prompt 自动附加屏幕朝向可见性规则', () => {
    const plan: StoryboardPlan = {
      title: '手机误朝向回归',
      anchors: [],
      shots: [
        {
          index: 1,
          shotKind: 'image',
          durationSec: 0,
          anchorIds: [],
          prompt: '正面中景拍摄林微，她低头看手机，手机背面朝向镜头，手机屏幕显示匿名消息。',
        },
      ],
    }

    const { nodes } = storyboardPlanToCreateNodesArgs(plan)
    const shot = nodes.find((n) => n.clientId === 'shot-1')!
    expect(shot.prompt).toContain('屏幕可见性硬规则')
    expect(shot.prompt).toContain('如果人物正面面对镜头，而手机/电脑背面或侧面朝向镜头，屏幕不可见')
    expect(shot.prompt).toContain('改成单独的屏幕特写/过肩镜头')
  })

  it('只有全片风格提到屏幕冷光时，不给无设备镜头追加屏幕规则', () => {
    const plan: StoryboardPlan = {
      title: '屏幕风格词不误触发',
      anchors: [
        {
          id: 'style',
          kind: 'style',
          name: '全片风格',
          description: '城市夜景霓虹光感与屏幕冷光对比室内暖黄灯光。',
          carrier: 'text',
        },
      ],
      shots: [
        {
          index: 1,
          shotKind: 'image',
          durationSec: 0,
          anchorIds: ['style'],
          prompt: '清晨画室全景，两个人坐在地上看画，阳光从窗户照入。',
        },
      ],
    }

    const { nodes } = storyboardPlanToCreateNodesArgs(plan)
    const shot = nodes.find((n) => n.clientId === 'shot-1')!
    expect(shot.prompt).toContain('全片风格：城市夜景霓虹光感与屏幕冷光对比室内暖黄灯光。')
    expect(shot.prompt).not.toContain('屏幕可见性硬规则')
  })

  it('否定句里的手机/屏幕词不触发屏幕朝向规则', () => {
    const plan: StoryboardPlan = {
      title: '无设备镜头',
      anchors: [],
      shots: [
        {
          index: 1,
          shotKind: 'image',
          durationSec: 0,
          anchorIds: [],
          prompt: '门打开，两人面对面，没有手机、没有屏幕，只有走廊冷光与画室暖光。',
        },
      ],
    }

    const { nodes } = storyboardPlanToCreateNodesArgs(plan)
    const shot = nodes.find((n) => n.clientId === 'shot-1')!
    expect(shot.prompt).not.toContain('屏幕可见性硬规则')
  })

  it('定妆卡 → 镜头参考边（角色 character_ref / 场景 style_ref / 道具 reference）；B-clean 不连 shot→shot 链', () => {
    const { edges } = storyboardPlanToCreateNodesArgs(PLAN)
    expect(edges).toEqual([
      { sourceClientId: 'a-linxia', targetClientId: 'shot-1', mode: 'character_ref' },
      { sourceClientId: 'a-roof', targetClientId: 'shot-1', mode: 'style_ref' },
      // a-style 是文本锚 → 不连边（拼进 prompt 了）
      { sourceClientId: 'a-linxia', targetClientId: 'shot-2', mode: 'character_ref' },
      { sourceClientId: 'a-bag', targetClientId: 'shot-2', mode: 'reference' },
      // B-clean：不再连 shot→shot 时序链（视频→视频会落到未实现的首帧接力；连贯靠共享定妆卡参考）
    ])
  })

  it('引用了不存在的锚 id → 忽略，不崩不连', () => {
    const plan: StoryboardPlan = {
      title: 't',
      anchors: [{ id: 'a1', kind: 'character', name: 'A', description: 'd', carrier: 'visual' }],
      shots: [{ index: 1, durationSec: 5, anchorIds: ['a1', 'ghost'], prompt: 'p' }],
    }
    const { edges } = storyboardPlanToCreateNodesArgs(plan)
    expect(edges).toEqual([{ sourceClientId: 'a1', targetClientId: 'shot-1', mode: 'character_ref' }])
  })

  it('产出的节点种类都是画布支持的（结构保证：防 prop/style 等非节点种类漏进去崩 defaultSize）', () => {
    // 画布 registry 支持的种类（src/workbench/generationCanvas/nodes/registry.ts）。
    const VALID_NODE_KINDS = new Set(['text', 'character', 'scene', 'image', 'keyframe', 'video', 'shot', 'output', 'panorama', 'scene3d'])
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN)
    for (const node of nodes) expect(VALID_NODE_KINDS.has(node.kind)).toBe(true)
  })

  it('summary 取 title，空 title 兜底', () => {
    expect(storyboardPlanToCreateNodesArgs(PLAN).summary).toBe('雨夜追凶')
    expect(storyboardPlanToCreateNodesArgs({ title: '  ', anchors: [], shots: [] }).summary).toBe('分镜方案')
  })
})

describe('parseStoryboardPlan（落库前运行时守卫）', () => {
  it('合法方案对象原样解析', () => {
    expect(parseStoryboardPlan(PLAN)).toEqual(PLAN)
  })

  it('锚类型非法 → throw（畸形对象不入 store）', () => {
    const bad = { ...PLAN, anchors: [{ ...PLAN.anchors[0], kind: 'monster' }] }
    expect(() => parseStoryboardPlan(bad)).toThrow()
  })

  it('缺必填字段（镜头无 prompt）→ throw', () => {
    const bad = { title: 't', anchors: [], shots: [{ index: 1, durationSec: 5, anchorIds: [] }] }
    expect(() => parseStoryboardPlan(bad)).toThrow()
  })
})

describe('图片分镜（shotKind=image，用户拍板 2026-07-02 image-first）', () => {
  const IMAGE_PLAN: StoryboardPlan = {
    title: '小说配图',
    anchors: [
      { id: 'a-ye', kind: 'character', name: '叶林', description: '十七岁少年，苍白清秀', carrier: 'visual' },
      { id: 'a-market', kind: 'scene', name: '地下黑市', description: '潮湿地下通道，霓虹冷光', carrier: 'visual' },
    ],
    shots: [
      { index: 1, shotKind: 'image', durationSec: 0, anchorIds: ['a-ye', 'a-market'], prompt: '叶林站在黑市入口，远景三分构图' },
      { index: 2, shotKind: 'video', durationSec: 6, anchorIds: ['a-ye'], prompt: '手持跟拍叶林走进手术室' },
    ],
  }

  it('图片镜头 → image 节点、无 duration、绑默认图片模型；视频镜头不受影响', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(IMAGE_PLAN, {
      defaultImageModelKey: 'img-model',
      defaultImageModeId: 'img-mode',
      defaultVideoModelKey: 'vid-model',
      defaultVideoModeId: 'vid-mode',
    })
    const shot1 = nodes.find((n) => n.clientId === 'shot-1')!
    expect(shot1.kind).toBe('image')
    expect(shot1.modelKey).toBe('img-model')
    expect(shot1.modeId).toBe('img-mode')
    expect(shot1.params?.duration).toBeUndefined()
    const shot2 = nodes.find((n) => n.clientId === 'shot-2')!
    expect(shot2.kind).toBe('video')
    expect(shot2.modelKey).toBe('vid-model')
    expect(shot2.params?.duration).toBe(6)
  })

  it('图片镜头仍连定妆卡参考边（锁身份），与视频镜头同语义', () => {
    const { edges } = storyboardPlanToCreateNodesArgs(IMAGE_PLAN)
    expect(edges).toContainEqual({ sourceClientId: 'a-ye', targetClientId: 'shot-1', mode: 'character_ref' })
    expect(edges).toContainEqual({ sourceClientId: 'a-market', targetClientId: 'shot-1', mode: 'style_ref' })
  })

  it('缺省 shotKind → 按 video 兜底（旧草稿兼容，行为不变）', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN, { defaultVideoModelKey: 'vid-model' })
    for (const n of nodes.filter((node) => node.clientId.startsWith('shot-'))) {
      expect(n.kind).toBe('video')
    }
  })

  it('parseStoryboardPlan 接受带 shotKind 的方案（schema 同步）', () => {
    expect(() => parseStoryboardPlan(IMAGE_PLAN)).not.toThrow()
  })
})

describe('参考卡身份标记（referenceSheet，防占镜号）', () => {
  it('所有视觉锚节点带 referenceSheet:true；镜头节点不带', () => {
    const { nodes } = storyboardPlanToCreateNodesArgs(PLAN)
    for (const n of nodes.filter((node) => node.clientId.startsWith('a-'))) {
      expect(n.referenceSheet).toBe(true)
    }
    for (const n of nodes.filter((node) => node.clientId.startsWith('shot-'))) {
      expect(n.referenceSheet).toBeUndefined()
    }
  })
})
