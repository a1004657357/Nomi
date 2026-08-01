import {
  localizeAssetsForVendor,
  resolveAssetIngestionWithFallback,
  trustedLocalOutputOrigin,
} from "../catalog/assetLocalization";
import { readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload } from "../assets/localAssetFile";
import { localizedTaskAssetFileName, probeLocalizedDurationSeconds } from "../assets/localizedAsset";
import type { GlbValidationReport } from "../assets/glbValidation";
import { importRemoteAsset, writeAsset } from "../assets/projectAssetStore";
import { requestJson, requestMultipart } from "../vendor/vendorHttp";
import { buildTaskProvenance } from "../vendor/provenance";
import { scheduleTechnicalReview } from "../review/reviewTrace";
import { type AuthType, buildHttpRequest, buildTemplateContext, extractTaskId } from "../ai/requestPipeline";
import { executeProcessOperation } from "../catalog/processOperation";
import { firstString, isJsonRecord, trim, type JsonRecord } from "../jsonUtils";
import {
  collectAssetUrls,
  firstMappedString,
  providerMetaFromResponse,
  taskStatusFromResponse,
  valuesFromMapping,
} from "./responseParsing";
import { extractAssetUrl } from "./assetUrlExtract";
import { applyResponseTransform } from "./responseTransforms";
import { applyRequestTransform } from "./requestTransforms";
import { runMultipartProfileOperation } from "../catalog/multipartOperation";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { extractVendorExtraHeaders, readCatalog } from "../catalog/catalogStore";
import { assertAgnesPublicImageReachable, isAgnesImageToVideoRequest } from "../catalog/agnesPublicAssetProbe";
import type { BillingModelKind, HttpOperation, Mapping, Model, Vendor } from "../catalog/types";
import { billingKindForTaskKind, selectTaskMapping } from "../catalog/types";
import { firstReferenceImage, taskTemplateParams } from "../catalog/taskParams";
import { applyParamMap, type ParamMap } from "../catalog/paramTranslate";
import { waitForVendorSubmissionWindow } from "../vendorSubmissionRateLimiter";
import type { TaskRequest, TaskResult } from "../runtime";

export async function localizeTaskAsset(
  projectId: string,
  assetUrl: string,
  type: "image" | "video" | "audio" | "model3d",
  nodeId?: string,
  vendor?: Pick<Vendor, "key" | "baseUrlHint">,
): Promise<TaskResult["assets"][number]> {
  const imported = (await importRemoteAsset(
    {
      projectId,
      url: assetUrl,
      kind: "generated",
      mediaType: type,
      ownerNodeId: nodeId || null,
      fileName: localizedTaskAssetFileName(type, assetUrl),
    },
    {
      trustedPrivateOrigin: trustedLocalOutputOrigin(vendor) || undefined,
    },
  )) as {
    id?: string;
    name?: string;
    data?: { url?: string; absolutePath?: string; model3dValidation?: GlbValidationReport };
  };
  if (type === "image" || type === "video") {
    scheduleTechnicalReview({
      projectId,
      nodeId,
      absolutePath: String(imported.data?.absolutePath || ""),
      assetUrl: String(imported.data?.url || assetUrl),
      type,
    });
  }
  const durationSeconds = await probeLocalizedDurationSeconds(type, imported.data?.absolutePath);
  return {
    type,
    url: String(imported.data?.url || assetUrl),
    thumbnailUrl: type === "image" ? String(imported.data?.url || assetUrl) : null,
    assetId: imported.id || null,
    assetName: imported.name || null,
    providerUrl: /^https?:\/\//i.test(assetUrl) ? assetUrl : null,
    ...(durationSeconds != null ? { durationSeconds } : {}),
    ...(type === "model3d" && imported.data?.model3dValidation
      ? { model3dValidation: imported.data.model3dValidation }
      : {}),
  };
}

export function findTaskMapping(vendorKey: string, taskKind: TaskRequest["kind"], modelKey?: string): Mapping | null {
  return selectTaskMapping(readCatalog().mappings, vendorKey, taskKind, modelKey);
}

function templateContext(
  request: TaskRequest,
  model: Model,
  apiKey: string,
  providerMeta: JsonRecord = {},
  paramMap?: ParamMap,
): JsonRecord {
  return buildTemplateContext({
    request: request as unknown as JsonRecord,
    params: applyParamMap(paramMap, taskTemplateParams(request)),
    model: model as unknown as JsonRecord,
    modelKey: model.modelAlias || model.modelKey,
    apiKey,
    providerMeta,
  });
}

