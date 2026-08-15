# ComfyUI 工作流语料 · Nomi 导入分析器兼容性报告

> 生成时间：2026-08-01T17:41:15.278Z · ComfyUI @ http://127.0.0.1:8188 · 本机 /object_info 节点类 823 个

## 0. 语料规模（ComfyUI 0.29 官方模板包全量）

| 维度 | 数量 |
|---|---|
| 官方模板总数（去掉 index/manifest/fuse_options 后） | 493 |
| 文件名带 `api_` 前缀（**用云端/付费 API 节点**，非「API 导出格式」） | 221 |
| 用 subgraph（节点 type 是 UUID，官方新模板大量用） | 180 |
| 原始格式为「UI 保存格式」（nodes[]/links[]） | 493 |
| 原始格式为「API 格式」（node-id → class_type 映射） | 0 |

**关键事实（贯穿全报告）**：官方模板包里 **0 张是 API 格式**——全是 UI 格式（哪怕 `api_*.json` 也是 UI 格式，`api_` 指「用云端节点」）。
但 Nomi 导入器收的是用户从 ComfyUI 菜单「Export (API)」导出的 **API 格式**。所以：
- **UI 原样粘贴** → 分析器应报「请导出 API 格式」（预期行为，见 §3，单独统计不算失败）。
- 要测**分析器真本事**，必须先把 UI 模板转成 Export-API 等价的 API 格式（`scripts/comfyui-ui-to-api.py`，复刻前端 `graphToPrompt`：丢 bypass 节点、widget/link 对齐、subgraph 递归展平）。

## 1. 转换忠实度门（用真 ComfyUI `/prompt` 校验做 oracle）

把每张转换图提交真服务器：`accepted` 或**只报缺模型/缺文件** = 转换忠实；报 `required_input_missing`/`invalid_input_type` 等**结构错** = 转换器对**动态 widget**（`COMFY_DYNAMICCOMBO_V3`/`COMFY_AUTOGROW_V3`，选项会展开成子输入、`widgets_values` 错位）力有未逮。**这些诚实剔除**，不当作 Nomi 的锅。

| 判定 | 数量 | 占比 |
|---|---|---|
| ✅ 转换忠实（进 §2 真测分析器） | 259 | 53% |
| ⚠️ 转换器力有未逮（动态 widget，剔除不测） | 234 | 47% |

**忠实语料 = 259 张**（远超 30+ 目标），下面 §2 全部量化基于它——任何识别失败都是 Nomi 的、不是转换器的。

## 2. 分析器识别率（忠实 API 语料，用户真实导入路径）

| 指标 | 数 | 率 |
|---|---|---|
| 忠实语料进测 | 259 | 100% |
| `parseComfyApiWorkflow` 解析通过 | 259 | 100% |
| **识别出提示词节点**（可绑 {{request.prompt}}） | 226 | 87% |
| **识别出输出节点**（判成图/视频） | 248 | 96% |
| 识别出首帧输入（图生视频/图生图必需） | 154 | 59% |

### taskKind 分布（buildImportedWorkflow 判定）

| taskKind | 数量 |
|---|---|
| `image_edit` | 76 |
| `image_to_video` | 64 |
| `text_to_image` | 62 |
| `text_to_video` | 40 |
| `image_to_3d` | 14 |
| `text_to_3d` | 3 |

### 输出判定（图/视频）分布

| outputKind | 数量 |
|---|---|
| image | 127 |
| video | 104 |
| model3d | 17 |
| (无输出) | 11 |

### 参数建议：平均每张建议 **3.1** 个可调参数（seed/steps/cfg/…）。0 参数的图：36 张。

## 3. 缺件对账（reconcileComfyWorkflow 打真本机 /object_info）

（本机是**空 models 目录**的纯净 ComfyUI，故「缺模型」率会很高——这正是真实首跑场景：用户装了自定义节点却没下模型。）

| 指标 | 数 | 率 |
|---|---|---|
| 图里含**本机没装的节点类**（缺自定义节点包） | 3 | 1% |
| 图里含**本机没有的模型/文件名** | 206 | 80% |

