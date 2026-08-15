# Notification and model-status visual integration

Date: 2026-08-08
Baseline: `deb3048d`

## Goal

Make in-app feedback feel native to Nomi and restore one clear color hierarchy in model setup:

- Nomi accent blue communicates selection, enabled capabilities, and interactive emphasis.
- Success green communicates a verified result only, using a small dot or icon instead of a filled surface.
- A batch run updates one notification in place instead of leaving start/failure/retry/completion history stacked over navigation.

## Scope

- Restyle the existing Mantine notification host with Nomi surface, type, radius, shadow, spacing, and motion tokens.
- Offset notifications below the 56px app bar, constrain width, and limit visible stacking to two.
- Move the notification stack left while a right-side model or task panel is open so feedback never covers panel controls.
- Render explicit notification action buttons instead of making the whole surface an undisclosed action.
- Give canvas batch execution one stable notification identity across start, completion, failure, and retry.
- Change model-setup enabled/available states from success green to accent blue.
- Keep verified connectivity and completed verification green, but reduce it to a dot or icon on a neutral surface.

## Non-goals

- No new notification store or parallel overlay implementation.
- No change to system notifications used while the window is unfocused.
- No change to generation, billing, retry, or model-connection behavior.
- No global replacement of success green with accent blue.

## Interaction contract

| Event | Surface | Lifetime | Action |
|---|---|---|---|
| Informational acknowledgement | Neutral Nomi toast | 3s | None |
| Success acknowledgement | Neutral Nomi toast + green check | 2.6s | None |
| Warning/error | Neutral Nomi toast + semantic icon | 5-6s | Optional explicit button |
| Batch running | One stable toast | Until completion/update | Close allowed |
| Batch failed | Same stable toast | 12s | Explicit retry button |

## Verification

1. Unit-contract tests for notification upsert, lifetime, explicit action, and batch stable ID.
2. Targeted onboarding source contracts for accent-enabled vs green-verified states.
3. `pnpm run gates` from the isolated worktree.
4. Real Electron clicks for model setup plus batch failure/retry notification updates.
5. Human review of light and dark screenshots at desktop and compact window widths.

## Verification result

- `pnpm run gates`: passed on 2026-08-08; 439 test files and 3944 tests passed, with renderer and Electron builds successful.
- Electron production walk: passed with real clicks for dependency creation, paid-run cancellation, mixed-model batch updates, fail-once execution, notification retry, and completed output.
- Notification geometry: 344px wide, container starts 12px below the 56px app bar, and the stack stays clear of the model panel by at least 8px.
- Stable batch feedback: running, failed, retrying, and completed states reuse the same `canvas-batch-run` notification DOM.
- Visual review: light and dark screenshots show no clipping, navigation collision, model-panel occlusion, or ambiguous whole-toast action.
- Security gate: no WeChat feedback records, WeChat keys, `db_key`, or private configuration included.

## Rollback

Revert the single integration commit. Notification data and stored model configuration are unchanged.
