import { contentByLocale } from './content.mjs'
import { homepageClientJs } from './client.mjs'
import { downloadUrls } from './downloads.mjs'
import { buildMetadata } from './metadata.mjs'
import { homepageCss } from './styles.mjs'

const escapeText = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const escapeAttr = (value) => escapeText(value)
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const externalAttrs = 'target="_blank" rel="noreferrer"'

function renderMetadata(metadata) {
  const alternates = metadata.alternates
    .map(({ lang, href }) => `<link rel="alternate" hreflang="${escapeAttr(lang)}" href="${escapeAttr(href)}" />`)
    .join('\n')
  const jsonLd = JSON.stringify(metadata.jsonLd).replaceAll('<', '\\u003c')
  return `<title>${escapeText(metadata.title)}</title>
<meta name="description" content="${escapeAttr(metadata.description)}" />
<link rel="canonical" href="${escapeAttr(metadata.canonical)}" />
${alternates}
<meta property="og:type" content="website" />
<meta property="og:locale" content="${escapeAttr(metadata.openGraph.locale)}" />
<meta property="og:title" content="${escapeAttr(metadata.openGraph.title)}" />
<meta property="og:description" content="${escapeAttr(metadata.openGraph.description)}" />
<meta property="og:url" content="${escapeAttr(metadata.canonical)}" />
<meta property="og:image" content="${escapeAttr(metadata.openGraph.image)}" />
<meta property="og:image:alt" content="${escapeAttr(metadata.openGraph.imageAlt)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeAttr(metadata.openGraph.title)}" />
<meta name="twitter:description" content="${escapeAttr(metadata.openGraph.description)}" />
<meta name="twitter:image" content="${escapeAttr(metadata.openGraph.image)}" />
<script type="application/ld+json">${jsonLd}</script>`
}

function renderNav(content, shared, locale) {
  const isChinese = locale === 'zh-CN'
  return `<nav class="nav shell" aria-label="${escapeAttr(content.nav.ariaLabel)}">
  <a class="brand" href="${escapeAttr(content.path)}" aria-label="Nomi">
    <img class="brand-logo" src="/assets/nomi-logo.svg" width="28" height="28" alt="" />
    <span>Nomi</span>
  </a>
  <a class="nav-link" href="#product">${escapeText(content.nav.product)}</a>
  <a class="nav-link" href="#teams">${escapeText(content.nav.teams)}</a>
  <a class="nav-link" href="#community">${escapeText(content.nav.community)}</a>
  <a class="nav-link" href="${escapeAttr(content.nav.docsHref)}">${escapeText(content.nav.docs)}</a>
  <a class="nav-link" href="${escapeAttr(shared.repositoryUrl)}" ${externalAttrs}>GitHub</a>
  <span class="locale" aria-label="${escapeAttr(content.a11y.currentLocale)}">
    <a href="/" data-locale-choice="zh-CN"${isChinese ? ' aria-current="page"' : ''}>中文</a>
    <span aria-hidden="true">/</span>
    <a href="/en/" data-locale-choice="en"${isChinese ? '' : ' aria-current="page"'}>EN</a>
  </span>
  <a class="button button--coral" data-download-nomi href="${escapeAttr(shared.releaseUrl)}" ${externalAttrs}>
    <span>${escapeText(content.nav.download)}</span><span aria-hidden="true">↘</span>
  </a>
</nav>`
}

function renderHero(content, shared) {
  const filmHref = content.htmlLang === 'en' ? '/assets/video/launch-film-en.mp4' : '/assets/demo.mp4'
  return `<section id="top" class="hero shell">
  <div class="hero-copy" data-reveal>
    <div>
      <p class="eyebrow">${escapeText(content.hero.eyebrow)}</p>
      <h1>${escapeText(content.hero.titleLead)}<em>${escapeText(content.hero.titleEmphasis)}</em></h1>
      <p class="lede">${escapeText(content.hero.lede)}</p>
      <div class="actions">
        <a class="button button--coral" data-download-nomi href="${escapeAttr(shared.releaseUrl)}" ${externalAttrs}><span>${escapeText(content.hero.download)}</span><span aria-hidden="true">↘</span></a>
        <a class="button button--ghost" href="${filmHref}" data-open-film><span>${escapeText(content.hero.watch)}</span><span aria-hidden="true">▶</span></a>
      </div>
      <p class="no-js-fallback">${escapeText(content.hero.watch)} · MP4</p>
    </div>
    <div class="hero-note"><span>${escapeText(content.hero.sequenceLabel)}</span><span>01 / 06</span></div>
  </div>
  <figure class="monitor" style="--delay:.12s" data-reveal>
    <div class="monitor-top"><span>${escapeText(content.hero.monitorLabel)}</span><span>${escapeText(content.hero.monitorTimecode)}</span></div>
    <div class="monitor-frame">
      <video data-hero-video autoplay muted loop playsinline preload="metadata" poster="/assets/video/hero-poster.jpg" aria-label="${escapeAttr(content.hero.videoLabel)}">
        <source src="/assets/video/hero-loop.mp4" type="video/mp4" />
      </video>
    </div>
    <figcaption class="monitor-caption"><span>${escapeText(content.hero.monitorCaption)}</span><span>16:09 · LIVE</span></figcaption>
  </figure>
</section>`
}

