import { localizeAssetsForVendor } from "../catalog/assetLocalization";
import { assetIngestionResolver, assetLocalizationOptions } from "../catalog/assetTransportRuntime";
import { readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload, putBinaryForAssetUpload } from "../assets/localAssetFile";
import { writeAsset, writeDeterministicAsset } from "../assets/projectAssetStore";
import { requestJson, requestMultipart, vendorResponseLimitForKind } from "../vendor/vendorHttp";
import { runMultipartProfileOperation } from "../catalog/multipartOperation";
import { templateContext, buildProfileHttpRequest } from "../catalog/profileHttpRequest";
import { assertCanonicalAntigravityOperation, executeProcessOperation } from "../catalog/processOperation";
import { trim, isJsonRecord } from "../jsonUtils";
import { applyRequestTransform } from "./requestTransforms";
import { readCatalog } from "../catalog/catalogStore";
import type { Vendor, Model, HttpOperation } from "../catalog/types";
import type { TaskRequest, ProfileOperationStage } from "../runtime";
import { waitForVendorSubmissionWindow } from '../vendorSubmissionRateLimiter';
import { billingKindForTaskKind } from '../catalog/types';
import { firstReferenceImage } from '../catalog/taskParams';
import { assertAgnesPublicImageReachable, isAgnesImageToVideoRequest } from '../catalog/agnesPublicAssetProbe';
import type { JsonRecord } from '../jsonUtils';
export { localizeTaskAsset } from "../assets/localizeTaskAsset";
export { buildProfileTaskResult, findTaskMapping } from "../runtime";
export { buildProfileHttpRequest };
export type ProfileOperationTimings = {
  assetLocalizationMs: number; localizedAssetCount: number; publicAssetProbeMs: number;
  submissionRateLimitMs: number; providerRequestMs: number; totalMs: number;
  assetPersistenceMs?: number;
};
export function attachProfileOperationTimingsToRaw(response: unknown, timings: ProfileOperationTimings): unknown {
  const base = isJsonRecord(response) ? response : { providerRaw: response };
  return { ...base, __nomi: { ...(isJsonRecord(base.__nomi) ? base.__nomi : {}), profileOperation: timings } };
}
export async function executeProfileOperation(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  providerMeta?: JsonRecord;
  enforceSubmissionRateLimit?: boolean;
  localAssetReader?: import("../catalog/assetLocalization").LocalAssetReader; signal?: AbortSignal; stage?: ProfileOperationStage; antigravityPreflight?: import("../ai/antigravityTask").PreparedAntigravityTask;
}): Promise<{ response: unknown; request: unknown; timings: ProfileOperationTimings }> {
  const startedAt = Date.now();
  const timings: ProfileOperationTimings = { assetLocalizationMs: 0, localizedAssetCount: 0, publicAssetProbeMs: 0, submissionRateLimitMs: 0, providerRequestMs: 0, totalMs: 0 };
  const execute = async (run: () => Promise<{ response: unknown; request: unknown }>) => {
    const waitStartedAt = Date.now();
    if (input.stage === 'create' || input.enforceSubmissionRateLimit) {
      await waitForVendorSubmissionWindow(input.vendor.key, billingKindForTaskKind(input.request.kind));
    }
    timings.submissionRateLimitMs = Date.now() - waitStartedAt;
    input.signal?.throwIfAborted();
    const requestStartedAt = Date.now();
    const result = await run();
    timings.providerRequestMs = Date.now() - requestStartedAt;
    timings.totalMs = Date.now() - startedAt;
    return { ...result, timings };
  };
  // Process and multipart declarations are handled by their shared executors.
  if (input.operation.process) {
    if (input.stage === "result") throw new Error("ANTIGRAVITY_INVALID_CONFIG");
    if (input.operation.process.parser === "antigravity-cli-image" && !input.stage) throw new Error("ANTIGRAVITY_INVALID_CONFIG");
    if (input.operation.process.parser === "antigravity-cli-image") assertCanonicalAntigravityOperation({ vendorKey: input.vendor.key, modelKey: input.model.modelKey, taskKind: input.request.kind, stage: input.stage!, operation: input.operation });
    const process = input.operation.process;
    const stage = input.stage;
    const context = templateContext(
      input.request,
      input.model,
      input.apiKey,
      input.providerMeta || {},
      input.operation.paramMap,
    );
    return execute(() => executeProcessOperation({
      process,
      context,
      projectId: trim(input.request.extras?.projectId),
      writeAsset, writeDeterministicAsset, signal: input.signal, stage, identity: { vendorKey: input.vendor.key, modelKey: input.model.modelKey, taskKind: input.request.kind }, antigravityPreflight: input.antigravityPreflight,
    }));
  }
  if (input.operation.multipart) return execute(() => runMultipartProfileOperation(input, (u, h, q, f) => requestMultipart(input.vendor, input.apiKey, u, h, q, f, input.signal, { maxResponseBytes: vendorResponseLimitForKind(input.model.kind) })));
  const localizationStartedAt = Date.now();
  const uploadCatalog = readCatalog();
  const localized = await localizeAssetsForVendor(
    input.request.extras,
    assetIngestionResolver(input.vendor, uploadCatalog),
    input.localAssetReader || readNomiLocalAsset,
    postJsonForAssetUpload,
    postMultipartForAssetUpload,
    assetLocalizationOptions(input.request.extras),
    putBinaryForAssetUpload,
  );
  const effectiveInput =
    localized.uploaded > 0
      ? { ...input, request: { ...input.request, extras: localized.value as TaskRequest["extras"] } }
      : input;
  timings.assetLocalizationMs = Date.now() - localizationStartedAt;
  timings.localizedAssetCount = localized.uploaded;
  const probeStartedAt = Date.now();
  if (input.stage !== 'query' && input.stage !== 'result' && isAgnesImageToVideoRequest(input.vendor.key, input.request.kind)) {
    await assertAgnesPublicImageReachable(firstReferenceImage(effectiveInput.request));
  }
  timings.publicAssetProbeMs = Date.now() - probeStartedAt;
  const built = buildProfileHttpRequest(effectiveInput);
  const body = await applyRequestTransform(input.operation.request_transform, built.body, { baseUrl: String(input.vendor.baseUrlHint || ""), promptId: trim(input.request.extras?.comfyPromptId), request: input.request });
  const { vendor, apiKey } = effectiveInput;
  return execute(async () => ({ response: await requestJson(vendor, apiKey, built.method, built.url, built.headers, built.query, body, input.signal, { maxResponseBytes: vendorResponseLimitForKind(input.model.kind) }), request: built.preview }));
}
