// 按 catalog 里的 Vendor/Model 造一个 AI SDK LanguageModelV1。
//
// 单一真相源(P1):对话引擎(agentChatV2)与文本任务引擎(streamTextTask)都从这里取
// 模型构造,不再各写一份「vendor → baseURL/headers → buildAiSdkModel」的拼装。
import type { LanguageModelV1 } from "ai";
import { buildAiSdkModel } from "./buildAiSdkModel";
import { vendorModelConnection } from './vendorModelConnection';
import type { CatalogState, Model, Vendor } from "../catalog/types";
import { readCatalog } from "../catalog/catalogStore";
import { apiKeyDecryptStatus, decryptApiKeyRecord } from "../catalog/secrets";
import { trim } from "../jsonUtils";
import { modelSupportsImageInput } from "./agentUserContent";
import { modelSupportsToolCalls } from "../shared/textModelCapabilities";
export { resolveLanguageModelBaseURL } from './vendorModelConnection';

export function buildLanguageModelForVendor(vendor: Vendor, model: Model, apiKey: string): LanguageModelV1 {
  return buildAiSdkModel(vendorModelConnection(vendor, model, apiKey));
}

// vision/preview/audio 等常不可靠发 tool_use → 无偏好时降权（仍作回退），让通用对话模型优先做 Agent 主控（2026-06-07 真机走查 P0）。
const AUTO_TEXT_MODEL_DEPRIORITIZE = /vision|preview|audio|tts|whisper|embed|rerank|ocr|search|thinking/i;
function autoTextModelPenalty(model: Model): number {
  return AUTO_TEXT_MODEL_DEPRIORITIZE.test(`${model.modelKey} ${model.modelAlias ?? ""}`) ? 1 : 0;
}

function imageInputRank(model: Model): number {
  return modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta) ? 1 : 0;
}

export type TextModelPreference = { modelKey?: string; vendorKey?: string };

function preferenceRank(model: Model, preference: TextModelPreference): number {
  const modelKey = trim(preference.modelKey);
  if (!modelKey) return 0;
  if (model.modelKey !== modelKey) return 2;
  const vendorKey = trim(preference.vendorKey);
  return vendorKey && model.vendorKey !== vendorKey ? 1 : 0;
}

export function orderTextModelsForAgent(
  texts: Model[],
  preference: TextModelPreference = {},
  preferImageInput = false,
): Model[] {
  const modelKey = trim(preference.modelKey);
  if (modelKey) {
    return [...texts].sort((a, b) => preferenceRank(a, preference) - preferenceRank(b, preference));
  }
  if (preferImageInput) return [...texts].sort((a, b) => imageInputRank(b) - imageInputRank(a));
  return [...texts].sort((a, b) => autoTextModelPenalty(a) - autoTextModelPenalty(b));
}

/**
 * Some catalog text entries are asynchronous task profiles rather than
 * chat-completions models (for example APIMart MiniMax H3 Context-IR). Keep
 * those available to the workbench's prompt_refine mapping, but never let the
 * generic Agent route them through /v1/chat/completions.
 */
function isPromptRefineOnlyModel(model: Model): boolean {
  return Boolean(
    model.meta &&
      typeof model.meta === "object" &&
      (model.meta as { promptRefineOnly?: unknown }).promptRefineOnly === true,
  );
}

/**
 * Rank catalog candidates before credentials are resolved. The exact
 * (vendorKey, modelKey) identity always wins; a matching modelKey without a
 * vendor is only a compatibility fallback for old callers. This keeps a
 * same-named model from silently switching providers when the user selected
 * a specific vendor in the picker.
 */
