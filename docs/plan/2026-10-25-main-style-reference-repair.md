# Main Style Reference Repair

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Implementation line: `codex/main-style-fix-20261025`.
Base: `1dbfc36ab7c8f82421555cea47131c7835fc9dfb`.
Category: existing-UI bug repair, not a new interface or redesign.

## Design Card

| Field | Decision | Evidence |
| --- | --- | --- |
| 1. User Flow | Open an existing canvas, inspect results or review settings, enter the 3D editor, control a character or camera, exit control, and return to the canvas. Preserve all content, event handlers, active/disabled states, sizing and layout. Real project/media tasks are unverified; none are launched by this repair. | Existing components; focused source regression tests. |
| 2. Ownership | Existing design-token definitions and Tabler action semantics remain the only owners. No persisted state or generation owner changes. Read doors are enumerated with `scripts/door-map.mjs`. | Independent schema-v3 contract; generated door map. |
| 3. Reuse | Use `duration-nomi-fast ease-nomi-fast`, legal ink levels, `bg-nomi-ink-05`, `shadow-nomi-md`, `IconX` for exit, and `IconMaximize` for full-screen entry. Do not add token aliases or duplicate components. | Design system sections 2.1, 2.5, 2.7, 6; live Tailwind configuration. |
| 4. States | Empty/loading/success/failure/review states retain their current text, controls and handlers. Only invalid styling references and inconsistent action glyphs change. Cancellation, partial success and expiry introduce no new transitions. Both locale renderings remain unverified. | Focused checks and unchanged component logic. |
| 9. Acceptance / Rollback | Reproduce the four reported static failures; run the focused red/green slice and unchanged static checks. Coordination line independently accepts the cherry-picked commit. Roll back that commit with git revert. No push or merge on this line. | `scripts/main-style-reference-repair.node-test.mjs`; local check logs. |

## Boundaries

- No edits to package manifests, lockfile, workflows, checkers, baselines, storyboard or model profiles.
- No cookies, credentials, proxy settings, real-provider calls, media commits or memory writes.
- Do not change the 18 row-edge occurrences in 13 files merely to satisfy `check:tokens`. Removing their alignment requires an approved real-screen comparison. The minimum behavior-preserving delivery leaves these layouts unchanged and reports the failure.
- `StoryboardTableNode.tsx` has two dangling Tailwind findings and one row-edge occurrence. They are outside this line's authorized write scope.
- Actual renderer screenshots and user-project workflows are unverified. Static success is not visual or end-to-end acceptance.

## Local Setup

- First offline install using the default resolved store failed because a package was absent.
- Retry uses the existing `/Volumes/S7/.pnpm-store` cache with `--offline --frozen-lockfile --ignore-scripts`; no dependency or manifest changes.
- Requested `delivery:preflight --remote fork --base main` failed at fetch because the configured local proxy port was unreachable. Proxy configuration is unchanged. The exact supplied base is used for local work; no remote freshness claim is made.

## Validation And Handoff

| Check | Result |
| --- | --- |
| Focused regression | Red: 3 failed, 1 passed. Green: 4 passed. |
| Reference-only diff proof | 16 production files; exactly 37 invalid class occurrences, 4 obsolete duration uses, and 3 glyph uses replaced. All other source bytes, including content, handlers and layout, are unchanged. |
| TSX syntax / focused ESLint / git diff whitespace | Pass. Lint covers the 16 changed components and the new focused test only. |
| `check:dangling-tokens` | Pass; zero dangling references. |
| `check:icon-semantics` | The 3 requested conflicts are cleared. Full command still fails on 39 pre-existing unregistered icons, hidden by its earlier conflict-phase exit. No imports were added and both canonical glyphs already belong to the baseline dictionary. Do not register the other icons without semantic review. |
| `check:dangling-tailwind` | 27 distinct file/class findings reduced to 2, both in the excluded storyboard file. Its scanner self-tests pass 9/9. |
| `check:tokens` | Still fails on the same 18 layout occurrences across 13 files; no new violations and no exemptions. |
| `check:root-cause-contracts` | Pass with the supplied base via `ROOT_CAUSE_BASE_REF`; checker tests pass 54/54 and this new contract has no warnings. Does not assert that the separate historical integration diff is clean. |
| Remote delivery preflight | Failed at fetch; no proxy changes or transport workaround. |

Local logs and the reference-only proof are in `.tmp/main-style-reference-repair/` (ignored, not part of the commit). The exact 39-icon list is in `icon-dictionary-remaining.json` and the full failing icon-check log. Red logs precede all production edits. A premature test invocation while dependency installation was still linking packages was a setup failure, not red evidence; the preserved red logs are the subsequent real assertion failures.

Coordination owns the remaining storyboard references, the newly exposed dictionary review, and any approved layout adjustment. The behavior-preserving minimum for the layout findings is to retain the current layout until real-screen review authorizes moving metadata into content flow. Do not replace the forbidden classes with equivalent inline CSS or lift a baseline.

Not accepted here: renderer screenshots, zh/en rendering, real user projects or generation, 3D interaction, Windows, packaged builds, CI, remote freshness, push, merge, or merged-main verification. This line is a partial local repair, not a claim that PR #2 is unblocked.
