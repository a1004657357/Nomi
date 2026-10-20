import crypto from "node:crypto";
import fs from "node:fs";
import { contentTypeFromPath, extensionFromMime } from "./assets/assetPaths";
import { localizedTaskAssetFileName } from "./assets/localizedAsset";
import { writeAsset } from "./assets/projectAssetStore";
import { endpoint } from "./vendorEndpoint";
import { requestJson } from "./vendor/vendorHttp";
import { assertLocalAssetTransportReady } from "./catalog/assetLocalization";
import { assetIngestionResolver, assetLocalizationOptions } from "./catalog/assetTransportRuntime";
import { readNomiLocalAsset } from "./assets/localAssetFile";
import { validateProfileRequestBeforeSpend } from "./catalog/profileHttpRequest";
import { chatImageFallbackOperation } from "./catalog/imageRouteFallback";
import { buildNormalizedRecipe, buildTaskProvenance } from "./vendor/provenance";
import { traceVendorCompleted, traceVendorRequested } from "./events/vendorCallTrace";
import { scheduleTechnicalReview } from "./review/reviewTrace";
import {
  type AuthType,
  authHeaders as buildAuthHeaders,
  extractTaskId as extractTaskIdShared,
} from "./ai/requestPipeline";
import { prepareAntigravityCreateOperation } from "./catalog/processOperation";
import { executeTextTask } from "./textTaskRunner";
import { runAudioTask } from "./audioTaskRunner";
import { runCodexImageGeneration } from "./ai/codexImagegenRunner";
import { dispatchWebBridgeTask } from "./webBridge/taskDispatch";
import { firstString, trim, type JsonRecord } from "./jsonUtils";
import { extractAssetUrl } from "./tasks/assetUrlExtract";
import type { GlbValidationReport } from "./assets/glbValidation";
import { TtlLruCache } from "./tasks/taskCache";
import { markTaskAdmitted } from "./tasks/taskAdmission";
import { readCachedTaskResult, recipeFingerprint, rememberTaskResult } from "./vendor/fingerprintCache";
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

// 任务执行复用 catalog 状态（extractVendorExtraHeaders 纯函数）；
// catalogStore 反向复用本文件任务引擎 → 运行期循环引用（CommonJS 安全）。
import { extractVendorExtraHeaders, readCatalog } from "./catalog/catalogStore";

