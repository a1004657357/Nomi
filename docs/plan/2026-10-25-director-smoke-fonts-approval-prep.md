# App74 Director Four Font Owners

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Status: implemented, not pushed; four class tokens only, no PNG change.
Authorization: coordinator relayed the user's latest instruction to close normal
merge-blocking bugs under the original repair authorization, without per-item
confirmation. The unanswered four-item visual card is NOT recorded as an explicit
answer or approval. No new plan, door-map run, test scope or local full315 rerun.
Independent tree base: `c4faac9d45dcb7d1b6738ed5058d87c8150aeaaa`.
Do not merge/write coordinator, touch `_assert`, or run App/browser/heavy gates.

## Design Card

| Field | Decision |
| --- | --- |
| 1. Use | Existing empty Director scene is legitimate. Inspect preview readout, grid unit, insert-keyframe key and empty-timeline guidance without adding objects or changing defaults. App74 reportedly passed all 20 assertions and sampled 62 colors; the final capture remains blocked by FEEL. |
| 2. Owner | Four existing JSX producers below own typography. Tailwind owns micro=11px/caption=12px; FEEL owns the unchanged 12px lower bound and zero unreviewed-font allowance. |
| 3. Reuse | Reuse text-caption on only the four identified typography owners under the original blocker-repair authorization. No new token, exemption, tolerance, scene, fallback or copied FEEL rule. |
| 4. States | Preview empty and active readouts share one inherited font; unit appears only when supplied; key stays visible but action disabled with no subject; empty guidance stays conditional on !collapsed && isEmpty. Keep all text, callbacks and guards. |
| 9. Acceptance | Preserve four recorded REDs and exact real-ledger policy replay, then run the same slice and original negatives green. All existing 295 PNGs stay untouched. Coordinator handles normal PR checks/merge; no additional local full315 or per-item confirmation. Rollback is revert of the isolated repair commit. |

## Actual Evidence and Failure Classification

Read-only evidence root:
`/Volumes/S7/AiWork/Projects/Nomi-main-integration-20261025/`.
`artifacts/feel/smoke-984e9cce-c9bf-43f9-93d4-d5e9b40f69e3/contact-sheet.json`
contains 25 records. Last nonempty drift is index 23 (zero-based),
`smoke:waitForFunction`, `waitForFunction.png`, image `14.png`:
`font-size actual=4, allowed=0, kind=new`.
There are 11 raw 11px findings; 7 are already exactly exempted, leaving 4.
The summary-element dash is exempted and is NOT the preview span dash.
Index 24 is failure.png record-only evidence, not a passed final capture.
`outputs/canvas-smoke/nomi-smoke-e2e-rRlQFz/failure.json` reports a misleading
647ms visual-quiescence error. B owns shared-catch classification; do not edit it.
This author viewed archived 14.png; no new screenshot was taken.

## Exact Owner Map

All paths below are under `src/workbench/generationCanvas/nodes/director/`.

| Actual finding | Producer | Applied typography-only change |
| --- | --- | --- |
| span dash, x23/y254.375, 11px | panels/viewport/PipViewport.tsx:209 | span inherits text-caption from footer div at line 208; preserve shown ? pipFov : dash and all PiP behavior. |
| span m, x1245.359375/y709.25, 11px | panels/fields/SliderNumberField.tsx:79 | conditional unit span uses text-caption; caller panels/inspector/SceneLayerInspector.tsx:37 still supplies gridHeight unit=m. No whole-field or micro-token change. |
| kbd I, x1210.375/y879.25, 11px | timeline/TimelineHeader.tsx:118 | text-caption around formatHotkey(DIRECTOR_HOTKEYS.insertKeyframe); leave disabled={!hasSubject} and actual command untouched. |
| span trajectory guidance, x128/y911.75, 11px | timeline/DirectorTimeline.tsx:265 | text-caption around t('director.timeline.emptyHint'); preserve truncate and the legitimate empty state. |

