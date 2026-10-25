---
name: creative-panorama
description: 生成严格 2:1 的等距柱状 360° 全景。当用户提到全景图、环境球、HDRI 构图、VR 场景、四周空间或导演台环境时使用。
metadata:
  nomi:
    selectable-in-workbench: true
    version: 1.0.0
    label: 360° 全景场景
    author: '@nomi'
    canvas:
      recipeIds:
        - scene.panorama.2to1
      defaultRecipeId: scene.panorama.2to1
    inputs:
      - name: sceneBrief
        description: 场景类型、空间关系、时间、光线与可选参考图。
        required: true
    tools:
      - look_at_canvas
      - look_at_media
      - list_models
      - stage_shot
      - draft_shots
      - generate
      - check_job
    required-providers:
      - image
    stages:
      - id: inspect
        goal: 读取现有场景素材，确认空间类型、地平线、入口、主要区域与用途。
        tools:
          - look_at_canvas
          - look_at_media
          - list_models
        pause: true
      - id: spatial-plan
        goal: 在需要人物空间调度时先建立低成本站位参考，核对方位关系。
        tools:
          - look_at_canvas
          - stage_shot
        depends-on:
          - inspect
        pause: true
      - id: generate
        goal: 用目录支持的图像模式生成全景候选，验证真实比例，不承诺自动裁切或接缝修复。
        tools:
          - draft_shots
          - generate
          - check_job
        depends-on:
          - spatial-plan
        pause: true
        model-prefs:
          - kind: image
---

# 360° 全景场景

你负责生成能作为环境球或空间参考的全景，不把普通超广角图冒充 360° 全景。生成前必须确认空间布局和费用动作。

## 流程规划

1. `inspect`：用 `look_at_canvas`、`look_at_media` 核对素材，用 `list_models` 查支持全景所需画幅的模式。
2. `spatial-plan`：有人物调度且已有真实镜头身份时，用 `stage_shot` 的站位分支核对空间；没有镜头身份就先规划，不编造绑定目标。
3. `generate`：用 `draft_shots` 建立全景候选，用户要求生成时用 `generate`，随后按任务回执用 `check_job` 查询。用媒体记录检查实际尺寸，不能只凭提示词宣称比例与接缝合格。

没有站位需求时也保留该阶段确认，可在用户同意后跳过站位参考直接生成。

## 素材分析

- 提取空间类型、长宽高感、门窗位置、主光方向、家具分区和行走路径。
- 参考图只提供风格或局部设计时，不假设它包含完整 360° 几何。
- 明确相机中心高度和地平线；室内默认接近人眼高度，但不自行决定关键叙事位置。
- 检查左右边缘是否应连续，天顶和地面是否有高对比物体穿越接缝。

## 故事板设计

- 把场景组织成前、右、后、左四个连续象限，主要区域之间保持可理解的相邻关系。
- 重要表演区不要放在左右接缝上；门窗、桌椅和通道不能首尾重复或断裂。
- 若全景用于导演台，保留可放置人物、摄影机和灯光的净空。
- 全景是空间底图，不替代精确的 3D 碰撞或测量模型。

## 媒体生成

- 只向模型传目录支持的画幅值。模型不支持严格 2:1 时，说明需要用户通过保留的 `scene.panorama.2to1` 画布配方裁切；canonical 动词本身没有自动裁切能力。
- 输出必须是 equirectangular projection，水平覆盖 360°、垂直覆盖 180°。
- 云端 Provider 优先；用户配置的 ComfyUI 若声明相同能力也可被兼容层选择。
- 结果作为新集合保留，失败或重试不覆盖上一版。

## 提示词写法

- 必写：等距柱状投影、2:1、360×180、水平地平线、左右无缝、天顶与地面连续。
- 写清四个方位的空间元素与相邻关系，避免只描述相机正前方。
- 禁止鱼眼圆图、立方体展开图、普通广角照片、文字水印和镜像重复家具。
- 光源方向和色温需要绕场一致，接缝两侧不可出现突变曝光。

## 视频剪辑

- 全景本身不直接进入普通时间轴，可作为导演台环境与取景依据。
- 从全景选择镜头时先定朝向与视场角，再生成普通画幅镜头，避免直接裁切导致畸变。
- 相邻镜头应保持方位连续；跨越接缝的运动需要在导演台中预演。

## 输入

- **sceneBrief**（必填）：场景类型、空间关系、时间、光线与可选参考图。

## 示例

- **咖啡店环境球**
  > 生成一个下午靠窗咖啡店的 2:1 全景，供导演台摆机位。
