# 参考图统一 · 渠道诚实 · Codex 去歧义（2026-08-02）

用户原话三件事：①「有些参考图是艾特，有些又变成里边，换图片模型时格式不一样，得统一」②「有时候参考图连接不上，生成有问题……主要是生成这个环节，不能出问题。那些模式，参考图能不能传上去？到底能不能生成？」③「我们这里好像没有区分 MCP 和 CLI，感觉有点混乱，用户也看不懂这几个名词。」

三条都已用只读审计定位到根因（见下），方案均已用户拍板（三问全选推荐项）。

---

## 一、先把「事实」钉住（审计结论，别再凭印象讨论）

### 1.1 参考图的「艾特 vs 里边」

**图片模型其实全都一致**——14 个图片档案无一使用 `characterIndexed`、无一有 `@imageN` 提示。三样东西共用了 `@` 这个符号才造成错觉：

| 机制 | 范围 | 位置 |
|---|---|---|
| `@` 芯片（点缩略图自动插进提示词） | **所有**图片节点，与模型无关 | `NodeGenerationComposer.tsx:700-702`、`AssetReference.tsx:139`、`promptMentions.ts:48-55` |
| `characterIndexed` → ①②③ 编号 | **只有视频档案**（Seedance omni、HappyHorse 角色） | `modelArchetypes/types.ts:37-39`、`archetypeMeta.ts:162,172` |
| 「prompt 里按顺序写 @image1…@image9」文案 | **只有 HappyHorse 1.0** 一个模式 | `happyhorse.ts:69`（1.1 已明确弃用：`happyhorse11.ts:8-9`） |

**关键**：`@imageN` **不是任何供应商的 API 要求**，参考图永远以结构化数组发出（`kieHappyhorse.ts:32-36`、`kieSeedance.ts:52,60`），`projectPromptForSend` 只在自由文本里替换，无任何 wire 模板反向解析它。→ 纯写作糖，可自由统一。

**真正的图片模型不一致**（用户实际看到的）在这里：

| | 认得档案的模型 | 认不出的（通用中转/ComfyUI 导入） |
|---|---|---|
| 排版 | 合并的缩略图带（"里边"） | 一个个独立方框槽（"外面"） |
| 标签 | 「输入图」 | 「参考图」 |
| 代码 | `NodeParameterControls.tsx:466-479` 走 `archetypeModeArraySlots` | 同处走 `modelImageUrlSlots`/`imageCatalogReferenceSlot`；标签在 `parameterControlModel.ts:151` |

外加视频侧第三个名字「角色参考」。**同一概念、两种排版、三个名字**。

### 1.2 生成环节：通用中转的参考通道大面积不可达 ⚠️ 最痛

通用中转视频模板 `NEWAPI_VIDEO_CREATE_OP`（`newapiTransport.ts:194-210`）**只有** `model / prompt / duration / size / image`，其中 `image` 还只装 `firstReferenceImage` 聚合的**单张**图。

而「能发完整原生报文」的白名单 `nativeWireProfiles.ts:55` **只登记了 1 个档案**（`volcengine-seedance-2`）。其余 kie seedance-2、seedance-2-apimart、kling-3、veo-3-1、wan-2-7、vidu-q3、omni-flash-ext、hailuo-2-3、sora-2、happyhorse… 经裸中转接入时**全部落到最小模板**：

| 档案 × 模式 | UI 给的槽 | 中转真能发出 |
|---|---|---|
| 首帧 i2v（单图） | 首帧 | ✅ |
| 首尾帧 | 首帧 + 尾帧 | 首帧✅ **尾帧❌** |
| 全能参考（多角色图） | 角色图 ×9 / 参考视频 / 参考音频 | **仅第 1 张图✅，其余全❌** |
| Vidu Q3 ref（≤7 图）/ Omni-Flash（3 图） | 参考图数组 | **仅第 1 张✅** |
| HappyHorse edit（源视频 + 参考图） | 源视频 / 角色图 | **源视频❌** |

