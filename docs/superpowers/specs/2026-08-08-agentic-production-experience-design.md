# Nomi Agentic Production Experience Design

Date: 2026-08-08  
Status: Approved visual direction, implementation pending  
Baseline: `0dbc2d1b`  
Approved mockup: `docs/design/mockups/2026-08-08-agentic-production/nomi-agentic-production.html`

## 1. Outcome

Turn Nomi's existing AI, canvas, task, spend, Skill, and MCP pieces into one observable production flow that can take a video from brief to export without becoming a black box.

The first release is **host-originated and Nomi-authoritative**:

- Codex, Claude Code, Cursor, or another MCP host may create a draft production run.
- Nomi is the only edit, approval, adoption, and export surface.
- External hosts receive concise status, the latest safe preview, notifications, and a deep link into Nomi.
- There is one durable production truth. The app, MCP, notifications, and diagnostics only project it.

The promotional video is not part of this implementation cycle. It resumes only after the system passes the acceptance gates in section 17.

## 2. User Problem

The current system has useful pieces but no end-to-end production contract:

- A user cannot see what direction was selected, which Skills were actually loaded, or what the agent will spend before generation starts.
- Long vendor calls expose little usable progress and can appear frozen.
- Generated images and videos exist, but the user has no single place to see the latest result and the next required action.
- Playbook manifests declare staged review, while `PlaybookRun` is not the production driver.
- Spend grants are process-memory state, so settings alone cannot provide durable policy or audit.
- MCP exposes low-level tools but not a durable run that can be resumed and observed.
- Submission ambiguity can cause either duplicate spend or a silent dead end unless it is represented explicitly.
- Skill selection and Skill execution evidence are currently different facts; the trace reads top-level `skillKey` while a renderer path writes `chatContext.skill.key`.

The design fixes the system boundary, not only the presentation.

## 3. Decisions And Alternatives

| Approach | User experience | Cost and risk | Decision |
| --- | --- | --- | --- |
| Nomi-first | All work starts in Nomi | Least cross-host complexity, but weak for users who begin in coding agents | Keep as a future convergence path if host-originated usage is low |
| Host-first | Plans, approvals, and control stay in Codex/Claude/Cursor | Duplicates media review and permission UI across inconsistent hosts | Reject for the first release |
| Independent Run Center | Dedicated multi-project operations console | Strong for teams, excessive for the current solo-creator product | Defer until cross-project operations are proven |
| Shared-run | Nomi and every host can mutate the same run | Best takeover, highest consistency and locking cost | Defer until takeover demand is proven |
| **Host-originated, Nomi-authoritative** | Start anywhere; control, approve, and inspect in Nomi | Requires reliable deep links and notifications | **Chosen** |

This choice must be revisited if any falsification condition in section 16 is met.

## 4. Experience Principles

### 4.1 The ten-second model

The main production surface shows only:

1. One plain-language sentence describing the current truth.
2. The latest relevant thumbnail or preview.
3. One primary action.

Examples:

- `正在生成镜头 03 / 08，供应商未提供进度。`
- `镜头 03 的提交结果不明，Nomi 已停止自动重试。`
- `制作摘要已更新，需要你确认新的支出上限。`

Everything else belongs in expandable **制作详情**, the existing task center, or the existing asset library.

### 4.2 No parallel homes

- Do not add an Artifact Drawer. Candidates remain beside the current shot and in the asset library.
- Do not add a permanent Run Inspector. Diagnostics remain collapsed under 制作详情.
- Do not add a full global Run Center. The existing task center remains the cross-shot queue surface.
- A pending gate has one canonical location. Notifications and external hosts deep-link to it.

### 4.3 Honest automation

- Never synthesize progress percentages.
- `lastPollAt` means Nomi queried successfully.
- `lastVendorStateChangeAt` means the vendor's observable state changed.
- Unknown progress is rendered as unknown.
- A machine content check, human review, user approval, and artifact adoption are separate states.
- A loaded Skill is recorded by the runtime loader and validator, never by model self-report.

