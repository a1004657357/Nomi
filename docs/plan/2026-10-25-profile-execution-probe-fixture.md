# Profile Execution Metadata Probe Fixture

Status: implemented, not pushed. Author line is not final independent acceptance.
Normal merge of candidate `503348841f2d05fe922d65c11450b8c5990befad`
completed without conflicts at `09f72b52323aed8e330da7c7a553a294e1fe49de`.
No reset or coordinator-tree write.

## Design Card

| Item | Decision |
| --- | --- |
| 1. Use | Preserve the real executor's localized-reference preflight before one media submit. Only the assigned unit test changes; no App, Provider, DNS, browser or full suite. |
| 2. Owner | `executeProfileOperation` owns orchestration; `assertAgnesPublicImageReachable` owns probe semantics; `hardenedFetch` owns metadata transport/policy. Test only substitutes metadata transport response, not the executor or probe. |
| 3. Reuse | Keep real asset localization, request builder and vendor HTTP classification. Use existing submit policy dependency injection for offline vendor DNS. File-local rate-window stub avoids writing the user's durable rate ledger; it must be untouched on rejection. No policy reimplementation. |
| 4. States | Accepted image metadata leads to one submit; failed/expired/nonimage metadata rejects before build/vendor/rate; unknown or timed-out media submit never replays. Local source becomes its fresh public original URL before probing, with no input mutation. |
| 9. Acceptance | Red target file: 4 pass / 1 fail / 0 skip, matching CI. Green target file with maxWorkers=1; exact probe options, causal order, local/public inputs and negative side-effect counts. Scoped v3 contract and lint only. Coordinator runs integrated suite. Revert the standalone test commit to roll back. |

## Root Cause and Scope

CI `ci503-unit-49.log:3243` and the local red report show the old global fetch
mock cannot supply the default hardened metadata request, which now waits for
the application route before DNS. Domain test setup should substitute the real
metadata transport owner, not initialize or depend on user networking.

Retain the executor and probe themselves. Spy on the real builder/vendor entry
points, assert GET with only Range, headersOnly and submit refusal semantics,
then keep the actual vendor response handling under an offline fetch fixture.
Do not claim this test proves URL/DNS safety: that belongs to unchanged hardened
and web-boundary suites and the independent F3 executor proof.

Only `electron/tasks/profileTaskExecution.test.ts` and this plan/v3 contract are
changed. No production, global setup, thresholds, budgets, baselines, skip,
timeout or retry configuration changes.

## Verification

All evidence is under
`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/`.

- `profile-execution-ci503-red.json`: original target, 4 pass / 1 fail / 0 skip,
  with the exact application-network-not-ready failure before production edits.
- `profile-execution-ci503-green-02.json`: target 13/13, 0 skip.
- `profile-execution-ci503-green-final.json`: target 13 plus unchanged direct
  probe 4, total 17/17, 0 skip. All runs use `--maxWorkers=1`; no retries enabled.
- `profile-execution-ci503-eslint-final.json`: changed test 0 errors / 0 warnings.
- Pure scoped v3 contract validation: ok, no errors. Not a full gate run.
- `door-map executeProfileOperation assertAgnesPublicImageReachable`: five
  production consumer doors, all untouched by this test-only patch.

The initial new negative incorrectly expected generic logical code 500 to be
submission-unknown (`green-01.json`: 11 pass / 1 fail). Existing vendor semantics
classify it as server/retryable. Keep that real classification and explicitly
prove even a retryable classification does not automatically resubmit. A separate
502 generation_outcome_unknown envelope proves the nonretryable unknown path.
No production behavior or original test expectation was changed to hide a bug.

New coverage includes real local-reference localization with a fresh original
URL, strict GET/Range/headersOnly/submit options, schema/builder and vendor spies
that call their real implementations, three probe refusals with zero
build/vendor/rate/fetch calls, and four media-failure variants with exactly one
probe, build, rate reservation and submit. Rate reservation itself is an offline
stub, never the user's persistent ledger; this does not test rate-policy values.

Full Vitest, hardened/web-boundary suites, browser, App, Provider, DNS, full types
and gates were not run. Integrated CI and final independent review remain with
the coordinator and another reviewer.