## 4. UI 格式拒绝路径（用户直接粘贴 UI 保存格式——最常见误操作）

| 指标 | 数 | 率 |
|---|---|---|
| 原样 UI 粘贴 → 正确报「请 Export (API)」 | 493 | 100% |
| 未给出该提示（漏网/报了别的错） | 0 | — |

拒绝提示原文（人话，可行动）：

> 这是 ComfyUI 的「界面保存」格式，不是 API 格式。请在 ComfyUI 菜单 Workflow → Export (API) 导出后再粘贴。

## 5. 识别失败逐个剖析（忠实语料里没认全的）

### 5a. 没识别出提示词节点（33 张）

| 文件 | 节点数 | subgraph | 图里 class_type（截样） | 推断原因 |
|---|---|---|---|---|
| 04_hunyuan_3d_2.1_subgraphed.json | 10 | Y | `LoadImage` `SaveGLB` `KSampler` `CLIPVisionEncode` `Hunyuan3Dv2Conditioning` `EmptyLatentHunyuan3Dv2` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| 3d_hunyuan3d-v2.1.json | 10 |  | `ImageOnlyCheckpointLoader` `LoadImage` `ModelSamplingAuraFlow` `EmptyLatentHunyuan3Dv2` `Hunyuan3Dv2Conditioning` `KSampler` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| 3d_hunyuan3d_image_to_model.json | 10 |  | `KSampler` `CLIPVisionEncode` `ImageOnlyCheckpointLoader` `LoadImage` `VAEDecodeHunyuan3D` `EmptyLatentHunyuan3Dv2` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| 3d_hunyuan3d_multiview_to_model.json | 12 |  | `KSampler` `CLIPVisionEncode` `ImageOnlyCheckpointLoader` `LoadImage` `VAEDecodeHunyuan3D` `Hunyuan3Dv2ConditioningMultiView` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| 3d_hunyuan3d_multiview_to_model_turbo.json | 13 |  | `KSampler` `CLIPVisionEncode` `ImageOnlyCheckpointLoader` `LoadImage` `VAEDecodeHunyuan3D` `Hunyuan3Dv2ConditioningMultiView` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| 3d_moge_panorama_to_mesh.json | 10 | Y | `SaveGLB` `LoadImage` `MoGePanoramaInference` `MoGePointMapToMesh` `LoadMoGeModel` `ComfyMathExpression` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| 3d_moge_perspective_to_mesh.json | 14 | Y | `LoadImage` `SaveGLB` `PreviewImage` `MoGePointMapToMesh` `MoGeInference` `LoadMoGeModel` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_bria_remove_video_background.json | 3 |  | `BriaRemoveVideoBackground` `LoadVideo` `SaveVideo` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_bria_remove_video_background_transparent.json | 5 |  | `BriaTransparentVideoBackground` `LoadVideo` `JoinImageWithAlpha` `SaveWEBM` `GetVideoComponents` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_bria_video_green_screen.json | 3 |  | `LoadVideo` `SaveVideo` `BriaVideoGreenScreen` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_bria_video_replace_background.json | 4 |  | `BriaVideoReplaceBackground` `LoadVideo` `SaveVideo` `LoadImage` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_elevenlabs_voice_isolation.json | 3 |  | `ElevenLabsAudioIsolation` `LoadAudio` `SaveAudioMP3` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_heygen_avatar_video.json | 4 |  | `HeyGenAvatarVideoNode` `SaveVideo` `ColorToRGBInt` `PreviewAny` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_heygen_video_translate.json | 3 |  | `HeyGenVideoTranslateNode` `LoadVideo` `SaveVideo` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_rodin_multiview_to_model.json | 6 |  | `Rodin3D_Regular` `LoadImage` `Preview3D` `BatchImagesNode` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_topaz_starlight_precise25.json | 3 |  | `LoadVideo` `SaveVideo` `TopazVideoEnhance` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_topaz_video_enhance.json | 3 |  | `TopazVideoEnhance` `LoadVideo` `SaveVideo` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_tripo3_0_image_to_model.json | 7 |  | `TripoImageToModelNode` `LoadImage` `Preview3D` `SaveGLB` `BatchImagesNode` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_tripo3_1_image_to_model.json | 3 |  | `SaveGLB` `LoadImage` `TripoImageToModelNode` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_tripo3_1_multiview_to_model.json | 5 |  | `SaveGLB` `LoadImage` `TripoMultiviewToModelNode` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_tripo_image_to_model.json | 4 |  | `TripoImageToModelNode` `LoadImage` `Preview3D` `SaveGLB` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_tripo_multiview_to_model.json | 5 |  | `TripoMultiviewToModelNode` `LoadImage` `Preview3D` `SaveGLB` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| api_wavespeed_flshvsr_video_upscale.json | 3 |  | `SaveVideo` `LoadVideo` `WavespeedFlashVSRNode` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| basic_image_color_adjustment.json | 69 | Y | `LoadImage` `PreviewImage` `GLSLShader` `PrimitiveFloat` `ColorToRGBInt` `CustomCombo` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| basic_mask_operations_and_compositing.json | 37 |  | `EmptyImage` `PreviewImage` `MaskToImage` `MaskPreview` `ImageToMask` `InvertMask` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| image_lotus_depth_v1_1.json | 14 | Y | `SaveImage` `LoadImage` `VAEDecode` `UNETLoader` `VAELoader` `SamplerCustomAdvanced` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| utility-bria_remove_video_background.json | 3 |  | `BriaRemoveVideoBackground` `LoadVideo` `SaveVideo` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| utility-gan_upscaler.json | 6 |  | `UpscaleModelLoader` `ImageUpscaleWithModel` `LoadVideo` `GetVideoComponents` `CreateVideo` `SaveVideo` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| utility-topaz_landscape_upscaler.json | 5 |  | `TopazImageEnhance` `LoadImage` `SaveImage` `GetImageSize` `ImageScaleBy` | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| utility_birefnet_remove_background.json | 7 | Y | `LoadImage` `PreviewImage` `MaskPreview` `RemoveBackground` `LoadBackgroundRemovalModel` `InvertMask` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| utility_moge_depth_estimation.json | 15 | Y | `LoadImage` `PreviewImage` `MaskPreview` `MoGeInference` `MoGeRender` `LoadMoGeModel` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| utility_sdpose_multi_person.json | 13 | Y | `LoadImage` `SaveImage` `DrawBBoxes` `PreviewImage` `ResizeImageMaskNode` `PrimitiveInt` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |
| utility_video_frame_interpolation.json | 10 | Y | `LoadVideo` `SaveVideo` `FrameInterpolationModelLoader` `FrameInterpolate` `CreateVideo` `PrimitiveInt` … | 图里无任何 text-encode/string 源（纯 API 节点/纯图输入） |

