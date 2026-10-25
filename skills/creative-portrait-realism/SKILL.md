---
name: creative-portrait-realism
description: 在保护身份的前提下改善皮肤、光线、材质、清晰度和场景融合。当用户提到人像真实化、去塑料感、皮肤质感、光影融合或照片感时使用。
metadata:
  nomi:
    selectable-in-workbench: true
    version: 1.0.0
    label: 人像真实化
    author: '@nomi'
    canvas:
      recipeIds:
        - portrait.refine
      defaultRecipeId: portrait.refine
    inputs:
      - name: portrait
        description: 包含清晰面部的人像节点，以及希望改善的真实化维度。
        required: true
    tools:
      - look_at_canvas
      - look_at_media
      - list_models
      - draft_shots
      - generate
      - check_job
      - make_artifact
    required-providers:
      - image
    stages:
      - id: inspect
        goal: 读取来源人像，识别身份锚、真实化问题和不可改变项。
        tools:
          - look_at_canvas
          - look_at_media
          - list_models
        pause: true
      - id: refine
        goal: 用图像编辑草稿表达已确认的修复维度，按真实生成结果比较人物身份。
        tools:
          - draft_shots
          - generate
          - check_job
        depends-on:
          - inspect
        pause: true
        model-prefs:
          - kind: image
      - id: identity-resource
        goal: 记录选定人像的真实素材身份与来源，作为后续镜头参考，不冒充资源库注册。
        tools:
          - look_at_media
          - make_artifact
        depends-on:
          - refine
        pause: true
---

# 人像真实化

你负责修复合成人像的塑料感和融合问题，不重新设计人物。身份锁定默认开启；未经明确要求，不改变脸型、五官比例、年龄、肤色、发型或服装。

## 流程规划

1. `inspect`：读取来源图，分别判断皮肤、光线、表面材质、锐度和场景融合问题。
2. `refine`：用 `look_at_media` 取得原图素材身份，`list_models` 核对图像编辑模式；将已确认的修复维度写入 `draft_shots` 提示词并引用原图，再按用户要求调用 `generate`，用 `check_job` 查询。
3. `identity-resource`：用户选定后，用 `make_artifact` 保存身份说明与返回的素材身份，后续镜头引用该素材。该说明不是 CreativeResource 注册表记录；若用户要入资源库，交给现有画布控件处理。

强度从低到高逐步增加；第一次不满意就新增版本，不覆盖旧结果。

## 素材分析

- 身份锚：脸型、眼距、鼻唇结构、下颌、发际线、年龄感和标志性特征。
- 真实化缺陷：皮肤无毛孔、蜡感、高光贴图感、边缘过锐、光向冲突、人物与背景色温不一致。
- 区分本来就有的妆容、雀斑、皱纹和伤疤，不把真实特征当噪声抹掉。
- 若面部太小、严重遮挡或已失真，先说明身份保护无法可靠评估。

## 故事板设计

- 跨镜头先确定一个经用户确认的 identity 资源，其他镜头都引用它。
- 同场景镜头保持主光方向、曝光、肤色响应和镜头锐度一致。
- 特写允许更多皮肤微细节；远景不强行添加夸张毛孔和锐化纹理。
- 修复版本与原始版本并列保存，用户可随时回滚或比较。

## 媒体生成

- 将人物与背景的综合色温、边缘和景深融合要求写进提示词。
- 说明面部光向、阴影软硬与环境反射的目标。
- 分开描述皮肤、服装/道具材质、清晰度和修复幅度，锁定未授权改变的身份特征。
- 这些是创作意图，不把旧配方控件名当作模型参数；仅传目录明示的参数。

## 提示词写法

- 先写不可改变项，再写需要修复的局部和强度。
- 使用“保留自然毛孔、细小绒毛、微弱肤色变化、真实次表面散射”，不要写“完美无瑕皮肤”。
- 明确禁止美容整形、磨皮、锐化光环、橡胶质感、假睫毛漂移和牙齿重构。
- 手机背面朝向镜头时，不能描述或生成屏幕内容；所有可见性必须符合相机方位。

## 视频剪辑

- 本 Skill 输出参考图；用于视频时，把确认的人像版本作为首帧或身份参考。
- 相邻镜头的人像修复强度应一致，避免切镜时肤质、年龄感或锐度突变。
- 最终剪辑前逐镜检查身份漂移、闪烁皮肤纹理和不连续的光照。

## 输入

- **portrait**（必填）：包含清晰面部的人像节点，以及希望改善的真实化维度。

## 示例

- **去除塑料皮肤**
  > 保持人物完全一致，只修复皮肤蜡感、光线不融合和过锐问题。
