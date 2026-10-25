# Smoke Route Readiness and Per-Run Evidence

Status: implemented, not pushed; real App verification pending with coordinator.
Base `647c0f5b273667a878e058c796eea0b9344eb478`.
Scope: smoke script, its existing standalone owner test, this plan and v3 contract.
No App/browser, build, full suite, production, threshold or baseline changes.

## Design Card

| Item | Decision |
| --- | --- |
| 1. Use | Existing real smoke must wait for its actual controls, not treat a project click plus elapsed time as route readiness. A missing control still fails. New evidence must never overwrite historical tracked failure files. |
| 2. Owner | `_assert.mjs` canonical collecting expect/poll owns bounded assertions; existing visual-quiescence owner handles layout settlement. Smoke owns its original selectors/assertions and its fresh mkdtemp run identity. |
| 3. Reuse | Use real canonical expect.poll/visible assertions and waitForVisualQuiescence, without a new wait loop, timer or larger default. Existing CI outputs/canvas-smoke/** uploader already owns nested evidence. |
| 4. States | Partial toolbar/spinner stays pending; all original controls visible enables original assertions; missing control times out and fails. Each run writes captures, fixed-footer details and failure diagnostics only under its own run directory, and logs that path. |
| 9. Acceptance | Red/green static owner tests plus true canonical poll negative control, existing Node waiting guard and no-undef tests only. Coordinator reruns the actual App. Another reviewer accepts this author patch; revert the isolated commit to roll back. |

## Evidence and Class Audit

Read-only smoke62 failure JSON has URL #/studio, no projectId yet, no renderer
diagnostics and no nodes. The archived PNG is only the Suspense spinner. The log
shows creation briefly visible, then generation absent after a fixed 2500ms.
Never treat this as proof of a missing production feature or of successful smoke.

Audit the four waits by their downstream observations, not by global replacement:

| Old Wait | Actual Completion Signal |
| --- | --- |
| 2500ms after project click | All four original toolbar button locators visible together through canonical bounded poll; then retain all original per-button assertions and URL assertion. |
| 800ms after generation tab | Existing add-image button visible before counting nodes; same selector and subsequent click/count assertions. |
| 500ms after prompt fill | Existing canonical visual-quiescence helper for committed layout before pan/hit-test; retain final exact prompt and geometry assertions. |
| 1200ms after Director insertion | Existing director-open control visible before the unchanged click/fallback and shell assertions. |

The existing 5000ms App close race is resource teardown, not UI readiness, and
stays unchanged. Shared defaults, action timeouts and station budgets stay unchanged.

## Evidence Consumers

Use `path.resolve("outputs/canvas-smoke", path.basename(tempRoot))`; mkdtemp's
nomi-smoke-e2e-* basename is the run identifier. No output-path environment input.
Keep existing filenames, screenshot helper, fixed-footer subdirectory and failure
diagnostic fields; add the exact directory pointer to log/failure JSON.
CI quality-gate.yml has three recursive outputs/canvas-smoke/** upload paths.
`_composerFixedFooter.mjs` already derives paths from its evidenceDir parameter.
Existing root README/failure.json/failure.png and old docs are historical evidence,
not mutable latest-run pointers, and will remain byte-identical. No consumer found
that needs a fixed root failure.json; chain summarization consumes step outcomes.

## Tests

The existing standalone test will retain expect ownership and unresolved-binding
checks, add an AST readiness/sleep guard and mutation negatives against the actual
script. Its extracted toolbar fragment executes with the real canonical poll
owner and deterministic locator samples, no browser. Missing one control must
throw before any original toolbar assertion passes. Per-run directory initializer
tests verify distinct mkdtemp basenames, fixed containment and retained pointers.

## Verification

Evidence directory:
`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/`.

- `smoke-route-owner-red.json`: 19 pass / 7 fail / 0 skip on the unchanged smoke;
  the new expectations reject the old sleeps and shared evidence root.
- `smoke-route-owner-green-final.json`: 35/35, 0 skip, owner plus existing assertion
  tests. Real canonical poll handles partial readiness and throws for a missing
  generation control before any original toolbar assertion reports success.
- `smoke-route-wait-guard.log`: existing Node waiting guard 11/11, 0 skip.
- `smoke-route-lint.json`: both changed scripts 0 errors / 0 warnings, ignoring no
  rules; ignore:false avoids tests/ux's global ignore, Node/browser globals only
  supply the same script context as tests/perf. The owner test separately checks
  the actual Node versus serialized-browser lexical scopes.
- Scoped v3 contract validation passes. All 17 original source-level assert calls
  and the App-close finally block are byte-identical. Historical root evidence,
  assertion/quiescence owners, station budgets, CI uploader and baselines are
  byte-identical to the base. Canonical expect call-count fixture changes 3 to 6
  solely because three new real waits were added; it is not a budget/baseline.

No App/build/browser/Provider/heavy suite was run. Actual smoke remains unverified
until the coordinator's fresh build and App rerun. Main preflight63 success is not
this smoke's pass. Five hint screenshots remain pending approval; no PNG edits.