### 5b. 没识别出输出节点（11 张）

| 文件 | 节点数 | subgraph | 图里 class_type（截样） | 推断原因 |
|---|---|---|---|---|
| api_elevenlabs_voice_isolation.json | 3 |  | `ElevenLabsAudioIsolation` `LoadAudio` `SaveAudioMP3` | 输出类名不在识别正则内：`SaveAudioMP3` |
| api_recraft_vector_gen.json | 2 |  | `RecraftTextToVectorNode` `SaveSVGNode` | 输出类名不在识别正则内：`SaveSVGNode` |
| audio_ace_step_1_5_split_llm.json | 15 | Y | `SaveAudioMP3` `PreviewAny` `GeminiNode` `RegexExtract` `DualCLIPLoader` `VAELoader` … | 输出类名不在识别正则内：`SaveAudioMP3` `PreviewAny` |
| audio_ace_step_1_m2m_editing.json | 11 |  | `TextEncodeAceStepAudio` `VAEDecodeAudio` `CheckpointLoaderSimple` `ConditioningZeroOut` `LatentApplyOperationCFG` `LatentOperationTonemapReinhard` … | 输出类名不在识别正则内：`SaveAudioMP3` |
| audio_ace_step_1_t2a_instrumentals.json | 10 |  | `TextEncodeAceStepAudio` `EmptyAceStepLatentAudio` `VAEDecodeAudio` `CheckpointLoaderSimple` `ConditioningZeroOut` `LatentApplyOperationCFG` … | 输出类名不在识别正则内：`SaveAudioMP3` |
| audio_ace_step_1_t2a_song.json | 10 |  | `TextEncodeAceStepAudio` `EmptyAceStepLatentAudio` `VAEDecodeAudio` `CheckpointLoaderSimple` `ConditioningZeroOut` `LatentApplyOperationCFG` … | 输出类名不在识别正则内：`SaveAudioMP3` |
| audio_stable_audio_3_medium.json | 21 | Y | `SaveAudioMP3` `CLIPTextEncode` `VAEDecodeAudio` `EmptyLatentAudio` `KSampler` `CLIPLoader` … | 输出类名不在识别正则内：`SaveAudioMP3` `PreviewAny` |
| audio_stable_audio_3_medium_base.json | 21 | Y | `SaveAudioMP3` `CLIPTextEncode` `VAEDecodeAudio` `EmptyLatentAudio` `KSampler` `CLIPLoader` … | 输出类名不在识别正则内：`SaveAudioMP3` `PreviewAny` |
| audio_stable_audio_example.json | 8 |  | `KSampler` `CheckpointLoaderSimple` `CLIPTextEncode` `CLIPLoader` `EmptyLatentAudio` `VAEDecodeAudio` … | 输出类名不在识别正则内：`SaveAudioMP3` |
| basic_datatype_conversion.json | 20 |  | `PrimitiveStringMultiline` `ComfyNumberConvert` `PreviewAny` `PrimitiveInt` `PrimitiveFloat` `ComfyMathExpression` | 输出类名不在识别正则内：`PreviewAny` |
| gsl_starter_1_2.json | 61 | Y | `LoadImage` `CLIPTextEncode` `CLIPLoader` `ModelSamplingSD3` `VAELoader` `UNETLoader` … | 图里无任何 save/preview/combine 类（可能只到 latent/上传云端就结束） |

