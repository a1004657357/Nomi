# Official v0.23.2 Integration Into Customized Nomi

## Target and Workspace

- Stable target: official tag v0.23.2, commit e572242858111bfabfccbfba379c2230c8855d1e.
- Daily source: /Volumes/S7/AiWork/Projects/Nomi-codex-director-upgrade, HEAD 2d9104ef6 plus the existing uncommitted Pavo integration and generated CSS.
- Reuse the idle sibling /Volumes/S7/AiWork/Projects/Nomi-upstream-v021-20260912 on a new integration branch. Preserve its unrelated untracked audit reports.
- Backup: /Volumes/S7/AiWork/Projects/Nomi-merge-v0232-20261020/backup. Archives and hashes cover 4,380 source files, the deleted old connection card, and 3,254 local .mimosa files.

## Scope

Merge the stable upstream release into the customized source. Preserve Codex Img2, Jimeng Web/CLI, Pavo, AGNES, Blender Director, storyboard row outputs, generation concurrency, idempotency and process cleanup. Integrate shared contracts rather than choosing entire conflicting files blindly. Follow upstream's updated Agent/runtime and data migration contracts while retaining custom capabilities.

This is a local customized-version update, not a public release. Daily project files, assets, API keys, cookies and .mimosa stay in their existing locations. Tests use isolated storage and do not submit real image/video generation.

## Steps

1. Archive source and original dirty changes, record hashes and a rollback point; verify baseline typecheck.
2. Snapshot the existing customized code in the isolated workspace, then merge the official tag without automatically committing conflicts.
3. Resolve conflicts by ownership: provider/catalog contracts, frontend/IPC, task lifecycle and storyboard/Director integrations.
4. Install the merged locked dependencies, run typechecks, meaningful regressions, applicable static gates and production builds. Review dependency/license changes and explicitly report pre-existing release blockers.
5. Run the actual merged Electron build against isolated project data; verify provider availability, storyboard workflows, Pavo local bridge, result materialization and UI screenshots without paid generation.
6. Once verified, transfer the exact merged source to the daily checkout while preserving its original local-only files. Recheck no intervening edits, rebuild and verify the daily startup path.
7. Persist fresh test results and a completion report with exact commits, evidence, limitations and rollback instructions.

## Acceptance and Rollback

- The delivered history contains both the original customized snapshot and official v0.23.2.
- Existing custom integrations have focused execution-contract coverage, not just visible model labels.
- Typecheck and builds pass; failures and skipped checks are explicit. UI is inspected from the merged build.
- The daily project store and preserved local files retain their original hashes before launching migrations; do not use daily projects for tests.
- Restore only reviewed paths from backups if needed. Do not use destructive reset or discard user changes. Keep backup/integration history until the user has used the update.
