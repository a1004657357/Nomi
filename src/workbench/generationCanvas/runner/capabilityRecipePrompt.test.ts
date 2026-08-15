import { describe, expect, it } from 'vitest'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type { CapabilityRecipeTask } from './capabilityRecipeRunner'
import { compileCapabilityRecipePrompt } from './capabilityRecipePrompt'

function plan(overrides: Partial<RecipeRunPlan> = {}): RecipeRunPlan {
  return {
    id: 'run-1',
    recipeId: 'image.multiview.custom',
    recipeVersion: 1,
    outputKind: 'image_collection',
    sourceNodeIds: ['source-1'],
    resourceIds: [],
    model: {
      vendorKey: 'provider-a',
      modelKey: 'model-a',
      archetypeId: 'image-edit',
      modeId: 'edit',
      compatibilityTier: 'compatible',
    },
    params: {},
    outputCount: 1,
    taskCount: 1,
    outputs: [{ id: 'front', label: '正面', azimuth: 0, elevation: 0, shotSize: '中景' }],
    createdAt: 100,
    ...overrides,
  }
}

function task(recipePlan: RecipeRunPlan): CapabilityRecipeTask {
  return {
    id: `${recipePlan.id}:task-1`,
    itemIds: recipePlan.outputs.map((output) => output.id),
    outputs: recipePlan.outputs,
    plan: recipePlan,
  }
}

