# Functional Model Identity Repair

Parent: `d6f10408a164f346d8ed27b1f80548c6dacd3f52`. Independent local commit; coordinator owns integration and complete CI. No TSX, scene3d, visionReviewModels, media generation, credentials, proxy or memory edits.

## Design Card

| Field | Decision / Evidence |
| --- | --- |
| 1. Workflow | Reopen an existing storyboard, read its strategy, choose a recipe model, and materialize a video output without crossing suppliers. Real-provider execution is unverified and forbidden in this batch. Focused same-name multi-vendor and old-plan tests are required. |
| 2. Owner | PlanShot owns persisted modelVendor/modelKey/variantId; cinematic schema and migration project these into independent strategy fields. Recipe target selection owns pair-aware candidate resolution. Existing shared/textModelCapabilities owns pure selected-model capability inference. Generate door maps before and after. |
| 3. Reuse | Reuse the existing video-default resolver and shared capability module. Remove both duplicated capability implementations, retaining their public three-argument exports. The predicates do not choose or resolve suppliers. |
| 4. States | Explicit pair selects that supplier; missing supplier resolves only an unambiguous compatible identity; ambiguity rejects instead of first-vendor wins. Unset legacy identity stays unset. Existing video selection survives defaulting, including edits while awaiting a default. No quality/availability logic changes. |
| 9. Acceptance / Rollback | RED then GREEN: schema/migration/readers, recipe selector and tool-parameter boundary, video nodes, and all original renderer/main detector tests. Unchanged identity gate and baseline; scoped lint/typecheck and v3 contract. Coordinator independently integrates; revert this batch to roll back. |

## Investigation

- Read main `contracts-exploration-01.log:5546`: five new findings, reproduced unchanged locally.
- Actual migration bug: `shot.variantId` is assigned to `strategy.providerId`. New strategies use vendorKey from modelVendor and a separate variantId.
- Existing providerId is ambiguous historical data: keep its bytes and accept it in schema, but never infer routing or variants from it. Original PlanShot vendor/variant fields remain readable. A strategy changing modelKey without vendor must not retain the previous model's vendor.
- Recipe selection currently ignores vendor in both explicit and source preferences. Strict shared tool params also lack vendorKey, requiring an additive field and handler propagation.
- Video-default owner already returns modelVendor; the row-output callback type and node projection lose it. Pair changes must invalidate stale identity metadata, while existing user-selected video settings remain authoritative when no storyboard video override exists.
- Both image/PDF detectors have identical metadata-first algorithms and regexes. Consolidation changes ownership, not behavior, signatures, families or supplier selection.
- Delivery preflight attempted once: fetch failed because the existing localhost proxy port 7897 is unavailable. No proxy change or retry; remote freshness remains unverified.

## Verification

- RED: unchanged identity gate reproduced all five new findings. Initial focused slice: 12 failures / 72 passes across 7 files, covering supplier loss, same-name cross-vendor first-match, variant/provider confusion, await overwrite and duplicate capability ownership.
- GREEN: initial repaired slice 84/84; the actual plan-only handler adds 4 passing end-to-end argument/source-supplier cases without invoking generation.
- Final extended suite: 15 files, 216 tests passed, including original renderer/main detectors, historical readers, available-model defaults, planned-node metadata, recipe tooling, video outputs/converter, i18n protocol preservation and shared creative-schema admission/budget tests.
- One-hop follow-up: sourceNodeId and first-frame-linked derived videos initially failed (2 failures / 21 passes). Share the converter's existing read-only lookup before applying defaults; those tests and the original converter suite then pass (2 files / 31 tests).
- The expanded suite first exposed a real 10022 > 10000 schema-budget failure from the new vendorKey description. Only that new field's description was shortened to keep the existing budget; no thresholds, existing descriptions, assertions or capabilities were changed. Final original budget regressions pass.
- Existing tsconfig.test options: 18 changed TypeScript files passed scoped syntax/semantic diagnostics. Scoped ESLint passed with --max-warnings=0.
- check:model-identity passes: five new findings -> zero; its existing baseline and checker are unchanged. Known baseline identities remain, not claimed globally eliminated.
- Generated door map: 32 before -> 33 after. Two former local metaFlag copies become one shared owner; shared derived-video lookup adds explicit reads from conversion and row materialization. Existing public import paths remain re-exports, not parallel implementations.
- V3 checker exits 0 with two non-blocking warnings: the renderer compatibility facade and agentUserContent's removed detector implementation have no local door among the target symbols. Actual external predicate consumers and shared helper are mapped. No fake door or checker exception is added.
- No TSX, scene3d, visionReviewModels source/test, package, CI, baseline, credentials, proxy or memory edits. No actual media/provider execution; complete CI belongs to the coordinator.
- Delivery preflight remains unverified due to the existing local proxy transport failure. Tool-launch-only tsx CLI/ESM probes did not yield a separate exact token count; the actual existing budget regression did run and pass.

