# Generation Runtime Optimization Implementation Plan

> **For Codex:** Use `implementation-builder`, test-driven development, and verification-before-completion to execute this plan task by task.

**Goal:** Make Nomi generation reliably parallel without overloading individual providers, while adding recovery, cancellation, Jimeng isolation, dependency-aware scheduling, and bounded result retention.

**Architecture:** Keep provider-specific transport code unchanged where possible. Add a renderer-side global scheduler around generation execution, propagate cancellation through the existing task action boundary, and make Codex/Jimeng process concerns explicit in Electron. Preserve the current node/result model while extending it to retain every returned asset with bounded history.

**Tech Stack:** TypeScript, React, Zustand, Electron IPC, Vitest.

---

### Task 1: Provider-aware global scheduler

**Files:**
- Create: `src/workbench/generationCanvas/runner/generationProviderScheduler.ts`
- Create: `src/workbench/generationCanvas/runner/generationProviderScheduler.test.ts`
- Modify: `src/workbench/generationCanvas/runner/generationConcurrency.ts`
- Modify: `src/workbench/generationCanvas/runner/generationRunController.ts`

Write failing scheduler tests, implement global and per-provider limits, then remove the mixed-batch Codex cap.

### Task 2: Codex progress and recovery

**Files:**
- Modify: `electron/ai/codexImagegenRunner.ts`
- Modify: `electron/ai/codexImagegenRunner.test.ts`
- Modify: `src/workbench/generationCanvas/runner/catalogTaskActions.ts`

Add inactivity detection, one safe network retry inside the idempotent Electron invocation, and visible elapsed-time heartbeats while synchronous generation is running.

### Task 3: Jimeng bridge isolation

**Files:**
- Modify: `electron/catalog/jimengWeb.ts`
- Modify: `electron/jimengWeb/runner.ts`
- Modify: `electron/jimengWeb/seedanceBridge.ts`
- Modify: matching tests and the local Seedance extension server launcher

Move Nomi to a dedicated loopback port and require the expected bridge instance identity before accepting a server.

### Task 4: Cancellation and dependency readiness

**Files:**
- Modify: generation runner contexts, task API, preload/IPC bridge, and node composer
- Add focused cancellation and ready-queue tests

Abort queued/local waits, terminate matching Codex children, expose a stop action, and launch dependents as soon as their own prerequisites complete.

### Task 5: Multi-result retention and bounded state

**Files:**
- Modify: task result parser, node result types, run actions, submission ledger, and fingerprint cache
- Add focused parser/store/cache tests

Retain every returned media asset, cap persisted node history/run records, and add TTL/LRU pruning to process caches.

### Task 6: Verification and runtime restart

Run focused Vitest suites, full typecheck, Electron/renderer builds, then restart the current source checkout and verify the capability endpoint and process ownership.
