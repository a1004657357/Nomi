# Main Style Registry Followup

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Line: `codex/main-style-fix-20261025`.
Base: `399e30c40485158665dedca35e154129f799b2bd`.
Category: existing-UI style and semantic-reference repair.

## Design Card

| Field | Decision | Evidence |
| --- | --- | --- |
| 1. User Flow | Preserve the existing table, canvas, review and 3D controls. Repair invalid table colors, document actual library icon meanings, and remove only a provably redundant toolbar margin. No content, task, data, control or interface rearrangement. Real project workflows remain for coordination. | Existing source, focused regressions, isolated toolbar geometry probe. |
| 2. Ownership | `docs/design/nomi-design-system.md` section 6 owns semantic registration; live Tailwind mapping owns colors. The toolbar's existing flexible title already owns remaining row space. No new layout owner or persisted state. | Generated second-round door map and independent v3 contract. |
| 3. Reuse | Reuse the 38 existing task-specific glyphs after checking real use. Replace the aircraft-shaped `IconPlane` for plane geometry with baseline `IconSquare`. Table helper text uses ink-60; expanded row uses ink-05. Do not create aliases or exceptions. | Prop, geometry, pose and task maps; installed Tabler glyph source. |
| 4. States | Keep all labels, props, callbacks, conditionals, active/disabled states, dimensions, table columns and wrapping. Metadata stays where it currently is unless an existing rule is structurally redundant. | Byte-level whitelist comparison; toolbar geometry equivalence. |
| 9. Acceptance / Rollback | First run the changed focused tests red, then green and unchanged static checks. Main line performs final isolated screenshots and real workflows. Revert this second commit independently. No push or merge here. | Local logs under `.tmp/main-style-reference-repair/round2-*`; independent v3 contract. |

## Scope And Limits

- May edit pure table styling; never edit `src/workbench/domain/shotSpecMigration.ts` or `src/workbench/generationCanvas/nodes/render/storyboardRowOutputs.ts`.
- No manifest, lockfile, workflow, checker, baseline, ignore-list, model-profile, cookie, credential, proxy or memory changes.
- No user app restart or real-provider calls. The prior proxy failure remains an environmental preflight non-execution; do not retry by changing transport.
- The row policy explicitly forbids moving metadata to the edge through growing labels. No existing public layout variable can preserve those metadata positions while also satisfying that policy. Do not hide the same forbidden behavior in inline CSS, aliases, spelling variants or a new helper.
- One margin on `Scene3DFullscreenToolbar` is redundant because the immediately preceding title already has `flex-1`. Check geometry across narrow/wide rows before removing it.
- Remaining nonredundant row-edge rules require layout approval or an owner-level policy decision. Preserve them and report them, rather than silently rearranging the UI.

## Initial Evidence

- 39 unregistered icons were enumerated by the unchanged scanner and reviewed at their actual call sites.
- `scene3dToolbar` maps plane geometry to `IconPlane`; the installed icon's outline is an aircraft. The baseline already contains the planar `IconSquare`.
- Table invalid keys are `text-nomi-ink-50` (four literal uses) and `bg-nomi-ink-02` (one use). The gate groups duplicate file/key findings, so its two findings represent five actual references.
- The starting token check has 18 edge occurrences across 13 files. The only structurally redundant one found is on the 3D fullscreen toolbar.

## Validation