Hotkey source: model/hotkeys.ts:29 has insertKeyframe key=i. Locale source:
src/i18n/locales/director.ts:451 and :1343 provide existing zh/en guidance.
Do not translate any source input, change these messages or rewrite the key.

## Door Map and Impact Boundary

Run before implementation:
`node scripts/door-map.mjs PipViewport SliderNumberField TimelineHeader DirectorTimeline --roots=src/workbench/generationCanvas/nodes/director`.
It scans 190 production files, returning 18 read doors / 0 write doors,
45 references. JSX references are classified as reads, not mutation calls.
Three are the Editor -> DirectorTimeline, DirectorViewport -> PipViewport and
DirectorTimeline -> TimelineHeader connections. Fifteen are SliderNumberField
consumer modules. The field's unit span is shared: changing its token can affect
other unit-bearing inspector/dialog states, not just gridHeight's visible m.
AST enumeration finds 28 unit-bearing JSX call sites in 12 of those modules,
including camera mm, light m/degrees, transforms and mobile m/s.
Keep that fact explicit in the source-impact record; never claim
only one screenshot can change. Full src/electron symbol search found no
production component consumer outside the Director subtree.
Coordinator confirms the 20-screen/295-baseline directory has no dedicated
Director lab. The earlier five ModeBar PNGs have already been viewed/hashed by
the coordinator and the other 290 remain unchanged. All four typography owners
and all direct production consumers are Director-private; no design-lab import
of these four component symbols was found. Thus no existing 295 PNG update is
expected or proposed. This is source-level impact analysis, not a screenshot run.
If an unexpected protected screenshot changes, stop and report; do not rebaseline
it or treat the unanswered card as permission for additional images.

Detailed generated doors and unit-bearing caller sites are preserved externally
as `director-smoke-app74-door-map.json` in the common evidence directory.
No door reduction or new ability is proposed: the same components stay mounted.

## Existing RED and GREEN Scope

New test: tests/ux/director-smoke-font-owners.test.mjs. It follows actual JSX
ancestors to resolve the four fonts using actual Tailwind token values. It
expects exactly 12px; its four 11px REDs were saved before implementation.
Archive only the font subset of the actual ledger as a self-contained fixture;
replay existing applyFeelExemptions/compareFeelBaseline, not a replacement guard.
Negative controls: missing/ambiguous owner must throw, unrelated micro cannot
fix the targeted node, duplicate unreviewed findings increase drift. In-memory
caption substitutions demonstrate test sensitivity, not actual rendering acceptance.

Only the four existing class tokens change in production. The minimal v3
structural contract records those paths, preserved behavior and verification limits.
Only maxWorkers=1 existing owner/policy tests are rerun. Save RED and GREEN
results separately; do not skip, invert or relax assertions to make them green.
The author delivers a narrow commit without push/merge; coordinator runs normal CI.

## Actual Preparation Verification

Target command: bundled Node + node_modules/vitest/vitest.mjs run
tests/ux/director-smoke-font-owners.test.mjs tests/ux/feel-policy.test.mjs
--maxWorkers=1 --reporter=json --outputFile=<common>/director-smoke-app74-owner-red-final.json.
Actual result: 16 tests, 12 passed, 4 expected failures, 0 skipped. All four
failures are exactly `expected 11 to be 12`, one per actual owner, not setup errors.
The six unchanged existing policy tests passed in RED. Before implementation,
the four owner files matched coordinator byte-for-byte; recorded
SHA256s and exact door-map/caller inventory are in the external evidence JSON.
Explicit non-ignored lint of the prepared test reported 0 errors / 0 warnings.
Ledger and screenshot archive hashes were read back unchanged in preparation.
GREEN evidence is <common>/director-smoke-app74-owner-green.json. Preserve the
original assertions and negative controls; only the obsolete preparation title
changes. No App/browser/heavy/full315, screenshot, FEEL or baseline updates.
Actual GREEN: 16/16 passed, 0 failed, 0 skipped. Source byte audit confirms
exactly one micro-to-caption substitution per production file and no other
production changes. Existing RED evidence remains unchanged.

Common evidence directory:
`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/`.