## 5. Approved Nomi Layout

The approved mockup reuses the existing app shell:

- The app bar keeps workbench navigation, task entry, settings, model onboarding, and export.
- The canvas remains the primary spatial surface.
- The right assistant panel becomes the current production state surface.
- The existing task center remains the detailed queue.
- The existing settings modal gains `AI 与模型` and `自动化与权限` tabs.

### 5.1 Running

The assistant panel shows:

- Origin, such as `来自 Codex`.
- Current truthful status.
- Latest completed asset, not a fabricated placeholder for the running asset.
- One action, such as `查看镜头 03`.
- Collapsed stages, Skill evidence, and budget ledger.

### 5.2 Contract and budget gate

The first paid action uses one combined production-summary gate:

- Duration, aspect ratio, language, and shot count.
- Claims and the real evidence that will support them.
- Skills the production driver will load.
- Automation boundary and retry policy.
- Provider/model selection.
- Estimated spend range and hard ceiling when pricing is known.

Approval covers only the displayed plan hash and budget envelope. Publish, delete, or overwrite remains independently gated.

If an upstream provider cannot provide a defensible cost ceiling, it cannot run in Policy Auto. The UI says the amount is unknown and asks for a narrower job-set approval.

### 5.3 Submission unknown

When a request may have reached the provider but no receipt was received:

- Stop automatic resubmission.
- Pause downstream submissions at a safe boundary.
- State the duplicate-charge risk in plain language.
- Show the persisted submit intent and reconciliation identifier in 制作详情.
- Offer one action: reconcile the provider task.

### 5.4 Settings

Settings store reusable policy, not live approvals:

- `AI 与模型`: provider connections, model capability health, default model policy, and minimum-data upload.
- `自动化与权限`: default automation mode, global risk boundaries, trusted initiators, notifications, and privacy.

Runtime gates remain contextual. A settings toggle cannot silently approve a different provider, exceed a project ceiling, upload sensitive data, publish, delete, or overwrite.

All visible strings must exist in `zh-CN` and `en`.

## 6. Three-Layer Permission Model

### Global settings

Stored in the main process and applied across projects:

- Trusted external hosts.
- Globally enabled providers and models.
- Maximum permitted automation mode.
- Default notification policy.
- Privacy and minimum-data upload policy.

### Project policy

Stored with the project:

- Allowed providers and models.
- Project budget ceiling and currency.
- Retry policy and concurrency.
- Upload scope.
- Export defaults.

### Contextual gate

Stored with the production run:

- First spend under a new plan hash.
- Budget increase.
- New provider or model.
- Sensitive upload.
- Submission reconciliation that could spend again.
- Publish, delete, or overwrite.

The effective policy is the intersection of all three layers. A lower layer may narrow authority but cannot broaden a higher layer.

## 7. Durable Domain Model

### 7.1 ProductionRun

```ts
type ProductionRun = {
  schemaVersion: number
  runId: string
  projectId: string
  revision: number
  status: ProductionRunStatus
  stageId: string
  playbook: { name: string; version: string }
  origin: { host: string; actorId?: string }
  policy: AutomationPolicy
  budget: BudgetLedgerSummary
  planVersion: number
  snapshotCursor: number
  createdAt: string
  updatedAt: string
}
```

The run owns durable stages, gates, jobs, artifacts, checkpoints, and events. Media bytes remain in the existing project asset storage; the run stores controlled references.

### 7.2 Single writer and CAS

`RunRepository` is the only writer for run state.

- Every mutation has `commandId` and `expectedRevision`.
- The repository performs compare-and-swap and increments revision exactly once.
- Durable events receive monotonic cursors in the same commit.
- `run.json` is a checksummed, versioned projection with `snapshotCursor`; events are authoritative and can rebuild it.
- A repeated `commandId` returns the original result.

The first release has one Nomi controller and does not need cross-host leases. The schema reserves controller epoch fields so Shared-run can be added without changing approval meaning.

