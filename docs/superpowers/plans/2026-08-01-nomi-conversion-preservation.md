# Nomi Conversion Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore community and direct-business conversion paths across the existing bilingual homepage and README pair without changing the approved homepage visual design, then make those paths impossible to delete silently.

**Architecture:** Extend the existing locale-parity content model with shared conversion destinations and a two-card community section rendered entirely from the homepage's current `.paths-section`, `.paths`, `.path`, `.service`, and `.button` primitives. Protect both generated pages and both READMEs with static contract assertions; extend the current Playwright matrix to verify the restored destinations under desktop, mobile, no-JavaScript, and blocked-media conditions.

**Tech Stack:** Node.js ESM, generated static HTML, existing vanilla CSS, Markdown, Playwright, Git, Cloudflare Workers Builds.

---

## Scope and file map

| Responsibility | Files |
|---|---|
| Approved correction | `docs/superpowers/specs/2026-08-01-nomi-conversion-preservation-design.md` |
| Conversion facts and localized copy | Modify `scripts/marketing/content.mjs` |
| Existing-design rendering | Modify `scripts/marketing/template.mjs` |
| Generated outputs | Regenerate `marketing/index.html`, `marketing/en/index.html` |
| README conversion paths | Modify `README.md`, `README.zh-CN.md` |
| Static deletion guard | Modify `tests/ux/marketing-home.static.mjs` |
| Real-browser regression guard | Modify `tests/ux/marketing-home.visual.mjs` |
| Evidence | Modify this plan and the approved spec after verification |

`scripts/marketing/styles.mjs` is an explicit non-target. The user rejected a new visual treatment; implementation must reuse current classes and should leave the stylesheet byte-identical.

### Task 1: Lock the missing conversion paths with a red static contract

**Files:**

- Modify: `tests/ux/marketing-home.static.mjs`
- Test: `tests/ux/marketing-home.static.mjs`

- [x] **Step 1: Add every durable conversion asset to the existence contract**

Append these paths to the existing `files` array:

```js
  'marketing/assets/group-wechat.png',
  'marketing/assets/qingyang-wechat.jpg',
  'docs/media/nomi-canvas-group-wechat.png',
  'docs/media/qingyang-wechat.jpg',
```

- [x] **Step 2: Read both README files once and add exact website assertions**

Immediately after reading `marketing/_headers`, add:

```js
const readmeEn = read('README.md')
const readmeZh = read('README.zh-CN.md')
```

Immediately after the existing paid-service assertion, add:

```js
expect(zh.includes('id="community"'), 'Chinese community section exists')
expect(en.includes('id="community"'), 'English community section exists')
expect(zh.includes('href="#community"') && zh.includes('>社群<'), 'Chinese community nav exists')
expect(en.includes('href="#community"') && en.includes('>Community<'), 'English community nav exists')
expect(zh.includes('/assets/group-wechat.png'), 'Chinese group QR destination exists')
expect(zh.includes('/assets/qingyang-wechat.jpg'), 'Chinese maintainer QR destination exists')
expect(zh.includes('TZ857886159'), 'Chinese direct WeChat ID exists')
expect(en.includes('github.com/aqm857886159/Nomi/discussions'), 'English community uses Discussions')
for (const service of ['定制开发', '系统与模型集成', '贴牌交付与商业授权', '持续优化、维护与迭代']) {
  expect(zh.includes(service), `Chinese service survives: ${service}`)
}
for (const service of ['Custom builds', 'System and model integrations', 'White-label and commercial license', 'Ongoing optimization and iteration']) {
  expect(en.includes(service), `English service survives: ${service}`)
}
```

- [x] **Step 3: Add exact README preservation assertions**

Before the final `console.log`, add:

```js
for (const label of ['加入用户群', '团队合作', '夸克网盘镜像', 'TZ857886159']) {
  expect(readmeZh.includes(label), `Chinese README conversion survives: ${label}`)
}
expect(readmeZh.includes('docs/media/nomi-canvas-group-wechat.png'), 'Chinese README keeps group QR')
expect(readmeZh.includes('docs/media/qingyang-wechat.jpg'), 'Chinese README keeps maintainer QR')
expect(readmeZh.includes('business_inquiry.yml'), 'Chinese README keeps business inquiry')
for (const label of ['Community', 'For Teams', 'Custom builds', 'Integrations', 'White-label / commercial licenses', 'Ongoing iteration']) {
  expect(readmeEn.includes(label), `English README conversion survives: ${label}`)
}
expect(readmeEn.includes('github.com/aqm857886159/Nomi/discussions'), 'English README keeps Discussions')
expect(readmeEn.includes('business_inquiry.yml'), 'English README keeps business inquiry')
```

- [x] **Step 4: Run the contract and prove the homepage/README regression exists**

Run:

```bash
node tests/ux/marketing-home.static.mjs
```

Expected: FAIL at `Chinese community section exists`; the current generated homepage has no `#community` section. After that failure is implemented, the same test must still fail until the README first-screen labels are restored.

- [x] **Step 5: Commit only the red contract**

```bash
git add tests/ux/marketing-home.static.mjs
git commit -m "test(marketing): lock community and business conversion paths"
```

---

### Task 2: Extend the locale content model without changing the design system

**Files:**

- Modify: `scripts/marketing/content.mjs`
- Test: `tests/ux/marketing-home.static.mjs`

- [x] **Step 1: Add shared destinations as the only source of truth**

Extend `shared` with:

```js
  discussionUrl: 'https://github.com/aqm857886159/Nomi/discussions',
  wechatId: 'TZ857886159',
  groupQr: '/assets/group-wechat.png',
  authorQr: '/assets/qingyang-wechat.jpg',
```

Do not duplicate these URLs or the WeChat ID inside the locale objects.

- [x] **Step 2: Add the navigation label and strengthen the Chinese team copy**

Add `community: '社群'` after `teams: '团队服务'` in `zhCN.nav`. Replace the Chinese team title/description and add a secondary action label:

```js
      title: '把 Nomi 变成你的产品与交付能力',
      description: '适合内部 AI 视频工作台、客户项目、垂直行业流程与贴牌产品；从首次验证到上线后的持续迭代，围绕真实交付来构建。',
      services: [
        { id: 'custom', title: '定制开发', code: 'CUSTOM' },
        { id: 'integration', title: '系统与模型集成', code: 'INTEGRATE' },
        { id: 'whiteLabel', title: '贴牌交付与商业授权', code: 'WHITE-LABEL' },
        { id: 'iteration', title: '持续优化、维护与迭代', code: 'ONGOING' },
      ],
      discuss: '沟通项目',
      wechat: '微信沟通',
```

- [x] **Step 3: Add the Chinese community object**

Insert `community` after `paths` and before `closing`:

```js
  community: {
    titleLead: '一起用，',
    titleEmphasis: '也一起把它做好。',
    description: '看真实工作流、反馈问题、获取版本动态，也让你的摩擦直接进入下一轮产品迭代。',
    cards: [
      {
        id: 'group',
        kicker: '01 / USER COMMUNITY',
        title: '加入 Nomi 用户群',
        description: '进入 nomi 画布群，看别人怎么用、直接反馈问题，并第一时间收到版本动态。',
        primary: { label: '查看群二维码', code: 'WECHAT GROUP', target: 'groupQr' },
        secondary: { label: '参与 GitHub 讨论', code: 'DISCUSS', target: 'discussionUrl' },
      },
      {
        id: 'author',
        kicker: '02 / DIRECT CONTACT',
        title: '群码失效，直接加作者',
        description: '添加微信 TZ857886159 拉群；定制开发、系统集成、贴牌与持续迭代也可以直接沟通。',
        primary: { label: '查看个人微信二维码', code: 'WECHAT', target: 'authorQr' },
        secondary: { label: '提交商务咨询', code: 'BUSINESS', target: 'businessUrl' },
      },
    ],
  },
```

- [x] **Step 4: Add the parity-matching English content**

