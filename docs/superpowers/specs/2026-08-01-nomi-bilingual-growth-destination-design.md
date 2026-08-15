# Nomi 双语增长入口设计规格

日期：2026-08-01
状态：已实施并验证
范围：官网首页、仓库 README、商务咨询入口与发布资产映射

## 1. 目标与底层逻辑

Nomi 需要同时服务两类访问者：想立即下载开源工具的创作者，以及想购买定制开发、系统集成、贴牌交付或持续迭代服务的团队。当前官网只有中文，README 主体也只有中文；官网和结构化数据还残留 Apache-2.0 描述，与仓库当前的 AGPL-3.0-only 不一致。这会让国际访问者看不懂价值，也会让潜在客户无法判断如何合作。

本项目要建立一个可推广、可搜索、可转化的双语入口：中文与英文各自有完整静态页面和元数据，但从同一份内容结构生成；开源下载始终是主路径，商业服务是清楚但克制的第二路径。推广内容只有在这个入口完成后再放大，避免把流量送到一个语言、许可证和行动按钮互相冲突的页面。

成功标准：

- 英文访问者在首屏 10 秒内理解 Nomi 是什么、与普通提示词生成器的差异、下一步如何下载。
- 企业访问者不需要翻阅 README，就能看到四类可购买服务和明确的咨询入口。
- 中文与英文页面拥有各自的可索引文本、标题、描述、OG 信息、结构化数据和 canonical URL。
- 网站、README 与 package metadata 对当前许可证的表述一致：当前版本为 AGPL-3.0-only，历史版本的 Apache-2.0 授权不追溯改变。
- 无 JavaScript、动画库加载失败、开启减少动态效果或本地存储不可用时，核心内容与导航仍可使用。

## 2. 已选方案与不选方案

采用方案 B：由一个构建脚本和一份双语内容模型生成两张独立静态首页。

- `https://nomiaqm.com/`：简体中文，`lang="zh-CN"`。
- `https://nomiaqm.com/en/`：英文，`lang="en"`。
- 两页共享同一套版式、视觉组件、事实字段和资产，只替换语言文案与语言相关元数据。
- 首次访问根路径时，如果没有保存过语言偏好且浏览器首选语言以 `en` 开头、同时没有中文偏好，使用一段很小的同源脚本跳转到 `/en/`；语言切换器的显式选择写入 `localStorage`。脚本或存储失败时，根路径保持中文，静态语言链接仍然工作。

不采用单页运行时翻译，因为爬虫、分享卡片和无脚本访问得到的英文内容不可靠。不采用手工维护两份完整 HTML，因为当前首页已超过 1600 行，复制后许可证、CTA 和产品事实必然再次漂移。

## 3. 信息架构

### 3.1 全局导航

导航保持低密度，只保留有行动价值的入口：

- Nomi 标识，返回当前语言首页。
- Product / 产品：滚动到四段产品证据。
- For Teams / 团队服务：滚动到商业服务区。
- Docs / 文档：中文指向中文快速开始，英文指向英文 README 的 Quick start 锚点。
- GitHub：打开仓库。
- 中文 / EN：显式语言切换，当前语言有可读状态，不只依赖颜色。
- Download / 下载：导航右侧主按钮，指向 GitHub Releases latest。

移动端不做隐藏抽屉菜单。保留标识、语言切换和 Download 三个首要动作，其余入口在页面内自然出现，减少一次额外点击。

### 3.2 Hero

中文主张：`把镜头讲清楚，不让模型猜。`
英文主张：`Direct the shot. Not just the prompt.`

副文案只解释一个差异：Nomi 把故事、分镜、视觉锚点、画布生成和时间线放在同一个本地工作流中，让人物、场景和镜头意图持续连接。首屏不罗列模型名单或长功能表。

行动按钮：

1. 主按钮 Download Nomi / 下载 Nomi，进入最新 Release。
2. 次按钮 Watch the 60s film / 看 60 秒宣传片，在当前页面打开原生 `<dialog>` 影片层；无 JavaScript 时退化为直接视频链接。

Hero 的主要视觉不是吉祥物大图，而是 15 秒静音循环产品影片。视频必须 `autoplay muted loop playsinline`，提供 poster，并尊重 `prefers-reduced-motion`：减少动态效果时只显示 poster，不自动播放。吉祥物作为品牌签名保留在收尾区，不与产品证据争夺首屏注意力。

### 3.3 四段产品证据

每段由一个真实产品画面、一句结果导向标题和不超过两句说明组成。顺序遵循创作摩擦，而不是模块目录：

