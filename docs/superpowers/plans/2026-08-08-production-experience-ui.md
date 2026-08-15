# Production Experience UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project the durable production Run into Nomi's existing assistant, task center, confirmation dialog, notifications, and settings without adding a second control surface.

**Architecture:** Renderer hooks poll/replay the typed main-process run projection and derive a small view model. Existing surfaces render it: the generation assistant owns current state, the task center owns queue detail, the asset library owns candidates, and Settings owns reusable policy. Contextual approval remains in the existing spend-confirm dialog shell.

**Tech Stack:** React 18, Zustand, Electron preload bridge, Tailwind tokens, react-i18next, Vitest, Playwright Electron.

---

### Task 1: Persist global automation and privacy settings

**Files:**
- Create: `electron/settings/automationPolicySettings.ts`
- Test: `electron/settings/automationPolicySettings.test.ts`
- Create: `electron/settings/automationPolicyIpc.ts`
- Test: `electron/settings/automationPolicyIpc.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/settingsBridge.ts`

- [ ] **Step 1: Write failing normalization and IPC tests**

Cover missing/corrupt JSON defaults, unknown host stripping, policy mode validation, notification booleans, upload minimization, atomic persistence, and handler registration.

```ts
expect(normalizeAutomationSettings({ mode: "anything", trustedHosts: ["codex", "evil"] })).toMatchObject({
  mode: "balanced",
  trustedHosts: ["codex"],
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run electron/settings/automationPolicySettings.test.ts electron/settings/automationPolicyIpc.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement atomic settings and typed bridge**

Use `getSettingsRoot()` and `writeJsonFileAtomic`. Do not move live approvals into settings.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run electron/settings/automationPolicySettings.test.ts electron/settings/automationPolicyIpc.test.ts && pnpm run typecheck`

```bash
git add electron/settings/automationPolicy* electron/main.ts electron/preload.ts src/desktop/settingsBridge.ts
git commit -m "feat(settings): persist automation and privacy policy"
```

### Task 2: Add settings tabs using focused sections

**Files:**
- Create: `src/workbench/settings/AiModelsSection.tsx`
- Create: `src/workbench/settings/AutomationPermissionsSection.tsx`
- Create: `src/workbench/settings/settingsAutomationView.ts`
- Test: `src/workbench/settings/settingsAutomationView.test.ts`
- Modify: `src/workbench/settings/SettingsDialog.tsx`
- Modify: `src/i18n/locales/settings.ts`
- Test: `src/workbench/settings/settingsDialogStructure.test.ts`

- [ ] **Step 1: Write failing view-model and structure tests**

Assert the five tabs, Balanced default, trusted-host states, provider health labels, privacy copy, and absence of duplicated task notification controls.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run src/workbench/settings/settingsAutomationView.test.ts src/workbench/settings/settingsDialogStructure.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement the approved settings layout**

Use Tabler icons, `DesignSwitch`, existing tokens, and the approved 196px-left-rail hierarchy. Move task sound/system-notification preferences from `taskCenterSettings.ts` into the persisted global settings; delete the old localStorage preference writer in the same change.

- [ ] **Step 4: Run tests and i18n/token gates**

Run: `pnpm vitest run src/workbench/settings && pnpm run check:tokens && pnpm run check:i18n`

- [ ] **Step 5: Commit**

```bash
git add src/workbench/settings src/workbench/taskCenter/taskCenterSettings.ts src/i18n/locales/settings.ts
git commit -m "feat(settings): add AI and automation policy controls"
```

### Task 3: Add the renderer production-run projection

**Files:**
- Create: `src/workbench/production/productionRunApi.ts`
- Create: `src/workbench/production/productionRunStore.ts`
- Create: `src/workbench/production/productionRunView.ts`
- Test: `src/workbench/production/productionRunView.test.ts`
- Create: `src/workbench/production/useActiveProductionRun.ts`

- [ ] **Step 1: Write failing view-model tests**

Cover running with known/unknown progress, stale vendor state, pending gate, submission unknown, latest safe artifact, one primary action, and details rows.

```ts
expect(buildProductionRunView(runUnknown)).toMatchObject({
  tone: "danger",
  titleKey: "production.status.submissionUnknown",
  primaryAction: "reconcile",
  percent: undefined,
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run src/workbench/production/productionRunView.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement cursor-aware polling**

Load the active project run, poll new events with the last cursor, and refresh the snapshot only when the run revision changes. Keep ephemeral polling timestamps in the store; do not persist renderer state as a second truth.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run src/workbench/production && pnpm run typecheck`

```bash
git add src/workbench/production
git commit -m "feat(run-ui): derive observable production status"
```

### Task 4: Render the current production state in the existing assistant

