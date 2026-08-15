# 自定义调用（per-model 调用脚本逃生口）实施计划

> 2026-08-04。用户拍板方向（方案 B + 三时刻呈现 + 试跑 + AI 帮写），授权「全部推进做完」。
> 调研依据：`research/2026-08-03-custom-api-adapter-landscape.md`（声明式够不到异步视频被三家独立证伪；
> 行业收敛=内置适配 80% + 代码级逃生口 20%；infinite-canvas 是唯一把口子给到用户的先例，无试跑无 AI 帮写）。
> 样张：`docs/design/mockups/2026-08-04-custom-call-editor.html`（基于 .custom-call-recon 真机截图布局）。

## 0. 一句话

接不通的模型，用户（或 AI）给它挂一段「调用脚本」教 Nomi 怎么调：脚本全权负责端点/鉴权/body/轮询/解析，
返回结果 URL；留空=恢复默认调用。默认路径（档案原生 wire / 通用模板）一根手指不动。

## 1. 范围 / 不动项

**做**：
- Model 顶层可选字段 `customCall?: { script: string; updatedAt: string }`（catalog v 号不动，additive）。
- 主进程脚本执行器 `electron/catalog/customCallRunner.ts`（new Function 注入面 + 归一化 + transcript）。
- `runTask` 单一派发点：`model.customCall?.script` 存在 → 走脚本（在 mapping 分支之前）；付费闸/指纹缓存/结果本地化/溯源全部复用。
- 试跑 IPC `nomi:model-catalog:custom-call:test-run`（真调、花最小额度、返回 transcript）。
- 编辑器弹窗（DesignModal 系）：贴材料 → AI 生成（复用 runWorkbenchTextTaskStream + prompt_refine 通道）→ 脚本区（textarea + 模板插入）→ 试跑（请求/响应/错误摊开 + 失败一键回喂）。
- 模型行入口（ModelEnableEditor 行加 IconCode 动作 + 已设点亮）+ 报错卡 hint 入口（限报文不匹配类 kind × 自定义 vendor）。
- i18n zh/en 全量；IconCode 登记 `src/vendor/tablerIcons.ts`。

**不动**：
- 现有 wire 档案/通用模板/nativeWireProfiles/一切 mapping 逻辑（脚本只是前置覆盖层，不是并行版——单一派发点）。
- SpendConfirm / 队列 / 任务中心结构。
- 文本(kind=text)与音频任务：v1 不接脚本（痛点在图像/视频中转；文本走 AI-SDK、音频有独立 runner，接入另议）。

## 2. 数据模型

`electron/catalog/types.ts` Model 增：
```ts
customCall?: { script: string; updatedAt: string }
```
`applyModelUpsert`：`raw.customCall === null → 删除；undefined → 保留 existing；object → 覆写`（防拉取流程 clobber，
与 enabled 同级的用户数据；never-wipe 纪律）。DTO（listModels 出口）带出 `hasCustomCall`/`customCall`。

## 3. 执行器（主进程）

`runCustomCallScript(input) → { result: TaskResult 形状的归一物, transcript }`

注入面（契约单源 `customCallContract.ts`，编辑器变量文档与 AI 提示词同 import）：
- `prompt: string`、`params: Record<string,unknown>`（request.extras 参数投影）、
  `references: { firstFrame?, lastFrame?, images: string[], videos: string[], audios: string[] }`（extras 参考槽投影，值为 vendor 可达 URL——走现有 localizeAssetsForVendor 之后）、
  `model: string`（modelAlias||modelKey）、`baseUrl`、`apiKey`。
- `http.post/get(path, body?, {headers?, query?, responseType?})`：默认 Bearer 鉴权 + baseUrl 拼接；
- `request({method,url,headers,query,body,responseType})`：裸请求零默认头；
- `poll(fn, extract, {intervalMs?, timeoutMs?})`、`sleep(ms)`、`signal`。
- 网络走既有 `requestJson`/undici 栈同一条路（代理/SOCKS 免费继承）；**不做 SSRF 私网拦截**（用户显式写的地址，
  LAN 中转合法——与资产回捞的 assertSafeUrl 场景不同，注释讲清）。
- transcript：`request`/`http` 每次调用记 `{method,url,status,durationMs,requestBodyPreview,responsePreview}`，
  Authorization 头脱敏；试跑与真跑同一执行器（试跑多带 transcript 返回）。
