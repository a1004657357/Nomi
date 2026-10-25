export const CAPABILITY_SMOKE_RECIPE_IDS = Object.freeze([
  'image.multiview.custom',
  'image.multiview.grid9',
  'scene.panorama.2to1',
  'portrait.refine',
  'portrait.mood',
  'image.style.transfer',
  'video.look.apply',
  'video.effect.reference',
  'video.edit.look',
  'video.edit.effect',
  'image.multiview.reconstruct3d',
])

export const CAPABILITY_SMOKE_PLANNED_PROVIDER_CALLS = Object.freeze({
  'image.multiview.custom': 1,
  'image.multiview.grid9': 9,
  'scene.panorama.2to1': 1,
  'portrait.refine': 1,
  'portrait.mood': 5,
  'image.style.transfer': 1,
  'video.look.apply': 1,
  'video.effect.reference': 1,
  'video.edit.look': 1,
  'video.edit.effect': 1,
  'image.multiview.reconstruct3d': 1,
})

const RECIPE_SET = new Set(CAPABILITY_SMOKE_RECIPE_IDS)
const COMPLETED_STATUSES = new Set(['success', 'inspection_passed', 'skipped'])

export const CAPABILITY_REAL_SMOKE_HELP = `Usage:
  pnpm smoke:capability-recipes:real -- [options]

The default run is a zero-spend compatibility inspection of every recipe.
Provider calls require --allow-paid or NOMI_ALLOW_PAID_EVAL=1 and still use
Nomi's in-product spend confirmation.

Options:
  --dry-run                         Force zero-spend inspection
  --allow-paid                      Permit confirmed Provider calls
  --recipes=<id,id>                 Select recipe ids
  --max-provider-calls=<count>      Bound total Provider calls
  --max-provider-calls-per-model=<count>
                                    Bound calls for each provider/model pair (max 10)
  --max-attempts-per-recipe=<count> Bound attempts for each recipe
  --custom-view-count=<count>       Custom multiview outputs for batch smoke (1-6)
  --retry-limit=<count>             Bound transient retries
  --cooldown-ms=<milliseconds>      Requested delay between calls
  --timeout-ms=<milliseconds>       Timeout for each recipe
  --provider=<pattern>              Filter connected providers
  --model=<pattern>                 Filter connected models
  --run-dir=<path>                  Write evidence to an explicit directory
  --resume                          Resume completed cases from run-dir
  --use-user-settings               Copy current user model settings and JiMeng browser session
  -h, --help                        Print this help without launching Electron
`

export function smokeHelpRequested(argv = process.argv.slice(2)) {
  return argv.includes('-h') || argv.includes('--help')
}

export function plannedProviderCallsForRecipe(recipeId) {
  const count = CAPABILITY_SMOKE_PLANNED_PROVIDER_CALLS[recipeId]
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Missing planned Provider call count for ${recipeId}`)
  }
  return count
}

export function parseSmokeModelOptionValue(value) {
  const parts = String(value || '').split('::')
  const [vendorKey = '', modelKey = ''] = parts
  if (parts.length >= 4) {
    const variantId = parts[2] || ''
    const modeId = parts[3] || ''
    return {
      vendorKey,
      modelKey,
      ...(variantId ? { variantId } : {}),
      modeId,
    }
  }
  return {
    vendorKey,
    modelKey,
    modeId: parts[2] || '',
  }
}

export function smokePatternMatches(pattern, identifier, displayText) {
  if (!pattern) return true
  pattern.lastIndex = 0
  if (pattern.test(String(identifier || ''))) return true
  pattern.lastIndex = 0
  return pattern.test(String(displayText || ''))
}

function argumentMap(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--' || !arg.startsWith('--')) continue
    const body = arg.slice(2)
    const separator = body.indexOf('=')
    if (separator !== -1) {
      values.set(body.slice(0, separator), body.slice(separator + 1))
      continue
    }
    const next = argv[index + 1]
    if (typeof next === 'string' && next !== '--' && !next.startsWith('--')) {
      values.set(body, next)
      index += 1
      continue
    }
    values.set(body, '1')
  }
  return values
}

function positiveInteger(value, fallback, { label, min = 0, max }) {
  if (typeof value === 'undefined' || value === '') return fallback
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`)
  }
  return numeric
}

