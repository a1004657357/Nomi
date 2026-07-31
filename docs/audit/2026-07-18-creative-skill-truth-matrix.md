# Creative Skill Truth Matrix

Date: 2026-07-18
Gate: 8 - AI capability integration
Status: audited; no production launch approval

## Classification

- `native`: the selected model archetype explicitly declares the exact capability.
- `prompt-guided experimental`: a real provider task runs, but the capability is expressed through prompts, reference slots, and local/visual review rather than a provider-native parameter.
- `deterministic local`: Nomi computes the result locally without asking a generative provider.
- `blocked`: the transport exists, but no currently connected model can execute it.

The six built-in Skill Playbooks are not static cards. Their `apply_capability_recipe` stage reaches the shared controller, creates a new derived node, submits a real catalog task after spend confirmation, postprocesses the media, and appends a quality report. However, a real task submission does not prove that the selected model natively supports the advertised creative behavior.

## Recipe Matrix

| Canvas recipe | Real execution | Parameters that reach the model | Evidence after generation | Current truth |
| --- | --- | --- | --- | --- |
| 多机位九宫格 | `image_edit`; default nine independent tasks, maximum four runner workers and two Agent workers | Camera label, azimuth, elevation, one-frame rule, geometry lock, background policy are prompt instructions | Dimensions, blank image, duplicates, center continuity, border/background proxy; optional vision review checks identity, geometry, requested camera, and background | Prompt-guided experimental on current image models |
| 多机位九宫格 - 接触表草稿 | One `image_edit`, then deterministic local 3x3 split | Nine camera descriptions and layout are prompt instructions | Same checks, but labels are assigned after cropping and cannot prove each cell's real camera | Prompt-guided draft; not accurate-camera mode |
| 自定义机位 | One `image_edit` per requested camera | Azimuth, elevation, framing, one-frame rule are prompt instructions | Camera contract, pixel diversity, continuity, background proxy; optional four-part vision review | Prompt-guided experimental |
| 图片转 3D | `image_to_3d`, accepts only a returned GLB as model output | Provider-native image reference for Hunyuan3D, HiTem3D, or Meshy 6 | GLB 2.0 container, mesh, primitive, vertex bounds, and handoff validation | Native transport exists, currently blocked without a connected image-to-3D provider |
| 360° 全景 | `text_to_image` or `image_edit` | Equirectangular, exact 2:1, seam, horizon, and pole requirements are prompt instructions | Exact aspect, normalization crop, edge seam proxy, poles, projection proxy | Prompt-guided experimental |
| 人像真实化 | One `image_edit` | Scene blend, lighting, skin texture, surface texture, sharpness, strength, and identity lock are prompt text, not native skin controls | Source/output validity, center-region drift, center edge-energy texture ratio, artifacts; face identity is unavailable without a comparator | Prompt-guided experimental; no dedicated skin model or skin segmentation |
| 5x5 人物情绪 | One, five, or 25 independent `image_edit` tasks | Energy, affinity, expression strength, and identity lock are prompt text | Coordinate completeness, duplicate-expression proxy, center texture proxy; face identity is unavailable without a comparator | Prompt-guided experimental |
| 图像风格迁移 | One `image_edit` plus selected style/palette resource references | Style strength and resource prompt tokens are prompt text; image resources are connected as style references | Output validity, aspect retention, center-content proxy, movement toward style-reference pixel statistics | Prompt-guided experimental; no semantic style-adherence model |
| 图生视频 - 视觉风格 | `image_to_video` with a first-frame/image reference | Resource description and prompt tokens; provider model parameters remain selectable in the inspector | Codec, duration, dimensions, aspect, black/frozen frames; visual-style adherence stays unavailable | Prompt-guided experimental |
| 图生视频 - 效果参考 | `image_to_video` with a first-frame/image reference | Effect description and prompt tokens | Same technical video checks; effect causality/adherence stays unavailable | Prompt-guided experimental |
| 视频转视频 - 视觉风格 | Requires a true edit mode with `source_video` | Style resource prompt plus provider video-edit parameters | Technical checks plus source/output duration and freeze-growth comparison | Transport implemented, currently blocked without connected HappyHorse video-edit |
| 视频转视频 - 时序效果 | Requires a true edit mode with `source_video` | Effect resource prompt plus provider video-edit parameters | Same technical/source-retention checks; semantic effect adherence stays unavailable | Transport implemented, currently blocked without connected HappyHorse video-edit |

## Skill Playbooks

| Built-in Skill | Canvas recipes | What is real | What is orchestration only |
| --- | --- | --- | --- |
| 多视角与 3D 重建 | Grid9, custom camera, image-to-3D | Shared paid task runner, result collections, quality reports, GLB handoff | Agent stage text does not itself reconstruct geometry |
| 360° 全景场景 | Panorama | Image task, exact 2:1 normalization, seam/pole proxies | “360° correct” remains prompt-guided without a native panorama model |
| 人像真实化 | Portrait refine | Image-edit task and conservative pixel checks | Skin presets are prompt vocabulary, not a dedicated retouch engine |
| 5x5 情绪与身份保护 | Mood | Real bounded fan-out and versioned outputs | Mood coordinates and identity lock are prompt-guided; no connected face comparator |
| 风格与色彩资源 | Style transfer | Resource provenance, license fields, image reference wiring, image-edit task | Saved tokens do not prove semantic style extraction or adherence |
| 视频风格与效果 | Four video recipes | Correct i2v/v2v transport separation, real video task path, timeline handoff | Style/effect adherence is not automatically proven by the local technical report |

## Product Changes From This Audit

1. Generic structural compatibility now resolves to `experimental`.
2. The model selector shows `原生` or `实验`; non-native selections show a persistent warning before spend confirmation.
3. Grid9 defaults to independent per-camera generation and exposes `保留原场景` versus `中性转台背景`.
4. The overhead camera changed from a shallow 30-degree high angle to a 75-degree overhead view.
5. Visual review now evaluates the requested camera and background policy in addition to subject identity and geometry.
6. Missing source pixels, face comparison, semantic review, or provider connectivity fail closed as `unavailable` or `blocked`; they are never converted to a pass.

## Known Limits

- A 2D image model can still hallucinate hidden sides. Independent tasks and visual rejection improve detection, not physical reconstruction.
- Border pixel checks can detect many white-background substitutions but cannot semantically reconstruct the source scene.
- The portrait texture proxy measures the center crop, not segmented skin. It must not be described as dermatological, pore-level, or identity proof.
- Video quality currently proves technical usability and limited source retention, not artistic adherence.
- No paid nine-view regeneration was submitted during this audit. The deterministic contract evaluation used zero provider calls.

## Verification

- Focused Grid9, prompt, quality, visual-review, Agent, and canvas-tool tests: 126/126 passed.
- Deterministic capability contract: 13/13 cases, 76/76 assertions, provider calls 0.
- Full Vitest: 379 files passed, 2 skipped; 3238 tests passed, 5 skipped.
- Isolated Electron capability workflow: 101/101 assertions, no renderer page error and no paid generation submission.
- Renderer and Electron production build passed.
- Design token and dangling-token gates passed.
- Source incident inspected: the previous Grid9 run used one Dreamina contact-sheet request, then assigned camera labels to crops without semantic angle verification. That explains the repeated angles and white/studio backgrounds observed by the user.
