# Workflow I18n and Stable Source Values

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Base: 21c4de6ea589c78a6318f6f89d210a72d2e68604. Private branch codex/main-i18n-workflow-fix-20261025 in the existing private sibling worktree. No App launch, media generation, remote writes or memory writes.

## Design Card

| Field | Decision |
| --- | --- |
| 1. Workflow | Discover all 275 hard-zero findings, trace UI versus stored/default/protocol/prompt consumers, translate display-only text, preserve authored/source bytes, verify zh/en and save/readback. Real App/media journeys remain unverified by explicit task constraint. |
| 2. Owner | Existing i18next resources and desktopT own UI text. Neutral domain constructors own stable persisted defaults and wire/prompt source values, reused by producers and display adapters. Actual AST door-map is recorded in the v3 contract. |
| 3. Reuse | Extend existing resources and translateCanvasComponentText; keep desktop customIntegrations route. No new translation engine, exclusion, baseline, frozen counter or vocabulary/self-written registry edits. |
| 4. States | UI idle/loading/success/failure/review messages follow locale; saved defaults and Agent/protocol messages do not. Unknown user text remains unchanged at display boundaries. Approval, cancellation and retry state transitions stay unchanged. |
| 5. Interruptions | No lifecycle changes. Existing stop/close/network/restart/double-click paths remain; error display is localized without granting approval or automatically retrying anything. Real interruption walkthroughs unverified. |
| 6. External Data | Repository-owned defaults, DTOs, prompt builders and Blender harness define meaning; no external model capability assumptions or actual calls. Preserve timezone, camera geometry, IDs, enum values, prompts and source messages. |
| 7. Performance | Translation lookups only; no server/App work. Run exact source scanner and key parity/refs/fragile-match checks. Do not alter budgets or snapshot owners. |
| 8. Real Conditions | Tests cover both locales, edited user values, canonical source serialization and unchanged geometry/prompt outputs. Windows/App/clean-install/real paid journeys remain unverified. |
| 9. Acceptance | Focused red/green and original domain tests, complete categorized inventory, unchanged source scan rules/baselines/frozen owners, scoped types/lint, v3 checks and one local commit. Coordinator independently integrates and runs full CI. Roll back this commit only. |

## Investigation

- Official --report at the requested base: src hard-zero 275; model labels 0; vendor names 0 unclassified; existing Electron baseline debt 77 in 27 files.
- Forty-seven files contribute to hard-zero findings; duplicate scanner shapes account for some repeated occurrences.
- Source defaults cannot be replaced with current-language t() calls: camera output labels are editable and saved; prop labels name newly created scene objects; model3d view labels enter capture metadata; Director progress/refusal messages are saved or sent to Agent; shot titles/rationales and Blender outputs enter project data.
- Prompt instructions are not UI. Consolidate actual domain prompt/source builders, not a bag of variables or string concatenations to evade detection; test their exact bytes across locales.
- Coordinator reserves vocabulary/type/enum sharing, retry reexports, lint debt and MCP payload. Same-file text hunks must not change those semantics.
- Preflight fetch failed once on the unchanged localhost proxy. Remote freshness is unverified; no proxy/account changes.

## Evidence