export function selectTextModelCandidates(
  state: CatalogState,
  preference?: TextModelPreference,
  preferImageInput = false,
  requireTools = true,
): Array<{ vendor: Vendor; model: Model }> {
  if (requireTools && preference?.modelKey && state.models.some((model) => model.modelKey === preference.modelKey
    && (!preference.vendorKey || model.vendorKey === preference.vendorKey)
    && !modelSupportsToolCalls(model.meta))) {
    throw new Error("Model does not support assistant tools");
  }
  const texts = state.models.filter(
    (item) => item.kind === "text" && item.enabled && !isPromptRefineOnlyModel(item) && (!requireTools || modelSupportsToolCalls(item.meta)),
  );
  // 有偏好：用户选的排第一（其余作回退）。
  // 无偏好且本轮带图：优先支持图片输入的 text 模型（gpt-4o/claude/gemini 既能看图又擅长 tool_use）。
  // 无偏好无图：不盲选第一个，按「是否像通用对话模型」稳定排序，vision/preview 降到末尾。
  const ordered = orderTextModelsForAgent(texts, preference, preferImageInput);
  return ordered.flatMap((model) => {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey && item.enabled);
    return vendor ? [{ vendor, model }] : [];
  });
}

export function chooseTextModel(
  preference: TextModelPreference = {},
  preferImageInput = false,
  requireTools = true,
): { vendor: Vendor; model: Model; apiKey: string } {
  const state = readCatalog();
  const candidates = selectTextModelCandidates(state, preference, preferImageInput, requireTools);
  for (const { vendor, model } of candidates) {
    const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[model.vendorKey]);
    if (vendor && (vendor.authType === "none" || apiKey)) return { vendor, model, apiKey };
  }
  // 稳定 code 前缀（沿用 electron 侧「专用签名」范式：Model is retired: / Model kind mismatch: …）。
  // 渲染层 classifyGenerationError 按 "no usable text model" 签名归 model-config 报人话，不再原样甩英文散句
  // （2026-08-25 走查：旧散句「No local text model is configured…」落进 unknown 分类，被原串直通给用户）。
  throw new Error("Model is not configured: no usable text model. Open model settings and add an API key.");
}

/**
 * 解析默认文本大脑的 vendor/model 键（**不含 apiKey**,供渲染层经现成文本流式管线复用——
 * 提示词优化与创作助手用同一个脑,P4 通用）。拿不到(没配文本模型)返回 null。
 */
export function resolveTextBrainKeys(): { vendor: string; modelKey: string } | null {
  try {
    const { vendor, model } = chooseTextModel();
    return { vendor: vendor.key, modelKey: model.modelKey };
  } catch {
    return null;
  }
}

/**
 * 文本大脑可用性的**三态**（不只是 bool）——供上手清单/恢复卡/库页状态条把「读不出」和「没配」说清楚。
 *   · ok     ：解得出一个可用大脑（返回它的 vendor/modelKey）。
 *   · locked ：有 enabled 的 text 模型、但候选的 key 记录**在**却当前宿主身份解不开（safeStorage 解密失败）——
 *              这与「没配」天差地别：该去模型设置**重新粘贴** Key，而不是去接一个新模型。
 *   · missing：连一个 enabled 的可用候选都没有（真没配文本模型）。
 *
 * 判据全部复用既有单一真相源（chooseTextModel 的候选选择 + secrets.apiKeyDecryptStatus），不另造探测（P1）。
 */
export function resolveTextBrainStatus():
  | ReturnType<typeof import('./textBrainResolver').resolveTextBrainStatus>
  | { status: 'locked' } {
  const brain = resolveTextBrainKeys();
  if (brain) return { status: "ok", brain };
  // 没解出大脑：区分「有候选但都 locked」与「压根没候选」。
  const state = readCatalog();
  const candidates = selectTextModelCandidates(state);
  const anyLocked = candidates.some(({ vendor }) => {
    if (vendor.authType === "none") return false; // 本地后端不需要 key，不会 locked
    return apiKeyDecryptStatus(state.apiKeysByVendor[vendor.key]) === "locked";
  });
  return { status: anyLocked ? "locked" : "missing" };
}
