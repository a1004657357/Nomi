# AI Capability Slice: Creative Recipes And Agent

Date: 2026-07-16, updated 2026-07-18
Gate: 8 - AI capability integration
Status: implemented and locally verified, awaiting explicit approval to advance

## User Capability

- Nomi now has a provider-independent `CapabilityRecipe` contract shared by the manual canvas UI and Agent tools.
- The slice includes nine-view and custom-camera image generation, image-to-3D orbit handoff, 2:1 panorama generation, portrait realism, identity protection, a 5x5 mood space, reusable style/palette/effect resources, and video look/effect resources.
- Generated outputs are stored as result collections. A new run appends a new collection/version instead of deleting the previous result, so the user can compare, select, reopen, or roll back.
- `CreativeResource` nodes retain prompt tokens, source assets, provenance, license text, attribution, and commercial-use status.
- Model3D outputs can be handed to Scene3D and Blender without coupling the recipe to a specific 3D provider.
- RunningHub image-to-3D and text-to-3D queries now use a GLB-only result transform. Preview images cannot be normalized as editable models, and a preview-only success fails closed with an explicit missing-GLB error.
- Video recipe outputs now receive a local quality report with codec, duration, dimensions, target aspect ratio, black-frame ratio, and frozen-frame ratio. Video-to-video recipes additionally compare source/output duration and freeze growth.
- Dreamina CLI keeps its declared multimodal reference contract of up to nine images, three videos, and three audio files. Jimeng Web now uses a separate restricted archetype and typed bridge that transports images and videos without silently dropping video references; Web audio input is not exposed and legacy audio payloads fail with guidance to use the CLI path.
- Six original Skill Playbooks expose the same workflows to the Agent: multiview, panorama, portrait realism, mood/identity, style resources, and video look/effects.
- The six built-in creative playbooks now expand into 11 atomic canvas recipe cards. Nine-view, custom-camera, image-to-3D, panorama, portrait, identity, mood, style/resource, and video operations can be clicked or dragged independently; `brand.promo` remains a multi-stage workflow card.
- Each atomic card creates a persistent single-recipe `SkillNode` with a direct `配置并运行` action. Provider/model/parameter selection stays in the shared capability inspector, while legacy grouped nodes continue evaluating every typed recipe row for snapshot compatibility.
- Grid9 and custom-camera quality reports now expose an explicit visual-model review action. It batches the source and every locally persisted view into one multimodal text-model request, then writes identity and geometry findings back into the existing non-destructive report.

## Contracts

- Recipes describe required inputs, resource slots, parameters, output kind/count, prompt policy, postprocessing, and compatibility requirements without naming a vendor.
- `RecipeRunPlan` freezes the selected vendor/model/archetype/mode, normalized parameters, source/resource ids, output count, provider task count, and spend estimate before execution.
- Manual UI and Agent calls both use the same readiness validation, spend confirmation, controller, prompt builder, runner, and postprocess path.
- `SkillNode` does not duplicate provider logic. Recipe actions open the shared capability inspector with the matching source and only the connected resources accepted by that recipe; completed output ids are recorded back on the node. Agent actions are routed to `CanvasAssistantPanel`, which is the tool host for canvas mutations.
- Atomic component items retain their parent Skill name only for Agent orchestration. Each card carries exactly one recipe and a precise image, video, multiview, or model3d presentation kind; workflow templates are not flattened into fake generation operations.
- The canvas Agent system prompt now routes multiview, panorama, portrait, mood, style, video-edit, and image-to-3D requests through `list_capability_recipes` before execution, and explicitly separates image-to-video, video-to-video, image models, and GLB handoff.
- Each storyboard row has a compact image/video capability entry that selects or creates the row output node and opens the same shared inspector.
- The capability runner has a hard concurrency ceiling of four even when a caller requests a larger value.
- Nine-view defaults to nine independent provider requests, one exact camera per output. A separate low-cost contact-sheet draft mode uses one provider request and locally splits the returned 3x3 image into nine ordered results. The spend dialog reports the selected mode's real request count before execution.
- Custom-camera generation requests one complete frame per task and explicitly forbids split screens, collages, contact sheets, turntables, and multi-camera layouts.
- Grid9 exposes an explicit background policy. `preserve_scene` carries the source environment, perspective, occlusion, lighting direction, and object relationships into every camera prompt and forbids white, solid, transparent, studio, or turntable replacement backgrounds.
- Panorama output is fixed to a 2:1 equirectangular contract with seam and pole continuity instructions.
- Required reference/resource slots are validated before the spend dialog can be opened.
- Video and 3D jobs share a 5-minute soft / 20-minute hard recoverable polling window. Recovery continues querying the original task id and never resubmits a paid task.
- Image-to-video and video-to-video remain separate contracts. Local technical inspection never claims that visual style or temporal effect adherence passed; that check stays unavailable until a human or visual evaluator reviews it.
- A Jimeng/Dreamina multimodal video reference is not a `source_video` edit contract. It can guide generation, but Nomi exposes true video-to-video recipes only when a model mode declares both `source_video` and edit intent.
- Multiview visual review is user-triggered, local-asset-only, tool-disabled, and structurally parsed. Invalid JSON, truncated output, missing views, and missing boolean conclusions fail closed instead of inheriting a pixel-proxy pass.
- The review replaces only `subject-semantic-identity`, `subject-geometry-consistency`, `requested-camera-adherence`, and `background-policy-compliance`; all existing availability, dimension, duplicate-view, continuity, and local background-proxy checks remain intact.
- Production builds default the capability flag off. It is enabled only by `VITE_NOMI_CAPABILITY_RECIPES=1` or the local `nomi.experimental.capabilityRecipes` override; development builds default on for testing.
- MCP client status is build-specific. Codex, Claude Code, and Cursor entries are current only when command, app arguments, and `NOMI_MCP_STDIO=1` match this Nomi build; an entry for another checkout is reported as stale and can be updated in place without removing unrelated servers.
- GUI capability advertisements are owner-scoped. An exiting process removes `instance.json` only when its PID still owns the current advertisement; stdio MCP processes remain windowless transports and do not participate in the GUI single-instance lock.