- RED before production edits: 2/2 focused bilingual tests failed (standing pose and missing-source readiness).
- GREEN: 72/72 new cross-language/source-boundary tests; original 22-file domain run 224/224.
- Expanded domain run: 29 files, 289 pass / 2 fail. The two failures expose a pre-existing legacy recipe-summary display gap and an AI/manual node-kind migration-contract mismatch. Direct read-only execution of the requested base's toolCallSummary module returns list_capability_recipes too. The AI dispatcher is not changed by this batch; it creates director. Do not revert canonical behavior or alter these unrelated old assertions here.
- Scoped TypeScript: 79 changed TS/TSX files, 0 diagnostics. Scoped lint: 0 errors; new unnecessary callback dependencies removed; coordinator-owned old unused imports deliberately retained for cherry-pick resolution.
- Official read-only source report: src 0, model labels 0, vendor unclassified 0/stale 0; Electron unchanged at 77 in 27 files.
- Key parity: 7588 keys; key references: 1704 files / 7588 keys / 101 unchanged registered prefixes, 0 unresolved.
- The full pnpm check:i18n command was rejected by auto-review because it can write the Electron baseline. It was not retried or indirectly executed. Official --report returns before writeback; other subchecks are run separately. No baseline update is authorized.
- Fragile-match is still red at 13 over-baseline occurrences in 6 files, all present at base; the actual scanner functions were reused read-only to compare base/current affected counts and found zero increases.
- 48 exact prompt checks (12 recipe IDs x two identity policies x two locales) use SHA256 values characterized from base, not regenerated from the new helpers. All 16 prop geometries/colors/source names and nine model3d view metadata records retain base-derived hashes.
- Actual readonly node-title, camera-editor and result-collection markup is tested; source records are not written during render. Known source patterns are derived from the real neutral domain formatters, not copied translated wording.
- Restored Scene3D locale owner was read from 22c92ca3b^, with upstream removal d3f68057c verified. Current missing UI leaves were supplied with both locales. Capture/title/prompt writers now retain historical Chinese source values instead of turning resource restoration into locale-dependent project data.
- Door map uses unchanged mapDoors/doorsForTargets: 114 before, 181 after. Named public domain/display consumers are scanned across repository source; i18n/desktopT/resource-owner reads are also scanned within changed production consumers. All map entries are actual AST references, with no line-number identity or fabricated reduction.
- Five files have no local read/call AST door: static model descriptions, two static locale definitions and two parameter-only pure source formatter objects. The contract keeps them in full scope, documents the resulting warnings, and does not fake a door or mark handwritten definitions generated.
- Protected owner byte audit: 89 baseline/frozen/counter/registry/CI/config/style/vision-owner files match the requested base exactly; forbidden-path diff count is 0. The AI dispatcher also matches base byte-for-byte. Local commit is reported in the delivery response. No App/media/paid/remote/merge/memory action.
- V3 gate: schema valid, 5 explicitly documented pure-definition door warnings. Scoped source/locale boundary map is 114 before / 181 after, with no fake calls or generated markers.

## Remaining Fragile Matches

| Path | Baseline | Base / Current | Disposition |
| --- | ---: | ---: | --- |
| src/workbench/observability/classifyError.ts | 36 | 43 / 43 | Existing error classification; needs genuine producer/consumer machine codes, not translated substring checks. |
| src/workbench/generationCanvas/nodes/scene3d/scene3dReferenceDirector.ts | 0 | 2 / 2 | Historical first/last-frame title compatibility; new source titles are now locale-neutral and regression-tested. |
| src/workbench/generationCanvas/nodes/Scene3DEditor.tsx | 0 | 1 / 1 | Existing Blender cancellation classification; do not change cancellation behavior in a copy-only repair. |
| src/workbench/generationCanvas/nodes/scene3d/attachCameraMoveToTarget.ts | 0 | 1 / 1 | Existing exact canonical prompt-marker idempotency; prompt bytes preserved. |
| src/workbench/generationCanvas/runner/generationRetryPolicy.ts | 0 | 1 / 1 | Existing Codex timeout no-resend rule; must retain its behavior. |
| src/workbench/generationCanvas/runner/videoPromptCompiler.ts | 0 | 1 / 1 | Existing screen-constraint prompt idempotency; no prompt changes here. |

## Complete Source Inventory

All 275 original occurrences in 47 files are classified below. Counts are the original scanner counts, including duplicate scanner shapes. No exclusion/threshold/baseline was changed.

