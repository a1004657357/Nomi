import crypto from "node:crypto";
import fs from "node:fs";
import { contentTypeFromPath, extensionFromMime } from "./assets/assetPaths";
import { localizedTaskAssetFileName } from "./assets/localizedAsset";
import { writeAsset } from "./assets/projectAssetStore";
import { endpoint } from "./vendorEndpoint";
import { requestJson, requestMultipart } from "./vendor/vendorHttp";
import { runMultipartProfileOperation } from "./catalog/multipartOperation";
import { templateContext, buildProfileHttpRequest } from "./catalog/profileHttpRequest";
import { chatImageFallbackOperation } from "./catalog/imageRouteFallback";
import { buildNormalizedRecipe, buildTaskProvenance } from "./vendor/provenance";
import { traceVendorCompleted, traceVendorRequested } from "./events/vendorCallTrace";
import {
  type AuthType,
  authHeaders as buildAuthHeaders,
  extractTaskId as extractTaskIdShared,
} from "./ai/requestPipeline";
import { executeTextTask } from "./textTaskRunner";
import { runAudioTask } from "./audioTaskRunner";
import { runCodexImageGeneration } from "./ai/codexImagegenRunner";
import { submitJimengWebTask } from "./jimengWeb/seedanceBridge";
import { jimengWebStartRunner } from "./jimengWeb/runner";
import { firstString, trim, type JsonRecord } from "./jsonUtils";
import { extractAssetUrl } from "./tasks/assetUrlExtract";
import type { GlbValidationReport } from "./assets/glbValidation";
import { TtlLruCache } from "./tasks/taskCache";
import { markTaskAdmitted } from "./tasks/taskAdmission";
import { readCachedTaskResult, recipeFingerprint, rememberTaskResult } from "./vendor/fingerprintCache";
import { decryptApiKeyRecord } from "./catalog/secrets";
import {
  createProject,
  deleteProject,
  listProjects,
  readProject,
  resolveProjectRelativePath,
  saveProject,
} from "./projects/repository";
// 公共 API：main.ts 仍从 "./runtime" 消费这些 —— re-export 保持其 import 不变。
export { createProject, deleteProject, listProjects, readProject, resolveProjectRelativePath, saveProject };
export { importRemoteAsset, listProjectAssets, moveAssetFile, writeAsset } from "./assets/projectAssetStore";
// localizedTaskAssetFileName 已抽到 ./assets/localizedAsset（规则 9/12 减负 giant shell）；re-export 保持既有 import（含 runtime.assets.test）不变。
export { localizedTaskAssetFileName };

// 任务执行复用 catalog 状态（readCatalog + extractVendorExtraHeaders 纯函数）；
// catalogStore 反向复用本文件任务引擎 → 运行期循环引用（CommonJS 安全）。
import { extractVendorExtraHeaders, readCatalog } from "./catalog/catalogStore";

import type { BillingModelKind, Mapping, Model, ProfileKind, Vendor } from "./catalog/types";
import { billingKindForTaskKind, selectExecutableModel } from "./catalog/types";
import { applyHeadlessParamDefaults, imageEditGuardError } from "./catalog/taskParams";
import { CODEX_VENDOR_SEED } from "./catalog/codexImagegen";
import { JIMENG_WEB_VENDOR_SEED } from "./catalog/jimengWeb";
import { assertAndConsumeSpendGrant } from "./spendGrant";
import { waitForVendorSubmissionWindow } from "./vendorSubmissionRateLimiter";
import {
  buildProfileTaskResult,
  executeProfileOperation,
  findTaskMapping,
  localizeTaskAsset,
} from "./tasks/profileTaskExecution";
export {
  buildProfileHttpRequest,
  buildProfileTaskResult,
  executeProfileOperation,
  findTaskMapping,
  localizeTaskAsset,
} from "./tasks/profileTaskExecution";
export type {
  AiSdkProviderKind,
  BillingModelKind,
  CatalogState,
  CatalogVersion,
  HttpOperation,
  Mapping,
  Model,
  ProfileKind,
  Vendor,
} from "./catalog/types";

