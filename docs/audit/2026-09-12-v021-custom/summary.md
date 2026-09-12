# Nomi v0.21.0 Custom Integration Acceptance

- Official target: `v0.21.0` (`4a405088af583aabf2585eb11c78e83ec1cb792e`)
- Custom baseline: `097be462087a39a60fca9f4e3321a013867a48e3`
- License: `AGPL-3.0-only` (unchanged)
- Electron: `43.4.1`

## Verification

- Production typecheck: passed.
- Test-type ratchet: passed; 92 pre-existing errors remain under `electron/` and `evals/`, reduced from 110.
- Lint CI: passed with 0 errors and 93 warnings (limit: 98).
- Static quality gates: 20/20 passed.
- Full unit/integration suite outside the filesystem sandbox: 946 files passed, 2 skipped; 8,814 tests passed, 5 skipped, 0 failed in 290.20 seconds.
- Production renderer and Electron build: passed.
- Main isolated Electron smoke: 16 assertions passed; the 3D canvas rendered nonblank with 148 sampled colors.
- Goal feature Electron smoke: 10 assertions passed, including smooth-mode toggling, compare/output nodes, 8 real extracted video frames, 8 generated keyframe nodes, and the built-in video deconstruction skill.
- Restart/idempotency smoke: 6 assertions passed across 2 Electron processes with 0 Provider requests.

## Boundaries

- No real image or video Provider request was submitted.
- No daily project, asset, credential, cookie, or `.mimosa` content was modified during isolated acceptance.
- The sandboxed full-suite report is intentionally not acceptance evidence: local HTTP test listeners were denied with `listen EPERM`. The same suite passed outside that sandbox.
- Large raw JSON test reports remain local audit artifacts and are excluded from the merge commit.
