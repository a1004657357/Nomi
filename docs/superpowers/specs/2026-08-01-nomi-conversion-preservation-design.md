# Nomi 官网与 README 转化入口保护设计

日期：2026-08-01
状态：已实施并验证
范围：双语官网、双语 README、现有社群与商务转化入口、对应自动化契约

## 1. 问题与底层判断

上一轮官网重构把“减少不必要介绍”错误扩大成了“可以删除用户群入口”。旧版官网的社群导航、用户群说明和二维码整段消失；新版虽保留团队服务，但中文访客只能去公开 GitHub Issue，缺少最顺手的微信直达。README 的中文主体仍保留部分入口，但首屏不再直接露出“进群”，也没有自动化保证这些入口以后不会再次被删。

社群二维码、作者微信、国内下载镜像和商务联系不是普通介绍，它们承担从浏览到行动的转化。页面可以删掉重复功能墙和过期说明，但不能在没有等价替代的情况下删除这些链路。

本次采用用户最终确认的方案 C 修订版：**社群与商务双漏斗，但不重新设计官网**。普通创作者进入社群获取案例、反馈与版本动态；有真实项目的人直接联系作者或提交非保密的商务咨询。两类意图分开表达，同时在官网与 README 中互相可见；所有新增内容只复用当前官网已有的章节标题、双路径卡、细线列表和按钮样式。

## 2. 方案比较与已选方向

| 方案 | 用户看到 | 代价 | 结论 |
|---|---|---|---|
| A：只补回旧社群段 | 页尾重新出现群二维码 | 商务仍只有 GitHub Issue，社群与付费合作断开 | 不选 |
| B：双二维码合并区 | 群二维码与作者微信并排放在一个联系块 | 普通反馈与付费项目混在一起，用户不清楚扫哪个 | 不选 |
| C：现官网设计内恢复双漏斗 | 团队卡增加微信与商务表达；社群内容复用现有双路径卡 | 不创造新视觉，但意图清楚且不丢转化 | **采用** |

## 3. 不可删除的转化契约

以下内容是产品转化基础设施，不再作为“可精简文案”处理。以后如果确需替换，必须在同一提交提供等价或更短的有效路径，并同步更新契约测试。

### 3.1 中文官网

1. 桌面导航包含“社群”锚点；移动导航继续优先 Logo、语言和下载，但页面内必须完整出现社群区。
2. 团队卡永久保留四类服务：定制开发、系统与模型集成、贴牌交付与商业授权、持续优化维护与迭代。
3. 团队卡使用现有按钮/链接样式提供作者个人微信二维码、文字微信号 `TZ857886159` 与 Business Inquiry。任何一个图片加载失败时，文字微信号与 Issue 链接仍可用。
4. 在开源/团队双路径之后、品牌收尾之前，恢复独立 `#community` 章节；该章节只复用当前官网已有的章节标题、`.paths`、`.path`、`.service` 和按钮样式。
5. 社群章节分别链接 `group-wechat.png` 和 `qingyang-wechat.jpg`：群码用于直接加入，个人微信是长期兜底，也可用于商务沟通。二维码通过现有链接打开原图，不新增与当前官网不一致的二维码卡片样式。
6. 不再在正文硬编码“某日之前有效”这类会自然过期的承诺。只说明“群码失效时添加作者微信拉群”；二维码图片自身已有的时间提示不被扩写成长期承诺。

### 3.2 英文官网

1. 保留与中文相同的信息结构和 `#community` 锚点，继续由同一内容模型生成。
2. Community 的主动作是 GitHub Discussions；微信社群作为面向使用 WeChat 访客的次级入口，不假装是全球用户的唯一社区。
3. For Teams 永久保留 Custom builds、Integrations、White-label / commercial license、Ongoing iteration 与 Business Inquiry。
4. 作者微信可以作为次级直接联系方式出现，但英文主 CTA 始终是可公开访问的 Business Inquiry。

### 3.3 中文 README

`README.zh-CN.md` 必须永久保留：

- 首屏的下载、夸克镜像、加入用户群、团队合作和使用指南直达链接。
- 夸克网盘镜像与“最新版以 GitHub Releases / 官网为准”的诚实说明。
- 团队服务四项、Business Inquiry 与文字微信号 `TZ857886159`。
- 用户群章节、`docs/media/nomi-canvas-group-wechat.png` 以及群码失效时添加作者微信的兜底说明。
- 关于作者章节和 `docs/media/qingyang-wechat.jpg`。
- 商业授权段中的微信与 Business Inquiry 联系路径。

