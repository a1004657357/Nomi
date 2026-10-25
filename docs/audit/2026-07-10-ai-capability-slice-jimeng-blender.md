# AI Capability Slice: Jimeng Web and Blender Director Bridge

Date: 2026-07-10
Gate: 8 - AI capability integration
Status: implemented, awaiting explicit approval to advance

## User Capability

- Nomi reuses one persistent Electron session for Jimeng login and extension execution.
- Jimeng image/video tasks keep reference binaries on disk and load them only when the extension executes a task.
- A scene3d node can render through local Blender and return a PNG preview, editable BLEND file, and GLB model as project assets.
- Blender outputs appear as connected image and model3d nodes beside the source scene. Repeated renders are offset instead of stacked.
- A Codex session can use the installable `cli-anything-blender` harness to create a constrained director manifest, set a stage/camera/path, render through local Blender, and inspect JSON-only results.
- Nomi exposes `director.render` to its local CLI and `nomi_render_director` to MCP. Both accept only an existing Scene3D node id and an optional bounded stage preset; the main process imports the outputs and connects them back to that node.
- A storyboard table keeps all shot metadata in eight semantic columns instead of exposing 17 narrow columns.
- Each storyboard row can reveal a real image output node or a real video output node. Revealing video also guarantees the row image and its `first_frame` connection, without leaving a manual dashed connection behind.
- The storyboard table now opens as a compact overview. Only one row can enter edit mode, so a 22-shot table no longer mounts every editor and video preview at once.
- Storyboard text edits stay local while typing and persist once on blur. Unrelated canvas-node updates no longer rerender the table.
- Storyboard previews load through their own scroll-root queue and a bounded `nomi-local` thumbnail derivative. Unselected canvas cards use 256 px requests and selected cards switch back to the original asset.
- Storyboard rows no longer execute image or video generation directly. Each row exposes `图片设置` and `视频设置`, which extract and focus a real canvas node where the user chooses the model, provider, and model-specific parameters before running.
- Agnes image-to-video localizes a Nomi-only first frame through an Agnes-specific public-image chain. It prefers a directly downloadable Uguu URL and falls back to Catbox, avoiding the Agnes backend timeout observed against `litter.catbox.moe`.
- Image and video model identities are isolated at task resolution. A legacy video node polluted with `codex-img2` metadata restores the last successful connected video model, including Agnes `i2v` when a first frame is present, and writes the repair back to the canvas before submission.

## Contracts

- `nomi:scene3d:render-blender`: structured scene JSON to local Blender artifacts.
- `nomi:scene3d:cancel-blender`: cancel one active render by job id.
- `nomi:scene3d:render-director-blender`: validated Scene3D state to the bundled Python bridge, then PNG, BLEND, and GLB project assets.
- `director.render`: capability-core operation for a running Nomi app; `node scripts/nomi.mjs director render <projectId> <scene3dNodeId> [stagePreset]` and `nomi_render_director` are its CLI/MCP adapters.
- Jimeng API: loopback-only HTTP with a process-random token in `X-Nomi-Token`; SSE uses the same token as a query parameter.
- Jimeng login and runner share `persist:nomi-jimeng-runner` cookies and storage.

## Safety and Resource Boundaries

- Blender runs with `--background`, `--factory-startup`, `--disable-autoexec`, and no shell interpolation.
- Blender jobs have a timeout, force kill, cancellation, project-switch guard, and unconditional temporary-directory cleanup.
- The director bridge accepts neither arbitrary `bpy` code nor arbitrary commands. Artifact paths must resolve beneath the current project's `.nomi-director/` directory before Nomi imports them.
- App quit cancels Blender jobs and closes the managed Jimeng server, windows, and extension session resources.
- The Jimeng server binds only to `127.0.0.1`; API routes require a random token and CORS rejects non-extension/non-loopback origins.
- `tasks.json` no longer stores Base64 references. Existing references were migrated to `data/task-references/`, reducing the task file from about 11 MB to 2.3 KB.
- Reference bytes are no longer copied through the panel-to-tab message. The content script resolves file references immediately before upload and drops the in-memory array afterward.
- Thumbnail requests are display-only query parameters. Project results, generation references, editing inputs, and exports retain the original asset URL. The Electron protocol bounds derivative dimensions and caches 64 results by path, mtime, file size, and requested dimensions.
- Agnes still receives only the single public `image` string required by its official image-to-video contract. API keys stay in the Electron main process; the anonymous upload request contains image bytes but no Agnes credentials.
- A model whose archetype kind differs from the node execution kind cannot pass the connected-vendor fast path. Without a compatible successful history, the task stops before submission with an explicit model-type error.

## Verification Evidence