- 返回归一：string URL / dataURL / {url} / {urls[]} / {b64_json} / 数组 → assets；dataURL 走 writeAsset 落项目
  （复用 processOperation 的注入模式），http URL 走 localizeTaskAsset（CDN 过期课）。
- 超时默认 600s；错误消息前缀「自定义调用脚本」，原话透传。

## 4. 派发点（runtime.ts runTask）

`findExecutableModel` 后、`if (mapping)` 前：
```ts
if (model.customCall?.script && (wantedKind === "image" || wantedKind === "video" || wantedKind === "model3d")) {
  // recipe 带 script hash → 指纹缓存语义不破
  // assertAndConsumeSpendGrant（缓存未命中才消费，与主路径一致）
  // runCustomCallScript → succeeded/failed TaskResult（脚本内部自轮询，不 admitTask）
}
```
诚实边界（编辑器文案标注）：脚本任务提交后不可取消（与云端任务同边界）、超时找回机制不适用。

## 5. 试跑

- IPC：`custom-call:test-run { vendorKey, modelKey, script, kind }`（异步）。
- 输入：canned 最小请求（prompt="a red apple on a wooden table" / 视频同 prompt + 最短时长），无参考图；
  真调、真扣费（按钮文案明示「花一次最小额度」，点击即同意；不再叠 SpendConfirm——那是画布生成的闸，
  编辑器内显式动作等价用户直发，参照 onboarding 试连的既有边界）。
- 输出：`{ ok, assets?, errorMessage?, transcript }`；渲染层摊开显示；失败→「让 AI 按报错修改」把
  {script, transcript 尾段, errorMessage} 回喂生成通道。
- 超时：image 180s / video 600s。

## 6. AI 帮写

- 复用 `runWorkbenchTextTaskStream` + `kind: 'prompt_refine'`（NodePromptOptimizer 同通道，零后端改动）。
- 指令 = `customCallContract.ts` 导出的脚本 API 文档 + 返回值约定 + 3 份模板 + 用户贴的材料 + 模型上下文
  （modelKey/kind/baseUrl）。输出裸 JS 函数体（指令强制不带 markdown 围栏；渲染层剥 ``` 兜底）。
- 无文本脑接入时：按钮禁用 + 提示先接文本模型（C4 不做沟通死路）。

## 7. 入口

- 模型行（ModelEnableEditor）：checkbox+名字+**IconCode**+trash；已设=accent+角标；点击开编辑器。
  仅自定义/中转 vendor 的行显示（KNOWN_VENDORS/dreamina/comfyui/codex-local 不显——它们各有专属通道）。
- 报错卡（NodeErrorReport）：新增可选 prop `customCallTarget?: {vendorKey, modelKey}`（父组件在
  vendor 为自定义家时传入）；hint 行末尾附「高级：自定义调用 ›」，kind 限
  `model-config` / `image-route-disabled` / `model-unavailable-upstream`；点击 dispatch
  `nomi-open-model-catalog` 带 `detail:{vendorKey, modelKey, intent:'custom-call'}`，抽屉宿主路由到
  该 vendor 卡展开 + 打开编辑器。
- 主按钮/既有三动作结构不动（2026-07-30 拍板）。

## 8. 测试矩阵

- 单测：派发优先级（有脚本走脚本/无脚本走 mapping/文本音频不走）；归一化（url/dataURL/{url}/数组/垃圾输入）；
  upsert customCall 三态（保留/覆写/null 删除 + 拉取重 upsert 不丢）；transcript 脱敏；契约单源一致
  （编辑器变量表 == 注入 key 集合，防漂移）；报错卡 kind 门控。
- 结构闸：脚本路径结果必经 localizeTaskAsset/writeAsset（防 bundle-URL/CDN 过期类回归）。
- 五门全过；R13 走查（编辑器打开/AI 生成/试跑失败态截图亲读）；R16 真实任务：真端点脚本
  「粘贴→AI 生成→试跑→保存→画布真生成出图」整链（评测额度默认授权）。

## 9. 回滚

字段 additive、入口独立组件、派发点单 if——revert 一个 commit 即回原状；存量无脚本用户零感知。

## 10. 风险与诚实边界（编辑器内明示）

- 脚本内部对参考图第三闸不透明 → 试跑面板摊开实际请求体补偿。
- 脚本=本机执行的用户代码：只粘贴可信来源；绝不做远程脚本市场/自动安装。
- 提交后不可取消；「超时可找回」不适用。