**结构性根因**：UI 能力由**模型档案**声明（供应商无关，`resolveArchetypeForModel` 只认模型身份），真正发出去的 body 由**渠道 mapping** 决定，**两者只在「点生成那一刻」才对账**（第三闸 `unreachableReferenceLabels`）。于是 UI 热情地给出模式和槽 → 用户连好、切模式 → 点生成才被拒。

（`7acc5cfd` 已把「静默丢 + 照扣费」改成「付费前拒发 + 人话」，但**拒得太晚**仍是主要摩擦。）

**连带**：ComfyUI 导入工作流**根本没有多图/角色数组通道**——绑定只注 `first_frame_url`/`last_frame_url`/`source_video_url`（`comfyuiWorkflowImport.ts:496-507`），画布侧槽也只读 first/last（`parameterControlModel.ts:123-134`）。

### 1.3 连线校验本身是好的（别误伤）

`validateReferenceEdge`（`referenceEdgeCapability.ts:150-163`）三入口共用、拒绝都有 toast、槽满也提示。**唯一硬拒绝**是把图连进纯文生模型。**但**：目标模型没有档案时无条件放行（`:159`）——ComfyUI 导入、裸中转模型都属此类，「连线不拦」≠「参考有用」。

### 1.4 Codex 在 Nomi 里是两个方向相反的东西

| 方向 | 是什么 | 入口 | 术语 |
|---|---|---|---|
| Codex **→** Nomi | Codex 当司机，经 MCP 驱动 Nomi | 「接入 AI 编程助手」卡 | MCP |
| Nomi **→** Codex | Nomi spawn `codex exec` 出图（烧用户 ChatGPT 额度） | 模型列表「Codex 生图（登录额度）」 | CLI |

`codexImages.ts:2` 自述：「只调用本机已登录的 `codex exec`」。**而接入卡点一次「接入」会同时打开两者**（`ConnectAssistantCard.tsx:77` `syncCodexLocalVendor(true)`）。

用户可见的术语泄漏：`generationCommon.ts:369-370`「经 AI 助手（**MCP**）驱动」、`onboardingProviders.ts:268`「粘进它的 **MCP** 设置」、`onboardingProviders.ts:335`「一键安装即梦 **CLI**」。

---

## 二、方案（用户已拍板）

### W1 渠道诚实：把「发不出」从生成时提前到接入/连线时（拍板：先诚实后扩能）

**不变量**：UI 显示的模式/槽，必须是这条渠道**真发得出**的。UI 收窄与第三闸**必须同一个函数算**——否则又造一次「两处各自漂移」（本轮修的正是这种）。

- **新增纯函数** `reachableReferenceSlotKinds(archetypeMode, createBody)`：拿 mode 声明的每个 slot 的 `inputKey`（缺省走 `SLOT_DEFAULTS`），与 `bodyReferencedParamKeys(createBody)` 求交，回「这个模式下真发得出的 slot kinds」。
  - 放哪：`bodyReferencedParamKeys` 所在的 `paramTranslate.ts` 只依赖 `jsonUtils.ts`，而 `jsonUtils.ts` **零 import**（已核）→ 纯链，渲染层可安全 import。但生产代码目前两层从不互相 import（只有测试跨层）。**首选**：新函数放 `src/config/`（档案层，概念上就是共享的），import 那两个纯函数；electron 侧第三闸改调它。**回退**：若 electron tsconfig 不含 `src/`，改走 IPC（`main.ts` 仅剩 8 行余量，新 IPC 需挂到既有模块而非 main.ts）。
- **消费点**：
  1. 节点参数控件：发不出的槽不渲染；整个模式都发不出 → 模式在选择器里禁用并给一句人话。
  2. `validateReferenceEdge`：档案 × 渠道求交后再判，让「连不上」当场说清而不是生成时。
  3. 第三闸保留为兜底（纵深防御，不删——它是最后一道且已有测试）。
