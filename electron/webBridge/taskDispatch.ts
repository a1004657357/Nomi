import { JIMENG_WEB_VENDOR_SEED } from '../catalog/jimengWeb'
import { PAVO_WEB_VENDOR_SEED } from '../catalog/pavoWeb'
import type { BillingModelKind, Model, Vendor } from '../catalog/types'
import { submitJimengWebTask } from '../jimengWeb/seedanceBridge'
import { jimengWebStartRunner } from '../jimengWeb/runner'
import { firstString, trim } from '../jsonUtils'
import { submitPavoWebTask } from '../pavoWeb/bridge'
import { pavoWebStartRunner } from '../pavoWeb/runner'
import type { CachedTask, TaskRequest, TaskResult } from '../runtime'
import { assertAndConsumeSpendGrant } from '../spendGrant'
import { traceVendorRequested } from '../events/vendorCallTrace'
import { buildNormalizedRecipe } from '../vendor/provenance'
import { readCachedTaskResult, recipeFingerprint } from '../vendor/fingerprintCache'

type ErrorFactory = {
  unsupported: (label: string) => Error
  projectRequired: (label: string) => Error
  idempotencyRequired: () => Error
  runnerUnavailable: (label: string, reason: string) => Error
}

type Input = {
  vendor: Vendor
  model: Model
  request: TaskRequest
  wantedKind: BillingModelKind
  projectId: string
  nodeId: string
  grantId: string
  admitTask: (id: string, entry: CachedTask) => void
  errors: ErrorFactory
}

export async function dispatchWebBridgeTask(input: Input): Promise<TaskResult | null> {
  const { vendor, model, request, wantedKind, projectId, nodeId, grantId, errors } = input
  const bridge = vendor.key === JIMENG_WEB_VENDOR_SEED.key
    ? {
        label: JIMENG_WEB_VENDOR_SEED.name,
        supports: wantedKind === 'video' || wantedKind === 'image',
        start: jimengWebStartRunner,
        submit: submitJimengWebTask,
        rawKey: 'jimengWeb',
      }
    : vendor.key === PAVO_WEB_VENDOR_SEED.key
      ? {
          label: PAVO_WEB_VENDOR_SEED.name,
          supports: wantedKind === 'video',
          start: pavoWebStartRunner,
          submit: submitPavoWebTask,
          rawKey: 'pavoWeb',
        }
      : null
  if (!bridge) return null
  if (!bridge.supports) throw errors.unsupported(bridge.label)
  if (!projectId) throw errors.projectRequired(bridge.label)

  const recipe = buildNormalizedRecipe({ vendor, model, request })
  const fingerprint = recipeFingerprint(recipe)
  const cachedHit = readCachedTaskResult({ projectId, fingerprint, nodeId, extras: request.extras })
  if (cachedHit) return cachedHit as TaskResult

  if (vendor.key === PAVO_WEB_VENDOR_SEED.key) {
    request.extras = {
      ...(request.extras || {}),
      idempotencyKey: firstString(request.extras?.idempotencyKey, grantId),
    }
    if (!trim(request.extras.idempotencyKey)) throw errors.idempotencyRequired()
  }

  const runner = await bridge.start(vendor.baseUrlHint)
  if (!runner.clientOnline) throw errors.runnerUnavailable(bridge.label, runner.error || '')

  assertAndConsumeSpendGrant(grantId, nodeId)
  const submitted = await bridge.submit({ request, vendorBaseUrl: vendor.baseUrlHint })
  const queued: TaskResult = {
    id: submitted.taskCode,
    kind: request.kind,
    status: 'queued',
    assets: [],
    raw: {
      [bridge.rawKey]: {
        taskCode: submitted.taskCode,
        serverUrl: submitted.serverUrl,
        payload: submitted.payload,
        submit: submitted.raw,
      },
    },
  }
  traceVendorRequested(projectId, { runId: submitted.taskCode, nodeId, recipe })
  input.admitTask(submitted.taskCode, {
    vendor: vendor.key,
    request,
    raw: queued.raw,
    mapping: null,
    model,
    providerMeta: {
      task_id: submitted.taskCode,
      taskCode: submitted.taskCode,
      serverUrl: submitted.serverUrl,
      bridgeKind: bridge.rawKey,
    },
    projectId,
    nodeId,
    wantedKind,
    fingerprint,
  })
  return queued
}
