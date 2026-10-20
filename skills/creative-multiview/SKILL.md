---
name: creative-multiview
description: 生成同一主体的九个独立机位或指定视角，并规划后续 3D 重建与导演台交接。自动生成与需用户在画布完成的 3D 操作分开说明。
metadata:
  nomi:
    selectable-in-workbench: true
    version: 1.0.0
    label: 多视角与 3D 重建
    author: '@nomi'
    canvas:
      recipeIds:
        - image.multiview.grid9
        - image.multiview.custom
        - image.multiview.reconstruct3d
      defaultRecipeId: image.multiview.grid9
    inputs:
      - name: source
        description: 画布中的清晰主体图片节点，以及期望的机位或 3D 用途。
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
      - model3d
    stages:
      - id: inspect
        goal: 读取画布并确认唯一主体、遮挡、参考图质量与所需机位。
        tools:
          - look_at_canvas
          - look_at_media
          - list_models
        pause: true
      - id: views
        goal: 用当前图像编辑模式生成九个独立方位或指定机位草稿，按真实回执跟进结果。
        tools:
          - draft_shots
          - generate
          - check_job
        depends-on:
          - inspect
        pause: true
        model-prefs:
          - kind: image
      - id: reconstruct
        goal: 核对 3D 需求和已有模型资产；未支持的重建交给画布配方，不伪造完成。
        tools:
          - look_at_media
          - list_models
        depends-on:
          - views
        pause: true
        model-prefs:
          - kind: model3d
      - id: handoff
        goal: 记录选定模型资产和交接要求；实际导入由用户在现有导演节点完成。
        tools:
          - look_at_canvas
          - look_at_media
          - make_artifact
        depends-on:
          - reconstruct
        pause: true
---

# 多视角与 3D 重建

你负责把一张清晰主体图扩展为可比较的机位结果，并准备 3D 重建和交接资料。保留原图，结果按真实产物身份区分，不把草稿、二维视角或交接说明冒充已生成的 3D 模型。

## 流程规划

1. `inspect`：用 `look_at_canvas` 找到来源，用 `look_at_media` 取得原图的素材身份，再用 `list_models` 核对图像编辑模式与参考槽。
2. `views`：用 `draft_shots` 为九个固定方位或指定角度分别建立图像编辑草稿，每张都引用同一原图；用户要求实际生成时，再用回执中的操作身份调用 `generate`。
3. `reconstruct`：当前 canonical 生成链没有可验证的图生 3D 路径。说明缺口，保留 `image.multiview.reconstruct3d` 的画布配方供用户操作，不能用二维图片代替模型文件。
4. `handoff`：用 `look_at_media` 核对已有素材，并用 `make_artifact` 记录模型来源与交接要求；当前没有自动导入 Blender / Scene3D 的 canonical 动词，模型文件本身由用户在现有节点核对并完成交接。

每阶段只做当前目标。若源图模糊、主体被遮挡或包含多个同等主体，先说明风险并等用户选择。

## 素材分析

- 找出唯一主体、正面方向、尺度、材质、对称性、薄片和透明区域。
- 检查主体是否完整入镜；缺失背面信息时明确标记为推断，不伪称真实还原。
- 人物必须锁定身份、年龄、发型、服装和身体比例；产品必须锁定几何、标识和材质。
- 九宫格按固定行列读取，不能把九张互不相关的创意图当作多视角。

## 故事板设计

- 九宫格固定为正面、右前、右侧、右后、背面、左后、左侧、左前、俯视。
- 自定义机位只改变相机方位、俯仰和景别，不改变主体姿态与场景语义。
- 3D 结果是后续摆位资产；原图、多视角集合、3D 模型和导演台节点都保留来源边。
- 多个结果先让用户在集合内选择主版本，再进入后续阶段。

## 媒体生成

- 选择目录实际提供的图像编辑模型，机位与身份锁定写进每张提示词，参考素材身份写入每张草稿。
- 模型身份和模式来自本轮目录，不硬编码供应商或私有参数。
- canonical 路径产出九张独立结果，不自动拼九宫格或拆分单张联系表；需要这种包装时由现有画布配方处理，不能声称已经拼好。
- 用 `check_job` 读取任务回执，只使用返回的任务域和任务身份；不因等待而重复提交。
- 3D 结果必须是可访问的模型文件；交接只复制或引用，不修改来源结果。

## 提示词写法

- 明确写出“同一主体、相同姿态、相同几何、相同材质、仅相机改变”。
- 自定义机位写方位角、俯仰角和景别，不使用含糊的“换个角度”。
- 禁止新增配件、改变服装、镜像标识、漂移五官或重设计背面。
- 未知区域允许合理补全，但必须保持可见结构连续。

## 视频剪辑

- 本 Skill 不直接生成镜头视频；多视角可作为镜头设计和空间连续性参考。
- 送入导演台后，用相邻机位规划可执行运镜，避免瞬间跨越轴线。
- 若后续要做环绕视频，先确认主模型和起止机位，再交给视频能力配方。

## 输入

- **source**（必填）：画布中的清晰主体图片节点，以及期望的机位或 3D 用途。

## 示例

- **产品九宫格与 3D**
  > 把这张咖啡机做成九宫格，再重建 3D 并送进 Blender 导演台。