1. Connected context / 上下文持续连接：故事、分镜和生成不再在不同工具间断裂。
2. Lock the world first / 先锁定世界：人物、场景、道具与风格先成为可复用视觉锚点，减少跨镜漂移。
3. Direct on canvas / 在画布上导演：在全局序列中摆素材、写提示词、调用生成，而不是反复重开提示词窗口。
4. One sentence to an editable first cut / 一句话推进到可编辑初稿：Claude Code、Codex、Cursor 等 AI 助手可通过 Nomi MCP 调用 Skills，建立项目、生成分镜、连接参考并触发已配置模型，把一句镜头意图推进成 Nomi 中可继续导演和编辑的初稿。

第四段不是承诺“输入一句话就自动得到无需修改的商业成片”。Nomi 的真实机制是 AI 助手通过能力核执行受权限约束的画布与生成操作，创作者仍然检查参考、选择结果、调整镜头并决定最终导出。传播语可以使用“从一句话开始”，结果必须落在“可编辑初稿 / editable first cut”，不能写成全自动、零确认或必然达到大片质量。

画面必须来自当前 Nomi 实际界面或宣传片中的真实录屏，不使用生成式伪 UI。桌面端交替错位排版，移动端统一为标题在上、16:9 画面在中、说明在下；任何裁切都不能隐藏实际产品任务。

### 3.4 开源与商业双路径

这一段用同一水平基线上的两列表达，不把商业服务伪装成开源功能，也不让企业 CTA 压过下载。

Open Source for Creators / 面向创作者的开源版：

- 当前版本 AGPL-3.0-only。
- 本地优先，项目和素材保存在用户电脑上。
- Download、View source、Read docs 三个动作。

For Teams / 团队服务：

- Custom builds / 定制开发。
- Integrations / 系统与模型集成。
- White-label / 贴牌交付与商业授权。
- Ongoing iteration / 持续优化、维护与迭代。
- 主动作 Discuss a project / 沟通项目。

国际版咨询暂时进入 GitHub `business_inquiry.yml` Issue Form。表单明确说明 Issue 是公开页面，禁止填写保密材料、密钥、预算明细或私人联系方式；访问者只提交非保密的项目摘要和合作类型，后续由维护者回复下一步渠道。中文版同时提供微信 `TZ857886159`，并保留同一个 Issue Form 作为不使用微信的入口。没有用户确认的公开商务邮箱前，不在页面中虚构邮箱。

### 3.5 收尾

收尾只重复一次品牌承诺、下载和 GitHub Star，不再堆一组功能卡。页脚包含：当前许可证、历史许可证说明链接、GitHub、中文/EN、隐私事实“无网站账户、无产品素材上传到 Nomi 服务器”。这句话只描述 Nomi 产品与本次静态站点；不扩张成未经验证的第三方模型隐私承诺。

## 4. 视觉与交互方向

保留现有官网最有辨识度的暖纸、墨黑与珊瑚色体系，方向为“导演工作台的编辑样张”，不是通用 SaaS 落地页。

- 暖纸色为主场，深色 Hero 像片场监看器，珊瑚色只用于导演框、进度线和主要动作。
- 顶栏、分享图与需要品牌识别的区域直接复用 `marketing/assets/nomi-logo.svg`；该 SVG 与 `src/design/identity.tsx` 的 `NomiLogoMark` 使用同一 28×28 几何。禁止继续使用样张早期的珊瑚菱形占位标或任何生成式假 Logo。
- 标题使用有编辑感的衬线字体，正文使用高可读无衬线，时间码和章节编号使用等宽字体。
- 产品画面以接触表、章节编号、时间码和细规则线组织，不使用紫色渐变、玻璃拟态、发光按钮或均匀卡片墙。
- 页面只有一套有叙事作用的入场节奏；滚动后以轻微位移和显露为主。减少动态效果时所有内容直接稳定显示。
- 语言切换、按钮、视频控制和 dialog 全部可键盘操作；焦点样式可见，正文与背景满足 WCAG AA 对比度。
- 桌面目标宽度 1440 px，移动目标宽度 390 px；在 320 px 宽度仍无横向滚动、孤字或按钮截断。

## 5. 静态生成架构

构建源文件放在 `scripts/marketing/`，不放进 Cloudflare 直接发布的 `marketing/` 目录：

- `scripts/marketing/content.mjs`：中英文文案、公共事实、链接、许可证和服务项目的唯一内容源。
- `scripts/marketing/template.mjs`：纯函数页面模板；接收 locale 和内容对象，输出完整 HTML。
- `scripts/marketing/metadata.mjs`：按 locale 生成 title、description、canonical、hreflang、Open Graph、Twitter Card 与 JSON-LD。
- `scripts/build-marketing-site.mjs`：生成 `marketing/index.html` 与 `marketing/en/index.html`；支持普通写入和 `--check` 漂移检查。

