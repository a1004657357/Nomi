# Default README Bilingual Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the existing group and maintainer WeChat QR codes directly in the first screen of both default and Chinese READMEs while retaining an international English path.

**Architecture:** Treat both README files as two localized views of one conversion contract. A static test protects not only the presence of both real QR assets and textual WeChat fallback, but also their ordering before the hero poster so future edits cannot silently move conversion below the fold.

**Tech Stack:** GitHub Flavored Markdown, HTML image tags, Node.js ESM static contract, Git.

---

### Task 1: Lock first-screen QR ordering with a failing contract

**Files:**

- Modify: `tests/ux/marketing-home.static.mjs`
- Test: `tests/ux/marketing-home.static.mjs`

- [x] **Step 1: Add a helper that requires a token before the hero poster**

```js
const expectBefore = (document, token, boundary, message) => {
  const tokenIndex = document.indexOf(token)
  const boundaryIndex = document.indexOf(boundary)
  expect(tokenIndex >= 0 && boundaryIndex >= 0 && tokenIndex < boundaryIndex, message)
}
```

- [x] **Step 2: Add exact default and Chinese README first-screen assertions**

```js
const readmeHero = '[![Nomi director workflow]'
const readmeZhHero = '[![Nomi 导演工作流]'
for (const [token, label] of [
  ['<img src="docs/media/nomi-canvas-group-wechat.png"', 'group QR'],
  ['<img src="docs/media/qingyang-wechat.jpg"', 'maintainer QR'],
  ['TZ857886159', 'textual WeChat fallback'],
]) {
  expectBefore(readmeEn, token, readmeHero, `English default README keeps ${label} before hero`)
  expectBefore(readmeZh, token, readmeZhHero, `Chinese README keeps ${label} before hero`)
}
```

- [x] **Step 3: Run the contract and verify RED**

Run: `node tests/ux/marketing-home.static.mjs`

Expected: FAIL at `English default README keeps group QR before hero` because `README.md` has no direct QR image.

- [x] **Step 4: Commit the red contract**

```bash
git add tests/ux/marketing-home.static.mjs
git commit -m "test(readme): lock WeChat conversion above the fold"
```

### Task 2: Move both real QR codes into the two README first screens

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Test: `tests/ux/marketing-home.static.mjs`

- [x] **Step 1: Insert the bilingual conversion block into the default README**

Place the conversion block directly after the first link row and before release badges. Use the existing group and maintainer image paths, direct-image links, bilingual labels, textual `TZ857886159`, GitHub Discussions, and Business Inquiry. After narrow-screen inspection exposed table shrinkage, use a vertical 220 px group QR followed by a 180 px maintainer QR.

- [x] **Step 2: Insert the Chinese conversion block in the same position**

Use the same two image paths and ordering. Keep the current download, Quark mirror, group, team, film, and English links unchanged.

- [x] **Step 3: Remove only the now-duplicated lower image tags**

Keep `## 用户群` and `## 关于作者`, but replace their lower QR images with links back to the first-screen images and the textual WeChat fallback. Do not remove conversion sections or destinations.

- [x] **Step 4: Run the static contract GREEN**

Run: `pnpm run check:site`

Expected: `MARKETING SITE CHECK PASS` and `MARKETING HOME STATIC PASS`.

- [x] **Step 5: Commit the README change**

```bash
git add README.md README.zh-CN.md
git commit -m "docs(readme): put WeChat conversion on the first screen"
```

### Task 3: Render, inspect, integrate and publish

**Files:**

- Modify: `docs/superpowers/specs/2026-08-02-default-readme-bilingual-conversion-design.md`
- Modify: `docs/superpowers/plans/2026-08-02-default-readme-bilingual-conversion.md`

- [x] **Step 1: Render both Markdown files and inspect the top section**

Use a GitHub-compatible Markdown renderer or the GitHub repository page after pushing. Verify both QR images load, remain scannable, and occur before the hero poster on desktop and narrow viewport.

- [x] **Step 2: Run focused and full verification**

```bash
pnpm run check:site
git diff --check
pnpm run gates
```

Expected: site contract and complete repository gate pass with no new lint warnings.

- [x] **Step 3: Record evidence and commit**

Update the spec state to `已实施并验证`, check completed plan boxes, and record test counts, rendered screenshots, final commit and live GitHub rendering evidence.

- [x] **Step 4: Integrate on latest remote main and push**

Fetch `origin/main`, rebase or cherry-pick onto the newest commit, run `pnpm run gates`, require `origin/main` to be an ancestor, then push `HEAD:main` without force.

- [x] **Step 5: Verify the final default GitHub README**

Require the final commit's Quality Gate and Mac Package to pass. Open the repository front page and Chinese README from GitHub, verify both real QR images render before the hero, and confirm the raw README contract still passes.

### Recorded result

- Red contract: the original table failed the mobile-prominence assertion; real GitHub inspection measured the group QR at only 69 px on a 390 px viewport.
- Green contract: the published vertical layout renders the group QR at 220 px and maintainer QR at 180 px on both narrow and desktop views, with no horizontal overflow.
- Local gates: 368 test files passed / 1 skipped; 3404 tests passed / 1 skipped; 98 lint warnings / 0 errors; typecheck and both builds passed.
- Published content commit: `56dfaa32a39de1675bf7173ed17b2f9f08559dba`.
- Remote checks: Quality Gate, Mac Package, and Workers Builds all completed successfully.