export function buildProfileHttpRequest(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  providerMeta?: JsonRecord;
}): {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  preview: unknown;
} {
  const extraHeaders = extractVendorExtraHeaders(input.vendor);
  return buildHttpRequest({
    baseUrl: String(input.vendor.baseUrlHint || ""),
    authType: input.vendor.authType as AuthType,
    authHeaderName: input.vendor.authHeader ?? undefined,
    apiKey: input.apiKey,
    context: templateContext(
      input.request,
      input.model,
      input.apiKey,
      input.providerMeta || {},
      input.operation.paramMap,
    ),
    operation: input.operation,
    ...(extraHeaders ? { extraHeaders } : {}),
  });
}

export type ProfileOperationTimings = {
  assetLocalizationMs: number;
  localizedAssetCount: number;
  publicAssetProbeMs: number;
  submissionRateLimitMs: number;
  providerRequestMs: number;
  assetPersistenceMs?: number;
  totalMs: number;
};

export function attachProfileOperationTimingsToRaw(response: unknown, timings: ProfileOperationTimings): unknown {
  const base = isJsonRecord(response) ? response : { providerRaw: response };
  const existingNomi = isJsonRecord(base.__nomi) ? base.__nomi : {};
  return {
    ...base,
    __nomi: {
      ...existingNomi,
      profileOperation: timings,
    },
  };
}

export async function executeProfileOperation(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  providerMeta?: JsonRecord;
  enforceSubmissionRateLimit?: boolean;
}): Promise<{ response: unknown; request: unknown; timings: ProfileOperationTimings }> {
  const operationStartedAt = Date.now();
  if (input.operation.process) {
    const context = templateContext(
      input.request,
      input.model,
      input.apiKey,
      input.providerMeta || {},
      input.operation.paramMap,
    );
    const rateLimitStartedAt = Date.now();
    if (input.enforceSubmissionRateLimit) {
      await waitForVendorSubmissionWindow(input.vendor.key, billingKindForTaskKind(input.request.kind));
    }
    const submissionRateLimitMs = Date.now() - rateLimitStartedAt;
    const processStartedAt = Date.now();
    const executed = await executeProcessOperation({
      process: input.operation.process,
      context,
      projectId: trim(input.request.extras?.projectId),
      writeAsset,
    });
    return {
      ...executed,
      timings: {
        assetLocalizationMs: 0,
        localizedAssetCount: 0,
        publicAssetProbeMs: 0,
        submissionRateLimitMs,
        providerRequestMs: Date.now() - processStartedAt,
        totalMs: Date.now() - operationStartedAt,
      },
    };
  }

  if (input.operation.multipart) {
    const rateLimitStartedAt = Date.now();
    if (input.enforceSubmissionRateLimit) {
      await waitForVendorSubmissionWindow(input.vendor.key, billingKindForTaskKind(input.request.kind));
    }
    const submissionRateLimitMs = Date.now() - rateLimitStartedAt;
    const providerRequestStartedAt = Date.now();
    const executed = await runMultipartProfileOperation(input, (url, headers, query, form) =>
      requestMultipart(input.vendor, input.apiKey, url, headers, query, form),
    );
    return {
      ...executed,
      timings: {
        assetLocalizationMs: 0,
        localizedAssetCount: 0,
        publicAssetProbeMs: 0,
        submissionRateLimitMs,
        providerRequestMs: Date.now() - providerRequestStartedAt,
        totalMs: Date.now() - operationStartedAt,
      },
    };
  }

  const assetLocalizationStartedAt = Date.now();
  const uploadCatalog = readCatalog();
  const localized = await localizeAssetsForVendor(
    input.request.extras,
    (mediaKind) =>
      resolveAssetIngestionWithFallback(
        input.vendor,
        uploadCatalog.vendors,
        (key) => decryptApiKeyRecord(uploadCatalog.apiKeysByVendor[key]),
        mediaKind,
      ),
    readNomiLocalAsset,
    postJsonForAssetUpload,
    postMultipartForAssetUpload,
  );
  const assetLocalizationMs = Date.now() - assetLocalizationStartedAt;
  const effectiveInput =
    localized.uploaded > 0
      ? { ...input, request: { ...input.request, extras: localized.value as TaskRequest["extras"] } }
      : input;
  const publicAssetProbeStartedAt = Date.now();
  if (isAgnesImageToVideoRequest(effectiveInput.vendor.key, effectiveInput.request.kind)) {
    const publicImageUrl = firstReferenceImage(effectiveInput.request);
    await assertAgnesPublicImageReachable(publicImageUrl);
  }
  const publicAssetProbeMs = Date.now() - publicAssetProbeStartedAt;
  const built = buildProfileHttpRequest(effectiveInput);
  const rateLimitStartedAt = Date.now();
  if (input.enforceSubmissionRateLimit) {
    await waitForVendorSubmissionWindow(effectiveInput.vendor.key, billingKindForTaskKind(effectiveInput.request.kind));
  }
  const submissionRateLimitMs = Date.now() - rateLimitStartedAt;
  const providerRequestStartedAt = Date.now();
  const body = await applyRequestTransform(effectiveInput.operation.request_transform, built.body, {
    baseUrl: String(effectiveInput.vendor.baseUrlHint || ""),
  });
  const response = await requestJson(
    effectiveInput.vendor,
    effectiveInput.apiKey,
    built.method,
    built.url,
    built.headers,
    built.query,
    body,
  );
  return {
    response,
    request: built.preview,
    timings: {
      assetLocalizationMs,
      localizedAssetCount: localized.uploaded,
      publicAssetProbeMs,
      submissionRateLimitMs,
      providerRequestMs: Date.now() - providerRequestStartedAt,
      totalMs: Date.now() - operationStartedAt,
    },
  };
}