## 6. 缺口聚类：哪些 class_type 反复没被认出

### 疑似「提示词源」但没被识别的 class_type（出现次数）

（无）

### 疑似「输出/保存」但没被识别的 class_type（出现次数）

| class_type | 次数 |
|---|---|
| `SaveAudioMP3` | 8 |
| `PreviewAny` | 4 |
| `SaveSVGNode` | 1 |


<!-- ===== AUTO-GENERATED DATA ABOVE · MANUAL ANALYSIS BELOW (preserved across re-runs) ===== -->









## 7. 诊断结论：识别失败的真正根因（不是 254 个各不相同，是 3 类）

把 §5/§6 的散点收敛，识别失败**几乎全部**落在三个可精确修的根因上。诚实说：**当前提示词识别率只有 41%**，看着差，但根因单一、修一处就能大幅拉高。

### 根因 A（最致命）：提示词只认「独立 CLIPTextEncode 节点」，认不出「节点自带的 `prompt` widget」

- **数据**：154 张没识别出提示词的图里，**112 张（73%）其实有一个字符串 `prompt`/`text` widget 就摆在节点上**——其中 **109 张输入键就叫 `prompt`**。剩下 42 张才是真的没文本（3D 建模 / 纯乐器音频 / 抠图 / 掩膜）。
- **谁踩**：**全部云端 API 节点工作流**（`ByteDanceTextToVideoNode.prompt`、`FluxProUltraImageNode.prompt`、`GrokImageNode.prompt`、`GeminiImage2Node.prompt`、`Kling*`、`Runway*`、`Pixverse*`…）——这类图**根本没有 CLIPTextEncode**，提示词直接是 API 节点上的 widget。占官方模板 `api_*` 前缀 221 张的绝大多数。
- **根因位置**：`analyzeComfyWorkflow` 只在 `TEXT_ENCODE_RE.test(classType)`（`electron/catalog/comfyuiWorkflowImport.ts:232` 与 `:240`）分支里收提示词。一个 `prompt` 字符串 widget 若不在 text-encode 类节点上，就只会进 `widgetInputs`（`:238`），永远不会进 `textInputs`，`suggested.promptNodeId` 也就空了。
- **修完效果**：提示词识别率从 **41%（105/259）** 提到约 **84%（217/259）**。

