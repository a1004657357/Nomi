# Pavo local integration

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

The user approved merging the accepted Pavo work into the customized daily checkout on 2026-10-23. This supersedes the earlier isolation-only instruction for these files. No remote push, release, project-data migration, or new generation is part of this integration.

Source: `codex/nomi-multimodal-zcode-20261020`. Target: `codex/nomi-codex-director-upgrade-20260705`. Both start at `6f6867c287e4f4ccb2caca78b43f905318ac1e83`.

## Scope

Carry the verified Pavo extension content/panel/server, Electron bridge/runner/IPC, six regression suites, and their design/root-cause contracts together. Preserve the exact accepted source bytes. Do not carry unrelated provider catalog, CLIProxy, Volcengine, spend confirmation, UI harness, or experimental image-model publication changes.

The bridge already contains image-result plumbing from the isolated work; keeping that tested file intact does not publish the experimental image model or enable the generic image dispatch entry. Real acceptance remains single/two-image Omni-reference video only.

## Evidence

- Design: [reference/batch/retry](2026-10-22-pavo-batch-reference-retry.md).
- Real acceptance: `/Volumes/S7/AiWork/Projects/Nomi-zcode-handoff-20261020/reports/pavo-reference-batch-acceptance-20261022.json`.
- Independent reviewer: Sagan, lane `01a15eff-4450-7982-98e3-f58c4473ca06`; append-only report `/Volumes/S7/AiWork/Projects/Nomi-zcode-handoff-20261020/reports/pavo-batch-independent-review-20261022.md`. Read its final addenda, not the superseded opening findings.
- Two actual website starts yielded two correctly bound, decoded, playable videos. No naturally failed website generation occurred; failure/retry evidence is fixture-based. Large batches, Windows, first/last-frame and audio-reference modes remain unverified.

## Integration And Recovery

Create a local backup ref before advancing the daily branch. Commit only the scoped source files, retain all other dirty work in the isolated checkout, and fast-forward the daily branch. Re-run Pavo regression tests, type checks, and a normal stamped build on the target. Record command results and any environment-blocked checks in the external merge receipt. Preserve daily project data, login state, and untracked files. Keep the source worktree for the unrelated unfinished work.

The remote delivery preflight could not fetch because the configured local proxy at port 7897 was unavailable. This is a local customized-branch integration, not an upstream PR merge; do not claim remote CI or a `delivery:verify-merged` receipt.
