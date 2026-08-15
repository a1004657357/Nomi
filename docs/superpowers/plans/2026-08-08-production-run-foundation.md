# Production Run Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the durable, single-writer production Run, approval, budget, and submission-recovery foundation required by Nomi's observable production workflow.

**Architecture:** A main-process `ProductionRunRepository` owns snapshots and an append-only command/event stream under each project. Pure reducers enforce state transitions; repository CAS and command idempotency serialize mutations. Durable approvals and budget entries are committed before a submission outbox dispatches any paid request.

**Tech Stack:** Electron main process, TypeScript, Vitest, existing `writeJsonFileAtomic`, workspace repository, existing task runtime.

---

### Task 1: Freeze domain types and transition invariants

**Files:**
- Create: `electron/productionRun/productionRunTypes.ts`
- Create: `electron/productionRun/productionRunState.ts`
- Test: `electron/productionRun/productionRunState.test.ts`

- [ ] **Step 1: Write the failing state-machine tests**

Cover the exact legal run/job paths from the approved spec, plus rejection of `submission_unknown -> submitting` and `cancel_requested -> cancelled`.

```ts
it("never resubmits an unknown submission", () => {
  expect(() => transitionJob(job("submission_unknown"), "submitting", now)).toThrow("Illegal job transition");
});

it.each([
  ["cancel_requested", "cancelled_remote"],
  ["cancel_requested", "detached"],
  ["cancel_requested", "too_late"],
] as const)("preserves honest cancellation semantics: %s -> %s", (from, to) => {
  expect(transitionJob(job(from), to, now).status).toBe(to);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run electron/productionRun/productionRunState.test.ts`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the types and pure transition maps**

Define `ProductionRun`, `StageRun`, `ProductionJob`, `ProductionGate`, `ProductionArtifact`, `RunEvent`, `RunCommand`, `Approval`, and budget entry types. Implement map-based transitions with one error type.

```ts
const JOB_TRANSITIONS: Record<ProductionJobStatus, readonly ProductionJobStatus[]> = {
  planned: ["authorization_required"],
  authorization_required: ["authorized"],
  authorized: ["submit_intent_persisted"],
  submit_intent_persisted: ["submitting"],
  submitting: ["provider_accepted", "submission_unknown"],
  provider_accepted: ["polling", "cancel_requested"],
  polling: ["downloading", "retry_wait", "needs_attention", "cancel_requested"],
  retry_wait: ["polling", "needs_attention", "cancel_requested"],
  downloading: ["validating_technical", "needs_attention"],
  validating_technical: ["validating_content", "needs_attention"],
  validating_content: ["ready", "needs_attention"],
  ready: ["adopted"],
  adopted: [],
  submission_unknown: ["reconciling", "needs_attention", "cancel_requested"],
  reconciling: ["provider_accepted", "needs_attention", "cancel_requested"],
  needs_attention: ["reconciling", "cancel_requested"],
  cancel_requested: ["cancelled_remote", "detached", "too_late"],
  cancelled_remote: [],
  detached: [],
  too_late: [],
};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run electron/productionRun/productionRunState.test.ts && pnpm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/productionRun/productionRunTypes.ts electron/productionRun/productionRunState.ts electron/productionRun/productionRunState.test.ts
git commit -m "feat(run): define durable production state machines"
```

### Task 2: Add single-writer repository with CAS and replay

