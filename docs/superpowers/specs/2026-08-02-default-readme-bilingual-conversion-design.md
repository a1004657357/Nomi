# Nomi 默认 README 双语转化首屏设计

日期：2026-08-02
状态：已实施并通过真实 GitHub 桌面端与 390 px 窄屏验收
范围：`README.md`、`README.zh-CN.md`、README 转化静态契约

## 1. 问题与事实

GitHub 仓库首页自动展示根目录 README；官方文档只定义 `.github`、根目录、`docs` 的 README 选择优先级，没有按访客浏览器语言切换 `README.md` / `README.zh-CN.md` 的机制。因此不能依赖访问者语言自动显示中文版。当前仓库默认展示英文 `README.md`，顶部只有进入中文 README 和 Community 的文字链接；群二维码与作者二维码都不在默认首屏。即使进入中文 README，群码也位于下载和团队服务之后，作者二维码更靠后。

转化问题不是“二维码是否存在”，而是用户在第一次看到项目时能不能立即扫码。仅保留深层链接会让中文用户多一次寻找、多一次点击，并直接损失加群和作者直联。

## 2. 方案比较与选择

| 方案 | 用户看到 | 代价 | 结论 |
|---|---|---|---|
| A：按语言自动切 README | 中文访客自动看中文、英文访客自动看英文 | GitHub 仓库 README 不提供该能力，无法可靠实现 | 不可选 |
| B：默认 README 双语转化首屏 | 所有人先看到两张微信二维码；随后继续英文国际介绍 | 英文首屏会出现中文转化内容，但仍保留清楚的 English / Discussions 路径 | **采用** |
| C：默认 README 整份改中文 | 中文转化最直接 | 国际用户第一次打开完全失去英文主叙事 | 不选 |

## 3. 首屏信息层级

两份 README 都保持 Logo、标题、主张、简介和语言/官网导航不变。紧接导航链接、在 badges 与宣传片海报之前插入二维码转化块：

1. 第一块：`加入 Nomi 用户群 / Join the Nomi user group`，用 220 px 宽的纵向大图展示 `docs/media/nomi-canvas-group-wechat.png`，让中文用户先看到、先扫码。
2. 第二块：`群码失效或项目合作 / Maintainer & project collaboration`，在用户群之后展示 `docs/media/qingyang-wechat.jpg`，同时明文写出 `TZ857886159`。
3. 默认英文 README 的标题和说明采用中英文并列，并保留 GitHub Discussions 链接，避免微信成为国际用户唯一入口。
4. 中文 README 使用中文主文案，保留官网、下载、夸克镜像、用户群和团队合作链接。

二维码使用纵向 HTML `<p>` + `<img>`，不放进 Markdown table。真实 GitHub 窄屏走查证明双列表格会把左侧群二维码压缩到约 69 px，不利于扫码；纵向结构让群二维码在 390 px 窄屏仍保持 220 px，作者二维码保持 180 px。图片可点击打开原图，方便手机端长按识别或另一个设备扫码。

## 4. 不重复与不删除

- 两张真实图片只在每份 README 的首屏渲染一次，不在后文重复制造视觉噪音。
- 中文 `## 用户群`、`## 关于作者`、团队服务、Business Inquiry、夸克镜像、下载和许可证全部保留；后文改为回指首屏二维码或文字微信号。
- 英文 `## Community` 继续以 GitHub Discussions 为国际主入口，同时说明微信二维码已在首屏。
- 不生成新二维码、不改变图片文件、不虚构邮箱或表单。

## 5. 防回退契约

扩展 `tests/ux/marketing-home.static.mjs`：

- 默认 `README.md` 必须直接包含群二维码 `<img>`、作者二维码 `<img>`、`TZ857886159` 与 Discussions。
- 中文 `README.zh-CN.md` 必须直接包含相同两张二维码 `<img>` 与微信号。
- 两份 README 中两张二维码的 `<img>` 位置都必须早于宣传片海报，保证它们不是“存在但又被下移”。
- 首屏转化块不得使用会压缩列宽的 Markdown table；用户群二维码源码宽度必须保持 200–299 px，并且顺序早于作者二维码。
- 两张二维码文件必须继续真实存在且非空；原有团队服务、下载、夸克镜像与 Business Inquiry 契约继续保留。

## 6. 验收标准

1. 打开 GitHub 仓库首页，无需进入中文 README 就能先看到可直接扫码的用户群二维码，作者二维码紧随其后。
2. 进入中文 README，同样无需滚到下载或团队服务之后即可看到双二维码。
3. 英文用户仍能直接进入 Website、Download、GitHub Discussions、For Teams 和英文文档。
4. `TZ857886159` 以文字存在，即使图片无法加载也能联系。
5. 删除任一默认首屏二维码、把二维码下移到宣传片海报之后，静态契约都会失败。

## 7. 实施与验收证据

- TDD 红灯：新增移动端契约后，旧双列表格明确失败于 `English default README group QR remains prominent on mobile`。
- TDD 绿灯：两份 README 改为纵向结构后，`pnpm run check:site` 同时通过 `MARKETING SITE CHECK PASS` 与 `MARKETING HOME STATIC PASS`。
- 完整门禁：368 个测试文件通过、1 个跳过；3404 个测试通过、1 个跳过；lint 为既有棘轮 98 warnings / 0 errors；typecheck 与 renderer / Electron build 全部通过。
- 默认 README 线上窄屏：GitHub 仓库页在 390 × 844 viewport 下，群二维码实际渲染 220 px、作者二维码 180 px，两图均加载成功，无页面横向溢出。
- 默认 README 线上桌面端：两张二维码保持 220 / 180 px，用户群在作者微信之前，宣传片海报在两张二维码之后。
- 中文 README 线上桌面端：两张二维码均加载成功并保持 220 / 180 px；夸克网盘、加入用户群、团队合作和 `TZ857886159` 转化入口全部存在。
- 发布内容提交：`56dfaa32a39de1675bf7173ed17b2f9f08559dba`；对应 `Quality Gate`、`Mac Package` 与 `Workers Builds: nomi` 均为 `success`。