## Provider And Model Strategy

- Cloud providers remain the primary execution path. Compatibility is derived from model archetype capabilities rather than recipe-specific provider branches.
- A structurally compatible model without an explicit capability declaration is now labeled `experimental`, not `compatible`. The inspector warns that camera, identity, skin, style, or effect adherence still needs quality evidence and visual review. Only a model archetype that declares the exact recipe capability can display `native`.
- Visual review lists only executable text models whose metadata or recognized model family declares image input. Custom Provider models can explicitly opt in with `meta.supportsImageInput=true`.
- ComfyUI or another local backend can participate through the same compatibility contract; no local runtime or heavyweight model weights are bundled by this slice.
- Codex Img2 runs as an ephemeral Codex CLI child. Each invocation receives a minimal temporary `CODEX_HOME` containing only the authenticated session link and non-sensitive model/runtime metadata.
- The Codex image process explicitly enables image generation and disables app/code-mode hosts that are unnecessary for this workload.
- Structured transport failures are retryable even when Codex exits with code 0 and returns `{ ok: false }`; retry remains inside the same invocation.
- Jimeng Web has a dedicated `jimeng-web-seedance-2` archetype. It exposes only Fast/Standard variants and image/video references supported by the external extension; CLI-only audio references, 1080p resolution controls, and VIP/Mini variants are not shown in the Web path.

## Cost And Safety Checks

- Every paid run still passes through the product spend-confirmation dialog; the real-provider smoke did not bypass it.
- A multiview visual review is one explicitly confirmed text-model request for the whole collection, not one request per view. The report records prompt, completion, and total token counts without storing credentials.
- Remote-only provider URLs are rejected before visual-model submission; every attachment must already be available through the project-local `nomi-local://` asset protocol.
- Grid9 cost follows the selected mode: nine provider requests for independent accurate mode, or one provider request for contact-sheet draft mode.
- The deterministic evaluation performs zero provider calls.
- Runner concurrency is bounded at four to avoid unbounded fan-out. Provider-specific scheduling may impose a lower limit.
- Required resources fail closed before provider submission.
- `pnpm check:secrets --all` scanned 1969 tracked files and found no private configuration, credentials, or chat-database leakage.
- Codex temporary homes are removed after completion, and no `nomi-codex-home-*` directory remained after the final smoke.
- Normal completion, retry, timeout, and cancellation remove the spawned Codex process from the active registry; the final smoke left no generated child process running.
- Successful capability Electron runs delete their isolated project and user-data. This update removed 27 historical test directories totaling 1,457,856 KiB and left no matching temporary directory.

## License Checks

