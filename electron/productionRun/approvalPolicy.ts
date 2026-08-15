import type { Approval, AutomationMode, ProductionJob } from "./productionRunTypes";

export type EffectiveAutomationPolicy = {
  mode: AutomationMode;
  trustedHosts: string[];
  allowedProviders: string[];
  allowedModels: string[];
  maxSpend: number | null;
  maxAttemptsPerJob: number;
};

export type SubmissionAuthorizationFailure =
  | "approval-run-mismatch"
  | "plan-changed"
  | "approval-expired"
  | "approval-revoked"
  | "untrusted-host"
  | "job-not-approved"
  | "provider-not-approved"
  | "model-not-approved"
  | "currency-mismatch"
  | "attempt-limit"
  | "unknown-cost"
  | "approval-budget-exceeded"
  | "policy-budget-exceeded";

export type SubmissionAuthorizationResult =
  | { ok: true }
  | { ok: false; reason: SubmissionAuthorizationFailure };

export type SubmissionAuthorizationInput = {
  approval: Approval;
  job: Pick<ProductionJob, "jobId" | "provider" | "model" | "attempt">;
  policy: EffectiveAutomationPolicy;
  now: string;
  planHash: string;
  originHost: string;
  estimatedCost: number | null;
  currency: string;
  runId?: string;
};

const MODE_RESTRICTIVENESS: Record<AutomationMode, number> = {
  guided: 0,
  balanced: 1,
  "policy-auto": 2,
};

function intersection(values: readonly string[][]): string[] {
  const [first = [], ...rest] = values;
  return [...new Set(first)].filter((value) => rest.every((items) => items.includes(value)));
}

function minimumCeiling(values: readonly (number | null)[]): number | null {
  const ceilings = values.filter((value): value is number => value !== null);
  return ceilings.length > 0 ? Math.min(...ceilings) : null;
}

export function intersectAutomationPolicies(
  policies: readonly EffectiveAutomationPolicy[],
): EffectiveAutomationPolicy {
  if (policies.length === 0) throw new Error("At least one automation policy is required");
  const mode = policies.reduce((mostRestrictive, current) =>
    MODE_RESTRICTIVENESS[current.mode] < MODE_RESTRICTIVENESS[mostRestrictive]
      ? current.mode
      : mostRestrictive, policies[0].mode);
  return {
    mode,
    trustedHosts: intersection(policies.map((value) => value.trustedHosts)),
    allowedProviders: intersection(policies.map((value) => value.allowedProviders)),
    allowedModels: intersection(policies.map((value) => value.allowedModels)),
    maxSpend: minimumCeiling(policies.map((value) => value.maxSpend)),
    maxAttemptsPerJob: Math.min(...policies.map((value) => value.maxAttemptsPerJob)),
  };
}

export function authorizeSubmission(input: SubmissionAuthorizationInput): SubmissionAuthorizationResult {
  const { approval, job, policy } = input;
  if (input.runId !== undefined && approval.runId !== input.runId) return { ok: false, reason: "approval-run-mismatch" };
  if (approval.planHash !== input.planHash) return { ok: false, reason: "plan-changed" };
  if (approval.revokedAt) return { ok: false, reason: "approval-revoked" };
  if (Date.parse(input.now) >= Date.parse(approval.expiresAt)) return { ok: false, reason: "approval-expired" };
  if (!policy.trustedHosts.includes(input.originHost)) return { ok: false, reason: "untrusted-host" };
  if (!approval.jobIds.includes(job.jobId)) return { ok: false, reason: "job-not-approved" };
  if (!approval.allowedProviders.includes(job.provider) || !policy.allowedProviders.includes(job.provider)) {
    return { ok: false, reason: "provider-not-approved" };
  }
  if (!approval.allowedModels.includes(job.model) || !policy.allowedModels.includes(job.model)) {
    return { ok: false, reason: "model-not-approved" };
  }
  if (approval.currency !== input.currency) return { ok: false, reason: "currency-mismatch" };
  if (job.attempt > Math.min(approval.maxAttemptsPerJob, policy.maxAttemptsPerJob)) {
    return { ok: false, reason: "attempt-limit" };
  }
  if (input.estimatedCost === null || !Number.isFinite(input.estimatedCost) || input.estimatedCost < 0) {
    return policy.mode === "policy-auto" ? { ok: false, reason: "unknown-cost" } : { ok: true };
  }
  if (input.estimatedCost > approval.maxSpend) return { ok: false, reason: "approval-budget-exceeded" };
  if (policy.maxSpend !== null && input.estimatedCost > policy.maxSpend) {
    return { ok: false, reason: "policy-budget-exceeded" };
  }
  return { ok: true };
}