### 7.3 Storage

New projects store production data under:

```text
<project>/.nomi/runs/<runId>/
  run.json
  events.ndjson
  commands.ndjson
  approvals.ndjson
  budget-ledger.ndjson
  jobs/<jobId>.json
```

Writes use temp-file, fsync, and atomic rename through existing JSON/file repository patterns. Legacy projects are not backfilled from canvas history because old events cannot prove spend, Skill execution, review, or provenance.

## 8. Production State Machines

### Run

```text
draft -> awaiting_contract -> ready -> running
running -> pausing -> paused -> running
running -> needs_attention -> running | cancelled
running -> awaiting_rough_cut_review -> awaiting_export
awaiting_export -> exporting -> completed
```

### Job

```text
planned -> authorization_required -> authorized
-> submit_intent_persisted -> submitting -> provider_accepted
-> polling -> downloading -> validating_technical
-> validating_content -> ready -> adopted

submitting -> submission_unknown -> reconciling | needs_attention
polling -> retry_wait -> polling
any cancellable state -> cancel_requested
cancel_requested -> cancelled_remote | detached | too_late
```

`detached` means Nomi stopped observing or adopting the task while the provider may continue charging. It must never be labeled `cancelled`.

## 9. Approval And Budget Invariants

### Approval

```ts
type Approval = {
  approvalId: string
  runId: string
  scope: 'stage' | 'job_set' | 'budget_envelope' | 'export' | 'publish'
  planHash: string
  jobIds: string[]
  allowedProviders: string[]
  allowedModels: string[]
  currency: string
  maxSpend: number
  maxAttemptsPerJob: number
  decidedAt: string
  expiresAt: string
  revokedAt?: string
}
```

Approval is durable business state. UI dialogs, notifications, and future MCP elicitation only submit a decision against the same gate. A boolean such as `spendConfirmed: true` is not authority.

### Budget ledger

The ledger distinguishes:

- `authorized`: user-approved ceiling.
- `reserved`: maximum liability for submitted or queued work.
- `actual`: provider-confirmed cost.
- `unsettled`: accepted or ambiguous work without final billing.

Invariants:

- `reserved + actual + unsettled <= authorized` before a new submission.
- Reservations are created before the submit intent is dispatched.
- Billing entries use stable `billingEntryId` deduplication.
- Unknown submissions retain their reservation until reconciliation or an explicit provider-safe release.

## 10. Submission Reliability

Generation uses a durable submit outbox:

1. Persist job, reservation, submit intent, and stable idempotency key.
2. Commit and fsync.
3. Dispatch to the provider.
4. Persist provider task ID and acceptance.
5. Poll without resubmitting.

Provider adapters expose whether they support a native idempotency key. Nomi's outbox and stable key still prevent its own retries from creating a second submission.

If transport failure leaves acceptance unknown, enter `submission_unknown`. Never automatically call submit again. Reconciliation first queries by native idempotency key, client reference, provider task list, or adapter-specific evidence. Only an explicit gate may authorize a new paid attempt when safe reconciliation is impossible.

## 11. Real Playbook Driver And Skill Evidence

`PlaybookRun` becomes a production driver rather than a test-only state object.

Each stage declares:

- Allowed read tools.
- Allowed write tools.
- Allowed paid tools.
- Required Skill selectors and version constraints.
- Entry and exit conditions.
- Pause/gate policy.

The driver loads a Skill through the existing Skill store, validates its manifest, and emits:

- `skill.discovered`
- `skill.loaded`
- `skill.applied`
- `skill.validation_failed`

Each event records the Skill key, resolved version/content hash, stage, reason, and affected artifact or decision. The model cannot emit these evidence events.

The renderer/backend request contract is normalized so `skillKey` has one canonical field. Compatibility parsing may read an old nested field during migration, but the old write path is removed in the same change.

The first publicly supported playbook is `brand.promo`, and it is exposed only after its driver, stage allowlists, gates, and end-to-end tests are real.