Focused final command:

```sh
pnpm exec vitest run src/workbench/domain/cinematicTypes.test.ts src/workbench/domain/shotSpecMigration.test.ts src/workbench/domain/shotSpecReaders.test.ts src/workbench/generationCanvas/agent/capabilityRecipeAgent.test.ts src/workbench/generationCanvas/agent/capabilityRecipeToolHandlers.test.ts src/workbench/generationCanvas/agent/availableModels.test.ts src/workbench/generationCanvas/agent/plannedNodeMeta.test.ts src/workbench/generationCanvas/nodes/render/storyboardRowOutputs.test.ts src/config/textModelCapabilities.test.ts electron/ai/agentUserContent.test.ts electron/shared/textModelCapabilities.test.ts electron/shared/agentCapabilities/creativeComponent.test.ts src/workbench/capability/creativeToolExecute.test.ts src/i18n/capabilityWorkflow.test.ts src/workbench/generationCanvas/agent/convertShotToVideo.test.ts --maxWorkers=1
```

## Changed Paths

```text
docs/fixes/2026-10-25-functional-model-identity.root-cause.json
docs/plan/2026-10-25-functional-model-identity.md
electron/ai/agentUserContent.ts
electron/shared/agentCapabilities/creativeComponentSchemas.ts
electron/shared/textModelCapabilities.test.ts
electron/shared/textModelCapabilities.ts
src/config/textModelCapabilities.ts
src/i18n/locales/capabilityWorkflow.ts
src/workbench/domain/cinematicSchema.ts
src/workbench/domain/cinematicTypes.test.ts
src/workbench/domain/cinematicTypes.ts
src/workbench/domain/shotSpecMigration.test.ts
src/workbench/domain/shotSpecMigration.ts
src/workbench/generationCanvas/agent/capabilityRecipeAgent.test.ts
src/workbench/generationCanvas/agent/capabilityRecipeAgent.ts
src/workbench/generationCanvas/agent/capabilityRecipeToolHandlers.test.ts
src/workbench/generationCanvas/agent/capabilityRecipeToolHandlers.ts
src/workbench/generationCanvas/agent/convertShotToVideo.ts
src/workbench/generationCanvas/nodes/render/storyboardRowOutputs.test.ts
src/workbench/generationCanvas/nodes/render/storyboardRowOutputs.ts
```

## Handoff / Residual Risks

- Historical providerId cannot safely distinguish supplier from variant. It remains parseable and byte-preserved, never guessed into routing; existing PlanShot identity remains authoritative.
- Bare names with multiple compatible suppliers now fail visibly. Callers must pass vendorKey, or provide an unambiguous source identity; no catalog-order supplier default is introduced.
- Source preferences remain preferences: when the actual source pair is incompatible, existing automatic compatible-model fallback remains, subject to the ambiguity guard. Explicit unavailable pairs reject instead of substituting a supplier.
- The coordinator owns remote freshness, integration, full CI and the concurrent visionReviewModels repair. This is a local-only independent commit.