### 根因 B：输出节点正则漏掉一大票常见 Save/Preview 类

- **数据**：36 张没识别出输出，聚类到 8 个 class_type：`SaveGLB`(15) `PreviewImage`(8) `SaveAudioMP3`(8) `Preview3D`(6) `MaskPreview`(5) `PreviewAny`(4) `SaveWEBM`(1) `SaveSVGNode`(1)。
- **重点**：`PreviewImage` **8 张**——大量工作流末端是 `PreviewImage` 而非 `SaveImage`（作者调试时的习惯），这是纯图像工作流，却因为 `IMAGE_OUT_RE = /saveimage/i`（`:62`）只认 `SaveImage` 而整个漏判、连 kind 都定不了。
- **根因位置**：`VIDEO_OUT_RE`/`IMAGE_OUT_RE`（`electron/catalog/comfyuiWorkflowImport.ts:61-62`）+ 判定点 `:248-249`。当前把 `SaveGLB`(3D)/`SaveAudioMP3`(音频)/`SaveWEBM`/`SaveSVGNode` 全漏，也不认 `PreviewImage`/`PreviewAny`/`Preview3D`/`MaskPreview`。

### 根因 C：图/视频输入只认 `LoadImage`，认不出 `LoadVideo`

- **数据**：`LoadVideo` 全语料出现 **52 次**，`LOAD_IMAGE_RE = /loadimage/i`（`:60`）完全不匹配 → 所有「视频编辑 / 视频转视频 / 视频抠像」工作流的**输入视频绑不上**（`imageInputs` 收不到它，`buildImportedWorkflow` 也就没有可注入的媒体入口）。
- **根因位置**：`LOAD_IMAGE_RE`（`:60`）+ 收集点 `:242` + 首帧建议 `findLinkedInputTargetId(["start_image","first_image","first_frame","image"])`（`:254`，键里没有 video 类）。
- 好消息：`LoadImage` 本身零漏判（105 张没首帧的图确认都真没有 LoadImage），A/B 修完 C 是第二梯队。

---

## 8. Top 5 该修（按影响 × 改动小排序，带 file:line）

> 全部集中在 `electron/catalog/comfyuiWorkflowImport.ts`，改的是识别正则 + `analyzeComfyWorkflow` 的收集分支，是**加分支不动既有语义**，风险低。R5 提醒：改前对着真 `/object_info` 的 input 类型再核一遍键名。

| # | 缺口 | 影响面（本语料） | 具体改法（file:line） |
|---|---|---|---|
| **1** | **`prompt`/`text` widget 直接在节点上时收进 `textInputs`** | **+112 张**（41%→84% 提示词识别）；救活**全部云端 API 节点工作流** | `analyzeComfyWorkflow`（`comfyuiWorkflowImport.ts:240`）加一条：`typeof value === "string"` 且 `inputKey ∈ {prompt, positive_prompt, text}` 且值非空非文件名 → 推入 `textInputs`（不要求 `TEXT_ENCODE_RE`）。建议排序 `suggestedPrompt`（`:252-253`）：优先 positive 链命中的，其次「键名叫 prompt 的最长字符串」。注意与 `widgetInputs`（`:238`）去重。 |
| **2** | **输出正则补 `PreviewImage`/`PreviewAny`** | **+12 张**（含 8 张纯图工作流从「无输出」变可导入） | `IMAGE_OUT_RE`（`:62`）改为 `/saveimage|previewimage|previewany/i`。`PreviewAny` 归 image 兜底即可（真实类型由下游 kind 再定）。 |
| **3** | **输出正则补音频/3D/矢量 Save 类** | **+18 张**（`SaveGLB`15 / `SaveAudioMP3`8 / `Preview3D`6 / `SaveWEBM` / `SaveSVGNode`） | 决策点：Nomi 当前 kind 只有 image/video 两档。3D(`SaveGLB`/`Preview3D`)/音频(`SaveAudioMP3`)/矢量(`SaveSVGNode`)**没有对应产物类型**——**建议先只补到「识别得出是输出节点、给明确提示『该工作流产出 3D/音频，Nomi 暂不支持这类产物』」**（D4 诚实标缺口），而不是硬塞进 image。硬塞会让画布拿到一个存不下的产物。 |
| **4** | **媒体输入补 `LoadVideo`** | **+52 处**（视频编辑/视频转视频工作流的输入视频绑得上） | `LOAD_IMAGE_RE`（`:60`）旁边加 `LOAD_VIDEO_RE = /loadvideo/i`；`:242` 收集分支 + `imageInputs` 语义扩成「媒体输入」；`findLinkedInputTargetId`（`:254`）候选键补 `video`/`first_frame`。 |
| **5** | **text-encode 变体的多文本键**（`CLIPTextEncodeFlux` 的 `clip_l`/`t5xxl`；`TextEncodeAceStepAudio` 的 `tags`/`lyrics`） | +~6 张（native flux/音频精修） | `:232`/`:240` 的 `inputKey === "text" || inputKey === "prompt"` 放宽：对 text-encode 类节点，任何**字符串型**输入都可作候选（`clip_l`/`t5xxl`/`tags`/`lyrics`），取最长的当主提示词。 |

