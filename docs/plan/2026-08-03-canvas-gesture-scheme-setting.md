# 画布手势 · 滚轮语义二选一设置（#832 补齐）· 2026-08-03

> 来源：PR#56（@1251912798，已合 `b2ec4d91`）把画布语义翻成 ComfyUI 式，但只实现了 `docs/plan/2026-07-31-needs-pool-triaged.md:20`
> 裁决 #832 的一半。用户 2026-08-03 拍板：**现在补齐**。

## 用户那一刻卡在哪

两拨人，摩擦相反，这就是当初要「二选一」而不是「选一个」的原因：

- **鼠标党（群里反复提）**：滚轮想缩放。旧 Figma 式滚轮=平移，缩放要按 ⌘，别扭 → PR#56 已解决。
- **触控板党（含 owner 自己）**：双指滑是平移的肌肉记忆。PR#56 之后双指滑变成缩放，**且没有开关可退**。
  `docs/plan/2026-06-14-canvas-smoothness-ABC.md:29` 当年选 Figma 式的理由白纸黑字就是「触控板（你主力）」，
  并明写「任何滚轮都缩放 → 触控板双指滑被当缩放，**最别扭**」。PR#56 的「已知取舍」自己也承认这条。

另外 PR#56 越出 #832 范围，顺手删掉了**空格+拖平移**。#832 标题是「画布滚轮缩放」，只管滚轮。
空格+拖是「光标压在节点上时唯一的平移方式」（中键/右键拖之外），删了是净损失、无对应收益。

## 改完用户经历什么

设置 → 通用，多一行「画布滚轮」，两个选项（芯片行，样式照抄同页「截图热键」的键位芯片）：

| 选项 | 滚轮 / 双指滑 | ⌘/Ctrl+滚轮 · 捏合 |
|---|---|---|
| **缩放**（默认，ComfyUI 习惯） | 缩放，锚在光标 | 缩放 |
| **平移**（笔记本 / 触控板） | 平移（Shift 反转轴） | 缩放，锚在光标 |

切换即时生效，不用重开。手势提示卡跟着换文案（否则在「平移」档它会撒谎说「滚轮 缩放」）。

**其余手势两档共用、不进设置**（见下「为什么只让滚轮可配」）：空白拖=平移、Shift+拖=框选、
Shift+点=多选、空格/中键/右键拖=平移。

## 为什么这么拍（取舍点）

**只让「滚轮」这一个轴可配，其余手势两档强制一致。**

- #832 的原文范围就是「画布滚轮缩放」，不是「整套手势可配」。
- 真正两拨人打架的只有滚轮：空白拖=平移是**两拨人都更好**（它同时解决了群里「画布只能缩放不能移动」
  的可发现性抱怨），没有配置的必要。
- 反面就是造两套平行手势世界（违 P1），且设置项一多用户反而要学（违 D1/D4）。

空格+拖**两档都恢复**，不进设置——它不是「另一套方案」，是补一个正交的平移入口。

## 分层实现

| 层 | 文件 | 改动 |
|---|---|---|
| 偏好（新） | `src/workbench/generationCanvas/components/canvasGesturePreference.ts` | localStorage 读写 + 模块级 pub/sub + `useCanvasGestureScheme()`。**不进 `workbenchStore`**：它已 789/800 行只剩 11 行余量；`useSyncExternalStore` + subscribe 模块是本仓既有模式（`conversationPersistence.ts` / `useFilmstrip.ts` 等 5 处） |
| 纯逻辑（新） | 同文件 `resolveWheelIntent(scheme, {ctrlKey, metaKey})` | `'zoom' \| 'pan'`。抽纯函数是为了能单测（本仓无 `@testing-library/react`，hook 测不了） |
| 手势 | `useCanvasViewportGestures.ts` | ① `handleWheel` 按 intent 分流（pan 档恢复 Shift 反转轴 + rAF 批处理）；② 恢复空格+拖整条路径（keydown/keyup/blur 监听 + `spaceHeldRef` + capture 阶段 `wantsPan`） |
| 外壳 | `GenerationCanvas.tsx` / `generationCanvas.css` | 恢复 `data-space-pan` 属性 + `cursor: grab` |
| 提示卡 | `CanvasGestureHint.tsx` | 按 scheme 选图例；已读 key 保持 `v2`（语义没再变，不该再骚扰一次） |
| 设置 UI（新） | `src/workbench/settings/CanvasGestureSection.tsx` | 芯片行，照抄 `ScreenshotHotkeySection.tsx` 的选中态 `border-nomi-accent bg-nomi-accent-soft text-nomi-accent` |
| 设置挂载 | `SettingsDialog.tsx` | 通用 tab 里 `<ScreenshotHotkeySection />` 的兄弟节点 |
| i18n | `src/i18n/locales/settings.ts` / `generationCommon.ts` | zh + en 双语；R15 零硬编码 |

## 不动项

- 空白拖=平移 / Shift+拖=框选 / Shift+点=多选 —— PR#56 已落且两档共用，本次不碰。
- `nomi:canvas-gesture-hint:v2` 不再升版。
- 缩放倍率范围 `0.2–3`、`getWheelZoomFactor`、`findScrollableAncestor` 卡内可滚区放行 —— 全不动。

## 回滚

全部新增/局部改，单 commit 可整体 revert；revert 后回到 PR#56 合入态（纯 ComfyUI 式）。

## 验收门

1. 五门全过（`pnpm run gates`，显式 `echo EXIT=$?` 亲见 0 —— 别再被管道吞退出码）。
2. 新单测：`resolveWheelIntent` 两档 × 有无修饰键的真值表 + 偏好读写落盘/异常兜底。
3. R13 真机走查 `scripts/canvas-gestures-walkthrough.mjs` 扩成**两档各跑一遍**：
   - `wheel-zoom` 档：滚轮 → 放大、锚点漂移 < 12px（现有断言）
   - `modifier-zoom` 档：滚轮 → **平移**（节点位移 ≈ deltaY 且倍率不变）、⌘+滚轮 → 放大
   - 两档都验：空格+拖 → 平移（节点整体位移）
   - 截图逐张人眼看（眼见链：断言过 ≠ 长对）