- The repository and this implementation are licensed under Apache-2.0.
- The six Skill Playbooks are repository-authored text and use only registered Nomi canvas tools; they bundle no third-party scene assets, model weights, or copied prompt libraries.
- `CreativeResource` preserves source, license, attribution, and `allowed | restricted | unknown` commercial-use status. The UI surfaces restricted/unknown status instead of silently presenting it as cleared.
- The schema rejects commercial-use values outside that enum, and the contract eval verifies provenance round-tripping.
- This slice records and exposes provenance; it does not independently validate a user's external asset license or a provider's output terms.

## Evaluation Cases

- Nine-view camera ordering, azimuth/elevation contract, nine-request accurate mode, one-request draft mode, scene-background policy, and nine-result postprocess.
- Custom-camera single-frame prompt contract and output count.
- 2:1 panorama dimensions, equirectangular projection, seam continuity, and pole continuity.
- Identity preservation, skin realism, and the 5x5 mood control space.
- Provider-independent recipe registry and compatibility selection.
- Creative resource provenance and commercial-use schema validation.
- Bounded parallel execution with no provider calls during deterministic evaluation.
- Production visual-review adapter coverage: one isolated batch request, stable source/view attachment order, explicit model pinning, tools disabled, token provenance, and remote-asset preflight rejection.
- Real FFmpeg parsing for video metadata, black frames, frozen intervals, and source/output temporal retention.
- Result collection selection, double-click preview, non-destructive history, resource-node creation, and no drawer overflow in Electron.

## Real Provider Smoke

- Recipe: `image.multiview.custom`.
- Provider/model: Codex / `Codex Img2 (GPT Image 2)`, with `NOMI_CODEX_IMG2_MODEL=gpt-5.6-terra` for the CLI execution model.
- Result: 1 provider request, 1 successful output, 0 failures, 0 renderer page errors, 91.635 seconds.
- Output: one 1234x1275 right-profile/three-quarter single frame. Visual review confirmed that it was not a collage and retained the subject proportions, material, chest light, and background.
- Durable sanitized report: `evals/runs/2026-07-16T06-36-34Z-capability-recipes-real-smoke/report.json`. Original local evidence: `/var/folders/s3/m33y1mxj1hvfhn947ctrn7l00000gq/T/nomi-capability-real-smoke-w9hBdK/evidence/report.json`.
- Generated asset: `/var/folders/s3/m33y1mxj1hvfhn947ctrn7l00000gq/T/nomi-capability-real-smoke-w9hBdK/projects/Capability Recipe Real Smoke-mrn4wmgh-99123e72/assets/generated/2026-07-16/codex-img2-1784183793078.png`.
- Earlier smoke attempts exposed three real defects: local skill-context/model-manager startup pressure, an unnecessary code-mode host, and a code-0 structured network failure that was not retried. All three were fixed and covered by focused tests.
- The first successful custom-camera output was a five-panel collage. The prompt contract was tightened, then the final paid smoke above passed visual review.

The final zero-spend current-catalog refresh is
`evals/runs/2026-07-17T12-47-45Z-capability-recipes-live-single-instance/report.json`.
It copied the user's current model catalog into an isolated profile, issued zero
provider calls, and found compatible models for eight image/i2v recipes. Both
true v2v recipes remain blocked by `missing_source_video_model`, while image to
3D remains blocked by `missing_image_to_3d_model`. The isolated run reported no
page errors, exited normally without a forced kill, and left no temporary Codex
homes, spawned child processes, or temporary root.

## Verification Evidence

