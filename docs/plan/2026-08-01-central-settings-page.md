# 集中设置页 + 自动另存（首批项）· 2026-08-01

> 来源：微信反馈（YAOYU168 反复提「自动保存本地 / 路径自定义」+ 图4 AI-CanvasPro 的「文件与保存」设置页）。
> 用户拍板（2026-08-01）：**做一个集中设置页**（不是顶栏小面板），自动另存作为首批项。
> 样张已出（left tab + right content，文件与保存含自动另存开关默认关）。

## 用户看到的变化

项目库顶栏加一个「设置」齿轮入口 → 点开**集中设置页**（左 tab 右内容，像图4）。首批「文件与保存」tab：
- 「自动另存生成物」开关，**默认关**
- 开启后「另存到」目录可选；此后每张生成的图/视频完成时，自动复制一份到该目录
- 「保存根目录」先占位（标「大改·稍后支持」）

## 为什么这么做（底层逻辑）

- **真实摩擦**：用户不想每张手动下载（YAOYU168 多次提）。刚做过「记住上次另存目录」，自动另存是自然延伸。
- **结构**：Nomi 一直没有集中设置页（设置散落各处）。建一个集中设置页当「设置的家」，自动另存是首批，将来保存根目录/字幕引擎/通用偏好都进这——一次搭好框架，后续项只往里加。
- **不造轮子**：复用现有 `OnboardingFloatingPanel`（`src/ui/onboarding/`）的外壳交互（Portal + Esc + 点外关 + pop 动画），布局改成图4 的左 tab 右内容。

## 分层实现

| 层 | 改动 | 说明 |
|---|---|---|
| UI | 新 `src/workbench/settings/SettingsDialog.tsx` | 左 tab 侧栏 + 右内容区；复用 OnboardingFloatingPanel 外壳模式。入口=项目库顶栏齿轮（`ProjectLibraryPage` 顶栏那排 + `NomiStudioApp` state） |
| 持久化 | 扩展 `electron/assets/downloadPrefs.ts` | `download-prefs.json` 加 `autoSaveEnabled` + `autoSaveDir`（和现有 `lastDir` 同文件，零迁移） |
| runtime | 自动另存复制逻辑 | 生成完成（`generationRunController:207 addNodeResult`）时，若开启，复用 `downloadAssetToDisk` 的取字节逻辑，静默复制到 `autoSaveDir`（**不弹对话框**）；失败不打断生成（best-effort + toast） |
| i18n | 设置页文案 zh+en | 复用 `assetLibrary`/新 `settings` 命名空间 |

## 不动项（never-wipe / D2）

- **不改 Nomi 项目存储根路径**——「保存根目录」是后续大改（要迁移现有数据），本轮只占位。
- 自动另存**只加复制**，不动内部 `nomi-local` 存储（零数据风险）。
- 不做竞品能力堆（人脸检测/控制角度/宫格，用户已拍不做）。

## 首批范围（进度）

1. ✅ **持久化**（`electron/assets/downloadPrefs.ts`）：merge 写 + `getAutoSavePrefs`/`setAutoSavePrefs`（默认关）
2. ✅ **runtime**（`electron/assets/autoSaveAsset.ts`）：`autoSaveAssetToDisk` 复用抽出的 `fetchAssetBytes`；best-effort（关/失败不打断生成）+ 同名不覆盖（-1/-2）。**9 单测过**
3. ✅ **IPC**（`assetsIpc.ts`）：`nomi:assets:auto-save` + `nomi:settings:auto-save-get/set` + `pick-dir`（showOpenDialog）；preload/bridge 暴露
4. ✅ **UI** `SettingsDialog.tsx`：左 tab 右内容（照样张，Portal+Esc+点遮罩关，DesignSwitch）+ 顶栏齿轮入口（`ProjectLibraryPage`+`NomiStudioApp`）
5. ✅ **接线**：`generationRunController:207 addNodeResult` 后调 auto-save（fire-and-forget，只新生成图/视频，找回不触发）
6. ✅ **i18n**（`locales/settings.ts` zh+en）+ **真机走查**：齿轮→设置页→目录显示→开开关（download-prefs 落 enabled=true、目录不丢）→切 tab→Esc 关闭，亲眼核 2 截图

**全链完成**（五门过）。✅ studio 工作区顶栏也加了设置齿轮（NomiAppBar 齿轮 + WorkbenchShell 传 prop + NomiStudioApp studio 分支挂 SettingsDialog）——真机走查两入口都能开同一设置页。剩：⬜ 端到端「生成→副本落盘」真机验证需真实生成（复制逻辑已 9 单测 + 接线）。

## 验收门

- 五门全过 + 真机走查（亲眼看副本落盘）
- 复制失败不影响生成（best-effort）
- never-wipe：只加副本，内部存储不动

## 后续（不在本轮，各自单独排）

- 保存根目录（改存储根 + 数据迁移，大改，单独 plan + 样张）
- 通用 / 关于 tab 内容
- 字幕识别引擎设置（图4 有，音频工作台成熟后）
