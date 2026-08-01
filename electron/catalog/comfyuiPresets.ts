// ComfyUI 预置模板（S5 拍板欠账 · 2026-08-01 用户拍板「做，带缺件闸」）。
//
// 内容忠实转自 Comfy-Org/workflow_templates 官方模板 `03_video_wan2_2_14B_i2v_subgraphed.json`
// （UI 格式 subgraph → 平铺 API 格式；节点 id 沿用官方模板内部 id 便于对照）：
//   · 连线：逐条对照模板 links 表（origin/target/slot）转写；
//   · 输入字段名：逐类核对 ComfyUI 源码 INPUT_TYPES（nodes.py / nodes_wan.py / nodes_video.py /
//     nodes_model_advanced.py，HEAD 2026-08-01）——不凭 widgets 顺序猜（R5）；
//   · 官方默认 = 4 步 lightx2v LoRA 加速版（KSamplerAdvanced 高/低噪各 4 步、cfg 1、split 0-2/2-4）。
// 模型清单（文件名/目录/下载链接）同样来自官方模板内嵌 MarkdownNote 的 HuggingFace 链接。
//
// 缺件闸：启用前用 Tier-1 的 reconcile（/object_info 对账）验缺节点/缺模型，缺件不给启用——
// 预置模板绝不能「开箱即炸」（docs/plan/2026-08-01-comfyui-tier1-objectinfo-reconcile.md）。
// 启用 = 走既有 importComfyWorkflowToCatalog 落成用户自有 model+mapping（P1 复用整条导入链，零新持久化）。
import { NUMERIC_LABEL, type WorkflowBinding } from "./comfyuiWorkflowImport";
import { COMFY_NEGATIVE_LABEL } from "./comfyuiLocal";

export type ComfyPresetModelFile = {
  /** ComfyUI 里的文件名（= 图中 combo 值，缺件对账的对账键）。 */
  file: string;
  /** 相对 ComfyUI/models/ 的目标目录。 */
  dir: string;
  /** 官方下载链接（模板 MarkdownNote 原链）。 */
  url: string;
};

export type ComfyuiPreset = {
  key: string;
  labelZh: string;
  /** 一句话说明（分辨率/时长/加速形态）。 */
  descZh: string;
  /** API 格式官方图原文（不带 {{}}——占位注入由 buildImportedWorkflow 按 binding 做，与手动导入同链）。 */
  workflowText: string;
  binding: WorkflowBinding;
  models: ComfyPresetModelFile[];
};

