# Gate 8 Provider And Quality Hardening Acceptance

Date: 2026-07-18
Gate: 8 - AI capability integration
Decision: partial acceptance; remain in Gate 8
Environment: isolated smoke projects only

## Scope And Safety Boundary

- This report covers the hardening work after the original Gate 8 acceptance.
  The earlier baseline call accounting remains in
  `docs/audit/2026-07-18-gate8-real-provider-acceptance.md`.
- The new debugging allowance was capped at 10 endpoint attempts per available
  model and two concurrent requests.
- Automatic harness retries were disabled.
- No daily Nomi project was opened or modified.
- Existing encrypted provider connections were copied into isolated settings.
  No key, cookie, authorization header, or account identifier was written into
  evidence.
- Gate 9, release, and publication work were not started.

## Hardening Call Accounting

| Route | Conservative endpoint attempts | Confirmed remote submissions | Result |
| --- | ---: | ---: | --- |
| Codex Img2 | 10 / 10 | 9 confirmed, 1 interrupted/ambiguous | Budget reached; no more calls |
| Agnes Video V2.0 | 1 / 10 | 1 | One video returned |
| RunningHub image-to-3D | 0 / 10 | 0 | Skipped because no model is connected |

Codex accounting includes two attempts from the interrupted network-retry
diagnostic, one style-transfer request, one single-coordinate mood diagnostic,
five mood fan-out tasks, and one Agent-internal imagegen retry observed inside a
failed fan-out task. The harness report counts five fan-out tasks; this audit
uses the more conservative endpoint count of six for that batch.

Two early Agnes harness attempts failed local model-binding validation in stale
built assets and never reached Agnes. The harness conservatively records three
attempts, while logs and sub-millisecond failures show that only the final
attempt was a remote submission.

## Implemented Hardening

### Agnes image-to-video

- Recipe-derived video nodes now pin the selected provider/model and opt out of
  model auto-selection, preventing an image model from replacing Agnes Video.
- Image input is localized and exposed as one public URL string, matching the
  Agnes request contract.
- Public URLs are probed before submission with private-host rejection,
  bounded timeout, range GET, and content checks.
- Final result parsing supports the current `url` response and the legacy
  `remixed_from_video_id` form.
- Timings now separate localization, public probe, rate wait, provider create,
  polling, persistence, and total execution.

### Codex Img2 lifecycle and batches

- Default external network attempts are now one. Additional attempts require an
  explicit caller opt-in.
- The smoke timeout environment value now reaches the Codex child.
- The prompt now requires exactly one built-in imagegen invocation and an
  immediate failure return on network, timeout, or service errors.
- Runtime and smoke reports include queue, reference preparation, prompt build,
  Codex execution, verification, asset write, and total timings.
- Mood fan-out was verified with two simultaneous `codex exec` children and
  immediate slot refill when one task completed.
- The smoke harness now selects the model before applying recipe parameters, so
  model defaults cannot reset `sample5` to `single`.
- The spend dialog's actual independent request count is checked before
  confirmation and used for call accounting.
- A successful later attempt clears stale error and failure classifications.

### Mood quality

- The five representative coordinates contain explicit brow, eyelid, cheek,
  mouth, and jaw performance anchors.
- Gaze, head direction, camera, framing, lighting, clothing, and identity are
  locked so eye movement cannot substitute for expression.
- Pixel checks remain labeled as proxies.
- Missing semantic comparison fails closed instead of claiming a pass.
- Structured mood vision review is available from the result node.

### Style transfer

- Source dimensions and aspect ratio are inspected before submission.
- The nearest native model ratio and exact source ratio are included in the
  request and prompt.
- If the provider misses the ratio, Nomi creates an exact-ratio derivative and
  retains the raw provider output as an alternative with provenance.

### 3D-guided multiview

- The model3d viewer exposes nine deterministic camera presets with exact
  azimuth/elevation metadata.
- Batch capture persists the nine guide frames into one collection node instead
  of adding nine loose canvas nodes.
- The GLB and previous captures are retained.
- This path does not claim that prompt-only 2D multiview proves 3D geometry.

## Real Provider Results

### Agnes Video V2.0: pass

- Remote submissions: 1.
- Output: H.264 video with AAC audio, 1280x704, 24 FPS, 5.042 seconds,
  816,103 bytes.
- Technical checks: 0% black frames, 0% frozen frames, 2.27% relative
  difference from 16:9.
- Content review: the boy and robot remain present, the action is coherent, and
  no obvious identity drift, deformation, jump, black frame, or freeze was
  observed.
- Total attempt: 119.602 seconds.
- Localization: 3.559 seconds for two assets.
- Public URL probe: 0.889 seconds.
- Provider create: 0.348 seconds.
- Renderer submit: 13.171 seconds.
- Provider poll: 103.821 seconds.
- Persistence: 0.975 seconds.
- Asset:
  `evals/runs/2026-07-18T15-49-00+08-00-gate8-agnes-hardening-real/evidence/assets/video-look-apply/attempt-3/video-1784361323814.mp4`
- Report:
  `evals/runs/2026-07-18T15-49-00+08-00-gate8-agnes-hardening-real/report.json`

### Codex style transfer: pass