| Original File | Count | Actual Boundary / Disposition |
| --- | ---: | --- |
| `electron/ai/canvasTools.ts` | 2 | Model-facing metadata: equivalent single-English descriptions; no locale-dependent schema. |
| `electron/blender/shotBlenderBridge.ts` | 3 | Visible diagnostics/report text: existing desktopT/customIntegrations owner. |
| `electron/browser/core/browserAllowlist.ts` | 4 | Visible diagnostics/report text: existing desktopT/customIntegrations owner. |
| `electron/gate8/isolatedProductionAcceptanceHarness.ts` | 8 | Visible diagnostics/report text: existing desktopT/customIntegrations owner. |
| `electron/gate8/liveTimelineExportRunner.ts` | 4 | Visible diagnostics/report text: existing desktopT/customIntegrations owner. |
| `src/workbench/capability/creativeToolExecute.ts` | 8 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/creation/scriptImportModel.ts` | 1 | Canonical stored/projection defaults/audit labels; UI displays translated copies. |
| `src/workbench/creation/storyboard/storyboardScriptViewModel.ts` | 2 | Canonical stored/projection defaults/audit labels; UI displays translated copies. |
| `src/workbench/domain/shotSpecMigration.ts` | 7 | Canonical stored/projection defaults/audit labels; UI displays translated copies. |
| `src/workbench/generationCanvas/agent/gate.ts` | 1 | Stable Director/Agent source messages; display-only adapter, unchanged protocol/approval behavior. |
| `src/workbench/generationCanvas/agent/model3dHandoff.ts` | 1 | Canonical stored/projection defaults/audit labels; UI displays translated copies. |
| `src/workbench/generationCanvas/agent/storyboardPlan.ts` | 1 | Canonical stored/projection defaults/audit labels; UI displays translated copies. |
| `src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx` | 1 | Typed shared camera-output constructor; saved editable labels/angles unchanged; editor display translated. |
| `src/workbench/generationCanvas/components/capabilityRecipeInspectorModel.ts` | 7 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/components/capabilityRecipeReadiness.ts` | 10 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/components/toolCallSummary.ts` | 6 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/components/useCanvasAssistantSkillEvents.ts` | 7 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/components/useCanvasSelectionActions.ts` | 20 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/capabilityQualityPresentation.ts` | 4 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/capabilityResultCollectionModel.ts` | 1 | Canonical stored/projection defaults/audit labels; UI displays translated copies. |
| `src/workbench/generationCanvas/nodes/completeNodeConnection.ts` | 1 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/model3d/model3dCamera.ts` | 9 | Canonical capture metadata labels; localize only display copies, not camera/payload data. |
| `src/workbench/generationCanvas/nodes/outputCollectorModel.ts` | 1 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/render/imageComparisonModel.ts` | 1 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/render/storyboardRowKeyframes.ts` | 1 | Canonical stored/projection defaults/audit labels; UI displays translated copies. |
| `src/workbench/generationCanvas/nodes/render/storyboardRowOutputs.ts` | 2 | Canonical stored/projection defaults/audit labels; UI displays translated copies. |
| `src/workbench/generationCanvas/nodes/render/storyboardTableFieldConfig.ts` | 4 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/scene3d/attachCameraMoveToTarget.ts` | 1 | Model prompt/source data: neutral shared domain formatters; exact prompt bytes preserved. |
| `src/workbench/generationCanvas/nodes/scene3d/poseMetrics.ts` | 1 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dBlenderResult.ts` | 4 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dConstants.ts` | 69 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dMath.ts` | 2 | Canonical cached role-label source; actual role badges/tree use display adapter. |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dPropSpecs.ts` | 15 | Localized prop display; canonical saved names separated; all geometry/color/source hashes unchanged. |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dReferenceDirector.ts` | 1 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/Scene3DEditor.tsx` | 1 | Canonical persisted fallback title; captures/prompts also use historical source, not current locale. |
| `src/workbench/generationCanvas/nodes/vibingDirector/vibingDirectorAgentProtocol.ts` | 13 | Stable Director/Agent source messages; display-only adapter, unchanged protocol/approval behavior. |
| `src/workbench/generationCanvas/nodes/vibingDirector/VibingDirectorAssistantPanel.tsx` | 1 | Stable Director/Agent source messages; display-only adapter, unchanged protocol/approval behavior. |
| `src/workbench/generationCanvas/nodes/vibingDirector/vibingDirectorPresentation.ts` | 5 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/nodes/vibingDirector/vibingDirectorState.ts` | 11 | Stable Director/Agent source messages; display-only adapter, unchanged protocol/approval behavior. |
| `src/workbench/generationCanvas/nodes/vibingDirector/vibingDirectorStructuredProtocol.ts` | 7 | Stable Director/Agent source messages; display-only adapter, unchanged protocol/approval behavior. |
| `src/workbench/generationCanvas/nodes/VibingDirectorEditor.tsx` | 1 | Stable Director/Agent source messages; display-only adapter, unchanged protocol/approval behavior. |
| `src/workbench/generationCanvas/runner/capabilityRecipeController.ts` | 1 | Canonical stored/projection defaults/audit labels; UI displays translated copies. |
| `src/workbench/generationCanvas/runner/capabilityRecipePrompt.ts` | 2 | Model prompt/source data: neutral shared domain formatters; exact prompt bytes preserved. |
| `src/workbench/generationCanvas/runner/capabilityRecipeRetryAction.ts` | 8 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/generationCanvas/runner/generationReferenceResolver.ts` | 9 | Model prompt/source data: neutral shared domain formatters; exact prompt bytes preserved. |
| `src/workbench/generationCanvas/skills/canvasSkillRecipeBinding.ts` | 2 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |
| `src/workbench/skillLibrary/skillComponentPresentation.ts` | 4 | Visible UI text only: existing i18next, dedicated customWorkflow resources, live locale reads. |

## Integration

Keep the coordinator's latest vocabulary/type/enum owner changes, retry reexport, onboardingProviders import cleanup and toolCallSummary import cleanup when cherry-picking. This batch changes the two model-facing description examples to equivalent English as explicitly requested, but does not touch Agent frozen count/snapshot/baseline files or tool permissions. Any frozen schema reconciliation remains exclusively coordinator/human-approved work.
