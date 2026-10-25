# Main functional follow-up: library floor and migrated registry tests

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Parent commit: `bdf1fbb3406aca49ffc11254a26535d16d6e0e6d`. Same isolated branch and worktree; coordinator owns integration and full CI.

## Design Card

| Field | Decision |
| --- | --- |
| 1. Workflow | Keep the exact legacy alias boundary buildable for existing library targets; make model registry tests exercise the already-shipped separate Seedance 2.5 profile and distinct 2.0 VIP tiers. No generation, CLI calls or capability changes. |
| 2. Owner | `identifierAliases.ts` owns exact own-key membership. Existing `dreaminaSeedance.ts` and `dreaminaSeedance25.ts` own capability declarations; registry tests consume them, not replace them. |
| 3. Reuse | Use `Object.prototype.hasOwnProperty.call` rather than raising tsconfig libraries. Preserve prototype-like unknown identity tests. Reuse current separate 2.5 identity and existing catalog-test semantics. |
| 4. States | Pure membership and test corrections only; unknown identities stay unchanged. No UI, asynchronous state or account behavior changes. |
| 9. Acceptance / rollback | Red/green ES2021 compile regression; registry, existing dreamina seed and alias focused tests; root-cause check and scoped lint. Coordinator runs complete CI. Revert this follow-up commit only for rollback. |

## Evidence and Conflict Assessment

- Read `docs/research/2026-09-01-dreamina-cli-v1417-matrix.md` in full. It records a 2026-09-01 CLI 1.4.17 help snapshot, not verified current external service behavior; its notes explicitly state that value-combination checks were not reachable without login.
- Its four video-command rows declare 2.5 as 480p/720p/1080p, duration 4-30; `seedance2.0_vip` as 720p/1080p/4k; other 2.0 models, including fast_vip, as 720p. Current capability declarations agree on these assertions.
- Current `dreaminaSeedance25.ts` explicitly explains why 2.5 is an independent catalog product: duration, resolution and multimodal limits differ. It has four modes with `modelEnum: seedance2.5` and no variants. Git blame traces the independent-profile explanation to merge `82bbb2aa0e`; existing seed tests also enforce separate 2.0/2.5 rows and mappings.
- Conflict: the old `index.test.ts` requests the removed `v2_5` variant from the 2.0 profile, treats vip and fast_vip as the same resolution set, and claims 4K is unavailable. Both current declarations and the historical matrix contradict those test assumptions. Correct tests, not production capabilities.
- No conflict was found between the historical matrix and the current resolution/duration declarations tested here. The snapshot does not dictate Nomi's catalog grouping; that architectural decision is evidenced by the separate profile and catalog tests. No claim is made about today's external models, account entitlement or runtime success.
- Coordinator log was read: `CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/model-registry-red.log` reports 2 failures / 25 passes; failures match the two obsolete registry assertions.

## Validation

- Before production edits: reproduce ES2021 compiler failure and the two existing registry failures. Add a focused compiler regression without modifying any tsconfig.
- Keep all production Seedance capabilities and 4K support unchanged. Test all four modes on the independent 2.5 profile and all modes for both 2.0 VIP tiers.
- No package, CI, style, account, proxy, memory, CLI or media changes; no push or merge.

## Results

- Red: standalone ES2021 compile failed with TS2550 at `Object.hasOwn`; the new focused compiler regression failed with the same diagnostic (1 failed / 12 passed). Original registry slice: 2 failed / 40 passed across registry, existing dreamina seed and alias tests.
- Green: 6 focused files, 64 tests passed: registry, dreamina seed, alias owner, catalog identity parity, platform classifier fixtures and generated-default builder.
- The same standalone ES2021 compile passed after the own-property replacement. The isolated branch's inherited `ES2020,ES2022.Error` library combination also passed a focused helper compile; no tsconfig changed.
- Scoped ESLint: zero errors/warnings. Formal root-cause checker against the parent commit: passed without warnings. `git diff --check`: passed.
- Only `identifierAliases.ts`, its test, `index.test.ts`, this plan and the compatibility v3 contract change. Production Seedance profiles, generated tables and all other production features are unchanged.
- Complete design-lab/browser execution and full CI remain with the coordinator. No CLI process or external model call was run.