- Output: 1254x1254 PNG, 1,764,459 bytes.
- Source and output aspect ratios are both 1.0; relative error is 0%.
- Content-retention proxy passed with normalized hash distance 0.2068.
- Style-progress proxy passed at 0.2404.
- Human review confirmed retained robot identity and composition with clear
  warm cinematic lighting and material changes.
- Total attempt: 147.071 seconds. Codex generation occupied 145.688 seconds;
  all local phases were negligible.
- Asset:
  `evals/runs/2026-07-18T16-08-00+08-00-gate8-codex-style-real/evidence/assets/image-style-transfer/attempt-1/codex-img2-1784362254524.png`
- Report:
  `evals/runs/2026-07-18T16-08-00+08-00-gate8-codex-style-real/report.json`

### Codex mood sample: semantic partial, reliability fail

- Requested coordinates: `(0,0)`, `(0,4)`, `(2,2)`, `(4,0)`, `(4,4)`.
- Fan-out contract: 5 tasks, two-way concurrency, no harness retry.
- Result: 3 readable images and 2 network failures.
- Successful coordinates: `(0,4)`, `(2,2)`, and `(4,4)`.
- Successful output dimensions: 1537x1023.
- Successful Codex execution times: 95.494, 174.371, and 280.079 seconds.
- Total batch time: 770.131 seconds.
- Human review:
  - `(0,4)` reads as low-energy, restrained, and distant.
  - `(2,2)` reads as a neutral baseline.
  - `(4,4)` has clear brow, eyelid, cheek, and jaw tension and reads as
    high-energy tension/anger.
  - Identity, gaze target, close framing, and skin texture remain coherent.
- Local duplicate and texture proxies passed for the three outputs.
- Batch quality failed because only 3/5 outputs exist and no connected semantic
  comparator produced a machine verdict.
- One failure was a direct network error. The other showed an internal imagegen
  retry inside the same Codex task; the new prompt explicitly forbids that
  behavior, but no further real call was allowed after reaching 10/10.
- Assets:
  `evals/runs/2026-07-18T16-22-00+08-00-gate8-codex-mood5-real/evidence/assets/portrait-mood/attempt-1/`
- Report:
  `evals/runs/2026-07-18T16-22-00+08-00-gate8-codex-mood5-real/report.json`

### RunningHub image-to-3D: conditional skip

- Zero-spend preflight found no connected compatible model.
- Candidate archetypes are Hunyuan3D, HiTem3D, and Meshy 6.
- Remote submissions: 0.
- Report:
  `evals/runs/2026-07-18T16-39-00+08-00-gate8-runninghub3d-preflight/report.json`

### 3D camera proxy: local pass

- Nine deterministic presets and nine-frame collection persistence are covered
  by unit tests.
- No remote model was required.
- A real GLB-to-nine-frame UI acceptance remains conditional on an imported GLB
  or a connected image-to-3D provider.

## Cost

- No provider returned billing telemetry or a CNY-denominated charge.
- Agnes used the connected route and returned no charge metadata.
- Codex used account quota; the catalog has no auditable unit price.
- RunningHub was not called.
- Observable direct cash charge in Nomi is CNY 0.00. Exact account-quota value
  remains unavailable, so the CNY ceiling cannot be independently converted or
  machine-verified.

## Cleanup

- Every completed smoke report records normal Electron close, exit code 0, no
  forced kill, no temporary Codex home, no spawned child, and removal of the
  isolated project root.
- The two retained failed-task diagnostic directories were inspected and then
  removed explicitly.
- A 43 MB orphan `nomi-codex-home` from the earlier interrupted diagnostic was
  found with no open process or report owner and removed explicitly.
- Final process scans found no smoke harness or Codex image-generation child.
- A two-hour temporary-resource rescan found zero matching smoke, imagegen, or
  isolated Codex-home directories.
- The user's normal Nomi application processes were not terminated.

## Verification

- Focused tests: 20 files, 164 tests passed.
- Codex/smoke regression subset: 34 tests passed.
- Repository typecheck: `pnpm typecheck` passed.
- Production build: `pnpm build` passed.
- Diff whitespace check for the hardening files passed.
- A non-standard root `tsc --noEmit` still reports pre-existing
  `vite.config.ts` typing issues; the repository's declared `pnpm typecheck`
  excludes that configuration file and passes.

## Gate Decision

Gate 8 remains open. The Agnes and style-transfer blockers are closed. The
following items still block Gate 9:

1. Codex mood batch reliability must complete 5/5 without a hidden internal
   retry.
2. The structured vision reviewer must record semantic and identity verdicts,
   or an approved local face/expression comparator must be connected.
3. RunningHub image-to-3D requires a connected provider before real acceptance.
4. A real GLB should be used for one end-to-end nine-camera capture acceptance.
5. Provider billing telemetry or an accepted account-quota assumption is still
   required for machine-auditable currency reporting.

## Stage Boundary

- Current gate: 8 - AI capability integration
- Allowed work: model calls, prompt iteration, eval cases, cost checks, and
  safety checks
- Forbidden work: unreviewed production launch, publication, or Gate 9 work
- Required artifact: AI Capability Slice
- Acceptance check: focused tests, isolated real-provider evidence, retained
  assets, and resource cleanup
- Next recommended skill: `ai-product-stage-gate:stage-gate-reviewer`