## 12. MCP Contract

The first release adds safe, read-mostly production tools:

```text
nomi_start_playbook  brief + playbook -> draft runId
nomi_get_run         runId -> stages, jobs, gates, budget, latest artifacts
nomi_subscribe_run   runId + cursor -> resumable event stream
nomi_get_artifact    artifactId -> safe metadata + scoped preview + nomiUri
```

Rules:

- `nomi_start_playbook` never submits a vendor job.
- MCP cannot approve, adopt, publish, delete, overwrite, or broaden policy in the first release.
- Returned paths are opaque `nomiUri` or scoped preview handles, never absolute local paths.
- Subscriptions replay from a durable cursor and deduplicate by event ID.
- Terminal hosts receive only stage changes, stale-provider warnings, artifact-ready events, failures, and gates; polling noise is suppressed.
- GUI hosts receive one sentence, the latest preview, and one deep-link action.

Low-level `nomi_generate` remains for compatibility but cannot be marketed as the complete production workflow.

## 13. Security And Privacy

- The main process owns durable policy and approval validation.
- Renderer claims are input, not authority.
- Existing spend-grant checks remain defense in depth while durable approval becomes the business source of truth.
- Tool allowlists are enforced in the runtime, not only in prompts.
- External projections redact prompts, provider URLs, secrets, and absolute paths.
- Preview handles are scoped to an artifact, expire, and cannot traverse project storage.
- Project data remains local except the exact assets and text required by an explicitly selected provider task.
- The UI distinguishes `本地保存` from `发送给所选模型`; it does not claim all computation is local when an external API is used.

## 14. Failure And Recovery UX

Every user-visible failure must answer:

1. What happened?
2. What Nomi did to protect work or spend?
3. What the user can do next?

Required cases:

- Nomi closed or target project not open: system notification and deep link to the durable gate/run.
- Vendor progress unavailable: show elapsed time and last query, not percent.
- Vendor state stale: show how long the vendor state has not changed.
- Submission unknown: stop retries and reconcile.
- Provider cannot cancel: mark detached or too late.
- Model unavailable: pause before switching provider; never silently change provider.
- App restart: recover pending gates, reservations, jobs, and event cursors from disk.
- Corrupt snapshot: verify checksum and rebuild from events; preserve corrupt data for diagnosis.

## 15. Rollout And Migration

Implementation is split into four independently verifiable slices:

1. **Reliability foundation**: RunRepository, commands/events, approvals, ledger, outbox, state machines, restart recovery, and fault injection.
2. **Nomi-authoritative experience**: production summary gate, assistant status, details, settings, notifications, task-center projection, and i18n.
3. **Playbook and Skill evidence**: real production driver, stage allowlists, canonical Skill trace, and `brand.promo`.
4. **MCP projection and real tasks**: start/read/subscribe/artifact tools, secure preview/deep links, host tests, and full user journeys.

Each slice replaces any superseded path in the same commit. No fallback implementation remains after migration.

## 16. Falsification Conditions

Review after four weeks or 100 completed runs, whichever is later:

- If at least 70% of runs start inside Nomi, simplify toward Nomi-first.
- If fewer than 80% of external starts successfully open the correct Nomi run, fix deep-link and notification reliability before adding host controls.
- If at least 25% of external starters request control in the current host, evaluate Shared-run and controller leases.
- If at least 15% of weekly active users manage two or more concurrent projects, or pending-gate rediscovery fails above 10%, design a lightweight production inbox.
- If cross-surface consistency cost exceeds measured takeover value, keep Nomi as the only writer.

These are product hypotheses, not industry facts.

## 17. Acceptance Gates

### Automated