**投入产出**：#1+#2 两处小改（都在一个函数里）就把「提示词 41%→84%、输出 86%→~90%」，是最高杠杆。#3 是**产品决策**（3D/音频要不要支持产物类型），不是纯 bug——建议按 D4「明着标缺口」先做诚实提示。#4/#5 补齐视频编辑 + native flux 长尾。

---

## 9. 诚实边界（这份报告不能证明什么）

1. **动态 widget 那 234 张（47%）没测**：`COMFY_DYNAMICCOMBO_V3`/`COMFY_AUTOGROW_V3` 的 `widgets_values` 会随选项展开，本测试的 UI→API 转换器复刻不了这套展开逻辑（复刻它 = 重写半个 litegraph）。这**不代表 Nomi 分析器对它们有问题**——只是本轮没法用官方模板忠实构造这些图。真要覆盖，得靠真 ComfyUI 前端 `graphToPrompt` 导出（需带浏览器跑 litegraph）。**但**：这 234 张里同样大量是 API 节点工作流，根因 A 的修复对它们一样成立。
2. **官方模板 ≠ 社区野图**：官方模板结构相对规范。社区从 civitai/discord 抄来的图更野（自定义节点更多、连线更绕、`Reroute` 满天飞），缺自定义节点率会远高于本测的 1%（本机装了官方全套节点）。缺件对账（§3）的价值在野图上只会更高。
3. **「识别出」≠「导入后真能跑」**：本报告测的是**分析/识别/对账**四个纯函数，没测导入后端到端真生成（那需要下模型、真花额度）。识别对了但绑错 widget、或 `{{request.prompt}}` 注入位置不对，本报告发现不了——那是 E2E 真跑的活（已有 `scripts/comfyui-real-server-verify.mjs` 覆盖单条链路）。

## 10. 复跑方式

```bash
# 前置：真 ComfyUI 跑在 127.0.0.1:8188
TDIR=$(python3 -c "import glob;print(glob.glob('/tmp/comfyui-venv/**/comfyui_workflow_templates_json/templates',recursive=True)[0])")
# ① UI 模板 → API 格式（复刻 Export API：丢 bypass、widget/link 对齐、subgraph 递归展平）
python3 scripts/comfyui-ui-to-api.py "$TDIR" > /tmp/comfy-api-converted.json
# ② 跑分析器报告（用落 main 的真实实现）；忠实度门 /tmp/comfy-fidelity.json 会自动生成（提交真 /prompt 校验）
npx tsx scripts/comfyui-workflow-corpus-report.mjs
```

脚本进仓（`scripts/comfyui-ui-to-api.py` + `scripts/comfyui-workflow-corpus-report.mjs`）。本报告 §0-§6 数据段由脚本自动生成（复跑刷新，标记线以上），§7-§10 为人工分析结论（标记线以下，复跑保留）。
