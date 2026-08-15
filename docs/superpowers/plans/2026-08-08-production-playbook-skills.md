# Production Playbook And Skill Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `brand.promo` a real staged production driver and record loader-owned evidence for every Skill that affects a run.

**Architecture:** A `ProductionPlaybookDriver` resolves a validated Skill manifest, creates durable stage commands, constrains tool exposure per stage, and pauses only at durable gates. Skill discovery/load/apply evidence comes from the loader and driver, while the agent trace consumes the canonical top-level Skill selection contract.

**Tech Stack:** TypeScript, Zod Skill manifests, existing agent runtime, production Run repository, Vitest.

---

### Task 1: Normalize the Skill selection contract

**Files:**
- Create: `electron/skills/skillSelection.ts`
- Test: `electron/skills/skillSelection.test.ts`
- Modify: `electron/ai/agentChatV2Ipc.ts`
- Modify: `electron/events/agentChatTrace.ts`
- Test: `electron/events/agentChatTrace.test.ts`
- Modify: `src/workbench/ai/workbenchAiClient.ts`

- [ ] **Step 1: Write the failing regression test**

Pass a payload containing the current nested renderer form and prove the canonical trace records the selected key exactly once.

```ts
expect(resolveSkillSelection({ chatContext: { skill: { key: "brand.promo", name: "Brand Promo" } } })).toEqual({
  skillKey: "brand.promo",
  skillName: "Brand Promo",
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/skills/skillSelection.test.ts electron/events/agentChatTrace.test.ts`  
Expected: FAIL on the nested-field mismatch.

- [ ] **Step 3: Implement one normalization boundary**

Normalize legacy payloads at IPC ingress, then write only top-level `skillKey`/`skillName`. Delete the nested renderer write path in the same change.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run electron/skills/skillSelection.test.ts electron/events/agentChatTrace.test.ts src/workbench/ai && pnpm run typecheck`

```bash
git add electron/skills/skillSelection* electron/ai/agentChatV2Ipc.ts electron/events/agentChatTrace* src/workbench/ai/workbenchAiClient.ts
git commit -m "fix(skills): trace the canonical selected Skill"
```

### Task 2: Emit loader-owned Skill evidence

**Files:**
- Create: `electron/skills/skillExecutionEvidence.ts`
- Test: `electron/skills/skillExecutionEvidence.test.ts`
- Modify: `electron/skills/skillStore.ts`
- Modify: `electron/events/types.ts`

- [ ] **Step 1: Write failing evidence tests**

Cover discovery, successful load with content hash/version, manifest validation failure, stage application, and redaction of absolute Skill paths.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/skills/skillExecutionEvidence.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement evidence from validated records**

```ts
export type LoadedSkillEvidence = {
  skillKey: string;
  directoryName: string;
  version: string | null;
  contentSha256: string;
  stageId: string;
  reason: string;
};
```

The event writer receives no absolute `filePath`. A model response cannot call this API.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run electron/skills/skillExecutionEvidence.test.ts electron/skills/skillStore.test.ts`

```bash
git add electron/skills/skillExecutionEvidence* electron/skills/skillStore.ts electron/events/types.ts
git commit -m "feat(skills): record loader-owned execution evidence"
```

### Task 3: Upgrade PlaybookRun into a durable production driver

**Files:**
- Create: `electron/skills/productionPlaybookDriver.ts`
- Test: `electron/skills/productionPlaybookDriver.test.ts`
- Modify: `electron/skills/playbookOrchestrator.ts`
- Test: `electron/skills/playbookOrchestrator.test.ts`

- [ ] **Step 1: Write failing driver tests**

Cover manifest resolution, DAG order, stage tool allowlist, durable pause, resume after gate, crash/restart from repository state, provider capability preflight, and forbidden-tool rejection.

```ts
await expect(driver.executeTool(runId, "storyboard", "canvas.deleteNodes", {})).rejects.toThrow("not allowed in stage");
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/skills/productionPlaybookDriver.test.ts electron/skills/playbookOrchestrator.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement the driver**

`PlaybookRun` remains the pure DAG cursor. The driver owns repository commands, preflight, loader evidence, and tool enforcement.

```ts
export interface ProductionStageExecutor {
  execute(input: { run: ProductionRun; stage: SkillStage; allowedTools: ReadonlySet<string> }): Promise<StageExecutionResult>;
}
```

Stage completion commits artifacts/evidence before creating a gate or advancing.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run electron/skills/productionPlaybookDriver.test.ts electron/skills/playbookOrchestrator.test.ts && pnpm run typecheck`

```bash
git add electron/skills/productionPlaybookDriver* electron/skills/playbookOrchestrator*
git commit -m "feat(playbook): drive durable staged productions"
```

### Task 4: Make brand.promo executable and honest

**Files:**
- Modify: `skills/brand-promo/skill.json`
- Modify: `skills/brand-promo/SKILL.md`
- Test: `electron/skills/brandPromoProduction.test.ts`

- [ ] **Step 1: Write the failing manifest contract test**

Assert stages for brief/direction, contract, anchors, production, rough cut, and export; explicit dependencies; minimal tool allowlists; Balanced gates; and no tool name missing from the real tool registry.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/skills/brandPromoProduction.test.ts`  
Expected: FAIL because the current playbook is not wired to the production contract.

- [ ] **Step 3: Update manifest and methodology**

Keep claims honest: local-first storage, optional external APIs, Codex/Claude connectivity, open source, and end-to-end workflow only after the driver is enabled. Do not encode the Nomi promotional script itself into the reusable Skill.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run electron/skills/brandPromoProduction.test.ts electron/skills/skillManifestSchema.test.ts`

```bash
git add skills/brand-promo electron/skills/brandPromoProduction.test.ts
git commit -m "feat(playbook): make brand promo production executable"
```

### Task 5: Connect the driver to Nomi's run commands

**Files:**
- Create: `electron/productionRun/productionRunService.ts`
- Test: `electron/productionRun/productionRunService.test.ts`
- Modify: `electron/productionRun/productionRunIpc.ts`
- Modify: `electron/capabilityCore/appIntegration.ts`

- [ ] **Step 1: Write failing service tests**

Create draft, generate direction/contract without paid dispatch, approve, start, pause at exception, and resume. Verify the service is the only caller that can advance playbook stages.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/productionRun/productionRunService.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement the service boundary**

Expose `createDraft`, `approveGate`, `startApprovedRun`, `pause`, and `reconcileSubmission` to internal IPC. Do not expose approval methods to MCP in this release.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run electron/productionRun/productionRunService.test.ts electron/skills && pnpm run typecheck`

```bash
git add electron/productionRun/productionRunService* electron/productionRun/productionRunIpc.ts electron/capabilityCore/appIntegration.ts
git commit -m "feat(playbook): connect staged driver to production runs"
```

### Task 6: Playbook integration gate

**Files:**
- Modify: `docs/superpowers/plans/2026-08-08-production-playbook-skills.md`

- [ ] **Step 1: Run Skill and playbook suites**

Run: `pnpm vitest run electron/skills electron/events/agentChatTrace.test.ts electron/productionRun`

- [ ] **Step 2: Run full gates**

Run: `pnpm run gates`

- [ ] **Step 3: Mark plan complete and commit**

```bash
git add docs/superpowers/plans/2026-08-08-production-playbook-skills.md
git commit -m "docs(playbook): complete production driver plan"
```