- Repository CAS, command idempotency, cursor monotonicity, checksum recovery, and concurrent-writer tests.
- Approval scope, revocation, expiry, provider/model boundary, and budget-invariant tests.
- Outbox crash points before dispatch, after dispatch, before receipt persistence, and after provider acceptance.
- `submission_unknown` proves no automatic resubmission.
- Cancellation semantics distinguish remote-cancelled, detached, and too-late.
- Skill loader evidence proves the runtime loaded the recorded version.
- MCP auth, redaction, cursor replay, preview scope, and absolute-path leakage tests.
- Existing spend, task, agent, canvas, export, and legacy-project regressions.
- `check:filesize`, `check:tokens`, `check:i18n`, `lint:ci`, `typecheck`, `test`, and `build` all pass.

### R16 real tasks

Run in the production Electron build with screenshots manually reviewed in light and dark modes:

1. Start a `brand.promo` draft from Codex, open the correct Nomi run, inspect the recommended direction, approve one contract/budget gate, generate at least two shots, adopt a result, create a rough cut, and export locally.
2. Start from Claude Code while Nomi is on the project library, receive the global notification/gate, open the target project, and continue without losing state.
3. Kill and restart Nomi during submission/polling, recover without duplicate spend, and preserve the latest artifact and next action.
4. Inject a lost submit receipt, verify `submission_unknown`, reconcile, and prove there was no automatic second order.
5. Use an unknown-progress provider, verify that no fake percentage or ETA appears and stale vendor state is explained accurately.
6. Attempt MCP path traversal, absolute-path reads, approval mutation, untrusted-host start, and over-budget submission; all must fail with actionable messages.

Completion requires fixing every product, UI, UX, functional, and recovery defect found in these journeys, not only recording a backlog.

## 18. Adversarial Review Summary

| Role | Main objection | Resolution |
| --- | --- | --- |
| CTO | Multiple processes can corrupt a shared run | Single-writer repository, CAS, command idempotency, durable cursor |
| Product design | A new dashboard would bury the creative work | Existing assistant, task center, asset library, and settings are reused |
| Product management | Too many approvals recreate the original friction | Balanced defaults to one contract/budget gate plus irreversible actions |
| Frontend | Runtime state duplicated across panels will drift | Components project one durable run view model |
| Backend | Lost receipts and in-memory grants can duplicate spend or disappear | Durable approvals, budget ledger, submit outbox, submission-unknown state |
| Real user | Logs and percentages still feel like a black box | One sentence, latest preview, one action, truthful details, no fake progress |

## 19. Non-Goals

- No multi-user collaboration or team permissions.
- No Shared-run writes from external hosts.
- No independent Run Center or Artifact Drawer.
- No new node graph or timeline implementation.
- No promise that third-party API computation is local.
- No automatic publishing.
- No paid promotional-video generation before this system passes section 17.

## 20. Evidence And References

Current Nomi evidence:

- `src/workbench/settings/SettingsDialog.tsx`
- `src/workbench/taskCenter/TaskCenterPanel.tsx`
- `src/workbench/taskCenter/taskCenterSettings.ts`
- `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx`
- `electron/spendGrant.ts`
- `electron/submissionLedger.ts`
- `electron/skills/playbookOrchestrator.ts`
- `electron/skills/skillStore.ts`
- `electron/events/agentChatTrace.ts`
- `electron/capabilityCore/mcpProtocol.ts`
- `electron/capabilityCore/gateway.ts`

Relevant existing plans:

- `docs/plan/2026-06-21-spend-confirmation-gate.md`
- `docs/plan/2026-06-23-mcp-spend-confirm-global.md`
- `docs/plan/2026-06-27-submission-idempotency.md`
- `docs/plan/2026-06-14-agent-error-transparency.md`
- `docs/plan/2026-08-08-canvas-production-integration.md`

External patterns were verified against the official documentation for Claude Code Plan/permissions/checkpoints, Cursor Plan mode, Replit Plan/tasks/checkpoints, Lovable Plan/history, Runway Workflows/asset lineage/credits, Adobe Firefly Boards/Video Editor/history, and Descript AI video/version history/credits/export. These products inform interaction patterns; they do not prove Nomi capabilities.