输出继续由当前 Cloudflare Static Assets 部署，保留 `html_handling = "auto-trailing-slash"`。构建不引入 React、Next.js 或新的客户端框架。现有 GSAP 滚动动画与两个 vendor 文件在同一提交删除；Hero 只使用 CSS 完成一次短入场，其余内容稳定呈现，不再让页面可读性依赖滚动动画运行时。

站点资产：

- `marketing/assets/video/hero-loop.mp4`：现有 15 秒静音循环的网页交付版，目标不超过 6 MB。
- `marketing/assets/demo.mp4`：保留已经公开使用的 URL，但把文件内容替换为中文宣传片的 720p 网页版，目标不超过 12 MB。
- `marketing/assets/video/launch-film-en.mp4`：从已校对英文母版派生的 720p 网页版，目标不超过 12 MB；原始母版留在本地交付目录，不把高码率源文件塞进仓库。
- `marketing/assets/video/launch-film-zh.vtt` 与 `launch-film-en.vtt`：由已校对 SRT 转为 WebVTT，分别作为影片 dialog 的默认字幕轨；直接打开 MP4 时不承诺浏览器外挂字幕。
- `marketing/assets/video/hero-poster.jpg`：从最终 hero-loop 成片抽取并人工检查。
- `marketing/assets/social-preview-zh.jpg` 与 `social-preview-en.jpg`：1200×630，各自包含本地化主张，不放难以阅读的产品小字。

现有 `demo.mp4` 原路径直接替换为中文宣传片网页版，从而保住 README 已公开的 URL；`demo.gif` 在 poster 引用迁移完成的同一提交删除。仓库不保留旧演示与新宣传片两套并行内容。

## 6. SEO、语言与结构化数据

每个语言页面必须独立输出：

- 唯一 `<title>` 与 meta description。
- 自引用 canonical。
- `hreflang="zh-CN"`、`hreflang="en"` 与 `hreflang="x-default"` 三个 alternate；`x-default` 指向根路径。
- 对应的 `og:locale`、标题、描述与 1200×630 分享图。
- `SoftwareApplication` JSON-LD，`inLanguage` 与页面一致。
- 当前许可证 URL 固定为 GNU AGPL-3.0，不再出现 Apache-2.0 作为当前许可证。历史授权只在人类可读的许可证说明中出现。

`marketing/sitemap.xml` 增加 `/en/`，并更新真实 lastmod。`robots.txt` 继续允许抓取并指向 sitemap。语言识别脚本不依赖 User-Agent，也不阻止搜索引擎读取根页面。

## 7. README 设计

根 `README.md` 改为英文优先，第一屏按以下顺序：

1. 品牌、英文一句话主张与 `简体中文` 链接。
2. Download、Website、60s Film、Documentation、For Teams。
3. 平台、版本与 AGPL-3.0 徽章。
4. 影片 poster，点击进入英文宣传片。
5. Why Nomi：Connected context、Visual anchors、Directable workflow 与 Agentic creation over MCP 四个证据支柱；最后一项明确结果是 editable first cut，最终决定权仍在创作者。
6. Quick start：下载安装、接模型、从故事到时间线。
7. For Teams 与商业授权。
8. Contributing、CLA、License。

新建 `README.zh-CN.md` 承接当前中文用户需要的下载、群聊、国内镜像和微信信息，但删去会快速过期的重复功能墙。两份 README 在顶部互相链接；英文 README 不展示微信群二维码作为主行动，中文 README 把用户群放在 Quick start 之后。

README 不直接嵌入 GIF 自动播放。使用一张经过检查的 poster 链接到官网影片，避免仓库首页加载大体积媒体。产品功能只保留能证明差异的三项，不复制官网所有章节。

## 8. 商务 Issue Form

新增 `.github/ISSUE_TEMPLATE/business_inquiry.yml`，标题前缀固定为 `[Business]`，不依赖仓库中预先存在的标签。字段固定为：

- Collaboration type：Custom build、Integration、White-label / commercial license、Ongoing iteration。
- Organization / project：公开名称，可写 `Undisclosed`。
- Non-confidential summary：需要解决的工作流问题和预期结果。
- Target platform：Desktop、Private deployment、Existing product integration、Other。
- Timing：Exploring、Within 3 months、Within 6 months、No fixed date。
- Public-information confirmation：确认未提交秘密、密钥、私人联系方式或受 NDA 保护的内容。

表单不询问预算，也不要求用户公开邮箱。Issue 打开后由维护者在公开回复中提供下一步私密沟通方式。GitHub 模板选择页增加 `config.yml`，把普通问题引导到 Discussions，把安全问题引导到 GitHub 的私密 Security Advisory 报告入口，明确禁止通过公开 Issue 披露漏洞。

## 9. 数据流与失败退化