import type { BillingModelKind, Mapping, Model, ProfileKind, Vendor } from "./catalog/types";
import { billingKindForTaskKind } from "./catalog/types";
import { applyHeadlessParamDefaults, imageEditGuardError } from "./catalog/taskParams";
import { CODEX_VENDOR_SEED } from "./catalog/codexImagegen";
import { activeTaskProjectFallback } from "./tasks/activeProjectFallback";
import { modelModeBodies } from "./catalog/modelCatalogListing";
import { runCustomCallTask } from "./catalog/customCallDispatch";
import { resolveCustomCallExecution } from "./catalog/customCallMode";
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
  extras?: Record<string, unknown> & { executionBinding?: import("./productionRun/productionExecutionBinding").ProductionExecutionBinding };
};
export type TaskResult = {
  id: string;
  kind: ProfileKind;
  /**
   * 任务状态。Gate 1 Slice 5 扩展（§10.2）：原先 queued/running/succeeded/failed 四态；
   * 新增 cancelled（独立于 failed）与 unknown（非终态，持续查询、绝不重发 create）。
   * 与 `electron/tasks/responseParsing.ts` 的 `TaskStatus` 同义——该处是权威定义。
   */
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
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
  /** Consecutive unrecognized provider status observations for bounded polling. */
  unrecognizedStatusStreak?: { verb: string; polls: number; firstSeenAt: number };
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
  const { vendor, model, apiKey, customConfig } = findExecutableModel(vendorKey, modelKey, wantedKind);
  const projectId = trim(request.extras?.projectId) || activeTaskProjectFallback();
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
      ) as { id?: string; name?: string; data?: { url?: string; absolutePath?: string } };
      const assetUrl = trim(saved.data?.url);
      if (!assetUrl) throw new Error("Codex Img2 生成成功但资产落盘失败");
      scheduleTechnicalReview({
        projectId,
        nodeId,
        absolutePath: trim(saved.data?.absolutePath),
        assetUrl,
        type: "image",
        expectedAspectRatio: firstString(request.extras?.aspect_ratio, request.extras?.aspectRatio),
      });
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
  const webBridgeResult = await dispatchWebBridgeTask({
    vendor, model, request, wantedKind, projectId, nodeId, grantId, admitTask,
    errors: {
      unsupported: (label) => new Error(`${label} 当前不支持该生成类型`),
      projectRequired: (label) => new Error(`${label} 需要先打开并保存到本地项目后再生成`),
      idempotencyRequired: () => new Error("Pavo Web 真实任务缺少本轮确认标识，已拒绝提交以避免重复扣费"),
      runnerUnavailable: (label, reason) => new Error(`${label} 扩展运行器启动失败：${reason || "扩展客户端没有建立任务连接"}`),
    },
  });
  if (webBridgeResult) return webBridgeResult;
  const mapping = findTaskMapping(vendorKey, kind, modelKey);
  // headless/MCP extras 预备：缺参兜底 + W1d 参考键形态投影（末参 createBody，逻辑/文档住 taskParams.applyHeadlessParamDefaults）；自定义调用脚本存在即接管图/视频/3D（对 L3 护栏算「有 mapping」，参考缺失拒发仍生效，派发抽到 catalog/customCallDispatch，R12）。
  request.extras = applyHeadlessParamDefaults(request.extras, (model?.meta as { archetypeId?: string } | undefined)?.archetypeId, kind, vendorKey, mapping?.create?.defaultParams, mapping?.create?.body, model.modelKey);
  const customCall = resolveCustomCallExecution(model as Model, request, mapping);
  const customCallScript = customCall?.script || "";
  // L3 诚实护栏（判定在 taskParams.imageEditGuardError）：图生图/图生视频缺参考或缺 mapping → 付费守卫前拒发人话，绝不静默退化纯文生。末参 modelModeBodies（该模型所有模式 body）= 交付4：拒发时点名"哪个模式带得动你连的参考"（同套 mapping derive）。
  const guardError = imageEditGuardError(kind, request, Boolean(mapping) || Boolean(customCallScript), model.labelZh || model.modelKey, customCallScript ? undefined : mapping?.create?.body, modelModeBodies(readCatalog().mappings, vendorKey, modelKey, (model as Model).modelAlias), { vendorKey, modelKey: model.modelKey });
  if (guardError) throw new Error(guardError);
  if (customCallScript) // 先于 mapping/fallback；注入避免循环依赖。文本也走这里（去掉 wantedKind!=="text" 排除：那等于「接不上的文本模型毫无出路」，而用户最初踩的正是文本模型）；文本脚本 return { text }
    return runCustomCallTask({ vendor, model, apiKey, customConfig, script: customCallScript, taskKind: customCall!.taskKind, modeId: customCall!.modeId, request, kind, wantedKind, projectId, nodeId, grantId, taskId, localizeTaskAsset, writeAsset });
  // 第四路 audio：没有脚本接管时才走 TTS/Whisper 同步收口（二进制/multipart）。
  if (wantedKind === "audio") {
    assertAndConsumeSpendGrant(grantId, nodeId);
    await waitForVendorSubmissionWindow(vendor.key, wantedKind);
    return runAudioTask({ vendor, model, apiKey, request, kind, taskId, projectId, nodeId, mapping });
  }
  if (mapping) {
    await validateProfileRequestBeforeSpend({ vendor, model, apiKey, request, operation: mapping.create });
    const uploadCatalog = readCatalog();
    if (!mapping.create.multipart && !mapping.create.process) {
      assertLocalAssetTransportReady(
        request.extras,
        assetIngestionResolver(vendor, uploadCatalog),
        readNomiLocalAsset,
        assetLocalizationOptions(request.extras),
      );
    }
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
    const antigravityPreflight = await prepareAntigravityCreateOperation({ vendorKey, modelKey: model.modelKey, taskKind: kind, operation: mapping.create, request });
    assertAndConsumeSpendGrant(grantId, nodeId); // 付费守卫：缓存未命中=真发 vendor，发前校验消费令牌
    // 中转生图路由回退（y7api 403 定案）：OpenAI images 端点被「分组未开通」类确定性拒绝（403 命中
    // 窄短语 / 404/405，未创建任务未扣费）→ 换 chat/completions 多模态 op 重发一次；结果归一按
    // 实际执行的 op 走（chat 同步返回，extractChatImageUrl 兜底解析）。详见 catalog/imageRouteFallback。
    let createOperation = mapping.create; let executed;
    try {
      executed = await executeProfileOperation({ vendor, model, apiKey, request, operation: createOperation, stage: "create", antigravityPreflight, enforceSubmissionRateLimit: true });
    } catch (error) {
      const fallbackOp = chatImageFallbackOperation(error, createOperation, kind);
      if (!fallbackOp) throw error;
      createOperation = fallbackOp;
      executed = await executeProfileOperation({ vendor, model, apiKey, request, operation: createOperation, stage: "create", antigravityPreflight, enforceSubmissionRateLimit: true });
    }
    const normalized = await buildProfileTaskResult({
      response: executed.response,
      mapping,
      operation: createOperation,
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
