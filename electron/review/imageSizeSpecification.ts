export type ImageSizeValidation = {
  requested: { width: number; height: number } | null;
  actual: { width: number; height: number } | null;
  status: "matched" | "mismatch" | "unavailable";
  warning?: "image_size_mismatch" | "image_size_unavailable";
  originalPreserved: true;
  normalizationApplied: false;
};

function positivePixels(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parsePixels(value: unknown): { width: number; height: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d+)x(\d+)$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return positivePixels(width) && positivePixels(height) ? { width, height } : undefined;
}

/** Only the compiled outbound fields are authoritative; do not infer pixels from UI labels. */
export function requestedImageSizeFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const fields = body as Record<string, unknown>;
  const size = fields.size !== undefined ? parsePixels(fields.size)
    : positivePixels(fields.width) && positivePixels(fields.height) ? { width: fields.width, height: fields.height } : undefined;
  return size ? `${size.width}x${size.height}` : undefined;
}

export function assessImageSize(expectedImageSize: string | null | undefined, metadata?: { width?: number; height?: number }): ImageSizeValidation | undefined {
  const requested = parsePixels(expectedImageSize);
  if (!requested && expectedImageSize !== null) return undefined;
  const actual = positivePixels(metadata?.width) && positivePixels(metadata?.height)
    ? { width: metadata.width, height: metadata.height } : null;
  const status = !requested || !actual ? "unavailable" : actual.width === requested.width && actual.height === requested.height ? "matched" : "mismatch";
  return {
    requested: requested ?? null, actual, status,
    ...(status === "mismatch" ? { warning: "image_size_mismatch" as const } : status === "unavailable" ? { warning: "image_size_unavailable" as const } : {}),
    originalPreserved: true, normalizationApplied: false,
  };
}
