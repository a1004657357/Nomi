# R5 Display CI Owner Repair

Base: `e10258014`. Author line: R5, not final independent reviewer.
Status: implemented, not pushed; coordinator integration and full CI unverified.

## Design Card

| Item | Decision and Evidence |
| --- | --- |
| 1. Use | Existing resident creative summaries must compile without importing main implementation. No new UI, action, execution, paid authority or input translation. Real App/Provider/screenshot verification is out of scope and unverified. |
| 2. Owner | Strict Director wire/canonical schema and parser belong in `electron/shared`; native tools re-export, display and creative schemas consume directly. Existing structured legacy migration remains an adapter, not the display parser. `door-map parseVibingDirectorPlanRequest`: three consumer doors, four calls. |
| 3. Reuse | Extract existing Zod rules, no weaker UI parser. Reuse canonical `directorProtocolSource` messages byte-for-byte. Preserve wire descriptions, constraints, field order and tool names. TranslationKey remains a constraint, never a value annotation; use locale-derived string keys. |
| 4. States | All existing zh/en names, fields, pending arguments, replace/amend distinction, sensitive-field omission and nonexecution boundaries remain unchanged. Invalid strict inputs remain null; no legacy recovery on the display path. |
| 9. Acceptance | Red/green focused import and key-type tests, strict/native/legacy characterization and existing display tests, maxWorkers=1. Coordinator runs full types/gates after screenshots; author cannot final-review this patch. Revert this isolated commit to roll back. |

## Scope

Only resident display, neutral Director schema/parser ownership and direct consumer
imports, focused tests and v3 contract. No outbound, video, PNG, locale copy,
canonical protocol text, models, baseline budgets, skip or timeout changes.
No coordinator-tree writes, App/Provider launch, full typecheck or gate execution.
The existing self-written exact owner entry moves from the now-pure native
re-export to the shared module; entry count, reasons and domain/ignore budgets do
not change. No exact hash or frozen baseline is updated.

## Prior Art

- `electron/ai/vibingDirectorTools.ts` at e102 already owns the flat Zod wire schema
  and strict null-returning validation. Extract this implementation, not a new parser.
- `src/workbench/generationCanvas/nodes/vibingDirector/vibingDirectorStructuredProtocol.ts`
  already has the equivalent strict canonical rules plus separate legacy migration.
  Remove only the duplicated rules and delegate to the shared strict owner.
- `electron/shared/blenderDirectorProtocolText.ts` already owns stable canonical
  messages; use these unchanged. Native canonical error objects were private and
  discarded before returning null, so no public localized diagnostic changes.

This is ownership relocation of existing domain validation, not a new generic
schema engine. Zod stays the validation implementation; compatibility remains at
its existing adapter rather than adding permissive fallback to the display.

## Root Cause

CI `ci-e102-contracts-22.log:7798-7842` reports a new renderer-to-main import and
TS2345 at the three creative display key call sites. These files have no changes
between the previous delivered branch and e102. ParseKeys depends on the included
i18next augmentation; value annotations erased string literals into unknown in
one configuration. The local key-flow compiler test explicitly varies that type,
without pretending to be a complete project typecheck.

## Verification

All commands ran in `/Volumes/S7/AiWork/Projects/Nomi-r5-resident-display-20261025`.
Evidence prefix:
`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/r5-ci-owner-`.

- Before production edits: `red.json`, 1 passed / 2 failed / 0 skipped. The two
  failures are the direct main import and three unknown-to-string TS2345 errors.
  `characterization-before.json`: 57 passed / 0 failed / 0 skipped.
- Final core group: `green-core-final-02.json`, 69 passed / 0 failed / 0 skipped.
  Includes existing 40 display tests, native 7, new strict-owner 19 and compile
  boundary 3. Unknown and string ParseKeys both compile; a misspelled locale key
  still fails with TS2820. No type cast or arbitrary-string widening is used.
- Direct consumers: `green-consumers.json`, 33 passed / 0 failed / 0 skipped.
  Includes real lane Host lifecycle tests (no approval, changed arguments,
  cancellation, duplicate settlement), creative schema and structured protocol
  adapters. Every Vitest group used `--maxWorkers=1`.
- `eslint-final.json`: seven changed TypeScript files, 0 errors / 0 warnings.
- `audit.json`: pure scoped contract validation passes for corrective owner and
  structural native re-export contracts; actual generated parser/schema doors
  remain 9 before / 9 after. Native re-export has no AST use door, so it is
  documented structurally rather than inventing a door or runtime wrapper.
- Published read/apply wire JSON hash before and after:
  `f28461a2dc39d496be87bc6ebee5c87852613abd19866b21d4b769b711af53d4`.
  Protected baselines, both resident locales, canonical source messages and
  desktop locale source are byte-identical to e102. Registry entries stay 46.
- Intermediate `green-core-final.json` is NOT acceptance evidence: its new
  negative typo check incorrectly expected generic TS2322 rather than installed
  TypeScript's suggestion-bearing TS2820. Corrected only that exact diagnostic
  expectation, retained rejection, and reran as `green-core-final-02.json`.

No complete typecheck, boundaries gate, model-face gate, full suite, App,
screenshot, Provider, outbound check, push or coordinator-tree write was run.
Final independent acceptance must be another reviewer, not this author.