### 3.4 英文 README

`README.md` 必须永久保留：

- 首屏的 Download、Community、For Teams、Documentation 与 60s Film。
- Community 主链接至 GitHub Discussions，并提供进入中文社群说明的次级链接。
- Custom builds、Integrations、White-label / commercial license、Ongoing iteration 与 Business Inquiry。
- 商业授权段的 Business Inquiry 联系路径。

英文 README 不把微信二维码放成国际用户的首要行动；这不是删除转化，而是为不同语言保留最低摩擦的有效路径。

## 4. 官网内容调整原则（不重新设计）

完整沿用已上线的暖纸、墨黑、珊瑚色“导演接触表”设计，不另起一套风格。用户已经明确否定额外设计的珊瑚社群带、新二维码卡和新联系人模块；实现不得引入新的视觉方向、布局语言或组件外观。

### 4.1 团队卡升级

现有 Open Source / For Teams 两卡的布局、视觉与层级保持。团队卡标题改为更具结果感的“把 Nomi 变成你的产品与交付能力”，说明适用场景是内部 AI 视频工作台、客户项目、垂直行业流程与贴牌产品。

四项服务继续按细线列表呈现，不变成均匀功能卡墙。现有按钮区增加一个使用同款按钮/文本链接的微信入口，打开作者二维码原图，并在正文直接写出微信号。微信负责低摩擦中文沟通，Issue 负责不使用微信的访客；两条路径并存，不新增联系人卡片。

### 4.2 社群章节

社群章节紧接双路径区，但只复用现有官网的 `.paths-section`、标题、双路径卡、细线列表和按钮：

- 第一张现有样式的 `.path` 卡说明社群价值：看真实工作流、反馈问题、获取版本动态，并提供“查看群二维码”链接。
- 第二张现有样式的 `.path` 卡说明作者直联：群码失效时添加微信 `TZ857886159`，并提供“查看个人微信二维码”链接。
- 390 px 与 320 px 继续使用现有 `.paths` 的单列退化，不为二维码另建移动布局。
- 链接直接打开真实二维码原图；即使图片失败，微信号、说明和 Business Inquiry 仍保留。

### 4.3 导航与收尾

中文桌面导航恢复“社群”，英文为 “Community”。社群区不替换 Download、GitHub 或 Business Inquiry，只增加一条明确的人际转化路径。品牌收尾保持现状，避免在页尾再次重复入口。

## 5. 内容与生成架构

继续遵守单一内容源和生成文件纪律：

- `scripts/marketing/content.mjs` 的 `shared` 增加 Discussions URL、微信号、群二维码和个人二维码路径。
- 两个 locale 增加结构完全一致的 `community` 字段；中文与英文只改变文案和主动作排序。
- `template.mjs` 新增独立 `renderCommunity()`；`renderPaths()` 只负责开源/团队双路径。两者均只拼装现有 class，不创造新的视觉组件。
- `styles.mjs` 原则上不新增样式；只有现有 class 无法表达可访问状态时才允许增加最小规则，并且必须与当前设计 token 和响应式行为一致。
- `marketing/index.html` 与 `marketing/en/index.html` 仍只由构建脚本生成，禁止手改。

二维码继续复用仓库已有真实资产，不生成假二维码、不新增重复副本：

- 官网：`marketing/assets/group-wechat.png`、`marketing/assets/qingyang-wechat.jpg`
- README：`docs/media/nomi-canvas-group-wechat.png`、`docs/media/qingyang-wechat.jpg`

## 6. 失败退化与诚实表达

- 群二维码过期：页面不承诺永久有效，始终给个人微信二维码和文字微信号兜底。
- 图片阻断：微信号、群码说明、Discussions 和 Business Inquiry 仍在 DOM 中可访问。
- 无 JavaScript：社群锚点、二维码、文字微信号和所有链接均是原生 HTML，不依赖脚本。
- 英文访客不用微信：Community 的主动作是 Discussions，商务主动作是 Business Inquiry。
- GitHub Issue 是公开页面：继续警告只提交非保密摘要，不填写密钥、私人联系方式、预算明细或 NDA 材料。

