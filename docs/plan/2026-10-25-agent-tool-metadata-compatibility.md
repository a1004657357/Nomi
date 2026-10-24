# Agent Tool Metadata Compatibility

Parent: `84161276d46fcb4b775d248a80f839bc28ea6b7c`. Same isolated worktree; local commit only. Runtime: bundled Node v24.19.0. No user App launch or actual media/provider execution.

## Design Card

| Field | Decision / Evidence |
| --- | --- |
| 1. Workflow | Existing creative-tool callers read complete English fields and use existing MCP render/batch names with unchanged input validation and results. Six offline scenarios cover the already-published creative operations; they do not claim real media execution. |
| 2. Owner | Shared Zod schemas own field constraints/units; shared verb declarations own descriptions, three prompt channels and effect classification. Existing custom local dispatcher owns leases, UI confirmation and execution. Existing manifest owns offline trajectories; frozen signatures remain untouched. |
| 3. Reuse | Derive the two existing MCP schemas/descriptions from registered capability/verb owners, retaining original route builders and handlers. Reuse current read/review/no-resubmit contracts, Blender harness and original dispatcher tests. No new scopes or executable permissions. |
| 4. States | Unknown fields, references, omitted or unknown tools still reject. Offline writes require fresh review and never generate. Batch remains pending human spend confirmation, with no automatic resubmission or new idempotency promise. |
| 5. Interruptions | Metadata only: no execution, cancellation, restart, network or double-click handler changes. Existing lease expiry, pending confirmation and retry behavior stay with the original dispatcher. Failure/timeout/cancellation/pending confirmation never authorize automatic resending; real interruption UI remains unverified. |
| 6. External Input | No provider/model capability claims. Real schema types/bounds/unknown-field rejection remain byte-characterized; units come from the repository Blender harness. Local fixtures supply model availability/validated GLB metadata, not live services or rights. |
| 7. Budget | Actual Node24.19 maximum: 35 resident tools, 9999/10000 tokens; ceiling and estimator untouched. MCP tools/list is 54562/54083 bytes, still 479 over its separate ratchet; no baseline/ledger update. App latency/memory/frame rate unverified. |
| 8. Real Conditions | Windows, English UI, minimum window, real-scale projects, clean install, actual paid calls and keyboard-only App use: unverified. This batch is explicitly offline; no generation or App launch is used as evidence. |
| 9. Acceptance / Rollback | Red/green metadata and six offline cases, before/after validation-shape digests, unchanged MCP dispatch/scope/approval behavior, Node24.19 schema budget <=10000, scoped types/lint and v3 door map. Coordinator owns integration/full CI; revert only this commit to roll back. |

## Boundaries / Investigation

