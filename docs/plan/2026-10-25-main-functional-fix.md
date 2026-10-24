# Main functional fix: storyboard parameters and product aliases

Status: implemented, not pushed; local verification below. Base: `1dbfc36ab7c8f82421555cea47131c7835fc9dfb`.
Owner: main-functional-fix line. Coordinator owns integration, push and merge.

## Design Card

| Field | Decision and evidence |
| --- | --- |
| 1. User workflow | Existing plans project to ShotSpec, extract row images and reuse row videos without losing film defaults or explicit row parameters. Existing Codex Img2 names retain the same product identity. Real media and account workflows are unverified by instruction. |
| 2. Ownership | Film parameter scope belongs to `storyboardShotScope.resolveShotParams/resolveKeyframeParams`; archetype identity belongs to the shared curated model identity boundary, consumed by renderer, catalog and platform gate. Run door-map before production edits. |
| 3. Reuse | Reuse the existing parameter resolvers and exact identity matching, not a new parameter merger or fuzzy product-name exception. Explicit alias canonicalization precedes product-stem classification. |
| 4. States | Pure projection/identity changes only. Empty defaults stay absent; explicit row values survive; unknown model identities remain unknown; invalid multi-product profiles still fail. No new UI or async state. |
| 9. Acceptance / rollback | Two original checks plus focused regressions, contract validation and changed-file lint. Coordinator independently integrates. Revert this line's commit to roll back. No whole-repository suite, push, merge, media calls, account/proxy changes, memory writes, 9:16 work, package/workflow/checker/style changes. |

## Root Cause

- A: migration only received a shot, while row extraction read raw parameters. Neither path consistently carried the owning plan through the shared scope resolver.
- B: the platform gate inferred product identity from spelling alone; runtime-supported legacy aliases had no explicit canonical relationship shared with that gate.

## Verification Log

- Original `check:storyboard-owner`: red in both assigned files.
- Original `check:platform-archetypes`: red, four inferred stems for `gpt-image-2`.
- `delivery:preflight --remote fork --base main`: pass, clean task branch, remote base ancestor true.
- Offline install lacked a tarball; restricted network install failed DNS. The same cache-first, frozen, ignore-scripts install completed with network permission; no proxy settings changed.

## Results

- Dependency install completed: 1391 packages, frozen lockfile, prefer-offline, ignore-scripts. No tracked dependency or generated-table changes.
- Red: original owner gate named both assigned files; original platform gate reported four product stems. Initial focused slice: 5 failed / 46 passed; added reader wrapper regression: 2 failed / 12 passed. Exact-alias unknown-name tests additionally caught object-prototype names and were repaired with own-key membership.
- Green: seven focused files, 102 tests passed. Covers shot migration/readers, row outputs, existing scope owner, exact aliases, renderer/catalog identity parity and platform gate fixtures.
- Both original gates passed. Platform gate still scans 120 profiles with the unchanged one-entry baseline; no profile-wide exemption or threshold increase.
- Changed TypeScript files: ESLint zero errors/warnings. Both changed MJS files: node syntax checks passed; repository ESLint intentionally ignores MJS scripts.
- Root-cause checker unit tests: 54 passed. Final formal checker: passed without contract warnings after restoring the resolver. The template omits current detection/recurrence/owner fields; these were added only to this line's contracts, with generated door maps refreshed.
- `pnpm exec tsx scripts/gen-archetype-wire-defaults.ts --check`: passed; no generated files edited. Initial restricted invocation hit a local pipe permission error, then the identical permitted invocation succeeded.
- Additional model registry + generator slice: 20 passed, 2 failed. The identical 20/2 result was reproduced with `electron/shared/modelArchetypes/index.ts` restored byte-for-byte to the specified base (verified by `git diff --exit-code BASE -- path`), then this line's two-line change was restored.
- Existing out-of-scope failures: `index.test.ts:158` expects seedance2.5 resolutions `[480p,720p,1080p]`, current profile yields `[720p]`; `index.test.ts:176` expects VIP `[720p,1080p]`, current profile includes `4k`. No expectations or model capabilities were altered. Coordinator owns any follow-up.

## Limits

- No full suite/build, UI/browser, Windows or real-media acceptance was run. These remain unverified, not implied by focused green tests.
- Node 24.1 prints an experimental TypeScript stripping warning when the MJS gate imports the shared TS identity owner. This is a runtime warning, not a product-classification failure. Other Node versions and cloud CI were not run by this line.
- No memory, account, proxy, design token/style, package manifest, CI workflow, generic root-cause checker, 9:16 behavior or remote branch was edited.
- Coordinator must integrate the local commit; this line did not push or merge.