- `pnpm gates`: passed file-size, design-token, dangling-token, archetype-default, secrets, lint, TypeScript, full Vitest, renderer build, and Electron build gates.
- Full Vitest: 374 files passed, 2 skipped; 3201 tests passed, 5 skipped.
- Lint: 0 errors and 98 warnings, at the unchanged ceiling of 98.
- File-size gate: 800-line ceiling, zero giant-shell allowlist entries.
- Capability recipe contract eval: 13/13 cases and 76/76 assertions; zero provider calls. The latest contract covers independent/draft Grid9 cost, 75-degree overhead framing, scene-background preservation, and four-part visual review. Current report: `/tmp/nomi-capability-eval-20260718-v3/report.md`.
- The 2026-07-18 isolated Electron regression passed 101/101 assertions with no renderer page error. It verified the experimental-capability warning, independent/scene-preserving defaults, nine-request spend disclosure, and one-request contact-sheet draft disclosure without submitting a paid generation.
- Full Vitest after the Grid9 and truth-label update passed 379 files with 2 skipped and 3238 tests with 5 skipped. Renderer and Electron production builds passed.
- Base Electron smoke: 10/10 assertions.
- Capability recipe Electron smoke: 67/67 assertions with no page errors. It imported a real local MP4, detected a 31% frozen-frame ratio, displayed the report on the canvas video node, verified live provider-catalog refresh, and verified a storyboard row can open the correct source node in the capability inspector. Evidence: `evals/runs/2026-07-16T19-19-13Z-capability-agent-storyboard-versioning-e2e/`.
- The 2026-07-17 SkillNode regression expanded the same isolated zero-spend Electron suite to 75/75 assertions with no page errors. It created `creative.multiview` from the built-in Skill Library, dragged a real source-node edge into the SkillNode, and verified input state plus automatic recipe/source preselection in the shared inspector. Output writeback is append-only and preserves earlier output ids.
- The visual-review Electron regression expanded the suite to 80/80 assertions with no page errors. With no connected vision text model, the quality report showed actionable model-connection guidance and did not automatically open spend confirmation or submit a provider request. Evidence: `evals/runs/2026-07-17T09-43-59Z-capability-vision-review-e2e/`.
- The current runtime's connected Doubao Seed 2.0 Lite and Pro models are now recognized as image-input text models. The updated isolated Electron suite passed 90/90 assertions: Lite appeared in the visual-review selector, opening the report made no model call, and the explicit review action showed one batch request plus ten local attachments before cancellation. Evidence: `evals/runs/2026-07-17T11-45-14Z-doubao-vision-review/`.
- The recipe-level component-readiness regression expanded the isolated zero-spend Electron suite to 84/84 assertions with no page errors. Before a connection, Grid9 is disabled and reports `缺图片`; after a real source-node edge is completed, the same row reports `已就绪`, becomes executable, and opens the shared inspector with the correct source. Focused binding/UI coverage passed 16/16 tests. Evidence: `evals/runs/2026-07-17T10-05-10Z-capability-component-readiness/`.
- Batch regeneration tests verify cancellation creates no node or spend grant, approval grants only the V2 node, and simultaneously regenerated dependency chains are rewired V2-to-V2 while V1 remains unchanged.
- Real-smoke policy tests are 11/11 and cover both `--key=value` and conventional `--key value` parsing through an npm/pnpm `--` separator. `-h/--help` exits before run-directory creation, temporary-root creation, or Electron launch; a direct CLI check confirmed zero side effects.
- Focused Codex runner/runtime tests cover minimal home isolation, auth symlink handling, cleanup, model override, current ChatGPT/Codex binary arguments, bounded retries, and code-0 structured network recovery.
- The image-to-3D result-contract regression passed 9/9 focused tests and 145/145 integration tests. The isolated Electron suite passed 84/84 with no page errors and zero Provider calls. Evidence: `evals/runs/2026-07-17T10-19-57Z-image-to-3d-result-contract/`.
- The atomic-component regression passed 47/47 focused component/node assertions plus 6/6 final direct-action assertions. The isolated Electron suite passed 88/88 with no page errors and zero Provider calls. It verified separate Nine-view, Custom-camera, and Image-to-3D cards, exact Provider kinds, one-recipe node persistence, and the direct `配置并运行` action. Evidence: `evals/runs/2026-07-17T10-30-00Z-atomic-canvas-components/`.
- The Jimeng Web typed-reference regression passed 283/283 cross-layer tests. The archetype-default gate first detected the missing generated wire defaults; regeneration added the 41st archetype and the gate then passed. Renderer/Electron TypeScript, focused ESLint, production build, file-size, secrets, third-party, and diff checks passed. The isolated Electron suite passed 91/91 with no page errors or Provider calls and confirmed that the real seeded catalog points to `jimeng-web-seedance-2`. Evidence: `evals/runs/2026-07-17T12-09-28Z-jimeng-web-video-reference-catalog/`.
- The Jimeng Web image-channel regression added a separate `jimeng-web-image` catalog model and archetype for text-to-image and reference-image editing. The companion routes image and video tasks to separate Jimeng pages, uploads image results with the correct MIME/extension, and serializes active Web work so one task cannot navigate another task away. Focused Nomi tests passed 39/39, companion tests passed 8/8, full Vitest passed 3209 tests with 5 skipped, and the isolated Electron suite passed 98/98 with no page errors or Provider calls. Evidence: `evals/runs/2026-07-17T14-24-29Z-jimeng-web-image/`.
- A fresh Blender 4.0.1 smoke exposed a false-positive spatial check that the earlier numeric report missed: both chairs retained their old yaw after the actors turned to face each other, leaving a 38.66-degree chair/actor mismatch while the offset relation still reported `passed` because it measured position only. The regression first failed against the persisted `.blend`, then `offset` was upgraded from a position delta to a full relative transform and applied after `facing`. The final real smoke passed 3/3 scenarios; both chair position and yaw errors are 0, actor-facing error is 0.014 degrees, and the report now carries structured `rotationMeasured` and `rotationExpected` fields. Evidence: `evals/runs/2026-07-17T12-26-00Z-vibing-director-real-relative-transform-final/`.
- The corresponding isolated VIBING Director Electron run passed 26/26 assertions with no relevant renderer error. It verified nonblank framed 3D pixels, drag-driven camera changes, Blender render preview, non-overlapping controls, compact layout, audited asset search, and rollback of both preview and spatial state. Evidence: `evals/runs/2026-07-17T12-40-00Z-vibing-director-relative-transform-e2e/`.
- The MCP/build-binding regression passed 30/30 focused capability-core tests. It distinguishes missing, current, and stale JSON/TOML entries; stale updates preserve unrelated servers. The live Codex and Claude configurations now point at this checkout with separate backups, while the already-running stdio child is intentionally left for client restart. The same verification run kept the main GUI RPC healthy before and after the zero-spend isolated smoke.
- The final current-checkout verification passed 41/41 focused MCP, capability-core, and smoke-policy tests plus 96/96 isolated capability-component Electron assertions. Official TypeScript, production Renderer/Electron build, file-size, archetype-default, secrets, third-party, lint, and full Vitest gates passed; lint remains at the existing 98-warning ceiling.
- Human visual acceptance is persisted separately from deterministic quality output. A reviewer can accept or reject any single- or multi-result quality report with a bounded note; undo, clear, read-only display, legacy schema compatibility, and project persistence are covered. The Electron regression proved that an automatic warning remains a warning while the human verdict moves from rejected to undone to accepted. This evidence does not substitute for an unrun Provider smoke or semantic model review. Evidence: `evals/runs/2026-07-17T13-12-10Z-capability-human-review-e2e/`.

