# Stored Credential Configuration Reachability

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Baseline: `29e6da02a`. Owner: UI line; main owns the public physical-storage DTO flag and its backend contract/tests.

| Cell | Decision and Evidence |
| --- | --- |
| 1. Workflow | Save a custom API key; show saved/masked but pending; reopen without retyping; open existing model picker; explicitly list models and request certification. Replacing an active key returns to this same pending path. Native run 01 failed before Add because its renderer key save produced a pending credential; this exposed a real user-flow reachability gap as well as an incorrect test assumption. |
| 2. Ownership | Main public DTO owns `hasStoredApiKey` (safeStorage record existence only). Existing `hasApiKey` remains credential readiness. UI consumes the two flags separately; no key reads, ciphertext inspection or publication writes in renderer. |
| 3. Reuse | Keep `CustomVendorManage`, `CustomVendorCard`, `canAddModelsToConnection`, existing wizard and certification. No new pane, credential manager, provider branch or retry. |
| 4. States | Unstored: empty input and no Add. Stored/unready: masked saved state, pending label, replacement action and existing picker navigation. Ready: existing saved state and health. Key clear: return to empty input. A locked stored credential stays stored/unready and backend authentication remains authoritative. |
| 5. Interruptions | Existing save remains awaited; close/reopen derives mask from physical storage, not readiness. Failed save retains current editor/error. Replacement invalidates readiness in backend without discarding saved-state UI. Existing picker request revisions remain unchanged. |
| 6. External Data | Only public booleans enter this UI. Missing optional stored flag falls back to existing ready state for an older DTO. No implicit decrypt, activation or upstream request. Main validates absent/disabled/locked/clear/forged flags. |
| 7. Budget | Focused offline tests, one worker. No build, native launch or provider call in the implementation batch. |
| 8. Real Conditions | Native run 01 is retained failed, with no screenshots. The targeted external diagnostic was prepared but not run. Revised built-app acceptance must exercise renderer save-to-pending, not replace it with trusted main-ready seeding. Native zh/en and real GET remain unverified until separately authorized post-build execution. |
| 9. Acceptance/Rollback | Add a failing stored/unready configuration slice before production changes, then run identical GREEN and adjacent tests. Main independently reviews DTO plus UI and coordinates the next build. Revert this UI batch and main's DTO batch together if necessary; never relax executable credential checks as rollback. |

## Scope

`useOnboardingDrawerCatalog.ts`, `CustomVendorCard.tsx`, `CustomVendorManage.tsx`, `onboardingDrawerDerivations.ts`, directly related locale and tests. Do not edit Electron/catalog, secrets, execution, provider requests, native alias fix or the frozen original walk.

## Mandatory Distinction

Being able to configure/certify a saved connection is not permission to execute it. `hasStoredApiKey` must never feed `useVendorHealth` as `hasApiKey`, model availability, publication or generation. A nonempty masked UI is not a certification receipt.