function uniqueRecipes(value) {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const recipeId of entries) {
    if (!RECIPE_SET.has(recipeId)) throw new Error(`Unknown capability smoke recipe: ${recipeId}`)
  }
  return Array.from(new Set(entries))
}

function optionalPattern(value, label) {
  const source = String(value || '').trim()
  if (!source) return undefined
  try {
    return new RegExp(source, 'i')
  } catch (error) {
    throw new Error(`Invalid ${label} regular expression: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function parseSmokeConfig(argv = process.argv.slice(2), env = process.env) {
  const args = argumentMap(argv)
  const explicitlyDry = args.has('dry-run')
  const allowPaid = !explicitlyDry && (args.has('allow-paid') || env.NOMI_ALLOW_PAID_EVAL === '1')
  const recipeValue = args.get('recipes')
    || env.NOMI_REAL_SMOKE_RECIPES
    || args.get('recipe')
    || env.NOMI_REAL_SMOKE_RECIPE
  const recipes = recipeValue
    ? uniqueRecipes(recipeValue)
    : allowPaid
      ? ['image.multiview.custom']
      : [...CAPABILITY_SMOKE_RECIPE_IDS]
  if (recipes.length === 0) throw new Error('At least one capability smoke recipe is required')

  const maxProviderCallsInput = args.get('max-provider-calls') ?? env.NOMI_REAL_SMOKE_MAX_PROVIDER_CALLS
  let maxProviderCalls = 0
  if (allowPaid) {
    maxProviderCalls = positiveInteger(
      maxProviderCallsInput,
      1,
      { label: 'max provider calls', min: 1, max: 100 },
    )
  } else {
    positiveInteger(maxProviderCallsInput, 0, { label: 'max provider calls', min: 0, max: 100 })
  }
  const maxAttemptsPerRecipe = positiveInteger(
    args.get('max-attempts-per-recipe') ?? env.NOMI_REAL_SMOKE_MAX_ATTEMPTS_PER_RECIPE,
    1,
    { label: 'max attempts per recipe', min: 1, max: 5 },
  )
  const maxProviderCallsPerModel = positiveInteger(
    args.get('max-provider-calls-per-model') ?? env.NOMI_REAL_SMOKE_MAX_PROVIDER_CALLS_PER_MODEL,
    10,
    { label: 'per-model provider calls', min: 1, max: 10 },
  )
  const customViewCount = positiveInteger(
    args.get('custom-view-count') ?? env.NOMI_REAL_SMOKE_CUSTOM_VIEW_COUNT,
    1,
    { label: 'custom view count', min: 1, max: 6 },
  )
  const retryLimit = positiveInteger(
    args.get('retry-limit') ?? env.NOMI_REAL_SMOKE_RETRY_LIMIT,
    0,
    { label: 'retry limit', min: 0, max: 4 },
  )
  const cooldownMs = positiveInteger(
    args.get('cooldown-ms') ?? env.NOMI_REAL_SMOKE_COOLDOWN_MS,
    60_000,
    { label: 'cooldown milliseconds', min: 0, max: 30 * 60_000 },
  )
  const timeoutMs = positiveInteger(
    args.get('timeout-ms') ?? env.NOMI_REAL_SMOKE_TIMEOUT_MS,
    30 * 60_000,
    { label: 'timeout milliseconds', min: 10_000, max: 2 * 60 * 60_000 },
  )

  return {
    allowPaid,
    recipes,
    maxProviderCalls,
    maxProviderCallsPerModel,
    maxAttemptsPerRecipe,
    customViewCount,
    retryLimit,
    cooldownMs,
    timeoutMs,
    resume: args.has('resume') || env.NOMI_REAL_SMOKE_RESUME === '1',
    useUserSettings: args.has('use-user-settings') || env.NOMI_REAL_SMOKE_USE_USER_SETTINGS === '1',
    runDir: String(args.get('run-dir') || env.NOMI_REAL_SMOKE_RUN_DIR || '').trim() || undefined,
    providerPattern: optionalPattern(args.get('provider') || env.NOMI_REAL_SMOKE_PROVIDER, 'provider'),
    modelPattern: optionalPattern(args.get('model') || env.NOMI_REAL_SMOKE_MODEL, 'model'),
  }
}

export function classifyProviderFailure(message) {
  const text = String(message || '').toLowerCase()
  if (/output contract failed|expectedoutputs|输出契约/.test(text)) return 'contract'
  if (/(?:http\s*)?429|rate[ _-]?limit|too many requests|frequency|频率|限流|请求过于频繁/.test(text)) {
    return 'rate_limit'
  }
  if (/(?:http\s*)?40[13]|api key|invalid key|unauthori[sz]ed|forbidden|鉴权|密钥/.test(text)) return 'auth'
  if (/timed?\s*out|timeout|deadline exceeded|超时/.test(text)) return 'timeout'
  if (/econnreset|enotfound|eai_again|socket|network|connection|fetch failed|网络/.test(text)) return 'network'
  if (/(?:http\s*)?5\d\d|provider|service unavailable|upstream|服务商/.test(text)) return 'provider'
  return 'unknown'
}

export function providerCallsFromSpendDialog(message, fallback) {
  const match = String(message || '').match(/生成任务\s*(\d+)\s*次独立请求/)
  const parsed = Number(match?.[1])
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  return Math.max(1, Math.floor(Number(fallback) || 1))
}

export function shouldRetryProviderFailure({ kind, attempt, retryLimit }) {
  if (kind === 'rate_limit' || kind === 'auth') return false
  return attempt <= retryLimit
}

const SMOKE_PROFILE_TIMING_FIELDS = new Set([
  'assetLocalizationMs',
  'localizedAssetCount',
  'publicAssetProbeMs',
  'submissionRateLimitMs',
  'providerRequestMs',
  'assetPersistenceMs',
])

const SMOKE_GENERATION_TIMING_FIELDS = new Set([
  'resolveMs',
  'submitMs',
  'pollMs',
  'finalizeMs',
  'totalMs',
])

const SMOKE_CODEX_TIMING_FIELDS = new Set([
  'queueMs',
  'referenceMs',
  'promptBuildMs',
  'codexExecMs',
  'outputVerifyMs',
  'assetWriteMs',
  'runtimeTotalMs',
  'totalMs',
  'referenceCount',
  'attemptCount',
  'imagegenInvocationCount',
])

function finiteTimingFields(value, allowedFields) {
  return Object.fromEntries(
    Object.entries(value && typeof value === 'object' ? value : {})
      .filter(([key, numeric]) => (
        allowedFields.has(key)
        && typeof numeric === 'number'
        && Number.isFinite(numeric)
      )),
  )
}

export function extractSmokePhaseTimings(item) {
  const raw = item?.result?.raw
  if (!raw || typeof raw !== 'object') return null
  const nomi = raw.__nomi && typeof raw.__nomi === 'object' ? raw.__nomi : {}
  const codexTimings = raw.codex && typeof raw.codex === 'object' ? raw.codex.timings : null
  const profileOperation = finiteTimingFields(nomi.profileOperation, SMOKE_PROFILE_TIMING_FIELDS)
  const generationPhases = finiteTimingFields(nomi.generationPhases, SMOKE_GENERATION_TIMING_FIELDS)
  const codex = {
    ...finiteTimingFields(codexTimings, SMOKE_CODEX_TIMING_FIELDS),
    ...(codexTimings?.imagegenInvocationAudit === 'verified'
      || codexTimings?.imagegenInvocationAudit === 'unobservable'
      ? { imagegenInvocationAudit: codexTimings.imagegenInvocationAudit }
      : {}),
  }
  if (
    Object.keys(profileOperation).length === 0
    && Object.keys(generationPhases).length === 0
    && Object.keys(codex).length === 0
  ) {
    return null
  }
  return {
    itemId: item?.id || null,
    profileOperation,
    generationPhases,
    codex,
  }
}

export function markSmokeCaseSucceeded(caseState) {
  caseState.status = 'success'
  caseState.error = null
  caseState.failureKind = null
}

export function smokeQualityDisposition(quality) {
  const status = String(quality?.status || '').trim()
  if (!status || status === 'pass') return 'accepted'
  if (status === 'fail') return 'failed'
  return 'manual_review'
}

export function effectiveProviderCooldownMs(requestedCooldownMs, model) {
  const requested = Math.max(0, Math.floor(Number(requestedCooldownMs) || 0))
  const vendorKey = String(model?.vendorKey || '').trim().toLowerCase()
  const modelKey = String(model?.modelKey || '').trim().toLowerCase()
  if (vendorKey !== 'agnes') return requested
  if (modelKey.includes('agnes-video')) return Math.max(requested, 60_000)
  if (modelKey.includes('agnes-image')) return Math.max(requested, 6_000)
  return Math.max(requested, 3_000)
}

export function describeMissingCompatibleModel(recipeId, { filterMismatch = false } = {}) {
  if (filterMismatch) {
    return {
      code: 'provider_model_filter_mismatch',
      requiredCapability: 'recipe_compatible_model',
      remediation: '放宽 --provider/--model 筛选，或连接与该筛选匹配的兼容模型。',
      candidateArchetypes: [],
    }
  }
  if (recipeId === 'video.edit.look' || recipeId === 'video.edit.effect') {
    return {
      code: 'missing_source_video_model',
      requiredCapability: 'source_video',
      remediation: '在模型接入中连接 KIE 并启用 HappyHorse；其 video-edit 模式明确声明 source_video 输入和 edit intent。',
      candidateArchetypes: ['happyhorse'],
    }
  }
  if (recipeId === 'image.multiview.reconstruct3d') {
    return {
      code: 'missing_image_to_3d_model',
      requiredCapability: 'image_to_3d',
      remediation: '连接 Hunyuan3D、HiTem3D、Meshy 6 或其他能返回 GLB 的图生 3D Provider。',
      candidateArchetypes: ['hunyuan3d', 'hitem3d', 'meshy6'],
    }
  }
  return {
    code: 'missing_connected_compatible_model',
    requiredCapability: 'recipe_compatible_model',
    remediation: '在模型接入中连接并启用一个与该能力配方兼容的模型。',
    candidateArchetypes: [],
  }
}

export function createSmokeState({
  generatedAt,
  recipes,
  allowPaid,
  maxProviderCalls,
  maxProviderCallsPerModel = 10,
}) {
  return {
    schemaVersion: 2,
    evalId: 'capability-recipes-real-smoke-v2',
    generatedAt,
    updatedAt: generatedAt,
    status: 'planned',
    paidEvaluation: allowPaid,
    maxProviderCalls,
    maxProviderCallsPerModel,
    providerCalls: 0,
    providerCallsByModel: {},
    stopReason: null,
    cases: recipes.map((recipeId) => ({
      recipeId,
      status: 'pending',
      attempts: 0,
      providerCalls: 0,
      evidence: [],
    })),
  }
}

export function mergeSmokeState(fresh, previous) {
  if (!previous || previous.schemaVersion !== fresh.schemaVersion) return fresh
  const previousByRecipe = new Map(
    Array.isArray(previous.cases)
      ? previous.cases.map((entry) => [entry?.recipeId, entry])
      : [],
  )
  return {
    ...fresh,
    providerCalls: Number.isInteger(previous.providerCalls) ? previous.providerCalls : 0,
    providerCallsByModel: previous.providerCallsByModel
      && typeof previous.providerCallsByModel === 'object'
      && !Array.isArray(previous.providerCallsByModel)
      ? { ...previous.providerCallsByModel }
      : {},
    cases: fresh.cases.map((entry) => {
      const prior = previousByRecipe.get(entry.recipeId)
      if (!prior || typeof prior !== 'object') return entry
      const status = COMPLETED_STATUSES.has(prior.status) ? prior.status : 'pending'
      return {
        ...entry,
        ...prior,
        status,
        evidence: Array.isArray(prior.evidence) ? prior.evidence : [],
      }
    }),
  }
}

function secretKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return [
    'apikey',
    'accesskey',
    'secretkey',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'cookie',
    'setcookie',
    'credential',
    'credentials',
    'sessioncookie',
  ].includes(normalized)
}

function sanitizeString(value) {
  let output = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/\-=]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
  if (!/^https?:\/\//i.test(output)) return output
  try {
    const url = new URL(output)
    for (const key of [...url.searchParams.keys()]) {
      if (secretKey(key) || /token|secret|key|session|auth/i.test(key)) {
        url.searchParams.set(key, '[redacted]')
      }
    }
    output = url.toString()
  } catch {
    return output
  }
  return output
}

export function sanitizeSmokeReport(value) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeSmokeReport(entry))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        secretKey(key) ? '[redacted]' : sanitizeSmokeReport(entry),
      ]),
    )
  }
  if (typeof value === 'string') return sanitizeString(value)
  return value
}