构建期数据流：`content.mjs` → locale 校验 → metadata + template → 两份 HTML → 静态测试 → Cloudflare assets。任何 locale 缺少字段、出现未知字段或两个页面的共享事实不一致时，构建直接失败，不输出半成品。

运行期没有 API 和服务端状态：

- 语言切换器是普通链接；localStorage 只是记忆偏好，失败时不影响导航。
- 视频加载失败时保留 poster、标题和直接下载链接。
- dialog 不可用或 JavaScript 被禁用时，Watch 链接直接打开视频资源。
- 字体或其他增强资源失败时，页面不预隐藏；所有文本保持可读。
- 商务表单不可用时，For Teams 区仍显示 GitHub 仓库与中文版微信，不显示死按钮。

## 10. 测试与验收

自动化门：

- `pnpm run build:site` 生成双语页面并执行 `--check`，保证生成文件与内容源一致。
- 静态测试验证两个页面的 `lang`、canonical、hreflang、OG、JSON-LD、许可证、语言切换与 CTA。
- 静态测试扫描官网和两份 README；当前许可证位置不得出现 Apache-2.0，历史授权说明必须同时带“历史版本”语义。
- 内部链接检查确保本地页面、poster、三份视频、分享图与 Issue Form 路径存在。
- 项目既有 `check:filesize`、`check:tokens`、`check:i18n`、lint、typecheck、test、build 全部通过。

真实体验门：

- 使用本地 Cloudflare/Vite 静态入口分别打开 `/` 与 `/en/`。
- 1440×900 与 390×844 两种视口完整截图，逐项和批准样张对账。
- 开启 `prefers-reduced-motion`、禁用 JavaScript、阻断字体与视频资源，各走一次首页主旅程。
- 验证首次英文浏览器跳转、手动切换持久化、浏览器后退与直接访问 `/en/`。
- 播放中文、英文影片并检查字幕、poster、全屏和关闭 dialog。
- 从首页进入 Download、GitHub、Docs 与 Business inquiry，确认无死链。

## 11. 实施边界

本期包含双语首页、双语 README、商务 Issue Form、SEO/分享信息、网页影片资产与发布前文案基础。不包含账户系统、支付、报价器、CRM、网站分析 SDK、博客、完整英文手册或自动发布到外部社交平台。

英文快速开始先由根 README 承担，现有中文 `quickstart.html` 与 `handbook.html` 保持可用但不在本期复制翻译。后续只有当英文用户反馈证明文档深度成为下载后的主要摩擦，才单独为文档国际化立项。

## 12. 发布资产映射

- 官网 Hero：15 秒静音循环。
- GitHub README、GitHub Release、YouTube、Show HN、Product Hunt：英文 16:9 宣传片。
- X：1068×1900 英文安全画幅版。
- Reels、Shorts、TikTok：1080×1920 英文社交版。
- Bilibili、小红书、视频号、抖音：中文 16:9 或 1080×1920 版本，按平台形态选择。

正式推广顺序固定为：增长入口上线并验证 → GitHub Release 与 X → Show HN → 按社区规则分别撰写 Reddit 内容 → Product Hunt 集中发布。商业服务在官网中明确，在 Show HN 与 Reddit 中只作为次要信息，避免把开源发布写成外包广告。

## 13. 实施证据（2026-08-01）

- 已生成并提交两个独立静态路由：`marketing/index.html`（`/`，简体中文）与 `marketing/en/index.html`（`/en/`，英文）。
- 真实浏览器截图保存在忽略目录 `tests/ux/_marketing/`，覆盖中英文桌面端、中英文 390 px 移动端、英文 320 px、减少动态效果以及视频/字体阻断场景；所有截图均已人工查看并与批准样张逐项对账。
- 已提交三支网页影片：`marketing/assets/video/hero-loop.mp4`、`marketing/assets/demo.mp4`、`marketing/assets/video/launch-film-en.mp4`。Hero 为 15 秒、1920×1080、H.264、无音轨；两支宣传片均约 60.096 秒、1280×720、H.264/AAC，且全部低于规格体积上限。
- `pnpm run test:site`：通过；双语生成漂移、首页静态契约与既有快速开始页契约全部通过。
- `pnpm run test:site:visual`：通过；路由、语言偏好、影片弹层、WebVTT、无 JavaScript、减少动态效果、资源阻断与横向溢出矩阵全部通过。
- `pnpm run gates`：在推送前的最新 `origin/main` 集成工作树通过；设计 token 为 `0/0/0/0`，lint 保持 98-warning 棘轮且 0 error，Vitest 为 3381 passed / 1 skipped，前端与 Electron 生产构建通过。
- 已于 2026-08-01 将实现快进推送到 `origin/main`；基线中的小窗圆角问题已由远端先行提交使用现有 `rounded-nomi` 解决，因此集成时没有制造重复修复提交。