Add `community: 'Community'` after `teams: 'For Teams'` in `english.nav`. Keep the four existing service titles exactly, replace the team copy, and add `wechat: 'WeChat contact'`:

```js
      title: 'Make Nomi fit your product and delivery',
      description: 'For internal AI video workbenches, client projects, vertical workflows, and white-label products—from first validation through ongoing iteration.',
```

Insert the parity-matching English community object:

```js
  community: {
    titleLead: 'Build with Nomi.',
    titleEmphasis: 'Help shape what comes next.',
    description: 'See real workflows, discuss friction, follow releases, and bring useful feedback directly into the next iteration.',
    cards: [
      {
        id: 'group',
        kicker: '01 / COMMUNITY',
        title: 'Join the Nomi community',
        description: 'Use GitHub Discussions for an open, international conversation. WeChat users can also open the Chinese group QR.',
        primary: { label: 'Open GitHub Discussions', code: 'DISCUSS', target: 'discussionUrl' },
        secondary: { label: 'Open the WeChat group QR', code: 'WECHAT GROUP', target: 'groupQr' },
      },
      {
        id: 'author',
        kicker: '02 / FOR TEAMS',
        title: 'Bring a real project',
        description: 'Discuss a custom build, integration, white-label delivery, commercial license, or ongoing iteration using non-confidential information.',
        primary: { label: 'Discuss a project', code: 'BUSINESS', target: 'businessUrl' },
        secondary: { label: 'Open the maintainer WeChat QR', code: 'WECHAT', target: 'authorQr' },
      },
    ],
  },
```

- [x] **Step 5: Prove locale parity before rendering**

Run:

```bash
node --input-type=module -e "import('./scripts/marketing/content.mjs').then(({assertLocaleParity}) => { assertLocaleParity(); console.log('LOCALE PARITY PASS') })"
```

Expected: `LOCALE PARITY PASS`.

- [x] **Step 6: Verify the stylesheet remains untouched**

Run:

```bash
git diff --exit-code -- scripts/marketing/styles.mjs
```

Expected: exit 0 with no output.

---

### Task 3: Render conversion content using only existing homepage primitives

**Files:**

- Modify: `scripts/marketing/template.mjs`
- Generate: `marketing/index.html`
- Generate: `marketing/en/index.html`
- Test: `tests/ux/marketing-home.static.mjs`

- [x] **Step 1: Restore the community anchor in the existing navigation**

In `renderNav`, insert after the teams link:

```js
  <a class="nav-link" href="#community">${escapeText(content.nav.community)}</a>
```

- [x] **Step 2: Add a secondary WeChat action to the existing team button row**

Replace the current one-link `path-actions` inside the team card with:

```js
        <div class="path-actions">
          <a class="button button--ink" href="${escapeAttr(shared.businessUrl)}" ${externalAttrs}><span>${escapeText(content.paths.teams.discuss)}</span><span aria-hidden="true">↗</span></a>
          <a class="button" href="${escapeAttr(shared.authorQr)}" ${externalAttrs}><span>${escapeText(content.paths.teams.wechat)}</span><span aria-hidden="true">↗</span></a>
        </div>
```

Add this sentence to the Chinese team description in `content.mjs`, not the template: `作者微信 TZ857886159；GitHub Issue 只提交非保密摘要。` Add the English equivalent: `The public issue should contain only a non-confidential summary.`

- [x] **Step 3: Add a renderer that only composes existing classes**

Insert before `renderClosing`:

```js
function renderCommunity(content, shared) {
  const cards = content.community.cards.map((card) => {
    const primaryHref = shared[card.primary.target]
    const secondaryHref = shared[card.secondary.target]
    if (!primaryHref || !secondaryHref) throw new Error(`Unknown community target: ${card.id}`)
    return `<article class="path" data-community-card="${escapeAttr(card.id)}">
        <span class="path-number">${escapeText(card.kicker)}</span>
        <h3>${escapeText(card.title)}</h3>
        <p class="path-description">${escapeText(card.description)}</p>
        <div class="service-list">
          <a class="service" href="${escapeAttr(primaryHref)}" ${externalAttrs}><span>${escapeText(card.primary.label)}</span><span>${escapeText(card.primary.code)}</span></a>
          <a class="service" href="${escapeAttr(secondaryHref)}" ${externalAttrs}><span>${escapeText(card.secondary.label)}</span><span>${escapeText(card.secondary.code)}</span></a>
        </div>
      </article>`
  }).join('')
  return `<section id="community" class="paths-section" aria-labelledby="community-title">
  <div class="shell">
    <div class="paths-head"><h2 id="community-title">${escapeText(content.community.titleLead)}<br /><em>${escapeText(content.community.titleEmphasis)}</em></h2><p>${escapeText(content.community.description)}</p></div>
    <div class="paths">${cards}</div>
  </div>
</section>`
}
```

- [x] **Step 4: Place the existing-design section without changing section order elsewhere**

Inside `<main>`, render it after the team paths and before the current closing:

```js
${renderPaths(content, runtimeFacts)}
${renderCommunity(content, runtimeFacts)}
${renderClosing(content, runtimeFacts, locale)}
```

- [x] **Step 5: Generate the two static pages**

Run:

```bash
pnpm run build:site
```

Expected: `marketing/index.html` and `marketing/en/index.html` are rewritten, and the built-in `--check` phase exits 0.

- [x] **Step 6: Confirm the static contract now advances to README failures**

Run:

```bash
node tests/ux/marketing-home.static.mjs
```

Expected: website conversion assertions pass; the command fails at the first missing README first-screen conversion label.

- [x] **Step 7: Commit content and generated output**

```bash
git add scripts/marketing/content.mjs scripts/marketing/template.mjs marketing/index.html marketing/en/index.html
git commit -m "feat(marketing): restore community and direct business paths"
```

---

### Task 4: Restore README conversion links without deleting current content

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Test: `tests/ux/marketing-home.static.mjs`

- [x] **Step 1: Restore the Chinese first-screen actions**

Replace the current first-screen link line with:

```markdown
[English](README.md) · [官网](https://nomiaqm.com/) · [下载](https://github.com/aqm857886159/Nomi/releases/latest) · [夸克网盘镜像](https://pan.quark.cn/s/d3322c17e7b6) · [加入用户群](#用户群) · [团队合作](#团队服务) · [看 60 秒宣传片](https://nomiaqm.com/assets/demo.mp4)
```

Do not delete the existing download table, first-launch warning, team section, user-group section, author QR, license text, or developer commands.

- [x] **Step 2: Strengthen the existing Chinese team paragraph in place**

Replace the one-line introduction immediately under `## 团队服务` with:

```markdown
如果你想把 Nomi 变成内部 AI 视频工作台、客户项目、垂直行业流程或贴牌产品，我们可以从首次验证一直做到上线后的持续迭代：
```

Keep the existing four-item list. Keep both the Business Inquiry and `TZ857886159`; append a direct maintainer-QR link:

```markdown
[提交商务咨询](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml)，或添加作者微信 **TZ857886159**（[查看个人微信二维码](docs/media/qingyang-wechat.jpg)）。GitHub Issue 是公开页面，请勿填写密钥、私人联系方式、预算明细或受 NDA 保护的材料。
```

- [x] **Step 3: Restore the English first-screen Community action**

Replace the current first-screen link line with:

```markdown
[简体中文](README.zh-CN.md) · [Website](https://nomiaqm.com/en/) · [Download](https://github.com/aqm857886159/Nomi/releases/latest) · [Community](https://github.com/aqm857886159/Nomi/discussions) · [For Teams](https://nomiaqm.com/en/#teams) · [Watch the 60s film](https://nomiaqm.com/assets/video/launch-film-en.mp4) · [Documentation](docs/user-guide.md)
```

- [x] **Step 4: Add an international Community section without forcing WeChat**

Insert before `## For Teams`:

```markdown
## Community

Join [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions) to share workflows, report friction, and follow what is being built next. WeChat users can also find the Nomi group and maintainer QR codes in the [Chinese README](README.zh-CN.md#用户群).
```