**Files:**
- Create: `src/workbench/production/ProductionStatusPanel.tsx`
- Create: `src/workbench/production/ProductionDetails.tsx`
- Test: `src/workbench/production/productionStatusStructure.test.ts`
- Modify: `src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx`
- Modify: `src/i18n/locales/generationCommon.ts`

- [ ] **Step 1: Write failing structural tests**

Assert one title, one preview, one primary action, one details disclosure, safe origin label, and no fake `%` when progress is absent.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run src/workbench/production/productionStatusStructure.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement the approved panel**

When an active run exists, `CanvasAssistantPanel` renders `ProductionStatusPanel` above chat history and keeps the existing composer available for adjustments. The latest artifact uses existing safe media URL helpers. Deep actions select the relevant node or open the gate; they do not duplicate task-center controls.

- [ ] **Step 4: Run component, i18n, and token checks**

Run: `pnpm vitest run src/workbench/production && pnpm run check:tokens && pnpm run check:i18n`

- [ ] **Step 5: Commit**

```bash
git add src/workbench/production src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx src/i18n/locales/generationCommon.ts
git commit -m "feat(run-ui): show production truth in assistant"
```

### Task 5: Extend the existing spend dialog into the contract gate

**Files:**
- Create: `src/workbench/generationCanvas/spend/ProductionContractSummary.tsx`
- Create: `src/workbench/generationCanvas/spend/productionContractView.ts`
- Test: `src/workbench/generationCanvas/spend/productionContractView.test.ts`
- Modify: `src/workbench/generationCanvas/spend/spendConfirm.ts`
- Modify: `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx`
- Modify: `src/i18n/locales/generationCommon.ts`

- [ ] **Step 1: Write failing contract projection tests**

Cover plan version/hash, specs, claims/evidence, Skill list, provider/model, retry boundary, known cost range, unknown cost, and irreversible-action note.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run src/workbench/generationCanvas/spend/productionContractView.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Add `kind: 'contract'` to the existing confirmation store**

Do not create a second dialog store. The confirm button submits a durable gate decision through `productionRun.command`; only legacy one-off generation continues to mint a transient spend grant.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run src/workbench/generationCanvas/spend && pnpm run check:i18n && pnpm run typecheck`

```bash
git add src/workbench/generationCanvas/spend src/i18n/locales/generationCommon.ts
git commit -m "feat(run-ui): combine production contract and budget gate"
```

### Task 6: Project runs into the task center and notifications

**Files:**
- Modify: `src/workbench/taskCenter/taskCenterEntries.ts`
- Test: `src/workbench/taskCenter/taskCenterEntries.test.ts`
- Modify: `src/workbench/taskCenter/TaskCenterPanel.tsx`
- Modify: `src/workbench/taskCenter/useBatchFinishNotifier.ts`
- Create: `src/workbench/production/useProductionRunNotifier.ts`
- Modify: `src/ui/app-shell/NomiAppBar.tsx`

- [ ] **Step 1: Write failing projection tests**

Cover durable running jobs, gate-needed, submission-unknown, honest cancel labels, and deduplication against current in-memory queue rows.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run src/workbench/taskCenter`  
Expected: FAIL on production projections.

- [ ] **Step 3: Integrate the existing task center**

The app-bar task chip counts durable jobs and pending gates. Notifications fire only on stage change, gate, failure, stale-vendor threshold, and completion; notification clicks open a safe Nomi deep link.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run src/workbench/taskCenter src/workbench/production && pnpm run typecheck`

```bash
git add src/workbench/taskCenter src/workbench/production/useProductionRunNotifier.ts src/ui/app-shell/NomiAppBar.tsx
git commit -m "feat(run-ui): surface production tasks and notifications"
```

### Task 7: Electron visual verification

**Files:**
- Create: `tests/e2e/production-experience.spec.ts`
- Create: `docs/design/mockups/2026-08-08-agentic-production/implementation-checklist.md`

- [ ] **Step 1: Add deterministic fixture IPC data**

Use the existing E2E injection pattern to expose running, pending-contract, submission-unknown, and settings states without paid calls.

- [ ] **Step 2: Capture light and dark screenshots**

Run: `pnpm playwright test tests/e2e/production-experience.spec.ts`  
Expected: screenshots for the four approved states at desktop and narrow desktop widths.

- [ ] **Step 3: Manually read every screenshot**

Compare hierarchy, text wrapping, thumbnail visibility, one-action rule, modal size, scroll behavior, and no overlaps against the approved HTML mockup. Record each comparison in the checklist and fix any mismatch before proceeding.

- [ ] **Step 4: Run full gates and commit**

Run: `pnpm run gates`

```bash
git add tests/e2e/production-experience.spec.ts docs/design/mockups/2026-08-08-agentic-production/implementation-checklist.md
git commit -m "test(run-ui): verify approved production experience"
```
