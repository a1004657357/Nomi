# Gate 8 Provider And Quality Hardening Plan

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

**Goal:** Repair the failed Gate 8 acceptance cases without entering Gate 9 or publishing a build.

**Call budget:** At most 10 real calls per selected model. Real calls happen only after zero-call contract and quality tests pass.

**Status:** Implemented and accepted as documented in
`docs/audit/2026-07-18-gate8-provider-quality-hardening-acceptance.md`.
Gate 8 remains open because Codex mood reliability, semantic review, and
connected image-to-3D acceptance are still incomplete.

## 1. AGNES Image-To-Video

- Accept both the documented final `url` field and the legacy live
  `remixed_from_video_id` field.
- Keep `image` as one public URL string for image-to-video requests.
- Prefer a configured vendor upload channel, then connected durable upload
  channels, and use anonymous temporary hosts only as the final fallback.
- Validate an uploaded public URL before submitting it and classify upload,
  public-fetch, create, poll, download, and persistence failures separately.
- Record upload, create, queue/poll, download, persistence, and total latency.
- Preserve a failed request and its diagnostic metadata; never silently switch
  to an image model.

**Acceptance:** One isolated AGNES image-to-video run returns a persisted video
node, or a precise phase-specific blocker. No image-provider lookup occurs.

## 2. Portrait Mood Matrix

- Compile five representative coordinate presets into explicit brow, eyelid,
  cheek, mouth, and jaw instructions.
- Lock gaze, head pose, framing, lighting, clothing, and identity so gaze shifts
  cannot stand in for facial expression.
- Keep the local duplicate detector, but label it as a pixel proxy.
- Add an optional structured vision review for target-expression adherence.
- Fail closed when no semantic expression conclusion is available.

**Acceptance:** Five representative expressions are visually distinct and a
vision review returns a target-match conclusion for every output.

## 3. Style Transfer

- Derive the source aspect ratio before the request and pass it through the
  recipe plan, model controls, and prompt.
- Preserve the provider result unchanged.
- When the provider misses the ratio, create a normalized derivative and retain
  the raw result as an alternative with provenance and crop metrics.

**Acceptance:** The primary result is within 3% of the source aspect ratio, the
raw provider result remains accessible, and content/style proxy checks run.

## 4. 3D-Guided Multiview

- Keep independent image-only multiview as the fast inference mode.
- Add a deterministic nine-camera preset for a model3d camera proxy.
- Capture nine local guide frames with exact camera provenance.
- Allow those guide frames to be refined with the original image as identity and
  scene reference instead of claiming that a 2D prompt alone proves geometry.
- Reuse the existing semantic camera/background review for final evidence.

**Acceptance:** Nine persisted guide frames have the requested azimuth and
elevation, remain connected to the GLB node, and can be selected for image
refinement without overwriting the GLB or earlier captures.

## 5. Verification Order

1. Focused unit tests for each contract.
2. Frontend and Electron type checks.
3. Renderer build and isolated source-build UI smoke.
4. Small real calls with concurrency at most 2 and no automatic retry.
5. Expanded acceptance within the per-model call budget.
6. Gate 8 report covering quality, call counts, cost, latency, retained assets,
   temporary assets, and process cleanup.

## Gate Boundary

- Current gate: 8 - AI capability integration
- Allowed: model calls, prompts, eval cases, cost checks, safety checks
- Forbidden: unreviewed production launch or advancing to Gate 9
- Required artifact: AI Capability Slice
- Acceptance check: focused tests plus isolated real-provider evidence
- Next recommended skill: `ai-product-stage-gate:stage-gate-reviewer`
