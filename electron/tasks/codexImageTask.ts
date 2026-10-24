import { desktopT } from "../desktopStrings";
import fs from "node:fs";
import { contentTypeFromPath, extensionFromMime } from "../assets/assetPaths";
import { writeAsset } from "../assets/projectAssetStore";
import { captureAssetWriteContext } from '../assets/assetWriteContext';
import type { ProjectBinding } from '../shared/projectBinding';
import { runCodexImageGeneration } from "../ai/codexImagegenRunner";
import type { BillingModelKind, Model, Vendor } from "../catalog/types";
import { traceVendorCompleted, traceVendorRequested } from "../events/vendorCallTrace";
import { firstString, trim } from "../jsonUtils";
import { scheduleTechnicalReview } from "../review/reviewTrace";
import type { TaskRequest, TaskResult } from "../runtime";
import { readCachedTaskResult, recipeFingerprint, rememberTaskResult } from "../vendor/fingerprintCache";
import { buildNormalizedRecipe, buildTaskProvenance } from "../vendor/provenance";
import { consumeTaskSpend } from "./taskSpend";
import { logInfo } from '../logging/logger';

export async function runCodexImageTask(input: {
  vendor: Vendor; model: Model; request: TaskRequest; wantedKind: BillingModelKind;
  projectId: string; nodeId: string; grantId: string; taskId: string;
}): Promise<TaskResult> {
  const { vendor, model, request, wantedKind, projectId, nodeId, grantId, taskId } = input;
  if (wantedKind !== "image") throw new Error(desktopT("custom.tasks.codexImageTask.text1"));
  if (!projectId) throw new Error(desktopT("custom.tasks.codexImageTask.text2"));
  const context = await captureAssetWriteContext(projectId, request.extras?.projectBinding as ProjectBinding | undefined);
  const recipe = buildNormalizedRecipe({ vendor, model, request });
  const fingerprint = recipeFingerprint(recipe);
  const cachedHit = readCachedTaskResult({ projectId, fingerprint, nodeId, extras: request.extras });
  if (cachedHit) return cachedHit as TaskResult;
  await consumeTaskSpend({ grantId, nodeId, projectId, vendorKey: vendor.key, modelKey: model.modelKey, parameters: request.extras });
  const runtimeStartedAt = Date.now();
  const generated = await runCodexImageGeneration({ request });
  try {
    const assetWriteStartedAt = Date.now();
    const contentType = contentTypeFromPath(generated.outputPath);
    const saved = await writeAsset(projectId, fs.readFileSync(generated.outputPath),
      `codex-img2-${Date.now()}.${extensionFromMime(contentType, "png")}`, contentType, {
        kind: "generated", generator: "codex-img2", originalPath: generated.outputPath,
        ownerNodeId: nodeId || null, codexThreadId: generated.threadId || null,
      }, "image", context) as { id?: string; name?: string; data?: { url?: string; absolutePath?: string } };
    const assetUrl = trim(saved.data?.url);
    if (!assetUrl) throw new Error(desktopT("custom.tasks.codexImageTask.text3"));
    scheduleTechnicalReview({ projectId, nodeId, absolutePath: trim(saved.data?.absolutePath), assetUrl,
      type: "image", expectedAspectRatio: firstString(request.extras?.aspect_ratio, request.extras?.aspectRatio) });
    const timings = { ...generated.timings, assetWriteMs: Date.now() - assetWriteStartedAt,
      runtimeTotalMs: Date.now() - runtimeStartedAt };
    const runId = generated.threadId || taskId;
    const result: TaskResult = {
      id: runId, kind: request.kind, status: "succeeded",
      assets: [{ type: "image", url: assetUrl, thumbnailUrl: assetUrl, assetId: saved.id || null, assetName: saved.name || null }],
      raw: { codex: { threadId: generated.threadId || null, lastMessage: generated.lastMessage, timings } },
      provenance: buildTaskProvenance({ vendor, model, request, vendorRequestId: runId }),
    };
    traceVendorRequested(projectId, { runId, nodeId, recipe });
    traceVendorCompleted(projectId, { runId, nodeId, status: "succeeded", assetCount: 1 });
    rememberTaskResult(projectId, fingerprint, result);
    logInfo('tasks', 'codex-image-generation-completed', {
      runId, nodeId, totalMs: timings.runtimeTotalMs, queueMs: timings.queueMs,
      codexExecMs: timings.codexExecMs, imagegenInvocationCount: timings.imagegenInvocationCount,
    });
    return result;
  } finally {
    try { fs.rmSync(generated.tempDir, { recursive: true, force: true }); } catch { /* non-fatal cleanup */ }
  }
}
