# Production MCP And Real-Task Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let external hosts safely start and observe draft production runs, then prove the complete Nomi-controlled workflow with fault injection and production Electron journeys.

**Architecture:** MCP maps four read-mostly tools onto `ProductionRunService`. Tool results return redacted projections, resumable cursors, scoped artifact previews, and Nomi deep links. The final evaluation harness runs deterministic fault cases plus explicitly authorized real model tasks against a frozen rubric.

**Tech Stack:** Existing custom MCP protocol, capability core RPC, Electron deep links, Vitest, Playwright Electron, production build.

---

### Task 1: Add safe production MCP methods to capability core

**Files:**
- Modify: `electron/capabilityCore/dispatcher.ts`
- Modify: `electron/capabilityCore/core.ts`
- Modify: `electron/capabilityCore/gateway.ts`
- Test: `electron/capabilityCore/productionRunCore.test.ts`

- [ ] **Step 1: Write failing dispatch tests**

Cover `production.start`, `production.get`, `production.events`, and `production.artifact`. Verify start creates only a draft, get/events are read-only, unknown project/run is actionable, and none of the methods accepts approval or paid-dispatch fields.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/capabilityCore/productionRunCore.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Inject ProductionRunService into dispatcher deps**

```ts
export type CapabilityDeps = {
  productionRuns: Pick<ProductionRunService, "createDraft" | "readProjection" | "readEvents" | "readArtifactProjection">;
  // existing task deps
};
```

The disk and renderer gateways must return the same projection; active-project routing cannot change business semantics.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run electron/capabilityCore/productionRunCore.test.ts electron/capabilityCore/core.test.ts`

```bash
git add electron/capabilityCore/dispatcher.ts electron/capabilityCore/core.ts electron/capabilityCore/gateway.ts electron/capabilityCore/productionRunCore.test.ts
git commit -m "feat(mcp): add production run capability methods"
```

### Task 2: Add four MCP tools and resumable results

**Files:**
- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Test: `electron/capabilityCore/nomiMcpProductionRuns.test.ts`
- Modify: `electron/capabilityCore/mcpStdioServer.ts`

- [ ] **Step 1: Write failing protocol tests**

Assert tool schemas and annotations for:

```text
nomi_start_playbook
nomi_get_run
nomi_subscribe_run
nomi_get_artifact
```

`nomi_start_playbook` is not annotated read-only but cannot spend. The other three are read-only. Assert no approval/publish/cancel tools exist.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/capabilityCore/nomiMcpProductionRuns.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement schemas and concise terminal text**

`nomi_subscribe_run` accepts `afterCursor` and `waitMs` capped at 25 seconds; it returns only meaningful events and a next cursor. This is long polling, not a fake stream over stdio.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run electron/capabilityCore/nomiMcpProductionRuns.test.ts electron/capabilityCore/nomiMcp*.test.ts`

```bash
git add electron/capabilityCore/mcpProtocol.ts electron/capabilityCore/mcpStdioServer.ts electron/capabilityCore/nomiMcpProductionRuns.test.ts
git commit -m "feat(mcp): expose draft and observable production tools"
```

### Task 3: Add scoped previews and Nomi deep links

**Files:**
- Create: `electron/productionRun/artifactProjection.ts`
- Test: `electron/productionRun/artifactProjection.test.ts`
- Create: `electron/productionRun/productionDeepLink.ts`
- Test: `electron/productionRun/productionDeepLink.test.ts`
- Modify: `electron/main.ts`
- Modify: `src/utils/appRoutes.ts`
- Modify: `src/workbench/NomiStudioApp.tsx`

- [ ] **Step 1: Write failing security tests**

Reject `..`, encoded traversal, wrong-project artifact IDs, expired preview tokens, absolute paths, provider URLs, and forged deep-link run/project pairs.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/productionRun/artifactProjection.test.ts electron/productionRun/productionDeepLink.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement scoped projections**

Return `nomi://project/<projectId>/run/<runId>?artifact=<artifactId>` and an expiring local preview handle. Reuse existing `nomi-local` media serving rules; do not invent a second unrestricted file protocol.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run electron/productionRun/artifactProjection.test.ts electron/productionRun/productionDeepLink.test.ts && pnpm run typecheck`

```bash
git add electron/productionRun/artifactProjection* electron/productionRun/productionDeepLink* electron/main.ts src/utils/appRoutes.ts src/workbench/NomiStudioApp.tsx
git commit -m "feat(run): add scoped previews and production deep links"
```

### Task 4: Upgrade the MCP Apps widget to a run projection

**Files:**
- Modify: `electron/capabilityCore/mcpAppWidget.ts`
- Test: `electron/capabilityCore/mcpAppWidget.test.ts`
- Modify: `electron/capabilityCore/mcpProtocol.ts`

- [ ] **Step 1: Write failing widget contract tests**

Assert one plain-language status, one latest preview, one `在 Nomi 打开` action, no absolute path, no raw prompt, and honest unknown progress.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/capabilityCore/mcpAppWidget.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Replace the generate-only widget projection**

Keep `nomi_generate` compatibility text, but use the run widget for the four production tools. Delete superseded `nomiDraft` fields that claim a one-shot generate is a live production.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run electron/capabilityCore/mcpAppWidget.test.ts electron/capabilityCore/nomiMcpProductionRuns.test.ts`

