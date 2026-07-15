# AI Capability Slice: Generation Runtime Scheduling

Date: 2026-07-14
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
- A version node inherits the source node's model settings, uploaded references, group, and incoming reference edges. It deliberately does not inherit outgoing edges, preventing a new attempt from silently replacing downstream inputs.
- When a completed node also depends on ungenerated references, the dependency preview stays read-only until confirmation; confirmation then creates the version node and runs the rebuilt plan against that node.
- Codex Img2 reports queue and elapsed generation progress, detects five minutes without output, keeps a ten-minute hard timeout, and retries one explicit network transport failure inside the same idempotent submission.
- Jimeng Web uses a dedicated Nomi bridge on `127.0.0.1:3457` and verifies the bridge instance identity before sending work.

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

## Cost And Safety Checks

- Renderer retries reuse one run id. Electron replays the same in-flight or settled promise for that id, so a retry cannot submit the paid task twice.
- Codex network recovery occurs inside the same Electron invocation and only for explicit transport failures. It does not pass through the renderer submission loop.
- Polling failures never resubmit a paid task. They remain query-only and eventually enter the recoverable state.
- The idempotency ledger never evicts an unexpired entry to make room. At the safety limit it rejects a new submission until entries expire.
- Cancelling a non-Codex provider immediately stops local waiting, but cannot guarantee that a provider without a cancellation API stops or refunds its already accepted remote task.
- A version node is created only after the user confirms generation. Cancelling the dependency preview creates no node and performs no provider call.
- If spend-grant creation fails after a dependency-plan version node is created, the empty version remains visible and reusable; the system does not delete it or create another version on the next plan retry.
- No API keys or provider credentials were added to renderer state, logs, tests, or the Jimeng bridge protocol.

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

## Verification Evidence

- Focused non-destructive regeneration suites: 3 files and 38 tests passed.
- Focused generation/runtime suites: 217 tests passed, followed by 119 cancellation/task-action tests after the final abort-path change.
- `pnpm test`: 300 files passed, 1 skipped; 2716 tests passed, 2 skipped. One unrelated workspace-registry concurrency run first lost 1 of 80 entries; that case then passed three focused reruns and the complete suite rerun.
- `pnpm run build`: renderer and Electron production builds passed.
- `pnpm run typecheck`: renderer and Electron TypeScript checks passed after preserving the timeline-only in-place API.
- `pnpm run lint:ci`: 0 errors and 97 existing warnings, below the configured ceiling of 98.

## Residual Risk

- Codex Img2 still starts one ephemeral Codex CLI process per image. CLI startup, remote image generation, and account-side queueing remain the dominant latency and cannot be removed by renderer concurrency.
- Two concurrent Codex generations are intentionally conservative. Raising this can increase memory pressure, upstream throttling, and timeout probability.
- Provider-side rate limits are not discovered dynamically. The current limits are static and should be adjusted only with measured provider telemetry.
- Non-Codex providers need vendor-specific cancellation adapters for guaranteed remote cancellation.
- Bulk generation can still include an already completed node when the user explicitly disables “only generate missing results”; that legacy batch path is not yet graph-aware version forking. The per-node retry path implemented here is non-destructive.
- The full production launch remains outside Gate 8 and requires an explicit stage advance.