## 7. 自动化防误删

扩展 `tests/ux/marketing-home.static.mjs`，把转化入口写成硬契约：

- 中文官网包含 `#community`、两张营销二维码、微信号、群码失效兜底文案和四项中文服务。
- 英文官网包含 Community、Discussions、Business Inquiry 和四项英文服务。
- 中文 README 的首屏链接、夸克镜像、群二维码、个人二维码、微信号、商务 Issue 与四项服务全部存在。
- 英文 README 的 Community、For Teams、Discussions、Business Inquiry 与四项服务全部存在。
- 所有二维码文件必须真实存在且非空；旧资产不得作为“未引用文件”删除。

扩展 `tests/ux/marketing-home.visual.mjs`：

- 1440、390、320 px 检查团队商务入口和社群章节存在，现有版式、按钮层级和单列退化没有被破坏。
- 图片资源阻断时检查文字微信号、Discussions 与 Business Inquiry 仍可见。
- 中文桌面导航的“社群”跳转到正确锚点；英文 Community 同理。
- 生成全页截图并与当前已上线官网对账，人工检查只发生内容增加，视觉语言、CTA 层级与移动端换行保持一致。

## 8. 不在本期做

- 不建立 CRM、报价器、表单后端或私信机器人。
- 不虚构商务邮箱。
- 不自动判断群二维码是否过期；永久兜底是作者微信。
- 不删除或重新组织与本次转化修复无关的产品证据、宣传片、下载入口和 SEO 信息。

## 9. 验收标准

1. 中文官网在不改变当前视觉设计的前提下，重新具备社群入口、群二维码链接、个人微信二维码链接与文字微信号。
2. 商务区能清楚宣传四类收费服务，并同时提供微信与 Business Inquiry。
3. 英文官网有适合国际用户的 Community / Discussions 和 For Teams / Business Inquiry，不强迫使用微信。
4. 中文 README 的原有下载、进群、个人微信和商业授权转化手段全部保留并上移首屏可达；英文 README 有等价的国际路径。
5. 静态契约能在任一关键入口被删除时失败，视觉矩阵能发现现有官网设计被破坏、入口隐藏或资源失败后的死路。
6. `pnpm run test:site`、`pnpm run test:site:visual`、项目完整 gates、最新远端 main 集成 gates 全部通过。
7. 上线后从正式域名检查两个语言路由、两张二维码、Discussions、Business Inquiry 与三支宣传片均返回成功状态。

## 10. 实施与验证证据

验证时间：2026-08-01 23:46 CST

- 实现已基于当时最新远端 `main`（`300ee075`）集成，并以 `8d431edc` 推送到 `main`；推送前再次确认远端是当前提交的祖先，没有覆盖并行工作。
- `scripts/marketing/styles.mjs` 相对集成基线逐字节无变化；新增社群与团队内容只组合原有 `.paths-section`、`.paths`、`.path`、`.service` 与 `.button`。
- `pnpm run test:site`、`pnpm run test:site:visual` 与 `node scripts/build-marketing-site.mjs --check` 均通过；视觉矩阵覆盖中英文桌面、390 px、320 px、无 JavaScript、减少动画和媒体阻断。
- 已人工查看 `tests/ux/_marketing/home-zh-desktop.png`、`home-en-desktop.png`、`home-zh-mobile.png`、`home-en-mobile.png`、`home-en-320.png`、`home-reduced-motion.png` 与 `home-blocked-media.png`；原官网字体、暖纸/深色分区、卡片边框、按钮和移动端堆叠均保持一致。
- 最新主线完整 `pnpm run gates` 通过：367 个测试文件通过、1 个跳过；3397 项测试通过、1 项跳过；lint 保持既有 98 条 warning / 0 error；renderer 与 Electron 构建成功。
- 提交 `8d431edc` 的 `Workers Builds: nomi`、`Quality Gate` 与 `Mac Package` 三项远端检查均为 `completed/success`。
- 正式域名 `https://nomiaqm.com/` 与 `https://nomiaqm.com/en/` 已命中社群、作者微信、Business Inquiry、Discussions 与双语四项团队服务；线上双语 README 入口也通过精确检查。
- `group-wechat.png`、`qingyang-wechat.jpg`、中文宣传片、英文宣传片和 hero loop 五项正式资源均返回 HTTP 200。
