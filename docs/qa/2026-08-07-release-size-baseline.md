# 2026-08-07 发布体积基线

## 基线

- Git commit: `0d375a9590aee716008a06a676dbdf59e7332452`
- 观察对象：本机现存的旧 `release/mac-arm64/Nomi.app`
- `app.asar`: 约 290 MB
- `app.asar.unpacked`: 约 560 MB
- `@ffmpeg-installer`: 约 265 MB
- `@ffprobe-installer`: 约 294 MB
- 两个目录各包含 8 个平台/架构包目录（含目标包及跨平台包）
- 当前可下载的旧 macOS arm64 DMG：约 166 MB；DMG 不是用户反馈中“690 MB”数字的直接对应物，不能混用这两个口径。

## 根因判断

`package.json` 原有 `asarUnpack` 对 `@ffmpeg-installer` 与 `@ffprobe-installer` 使用宽 glob，导致多个平台的二进制一起进入 `app.asar.unpacked`。这解释了约 560 MB 的主要膨胀；剩余体积仍需以新 target 产物审计确认，不能仅凭旧目录推断最终安装包大小。

## 修复与复验

`scripts/after-pack-mac.cjs` 现在在每个 target 的 afterPack 阶段调用 `scripts/packaging/platform-binaries.cjs`，只保留当前 `platform/arch` 的包目录；`scripts/packaging/audit-packaged-media.cjs` 会在构建后拒绝发现跨平台包。`pnpm run test:packaging` 用临时目录验证裁剪与审计不变量。

已在隔离工作树执行真实 macOS arm64 目录打包：

- 产物：隔离 sibling worktree 的 `release-codex/mac-arm64/Nomi.app`（验证后已移出工作树，报告保留字节与 SHA-256 证据）
- `.app` 磁盘占用：约 584 MB（`du -sk`：598,084 KiB）
- `app.asar`：311,118,626 bytes；SHA-256：`e21e7c7406e35b5db68498ba4fbb4e5d6cb3cdaa14ad1b929cb8107531613fba`
- `app.asar.unpacked`：约 55 MB（`du -sk`：56,436 KiB）
- 审计结果：`@ffmpeg-installer/darwin-arm64` 约 35 MB、`@ffprobe-installer/darwin-arm64` 约 18 MB；未发现其它平台包。

## 结论与边界

这次修复消除了旧产物中跨平台 ffmpeg/ffprobe 重复打包的主要膨胀源；新包仍约 585 MB，说明剩余体积主要来自 Electron 应用依赖与前端/媒体运行时，不能把“只删跨平台二进制”误报成“安装包已变小到某个目标值”。当前没有 Windows Authenticode 证书、Windows runner 或真实 SmartScreen 信誉验证，因此“Windows 已保护你的电脑”仍是发布链路外部事项，代码没有也不应绕过 Windows 安全策略。
