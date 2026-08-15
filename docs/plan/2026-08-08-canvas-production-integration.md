# Canvas batch production integration

Date: 2026-08-08
Baseline: `81c55e7d`

## Goal

Bring the useful batch-production behavior from `Nomi-canvas-production` onto the current `main` without reverting the feedback, control-hierarchy, and release changes added on August 7-8.

## User-visible scope

- With no selection, expose one clear action to generate every eligible node in the current canvas category.
- With a selection, generate only eligible selected nodes and allow one-step bulk model changes by execution kind.
- Keep batch concurrency available as an advanced setting instead of a primary creative decision.
- Keep one-step undo behavior for bulk model changes.

## Architecture

- Reuse the existing dependency-wave, spend-confirmation, queue, model-option, undo, and asset-preview paths.
- Add pure helpers for production scope and model-change patches.
- Keep one production action hook. UI components only render state and dispatch those actions.
- Do not restore code that current `main` has deleted or superseded.

## Non-goals

- No new generation protocol or billing path.
- No second clipboard, text editor, model catalog, asset preview, or queue implementation.
- No change to provider APIs.
- No upload or publication of local WeChat feedback tooling or data.

## Verification

1. Targeted pure/store/component tests.
2. `pnpm run gates` from a clean integration worktree.
3. Real Electron click-through covering create, select, bulk model, concurrency, generate-all, and generate-selected.
4. Screenshot review in light and dark modes, plus console-error inspection.
5. Commit only after the code, tests, build, and real-window journey refer to the same tree.

## Rollback

The integration is one commit on top of the baseline. Revert that commit to restore the prior canvas behavior and leave stored projects unchanged.