Keep the current `## For Teams`, Contributing links, and License Business Inquiry.

- [x] **Step 5: Run the full static site contract green**

Run:

```bash
pnpm run check:site
```

Expected:

```text
MARKETING SITE CHECK PASS
MARKETING HOME STATIC PASS
```

- [x] **Step 6: Commit the README preservation change and red-contract test together**

```bash
git add README.md README.zh-CN.md tests/ux/marketing-home.static.mjs
git commit -m "docs(marketing): preserve README conversion channels"
```

---

### Task 5: Extend real-browser protection and inspect the unchanged visual language

**Files:**

- Modify: `tests/ux/marketing-home.visual.mjs`
- Generate but do not commit: `tests/ux/_marketing/home-*.png`

- [x] **Step 1: Add community facts to every standard browser case**

Extend the `facts` object in `auditStandardCase` with:

```js
    community: Boolean(document.querySelector('#community')),
    communityNav: Boolean(document.querySelector('a.nav-link[href="#community"]')),
    communityCards: document.querySelectorAll('[data-community-card]').length,
    groupQrLink: Boolean(document.querySelector('a[href="/assets/group-wechat.png"]')),
    authorQrLink: Boolean(document.querySelector('a[href="/assets/qingyang-wechat.jpg"]')),
    businessLink: Boolean(document.querySelector('a[href*="business_inquiry.yml"]')),
    discussionsLink: Boolean(document.querySelector('a[href*="/discussions"]')),
    wechatText: (document.body.textContent || '').includes('TZ857886159'),
```

Add these assertions after the existing product/teams assertion:

```js
  assert(facts.community && facts.communityNav && facts.communityCards === 2, `${testCase.name}: existing-design community section`)
  assert(facts.groupQrLink && facts.authorQrLink && facts.businessLink, `${testCase.name}: durable conversion destinations`)
  if (testCase.path === '/en/') assert(facts.discussionsLink, `${testCase.name}: international community destination`)
  if (testCase.path === '/') assert(facts.wechatText, `${testCase.name}: direct Chinese contact remains textual`)
```

- [x] **Step 2: Protect the no-JavaScript journey**

In `auditNoJavaScript`, count `#community`, the business link, and the locale-appropriate text destination. Assert all remain available next to the existing download/film check:

```js
  const community = await page.locator('#community').count()
  const business = await page.locator('a[href*="business_inquiry.yml"]').count()
  assert(community === 1 && business > 0, `${locale}: no-JS conversion paths remain`)
```

- [x] **Step 3: Protect resource-failure fallbacks**

Extend `auditBlockedMedia` facts with `community`, `business`, `discussions`, and `wechatText`; then assert the English Community/Discussions and For Teams/Business Inquiry paths survive even when fonts and videos are blocked.

Use this exact assertion:

```js
  assert(facts.community && facts.business && facts.discussions, 'blocked media: community and business paths remain usable')
```

- [x] **Step 4: Run the full visual matrix**

Run:

```bash
pnpm run test:site:visual
```

Expected: `MARKETING HOME VISUAL PASS` with new assertions passing for all five standard viewports and all failure-mode journeys.

- [x] **Step 5: Inspect every regenerated screenshot**

Open these files with human vision:

```text
tests/ux/_marketing/home-zh-desktop.png
tests/ux/_marketing/home-en-desktop.png
tests/ux/_marketing/home-zh-mobile.png
tests/ux/_marketing/home-en-mobile.png
tests/ux/_marketing/home-en-320.png
tests/ux/_marketing/home-reduced-motion.png
tests/ux/_marketing/home-blocked-media.png
```

Acceptance: the original typography, warm-paper/dark-section palette, path-card borders, button shapes, proof layout, and mobile stacking remain unchanged; only copy, links, and one additional section composed from existing path cards appear. Reject any new QR card, contact card, coral band, gradient, or layout language.

- [x] **Step 6: Verify the stylesheet was never modified**

Run:

```bash
git diff --exit-code origin/main...HEAD -- scripts/marketing/styles.mjs
```

Expected: exit 0 with no output.

- [x] **Step 7: Commit the browser guard**

```bash
git add tests/ux/marketing-home.visual.mjs
git commit -m "test(marketing): verify community conversion journeys"
```

---

### Task 6: Record evidence, integrate on latest main, deploy, and verify production

**Files:**

- Modify: `docs/superpowers/specs/2026-08-01-nomi-conversion-preservation-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-nomi-conversion-preservation.md`

- [x] **Step 1: Run focused website verification**

```bash
pnpm run test:site
pnpm run test:site:visual
node scripts/build-marketing-site.mjs --check
git diff --check
```

Expected: both site suites pass, generated output is current, and there are no whitespace errors.

- [x] **Step 2: Run the complete repository gate**

```bash
pnpm run gates
```

Expected: filesize, tokens, dangling tokens, archetype defaults, secrets, i18n, marketing site, lint ratchet, typecheck, all Vitest tests, renderer build, and Electron build pass.

- [x] **Step 3: Append evidence and check only completed boxes**

Update the spec state to `已实施并验证`. Append an evidence block containing the exact site-test results, screenshot paths, stylesheet byte-identity check, full-gate result, final commit, Cloudflare check, and live HTTP checks. Convert plan checkboxes only after each action has actually happened.

- [x] **Step 4: Commit verification evidence**

```bash
git add docs/superpowers/specs/2026-08-01-nomi-conversion-preservation-design.md docs/superpowers/plans/2026-08-01-nomi-conversion-preservation.md
git commit -m "docs(marketing): record conversion recovery evidence"
```

- [x] **Step 5: Integrate onto the newest remote main**

From the primary repository: fetch `origin/main`; create a fresh detached sibling worktree at that commit; cherry-pick this plan's commits in order; link the existing `node_modules`; run `pnpm run gates`; fetch again; require `git merge-base --is-ancestor origin/main HEAD` to exit 0.

- [x] **Step 6: Push and verify the deployment chain**

```bash
git push origin HEAD:main
```

Poll the final commit's GitHub check runs until `Workers Builds: nomi`, `Quality Gate`, and `Mac Package` all complete successfully. Do not claim production complete while Cloudflare is still in progress.

- [x] **Step 7: Verify the live bilingual conversion paths**

Check `https://nomiaqm.com/` and `https://nomiaqm.com/en/` from the live domain. Require:

```text
Chinese: #community, 社群, TZ857886159, group-wechat.png, qingyang-wechat.jpg,
         定制开发, 系统与模型集成, 贴牌交付与商业授权, 持续优化、维护与迭代
English: #community, Community, GitHub Discussions, Business Inquiry,
         Custom builds, Integrations, White-label, Ongoing iteration
Assets:  group QR, author QR, Chinese film, English film, hero loop all return HTTP 200
```

Remove only the clean temporary integration worktree after `origin/main` equals the pushed final SHA. Preserve the design/spec worktree until the final handoff.

---

## Final acceptance checklist

- [x] Current homepage visual design and `scripts/marketing/styles.mjs` are unchanged.
- [x] Chinese homepage restores community, group QR, maintainer QR, textual WeChat ID, and Business Inquiry.
- [x] English homepage exposes Discussions and Business Inquiry while keeping WeChat secondary.
- [x] Four paid service categories remain explicit in both languages.
- [x] Chinese README first screen includes download, Quark mirror, community, and team conversion actions.
- [x] Chinese README retains the group QR, maintainer QR, WeChat ID, team services, and commercial-license contact.
- [x] English README first screen includes Community and For Teams, with durable Discussions and Business Inquiry links.
- [x] Static contracts fail if any protected conversion path disappears.
- [x] Desktop, 390 px, 320 px, no-JS, reduced-motion, and blocked-media browser journeys pass and are visually inspected.
- [x] Focused site tests, full gates, newest-main integration gates, Cloudflare deployment, GitHub checks, and live-domain checks all pass.
