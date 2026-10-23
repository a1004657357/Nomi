# Relay image identity and editable connection repair

Implementation line: coordinator. Independent review: Hypatia. UI line: Sagan.
Categories: spend, long-running, existing interface repair.

| Field | Decision and evidence |
| --- | --- |
| 1. Workflow | Open existing connection, edit URL/key, explicitly fetch models, select additional models, choose an image model on canvas, generate or edit an image. Real cases: CLIProxy text conversation, canvas text-to-image, reference-image edit. Do not modify daily project media or automatically retry paid requests. |
| 2. Ownership | Catalog owns connection and model identity; profile request construction owns outbound transport projection. Canvas owns mode and variant intent, not arbitrary endpoint-specific model renaming. Generated door map and root-cause contract record consumers. |
| 3. Reuse | Reuse CustomVendorManage, ExistingConnectionModelPicker, templateContext and existing native JSON/multipart operations; no second connection manager or provider-specific image runner. |
| 4. States | Empty connection stays editable; fetching shows loading; success shows selectable models; failure preserves prior models and reports actual error; cancellation stops waiting; stale evidence must not claim a new model is verified. Existing zh/en strings and components apply. |
| 5. Interruption | Before submission: closing, disconnecting or cancellation spends nothing. After submission: retain the existing run receipt and collection lifecycle, never submit again merely because a response is slow. Editing credentials preserves catalog ownership rules. Repeated clicks follow existing in-flight guards. |
| 6. External contract | CLIProxy local source rejects KIE mode aliases on native images endpoints. Model identity must follow the selected transport contract, retaining intentional variants and user-authored mappings. Errors must not be mislabeled quota failures. |
| 7. Performance | One normalization per request, no polling, extra provider calls or background model-list fetching. Large canvas performance unchanged; full large-scale benchmark unverified. |
| 8. Real conditions | macOS production build, actual canvas parameter assembly, real CLIProxy credential, isolated projects and retained image assets. zh/en screenshots required. Windows, clean installation and keyboard-only use unverified. |
| 9. Acceptance/rollback | Reported-case and class-level red/green tests, production typecheck/build, independent review, bounded real image generation/edit and persistence readback. Merge only scoped commits; rollback by reverting those commits, never overwriting project data. |

## Observed evidence

The current user project recorded HTTP 400 for a selected `gpt-image-2` submitted as `gpt-image-2-text-to-image`. Canvas mode projection supplies `extras.archetypeInput.model`; the backend spreads that projection over catalog identity. Previous API-only acceptance did not exercise this canvas-derived mode projection. Native Codex `code-mode host is disabled` is a separate failure and is not treated as proof that CLIProxy is broken.

## Delivery preflight

The isolated branch starts from customized daily HEAD `a730dacb5`. Delivery preflight attempted its one fetch and failed because configured Git transport proxy `127.0.0.1:7897` refused the connection. No automatic fetch retry or remote publication is part of this repair.

## Native acceptance follow-up: stored is not certified

The first native configuration walk failed before screenshots: its custom credential was saved through the real renderer API, which correctly leaves it unpublished until certification. `hasApiKey` is an execution-readiness projection and therefore false for that record. Using it for both configuration navigation and masked saved-key presentation prevents the user from reaching the existing model picker and certification workflow after editing a key. This is a real configuration-state invariant, not grounds to enable an uncertified key or seed a fake ready state.

Add a separate read-only `hasStoredApiKey` presence boolean to public vendor DTOs, derived only from existing encrypted material. Use it for the existing editor and model-configuration navigation. Keep health, enabled state, model publication, spend and credential decryption rules unchanged. The real workflow is save URL/key, retain masked saved state, explicitly fetch/select models, then certify before execution. Missing/cleared material remains absent; locked encrypted material can be replaced but is never declared usable. No new schema authority or secret crosses to the renderer. Tests cover disabled, ready, locked, cleared and forged inputs. Re-run native zh/en acceptance on a fresh run after the fix; preserve the failed receipt. Reviewer must independently verify that configuration access did not become execution permission.
