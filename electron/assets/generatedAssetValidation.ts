import crypto from "node:crypto";
import type { JsonRecord } from "../jsonUtils";
import type { LocalizedAssetType } from "./localizedAsset";
import type { CertificationMediaEvidence } from "../providerAdapter/certificationMedia";
import { contentTypeFromMagicBytes, isCertifiableMediaContentType, isMarkupMasquerade } from "./mediaTypes";
import { validateGlbStructure } from "./model3dValidation";
import { generatedMediaKindMismatchError, generatedMediaValidationError, verifyGeneratedMediaDecodes } from "./generatedMediaDecode";
function generatedMediaKind(contentType: string): "image" | "video" | "audio" | "model3d" | null {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return contentType === "model/gltf-binary" ? "model3d" : null;
}

/** 视频容器装音频（.mp4 / .webm）：要音频时唯一放行的「字节族和期望不同」，落盘按音频记。 */
const AUDIO_IN_VIDEO_CONTAINER: Readonly<Record<string, string>> = { "video/mp4": "audio/mp4", "video/webm": "audio/webm" };

/**
 * 生成产物进项目的唯一关口（0.23.x 版：同步，落盘前）。expectedKind = 这份产物**应该**是哪一类（任务期望 / 生产者
 * 自己产的那一类），由每扇写入口必填。判据只认字节：声明的 content-type、文件名扩展名都不算数——字节正是要的那一类
 * 就收（按字节记类型），不是就不落盘，抛 retrieval-download（V-1213：付了视频的钱，落进来一张参考图）。
 * 返回清洗后的 meta 与发布要用的内容类型（非生成产物原样返回调用方的声明）。
 */
export function validatedGenerated(meta: JsonRecord, declaredRaw: string, bytes: Uint8Array, expectedKind: LocalizedAssetType | null, sourcePath?: string): { meta: JsonRecord; contentType: string } {
  if (String(meta.kind || "").toLowerCase() !== "generated") return { meta, contentType: declaredRaw };
  if (!expectedKind) throw new Error("generated_output_expected_kind_required");
  if (isMarkupMasquerade(bytes)) throw generatedMediaValidationError("markup_masquerade");
  const detected = bytes.byteLength >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "glTF"
    ? "model/gltf-binary"
    : contentTypeFromMagicBytes(bytes);
  if (!detected) throw generatedMediaValidationError("unknown_bytes");
  const audioContainer = expectedKind === "audio" ? AUDIO_IN_VIDEO_CONTAINER[detected] : undefined;
  const detectedKind = generatedMediaKind(detected);
  if (detectedKind !== expectedKind && !audioContainer) throw generatedMediaKindMismatchError(expectedKind, detectedKind ?? detected);
  if (!isCertifiableMediaContentType(detected) && !audioContainer) throw generatedMediaValidationError("unsupported_format");
  const contentType = audioContainer ?? detected;
  const claimed = meta.certificationEvidence && typeof meta.certificationEvidence === "object"
    ? meta.certificationEvidence as Partial<CertificationMediaEvidence>
    : undefined;
  const cleanMeta = { ...meta };
  delete cleanMeta.certificationEvidence;
  if (claimed) {
    const normalizedDeclared = String(declaredRaw || "").toLowerCase().split(";", 1)[0].trim();
    const declared = !normalizedDeclared || normalizedDeclared === "application/octet-stream" ? detected : normalizedDeclared;
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (claimed.sha256 !== digest || claimed.byteLength !== bytes.byteLength || claimed.kind !== expectedKind
      || claimed.contentType !== declared) throw generatedMediaValidationError("evidence_mismatch");
    return { meta: cleanMeta, contentType };
  }
  if (expectedKind === "model3d") {
    validateGlbStructure(bytes);
    return { meta: cleanMeta, contentType };
  }
  // 「这份字节能不能解码」由 generatedMediaDecode 一处裁决（判据、超时、日志都在那里）；这里只问、不评。
  verifyGeneratedMediaDecodes({ kind: expectedKind, bytes, ...(sourcePath ? { sourcePath } : {}), contentType: detected });
  return { meta: cleanMeta, contentType };
}