- `pnpm typecheck`: passed.
- `pnpm lint:ci`: passed with 0 errors and 97 warnings, within the repository limit of 98.
- `pnpm test`: 287 files and 2649 tests passed.
- `pnpm build`: renderer and Electron production builds passed.
- External extension: 5 Node tests passed; all modified JavaScript files passed `node --check`.
- Jimeng live smoke: unauthenticated API returned 401, authenticated API returned 200, listener was `127.0.0.1:3456` only.
- Blender 4.0.1 live smoke: PNG, BLEND, and GLB were generated; the preview was visually inspected for nonblank, complete framing.
- Restart smoke: one upgraded Nomi main process plus required helpers; capability core listening on `127.0.0.1:55454` with no startup errors.
- Storyboard row output tests: image and video output creation, visibility preservation, prompt synchronization, idempotency, and automatic `first_frame` wiring passed.
- Edge migration tests: legacy IDs are rebuilt from source, target, and mode; duplicate semantics are removed; changing a mode keeps IDs unique.
- Video default tests: model selection filters for `first_frame`/`image_ref` support before applying the Seedance preference, and stale async results are discarded after a project switch.
- Storyboard performance regression: a 22-shot compact table renders 0 textareas and 0 video players; expanding one row renders 12 textareas, one duration input, and no second expanded row.
- Electron CDP smoke on the real `信号` project: 22 rows loaded, compact/edit/menu interactions passed, and no renderer console errors were recorded.
- Electron CDP media budget on the real `信号` project: total decoded image pixels fell from 63,624,440 to 2,526,976 (about 96%); storyboard-table previews fell from 35,194,784 to 979,200 (about 97%). Selecting a card restored its original 2560 x 1920 source.
- Five offscreen storyboard placeholders remain in layout but no longer run shimmer animations. Active document animations fell from five to zero; repeated idle renderer samples returned to 0% CPU.
- Storyboard generation-settings CDP smoke on `信号`: all 22 rows exposed separate image/video settings actions, the old direct-generate buttons were absent, image extraction showed model/aspect/resolution controls, and video extraction showed model selection plus the run action. The test-created visibility state was discarded by reloading the persisted project.
- After removing the original-repository instance and clean-starting only the upgraded app, the renderer stabilized around 671 MB RSS on the current media-heavy canvas. RPC remained healthy on loopback.
- Agnes upload smoke: the compiled Electron upload path sent a real 2.9 MB storyboard PNG through Uguu, then downloaded the returned `*.uguu.se` URL as `image/png` with the full 3,014,220 bytes. Agnes-specific routing and human error classification are covered by 74 focused tests; the full suite now passes 287 files and 2649 tests.
- Model-isolation regression: a video node carrying `codex-img2` plus a connected auth-free Codex vendor recovered `agnes-video-v2.0` from its successful video provenance, selected `image_to_video`/`i2v`, restored `720p` and 5 seconds, and never submitted to Codex. The no-history case stopped before vendor submission with a video-versus-image error.
- Real-project repair smoke on `信号`: persisted shot 4 now records `agnes-video-v2.0`, vendor `agnes`, mode `i2v`, `16:9`, `720p`, and 5 seconds. Electron CDP showed Agnes selected, the `图生视频` segment pressed, and the existing Codex-generated image in the `首帧图1` slot. No generation task was submitted during verification.
- Codex Blender harness: 8 isolated Python tests passed after editable installation; state mutations, installed CLI JSON output, REPL, undo/redo, Blender argv restrictions, and artifact validation are covered.
- System-Python bridge smoke: `python3 -m cli_anything.blender.bridge` generated PNG, BLEND, GLB, and `director-sync.json` with local Blender 4.0.1 without importing Click.
- Live capability-core smoke: a temporary project received a new blank `scene3d` node through `scripts/nomi.mjs`, then `director render ... coffee_shop` returned Blender 4.0.1 and created a connected image preview and model3d node. The temporary project was deleted through Nomi's project API after verification.
- Packaged-resource smoke: `electron-builder --mac dir --arm64` copied the filtered runtime harness to `Nomi.app/Contents/Resources/blender-harness`; system `python3` then ran that packaged bridge and produced PNG, BLEND, GLB, and sync JSON through Blender 4.0.1.

## Residual Risk

- Blender compatibility is live-tested on macOS Blender 4.0.1, not yet on Blender 4.1-4.5 or Windows.
- The scene conversion intentionally uses gray-box placeholders for unsupported imported models and complex character animation.
- `director.render` requires a running Nomi desktop app because it relies on the main-process asset importer; the harness by itself can still render project-local files while Nomi is closed.
- The packaged app copies the harness source as an Electron resource but currently resolves a local `python3`; a bundled Python runtime and foreground Blender add-on are separate follow-up work.
- The media-heavy canvas still keeps substantial Chromium/DOM/GPU state even after decoded image pixels were reduced by about 96%; a clean renderer stabilized around 671 MB RSS. Further reduction likely requires node/edge virtualization and stricter inactive-video lifecycle work.
- Machine-wide responsiveness can still be limited by unrelated high-CPU processes. During final verification, AweSun remote desktop, Chrome for Testing, WindowServer, and Baidu Netdisk were above Nomi while Nomi itself was idle.
- Uguu and Catbox are external temporary hosts. The code now avoids the confirmed Agnes-to-Catbox timeout, but a production release should use a user-owned object store or managed relay with reachability monitoring and retention/privacy controls.
