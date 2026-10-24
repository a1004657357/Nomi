import { generationPromptSource } from '../../../../electron/shared/generationPromptText'
import type { RecipeRunPlan } from '../../../config/capabilityRecipes'
import type { CapabilityRecipeTask } from './capabilityRecipeRunner'

function param(plan: RecipeRunPlan, key: string, fallback: string | number | boolean): string | number | boolean {
  return plan.params[key] ?? fallback
}

function identityLockInstruction(plan: RecipeRunPlan): string {
  return param(plan, 'identityLock', true) === false
    ? generationPromptSource.identitySoft()
    : generationPromptSource.identityLocked()
}

function multiviewBackgroundInstructions(plan: RecipeRunPlan): string[] {
  if (param(plan, 'backgroundPolicy', 'preserve_scene') === 'neutral_turntable') {
    return [
      '背景策略：使用统一的中性转台背景和一致的柔和影棚光，不出现原场景元素。',
      '九个机位的背景颜色、地面接触阴影、曝光和主体尺度必须一致。',
    ]
  }
  return [
    '背景策略：保留来源图的真实场景、地面、前景、后景、光线方向和物体空间关系。',
    '新机位中场景透视与遮挡应随相机位置合理变化，但场景内容不得被删除、简化或重设计。',
    '不得替换成白色、纯色、透明、影棚或商品转台背景。',
  ]
}

function multiviewContinuityInstructions(plan: RecipeRunPlan): string[] {
  const sourceWidth = Number(plan.params.sourceWidth)
  const sourceHeight = Number(plan.params.sourceHeight)
  const sourceAspectRatio = Number(plan.params.sourceAspectRatio)
  const aspectInstruction = Number.isFinite(sourceWidth)
    && Number.isFinite(sourceHeight)
    && Number.isFinite(sourceAspectRatio)
    && sourceWidth > 0
    && sourceHeight > 0
    && sourceAspectRatio > 0
    ? `画幅锚点：来源图 ${Math.round(sourceWidth)}×${Math.round(sourceHeight)}，比例 ${sourceAspectRatio}；所有独立机位必须使用同一画幅比例。`
    : '画幅锚点：所有独立机位必须使用与来源图相同的画幅比例和一致的主体尺度。'
  return [
    '将来源图视为本批次唯一的视觉事实，只允许改变相机机位；所有独立任务必须复用同一组身份、造型、服装、道具和场景锚点。',
    '人物连续性：锁定脸型、五官比例、年龄、肤色、发际线、发型和发色；来源图没有的眼镜、发箍、帽子、首饰或其他配饰绝对不得新增。',
    '造型连续性：服装的颜色、面料、领型、图案和可见配饰必须与来源图一致；物体的颜色、材质、标记和磨损细节必须一致，不得重新设计。',
    '遮挡区域只做保守补全：无法从来源图确认的细节保持朴素并与已见区域连续，不得借机更换服装、增加道具或设计新的背景元素。',
    aspectInstruction,
  ]
}

const ENERGY_LABELS = ['平静、低能量', '放松、轻微能量', '中性、稳定能量', '活跃、明显能量', '激动、高能量'] as const

const AFFINITY_LABELS = ['亲近、开放', '友好、易接近', '中性、克制', '疏离、防备', '冷淡、封闭'] as const

function scaleIndex(value: string | number | boolean): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(4, Math.round(numeric))) : 2
}

const MOOD_PERFORMANCE_ANCHORS: Record<string, string[]> = {
  '0:0': [
    '表演锚点：克制的真笑。',
    '嘴角轻微上扬，脸颊轻微抬起，眼轮匝肌有细微收缩，眉毛与下颌保持放松。',
  ],
  '0:4': [
    '表演锚点：冷淡而克制。',
    '嘴角保持水平，双唇轻闭，眼睑略微收窄，脸颊放松，眉毛和下颌不做夸张动作。',
  ],
  '2:2': [
    '表演锚点：中性基准表情。',
    '眉毛对称放松，眼睑自然打开，脸颊静止，双唇自然闭合，下颌放松。',
  ],
  '4:0': [
    '表演锚点：明显喜悦。',
    '双侧嘴角明显上扬，脸颊抬高，眼轮匝肌收缩形成真实笑意，眉毛略微抬起，下颌自然放松。',
  ],
  '4:4': [
    '表演锚点：明显紧张或愤怒。',
    '眉头向内下方收紧，眼睑收窄并保持聚焦，脸颊绷紧，双唇紧闭，下颌肌肉紧张。',
  ],
}

