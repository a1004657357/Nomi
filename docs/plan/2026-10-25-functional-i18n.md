# Functional i18n batch

Parent: `d98d944ff48f340ad929c46f5861788a43638cb8`. Independent functional line; no TSX or scene3d edits. Coordinator owns full integration/CI.

## Design Card

| Field | Decision |
| --- | --- |
| 1. Workflow | Recipe selectors, controls, compatibility messages and local quality reports read in Chinese or English. Existing Chinese appearance, recipe IDs, option values and all generated prompts remain unchanged. |
| 2. Owner | Existing i18next resources own visible copy; modelDisplayText owns curated model labels. Stable Agent descriptions and recipe/vision prompt data remain fixed Chinese source data, not locale-dependent protocol. |
| 3. Reuse | Register a dedicated capabilityWorkflow locale module with import/property additions only. Translate output-facing strings via existing i18next; use lazy recipe display labels so language switching does not freeze module-initialization text. |
| 4. States | Preserve all quality statuses, metrics, thresholds, IDs and unknown/unavailable behavior; translate labels, reasons, summaries and details only. Never treat an unavailable check as a pass. |
| 9. Acceptance / rollback | Focused bilingual and semantic-preservation regressions plus the original inventory scanner in read-only report mode, unchanged existing recipe/quality/prompt tests, scoped lint and root-cause validation. No generation, credentials, proxy, memory, push or merge. Revert this batch's commit to roll back. |

## Boundaries

- Read `check-i18n-visible-text.mjs` and the coordinator inventory. The normal checker can automatically shrink the electron baseline; use `--report` for inventory to avoid any baseline writes.
- `videoRecipeQuality.ts` exists under `quality/`, not `runner/` in this checkout.
- Semantic tool descriptions are Agent-facing protocol; preserve their full serialized bytes (baseline SHA-256 `93daa8f839e0b83310a022a3150491652ef90f5c73005b521aa160f3489072e5`).
- Camera/output labels and Chinese recipe option values feed generation prompts. Keep these values fixed; translate only the separate display label. Vision judge instructions, schema and image-reference captions are also protocol source, not UI text.
- Restrict shared `resources.ts` changes to this batch's locale import and one property per language. No scanner exclusions, thresholds or baselines change.

## Verification

- RED: the initial focused bilingual regression had 35 failures and 2 passes. Failures reproduced untranslated recipe/control/quality/model display copy; protocol/parameter preservation checks already passed.
- GREEN: 14 focused test files, 175 tests passed, including both supplemental vendor-name regressions (173 before their addition). Includes the unchanged recipe, semantic-tool, prompt, runner and quality suites plus i18n regressions; no generation API or actual CLI invocation.
- TypeScript: 20 changed TypeScript files passed semantic/syntax checks with the existing `tsconfig.test.json` options. An earlier ad hoc compiler command lacked the repository's JSX/DOM/error options; its unrelated diagnostics were not repaired or claimed green. It also exposed two owned inference issues, fixed without changing predicates or protocol text.
- ESLint: scoped production and regression files passed with `--max-warnings=0`. `git diff --check` passed.
- Read-only original inventory: assigned findings 228 -> 0; missing model labels 24 -> 0; global src findings 989 -> 761. The isolated checkout's Electron baseline remains 277 occurrences in 55 files, byte-for-byte unchanged; this is not a claim about the coordinator's newer desktop cleanup.
- Model labels: 25 new display equivalents, including the supplemental Jimeng/Pavo browser-sign-in names; the existing `VIP快速` key is now quoted so the unchanged scanner also recognizes its already-existing translation. Codex/Pixstag remain for the coordinator's locale-neutral seed owner; no dead dictionary entries are added. No model capability changes or external capability claims.
- New registered resources: 368 paired visible-copy messages. Stable Agent descriptions are separately named fixed protocol data and are not registered as display translations.
- Semantic preservation: the complete Chinese recipe metadata and semantic-tool map match parent SHA-256 snapshots. Generation plan/prompt equality and exact mood/multiview judge request digests hold under both languages. Cross-locale reports retain IDs, verdicts, metrics and item bindings.
- Door map: actual runtime-symbol analysis records 53 parent doors and 70 current doors. The v3 checker exits 0 with one warning: the authored `modelDisplayText.ts` dictionary declaration has no runtime door inside that data-only file. Its consumer read door is recorded; do not fabricate a door, mark authored data generated, or modify the checker.
- Shared resources diff: exactly this batch's import and one property in each locale. No TSX, scene3d, style, package, CI, scanner, threshold or baseline edits.

Focused green command:

```sh
pnpm exec vitest run src/i18n/capabilityWorkflow.test.ts src/i18n/index.test.ts src/i18n/modelDisplayTextExpansion.test.ts src/config/capabilityRecipes/capabilityRecipes.test.ts src/workbench/domain/semanticAgentTools.test.ts src/workbench/generationCanvas/runner/capabilityRecipePrompt.test.ts src/workbench/generationCanvas/runner/capabilityRecipeQuality.test.ts src/workbench/generationCanvas/quality --maxWorkers=1
```

## Changed Paths

```text
docs/plan/2026-10-25-functional-i18n.md
docs/fixes/2026-10-25-functional-i18n-boundaries.root-cause.json
src/config/capabilityRecipes/index.ts
src/i18n/capabilityWorkflow.test.ts
src/i18n/capabilityWorkflowText.ts
src/i18n/locales/capabilityWorkflow.ts
src/i18n/locales/modelDisplayText.ts
src/i18n/resources.ts
src/workbench/domain/semanticAgentTools.ts
src/workbench/generationCanvas/quality/customViewQuality.ts
src/workbench/generationCanvas/quality/model3dRecipeQuality.ts
src/workbench/generationCanvas/quality/moodExpressionVisionReview.ts
src/workbench/generationCanvas/quality/moodExpressionVisionReviewService.ts
src/workbench/generationCanvas/quality/multiviewBackgroundQuality.ts
src/workbench/generationCanvas/quality/multiviewContinuityQuality.ts
src/workbench/generationCanvas/quality/multiviewSubjectQuality.ts
src/workbench/generationCanvas/quality/multiviewSubjectVisionReview.ts
src/workbench/generationCanvas/quality/multiviewSubjectVisionReviewService.ts
src/workbench/generationCanvas/quality/portraitIdentityQuality.ts
src/workbench/generationCanvas/quality/styleTransferQuality.ts
src/workbench/generationCanvas/quality/videoRecipeQuality.ts
src/workbench/generationCanvas/runner/capabilityRecipeQuality.ts
```

## Remaining Work / Risks

- Whole-repository i18n remains blocked by the isolated checkout's 761 unassigned src findings and two Latin-brand seed classifications (Codex/Pixstag, owned by the coordinator); this batch does not claim global green.
- Historical persisted freeform quality reports are not rewritten. User-authored labels and external comparator prose remain unchanged rather than guessed translations.
- No browser/screenshot verification or complete CI; integration remains with the coordinator. No push, merge or memory writes.