## Residual Risk

- Grid9's cost, prompt, ordering, and local split contracts are covered by deterministic, unit, and Electron tests, but a paid live Grid9 image was not completed in this run. The final paid smoke covered the custom-camera path.
- Codex image latency is dominated by CLI startup, account-side queueing, and remote generation. The final task took 91.635 seconds; earlier network/startup failures took longer.
- A temporary auth symlink still grants the child the user's existing Codex session for the duration of the invocation. The directory is minimized and deleted, but OS/process-level trust remains required.
- License provenance is user/provider supplied. Restricted or unknown status is visible but is not a legal clearance engine.
- The recipe compatibility matrix is static and must be updated when providers change model capabilities or request schemas.
- Local video checks prove technical readability and temporal proxies only. New paid i2v outputs, true source-video v2v, and visual reference adherence remain blocked by provider availability or explicit spend approval.
- Jimeng Web image generation, image/video reference transport, and result synchronization are covered without a live submission. Extension DOM drift, account-side behavior, and actual generated-image/video adherence remain unverified until an explicitly approved Web smoke; audio reference remains CLI-only.
- The production multiview visual-review path is implemented and the current runtime now exposes Doubao Seed 2.0 Lite/Pro as connected image-input candidates. No real semantic review call was approved, so identity and geometry remain unverified on real outputs.
- Feature exposure remains local-only and default-off in production. Release, migration rollout, telemetry policy, and any stage advance remain outside this Gate 8 slice and require explicit review.
- The RunningHub request/result path is now deterministic, but no connected Enterprise-Shared key or equivalent live image-to-3D Provider was available. A real image-to-GLB submission remains unverified and requires explicit spend approval.
- The Blender coffee scene and programmatic product fixture are blockout-quality validation assets. They prove editable geometry, transforms, spatial relations, camera framing, and artifact return; they do not prove final character, prop, or environment art quality.
