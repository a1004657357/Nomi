# TSX Diagnostics Lint Follow-Up

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Base: 77c98040a249a4e92e76d0cf2f8acf08e1dbc939. The i18n batch is already committed in the separate Nomi-main-tsx-i18n-20261025 worktree, not the earlier style worktree.

| Design Card | Decision |
| --- | --- |
| 1. User flow | Failed 3D environment/mannequin/generated-model loads retain their fallback and error evidence. No App/provider or actual media is started. |
| 2. Owner | Existing src/desktop/rendererLog.ts owns renderer diagnostics. Keep warning/error levels and original error objects; preserve all rendering, model/task settings and callbacks. |
| 3. Reuse | Call existing logRendererWarn/logRendererError; no new logging wrapper, exclusions, config or baseline. |
| 4. States | Loading/success/failure/fallback/reset behavior stays unchanged. Remove only unused pure work/subscriptions and add a proven stable ref to memo dependencies. No UI copy/layout change. |
| 9. Verification | Focused ESLint red before production edits; actual source-boundary tests with real logging owner and unchanged fallback/reset behavior; i18n/content-flow regression; independent v3 contract. Revert this follow-up separately. |

Scope: scene3dEnvironment.tsx, scene3dObjects.tsx, BatchGenerateSettingsButton.tsx, SkillLibraryPanel.tsx and Scene3DFullscreen.tsx. Fast Refresh warnings require ownership moves and are not hidden or suppressed. Main owns its newer batch/drag handlers, locomotion TS and capabilityLegacyActions.ts; retain those changes when integrating.

## Verification

- First batch already available: 77c98040a249a4e92e76d0cf2f8acf08e1dbc939. This follow-up has five narrowly changed production TSX files.
- Focused lint before: 3 errors / 10 warnings. After: 0 errors / 7 warnings. No ESLint rule, ignore, config or warning ceiling change.
- Source-driven diagnostics red: 3/3 failed because no diagnostic bridge evidence was emitted. Green: all three actual catch/render boundaries preserve original error objects, local severity, code/stack reporting and existing fallback/reset behavior through the real logging owner and isolated transport sink.
- Combined diagnostics / bilingual / content-flow / reference focused tests: 56/56 pass. Existing rendererLog and Scene3D model-visual unit tests: 9/9 pass.
- The unused regenerationTargetIds Set only filtered/read plain node data; it had no consumer. The unused SkillLibrary setter only subscribed to a value that was never read. Remove neither remaining action/store selector nor any model/task parameter.
- initialEditorCameraRef is created by React.useRef inside unchanged useScene3DEditorSession; adding the stable ref to memo dependencies retains the original camera memo lifetime.
- No new screenshot is required for this nonvisual patch: no copy, geometry, styles, controls, callbacks or saved values change. Prior bilingual source/class-hash regressions remain green; real App/GPU/packaged diagnostic export is still unverified.

## Remaining Warnings

The seven warnings in this five-file slice are four Fast Refresh export-ownership warnings and three crowd-object memo dependency warnings in scene3dObjects.tsx. Those memos currently depend on selected geometry fields. Blindly adding the entire object can invalidate crowd geometry on unrelated pose/name changes; changing geometry ownership or moving exports is outside this small cleanup. None is suppressed. Six other existing Fast Refresh warnings remain in the earlier 37-file i18n slice.

This batch safely removes three warnings. It does not claim that the full integration tree has returned from 177 to the original 79-warning ceiling; coordination must rerun after all lines integrate. Locomotion TS and capabilityLegacyActions.ts are untouched, as requested.

Logs: ignored .tmp/tsx-i18n/diagnostics-{red,green}.log, lint-followup-{red,green}.log, followup-focused-final.log, followup-owner-tests.log and followup-root-cause.log. Reproduce the focused slice with:

```sh
TSX_TSCONFIG_PATH=tests/ux/fixtures/content-flow.tsconfig.json node --import tsx --test scripts/tsx-diagnostics-lint.node-test.mjs scripts/tsx-i18n-display.node-test.mjs scripts/main-style-content-flow.node-test.mjs scripts/main-style-reference-repair.node-test.mjs
node --import tsx node_modules/vitest/vitest.mjs run src/desktop/rendererLog.test.ts src/workbench/generationCanvas/nodes/scene3d/scene3dModelVisual.test.ts --maxWorkers=1
```

No push/merge, checker/baseline/ESLint configuration change, media commit or memory write.
