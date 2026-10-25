# Gate 8 Real Provider Acceptance

Date: 2026-07-18
Gate: 8 - AI capability integration
Decision: partial acceptance; remain in Gate 8
Environment: isolated `Capability Recipe Real Smoke` projects only

## Approved Boundary

- Maximum authorized submissions: 18.
- Maximum concurrency: 2.
- Automatic retries: disabled.
- Cash budget: CNY 10.
- Daily Nomi projects: not opened or modified.
- Credentials and browser session data: reused through the existing encrypted/runtime connections; no key or cookie value was printed or copied into evidence.
- Gate 9 and release work: not started.

## Submission Accounting

| Route | Authorized attempts counted | Confirmed remote submissions | Outcome |
| --- | ---: | ---: | --- |
| Codex Img2 multi-view | 9 | 9 | 9 images returned |
| Codex Img2 portrait realism | 1 | 1 | 1 image returned |
| Codex Img2 mood sample | 5 | 5 | 5 images returned |
| Codex Img2 style transfer | 1 | 1 | 1 image returned |
| Agnes image-to-video | 1 | 0 | rejected locally before the provider request |
| RunningHub image-to-3D | 0 | 0 | skipped because no connected credential/model was available |
| **Total** | **17 / 18** | **16** | no retries |

Fan-out recipe execution was capped at two workers. The smoke policy used one attempt per recipe and a retry limit of zero. Agnes retained a 60-second video start-rate policy even though the request was rejected locally.

## Cost

- No run returned provider billing or a CNY-denominated charge.
- Codex Img2 used the connected Codex account route. The local catalog has no unit-price metadata, so the 16 account-quota consumptions cannot be converted into an independently auditable CNY amount.
- Agnes did not receive a remote request. RunningHub was not invoked.
- Observable direct cash charges in Nomi: CNY 0.00. The CNY 10 ceiling was respected operationally, but exact Codex account-quota value remains unavailable and therefore is not machine-verifiable as a currency total.

## Quality Results

### Codex Img2 multi-view grid

- Execution: 9/9 successful, one authorized recipe attempt.
- Latency: 410.336 seconds provider plus post-processing; 413.507 seconds total.
- Technical checks: all nine images readable, nonblank, and consistently 1254x1254. No exact or near duplicate pair was found; minimum perceptual distance was 0.237.
- Background proxy: no obvious white-background replacement or edge discontinuity.
- Human review: the six views visible in the retained screenshot show a coherent clockwise rotation with the same robot and studio background.
- Limitation: exact camera-angle adherence, semantic identity, and 3D geometry consistency remain unverified because no semantic multi-view comparator is connected.
- Evidence retention defect: the first paid run predated the permanent-asset retention fix. The nine temporary PNG files were inspected and recorded in the report, then removed with the isolated project. Only the permanent screenshot, dimensions, hashes, and quality metrics remain. The test was not repeated because retries were prohibited.
- Result: partial pass.

### Portrait realism

- Execution: 1/1 successful.
- Latency: 102.075 seconds provider plus post-processing; 103.519 seconds total.
- Output: 1537x1023 PNG.
- Local checks: readable, nonblank, no severe texture anomaly, and no large central framing/color drift.
- Human review: pores, wrinkles, fine hairs, and uneven skin tone remain visible without obvious waxy smoothing.
- Limitation: no face-embedding comparator is connected, so identity consistency is visually plausible but not machine-proven.
- Result: pass with identity-comparator limitation.

### Mood sample

- Execution: 5/5 successful for the representative coordinates `(0,0)`, `(0,4)`, `(2,2)`, `(4,0)`, and `(4,4)`.
- Latency: 358.276 seconds provider plus post-processing; 360.138 seconds total.
- Technical checks: five readable 1537x1023 images, no duplicate center image, no obvious blank frame or texture failure.
- Human review: identity and skin appearance are coherent, but most variation is eye direction. Mouth shape, brow tension, cheeks, and broader facial-muscle changes are too weak to communicate five distinct emotions.
- Result: technical pass, semantic quality fail.