describe('compileCapabilityRecipePrompt', () => {
  it('defines an ordered 3x3 contact sheet and locks subject geometry across all views', () => {
    const recipePlan = plan({
      recipeId: 'image.multiview.grid9',
      params: {
        viewGenerationMode: 'contact_sheet',
        backgroundPolicy: 'preserve_scene',
      },
      outputCount: 9,
      outputs: [
        { id: 'front', label: '正面', azimuth: 0, elevation: 0 },
        { id: 'front-right', label: '右前侧', azimuth: 45, elevation: 0 },
        { id: 'right', label: '右侧', azimuth: 90, elevation: 0 },
        { id: 'rear-right', label: '右后侧', azimuth: 135, elevation: 0 },
        { id: 'rear', label: '背面', azimuth: 180, elevation: 0 },
        { id: 'rear-left', label: '左后侧', azimuth: -135, elevation: 0 },
        { id: 'left', label: '左侧', azimuth: -90, elevation: 0 },
        { id: 'front-left', label: '左前侧', azimuth: -45, elevation: 0 },
        { id: 'top', label: '俯视', azimuth: 0, elevation: 75 },
      ],
    })

    const prompt = compileCapabilityRecipePrompt('一位穿白衬衫的女性', recipePlan, task(recipePlan))

    expect(prompt).toContain('严格 3x3 九宫格')
    expect(prompt).toContain('从左到右、从上到下')
    expect(prompt).toContain('1. 正面：方位角 0°，仰俯角 0°')
    expect(prompt).toContain('9. 俯视：方位角 0°，仰俯角 75°')
    expect(prompt).toContain('身份、面部结构、身体比例、服装、道具和场景布局完全一致')
    expect(prompt).toContain('每格只改变相机机位')
    expect(prompt).toContain('保留来源图的真实场景')
    expect(prompt).toContain('不得替换成白色')
  })

  it('requests one complete camera frame per task in accurate grid9 mode', () => {
    const recipePlan = plan({
      recipeId: 'image.multiview.grid9',
      params: {
        viewGenerationMode: 'independent',
        backgroundPolicy: 'preserve_scene',
      },
      outputCount: 9,
      taskCount: 9,
      outputs: [
        { id: 'rear', label: '背面', azimuth: 180, elevation: 0 },
      ],
    })

    const prompt = compileCapabilityRecipePrompt('树荫下装满水果的陶盆', recipePlan, task(recipePlan))

    expect(prompt).toContain('只输出一张完整的单幅画面')
    expect(prompt).toContain('背面')
    expect(prompt).toContain('方位角 180°')
    expect(prompt).toContain('相机必须位于主体正后方')
    expect(prompt).toContain('正面特征不可见')
    expect(prompt).toContain('不得只靠裁切、平移、镜像或主体轻微转头伪装机位变化')
    expect(prompt).toContain('保留来源图的真实场景')
    expect(prompt).toContain('不得替换成白色、纯色、透明、影棚或商品转台背景')
    expect(prompt).not.toContain('严格 3x3 九宫格')
  })

  it.each([
    ['正面', 0, 0, '左右轮廓近似对称'],
    ['右前侧', 45, 0, '同时清楚看到主体正面与主体右侧面'],
    ['右侧', 90, 0, '正面宽度应压缩到接近消失'],
    ['右后侧', 135, 0, '以背面为主，同时看到主体右侧面'],
    ['背面', 180, 0, '正面特征不可见'],
    ['左后侧', -135, 0, '以背面为主，同时看到主体左侧面'],
    ['左侧', -90, 0, '正面宽度应压缩到接近消失'],
    ['左前侧', -45, 0, '同时清楚看到主体正面与主体左侧面'],
    ['俯视', 0, 75, '顶部表面占主要可见面积'],
  ])('adds an observable framing check for %s', (
    label,
    azimuth,
    elevation,
    expectedCue,
  ) => {
    const recipePlan = plan({
      recipeId: 'image.multiview.grid9',
      params: {
        viewGenerationMode: 'independent',
        backgroundPolicy: 'preserve_scene',
      },
      outputCount: 9,
      taskCount: 9,
      outputs: [{ id: label, label, azimuth, elevation }],
    })

    const prompt = compileCapabilityRecipePrompt('白色机器人', recipePlan, task(recipePlan))

    expect(prompt).toContain(expectedCue)
    expect(prompt).toContain('透视、遮挡和可见表面必须随相机位置明显变化')
    if (elevation === 0) {
      expect(prompt).toContain('相机光轴必须保持水平')
      expect(prompt).toContain('不得俯拍或仰拍')
    }
  })

  it('uses object-level visibility rules for an exact side profile', () => {
    const recipePlan = plan({
      recipeId: 'image.multiview.custom',
      outputs: [{
        id: 'right-profile',
        label: 'Right profile',
        azimuth: 90,
        elevation: 0,
        shotSize: '全景',
      }],
    })

    const prompt = compileCapabilityRecipePrompt('正面有发光装置的机器人', recipePlan, task(recipePlan))

    expect(prompt).toContain('strict 90-degree right-side profile')
    expect(prompt).toContain('只允许一只眼和单侧脸部轮廓清晰可见')
    expect(prompt).toContain('正面徽标、灯、屏幕或控制面必须转到画面边缘或被遮挡')
    expect(prompt).toContain('侧面结构成为画面主要可见面')
  })

  it('makes paired left and right profiles unambiguous in final-image coordinates', () => {
    const outputs = [
      { id: 'right-profile', label: 'Right profile', azimuth: 90, elevation: 0, shotSize: '近景' },
      { id: 'left-profile', label: 'Left profile', azimuth: -90, elevation: 0, shotSize: '近景' },
    ]
    const recipePlan = plan({ outputCount: 2, taskCount: 2, outputs })
    const rightPrompt = compileCapabilityRecipePrompt('正面人像', recipePlan, {
      id: 'run-1:task-1', itemIds: ['right-profile'], outputs: [outputs[0]], plan: recipePlan,
    })
    const leftPrompt = compileCapabilityRecipePrompt('正面人像', recipePlan, {
      id: 'run-1:task-2', itemIds: ['left-profile'], outputs: [outputs[1]], plan: recipePlan,
    })

    expect(rightPrompt).toContain('解剖学右脸和右耳')
    expect(rightPrompt).toContain('鼻尖必须指向成片画面的左边缘')
    expect(rightPrompt).toContain('绝对不得输出鼻尖朝画面右边缘的左侧面')
    expect(leftPrompt).toContain('解剖学左脸和左耳')
    expect(leftPrompt).toContain('鼻尖必须指向成片画面的右边缘')
    expect(leftPrompt).toContain('绝对不得输出鼻尖朝画面左边缘的右侧面')
    expect(rightPrompt).toContain('与「Left profile」互为 180° 对向机位')
    expect(leftPrompt).toContain('与「Right profile」互为 180° 对向机位')
  })

  it('locks identity, wardrobe, accessories, scene, and source aspect across custom views', () => {
    const recipePlan = plan({
      params: {
        backgroundPolicy: 'preserve_scene',
        sourceWidth: 480,
        sourceHeight: 320,
        sourceAspectRatio: 1.5,
        aspectRatio: '3:2',
      },
    })
    const prompt = compileCapabilityRecipePrompt('正面人像', recipePlan, task(recipePlan))

    expect(prompt).toContain('唯一的视觉事实')
    expect(prompt).toContain('眼镜、发箍、帽子、首饰或其他配饰绝对不得新增')
    expect(prompt).toContain('服装的颜色、面料、领型、图案')
    expect(prompt).toContain('来源图 480×320，比例 1.5')
    expect(prompt).toContain('保留来源图的真实场景')
    expect(prompt).toContain('不得替换成白色、纯色、透明、影棚或商品转台背景')
  })

  it('compiles a custom camera output into a distinct camera-only instruction', () => {
    const recipePlan = plan({
      outputs: [{ id: 'rear-low', label: '低机位背面', azimuth: 170, elevation: -20, shotSize: '全景' }],
    })

    const prompt = compileCapabilityRecipePrompt('咖啡馆里的人物', recipePlan, task(recipePlan))

    expect(prompt).toContain('方位角 170°')
    expect(prompt).toContain('仰俯角 -20°')
    expect(prompt).toContain('景别：全景')
    expect(prompt).toContain('只输出一张完整的单幅画面')
    expect(prompt).toContain('不得生成分屏、拼图、接触表、转台图或同时出现多个机位')
    expect(prompt).toContain('只改变相机位置、朝向与景别')
    expect(prompt).toContain('不得改变主体身份、造型、动作、物体关系或空间布局')
  })

  it('treats JiMeng Web 5.0 Lite four-image output as candidates for the same target', () => {
    const recipePlan = plan({
      model: {
        vendorKey: 'jimeng-web',
        modelKey: 'jimeng-web-image',
        archetypeId: 'jimeng-web-image',
        variantId: 'v5_0_lite',
        modeId: 'edit',
        compatibilityTier: 'native',
      },
      outputs: [{ id: 'rear', label: '背面', azimuth: 180, elevation: 0, shotSize: '中景' }],
    })

    const prompt = compileCapabilityRecipePrompt('咖啡馆里的人物', recipePlan, task(recipePlan))

    expect(prompt).toContain('图片 5.0 Lite')
    expect(prompt).toContain('返回 4 张独立候选')
    expect(prompt).toContain('四张候选都执行同一个目标机位')
    expect(prompt).toContain('不得把四张候选解释成四个机位')
    expect(prompt).toContain('每张候选本身都是一张完整单幅画面')
  })

  it('enforces an exact seamless equirectangular 2:1 panorama', () => {
    const recipePlan = plan({
      recipeId: 'scene.panorama.2to1',
      outputKind: 'panorama',
      params: { aspectRatio: '2:1' },
      outputs: [{ id: 'panorama', label: '360° 全景' }],
    })

    const prompt = compileCapabilityRecipePrompt('海边咖啡馆', recipePlan, task(recipePlan))

    expect(prompt).toContain('等距柱状投影')
    expect(prompt).toContain('精确 2:1')
    expect(prompt).toContain('左右边缘无缝衔接')
    expect(prompt).toContain('顶部与底部极点连续')
  })

  it('uses every portrait-refine control while protecting identity', () => {
    const recipePlan = plan({
      recipeId: 'portrait.refine',
      outputKind: 'image',
      params: {
        sceneBlend: '深度融合',
        lightingMatch: '氛围强化',
        skinTexture: '真实肌理',
        surfaceTexture: '颗粒质感',
        sharpness: '高清锐化',
        realismStrength: 75,
        identityLock: true,
      },
    })

    const prompt = compileCapabilityRecipePrompt('保持人物本人', recipePlan, task(recipePlan))

    expect(prompt).toContain('人物融合：深度融合')
    expect(prompt).toContain('光影匹配：氛围强化')
    expect(prompt).toContain('肤质：真实肌理')
    expect(prompt).toContain('表面纹理：颗粒质感')
    expect(prompt).toContain('清晰度：高清锐化')
    expect(prompt).toContain('真实化强度：75/100')
    expect(prompt).toContain('锁定人物身份')
    expect(prompt).toContain('不改变五官几何、脸型、年龄和可识别特征')
  })

  it('maps the 5x5 mood controls without changing facial geometry', () => {
    const recipePlan = plan({
      recipeId: 'portrait.mood',
      outputKind: 'image_collection',
      params: { energy: 1, affinity: 3, expressionStrength: 65, identityLock: true },
      outputs: [{
        id: 'mood-e4-a0',
        label: '能量 4 · 亲和 0',
        energy: 4,
        affinity: 0,
      }],
    })

    const prompt = compileCapabilityRecipePrompt('人物近景', recipePlan, task(recipePlan))

    expect(prompt).toContain('情绪能量 4/4：激动、高能量')
    expect(prompt).toContain('关系亲和度 0/4：亲近、开放')
    expect(prompt).toContain('表情强度 65/100')
    expect(prompt).toContain('只调整表情肌、眼神和轻微姿态')
    expect(prompt).toContain('不得改变五官几何或人物身份')
  })

  it.each([
    [0, 0, '克制的真笑', '嘴角轻微上扬', '脸颊轻微抬起'],
    [0, 4, '冷淡而克制', '嘴角保持水平', '眼睑略微收窄'],
    [2, 2, '中性基准表情', '眉毛对称放松', '双唇自然闭合'],
    [4, 0, '明显喜悦', '双侧嘴角明显上扬', '脸颊抬高'],
    [4, 4, '明显紧张或愤怒', '眉头向内下方收紧', '下颌肌肉紧张'],
  ])('compiles concrete facial-muscle acting for mood coordinate %s:%s', (
    energy,
    affinity,
    label,
    firstMuscleCue,
    secondMuscleCue,
  ) => {
    const recipePlan = plan({
      recipeId: 'portrait.mood',
      outputKind: 'image_collection',
      params: { expressionStrength: 70, identityLock: true },
      outputs: [{
        id: `mood-e${energy}-a${affinity}`,
        label: `能量 ${energy} · 亲和 ${affinity}`,
        energy,
        affinity,
      }],
    })

    const prompt = compileCapabilityRecipePrompt('人物正面近景', recipePlan, task(recipePlan))

    expect(prompt).toContain(label)
    expect(prompt).toContain(firstMuscleCue)
    expect(prompt).toContain(secondMuscleCue)
    expect(prompt).toContain('视线继续看向原来的目标')
    expect(prompt).toContain('不得用视线偏移、转头或改变机位来代替表情变化')
    expect(prompt).toContain('眉部、眼睑、脸颊、嘴部和下颌')
  })

  it.each([
    ['image.style.transfer', '保持主体身份、构图、空间关系和语义内容不变'],
    ['video.look.apply', '保持人物身份、镜头构图、动作逻辑和时间连续性'],
    ['video.effect.reference', '保持人物身份、镜头构图、动作逻辑和时间连续性'],
    ['video.edit.look', '严格保留源视频的镜头时长、剪辑点、相机运动'],
    ['video.edit.effect', '严格保留源视频的镜头时长、剪辑点、相机运动'],
  ])('preserves source structure for %s', (recipeId, expected) => {
    const recipePlan = plan({ recipeId, outputKind: recipeId.startsWith('video.') ? 'video' : 'image' })
    expect(compileCapabilityRecipePrompt('原始内容', recipePlan, task(recipePlan))).toContain(expected)
  })

  it('locks style transfer to the inspected source aspect ratio', () => {
    const recipePlan = plan({
      recipeId: 'image.style.transfer',
      outputKind: 'image',
      params: {
        aspectRatio: '9:16',
        sourceAspectRatio: 0.5625,
        sourceWidth: 900,
        sourceHeight: 1600,
      },
    })

    const prompt = compileCapabilityRecipePrompt('原始内容', recipePlan, task(recipePlan))

    expect(prompt).toContain('源图画幅 900×1600（精确比例 0.5625，模型档位 9:16）')
    expect(prompt).toContain('不得扩边、不得裁切、不得改变画布长宽比')
  })

  it('distinguishes image-driven generation from true video-to-video editing', () => {
    const imagePlan = plan({ recipeId: 'video.look.apply', outputKind: 'video' })
    const editPlan = plan({ recipeId: 'video.edit.look', outputKind: 'video' })

    expect(compileCapabilityRecipePrompt('原始内容', imagePlan, task(imagePlan))).toContain('以源图片作为首帧或视觉参考')
    expect(compileCapabilityRecipePrompt('原始内容', editPlan, task(editPlan))).toContain('对源视频执行视频转视频视觉改造')
    expect(compileCapabilityRecipePrompt('原始内容', editPlan, task(editPlan))).toContain('把源视频退化成静态首帧动画')
  })
})
