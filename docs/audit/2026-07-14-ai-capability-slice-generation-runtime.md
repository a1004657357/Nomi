# AI Capability Slice: Generation Runtime Scheduling

Date: 2026-07-14, updated 2026-07-17
Gate: 8 - AI capability integration
Status: implemented and locally verified, awaiting explicit approval to advance

## User Capability

- Batch generation is globally bounded at eight active nodes instead of creating an unbounded set of provider calls.
- The scheduler enforces provider-specific limits: Codex Img2 and Jimeng Web each run at most two tasks concurrently; other providers default to four.
- Mixed-provider batches no longer slow every provider to the Codex limit. Ready work from another provider can use free global capacity.
- A dependent shot starts as soon as its own required reference succeeds. It no longer waits for unrelated slow shots in the same topology layer.
- Node generation and the entire active batch can be stopped from the canvas. Cancelling a batch prevents waiting nodes from starting.
- Providers that return multiple media assets keep the first as the main result and expose the remaining assets through the node result history.
- Generating again from a completed canvas node creates a separate version node. The prior node, result, history, and downstream graph remain unchanged, so V1/V2/V3 can be compared or reused independently.
- The same non-destructive rule now covers selection batches, storyboard batches, batch settings, and Agent `run_generation_batch`. Version nodes are created only after confirmation; when an upstream and downstream node are both regenerated, the new downstream is rewired to the new upstream.
- A version node inherits the source node's model settings, uploaded references, group, and incoming reference edges. It deliberately does not inherit outgoing edges, preventing a new attempt from silently replacing downstream inputs.
- When a completed node also depends on ungenerated references, the dependency preview stays read-only until confirmation; confirmation then creates the version node and runs the rebuilt plan against that node.
- Codex Img2 reports queue and elapsed generation progress, detects five minutes without output, keeps a ten-minute hard timeout, and retries one explicit network transport failure inside the same idempotent submission.
- Jimeng Web uses a dedicated Nomi bridge on `127.0.0.1:3457` and verifies the bridge instance identity before sending work.
- Agnes batches are start-rate limited as well as concurrency limited. Video submissions use a 60-second interval, high-resolution image submissions use a conservative 6-second interval, and waiting nodes expose an estimated provider-window delay.
- Renderer scheduling is predictive UX. Electron is the authoritative submission gate and persists reservations under `userData`, so live GUI, RPC, MCP, and one-shot headless CLI processes share the same Agnes window.

## Contracts

- Renderer scheduler: global concurrency 8, default provider concurrency 4, Codex concurrency 2, Jimeng concurrency 2.
- `nomi:tasks:cancel`: best-effort task cancellation. Codex maps the generation run key to its active process group and terminates it.
- Codex child lifecycle: normal exit removes the child from the active registry; cancellation and timeout use `SIGTERM`, then `SIGKILL` after a bounded grace period.
- Jimeng bridge identity: `nomi-jimeng-runner-v1`; a reachable server without this identity is rejected as incompatible.
- Persisted node limits: 24 media results and 50 generation run records per node.
- Canvas retry contract: completed nodes use `regeneratedFrom` version lineage; cross-category copies alone use `derivedFrom`.
- Graph copy contract: regeneration copies incoming edges in their existing reference order and never copies outgoing edges.
- The timeline's explicit “generate and replace current clip” command remains an in-place operation because its clip must retain the same `sourceNodeId`; the replaced result is still retained in node history.
- Process cache limits: 200 fingerprint entries with a two-hour TTL; 1000 unexpired idempotency entries with a five-minute default TTL.
- Agnes rate reservations use separate `agnes:video`, `agnes:image`, and `agnes:default` lanes. The ledger contains only timestamps and is atomically written under a short cross-process lock.

## Cost And Safety Checks