- **必须避免的误伤**：走专用 codec（kie/apimart/火山原生）的模型本就全通，收窄后**不能少一个槽**。锁一条对照测试。

### W2 参考图统一（拍板：排版 + 叫法全统一）

- 非档案模型的参考也走**同一个合并数组行渲染器**（`NodeParameterControls.tsx:466-479` 两分支收敛）。
- 「输入图 / 参考图 / 角色参考」→ **一个叫法**（建议「参考图」，最直白且已是多数场景用词；`modelDisplayText.ts` + `parameterControlModel.ts:151` 同步）。
- ①②③ 编号**仅**作为 `characterIndexed`（顺序真的有意义）的显示，不是另一套玩法——保持现状即可。
- `happyhorse.ts:69` 那条「写 @image1…@image9」：**先不删**。它是 1.0 的模型行为问题（数组照发，但 prompt 里的编号可能真影响模型对齐），删它需要真跑一次 A/B 才有据。列为待验证项，不在本轮动。

### W3 Codex 去歧义（拍板：拆开 + 全面去术语）

- **拆联动**：删 `ConnectAssistantCard.tsx:77/93` 的 `syncCodexLocalVendor`——接入卡只管「让 AI 助手来用 Nomi」；「Codex 生图」回归模型列表自己开关（`OnboardingDrawer.tsx:105-112` 的派生同步一并处理，避免留下并行版 P1）。
- **去术语**：`generationCommon.ts:369-370` 的「（MCP）」删掉 → 「经 AI 助手驱动 · 需你确认花费」；`onboardingProviders.ts:268` 的「MCP 设置」→ 「它的助手设置/扩展设置」；「即梦 CLI」→ 面向用户不必出现 CLI（说「即梦本机出图」之类）。中英同步（R15）。
- **说清方向**：两处卡片各加一句点明谁用谁。

---

## 三、不动项（明确划界，防蔓延）

- 第三闸 `unreachableReferenceLabels` 逻辑与文案不动（本轮刚修完并有测试）。
- `characterIndexed` 机制不动。
- `@` 芯片这个通用写作功能不动（它跨模型一致，是好东西）。
- 扩充 native-wire 白名单 = W1 第二步，**本轮不做**，待 W1 第一步落地后单独排。
- ComfyUI 多图通道 = 独立缺口，本轮只在 W1 里如实收窄显示，不新建通道。
- `styleReferenceImages`/`characterReferenceImages`/`compositionReferenceImages` 在 electron 侧无人读（连了也不进请求）——独立缺口，本轮不碰（纳入闸门会全量误拦）。

## 四、验收门

1. 五门全过（`pnpm run gates`，显式验退出码）。
2. 新增测试：
   - `reachableReferenceSlotKinds` 纯函数矩阵（专用 codec 零收窄 / 通用中转正确收窄 / 未知键不误杀）。
   - 收窄结果与第三闸判定**一致性测试**（同一模型+渠道，UI 认为能发的，闸门必须放行；UI 收掉的，闸门必须拒）——这是防漂移的结构保证。
   - Codex 联动删除后：接入 MCP 不再改动模型目录（回归测试）。
3. R13 真机走查：
   - 用通用中转接入一个视频模型 → 节点上「首尾帧/全能参考」应当**不可选或槽不显示**，且给出人话原因。
   - 图片节点在「认得档案」与「认不出」两种模型下**排版与标签一致**。
   - 截图自己 Read 亲眼看过（眼见链）。
4. i18n 门（`check:i18n`）：新增文案中英齐全。

## 五、回滚

三条 workstream 相互独立、分开 commit。W1 若收窄误伤，单独 revert W1 那个 commit 即可恢复「显示全部槽 + 生成时拒发」的现状（第三闸仍在，不会退回静默丢）。
