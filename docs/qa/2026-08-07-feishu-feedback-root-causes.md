# 飞书自我对话反馈：根因与处理矩阵

日期：2026-08-07。来源为已登录账号的“自我对话”只读检索；本报告只保留脱敏后的现象分类，不保存原始私聊、截图、Cookie、Token 或用户凭据。

## 已落地并有回归验证

| 用户摩擦 | 根因 | 结构性处理 | 证据 |
|---|---|---|---|
| 素材库打开后拖不进画布 | 浏览器素材 overlay 在原生拖动开始后仍持有 hover/命中状态，macOS 下覆盖了画布 drop 入口 | 原生 `dragstart` 捕获阶段释放 overlay；结束 overlay drag 时同步清除 `hoverInteractive` | `electron/browser/overlay/browserViewOverlay.ts`、`src/ui/browser/overlay/BrowserAssetOverlayApp.tsx`；`browserViewOverlay.test.ts` |
| APIMart TTS 报 speed 类型错误 | 目录模板把字符串参数原样写入需要 JSON number 的请求字段 | 统一在 task 参数归一化层把有限数字字符串转为 number；非法值保持可诊断，不静默吞掉 | `electron/catalog/taskParams.ts`；`taskParams.test.ts` |
| 保存 key 后显示已连接，但实际没验证 | Vendor 卡片保存成功与“服务可达”共用一个成功状态，且卡片没有调用已有测试桥 | 连接能力声明为可测试的供应商在保存后异步执行 reachability probe；保存不被网络阻塞；状态区分未测试、测试中、已验证、失败 | `src/config/knownVendors.ts`、`src/ui/onboarding/VendorOnboardCard.tsx`、`src/i18n/locales/onboardingProviders.ts` |
| 官网下载进入 Release 版本列表 | 主 CTA 使用 `/releases/latest` 页面链接，不是固定资产 URL | 使用 GitHub `releases/latest/download/<asset>` 稳定别名；按 UA/UA-CH 选择 Windows x64、macOS arm64、macOS Intel；无法安全判定时保留公开 Releases 兜底；点击时再次解析避免异步竞态 | `scripts/marketing/downloads.mjs`、`scripts/marketing/client.mjs`、`scripts/marketing/template.mjs`；`tests/ux/download-selection.contract.mjs` |
| 安装包同时携带多个平台媒体运行时 | `asarUnpack` 宽 glob 使跨平台 ffmpeg/ffprobe 一起进入 unpacked | afterPack 按最终 target 裁剪；构建后审计拒绝 foreign target；真实 macOS arm64 产物只保留目标包 | `scripts/packaging/*`、`scripts/after-pack-mac.cjs`；真实包报告见 `2026-08-07-release-size-baseline.md` |

## 已核对、无需重复加补丁

- 素材筛选按钮当前已使用中性色 token，不再是历史截图中的粉色底；本轮没有再加第二套样式。
- 站内已有 `onboarding.testConnection` bridge；本轮修的是 Vendor 卡片未调用它，而不是新增并行连接协议。
- 视频结果卡和媒体预览已有播放守卫、`controls`、`playsInline` 与错误诊断。没有真实失效 URL/编码样本时，不把“播放失败”改成盲目重写播放器。
- 3D 场景内容当前传入 `interactionDisabled={false}`；Pro 的静态建议与现有代码基线重合，未为已修复路径制造并行状态机。

## 外部阻塞或需真实环境复验

- Windows SmartScreen：未取得代码签名证书、Windows runner 和信誉环境；本轮不关闭 SmartScreen、不伪造签名、不声称已解决。需要发布方在真实 Windows 产物上执行 Authenticode 签名和安装验证。
- Kie Seedance 2.5、Dreamina CLI、Volcengine 等供应商能力：飞书反馈表明存在用户期待或配置误导，但没有本轮授权的真实供应商凭据与当前官方 API 规格，不能凭空接入或把未可用能力标成可用。
- “宣传片第 4 个 Logo 圆、产品方”经逐帧和源码核对未证实为当前营销资产不一致：宣传片画面、`marketing/assets/nomi-logo.svg`、`src/design/identity.tsx` 使用的是同一圆角方形几何；`build/icon.png` 是系统安装图标的圆角/圆形外观。没有证据证明应改变品牌几何，因此未擅自拆出第三套 Logo。

## 安全处理

检索过程中遇到一条疑似 API key 的用户反馈内容；它未被复制进任务 ZIP、ChatGPT Pro 对话、代码、测试或本报告。该凭据应按已暴露处理，由凭据所有者在真实系统中轮换；本轮没有读取、调用或转发它。