// ── 巨壳拆分：子模块再导出，main.ts/测试仍从 "./runtime" 消费这些符号（API 不破） ──
export {
  startExportJob,
  getExportJobStatus,
  cancelExportJob,
  writeExportTempInput,
  finishExportTempInput,
  subscribeExportJobEvents,
  startTimelineMp4Export,
  showExportInFolder,
} from "./export/exportJobs";
export {
  ensureBuiltinModelSeeds,
  normalizeProviderKind,
  listModelCatalogVendors,
  listModelCatalogModels,
  listModelCatalogMappings,
  resolveOnboardingAgentFromCatalog,
  getModelCatalogHealth,
  upsertModelCatalogVendor,
  deleteModelCatalogVendor,
  upsertModelCatalogVendorApiKey,
  clearModelCatalogVendorApiKey,
  upsertModelCatalogModel,
  deleteModelCatalogModel,
  upsertModelCatalogMapping,
  deleteModelCatalogMapping,
  exportModelCatalogPackage,
  importModelCatalogPackage,
  extractVendorExtraHeaders,
} from "./catalog/catalogStore";
export {
  commitOnboardedModelToCatalog,
  deriveVendorKeyFromBaseUrl,
  commitManualOpenAiCompatibleModels,
  fetchModelCatalogDocs,
  testModelCatalogMapping,
} from "./catalog/catalogCommit";
export { runAgentChatV2, clearAgentChatV2History } from "./ai/agentChatV2";
export type {
  AgentToolName,
  AgentChatV2Event,
  AgentToolConfirmation,
  AgentChatV2Hooks,
  RunAgentChatV2Payload,
} from "./ai/agentChatV2";

export type TaskRequest = {
  kind: ProfileKind;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  extras?: Record<string, unknown>;
};

export type TaskResult = {
  id: string;
  kind: ProfileKind;
  status: "queued" | "running" | "succeeded" | "failed";
  assets: Array<{
    type: "image" | "video" | "audio" | "model3d";
    url: string;
    thumbnailUrl?: string | null;
    assetId?: string | null;
    assetRefId?: string | null;
    assetName?: string | null;
    model3dValidation?: GlbValidationReport;
    /** 原始 CDN URL（https://...）。供后续生成直接用，无需上传。可能过期，过期后退回本地字节。 */
    providerUrl?: string | null;
    durationSeconds?: number;
  }>;
  raw: unknown;
  /** failed 时的上游真实原因（tasks/responseParsing.taskFailureMessageFromResponse 取；渲染层只读这一处）。 */
  error?: string;
  /**
   * E11: Complete provenance for reproducibility. Populated on successful
   * generation. Renderer copies this into GenerationNodeResult.provenance.
   */
  provenance?: {
    provider?: string;
    modelKey?: string;
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    params?: Record<string, unknown>;
    vendorRequestId?: string;
    timestamp: number;
  };
};

// TTL(1h) + LRU(200) 上限，防异步任务条目无界驻留（P0-7）。不再缓存明文 apiKey。
export const taskCache = new TtlLruCache<CachedTask>({ maxEntries: 200, ttlMs: 60 * 60 * 1000 });

/** 受理一个异步任务：写工作缓存 + 记账本（单一入口，所有 admit 点同源，防漏记）。 */
export function admitTask(id: string, entry: CachedTask): void {
  taskCache.set(id, entry);
  markTaskAdmitted(id);
}

export type CachedTask = {
  vendor: string;
  request: TaskRequest;
  raw: unknown;
  mapping?: Mapping | null;
  model?: Model;
  providerMeta?: JsonRecord;
  projectId?: string;
  nodeId?: string;
  wantedKind?: BillingModelKind;
  /** S8 指纹:异步任务终态成功时写回指纹缓存用。 */
  fingerprint?: string;
};

// 可执行模型解析下沉到 catalog/executableModel（R12 净减）；re-export 保住 textTaskRunner/taskResultQuery 既有 import 面。
export { findExecutableModel, findExecutableModelForTask } from "./catalog/executableModel";
import { findExecutableModel } from "./catalog/executableModel";

// Thin Vendor→primitive adapters over the shared requestPipeline auth logic
// (the shared module is electron-free and doesn't know the Vendor shape).
function authHeaders(vendor: Vendor, apiKey: string): Record<string, string> {
  return buildAuthHeaders(vendor.authType as AuthType, apiKey, vendor.authHeader ?? undefined);
}

// endpoint() 已抽到 electron/vendorEndpoint.ts（纯函数，便于无 electron 的单测）

