# v0.23.2 Customized Local Integration

Status: implemented locally, not pushed or released. Final checkout and merge SHA are recorded in the external `daily-transfer.json` receipt after transfer.

## Source and Preservation

- Official stable base: `v0.23.2`, `e572242858111bfabfccbfba379c2230c8855d1e`.
- Original daily HEAD: `2d9104ef6f98648a010926f25445108bfd1fc3c7`.
- Customized source plus previously uncommitted Pavo work: snapshot `19a130dca`.
- Integration branch: `codex/nomi-v0232-integration-20261020`.
- Daily folder: `/Volumes/S7/AiWork/Projects/Nomi-codex-director-upgrade`.
- Evidence and backup folder: `/Volumes/S7/AiWork/Projects/Nomi-merge-v0232-20261020`.
- The backup manifest covers 4,380 source files and 3,254 local `.mimosa` files. Before transfer, compare every recorded hash, deleted path, original HEAD and dirty status. Abort on intervening changes.
- Preserve the original code-only dirty changes in a named Git stash before fast-forwarding. Do not include `.mimosa`, credentials, browser profiles or daily project assets in that stash. Do not apply it over the new version: the customized snapshot already contains those changes.

## Integration Decisions

The official Agent lane and typed project/asset boundaries replace obsolete Agent implementations. Customized Codex Img2, Jimeng Web/CLI, Pavo, AGNES, Blender and storyboard components are migrated onto the new boundaries, not exposed through a second legacy engine.

Important compatibility repairs include:

- Fixed project identity is captured before asynchronous work; stale results cannot write into a replacement project. Local images, videos and 3D outputs use the official project asset publication boundary.
- Shared submission intent deduplication runs before node exclusivity. An unacknowledged remote create stays submission-unknown, not a fabricated failed task that could invite another paid submission.
- Narrative video defaults prefer a supported multi-reference mode. Explicit saved model choices remain intact. Image composition prompts and video action prompts are separate.
- Shared result delivery flattens and retains all provider candidates, including four-image responses. Previous results and run receipts are not silently truncated. Same-category regeneration uses its own provenance field.
- Queued and rate-limited waiting stays queued until actual work begins, in both foreground and background result delivery.
- Converted images and videos share a graph-derived display identity with one canonical shot-number owner. Copying, category reuse, templates, headless creation, save/load and multi-owner first-frame cases have dedicated regression coverage.
- Customized `scene3d` / Blender state is preserved separately from official `director` state. The two formats are not automatically rewritten into one another.
- The desktop and headless output-node dimensions are consistent again.

## Evidence

Machine-readable test reports and build logs are kept in the evidence folder rather than committed as large private runtime artifacts. `completion-report.json` is the final index of actual test counts, check outcomes, commit, transfer and startup evidence. Earlier red reports remain diagnostic history, not final acceptance receipts.

Actual Electron walkthroughs:

- Pavo: real bundled extension, managed local bridge/SSE, duplicate-intent deduplication, parameter application with zero generation clicks, local MP4 materialization, repeated retrieval without duplicate assets, persisted canvas node and working 320x180 video preview. The website is an intercepted local fixture, not a live-account generation.
- Director: real local mannequin and camera rendering, nonblank preview pixels, PNG and MP4 generation, canvas references and edges, save and cold reopen. This verifies the in-app Director; it is not a new Blender GUI workflow acceptance.
- Both use isolated browser/settings/project directories, an outbound network guard and explicit cleanup. Screenshots are stored with their corresponding logs.

Production type checks must have zero errors. The test-type gate still has 46 pre-existing errors against its pinned baseline of 48; this is a passing ratchet, not zero-error test typing. No baseline increase was made.

MCP tools/list is 54,066 bytes. Four reviewed custom capability migrations explain the 3,549-byte difference from the official tag, and their budget entries are itemized in `scripts/mcp-payload-ledger.json`. The model-visible schema retains its existing 16-debt baseline, with no new violations; the maximum combined tool budget is 9,974 tokens.

On this machine, Node 24.1 native TypeScript stripping interferes with the schema gate loader. The verified invocation disables native stripping and uses the existing `tsx` loader; it does not alter production tool definitions or waive gate checks.

## Limits and Release Blockers

- No live paid image/video generation is submitted for this merge. Provider execution quality, current account quotas and live website DOM compatibility are not re-certified by local fixtures.
- Full upstream release gates are not claimed. Selected contracts, regressions, builds and isolated Electron walkthroughs are reported individually.
- The existing UE retopology spike is still not cleared for bundled redistribution. Third-party local audit passes with that explicit release blocker. No public release or push is performed.
- Existing historical whitespace and build chunk-size warnings remain visible. They are not normalized through unrelated bulk edits.
- Daily projects are not used for testing. Opening them later in the new app may invoke official migrations; back up project files before any future downgrade.

## Rollback Assets

Keep the external backup archives, original dirty-change stash, customized snapshot and integration branch. A rollback should first prepare an independent old-version checkout and preserve current project data. Do not use destructive reset, overwrite a user's subsequent work, or pop the old stash over the merged checkout.