### Style transfer

- Execution: 1/1 successful.
- Latency: 78.415 seconds provider plus post-processing; 79.565 seconds total.
- Output: 1188x1324 PNG.
- Local checks: valid visual content and approximately 27% movement toward the reference visual signature.
- Failure: output aspect ratio `0.8973` differs from the square source by `10.27%`; central structure also changed enough to trigger a content-retention warning.
- Result: fail.

### Agnes image-to-video

- Attempt latency: 1 millisecond execution, 1.512 seconds total.
- Failure: the generated video node inherited the source image node's top-level `agnes-image` archetype identity even though the inspector selected `agnes-video-v2.0/i2v`.
- Provider impact: local validation rejected the task before the Agnes network request; no video asset exists.
- Fix: recipe-derived nodes now overwrite `archetypeId`, model alias, kind-specific model/vendor fields, and remove inherited fields from the opposite media kind.
- Verification: the reproducing regression test failed before the fix, then the controller/catalog/runner suite passed 141 tests. A post-fix zero-spend preflight selected `agnes/agnes-video-v2.0/i2v` successfully.
- The real request was not repeated because the approved policy prohibited retries.
- Result: fail for this acceptance run; implementation defect fixed but real provider acceptance remains open.

### RunningHub image-to-3D

- Preflight found no connected compatible image-to-3D model or RunningHub credential.
- No request was submitted, as required by the conditional authorization.
- Result: skipped.

## Evidence And Assets

- Codex run report: `evals/runs/2026-07-18T14-19-00+08-00-gate8-codex-real/report.json`
- Grid screenshot: `evals/runs/2026-07-18T14-19-00+08-00-gate8-codex-real/evidence/image-multiview-grid9-attempt-1.png`
- Portrait result: `evals/runs/2026-07-18T14-19-00+08-00-gate8-codex-real/evidence/assets/portrait-refine/attempt-1/codex-img2-1784356220398.png`
- Mood assets: `evals/runs/2026-07-18T14-19-00+08-00-gate8-codex-real/evidence/assets/portrait-mood/attempt-1/`
- Mood contact sheet: `evals/runs/2026-07-18T14-19-00+08-00-gate8-codex-real/evidence/portrait-mood-contact-sheet.png`
- Style result: `evals/runs/2026-07-18T14-19-00+08-00-gate8-codex-real/evidence/assets/image-style-transfer/attempt-1/codex-img2-1784356664267.png`
- Agnes failed-run report: `evals/runs/2026-07-18T14-38-38+08-00-gate8-agnes-video-real/report.json`
- Agnes post-fix preflight: `evals/runs/2026-07-18T14-44-30+08-00-gate8-agnes-video-postfix-preflight/report.json`
- RunningHub conditional preflight: `evals/runs/2026-07-18T14-17-40+08-00-gate8-runninghub3d-preflight/report.json`
- Public-domain portrait fixture: `evals/fixtures/portrait-woman-public-domain.jpg`

## Cleanup

Every Codex, Agnes, and RunningHub smoke process reported:

- Electron closed normally with exit code 0.
- Forced kill was not needed.
- Temporary isolated project root was removed.
- Temporary Codex homes remaining: 0.
- Spawned child processes remaining: 0.

A final process scan found no isolated smoke Electron, Codex generation, or harness process. The user's normal Nomi application was not terminated.

## Gate Decision

Gate 8 remains open. Gate 9 and release are explicitly blocked until:

1. Agnes image-to-video completes one new, explicitly authorized real-provider acceptance after the binding fix.
2. Mood prompts demonstrate materially distinct facial expressions rather than mostly gaze changes.
3. Style transfer preserves the requested aspect ratio.
4. Multi-view evidence retains all nine original outputs and gains semantic camera/identity review, or receives explicit human approval with the known limitation.
5. RunningHub is tested only after the user connects it.
6. Provider billing telemetry or an explicit accepted account-quota assumption makes the CNY budget auditable.
