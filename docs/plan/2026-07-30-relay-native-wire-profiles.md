# 中转接入：认得出的模型走它的原生报文（通用策略，非单点打通）

> 2026-07-30 · 用户拍板：「首先要保证这家打通，其次必须考虑通用策略，而不是一直单独打通」

## 为什么要做（真实摩擦）

用户用「通用中转接入」接了 `doubao-seedance-2-0-260128`。界面上参数一应俱全——因为 UI 是
**模型档案**驱动的，档案只认模型身份、与从哪家接入无关（刻意设计：同一模型不管走哪个渠道，
用户看到的应是同一套能力）。但**真正发出去的报文由渠道模板决定**，而「用户自建中转」走的是一个
通用最小模板 `{model, prompt, duration, size, image}`。

于是界面给一整套、线上只发得出一小截：

| 界面能选/能连 | 中转 wire 发得出 | 说明 |
|---|:--:|---|
| 时长 | ✅ | |
| 首帧图 | ✅ | |
| 比例 | ❌ | 档案给 `ratio`，通用模板 paramMap 读 `aspect_ratio` → 对不上，`ratioResToOpenAiSize` 返回 undefined |
| 分辨率 | ❌ | 尺寸由「比例+分辨率」合成，比例读不到 → 整个 size 发不出 |
| 生成音频 | ❌ | 模板无字段 |
| 变体（快速/Mini） | ❌ | 模板发 `{{model.modelKey}}`（目录固定值），档案期望 `{{request.params.model}}` |
| 尾帧 / 角色图×9 / 参考视频×3 / 参考音频×3 | ❌ | 模板无字段；连了边也静默丢 |

「运镜」尤其坑：它不是参数，机制是**生成灰模运镜小片自动接到 `video_ref` 槽**
（`NodeCameraMoveControl.tsx:36`）——而 video_ref 在这条路上发不出去，**运镜整个空转**。

这违反 `model-param-consistency-invariant`（身份定参数、与渠道无关 + 翻译层 + 看门狗）：
看门狗从没覆盖 relay 这条路。

## 关键机会

仓库里**已经有一份完整、已验证的火山方舟 Seedance 原生报文**
（`electron/catalog/volcengineVideos.ts`，`POST /api/v3/contents/generations/tasks` + `content[]`），
字段与用户那家中转文档 §6.2 逐字对得上（首/尾帧、角色图、参考视频、参考音频、
generate_audio、ratio、resolution 全在）。而 new-api 中转普遍代理方舟原生。

所以通用策略是：**接入时如果模型命中内置档案，就探一下这家中转有没有该档案的原生端点；
有 → 直接复用那份已验证的报文（只换地址）；没有 → 保持通用模板，并且绝不假装能发。**

## 范围

### 1. 档案 → 原生 wire 注册表（新模块 `electron/catalog/nativeWireProfiles.ts`）

```
archetypeId → { label, probePath, ops: { text_to_video, image_to_video }, query, statusMapping }
```
首个 entry：`volcengine-seedance-2` → 复用 `VOLCENGINE_VIDEO_MODELS` 里的 create op（**引用，不复制**，P1）。
机制通用，entry 随时间增长（后续可加 Seedream 图像、可灵原生等）。

### 2. 路由探测（新模块 `electron/catalog/nativeEndpointProbe.ts`）

**derive，不 hardcode**：网关对「查无此路由」的回答各家不同（404 JSON / 404 HTML / 405 / 502），
所以先打一条**必然不存在**的哨兵路径学到这家的"查无此路由签名"，再打目标路径比对：

- 签名相同 → 该端点不存在
- 签名不同（如 401 鉴权 / 200 / 404-任务不存在）→ 该端点存在

实测用户那家：`POST /api/v3/contents/generations/tasks` → 401；`POST /api/v3/nonsense` → 404
`Invalid URL (...)`。判据成立，且**不需要有效 key、零成本、不触发计费**。

### 3. URL 拼接：原生路径从主机根拼（`electron/ai/requestPipeline.ts`）

用户可能把地址填成 `https://host:8443/v1`。原生路径 `/api/v3/...` 直接拼会变成 `/v1/api/v3/...`。
给 `HttpOperation` 加显式可选项 `pathFrom: "host-root"`：置位时 `buildHttpRequest` 先剥掉 baseUrl
尾部的 `/vN` 再 join。单源、显式，不在 joinUrl 里塞魔法猜测。

### 4. 接入路径（`catalogCommit.ts`）

commit 前对每个 image/video 模型：命中注册表 → 探测 → 命中则用原生 op 注册 mapping
（t2v + i2v + query + statusMapping），并在 `model.meta.wireProfile` 记下用的是哪套。
探不到 → 现行通用模板（行为不变）。

### 5. 存量自愈（启动后异步体检）

迁移是同步纯函数、发不了网络请求，所以走**启动后异步一次性体检**：对非内置 vendor 的、命中注册表
的模型跑探测，命中就把 mapping 升级成原生形状。幂等、失败静默、每次启动最多一轮。

### 6. L3 护栏通用化（`taskParams.ts` + `runtime.ts`）—— 本方案的治本闸

已有护栏只问「有没有 mapping」。扩成**问这条 mapping 的 body 到底读不读得到这次要发的参考素材**：
用已有的 `bodyReferencedParamKeys(mapping.create.body)`（`paramTranslate.ts`）derive 出这条 wire
认识的键，对照本次请求真正携带的参考槽产出；发不出去的 → **拒发 + 说人话**，绝不静默丢。

这条对**所有渠道、所有模式**成立，不只 Seedance：以后任何「UI 能选但 wire 发不出」都会当场说清楚，
而不是静默扣费产出一个和参考图无关的东西。

## 不动项

- 不改档案（UI 能力声明保持供应商无关，P4）。
- 不改内置渠道的既有报文。
- 不做 UI 布局改动（不需要样张）：诚实通过 L3 拒发文案表达，不靠裁剪控件。
- 不碰 `return_last_frame`（全仓无任何渠道支持，本轮不引入）。

## 回滚

各步独立：注册表/探测/自愈是新增模块，撤掉即回到现状；`pathFrom` 是可选字段，不置位则行为不变；
L3 护栏扩展有开关点（只在「请求确实带了参考素材」时才拦）。

## 验收门

1. 五门全过。
2. 单测：探测的 derive 判据（哨兵签名相同/不同）、注册表命中、`pathFrom` 拼接（带/不带 /v1）、
   护栏对「wire 读不到该参考键」的拒发。
3. 真机走查：本地假中转**同时**提供 `/v1/video/generations` 与 `/api/v3/contents/generations/tasks`，
   验接入后选中的是原生形状、且尾帧/角色图/参考视频真的进了 content 数组；
   再起一个**只有** `/v1/video/generations` 的假中转，验降级到通用模板 + 连了参考视频时拒发说人话。
4. 用户那家真实地址：探测结论 = 原生端点存在（零成本、无需 key）。
