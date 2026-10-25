/** Missing metadata preserves existing API models; explicit false is authoritative. */
export function modelSupportsToolCalls(meta: unknown): boolean {
  return !(meta && typeof meta === "object" && (meta as { supportsToolCalls?: unknown }).supportsToolCalls === false);
}

// Pure capability checks for an already-selected model; no supplier lookup or routing.
const VISION_MODEL_RE =
  /gpt-4o|gpt-4\.1|gpt-4-vision|chatgpt-4o|o1|o3|o4-mini|claude-3|claude-opus-4|claude-sonnet-4|claude-haiku-4|gemini|llava|qwen.*-?vl|pixtral|internvl|minicpm-v|grok.*vision|vision/i
const DOUBAO_SEED_2_MODEL_RE = /doubao[\s._-]*seed[\s._-]*2[\s._-]*0/i

const PDF_INPUT_MODEL_RE =
  /claude-3-5|claude-3-7|claude-opus-4|claude-sonnet-4|claude-haiku-4|gpt-4o|gpt-4\.1|o1|o3|o4-mini|gemini/i

function metaFlag(meta: unknown, key: string): boolean | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const value = (meta as Record<string, unknown>)[key]
  return typeof value === 'boolean' ? value : undefined
}

export function modelSupportsImageInput(
  modelKey: string,
  modelAlias: string | null | undefined,
  meta: unknown,
): boolean {
  const declared = metaFlag(meta, 'supportsImageInput')
  if (typeof declared === 'boolean') return declared
  const identity = `${modelKey || ''} ${modelAlias || ''}`.toLowerCase()
  return VISION_MODEL_RE.test(identity) || DOUBAO_SEED_2_MODEL_RE.test(identity)
}

export function modelSupportsPdfInput(
  modelKey: string,
  modelAlias: string | null | undefined,
  meta: unknown,
): boolean {
  const declared = metaFlag(meta, 'supportsPdfInput')
  if (typeof declared === 'boolean') return declared
  return PDF_INPUT_MODEL_RE.test(`${modelKey || ''} ${modelAlias || ''}`.toLowerCase())
}
