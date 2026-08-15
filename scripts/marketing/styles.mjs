export const homepageCss = `
:root {
  --paper: #f2efe8;
  --paper-2: #ebe7dd;
  --ink: #1a1816;
  --ink-2: #3d3935;
  --muted: #8a8278;
  --rule: #d9d3c5;
  --coral: #e8765a;
  --coral-deep: #c7563d;
  --display: "Instrument Serif", "Noto Serif SC", Georgia, serif;
  --body: "Avenir Next", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, monospace;
  --page: min(1280px, calc(100vw - 64px));
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; background: var(--paper); }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--body); }
a { color: inherit; text-decoration: none; }
button { font: inherit; }
img, video { display: block; max-width: 100%; }
:focus-visible { outline: 2px solid var(--coral); outline-offset: 4px; }
.shell { width: var(--page); margin-inline: auto; }
.mono { font-family: var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.site-head { position: relative; overflow: hidden; background: #222220; color: #f7f3ea; }
.site-head::after { content: ""; position: absolute; inset: 0; border: 1px solid rgba(255,255,255,.07); pointer-events: none; }
.nav { position: relative; z-index: 2; height: 82px; display: flex; align-items: center; gap: 30px; border-bottom: 1px solid rgba(255,255,255,.16); }
.brand { display: flex; align-items: center; gap: 12px; margin-right: auto; font: 24px/1 var(--display); }
.brand-logo { width: 28px; height: 28px; flex: none; }
.nav-link { color: rgba(255,255,255,.68); font-size: 13px; }
.nav-link:hover { color: #fff; }
.locale { display: flex; gap: 6px; align-items: center; color: rgba(255,255,255,.58); font: 11px var(--mono); }
.locale [aria-current="page"] { color: #fff; border-bottom: 1px solid var(--coral); }
.button { min-height: 44px; padding: 0 18px; border: 1px solid currentColor; display: inline-flex; align-items: center; justify-content: center; gap: 18px; font-size: 13px; font-weight: 600; cursor: pointer; transition: transform .18s ease, background .18s ease, color .18s ease; }
.button:hover { transform: translateY(-2px); }
.button--coral { background: var(--coral); border-color: var(--coral); color: #211d1a; }
.button--ghost { color: #f7f3ea; border-color: rgba(255,255,255,.34); }
.button--ink { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.hero { min-height: 680px; padding: 68px 0 56px; display: grid; grid-template-columns: minmax(0, .86fr) minmax(520px, 1.14fr); gap: 68px; align-items: center; }
.hero-copy { align-self: stretch; display: flex; flex-direction: column; justify-content: space-between; padding-bottom: 7px; }
.eyebrow { margin: 0 0 74px; color: var(--coral); font: 10px var(--mono); letter-spacing: .14em; }
h1 { max-width: 650px; margin: 0; font: 400 clamp(64px, 6.8vw, 104px)/.86 var(--display); letter-spacing: -.035em; }
h1 em { display: block; color: var(--coral); font-style: italic; }
.lede { max-width: 520px; margin: 38px 0 32px; color: rgba(255,255,255,.66); font-size: 15px; line-height: 1.75; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; }
.hero-note { margin-top: 66px; display: flex; justify-content: space-between; color: rgba(255,255,255,.38); font: 9px var(--mono); }
.monitor { position: relative; margin: 0; background: #0f0f10; border: 1px solid rgba(255,255,255,.18); padding: 40px 30px 48px; box-shadow: 26px 26px 0 rgba(0,0,0,.12); }
.monitor-top { display: flex; justify-content: space-between; margin-bottom: 26px; color: rgba(255,255,255,.46); font: 9px var(--mono); }
.monitor-frame { position: relative; overflow: hidden; aspect-ratio: 16/10; border: 1px solid rgba(255,255,255,.15); background: #161616; }
.monitor-frame video { width: 100%; height: 100%; object-fit: cover; object-position: center; filter: saturate(.86) contrast(1.03); }
.monitor-frame::after { content: ""; position: absolute; inset: 7%; border: 1px solid rgba(232,118,90,.68); pointer-events: none; }
.monitor-caption { display: grid; grid-template-columns: 1fr auto; gap: 16px; margin-top: 24px; color: rgba(255,255,255,.55); font: 9px/1.6 var(--mono); }
.ticker { background: var(--coral); color: #251f1b; border-top: 1px solid #251f1b; border-bottom: 1px solid #251f1b; }
.ticker-inner { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 20px; font: 9px var(--mono); }
.ticker-dot { width: 5px; height: 5px; background: #251f1b; transform: rotate(45deg); }
.intro { padding: 122px 0 88px; display: grid; grid-template-columns: 180px 1fr; gap: 80px; border-bottom: 1px solid var(--rule); }
.section-kicker { margin: 8px 0 0; color: var(--coral-deep); font: 9px var(--mono); }
h2 { max-width: 970px; margin: 0; font: 400 clamp(54px, 6vw, 90px)/.95 var(--display); letter-spacing: -.03em; }
h2 em { color: var(--coral-deep); font-style: italic; }
.proof { padding: 96px 0; border-bottom: 1px solid var(--rule); display: grid; grid-template-columns: 90px minmax(0, 1.12fr) minmax(300px, .7fr); gap: 46px; align-items: center; }
.proof:nth-child(even) { grid-template-columns: 90px minmax(300px, .7fr) minmax(0, 1.12fr); }
.proof:nth-child(even) .proof-media { grid-column: 3; }
.proof:nth-child(even) .proof-copy { grid-column: 2; grid-row: 1; }
.chapter { align-self: stretch; display: flex; flex-direction: column; justify-content: space-between; color: var(--muted); font: 9px var(--mono); }
.chapter strong { color: var(--coral-deep); font-weight: 500; }
.proof-media { position: relative; margin: 0; border: 1px solid var(--ink); background: var(--paper-2); padding: 13px; box-shadow: 18px 18px 0 var(--paper-2); }
.proof-media img { aspect-ratio: 16/9; width: 100%; height: auto; object-fit: cover; border: 1px solid var(--rule); }
.proof-media::before { content: "REC"; position: absolute; top: 24px; left: 25px; z-index: 1; padding: 5px 7px; background: var(--coral); color: var(--ink); font: 8px var(--mono); }
.proof-copy h3 { margin: 0 0 24px; font: 400 clamp(42px, 4.2vw, 68px)/.95 var(--display); letter-spacing: -.02em; }
.proof-copy p { max-width: 470px; margin: 0; color: var(--ink-2); font-size: 15px; line-height: 1.8; }
.proof-tags { display: flex; gap: 8px; margin-top: 38px; flex-wrap: wrap; }
.tag { border-top: 1px solid var(--rule); padding-top: 9px; min-width: 110px; color: var(--muted); font: 8px var(--mono); }
.paths-section { background: #222220; color: #f7f3ea; padding: 112px 0; }
.paths-head { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-bottom: 64px; align-items: end; }
.paths-head h2 { max-width: 720px; }
.paths-head p { justify-self: end; max-width: 430px; color: rgba(255,255,255,.56); font-size: 14px; line-height: 1.75; }
.paths { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid rgba(255,255,255,.2); }
.path { min-height: 480px; padding: 46px; display: flex; flex-direction: column; }
.path + .path { border-left: 1px solid rgba(255,255,255,.2); background: var(--paper); color: var(--ink); }
.path-number { color: var(--coral); font: 9px var(--mono); }
.path h3 { margin: 42px 0 20px; font: 400 clamp(44px, 4.7vw, 70px)/.93 var(--display); }
.path-description { max-width: 470px; color: rgba(255,255,255,.54); font-size: 14px; line-height: 1.75; }
.path + .path .path-description { color: var(--muted); }
.service-list { margin: 38px 0 44px; border-top: 1px solid currentColor; }
.service { display: flex; justify-content: space-between; gap: 20px; padding: 14px 0; border-bottom: 1px solid currentColor; font-size: 12px; }
.service span:last-child { color: var(--coral-deep); font: 9px var(--mono); }
.path-actions { margin-top: auto; display: flex; gap: 14px; flex-wrap: wrap; }
.closing { padding: 108px 0 42px; }
.closing-grid { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 70px; align-items: end; }
.closing h2 { max-width: 900px; }
.mascot { width: 190px; margin-left: auto; filter: grayscale(.25); }
.closing-actions { margin-top: 50px; display: flex; gap: 12px; }
.footer { margin-top: 90px; padding: 26px 0; border-top: 1px solid var(--ink); display: flex; justify-content: space-between; gap: 20px; color: var(--muted); font: 8px var(--mono); }
dialog { width: min(980px, calc(100vw - 32px)); max-height: calc(100vh - 32px); border: 0; padding: 0; background: #111; color: #fff; box-shadow: 0 30px 90px rgba(0,0,0,.45); }
dialog::backdrop { background: rgba(20,18,16,.78); }
.dialog-head { padding: 13px 16px; display: flex; justify-content: space-between; align-items: center; font: 9px var(--mono); }
.dialog-head button { border: 0; background: none; color: #fff; cursor: pointer; }
dialog video { width: 100%; max-height: calc(100vh - 76px); background: #000; }
.no-js-fallback { margin: 12px 0 0; color: rgba(255,255,255,.6); font-size: 12px; }
html[data-enhanced="true"] .no-js-fallback { display: none; }
[data-reveal] { animation: reveal .7s cubic-bezier(.2,.7,.3,1) both; animation-delay: var(--delay, 0s); }
@keyframes reveal { from { opacity: 0; transform: translateY(20px); } }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
@media (max-width: 900px) {
  :root { --page: min(calc(100% - 34px), 680px); }
  .nav { height: 68px; gap: 12px; }
  .nav-link { display: none; }
  .brand { font-size: 22px; }
  .nav .button { min-height: 36px; padding: 0 12px; font-size: 11px; }
  .hero { min-height: 0; padding: 58px 0 42px; grid-template-columns: 1fr; gap: 42px; }
  .eyebrow { margin-bottom: 44px; }
  h1 { font-size: clamp(58px, 17vw, 82px); }
  .lede { margin-top: 28px; }
  .hero-note { margin-top: 44px; }
  .monitor { padding: 24px 18px 30px; box-shadow: 12px 12px 0 rgba(0,0,0,.12); }
  .ticker-inner span:nth-of-type(2), .ticker-inner span:nth-of-type(3), .ticker-inner .ticker-dot:nth-of-type(2) { display: none; }
  .intro { padding: 82px 0 58px; grid-template-columns: 1fr; gap: 26px; }
  h2 { font-size: clamp(52px, 14vw, 74px); }
  .proof, .proof:nth-child(even) { padding: 62px 0; grid-template-columns: 42px 1fr; gap: 18px; align-items: start; }
  .proof-media, .proof:nth-child(even) .proof-media { grid-column: 1 / -1; grid-row: 2; }
  .proof-copy, .proof:nth-child(even) .proof-copy { grid-column: 2; grid-row: 1; }
  .chapter { grid-column: 1; grid-row: 1; min-height: 135px; }
  .proof-copy h3 { font-size: clamp(42px, 12vw, 58px); }
  .proof-copy p { font-size: 14px; }
  .proof-tags { margin-top: 24px; }
  .paths-section { padding: 76px 0; }
  .paths-head { grid-template-columns: 1fr; gap: 24px; }
  .paths-head p { justify-self: start; }
  .paths { grid-template-columns: 1fr; }
  .path { min-height: 420px; padding: 34px 25px; }
  .path + .path { border-left: 0; border-top: 1px solid rgba(255,255,255,.2); }
  .closing { padding-top: 80px; }
  .closing-grid { grid-template-columns: 1fr; }
  .mascot { width: 120px; margin: 0; }
  .footer { margin-top: 64px; flex-direction: column; }
}
@media (max-width: 360px) {
  :root { --page: calc(100% - 24px); }
  .brand span { display: none; }
  .actions, .closing-actions { flex-direction: column; }
  .button { width: 100%; }
  .proof, .proof:nth-child(even) { grid-template-columns: 34px 1fr; }
  .path { padding-inline: 20px; }
}
`
