---
name: creative-mood-identity
description: 用能量、亲和度和表情强度生成身份一致的情绪版本。当用户提到情绪矩阵、5×5 表情、开心或冷淡程度、角色表演变化且不能换脸时使用。
metadata:
  nomi:
    selectable-in-workbench: true
    version: 1.0.0
    label: 5×5 情绪与身份保护
    author: '@nomi'
    canvas:
      recipeIds:
        - portrait.mood
      defaultRecipeId: portrait.mood
    inputs:
      - name: portraitAndMood
        description: 清晰人物节点，以及目标能量、亲和度、表情强度或表演意图。
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
      - id: inspect
        goal: 读取人物素材，确认身份锚、基础表情和表演边界。
        tools:
          - look_at_canvas
          - look_at_media
          - list_models
        pause: true
      - id: coordinates
        goal: 把自然语言表演意图映射为 0 到 4 的能量、亲和度与表情强度。
        tools:
          - make_artifact
        depends-on:
          - inspect
        pause: true
      - id: generate
        goal: 用明确坐标标注的图像编辑草稿生成 1、5 或 25 个情绪版本。
        tools:
          - draft_shots
          - generate
          - check_job
        depends-on:
          - coordinates
        pause: true
        model-prefs:
          - kind: image
      - id: save
        goal: 把用户选定的结果素材身份和情绪坐标保存为画布说明，资源库登记由用户完成。
        tools:
          - look_at_media
          - make_artifact
        depends-on:
          - generate
        pause: true
---

# 5×5 情绪与身份保护

你负责改变表演，不改变演员。用能量和亲和度组成 5×5 情绪空间，再以表情强度控制变化幅度；所有结果作为可比较的新版本保存。

## 流程规划

1. `inspect`：用 `look_at_canvas`、`look_at_media` 取得同一人物的参考素材，用 `list_models` 核对图像编辑模式。
2. `coordinates`：回显能量、亲和度和表情强度；需要留档时用 `make_artifact` 保存坐标说明。
3. `generate`：单点、五格试跑、完整矩阵分别用 `draft_shots` 显式规划 1、5、25 张独立图片。每张标题与提示词标注坐标，并引用同一原图。根据用户要求调用 `generate`，后续只用 `check_job` 跟进，不因状态未定而重提。
4. `save`：用户选定后，用 `make_artifact` 记录该结果的素材身份与坐标，后续镜头引用该素材；这不是 CreativeResource 注册，入资源库仍由用户在画布完成。

## 素材分析

- 识别眼神、眉眼张力、嘴角、下颌、肩颈、头部倾斜和身体朝向。
- 锁定脸型、五官位置、年龄、发型、服装、配饰、肤色和背景。
- 区分情绪与动作：哭泣、发抖等强动作需要用户明确提出，不能从“悲伤”自动夸大。
- 面部不可见时，以身体表演为主并降低身份判断置信度。

## 故事板设计

- 能量 0 表示平静/静止，4 表示兴奋/高张力。
- 亲和度 0 表示亲近/开放，4 表示疏离/封闭。
- 表情强度 0 表示几乎不变，4 表示清晰但仍自然的变化。
- 连续镜头的坐标应按表演弧线渐变，避免相邻镜头无动机地跳到对角。

## 媒体生成

- 单个目标情绪只生成一个新版本；不确定强度时先做五格试跑，用户要求完整矩阵时再按 25 个有序结果执行并保留坐标标签。
- 身份锁定默认开启，变化只作用于表情肌、眼神和轻微姿态。
- Provider 由兼容层根据图像能力选择，不在 Skill 中写死。
- 在生成前说明输出数量；执行与并发遵循统一运行器及其真实确认回执，技能不自行承诺并发上限，也不在模型参数里传旧配方的 sample5 / matrix5x5 控件。

## 提示词写法

- 写清坐标和可见表演：“低能量、高疏离、轻微收紧嘴角、目光短暂避开”。
- 使用可观察动作，不只写抽象情绪词。
- 禁止脸型变化、年龄变化、换妆、换发型、牙齿形状改变和夸张卡通表情。
- 强度低时优先眼神和微表情；强度高时才加入明显眉眼与肩颈变化。

## 视频剪辑

- 情绪图可作为关键帧或角色表演参考，视频提示词需描述从上一坐标到下一坐标的过渡。
- 关键情绪变化要由对白、动作或事件触发，不能只靠切镜解释。
- 剪辑检查身份、视线方向和情绪强度是否连续，并去除突变版本。

## 输入

- **portraitAndMood**（必填）：清晰人物节点，以及目标能量、亲和度、表情强度或表演意图。

## 示例

- **克制但疏离**
  > 保持这个演员不变，生成低能量、高疏离、轻微克制不悦的版本。
