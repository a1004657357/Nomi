// 按 catalog 里的 Vendor/Model 造一个 AI SDK LanguageModelV1。
//
// 单一真相源(P1):对话引擎(agentChatV2)与文本任务引擎(streamTextTask)都从这里取
// 模型构造,不再各写一份「vendor → baseURL/headers → buildAiSdkModel」的拼装。
import type { LanguageModelV1 } from "ai";
import { buildAiSdkModel } from "./buildAiSdkModel";
import { endpoint } from "../vendorEndpoint";
import { extractVendorExtraHeaders, normalizeProviderKind } from "../catalog/catalogStore";
import type { Model, Vendor } from "../catalog/types";

function readOpenAiCompatibleBasePath(vendor: Vendor): string {
  const meta = vendor.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "/v1";
  const raw = (meta as Record<string, unknown>).openAiCompatibleBasePath;
  if (typeof raw !== "string") return "/v1";
  return raw.trim();
}

export function resolveLanguageModelBaseURL(vendor: Vendor): string {
  const providerKind = normalizeProviderKind(vendor.providerKind);
  if (providerKind === "anthropic") return (vendor.baseUrlHint || "").trim();
  const basePath = readOpenAiCompatibleBasePath(vendor);
  if (!basePath) return (vendor.baseUrlHint || "").trim().replace(/\/+$/, "");
  return endpoint(vendor, basePath.startsWith("/") ? basePath : `/${basePath}`);
}

export function buildLanguageModelForVendor(vendor: Vendor, model: Model, apiKey: string): LanguageModelV1 {
  const providerKind = normalizeProviderKind(vendor.providerKind);
  const baseURL = resolveLanguageModelBaseURL(vendor);
  const headers = extractVendorExtraHeaders(vendor);
  return buildAiSdkModel({
    kind: providerKind,
    baseURL,
    apiKey,
    modelId: model.modelAlias || model.modelKey,
    ...(headers ? { headers } : {}),
  });
}