function renderProofs(content) {
  const proofs = content.proofs.map((proof) => {
    const chapter = proof.chapter.split(' ').map(escapeText).join('<br />')
    const tags = proof.tags.map((tag) => `<span class="tag">${escapeText(tag)}</span>`).join('')
    return `<article class="proof" id="proof-${escapeAttr(proof.id)}" data-proof="${escapeAttr(proof.id)}">
  <div class="chapter"><strong>${escapeText(proof.number)}</strong><span>${chapter}</span></div>
  <figure class="proof-media"><img src="${escapeAttr(proof.image)}" alt="${escapeAttr(proof.imageAlt)}" width="1600" height="900" /></figure>
  <div class="proof-copy"><h3>${escapeText(proof.title)}</h3><p>${escapeText(proof.description)}</p><div class="proof-tags">${tags}</div></div>
</article>`
  }).join('\n')

  const introLead = content.htmlLang === 'en' ? 'Not more buttons.' : '不是更多按钮。'
  const introMiddle = content.htmlLang === 'en' ? 'A way for every shot to' : '是让每个镜头'
  const introEmphasis = content.htmlLang === 'en' ? 'inherit the same world.' : '继承同一个世界。'
  const emphasisSpacing = content.htmlLang === 'en' ? ' ' : ''
  return `<section id="product" class="intro shell">
  <p class="section-kicker">02 / PRODUCT PROOF</p>
  <h2>${escapeText(introLead)}<br />${escapeText(introMiddle)}${emphasisSpacing}<em>${escapeText(introEmphasis)}</em></h2>
</section>
<div class="shell">${proofs}</div>`
}

function renderPaths(content, shared) {
  const openLinks = [
    { title: content.paths.open.actions[0], code: 'RELEASES', href: shared.releaseUrl },
    { title: content.paths.open.actions[1], code: 'GITHUB', href: shared.repositoryUrl },
    { title: content.paths.open.actions[2], code: 'DOCS', href: content.nav.docsHref },
  ]
  const openRows = openLinks.map((item, index) => `<a class="service"${index === 0 ? ' data-download-nomi' : ''} href="${escapeAttr(item.href)}"><span>${escapeText(item.title)}</span><span>${item.code}</span></a>`).join('')
  const services = content.paths.teams.services.map((service) => `<div class="service" data-service="${escapeAttr(service.id)}"><span>${escapeText(service.title)}</span><span>${escapeText(service.code)}</span></div>`).join('')
  return `<section id="teams" class="paths-section">
  <div class="shell">
    <div class="paths-head"><h2>${escapeText(content.paths.titleLead)}<br /><em>${escapeText(content.paths.titleEmphasis)}</em></h2><p>${escapeText(content.paths.description)}</p></div>
    <div class="paths">
      <article class="path">
        <span class="path-number">${escapeText(content.paths.open.kicker)}</span>
        <h3>${escapeText(content.paths.open.title)}</h3>
        <p class="path-description">${escapeText(content.paths.open.description)}</p>
        <div class="service-list">${openRows}</div>
        <div class="path-actions"><a class="button button--coral" data-download-nomi href="${escapeAttr(shared.releaseUrl)}" ${externalAttrs}><span>${escapeText(content.paths.open.download)}</span><span aria-hidden="true">↘</span></a></div>
      </article>
      <article class="path">
        <span class="path-number">${escapeText(content.paths.teams.kicker)}</span>
        <h3>${escapeText(content.paths.teams.title)}</h3>
        <p class="path-description">${escapeText(content.paths.teams.description)}</p>
        <p class="path-description">${escapeText(content.paths.teams.wechatLabel)} · ${escapeText(shared.wechatId)}</p>
        <div class="service-list">${services}</div>
        <div class="path-actions">
          <a class="button button--ink" href="${escapeAttr(shared.businessUrl)}" ${externalAttrs}><span>${escapeText(content.paths.teams.discuss)}</span><span aria-hidden="true">↗</span></a>
          <a class="button" href="${escapeAttr(shared.authorQr)}" ${externalAttrs}><span>${escapeText(content.paths.teams.wechat)}</span><span aria-hidden="true">↗</span></a>
        </div>
      </article>
    </div>
  </div>
</section>`
}