function moodPerformanceInstructions(energy: number, affinity: number): string[] {
  const anchor = MOOD_PERFORMANCE_ANCHORS[`${energy}:${affinity}`]
  const energyCue = energy <= 1
    ? '动作幅度克制，面部肌肉变化细微但可见。'
    : energy === 2
      ? '动作幅度适中，不夸张。'
      : '动作幅度清楚可见，但保持真实的人脸解剖和左右协调。'
  const affinityCue = affinity <= 1
    ? '亲和方向由嘴角上扬、脸颊抬起和放松眉眼共同表达。'
    : affinity >= 3
      ? '疏离方向由嘴角收平或压紧、眼睑收窄和眉间张力共同表达。'
      : '保持情绪中性，不偏向明显微笑或敌意。'
  return [
    ...(anchor ?? [
      '表演锚点：按当前能量与亲和坐标执行连续、可辨认的面部表演。',
      energyCue,
      affinityCue,
    ]),
    '表情驱动必须同时涉及眉部、眼睑、脸颊、嘴部和下颌中的至少三个区域。',
    '视线继续看向原来的目标，保持原来的头部朝向、相机位置、景别、构图和光线。',
    '不得用视线偏移、转头或改变机位来代替表情变化。',
  ]
}

function providerCandidateInstructions(plan: RecipeRunPlan): string[] {
  if (
    plan.model.vendorKey !== 'jimeng-web'
    || plan.model.modelKey !== 'jimeng-web-image'
    || plan.model.variantId !== 'v5_0_lite'
  ) {
    return []
  }
  return [
    '供应商执行约束：使用即梦 Web 图片 5.0 Lite，网页会返回 4 张独立候选。',
    '四张候选都执行同一个目标机位和同一组创作约束；不得把四张候选解释成四个机位、四个步骤或一张四宫格。',
    '每张候选本身都是一张完整单幅画面，并独立完整满足当前配方要求；候选之间只允许存在合理的细节差异。',
  ]
}

function normalizedAzimuth(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  return ((((value as number) + 180) % 360) + 360) % 360 - 180
}