- Reproduced 52 missing field descriptions and two handwritten MCP surfaces. Existing internal profile has 27 tools, while the usecase manifest lists 21.
- The usecase checker also has an explicit 21-count signature annotated as frozen. Preserve it; add complete manifest validation independently, and report this remaining count failure for coordinator approval. Do not substitute a dynamic count.
- Never edit model-face-baseline.json, count freeze tables or any violation baseline; no --update-baseline invocation.
- Harness vec3 maps Director [x,y,z] to Blender [x,-z,y]. Rotations are Director XYZ degrees converted to Blender radians; FOV is degrees. Position/distance use scene units, not an invented meter scale. Camera paths are seconds sampled at 24 fps.
- Actual schemas, handler effects, lease scopes, approval freshness, source/provenance, compatibility and no-auto-resend restrictions remain intact. Descriptive metadata only; do not weaken fields into unknown/record.
- Preflight fetch failed once due to the existing localhost proxy being unavailable; do not change proxy/account settings. Remote freshness is unverified.
- Native schema descriptions already use the first sentence. Measure the real budget when compressing creative descriptions; do not change the estimator, resident groups or 10000 ceiling. Local starting maximum is 9995 (coordinator's newer main reports 9974).

## Verification

- RED before production edits: 54 new tool-face findings (52 missing English fields + two handwritten MCP surfaces); changed metadata regression 4 failed. Manifest missed all six creative verbs and also exposed its pre-existing frozen 21-count assertion.
- GREEN: 12 focused Vitest files / 160 tests, including six manifest-backed executions, original MCP dispatcher/route/lease/spoofing regressions, native action parsing, existing creative approval and transport tests. Network/paid-runner tripwires stay untouched in all six offline cases; readback is actual serialized store state, not a claim of disk/App persistence.
- GREEN: Node tests 31/31 (usecase validator, tool-face rules, MCP tool references) plus separately serialized constructibility mutations 7/7. Missing any creative verb, unknown verbs, duplicate names, missing coverage and a false first-tool trajectory still fail.
- GREEN: check:tool-face hard findings 0; ratchets remain field descriptions 10 / handwritten MCP 17 / transitional reasons 14 (unchanged baselines). The reported 52+2 additions are gone, not excluded.
- GREEN: check:model-schema with bundled Node24.19, including the actual 35-tool maximum combination at 9999/10000. Before this batch the isolated branch measured 9995; coordinator's newer main measured 9974. Re-measure after integration; isolated headroom is only one token.
- GREEN: 12 changed TypeScript files have zero scoped syntax/semantic diagnostics using existing test compiler options; 11 non-ignored TypeScript files pass ESLint with --max-warnings=0. Scripts are excluded by the existing ESLint policy, so their behavior is tested directly instead of claiming lint coverage.
- Compatibility: seven internal input schemas and both MCP inputs retain pre-change validation fingerprints (description/$schema stripped only). Both MCP methods/builders/hints/raw-result behavior stay unchanged; no generic adapter or internal exposure is added for these two custom routes.
- Historical door map: git-object source at the parent commit gives 28 doors; current actual sources give 41, including the actual flat wire schema and new semantic inputs. Additional doors are explicit metadata-owner/projection/manifest-validation calls, not new execution paths; original consumers remain for their separate read/validation responsibilities.
- An initial snapshot assertion compared JSON key order; fixed to structural equality. A concurrent legacy mutation suite temporarily affected another test reader; source was restored and all tests rerun serially. Sandbox-only IPC/loopback failures were rerun with permission: final 160 + 38 tests pass.
- Frozen-file byte audit: all 44 baseline/frozen/ledger files match the parent byte-for-byte, and the usecase checker's literal 21-count block is identical. model-face-baseline.json SHA256: 044a96558ff7f41b736f4d59005dee4fec1feff3f2ca5a847752c31b4726daa6. Coordinator owns final integration/full CI.

## Remaining / Coordinator Handoff

- check:agent-tool-face-usecases now reports only the preserved literal count: 27 actual internal verbs versus 21 frozen. Real skill/bank checks complete; exact-name/trajectory validation is green. Keep this red until the count owner receives approval.
- check:model-face-frozen remains fail-closed at the same 27-versus-21 guard. No model-face-baseline.json, count freeze, violation baseline or --update-baseline action is changed or invoked.
- Separate MCP payload ratchet: 54562 bytes versus 54083, +479. Old two surfaces plus the new required transition explanations measure 54131; therefore 48 bytes of this increase come from the two transition fields. Deriving the two existing surfaces adds shared lease/project and semantic field explanations plus explicit retry/confirmation discipline. Their prose was compacted, but the rest cannot be removed without losing provenance/approval/retry meaning. Recommended coordinator action: free 479 bytes in other shared MCP metadata under its owners, without raising any baseline/ledger or weakening these contracts. This is not covered by pending model-face freeze approval.
- Pre-existing adjacent gap, deliberately not repaired: canonical set_beat requires title, while planActionWireSchema has no title field. Adding a field would violate this batch's unchanged-input fingerprint; pass to the coordinator for a separate functional repair.
- Remote preflight failed on the existing localhost proxy. Remote freshness, real media, actual Blender execution and App/platform journeys remain unverified. State: implemented, not pushed; no merge/PR/memory write.