function renderCommunity(content, shared) {
  const cards = content.community.cards.map((card) => {
    const primaryHref = shared[card.primary.target]
    const secondaryHref = shared[card.secondary.target]
    if (!primaryHref || !secondaryHref) throw new Error(`Unknown community target: ${card.id}`)
    const contact = card.id === 'author' ? ` ${content.community.contactLabel} · ${shared.wechatId}` : ''
    return `<article class="path" data-community-card="${escapeAttr(card.id)}">
        <span class="path-number">${escapeText(card.kicker)}</span>
        <h3>${escapeText(card.title)}</h3>
        <p class="path-description">${escapeText(card.description)}${escapeText(contact)}</p>
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

function renderClosing(content, shared, locale) {
  const localeHref = locale === 'zh-CN' ? '/en/' : '/'
  return `<section class="closing shell">
  <div class="closing-grid">
    <div>
      <p class="section-kicker">${escapeText(content.closing.kicker)}</p>
      <h2>${escapeText(content.closing.titleLead)}<br /><em>${escapeText(content.closing.titleEmphasis)}</em></h2>
      <div class="closing-actions">
        <a class="button button--ink" data-download-nomi href="${escapeAttr(shared.releaseUrl)}" ${externalAttrs}><span>${escapeText(content.closing.download)}</span><span aria-hidden="true">↘</span></a>
        <a class="button" href="${escapeAttr(shared.repositoryUrl)}" ${externalAttrs}>${escapeText(content.closing.github)} <span aria-hidden="true">↗</span></a>
      </div>
    </div>
    <img class="mascot" src="/assets/mascot.png" alt="${escapeAttr(content.closing.mascotAlt)}" width="512" height="512" loading="lazy" />
  </div>
  <footer class="footer">
    <span>© 2026 NOMI · <a href="${escapeAttr(shared.licenseUrl)}" ${externalAttrs}>${escapeText(shared.licenseName)}</a></span>
    <span>${escapeText(content.footer.historical)}</span>
    <span>${escapeText(content.footer.privacy)}</span>
    <a href="${localeHref}" data-locale-choice="${locale === 'zh-CN' ? 'en' : 'zh-CN'}">${escapeText(content.footer.locale)}</a>
  </footer>
</section>`
}

function renderFilmDialog(content) {
  const isEnglish = content.htmlLang === 'en'
  const source = isEnglish ? '/assets/video/launch-film-en.mp4' : '/assets/demo.mp4'
  const track = isEnglish ? '/assets/video/launch-film-en.vtt' : '/assets/video/launch-film-zh.vtt'
  const trackLang = isEnglish ? 'en' : 'zh-CN'
  const trackLabel = isEnglish ? 'English' : '简体中文'
  return `<dialog id="launch-film" aria-labelledby="film-title">
  <div class="dialog-head"><span id="film-title">${escapeText(content.a11y.filmTitle)} · 60S</span><button type="button" data-close-film aria-label="${escapeAttr(content.a11y.closeFilm)}">ESC / CLOSE</button></div>
  <video controls preload="metadata" poster="/assets/video/hero-poster.jpg">
    <source src="${source}" type="video/mp4" />
    <track kind="captions" srclang="${trackLang}" label="${trackLabel}" src="${track}" default />
  </video>
</dialog>`
}

export function renderHomepage(locale, runtimeFacts) {
  const content = contentByLocale[locale]
  if (!content) throw new Error(`Unknown marketing locale: ${locale}`)
  const metadata = buildMetadata(locale, content, runtimeFacts)
  return `<!doctype html>
<html lang="${escapeAttr(content.htmlLang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${renderMetadata(metadata)}
<link rel="icon" type="image/svg+xml" href="/assets/nomi-logo.svg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Noto+Serif+SC:wght@400;600;900&display=swap" />
<style>${homepageCss}</style>
</head>
<body>
<header class="site-head">
${renderNav(content, runtimeFacts, locale)}
${renderHero(content, runtimeFacts)}
</header>
<div class="ticker" aria-hidden="true"><div class="ticker-inner shell"><span>STORY → STORYBOARD → CANVAS</span><i class="ticker-dot"></i><span>VISUAL ANCHORS → CONSISTENT WORLD</span><i class="ticker-dot"></i><span>MCP → SKILLS → EDITABLE FIRST CUT</span></div></div>
<main>
${renderProofs(content)}
${renderPaths(content, runtimeFacts)}
${renderCommunity(content, runtimeFacts)}
${renderClosing(content, runtimeFacts, locale)}
</main>
${renderFilmDialog(content)}
<script>${homepageClientJs(downloadUrls)}</script>
</body>
</html>
`
}