// billingKindForTaskKind 下沉到 catalog/types（R12 净减）；re-export 保住既有消费方 import 面。
export { billingKindForTaskKind } from "./catalog/types";
export { extractAssetUrl } from "./tasks/assetUrlExtract";

export async function runTask(payload: unknown): Promise<TaskResult> {
  const raw = payload as { vendor?: string; request?: TaskRequest };
  const vendorKey = trim(raw.vendor);
  const request = raw.request;
  if (!vendorKey || !request) throw new Error("vendor and request are required");
  const kind = request.kind;
  const wantedKind = billingKindForTaskKind(kind);
  const modelKey = firstString(request.extras?.modelKey, request.extras?.modelAlias);
  const { vendor, model, apiKey } = findExecutableModel(vendorKey, modelKey, wantedKind);
  const projectId = trim(request.extras?.projectId);
  const nodeId = trim(request.extras?.nodeId);
  const grantId = trim(request.extras?.grantId);
  const taskId = `task-${crypto.randomUUID()}`;
  if (vendor.key === CODEX_VENDOR_SEED.key) {
    if (wantedKind !== "image") throw new Error("Codex Img2 只支持图片生成");
    if (!projectId) throw new Error("Codex Img2 需要先打开并保存到本地项目后再生成");
    const recipe = buildNormalizedRecipe({ vendor, model, request });
    const fingerprint = recipeFingerprint(recipe);
    const cachedHit = readCachedTaskResult({ projectId, fingerprint, nodeId, extras: request.extras });
    if (cachedHit) return cachedHit as TaskResult;
    assertAndConsumeSpendGrant(grantId, nodeId);
    const runtimeStartedAt = Date.now();
    const generated = await runCodexImageGeneration({ request });
    try {
      const assetWriteStartedAt = Date.now();
      const contentType = contentTypeFromPath(generated.outputPath);
      const ext = extensionFromMime(contentType, "png");
      const saved = writeAsset(
        projectId,
        fs.readFileSync(generated.outputPath),
        `codex-img2-${Date.now()}.${ext}`,
        contentType,
        {
          kind: "generated",
          generator: "codex-img2",
          originalPath: generated.outputPath,
          ownerNodeId: nodeId || null,
          codexThreadId: generated.threadId || null,
        },
      ) as { id?: string; name?: string; data?: { url?: string } };
      const assetUrl = trim(saved.data?.url);
      if (!assetUrl) throw new Error("Codex Img2 生成成功但资产落盘失败");
      const timings = {
        ...generated.timings,
        assetWriteMs: Date.now() - assetWriteStartedAt,
        runtimeTotalMs: Date.now() - runtimeStartedAt,
      };
      const runId = generated.threadId || taskId;
      const asset: TaskResult["assets"][number] = {
        type: "image",
        url: assetUrl,
        thumbnailUrl: assetUrl,
        assetId: saved.id || null,
        assetName: saved.name || null,
      };
      const finalResult: TaskResult = {
        id: runId,
        kind,
        status: "succeeded",
        assets: [asset],
        raw: { codex: { threadId: generated.threadId || null, lastMessage: generated.lastMessage, timings } },
        provenance: buildTaskProvenance({ vendor, model, request, vendorRequestId: runId }),
      };
      traceVendorRequested(projectId, { runId, nodeId, recipe });
      traceVendorCompleted(projectId, { runId, nodeId, status: "succeeded", assetCount: 1 });
      rememberTaskResult(projectId, fingerprint, finalResult);
      console.info("[nomi:codex-img2]", JSON.stringify({ runId, nodeId, timings }));
      return finalResult;
    } finally {
      try {
        fs.rmSync(generated.tempDir, { recursive: true, force: true });
      } catch {
        /* non-fatal cleanup */
      }
    }
  }
  if (vendor.key === JIMENG_WEB_VENDOR_SEED.key) {
    if (wantedKind !== "video" && wantedKind !== "image") {
      throw new Error("即梦 Web 目前只支持图片和视频生成");
    }
    if (!projectId) throw new Error("即梦 Web 需要先打开并保存到本地项目后再生成");
    const recipe = buildNormalizedRecipe({ vendor, model, request });
    const fingerprint = recipeFingerprint(recipe);
    const cachedHit = readCachedTaskResult({ projectId, fingerprint, nodeId, extras: request.extras });
    if (cachedHit) return cachedHit as TaskResult;
    const runner = await jimengWebStartRunner(vendor.baseUrlHint);
    if (!runner.clientOnline) {
      throw new Error(`即梦 Web 扩展运行器启动失败：${runner.error || "扩展客户端没有建立任务连接"}`);
    }
    assertAndConsumeSpendGrant(grantId, nodeId);
    const submitted = await submitJimengWebTask({ request, vendorBaseUrl: vendor.baseUrlHint });
    const queued: TaskResult = {
      id: submitted.taskCode,
      kind,
      status: "queued",
      assets: [],
      raw: {
        jimengWeb: {
          taskCode: submitted.taskCode,
          serverUrl: submitted.serverUrl,
          payload: submitted.payload,
          submit: submitted.raw,
        },
      },
    };
    traceVendorRequested(projectId, { runId: submitted.taskCode, nodeId, recipe });
    admitTask(submitted.taskCode, {
      vendor: vendorKey,
      request,
      raw: queued.raw,
      mapping: null,
      model,
      providerMeta: { task_id: submitted.taskCode, taskCode: submitted.taskCode, serverUrl: submitted.serverUrl },
      projectId,
      nodeId,
      wantedKind,
      fingerprint,
    });
    return queued;
  }
  const mapping = findTaskMapping(vendorKey, kind, modelKey);
  request.extras = applyHeadlessParamDefaults(
    request.extras,
    (model?.meta as { archetypeId?: string } | undefined)?.archetypeId,
    kind,
    vendorKey,
    mapping?.create?.defaultParams,
  ); // headless 缺参兜底(档案默认+mapping)
  // L3 诚实护栏：图生图/图生视频缺参考或缺 mapping → 付费守卫之前拒发人话，绝不静默退化纯文生（判定在 taskParams.imageEditGuardError）。
  const guardError = imageEditGuardError(kind, request, Boolean(mapping), model.labelZh || model.modelKey, mapping?.create?.body);
  if (guardError) throw new Error(guardError);
  // 第四路 audio：TTS/Whisper 同步收口（二进制/multipart）。付费守卫：必发 vendor，进来即校验消费令牌。
  if (wantedKind === "audio") {
    assertAndConsumeSpendGrant(grantId, nodeId);
    await waitForVendorSubmissionWindow(vendor.key, wantedKind);
    return runAudioTask({ vendor, model, apiKey, request, kind, taskId, projectId, nodeId, mapping });
  }
  if (mapping) {
    // S8 指纹缓存:同配方(参数没动)秒回上次成功结果,零 vendor 调用;强制重跑经 extras.forceRerun 绕读。
    const recipe = buildNormalizedRecipe({
      vendor,
      model,
      mappingId: trim((mapping as unknown as JsonRecord).id),
      request,
    });
    const fingerprint = recipeFingerprint(recipe);
    const cachedHit = readCachedTaskResult({ projectId, fingerprint, nodeId, extras: request.extras });
    if (cachedHit) return cachedHit as TaskResult;
    assertAndConsumeSpendGrant(grantId, nodeId); // 付费守卫：缓存未命中=真发 vendor，发前校验消费令牌
    const executed = await executeProfileOperation({
      vendor,
      model,
      apiKey,
      request,
      operation: mapping.create,
      enforceSubmissionRateLimit: true,
    });
    const normalized = await buildProfileTaskResult({
      response: executed.response,
      mapping,
      operation: mapping.create,
      request,
      taskIdFallback: taskId,
      wantedKind,
      projectId,
      nodeId,
      vendor,
      model,
      operationTimings: executed.timings,
    });
    traceVendorRequested(projectId, { runId: normalized.result.id, nodeId, recipe });
    if (["succeeded", "failed"].includes(normalized.result.status)) {
      traceVendorCompleted(projectId, {
        runId: normalized.result.id,
        nodeId,
        status: normalized.result.status as "succeeded" | "failed",
        assetCount: normalized.result.assets.length,
      });
      rememberTaskResult(projectId, fingerprint, normalized.result);
    }
    if (!["succeeded", "failed"].includes(normalized.result.status)) {
      admitTask(normalized.result.id, {
        vendor: vendorKey,
        request,
        raw: executed.response,
        mapping,
        model,
        providerMeta: normalized.providerMeta,
        projectId,
        nodeId,
        wantedKind,
        fingerprint,
      });
    }
    return normalized.result;
  }

  // 路径 B 文本任务走 AI SDK（引擎在 textTaskRunner）；逐字流式由 runTextTaskStream 消费。
  if (wantedKind === "text") {
    await waitForVendorSubmissionWindow(vendor.key, wantedKind);
    return executeTextTask({ vendor, model, apiKey, kind, request, taskId });
  }

  const suffix = wantedKind === "video" ? "/v1/videos/generations" : "/v1/images/generations";
  // S8 指纹缓存(fallback 路径同语义)。
  const fallbackRecipe = buildNormalizedRecipe({ vendor, model, request });
  const fallbackFingerprint = recipeFingerprint(fallbackRecipe);
  const fallbackHit = readCachedTaskResult({
    projectId,
    fingerprint: fallbackFingerprint,
    nodeId,
    extras: request.extras,
  });
  if (fallbackHit) return fallbackHit as TaskResult;
  assertAndConsumeSpendGrant(grantId, nodeId); // 付费守卫：fallback 缓存未命中=真发 vendor，发前校验
  await waitForVendorSubmissionWindow(vendor.key, wantedKind);
  // 与 profile 路径同源走 requestJson（单一真相）：错误在抛出那刻即为结构化
  // VendorRequestError（401→auth/402→balance 查表），不再裸 Error 让下游正则反猜（修 #1）；
  // extraHeaders（网关头）也一并带上，与 profile 路径一致（修 #2 的 fallback 分支）。
  const fallbackExtraHeaders = extractVendorExtraHeaders(vendor);
  const fallbackHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(vendor, apiKey),
    ...(fallbackExtraHeaders || {}),
  };
  const providerResponse = await requestJson(
    vendor,
    apiKey,
    "POST",
    endpoint(vendor, suffix),
    fallbackHeaders,
    {},
    {
      model: model.modelAlias || model.modelKey,
      prompt: request.prompt,
      size: request.width && request.height ? `${request.width}x${request.height}` : undefined,
      seed: request.seed,
      n: 1,
      response_format: "url",
      extras: request.extras,
    },
  );
  const assetUrl = extractAssetUrl(providerResponse);
  const upstreamTaskId = extractTaskIdShared(providerResponse) || taskId;
  traceVendorRequested(projectId, { runId: upstreamTaskId, nodeId, recipe: fallbackRecipe });
  if (!assetUrl) {
    admitTask(upstreamTaskId, {
      vendor: vendorKey,
      request,
      raw: providerResponse,
      model,
      projectId,
      nodeId,
      wantedKind,
      fingerprint: fallbackFingerprint,
    });
    return { id: upstreamTaskId, kind, status: "queued", assets: [], raw: providerResponse };
  }
  const type: "image" | "video" | "model3d" =
    wantedKind === "video" ? "video" : wantedKind === "model3d" ? "model3d" : "image";
  const asset: TaskResult["assets"][number] = projectId
    ? await localizeTaskAsset(projectId, assetUrl, type, nodeId, vendor)
    : { type, url: assetUrl, thumbnailUrl: type === "image" ? assetUrl : null };
  // E11 provenance + S4-1 终态事件:与 profile 路径共用 vendor/provenance 模块(单一真相)。
  const provenance = buildTaskProvenance({ vendor, model, request, vendorRequestId: upstreamTaskId });
  traceVendorCompleted(projectId, { runId: upstreamTaskId, nodeId, status: "succeeded", assetCount: 1 });
  const finalResult: TaskResult = {
    id: upstreamTaskId,
    kind,
    status: "succeeded",
    assets: [asset],
    raw: providerResponse,
    provenance,
  };
  rememberTaskResult(projectId, fallbackFingerprint, finalResult);
  return finalResult;
}

// 异步任务「续查」已拆到 ./tasks/taskResultQuery（巨壳门岗·只减不增 R12）。
// 该模块从本文件取 executeProfileOperation/buildProfileTaskResult/findExecutableModel/findTaskMapping/
// extractAssetUrl/localizeTaskAsset/admitTask/taskCache（调用时循环依赖，安全）。对外导出面不变。
export { fetchTaskResult } from "./tasks/taskResultQuery";
