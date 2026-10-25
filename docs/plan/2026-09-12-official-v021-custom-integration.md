# Official v0.21.0 Integration Into the Custom Nomi

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## Target and Baseline

- Target: official stable release `v0.21.0`, verified from the GitHub latest-release page on 2026-09-12.
- Custom baseline: `097be462`, branch `codex/nomi-codex-director-upgrade-20260705`.
- Integration workspace: `/Users/huawuer/Projects/Nomi-upstream-v021-20260912`.
- User workspace: `/Users/huawuer/Projects/Nomi-codex-director-upgrade`.
- Rollback branch: `codex/backup-nomi-before-v021-20260912`.

## Scope

Merge the latest official stable release into the existing custom branch. Preserve custom Codex Img2, Jimeng Web/CLI, Blender Director, storyboard row outputs, AGNES Flash, Pixstag, process lifecycle, and generation safety behavior. Resolve overlapping changes at their shared contracts instead of choosing entire files blindly.

## Non-Goals

- Do not merge unreleased development commits after v0.21.0.
- Do not publish an application release or overwrite the official repository.
- Do not alter daily project databases, assets, credentials, cookies, or the untracked `.mimosa` folder.
- Do not submit image or video generation as part of the update.
- Do not loosen engineering gates merely to make integration pass.

## Steps

1. [x] Inspect the custom branch, tracked changes, release notes, and rollback point.
2. [x] Create an isolated sibling worktree; establish the current typecheck baseline.
3. [x] Fetch and verify the official tag, license and dependency changes.
4. [x] Merge and resolve conflicts; audit custom provider, storyboard, and lifecycle contracts.
5. [x] Run typechecks, unit tests, applicable static gates, build, and isolated Electron smoke.
6. [x] Commit the verified merge and fast-forward the unchanged user workspace.
7. [x] Report exact versions, verification results, limitations, and rollback instructions.

## Acceptance

- The merged commit contains both the custom baseline and the verified official release.
- Typecheck and focused/full regression results are recorded from this run, not copied from old reports.
- Renderer and Electron builds succeed using the merged dependency lockfile.
- Launch the merged application against isolated test data and visually inspect its actual rendered window.
- Custom provider identities and storyboard controls remain available; no real generation is silently submitted.
- Daily projects and the original rollback point remain intact.

## Rollback

Before fast-forwarding the daily checkout, verify it still points to the inspected baseline and has no new tracked edits. Keep the backup branch after delivery. A rollback must be explicit and preserve any work created after the update; do not reset user changes automatically.

## Evidence

- Baseline `pnpm run typecheck`: passed on 2026-09-12.
- Official release: https://github.com/aqm857886159/Nomi/releases/tag/v0.21.0
- Initial sandbox fetch could not access the local proxy; retried with approved network access.
- Official target `4a405088af583aabf2585eb11c78e83ec1cb792e`: AGPL-3.0-only unchanged; Electron 31.7.7 to 43.4.1.
- A sandboxed follow-up run was invalid because local HTTP listeners were denied with `listen EPERM`; this is retained as diagnostic evidence, not acceptance evidence.
- Final unsandboxed regression: 948 files, 946 passed / 2 skipped; 8,814 passed / 5 skipped tests, zero failures, 290.20 seconds.
- Production typecheck passed. The separate test-type ratchet passed and was tightened from 110 to 92 existing errors; this is not a claim that all test fixtures are type-clean.
- Follow-up static audit: 20/20 checks passed. Lint: zero errors, 93 existing warnings.
- Renderer and Electron builds passed. Isolated Electron 43.4.1 launch probe passed; macOS automated fixtures require a disposable test keychain to avoid first-launch OS prompts.
- Goal feature Electron smoke passed 10/10 assertions, including real 8-frame extraction and keyframe node creation. Restart/idempotency smoke passed 6 assertions with zero Provider requests.
- Full acceptance summary: `docs/audit/2026-09-12-v021-custom/summary.md`.
- Verified merge commit: `82bbb2aa0e41cfd88ed59800b35e2f136615acf1`, with the custom baseline and official v0.21.0 tag as its two parents.
- The daily workspace was fast-forwarded without modifying `.mimosa`, dependencies were reinstalled from the merged lockfile, and the daily production build passed.
- Electron 43.4.1 launched from the daily workspace on 2026-09-13; macOS reported one visible window titled `Nomi`.