**Files:**
- Create: `electron/productionRun/productionRunPaths.ts`
- Create: `electron/productionRun/productionRunReducer.ts`
- Create: `electron/productionRun/productionRunRepository.ts`
- Test: `electron/productionRun/productionRunRepository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Use a temporary project resolver. Cover create, read, monotonic cursor, repeated `commandId`, stale `expectedRevision`, restart replay, torn final event, checksum mismatch rebuild, and two repository instances competing on the same revision.

```ts
const first = repo.execute(runId, { commandId: "cmd-1", expectedRevision: 0, type: "run.start", payload: {} });
expect(first.run.revision).toBe(1);
expect(repo.execute(runId, sameCommand)).toEqual(first);
expect(() => secondRepo.execute(runId, staleCommand)).toThrowError(RevisionConflictError);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run electron/productionRun/productionRunRepository.test.ts`  
Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement paths, reducer, and repository**

Use `<project>/.nomi/runs/<runId>/run.json`, `events.ndjson`, and `commands.ndjson`. Resolve projects with `resolveWorkspaceProjectDir` and the existing runtime deps. The repository performs the synchronous critical section before returning; append records are newline-delimited, fsynced, and the snapshot is written with `writeJsonFileAtomic`.

```ts
export interface ProductionRunRepository {
  create(input: CreateProductionRunInput): ProductionRun;
  read(runId: string): ProductionRun | null;
  list(projectId: string): ProductionRunSummary[];
  execute(runId: string, command: RunCommand): RunCommandResult;
  readEvents(runId: string, afterCursor?: number): RunEvent[];
}
```

The snapshot stores `snapshotCursor`, `checksum`, and `schemaVersion`. Checksum excludes the checksum field itself. If invalid, rebuild only from valid events and preserve the corrupt snapshot as `run.corrupt-<timestamp>.json`.

- [ ] **Step 4: Run targeted tests**

Run: `pnpm vitest run electron/productionRun/productionRunRepository.test.ts electron/jsonFile.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/productionRun
git commit -m "feat(run): persist production runs with CAS replay"
```

### Task 3: Implement durable approvals and the budget ledger

**Files:**
- Create: `electron/productionRun/approvalPolicy.ts`
- Create: `electron/productionRun/budgetLedger.ts`
- Test: `electron/productionRun/approvalPolicy.test.ts`
- Test: `electron/productionRun/budgetLedger.test.ts`

- [ ] **Step 1: Write failing policy tests**

Cover plan-hash mismatch, expiry, revocation, provider/model mismatch, job-set mismatch, retry limit, global/project/run intersection, known cost ceiling, unknown cost rejection in Policy Auto, reservation dedupe, settlement, and reservation retention for unknown submission.

```ts
expect(authorizeSubmission({ approval, job, policy, now })).toEqual({ ok: true });
expect(authorizeSubmission({ approval: { ...approval, planHash: "old" }, job, policy, now })).toEqual({
  ok: false,
  reason: "plan-changed",
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm vitest run electron/productionRun/approvalPolicy.test.ts electron/productionRun/budgetLedger.test.ts`  
Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement pure approval and ledger functions**

```ts
export type EffectiveAutomationPolicy = {
  mode: "guided" | "balanced" | "policy-auto";
  trustedHosts: string[];
  allowedProviders: string[];
  allowedModels: string[];
  maxSpend: Money | null;
  maxAttemptsPerJob: number;
};

export function availableBudget(summary: BudgetLedgerSummary): number {
  return summary.authorized - summary.reserved - summary.actual - summary.unsettled;
}
```

Ledger commands use stable `billingEntryId`. They are applied through the run repository so approval and financial state share revision ordering.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run electron/productionRun/approvalPolicy.test.ts electron/productionRun/budgetLedger.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/productionRun/approvalPolicy* electron/productionRun/budgetLedger*
git commit -m "feat(run): persist approvals and budget liability"
```

### Task 4: Add the durable submission outbox

**Files:**
- Create: `electron/productionRun/submissionOutbox.ts`
- Test: `electron/productionRun/submissionOutbox.test.ts`
- Modify: `electron/submissionLedger.ts`
- Test: `electron/submissionLedger.test.ts`

- [ ] **Step 1: Write failing crash-point and dedupe tests**

Inject failures before dispatch, after dispatch, and before receipt persistence. Assert that only a known pre-dispatch failure may be retried automatically. Assert a lost receipt becomes `submission_unknown` and never calls `dispatch` twice.

```ts
await expect(outbox.submit(jobId, dispatchLostReceipt)).rejects.toThrow("receipt unknown");
await expect(outbox.submit(jobId, dispatchLostReceipt)).rejects.toThrow("reconciliation required");
expect(dispatchLostReceipt).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/productionRun/submissionOutbox.test.ts electron/submissionLedger.test.ts`  
Expected: FAIL on missing durable outbox behavior.

- [ ] **Step 3: Implement outbox orchestration**

Persist reservation and `submit_intent_persisted` before calling the injected provider dispatcher. Use `runId:jobId:attempt` as Nomi's stable idempotency key. Persist the provider task ID before polling.

Keep `submissionLedger.ts` only as the in-flight promise coalescer used inside one process; rename its public description and tests so it does not claim durable at-most-once behavior. The production outbox is the durable authority.

- [ ] **Step 4: Run targeted tests**

Run: `pnpm vitest run electron/productionRun/submissionOutbox.test.ts electron/submissionLedger.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/productionRun/submissionOutbox* electron/submissionLedger*
git commit -m "feat(run): make paid submission crash recoverable"
```

### Task 5: Expose the repository through typed Electron IPC

**Files:**
- Create: `electron/productionRun/productionRunIpc.ts`
- Test: `electron/productionRun/productionRunIpc.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/bridge.ts`
- Create: `src/desktop/productionRunBridgeTypes.ts`

- [ ] **Step 1: Write failing IPC registration and validation tests**

Verify handlers for list/read/create/command/events. Reject malformed IDs, unknown commands, stale revisions, and project/run mismatch.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/productionRun/productionRunIpc.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement a narrow bridge**

```ts
export type DesktopProductionRunBridge = {
  list: (projectId: string) => Promise<ProductionRunSummary[]>;
  read: (runId: string) => Promise<ProductionRunProjection | null>;
  createDraft: (input: CreateProductionRunInput) => Promise<ProductionRunProjection>;
  command: (runId: string, command: RunCommand) => Promise<RunCommandResult>;
  events: (runId: string, afterCursor: number) => Promise<RunEvent[]>;
};
```

Register through `registerProductionRunIpc()` from `electron/main.ts`; do not add inline handlers to the main-process shell.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run electron/productionRun/productionRunIpc.test.ts && pnpm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/productionRun/productionRunIpc* electron/main.ts electron/preload.ts src/desktop/bridge.ts src/desktop/productionRunBridgeTypes.ts
git commit -m "feat(run): expose typed production run bridge"
```

### Task 6: Foundation integration gate

**Files:**
- Create: `electron/productionRun/productionRunFaults.test.ts`
- Modify: `docs/superpowers/plans/2026-08-08-production-run-foundation.md`

- [ ] **Step 1: Add fault-injection matrix**

Test restart recovery and all write boundaries with injected fs/dispatch failures. Verify no duplicate event cursor, approval, reservation, or vendor dispatch.

- [ ] **Step 2: Run the foundation suite**

Run: `pnpm vitest run electron/productionRun electron/submissionLedger.test.ts`  
Expected: PASS.

- [ ] **Step 3: Run repository gates**

Run: `pnpm run gates`  
Expected: all gates pass and `.claude/.gates-ok` is refreshed.

- [ ] **Step 4: Mark this plan complete and commit**

```bash
git add docs/superpowers/plans/2026-08-08-production-run-foundation.md electron/productionRun/productionRunFaults.test.ts
git commit -m "test(run): verify crash and concurrency invariants"
```
