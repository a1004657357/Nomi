---
name: creative-style-resource
description: 把图片、文字或色板整理为可追溯的风格说明，并用图像编辑模式应用到新图像；独立资源库登记由现有画布控件完成。
metadata:
  nomi:
    selectable-in-workbench: true
    version: 1.0.0
    label: 风格与色彩资源
    author: '@nomi'
    canvas:
      recipeIds:
        - image.style.transfer
      defaultRecipeId: image.style.transfer
    inputs:
      - name: styleSource
        description: 风格参考图、色板或文字描述，以及来源和商业使用边界。
        required: true
    tools:
      - look_at_canvas
      - look_at_media
      - list_models
      - make_artifact
      - draft_shots
      - generate
      - check_job
    required-providers:
      - image
    stages:
      - id: analyze
        goal: 读取风格来源，提取可描述特征并确认来源、许可和商业使用边界。
        tools:
          - look_at_canvas
          - look_at_media
          - list_models
        pause: true
      - id: save
        goal: 将风格、色板、来源和授权状态保存为画布说明，不冒充 CreativeResource 登记。
        tools:
          - make_artifact
        depends-on:
          - analyze
        pause: true
      - id: apply
        goal: 用图像编辑草稿引用目标与风格素材，生成保留身份、构图和语义的新结果。
        tools:
          - draft_shots
          - generate
          - check_job
        depends-on:
          - save
        pause: true
        model-prefs:
          - kind: image
---

# 风格与色彩资源

你负责把风格拆成可复用特征并记录来源，再受控地应用到图像。不要复制不明来源的模型权重或把某位在世艺术家的完整风格当作可商用资产。

## 流程规划

1. `analyze`：用 `look_at_canvas`、`look_at_media` 核对参考身份，用 `list_models` 核对图像编辑模式和参考容量，再提取视觉特征。
2. `save`：用 `make_artifact` 记录风格描述、色板、来源、许可与商业使用状态。这是可读的来源档案，不会创建 CreativeResource ID；要登记资源库时由用户在现有控件完成。
3. `apply`：在 `draft_shots` 中引用目标图和目录允许数量的风格参考，将文字风格要求写入提示词；用户要求生成时调用 `generate`，用 `check_job` 读取实际结果。不把风格说明节点的身份当图片素材身份。

来源和授权不清楚时，可以分析供私人试验，但必须标记 commercialUse 为 unknown 或 false。

## 素材分析

- 色彩：主色、辅色、点缀色、饱和度、黑白场和肤色保护范围。
- 光线：方向、软硬、色温、反差、雾化与高光滚降。
- 材质：胶片颗粒、纸张、玻璃、金属、布料和表面粗糙度。
- 语义保护：人物身份、产品几何、文字、构图和动作不属于风格，不应被迁移改变。

## 故事板设计

- 一个项目先建立少量明确资源：主风格、主色板、必要时一个例外风格。
- 跨镜头引用同一经确认的风格说明和真实素材身份；若已有资源库记录则沿用，不自行编造新的资源 ID。
- 角色特写优先保护肤色和身份；产品镜优先保护品牌色、标识与材质。
- 风格试验结果放在版本集合中，选定后再设为当前主结果。

## 媒体生成

- 风格说明与图像生成是两个步骤，不把保存说明当作已经生成。
- 记录可读的风格要点；有参考媒体时保留原素材身份与来源。
- 图像编辑模式需要真实目标图和支持的参考输入，不能把旧资源对象或配方名称当作模型参数。
- 云端 Provider 优先，兼容的本地 ComfyUI 可选；不得捆绑或下载第三方重型权重。

## 提示词写法

- 用视觉属性描述风格，不只写作品名或作者名。
- 明确“保留主体身份、几何、构图、姿态、文字和场景语义”。
- 分开写色彩、光线、材质、镜头特征和迁移强度，避免互相矛盾。
- 禁止新增无关物体、替换服装、改脸、镜像品牌标识或重画文字。

## 视频剪辑

- 该 Skill 先统一关键帧；视频风格和时序一致性由视频风格 Skill 处理。
- 剪辑中检查镜头间黑位、肤色、饱和度和颗粒是否跳变。
- 若某镜因叙事需要偏离主风格，保存为明确的例外资源并记录适用范围。

## 输入

- **styleSource**（必填）：风格参考图、色板或文字描述，以及来源和商业使用边界。

## 示例

- **统一夏日广告色彩**
  > 把这张参考图的明快青绿和柔和高光保存为风格资源，再应用到选中的镜头。