const WAN22_I2V_GRAPH = {
  "97": { class_type: "LoadImage", inputs: { image: "start.png" } },
  "105": { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" } },
  "106": { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" } },
  "107": {
    class_type: "CLIPTextEncode",
    _meta: { title: "Positive Prompt" },
    inputs: { text: "A felt-style little eagle cashier greeting, waving, and smiling at the camera.", clip: ["105", 0] },
  },
  "125": {
    class_type: "CLIPTextEncode",
    _meta: { title: "Negative Prompt" },
    inputs: { text: "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走", clip: ["105", 0] },
  },
  "122": { class_type: "UNETLoader", inputs: { unet_name: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", weight_dtype: "default" } },
  "123": { class_type: "UNETLoader", inputs: { unet_name: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", weight_dtype: "default" } },
  "126": { class_type: "LoraLoaderModelOnly", inputs: { model: ["122", 0], lora_name: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", strength_model: 1 } },
  "127": { class_type: "LoraLoaderModelOnly", inputs: { model: ["123", 0], lora_name: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors", strength_model: 1 } },
  "109": { class_type: "ModelSamplingSD3", inputs: { model: ["126", 0], shift: 5 } },
  "124": { class_type: "ModelSamplingSD3", inputs: { model: ["127", 0], shift: 5 } },
  "128": {
    class_type: "WanImageToVideo",
    inputs: { positive: ["107", 0], negative: ["125", 0], vae: ["106", 0], start_image: ["97", 0], width: 720, height: 720, length: 81, batch_size: 1 },
  },
  "110": {
    class_type: "KSamplerAdvanced",
    _meta: { title: "KSampler (high noise)" },
    inputs: {
      model: ["109", 0], add_noise: "enable", noise_seed: 0, steps: 4, cfg: 1,
      sampler_name: "euler", scheduler: "simple",
      positive: ["128", 0], negative: ["128", 1], latent_image: ["128", 2],
      start_at_step: 0, end_at_step: 2, return_with_leftover_noise: "enable",
    },
  },
  "111": {
    class_type: "KSamplerAdvanced",
    _meta: { title: "KSampler (low noise)" },
    inputs: {
      model: ["124", 0], add_noise: "disable", noise_seed: 0, steps: 4, cfg: 1,
      sampler_name: "euler", scheduler: "simple",
      positive: ["128", 0], negative: ["128", 1], latent_image: ["110", 0],
      start_at_step: 2, end_at_step: 4, return_with_leftover_noise: "disable",
    },
  },
  "129": { class_type: "VAEDecode", inputs: { samples: ["111", 0], vae: ["106", 0] } },
  "117": { class_type: "CreateVideo", inputs: { images: ["129", 0], fps: 16 } },
  "108": { class_type: "SaveVideo", inputs: { video: ["117", 0], filename_prefix: "video/Wan2.2_image_to_video", format: "auto", codec: "auto" } },
} as const;

const HF_WAN22 = "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files";
const HF_WAN21 = "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files";

export const WAN22_I2V_PRESET: ComfyuiPreset = {
  key: "wan22-i2v-14b",
  labelZh: "WAN2.2 图生视频 · 14B",
  descZh: "官方模板 · 4 步 LoRA 加速版 · 720×720 · 81 帧(16fps≈5s)",
  workflowText: JSON.stringify(WAN22_I2V_GRAPH, null, 2),
  binding: {
    promptNodeId: "107", promptInputKey: "text",
    firstFrameNodeId: "97", firstFrameInputKey: "image",
    outputNodeId: "108", outputKind: "video",
    // 标签复用既有单源（NUMERIC_LABEL / COMFY_NEGATIVE_LABEL），不新增 i18n 字面量。
    params: [
      { nodeId: "128", inputKey: "width", paramKey: "comfy_width", label: NUMERIC_LABEL.width, type: "number", default: 720 },
      { nodeId: "128", inputKey: "height", paramKey: "comfy_height", label: NUMERIC_LABEL.height, type: "number", default: 720 },
      { nodeId: "128", inputKey: "length", paramKey: "comfy_length", label: NUMERIC_LABEL.length, type: "number", default: 81 },
      { nodeId: "110", inputKey: "noise_seed", paramKey: "comfy_seed", label: NUMERIC_LABEL.seed, type: "number", default: 0 },
      { nodeId: "125", inputKey: "text", paramKey: "comfy_negative", label: COMFY_NEGATIVE_LABEL, type: "text", default: WAN22_I2V_GRAPH["125"].inputs.text },
    ],
  },
  models: [
    { file: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", dir: "diffusion_models", url: `${HF_WAN22}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` },
    { file: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", dir: "diffusion_models", url: `${HF_WAN22}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` },
    { file: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", dir: "loras", url: `${HF_WAN22}/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` },
    { file: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors", dir: "loras", url: `${HF_WAN22}/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors` },
    { file: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", dir: "text_encoders", url: `${HF_WAN21}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` },
    { file: "wan_2.1_vae.safetensors", dir: "vae", url: `${HF_WAN22}/vae/wan_2.1_vae.safetensors` },
  ],
};

export const COMFYUI_PRESETS: ComfyuiPreset[] = [WAN22_I2V_PRESET];

/** IPC 出口（renderer 侧展示 + 启用用）。纯静态数据，同步返回。 */
export function listComfyuiPresets(): ComfyuiPreset[] {
  return COMFYUI_PRESETS;
}
