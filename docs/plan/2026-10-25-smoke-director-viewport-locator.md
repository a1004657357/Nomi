# Smoke Director V2 Viewport Locator

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Base: `b57818beba4635470515df081b2c9c40b39c8d93`. No merge of coordinator.
Status: implemented, not pushed; final independent review belongs to D.

| Design Card | Decision |
| --- | --- |
| 1. Use | Real App69 reached DirectorEditor after 19 assertions and fixed-footer checks, then failed a retired V1 viewport label. Select the existing V2 main viewport, not a global/PiP/placeholder canvas. |
| 2. Owner | DirectorEditor shell contains DirectorViewport's director-viewport marker; DirectorCanvas renders FencedCanvas, whose Canvas import is the real R3F owner. No production label alias. |
| 3. Reuse | Scope the original canvas locator through the existing shell and test ID. Preserve visibility wait, screenshot readback, image decoding and all original assertions/thresholds. |
| 4. States | Missing viewport/canvas still times out; blank or undersized screenshot still fails width>300, height>200, quantized colors>8. No injected scene, canvas or alternate pass path. |
| 9. Acceptance | Red/green existing standalone owner tests with production JSX ownership and in-memory negative controls, plus original Node wait guard. No App/browser/heavy. D reviews; coordinator fresh App reruns. Revert the isolated commit to roll back. |

## Root Cause and Scope

Read-only App69 failure under coordinator
`outputs/canvas-smoke/nomi-smoke-e2e-2Y2UmJ/` reports element not found for
`[aria-label="3D 场景编辑器"] canvas`, not a pixel failure. Diagnostics contain
only THREE.Clock deprecation warnings. The screenshot is the V2 editor with a
grid and empty scene. This is not a successful pixel/rendering acceptance.

Production owner trace: DirectorEditor -> EditorStage -> DirectorViewport
`data-testid="director-viewport"` -> DirectorCanvas -> FencedCanvas -> imported
`@react-three/fiber` Canvas. PipViewport's documentation and implementation use
the same main canvas via scissor rendering, not an independent DOM canvas.
Existing director-j8 walk already targets the V2 viewport marker.

Only smoke.e2e.mjs, its existing standalone owner test, this plan and v3 contract
change. Keep the main-canvas screenshot and the entire sampling callback intact.
No new object is necessary to correct this locator. If the subsequent real
pixel check fails, it remains a failure; do not weaken colors or dimensions.
No fake DOM canvas or injected fixture scene is added. Negative pixel tests only
execute the extracted numerical predicate, not a DOM or renderer.

## Coordination Limits

No coordinator merge/write, production changes, timeout/budget/baseline or PNG
updates. User reports five 12px hint PNG approvals/updates, other 290 hashes
unchanged; this patch does not perform or validate that visual update. Full315
and actual App smoke are not run by this author.

## Lightweight Evidence

Evidence directory:
`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/`.

- `director-viewport-owner-red.json`: unchanged smoke with new guards, 27 pass /
  4 fail / 0 skip. The old V1 locator fails the real-producer and same-class guards.
- `director-viewport-owner-green.json`: existing owner/assertion tests 39/39,
  0 skip, maxWorkers=1. Negative controls mutate the actual script and JSX source
  in memory: V1/global/PiP locators, missing marker/main renderer, non-R3F owner,
  and relaxed comparisons are rejected. The original numerical predicate rejects
  blank/boundary-equal samples. No DOM or fake canvas is created by these tests.
- `director-viewport-wait-guard.log`: original Node wait guard 11/11, 0 skip.

Smoke changes exactly one line. Capture/decoder/sampler, all 17 source-level
assert calls, dimension/color thresholds, timeout and unique evidence paths remain
unchanged. This does not claim actual pixel-rendering acceptance: App rerun is
the coordinator's work. No full315, rootcontracts70 or other heavy command is run.