export async function buildProfileTaskResult(input: {
  response: unknown;
  mapping: Mapping;
  operation: HttpOperation;
  request: TaskRequest;
  taskIdFallback: string;
  wantedKind: BillingModelKind;
  projectId?: string;
  nodeId?: string;
  vendor?: Vendor;
  model?: Model;
  operationTimings?: ProfileOperationTimings;
}): Promise<{ result: TaskResult; providerMeta: JsonRecord }> {
  const response = applyResponseTransform(input.operation.response_transform, input.response, {
    baseUrl: String(input.vendor?.baseUrlHint || ""),
  });
  const responseMapping = isJsonRecord(input.operation.response_mapping) ? input.operation.response_mapping : null;
  const providerMetaMapping = isJsonRecord(input.operation.provider_meta_mapping)
    ? input.operation.provider_meta_mapping
    : null;
  const providerMeta = providerMetaFromResponse(response, providerMetaMapping);
  const taskId = firstString(
    firstMappedString(response, responseMapping, "task_id"),
    providerMeta.task_id,
    providerMeta.query_id,
    extractTaskId(response),
    input.taskIdFallback,
  );
  const mappedAssetValues = [
    ...valuesFromMapping(response, responseMapping, "assets"),
    ...valuesFromMapping(response, responseMapping, "image_url"),
    ...valuesFromMapping(response, responseMapping, "video_url"),
    ...valuesFromMapping(response, responseMapping, "model_url"),
  ];
  const assetUrls = Array.from(
    new Set([...mappedAssetValues.flatMap(collectAssetUrls), ...collectAssetUrls(extractAssetUrl(response))]),
  );
  const status = taskStatusFromResponse(response, responseMapping, input.mapping.statusMapping, assetUrls);
  const type: "image" | "video" | "model3d" =
    input.wantedKind === "video" ? "video" : input.wantedKind === "model3d" ? "model3d" : "image";
  const assetPersistenceStartedAt = Date.now();
  const assets = input.projectId
    ? await Promise.all(
        assetUrls.map((url) => localizeTaskAsset(input.projectId || "", url, type, input.nodeId, input.vendor)),
      )
    : assetUrls.map((url) => ({ type, url, thumbnailUrl: type === "image" ? url : null }));
  const assetPersistenceMs = Date.now() - assetPersistenceStartedAt;
  const resultTimings = input.operationTimings
    ? {
        ...input.operationTimings,
        assetPersistenceMs,
        totalMs: input.operationTimings.totalMs + assetPersistenceMs,
      }
    : undefined;
  return {
    providerMeta,
    result: {
      id: taskId,
      kind: input.request.kind,
      status,
      assets,
      raw: resultTimings ? attachProfileOperationTimingsToRaw(input.response, resultTimings) : input.response,
      ...(status === "succeeded" && input.vendor && input.model
        ? {
            provenance: buildTaskProvenance({
              vendor: input.vendor,
              model: input.model,
              request: input.request,
              vendorRequestId: taskId,
            }),
          }
        : {}),
    },
  };
}
