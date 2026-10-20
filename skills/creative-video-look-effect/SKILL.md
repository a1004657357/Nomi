---
name: creative-video-look-effect
description: 整理视觉风格与动作效果，生成新的视频镜头并编辑时间轴；已有视频的精确再编辑仅在真实支持时执行，不冒充视频转视频能力。
metadata:
  nomi:
    selectable-in-workbench: true
    version: 1.0.0
    label: 视频风格与效果
    author: '@nomi'
    canvas:
      recipeIds:
        - video.look.apply
        - video.effect.reference
        - video.edit.look
        - video.edit.effect
      defaultRecipeId: video.look.apply
    inputs:
      - name: shotAndReference
        description: 目标镜头、风格或效果描述、可选参考媒体及来源许可。
        required: true
    tools:
      - look_at_canvas
      - look_at_media
      - list_models
      - make_artifact
      - draft_shots
      - generate
      - check_job
      - read_timeline
      - edit_timeline
    required-providers:
      - video
    stages:
      - id: analyze
        goal: 读取镜头和参考，拆分视觉风格、动作因果、持续时间，并确认授权。
        tools:
          - look_at_canvas
          - look_at_media
          - list_models
        pause: true
      - id: save
        goal: 将风格、效果、来源和商业使用信息保存为画布说明，资源库登记由用户完成。
        tools:
          - make_artifact
        depends-on:
          - analyze
        pause: true
      - id: apply
        goal: 通过当前视频生成模式规划新镜头；已有视频再编辑没有等价入口时明确拒绝替代。
        tools:
          - draft_shots
          - generate
          - check_job
        depends-on:
          - save
        pause: true
        model-prefs:
          - kind: video
      - id: assemble
        goal: 用户选定视频版本后，按分镜顺序排入时间轴。
        tools:
          - read_timeline
          - edit_timeline
        depends-on:
          - apply
        pause: true
        model-prefs:
          - kind: video
---

# 视频风格与效果

你负责记录可追溯的风格和效果，并在保持角色、构图和动作逻辑的前提下规划新视频。只根据真实任务回执描述生成进度，不承诺没有执行的资源库登记或视频再编辑。

## 流程规划

1. `analyze`：用 `look_at_canvas`、`look_at_media` 查目标与参考身份，用 `list_models` 查当前视频模式和参考槽。
2. `save`：用 `make_artifact` 保存风格或效果说明及来源；该说明不是资源库注册。
3. `apply`：图片驱动的新视频使用 `draft_shots` 表达首帧参考与动作，再调用 `generate` 并用 `check_job` 查询。当前 canonical 链没有已验证的视频转视频入口；用户要求保留原视频动作再调色或加效果时，明确说明缺口，由现有视频编辑配方控件处理，不自动改成首帧动画。
4. `assemble`：用 `read_timeline` 取当前修订，用 `edit_timeline` 按用户选定的真实视频素材身份编辑；不把草稿或节点身份当已生成素材。

## 素材分析

- 区分静态 look（色彩、光线、颗粒、镜头质感）和时序 effect（出现、扩散、碰撞、消散）。
- 找出角色身份、产品几何、相机运动和必须保持的动作节奏。
- 参考视频需要记录来源、许可和 commercialUse；不明来源不能默认商用。
- 频率受限 Provider 按运行器队列和并发上限执行，不自行重复提交。

## 故事板设计

- 每个效果写清触发条件、起点、发展、峰值和结束状态。
- 效果必须跟随物体表面、遮挡和相机运动，不能悬浮或穿帮。
- 相邻镜头共享主 style 资源；effect 只连到确实需要的镜头。
- 先生成一条低风险样片确认，再按用户选择批量扩展。

## 媒体生成

以下配方仍保留在画布节点，供用户选择；它们不是 Agentlane 可调用的工具，也不自动映射为任意视频模式。

- `video.look.apply` 用于图片驱动的视频视觉风格，源节点必须是图片。
- `video.effect.reference` 从图片首帧或视觉参考出发，按效果资源描述生成动作演进。
- `video.edit.look` 用于已有视频的视觉风格改造，目标模式必须真实支持 `source_video`。
- `video.edit.effect` 用于已有视频的时序效果改造，保留原动作、镜头和剪辑节奏。
- 不得把图片驱动配方描述成视频转视频，也不得在模型没有 `source_video` 槽时自动降级成首帧动画。
- 只按生成回执与素材记录确认新结果，保留历史素材；不能承诺 canonical 链创建了旧配方专属的版本集合。
- Provider 由兼容层选择；不硬编码供应商、模型 ID、分辨率枚举或私有端口。

## 提示词写法

- 按时间写动作：“0–1 秒出现，1–3 秒扩散，3–4 秒稳定并自然消散”。
- 明确相机运动、主体动作、效果运动三者的相对关系和遮挡。
- 风格描述拆成色彩、曝光、材质、镜头与颗粒，禁止只写抽象“电影感”。
- 禁止闪烁、身份漂移、物体形变、无因果粒子、标识镜像和背景跳变。

## 视频剪辑

- 只把用户选定的当前版本排入时间轴；历史版本留在节点集合中供回滚。
- 效果峰值应服务剪辑点、对白或音乐节拍，不能遮挡关键表演和产品信息。
- 排片后检查画幅、分辨率、帧率感、色彩和音画节奏，发现不连续就回到对应节点重生新版本。

## 输入

- **shotAndReference**（必填）：目标镜头、风格或效果描述、可选参考媒体及来源许可。

## 示例

- **饮品冰雾效果**
  > 保存冰雾沿杯壁扩散的效果参考，应用到这个产品镜头并排到时间轴。