```bash
git add electron/capabilityCore/mcpAppWidget.ts electron/capabilityCore/mcpAppWidget.test.ts electron/capabilityCore/mcpProtocol.ts
git commit -m "feat(mcp): project production runs in host widgets"
```

### Task 5: Build deterministic fault-injection evaluations

**Files:**
- Create: `tests/production/productionFaultMatrix.test.ts`
- Create: `tests/production/productionSecurityMatrix.test.ts`
- Create: `tests/production/productionRubric.ts`
- Create: `docs/evals/2026-08-08-agentic-production-rubric.md`

- [ ] **Step 1: Freeze criterion-specific rubric before running**

Rubric criteria: observability, spend safety, restart recovery, Skill evidence, artifact discoverability, path privacy, truthful progress, and actionable failure. Each criterion names exact evidence and pass/fail conditions.

- [ ] **Step 2: Add failure injection tests**

Cover every repository write boundary, lost provider receipt, stale polling, provider-cancel refusal, expired gate, budget overflow, untrusted host, traversal, and corrupted snapshot.

- [ ] **Step 3: Run deterministic evaluation**

Run: `pnpm vitest run tests/production electron/productionRun electron/capabilityCore`  
Expected: all rubric criteria pass with saved machine-readable results.

- [ ] **Step 4: Commit**

```bash
git add tests/production docs/evals/2026-08-08-agentic-production-rubric.md
git commit -m "test(run): add production fault and security rubric"
```

### Task 6: Run production Electron R16 journeys

**Files:**
- Create: `tests/e2e/production-r16.spec.ts`
- Create: `docs/evals/2026-08-08-agentic-production-results.md`
- Create: `docs/evals/2026-08-08-agentic-production/screenshots/.gitkeep`

- [ ] **Step 1: Implement the six approved journeys**

Use the exact tasks from design spec section 17. Mocked vendor paths cover deterministic failure cases. Real provider generation is permitted for evaluation under repository policy and must record actual spend.

- [ ] **Step 2: Build production Electron**

Run: `pnpm run build`  
Expected: PASS.

- [ ] **Step 3: Execute Playwright Electron journeys**

Run: `pnpm playwright test tests/e2e/production-r16.spec.ts --workers=1`  
Expected: six journeys pass and save screenshots for light/dark and recovery states.

- [ ] **Step 4: Manually inspect screenshots and fix every issue**

Read each screenshot, check canvas/panel/modal overlap, text fit, action hierarchy, image rendering, notification/deep-link target, and truthful status. Any defect returns to RED with a regression test before the fix.

- [ ] **Step 5: Record actual evaluation spend and evidence**

Write results, exact model/provider, actual cost if available, screenshots, run IDs, fault mode, and pass/fail per rubric criterion. Do not include secrets or absolute user paths.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/production-r16.spec.ts docs/evals/2026-08-08-agentic-production
git commit -m "test(run): complete real production journeys"
```

### Task 7: Final integration and delivery

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-08-08-production-mcp-evals.md`

- [ ] **Step 1: Update only verified capability claims**

Document local-first storage, optional external APIs, external-host draft initiation, Nomi-controlled end-to-end production, and open source. Do not claim all computation is local.

- [ ] **Step 2: Run the complete gate suite**

Run: `pnpm run gates && pnpm playwright test tests/e2e/production-experience.spec.ts tests/e2e/production-r16.spec.ts --workers=1`  
Expected: PASS.

- [ ] **Step 3: Verify clean diff and no leaked paths/secrets**

Run: `git diff --check && pnpm run check:secrets && git status --short`  
Expected: only intended plan completion and verified documentation changes.

- [ ] **Step 4: Commit and push the isolated worktree**

```bash
git add README.md README.zh-CN.md docs/superpowers/plans/2026-08-08-production-mcp-evals.md
git commit -m "feat(run): deliver observable agentic production"
git push origin HEAD:main
```

- [ ] **Step 5: Resume promotional video only now**

Create a new production run through the verified `brand.promo` flow. The product acceptance result, not the existence of code, is the prerequisite.