| Check | Result |
| --- | --- |
| Changed focused regression | Red: 4 failed / 3 passed; green: 7 passed. Covers all imported icons, every in-scope table key, the planar glyph and header ownership. |
| `check:icon-semantics` | Pass: zero conflicts or unregistered glyphs. Retain and register 38 actual task-specific glyphs; replace the aircraft glyph with an existing baseline square. Baseline untouched. |
| `check:dangling-tailwind` | Pass: zero dangling file/key findings. Five table color references repaired. Existing 17 unmapped color variables remain at the unchanged baseline. Scanner tests pass 9/9. |
| `check:dangling-tokens` | Pass: zero dangling references. |
| `check:tokens` | Still fails on 17 nonredundant source occurrences across 12 files, listed below. One zero-effect margin removed. |
| Local geometry | Eight isolated real-Chromium cases: 320/480/960/1600 widths, short/long title, actual server-rendered toolbar and compiled existing CSS. Every element position/size has max delta 0 after removing the margin. This is not app or project acceptance. |
| Source preservation | Whitelist diff against 399e30c: exactly five table color uses, one zero-effect margin and one geometry glyph changed. Every other source byte is unchanged, including handlers, content, dimensions, wrapping and conditional logic. |
| Focused lint / TSX / Node syntax / whitespace | Pass on the three production files; the focused Node test passes syntax validation (the repository lint configuration does not lint `.mjs` tests). |
| Independent v3 contract | Pass against base 399e30c; contract tests pass 54/54, no warnings on the new contract. |
| Protected functionality | `shotSpecMigration.ts` and `storyboardRowOutputs.ts` are unchanged. Manifests, workflows, checkers, baselines and ignore lists are unchanged. |
| Remote preflight | Environmentally unexecuted because of the already-reported proxy failure. No retry or transport change. |

The independent v3 contract and contract-test result are checked separately against 399e30c, not against the integration line's historical diff. An additional focused red/green assertion ensures the removed aircraft glyph is not accidentally registered through explanatory copy (the existing owner parser reads backticked icon names throughout the semantic section). Local evidence is under `.tmp/main-style-reference-repair/round2-*`; no generated CSS, HTML, browser profile, screenshot or media is committed.

## Remaining Layout Ledger

Paths below are relative to `src/`. Counts are source occurrences, including alternate branches; no exceptions are added.

| File | Count | Existing placement that would change |
| --- | --- | --- |
| `ui/onboarding/CodexImagegenManage.tsx` | 1 | Connection badge opposite the channel heading. |
| `workbench/generationCanvas/components/BatchGenerateSettingsButton.tsx` | 1 | Skip-existing checkbox opposite the batch heading. |
| `workbench/generationCanvas/components/CapabilityAutoVisionReviewControl.tsx` | 1 | Review checkbox at the end of its settings label. |
| `workbench/generationCanvas/components/CapabilityRecipeInspector.tsx` | 2 | Output count field and mood request summary at row ends. |
| `workbench/generationCanvas/nodes/CapabilityHumanReviewControl.tsx` | 2 | Reviewed/unreviewed status alternatives at the row end. |
| `workbench/generationCanvas/nodes/CapabilityQualityReportPopover.tsx` | 1 | Quality status at the header end. |
| `workbench/generationCanvas/nodes/CapabilityResultCollection.tsx` | 2 | Two matrix axes and selected-candidate checkmark at opposite ends. |
| `workbench/generationCanvas/nodes/PortraitComparisonDialog.tsx` | 1 | Zoom and close actions opposite the comparison title. |
| `workbench/generationCanvas/nodes/VideoKeyframeInspectorDialog.tsx` | 3 | Header close action, selected count and thumbnail checkmark alignment. |
| `workbench/generationCanvas/nodes/model3d/Model3DCameraNodeBody.tsx` | 1 | Capture settings at the end of the wrapping target-fields row. |
| `workbench/generationCanvas/nodes/render/ImageComparisonNodeBody.tsx` | 1 | Fullscreen close action opposite its title. |
| `workbench/generationCanvas/nodes/render/StoryboardTableNode.tsx` | 1 | Existing table actions opposite the heading. |

Minimum behavior-preserving handoff: keep these 17 placements. They are not invalid token names and are not duplicated by an existing flexible sibling. A new alias, inline `space-between`/auto margin or a stretching label would conceal the same policy violation rather than fix it. Clearing them needs either explicit owner-level policy resolution or approved layout movement, neither performed here.

Final app screenshots, both locales, real projects, 3D interaction, CI, packaged/Windows validation and merged-main verification remain with coordination. No user app is launched or restarted, no heavy full-repository suite runs, and this line does not claim the whole PR is unblocked.