function cameraViewVerificationInstructions(
  output: CapabilityRecipeTask['outputs'][number] | undefined,
): string[] {
  const azimuth = normalizedAzimuth(output?.azimuth)
  const elevation = Number(output?.elevation) || 0
  let observableCue: string

  if (elevation >= 60) {
    observableCue =
      '视图类型：strict overhead top view。相机必须位于主体上方并向下俯拍，顶部表面占主要可见面积，竖直表面明显透视缩短；不得使用平视或轻微高机位冒充俯视。'
  } else if (Math.abs(azimuth) <= 22.5) {
    observableCue =
      '视图类型：strict eye-level front elevation, not three-quarter view。相机必须位于主体正前方，正面中心轴对准画面中心，左右轮廓近似对称，两侧可见面积接近；不得沿用来源图的三分之四侧面。'
  } else if (azimuth > 22.5 && azimuth < 67.5) {
    observableCue =
      '视图类型：strict 45-degree front-right three-quarter view。相机必须移动到主体右前方，同时清楚看到主体正面与主体右侧面，右侧面形成明确透视；不得退化为正面或来源图原机位。'
  } else if (azimuth >= 67.5 && azimuth <= 112.5) {
    observableCue =
      '视图类型：strict 90-degree right-side profile, exact side elevation, not three-quarter view。相机必须位于主体正右侧，以右侧轮廓为主，正面宽度应压缩到接近消失，主体左侧面不可见；人物或动物必须显示解剖学右脸和右耳，鼻尖必须指向成片画面的左边缘，左脸和左耳位于远侧并被遮挡，只允许一只眼和单侧脸部轮廓清晰可见；绝对不得输出鼻尖朝画面右边缘的左侧面。物体的正面徽标、灯、屏幕或控制面必须转到画面边缘或被遮挡，侧面结构成为画面主要可见面。'
  } else if (azimuth > 112.5 && azimuth < 157.5) {
    observableCue =
      '视图类型：strict rear-right three-quarter view。相机必须移动到主体右后方，以背面为主，同时看到主体右侧面；面孔、眼睛和物体正面徽标、灯、屏幕或控制面不得完整出现；不得沿用来源图原机位。'
  } else if (azimuth < -22.5 && azimuth > -67.5) {
    observableCue =
      '视图类型：strict 45-degree front-left three-quarter view。相机必须移动到主体左前方，同时清楚看到主体正面与主体左侧面，左侧面形成明确透视；不得退化为正面或来源图原机位。'
  } else if (azimuth <= -67.5 && azimuth >= -112.5) {
    observableCue =
      '视图类型：strict 90-degree left-side profile, exact side elevation, not three-quarter view。相机必须位于主体正左侧，以左侧轮廓为主，正面宽度应压缩到接近消失，主体右侧面不可见；人物或动物必须显示解剖学左脸和左耳，鼻尖必须指向成片画面的右边缘，右脸和右耳位于远侧并被遮挡，只允许一只眼和单侧脸部轮廓清晰可见；绝对不得输出鼻尖朝画面左边缘的右侧面。物体的正面徽标、灯、屏幕或控制面必须转到画面边缘或被遮挡，侧面结构成为画面主要可见面。'
  } else if (azimuth < -112.5 && azimuth > -157.5) {
    observableCue =
      '视图类型：strict rear-left three-quarter view。相机必须移动到主体左后方，以背面为主，同时看到主体左侧面；面孔、眼睛和物体正面徽标、灯、屏幕或控制面不得完整出现；不得沿用来源图原机位。'
  } else {
    observableCue =
      '视图类型：strict rear elevation, exact 180-degree back view。相机必须位于主体正后方，背面中心轴对准画面中心，背部和后侧结构正对镜头，正面特征不可见；面孔、眼睛和物体正面徽标、灯、屏幕或控制面必须完全不可见。'
  }

  return [
    `机位验收判据：${observableCue}`,
    ...(Math.abs(elevation) <= 10
      ? [
          '仰俯角 0° 验收：相机光轴必须保持水平并对准主体视觉中心，顶部或底部表面不得占主要面积；不得俯拍或仰拍。',
        ]
      : []),
    '不得只靠裁切、平移、镜像或主体轻微转头伪装机位变化；相机必须真实绕主体移动，透视、遮挡和可见表面必须随相机位置明显变化。',
  ]
}

function oppositeCameraInstruction(
  plan: RecipeRunPlan,
  output: CapabilityRecipeTask['outputs'][number] | undefined,
): string[] {
  if (!output || typeof output.azimuth !== 'number') return []
  const azimuth = normalizedAzimuth(output.azimuth)
  const opposite = plan.outputs.find((candidate) => {
    if (candidate.id === output.id || typeof candidate.azimuth !== 'number') return false
    return Math.abs(Math.abs(normalizedAzimuth(candidate.azimuth) - azimuth) - 180) <= 1
  })
  if (!opposite) return []
  return [
    `批次对向机位约束：本机位与「${opposite.label}」互为 180° 对向机位，两张成片必须呈现相反的可见侧面和鼻尖方向；不得复用同一朝向，不得只靠背景、裁切或构图变化区分。`,
  ]
}

