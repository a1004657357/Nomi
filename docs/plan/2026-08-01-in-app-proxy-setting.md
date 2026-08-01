# 应用内代理设置（2026-08-01）

**来源**：群反馈 07-24「软件里能不能加个设置代理选项，我给 nomi 单独走代理 / 电脑里有的软件不能走
全局系统代理」。样张已获用户拍板（2026-08-01 对话内 widget）。

**为什么现在做**：08-01 实测 `tmpfiles.org` 在国内直连 = `000`（连接被重置），走代理 = `405`。
昨天那条「所有免配置上传 host 都失败」里的 `tmpfiles.org: fetch failed` 根本不是图床挂了，是
没走通代理。而代理这件事在 App 里**零暴露**：走没走、走的哪个、为什么没走，用户一个都看不到。

---

## 范围

### 做

1. **偏好持久化** `electron/proxySettings.ts` → `proxy-prefs.json`（settings root，沿用
   `downloadPrefs.ts` 的 best-effort 小文件模式，不另造存储层）。
   三态：`system`（默认，现有行为）/ `custom`（用户填 URL，只对 Nomi 生效）/ `off`（强制直连）。
2. **`systemProxy.ts` 三处改造**
   - `resolveProxy` 读偏好：off → none；custom → 用用户填的；system → 现有 env→系统 探测链。
   - **`applySystemProxy` 可重复调用**（热切换）。现在它 `getGlobalDispatcher()` 当「直连档」，
     二次调用会把上一次的 `SelectiveProxyDispatcher` 当直连档套娃 —— 必须把「原始直连 dispatcher」
     模块级只捕获一次。
   - 导出 `getProxyStatus()` 给 UI：当前模式 / 实际生效的代理 / unsupported 详情（SOCKS）。
3. **IPC** `electron/proxyIpc.ts`：`nomi:proxy:get` / `:set` / `:test`。
   `:test` 打**免配置上传链那两个 host 的 origin**（从 `LITTERBOX_INGESTION.endpoint` /
   `TMPFILES_INGESTION.endpoint` derive，不 hardcode）——它们是全链最先断的一环，也是最有诊断价值的。
4. **UI** `src/ui/onboarding/NetworkSection.tsx`，挂在 `OnboardingDrawer` 的
   **能力条之下、「已接入」之上**。收起=一行 + 状态胶囊；展开=三态分段 + 自定义输入 + 测试连通。
5. i18n zh + en（R15）。

### 不做（明确划界）

- ~~**SOCKS 支持**~~ → **已做**（同日追加，`electron/socksDispatcher.ts`）。
  升 undici 拿内置 `Socks5ProxyAgent` 那条路**否掉了**：它要 undici ≥7.25，而 Electron 31 内置
  undici 6.19.8、package.json 也刻意钉同版（全局 fetch 用的是 Electron 那份，靠
  `Symbol.for('undici.globalDispatcher.1')` 桥接，符号在 7.27 翻 `.2`）；升上去 = undici 7 的 agent
  被 undici 6 的 fetch 以 v6 handler 调用，炸的是所有网络请求。`fetch-socks` 声明 `undici: >=7`
  同理用不了。故留在 6.19.8，用 `socks`（MIT，本来就在依赖树里，提成直接依赖）自接
  `Agent({ connect })`：SOCKS 隧道拿裸 socket，https 目标交给 undici 自己的 connector 做 TLS 升级。
  三档偏好与 http 完全同构，UI 不分叉。`unsupported` 现在只剩「地址解析不了/协议不认识」。
- 通用设置页 / 设置中心（fb-20260729-settings-hub 另立）。
- 渲染层 Chromium 代理的完整三态同步：现有实现只在 env 来源时 `session.setProxy`；custom 模式
  同理需要喂给 session（否则预览区远端视频撕裂），这条**要做**；off 模式要显式 `direct://`。

## 不动项

- `SelectiveProxyDispatcher` 的私网直连逻辑（本地 Ollama/ComfyUI 不走代理）原样保留。
- `describeNetworkError` 的诊断文案继续用模块级状态，只是状态多了 custom/off 两种来源。
- 付费/生成主链路一行不碰。

## 回滚

单 commit。回滚后 `proxy-prefs.json` 变成孤儿文件（无害，下次启动不读）。

## 验收门

- 五门 EXIT=0。
- 单测：偏好读写与非法值归一；`resolveProxy` 三态分支；**二次调用不套娃**（关键回归）；
  `parseResolveProxyString` 既有用例不回归。
- R13 真机走查：打开模型设置 → 网络行可见且显示真实探测结果 → 切「不用代理」→ 测试连通应失败
  → 切回「跟随系统」→ 测试连通应成功。截图人眼核对。
- 与样张逐项对账：位置（能力条下/已接入上）、收起一行、三态、自定义提示文案、测试结果行。
