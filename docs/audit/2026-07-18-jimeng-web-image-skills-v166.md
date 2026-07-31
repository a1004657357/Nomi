# JiMeng Web Image Skills v1.6.6 Acceptance

## Scope

- Gate 8 isolated real-provider acceptance only.
- Provider: JiMeng Web Image 5.0 Lite.
- No daily project was modified.
- No credential, cookie, or provider payload was recorded.

## Provider Contract

JiMeng Web Image 5.0 Lite returns four candidates from one native submit action.
Nomi therefore treats one recipe output as one logical output with four provider
candidates:

- The image model does not expose or submit `generation_count`.
- The extension does not validate `count` for image tasks.
- One native generate click is allowed per task.
- All four official originals are recovered into `candidates`.
- `selectedResultId` controls the primary image used by downstream nodes.
- Switching the selected candidate preserves the other three candidates and the
  node result history.
- Candidates are shown in a modal selector instead of expanding into four canvas
  nodes.

Video generation keeps its separate generation-count parameter.

## Extension Recovery

The v1.6.6 extension:

- compares pre-submit and post-submit media URLs to exclude references and old
  history;
- accepts only JiMeng generated-image CDN URLs;
- downloads matching original PNG assets instead of preview thumbnails;
- waits for four new candidates before completing the logical output;
- continues an incomplete batch only when the exact current task record says the
  remaining images cost zero extra points;
- never clicks a continuation control from a stale task record;
- reports a terminal partial failure when successful and failed slots account for
  the complete four-slot batch;
- does not blindly retry provider submission.

## Real Acceptance Matrix

| Capability | Real result | Candidate contract | Quality verdict |
| --- | --- | --- | --- |
| Four-image recovery | Pass | One call, four official originals | Pass |
| Portrait realism | Pass | Four 2352x1568 PNG candidates | Texture and artifact proxies pass; identity needs semantic or human review |
| Style transfer | Pass | Four 2048x2048 PNG candidates | Local style-progress proxy pass |
| 2:1 panorama | Pass | Official 2880x1440 original recovered | Structural pass; seam distortion still needs draggable visual review |
| Five representative moods | Partial | Four completed tasks each recovered four 2352x1568 candidates | 4/5 completed; one provider-side timeout, no automatic retry |
| Custom 90-degree right view | Transport pass, semantic fail | One call, four 2048x2048 candidates | All four remained right-front three-quarter views |
| Nine-view camera grid | Transport pass, semantic fail | Independent requests each return four candidates | Front views had usable candidates; exact side view did not obey 90-degree camera geometry |

## Evidence

- `evals/runs/2026-07-19-jimeng-web-5-lite-original-four-real-4/`
- `evals/runs/2026-07-19-jimeng-web-5-lite-v166-contract-real/`
- `evals/runs/2026-07-19-jimeng-web-5-lite-style-transfer-real/`
- `evals/runs/2026-07-19-jimeng-web-panorama-original-probe-fixed-7/`
- `evals/runs/2026-07-19-jimeng-web-5-lite-mood-sample5-real-bounded-reset/`
- `evals/runs/2026-07-19-jimeng-web-5-lite-grid9-observable-v166-real/`
- `evals/runs/2026-07-19-jimeng-web-5-lite-right-profile-visibility-real/`

The stopped grid runs contain planned-call counters. They must not be interpreted
as actual completed provider calls. The observed completed batches were two in
the first diagnostic grid run and three in the observable-prompt grid run.

## Product Decision

The candidate chooser makes stochastic JiMeng image recipes usable because the
first candidate is not reliably the best candidate. Exact camera control remains
an upstream model limitation: stronger prompts improved direction but did not
produce a true side elevation from a single reference image.

Nomi must keep requested-camera adherence as `unavailable` until a connected
vision model or a human reviewer evaluates the pixels. A structural success must
not be presented as a semantic camera pass. For production-grade exact camera
work, use a reconstructed GLB/3D camera workflow or another provider with explicit
camera controls, then use JiMeng only for rendering or refinement.