function compileRecipeInstructions(plan: RecipeRunPlan, task: CapabilityRecipeTask): string[] {
  const output = task.outputs[0]

  switch (plan.recipeId) {
    case 'image.multiview.grid9':
      if (task.outputs.length === 1 && plan.taskCount > 1) {
        return [
          `目标机位：${output?.label || '指定机位'}，方位角 ${output?.azimuth ?? 0}°，仰俯角 ${output?.elevation ?? 0}°。`,
          '以来源图中的主要主体为环绕中心，正方位角表示从俯视方向观察时相机顺时针绕主体移动。',
          ...cameraViewVerificationInstructions(output),
          '只输出一张完整的单幅画面，只表现上述唯一机位；不得生成分屏、拼图、接触表、转台图或多个机位。',
          '只改变相机位置和朝向；主体身份、姿态、物体形状、材质及所有物体之间的关系保持不变。',
          '补全新机位可见区域时遵守来源图几何、材质、光照和透视，不新增或删减叙事元素。',
          ...multiviewContinuityInstructions(plan),
          ...multiviewBackgroundInstructions(plan),
        ]
      }
      return [
        '输出一张严格 3x3 九宫格接触表，九个格子尺寸完全相同，格子之间边界清楚。',
        '机位按从左到右、从上到下的顺序排列：',
        ...task.outputs.map(
          (view, index) =>
            `${index + 1}. ${view.label}：方位角 ${view.azimuth ?? 0}°，仰俯角 ${view.elevation ?? 0}°${view.shotSize ? `，景别 ${view.shotSize}` : ''}`,
        ),
        '九格中的主体身份、面部结构、身体比例、服装、道具和场景布局完全一致。',
        '每格只改变相机机位，不得改变主体姿态、物体形状、材质或物体之间的关系。',
        ...multiviewContinuityInstructions(plan),
        ...multiviewBackgroundInstructions(plan),
      ]
    case 'image.multiview.custom':
      return [
        `目标机位：${output?.label || '自定义机位'}，方位角 ${output?.azimuth ?? param(plan, 'azimuth', 0)}°，仰俯角 ${output?.elevation ?? param(plan, 'elevation', 0)}°。`,
        `景别：${output?.shotSize || param(plan, 'shotSize', '中景')}。`,
        ...cameraViewVerificationInstructions(output),
        ...oppositeCameraInstruction(plan, output),
        '只输出一张完整的单幅画面，只表现上述唯一机位；不得生成分屏、拼图、接触表、转台图或同时出现多个机位。',
        '只改变相机位置、朝向与景别；不得改变主体身份、造型、动作、物体关系或空间布局。',
        '补全新机位可见区域时遵守原图几何、材质、光照方向和透视关系，不凭空新增叙事元素。',
        ...multiviewContinuityInstructions(plan),
        ...multiviewBackgroundInstructions(plan),
      ]
    case 'image.multiview.reconstruct3d':
      return [
        '根据参考图重建可环绕查看的三维对象，保持主体轮廓、比例、材质、颜色和可识别细节。',
        '补全被遮挡区域时遵守物体结构和对称关系，不改变主体身份或用途。',
      ]
    case 'scene.panorama.2to1':
      return [
        '生成 360° 等距柱状投影全景图，输出画幅必须是精确 2:1。',
        '左右边缘无缝衔接，地平线连续，顶部与底部极点连续且无拉裂、重影或重复物体。',
        '保持空间结构、尺度、光源方向和物体关系一致，不使用普通广角照片或立方体贴图布局。',
      ]
    case 'portrait.refine':
      return [
        '对参考人物进行克制、写实的人像真实化处理。',
        `人物融合：${param(plan, 'sceneBlend', '自然融合')}。`,
        `光影匹配：${param(plan, 'lightingMatch', '自然匹配')}。`,
        `肤质：${param(plan, 'skinTexture', '自然肤质')}。`,
        `表面纹理：${param(plan, 'surfaceTexture', '自然纹理')}。`,
        `清晰度：${param(plan, 'sharpness', '标准清晰')}。`,
        `真实化强度：${param(plan, 'realismStrength', 60)}/100。`,
        identityLockInstruction(plan),
        '保留自然毛孔、细小纹理和合理瑕疵，避免塑料皮肤、过度锐化和美容滤镜感。',
      ]
    case 'portrait.mood': {
      const energy = scaleIndex(output?.energy ?? param(plan, 'energy', 2))
      const affinity = scaleIndex(output?.affinity ?? param(plan, 'affinity', 2))
      return [
        `情绪能量 ${energy}/4：${ENERGY_LABELS[energy]}。`,
        `关系亲和度 ${affinity}/4：${AFFINITY_LABELS[affinity]}。`,
        `表情强度 ${param(plan, 'expressionStrength', 50)}/100。`,
        ...moodPerformanceInstructions(energy, affinity),
        '只调整表情肌、眼神和轻微姿态，不改变服装、场景或镜头。',
        `${identityLockInstruction(plan)} 不得改变五官几何或人物身份。`,
      ]
    }
    case 'image.style.transfer': {
      const sourceWidth = Number(plan.params.sourceWidth)
      const sourceHeight = Number(plan.params.sourceHeight)
      const sourceAspectRatio = Number(plan.params.sourceAspectRatio)
      const modelAspectRatio = String(plan.params.aspectRatio || 'auto')
      const aspectInstruction = Number.isFinite(sourceWidth)
        && Number.isFinite(sourceHeight)
        && Number.isFinite(sourceAspectRatio)
        && sourceWidth > 0
        && sourceHeight > 0
        && sourceAspectRatio > 0
        ? `源图画幅 ${Math.round(sourceWidth)}×${Math.round(sourceHeight)}（精确比例 ${sourceAspectRatio}，模型档位 ${modelAspectRatio}）。`
        : `保持源图画幅比例，模型比例档位 ${modelAspectRatio}。`
      return [
        `应用创作资源指定的视觉风格，风格强度 ${param(plan, 'styleStrength', 60)}/100。`,
        aspectInstruction,
        '不得扩边、不得裁切、不得改变画布长宽比；主体和关键物体在画面中的相对位置不得移动。',
        '保持主体身份、构图、空间关系和语义内容不变，只迁移色彩、光影、材质表现与成像质感。',
      ]
    }
    case 'video.look.apply':
      return [
        '以源图片作为首帧或视觉参考生成一条新视频，并应用创作资源指定的视觉风格。',
        '保持人物身份、镜头构图、动作逻辑和时间连续性，避免逐帧闪烁、纹理漂移和背景跳变。',
      ]
    case 'video.effect.reference':
      return [
        '以源图片作为首帧或视觉参考生成一条新视频，并参考创作资源中的效果语言组织时序变化。',
        '保持人物身份、镜头构图、动作逻辑和时间连续性，效果不得遮蔽关键主体或改变物体关系。',
      ]
    case 'video.edit.look':
      return [
        '对源视频执行视频转视频视觉改造，应用创作资源指定的色彩、光线、材质与成像风格。',
        '严格保留源视频的镜头时长、剪辑点、相机运动、人物身份、动作节奏和物体关系。',
        '避免逐帧闪烁、纹理漂移、背景跳变、动作重排或把源视频退化成静态首帧动画。',
      ]
    case 'video.edit.effect':
      return [
        '在源视频原有时序上应用创作资源指定的动态效果，按动作因果、遮挡关系和镜头节奏发展。',
        '严格保留源视频的镜头时长、剪辑点、相机运动、人物身份、动作节奏和物体关系。',
        '效果不得遮蔽关键主体、穿透物体、改变动作顺序，也不得把源视频退化成静态首帧动画。',
      ]
    default:
      return []
  }
}

export function compileCapabilityRecipePrompt(
  basePrompt: string,
  plan: RecipeRunPlan,
  task: CapabilityRecipeTask,
): string {
  return [
    basePrompt.trim(),
    `创作能力配方：${plan.recipeId}`,
    ...compileRecipeInstructions(plan, task),
    ...providerCandidateInstructions(plan),
  ]
    .filter(Boolean)
    .join('\n')
}
