# Lane Guideline Fixture Alignment

Base: `f1c0d0bdb365f51df37caa7d3471faeeaf45f308` (parent e102).
Only the two assigned Node tests and this design/contract change.

| Design Card | Decision |
| --- | --- |
| 1. Use | Keep approved current model guidance visible in the real lane prompt; do not restore retired prose to satisfy tests. No new feature or real generation. |
| 2. Owner | `electron/shared/agentCapabilities/verbs/readVerbs.ts` owns the current read-before-write guidance. `renderLanePromptSections` owns cross-tool deduplication. Tests observe these unchanged owners. |
| 3. Reuse | Use existing real catalog, lane SDK loop and local HTTP fixture. Preserve schema, effect, examples, budget, parse, rejection, next-step and output-limit assertions. |
| 4. States | Accepted calls still reach the domain port once; invalid/cross-field calls remain errors with next steps; current guidance appears once despite repeated source guidelines. No new execution or skip states. |
| 9. Acceptance | Run only these two files, Node test concurrency 1, with tsx (no full tsc). Record old 20 pass / 2 fail, then new results. Coordinator/fresh reviewer accepts; revert this separate commit to roll back. |

## Root Cause and Scope

CI `ci-e102-unit-24.log:3860` and local `lane-guideline-fixtures-red-02.log`
show two stale exact expectations. The approved sentence is:
`For writes, use IDs only from reads in this conversation, never memory or guesses.`
Retain the exact full sentence expectation, not an imported-value tautology.
The old deduplication positive control remains: naive flattening must repeat this
same sentence more than once, while the rendered guideline contains it once.
The output test continues to execute three calls and assert two rejections, one
domain write, cross-field detail and an actionable next step.

No production or fixture-helper edits; no skills97/P5 budget work, baseline,
ignore, timeout or skip changes. No real Provider or App is run.

## Test Execution Limits

The first direct-source attempt (`lane-guideline-fixtures-red.log`) was not a
valid complete reproduction: the installed Electron package attempted its missing
binary download during import, and the restricted environment rejected loopback
listen. It was stopped; no App launched. No claim of zero network attempts is
made for that aborted setup. The subsequent red run fixes Electron path resolution
to an unused, nonexecutable placeholder via `ELECTRON_OVERRIDE_DIST_PATH` and
permits only the existing 127.0.0.1 fixture server. No production API is mocked or
changed. The isolated local fixture run reproduces exactly the two stale tests.

## Verification

Evidence directory:
`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/`.

- `lane-guideline-fixtures-red-02.log`: 22 tests, 20 pass / 2 fail / 0 skipped.
- `lane-guideline-fixtures-green.log`: 22 tests, 22 pass / 0 fail / 0 skipped.
- Both use the same installed runtime, tsx loader and nonexecuting Electron path
  override, with `--test-concurrency=1`, only the two assigned files.
- Source readback proves each test differs from the parent by exactly one literal
  replacement; all other assertions are byte-identical. Production, scripts,
  skills and baselines remain untouched by this follow-up.
- `lane-guideline-fixtures-eslint.json`: 2 files, 0 errors / 0 warnings.
- Scoped v3 structural contract validation passes; not a complete gate result.
