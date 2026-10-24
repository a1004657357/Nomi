# Main Style Content Flow

Line: `codex/main-style-fix-20261025`; base: `d34454bafcb459356e434135879da0fd18875480`.

## Approved Design Card

Coordination approved this third batch: preserving content and functionality does not require pixel-identical positions. Move the 17 remaining metadata/count/close-control occurrences into their owning title's content flow. No new policy exceptions or hidden edge-alignment aliases.

| Field | Decision | Evidence |
| --- | --- | --- |
| 1. User Flow | Existing settings, review, comparison, keyframe, camera and table rows keep all information and controls. Metadata follows its title; narrow rows wrap instead of overlapping. No tasks or business providers run. | Seventeen actual JSX row projections from twelve production files. |
| 2. Ownership | The existing design system content-flow rule owns alignment. Components retain their own feature ownership; no import from Agent V4 into unrelated features. No state owner changes. | Existing V4Row shape, generated door map and source preservation proof. |
| 3. Reuse | Reuse the current flex/min-width/gap tokens already used by V4Row. Existing component primitives remain; a new row component or cross-feature wrapper is unnecessary. | `flex min-w-0 flex-wrap items-center gap-1.5`; unchanged public button/select primitives. |
| 4. States | Keep every current conditional, status, label, callback, control, disabled flag and value. Keep explicit button/check sizes. Fixed row heights become the same minimum height only where wrapping needs room; major widths, table columns, media aspect ratios and overall surfaces stay unchanged. | Class-only AST comparison to d34454b; static and Chromium checks. |
| 9. Acceptance / Rollback | Run the changed focused slice red, then green; run the four unchanged style checks and local v3 checks. Capture actual JSX projections in real Chromium at narrow/wide viewports with normal/long text. Coordination still owns real App acceptance. Revert the third commit independently. | Isolated browser walk and screenshots, no user app startup; third commit. |

## Boundaries

- No changes to i18n, functional code, providers, credentials, proxy, manifests, workflows, checkers, baselines, ignore lists or memory.
- Never edit `src/workbench/domain/shotSpecMigration.ts` or `src/workbench/generationCanvas/nodes/render/storyboardRowOutputs.ts`.
- Do not fake content flow with a stretching label, inline auto margins, space-between aliases or exceptions.
- The previous pixel-identical restriction is explicitly superseded for these 17 occurrences only; historical cards remain an accurate record of their earlier batches.
- Browser plugin is not available. Use the repository's installed Playwright with a separate cached Chromium profile; do not launch Nomi or business providers.
- Browser path under test: actual source-row projection, normal/long content, narrow/wide sizing, no overlap or overflow, and hittable native controls. This is layout acceptance, not an App state or task-flow acceptance.

## Verification

| Check | Result |
| --- | --- |
| Focused red/green | Initial new slice: 3 failed before production edits. A separate long-label assertion also failed before fixing the two Chromium-discovered overflows. Final focused suites: 11/11 pass. |
| Style gates | `check:tokens`, `check:icon-semantics`, `check:dangling-tokens`, `check:dangling-tailwind` pass. All 17 edge occurrences are removed, with no baseline or checker edits. |
| v3 contract | Local checker tests: 54/54 pass against d34454b. Final new-contract validation is recorded independently. No claims about the main integration line's other contracts. |
| Behavior/content preservation | Class-stripped AST comparison of all 12 production files to d34454b is identical. Labels, controls, conditionals, callbacks, input values and disabled flags are unchanged. TSX syntax passes. |
| Focused lint | Zero errors; one existing unused `regenerationTargetIds` warning in BatchGenerateSettingsButton is unchanged and outside this class-only repair. |
| Real Chromium | 360 and 1280 widths, each normal/long text: 17 actual JSX rows per scenario, 68 row checks, zero overflow/overlap findings or browser errors. Existing 32/36px close hit regions are verified by elementFromPoint; the batch native checkbox can be unchecked/rechecked. |
| Screenshots | Four complete PNGs in `tests/ux/shots/main-style-content-flow/`: `360-normal.png`, `360-long.png`, `1280-normal.png`, `1280-long.png`. Files are ignored and not committed. Source-row gallery and machine-readable `layout.json` are alongside them. |

The first browser run identified real long-text overflow in the keyframe count label and camera numeric-field label. Both now have bounded widths and anywhere wrapping, without changing labels, values or input height. Early standalone rendering failures were test-runner setup issues: CJS/ESM provider instances and classic versus Vite automatic JSX. The walk uses the same provider instances as the loaded controls and the committed isolated `content-flow.tsconfig.json`; no production dependency/configuration changes were made. The screenshot gallery has its own vertical scrolling surface rather than inheriting the App body's viewport clipping.

## Reproduction

```sh
node --test scripts/main-style-content-flow.node-test.mjs scripts/main-style-reference-repair.node-test.mjs
TSX_TSCONFIG_PATH=tests/ux/fixtures/content-flow.tsconfig.json NOMI_STYLE_CHROMIUM='/absolute/path/to/installed/Chromium' node --import tsx tests/ux/main-style-content-flow.walk.mjs
```

Use an already-installed Chromium; do not download or start the user's App. The walk imports actual button/select primitives and extracts the seventeen JSX row bodies from current source, using local presentation values only. It does not start feature hooks, access business providers or verify real App callback execution. The long scenario deliberately expands label text in the test DOM, not localization files.

## Main-Line Acceptance

- Real settings drawers and modal open/close/keyboard paths, including portal ancestry and focus restoration.
- Actual batch/review/candidate state changes and table commands in a real project; current handlers are structurally preserved but not exercised by the isolated projections.
- Actual 3D camera controls, media sizing and image/video content, packaged/Windows behavior and final CI.
- Both real locales and final screenshot comparison in the integration App; no i18n changes are made here.
- Remote delivery preflight remains environmentally unexecuted from the prior proxy failure; no proxy change or retry workaround.

No known in-scope style gate remains red. This is implemented locally, not pushed or merged; it is not a merged-main or full App acceptance claim.