- Renderer retries reuse one run id. Electron replays the same in-flight or settled promise for that id, so a retry cannot submit the paid task twice.
- Codex network recovery occurs inside the same Electron invocation and only for explicit transport failures. It does not pass through the renderer submission loop.
- Polling failures never resubmit a paid task. They remain query-only and eventually enter the recoverable state.
- The idempotency ledger never evicts an unexpired entry to make room. At the safety limit it rejects a new submission until entries expire.
- Cancelling a non-Codex provider immediately stops local waiting, but cannot guarantee that a provider without a cancellation API stops or refunds its already accepted remote task.
- A version node is created only after the user confirms generation. Cancelling the dependency preview creates no node and performs no provider call.
- If spend-grant creation fails after a dependency-plan version node is created, the empty version remains visible and reusable; the system does not delete it or create another version on the next plan retry.
- No API keys or provider credentials were added to renderer state, logs, tests, or the Jimeng bridge protocol.
- A fingerprint-cache hit returns before the authoritative rate reservation. Only a real vendor submission consumes a start slot.
- The persistent ledger reserves the slot before sleeping. Concurrent processes therefore cannot observe the same free window and submit together; a process crash can waste a slot but cannot increase spend or request rate.

## Evaluation Cases

- Fair scheduling when one provider is full and another provider has queued work.
- Global and per-provider concurrency ceilings under mixed batches.
- Queued cancellation, active node cancellation, and whole-batch cancellation without starting remaining nodes.
- Dependency-ready execution while an unrelated node remains slow.
- Codex normal completion, network retry, inactivity timeout, forced termination, explicit cancellation, and stale diagnostic cleanup.
- Jimeng correct instance, foreign instance, dedicated port environment, and managed runner lifecycle.
- Three returned image assets becoming one main result plus two selectable history alternatives.
- V1 result preservation while V2 generates into a separate node, including a clean V2 history.
- Incoming reference-edge inheritance, outgoing-edge isolation, same-category `regeneratedFrom` lineage, and dependency-plan replacement of the completed source with its confirmed version node.
- Result history, run history, fingerprint cache, and idempotency ledger bounds.
- Agnes 60-second video spacing, 6-second image spacing, fair progress for other providers while Agnes waits, cancellation before a queued rate-limited task starts, and old-project model-key fallback.
- Cross-instance persistent Agnes reservations and a real `runtime.runTask` integration assertion that writes the Electron ledger before the provider request.
- Codex timeout, cancellation, and SIGKILL tests now register their retained diagnostic directories with teardown; a full suite no longer leaks three `nomi-codex-img2-*` directories per run.

## Verification Evidence

- Focused non-destructive regeneration suites: 3 files and 38 tests passed.
- Focused generation/runtime suites: 217 tests passed, followed by 119 cancellation/task-action tests after the final abort-path change.
- Latest Gate 8 closeout: `pnpm gates` passed with 360 test files passed, 2 skipped; 3120 tests passed, 4 skipped; lint remained at the accepted 98-warning ceiling and both production builds passed.
- `pnpm run build`: renderer and Electron production builds passed.
- `pnpm run typecheck`: renderer and Electron TypeScript checks passed after preserving the timeline-only in-place API.
- `pnpm run lint:ci`: 0 errors and 97 existing warnings, below the configured ceiling of 98.

## Residual Risk

- Codex Img2 still starts one ephemeral Codex CLI process per image. CLI startup, remote image generation, and account-side queueing remain the dominant latency and cannot be removed by renderer concurrency.
- Two concurrent Codex generations are intentionally conservative. Raising this can increase memory pressure, upstream throttling, and timeout probability.
- Provider-side rate limits are not discovered dynamically. The current limits are static and should be adjusted only with measured provider telemetry.
- Paid or enterprise Agnes accounts may allow higher throughput, but Nomi intentionally keeps the documented free/default floor until a reviewed account-tier override exists.
- Non-Codex providers need vendor-specific cancellation adapters for guaranteed remote cancellation.
- The full production launch remains outside Gate 8 and requires an explicit stage advance.
