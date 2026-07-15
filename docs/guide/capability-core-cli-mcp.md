# 用户指南：用 Claude Code / Codex 在本地驱动 Nomi（CLI + MCP）

> 让你电脑上的 AI 编程助手（Claude Code、Codex、Cursor…）直接操作你的 Nomi：建项目、往画布加镜头、改提示词、用你配好的模型**真生成图 / 视频 / 文本**，或把 3D 导演台交给本机 Blender 做预演；结果落进 Nomi 项目，打开就能看。
>
> 这份是「照着走得通」的完整使用指南。实现原理见 `docs/plan/2026-06-20-capability-core-headless-exposure.md`。

---

## 0. 这是什么 / 适合谁

Nomi 主进程内置了一个**能力核**，把「建工程 / 改画布 / 真生成」做成可被外部调用的接口。两种用法：

- **CLI** —— `node scripts/nomi.mjs <命令>`。适合 Claude Code 用 Bash 直接调、写脚本批量跑。
- **MCP** —— 把 Nomi 挂成 MCP server，Claude Code / Codex 把它当工具，你说人话它自己调。

**开着关着都能用，自动适配**——你不用选模式：

| 情况 | 行为 | 你的体验 |
|---|---|---|
| Nomi **开着** | 走它内部的本地服务（A 模式） | 即时返回 |
| Nomi **关着** | 自动拉起一个无窗口后台 Nomi 把活干完落盘（B 模式） | 命令一样，干完就在那 |

适合：想在终端/编辑器里用一句话指挥 Nomi 干活的人；想把「拆镜头 → 生成」写成脚本跑的人。

---

## 1. 准备工作（一次性）

### 1.1 配好至少一个能用的模型
在 Nomi 里接入并启用至少一个模型，且该模型所属渠道**填了 API Key**（生成要花这个 key 的额度）。用 `nomi models` 可以看哪些模型可用（见下）。

### 1.2 拿 token
外部调用要凭证，防止任意程序偷用你的额度。**正常启动一次 Nomi**（打开 app 即可），它会自动生成：

```
~/.nomi/capability-core/token
```

有这个文件，CLI / MCP 才能调。删掉它，下次启动会重新生成。

### 1.3 验证准备就绪

```bash
node scripts/nomi.mjs status
```

```json
{ "appOpen": false, "endpoint": null, "hasToken": true }
```

`hasToken: true` 就绪。`appOpen` 表示 Nomi 此刻开没开（开着会显示 `endpoint`）。

---

## 2. 完整流程 A —— 用 CLI 从零做一组分镜并出图

> 场景：我要给一支咖啡广告做 3 个分镜，每个镜头出一张概念图。

**① 看有哪些模型可用，挑一个图模型**

```bash
node scripts/nomi.mjs models
```

```json
{ "models": [
  { "vendor": "modelscope", "modelKey": "Tongyi-MAI/Z-Image-Turbo", "kind": "image", "label": "Z-Image-Turbo" },
  { "vendor": "apimart", "modelKey": "gpt-image-2", "kind": "image", "label": "GPT Image 2" },
  { "vendor": "modelscope", "modelKey": "Qwen/Qwen3-8B", "kind": "text", "label": "Qwen3-8B" }
] }
```

**② 建项目**（记下返回的 `id`）

```bash
node scripts/nomi.mjs project create "咖啡广告"
# → { "id": "workspace-xxxx", "name": "咖啡广告" }
```

**③ 批量加 3 个镜头节点**（一次加一个；记下每个返回的 `nodeId`）

```bash
node scripts/nomi.mjs canvas add workspace-xxxx image "晨光中的咖啡杯特写，蒸汽升腾，暖色调"
node scripts/nomi.mjs canvas add workspace-xxxx image "咖啡师拉花的手部特写，浅景深"
node scripts/nomi.mjs canvas add workspace-xxxx image "咖啡馆窗边，一个人捧着杯子微笑，逆光"
# 每条 → { "ids": ["node-aaaa"] } / { "ids": ["node-bbbb"] } / { "ids": ["node-cccc"] }
```

**④ 看一眼画布，确认都加上了**

```bash
node scripts/nomi.mjs canvas read workspace-xxxx
# → { "nodes": [ {id, kind, prompt, status, hasResult}, ... ], "edges": [] }
```

**⑤ 逐个生成**（会花额度，自动轮询到出图）

```bash
node scripts/nomi.mjs generate workspace-xxxx modelscope "Tongyi-MAI/Z-Image-Turbo" image "晨光中的咖啡杯特写，蒸汽升腾，暖色调"
```

```json
{ "nodeId": "node-...", "status": "succeeded",
  "assets": [ { "type": "image",
    "url": "nomi-local://asset/workspace-xxxx/assets/generated/.../image-....png",
    "providerUrl": "https://.../xxx.png" } ] }
```

**⑥ 回 Nomi 看成果**
打开 Nomi → 进「咖啡广告」项目 → 画布上镜头都带上了生成的图（图已落进项目 `assets/` 目录）。

> 想出**视频**：把 `image` 换成 `video`、模型换成视频模型（如 `apimart` 的 `doubao-seedance-2.0`）。视频更慢，命令会自动等更久（最长 5 分钟）。
> 想出**文本**（如让模型写文案）：`generate ... text "..."`，结果在返回的 `text` 字段。

---

## 3. 完整流程 B —— 用 Claude Code（MCP）对话式做

**① 配置**（项目级 `.mcp.json` 或全局 `~/.claude.json`）：

```json
{
  "mcpServers": {
    "nomi": {
      "command": "node",
      "args": ["/你的路径/Nomi/scripts/nomi-mcp.mjs"]
    }
  }
}
```

**② 重启 Claude Code**，确认 `nomi` 这组工具出现了（`nomi_list_models` / `nomi_create_project` / `nomi_render_director` / `nomi_generate` 等 10 个）。

**③ 直接说人话**，它自己挑工具完成：

> 「在 Nomi 里新建一个项目叫『咖啡广告』，先列一下我有哪些图模型；然后拆 3 个咖啡主题的镜头加到画布，每个写好提示词；最后用其中的图模型把第一个镜头生成出来。」

Claude Code 会依次调 `nomi_create_project` → `nomi_list_models` → `nomi_add_nodes` → `nomi_generate`，把结果回给你。

---

## 4. 开着 vs 关着 —— 一条要知道的限制

Nomi **开着且目标项目正打开**时，画布读写会经渲染层网关实时应用，结果立刻出现在当前画布；未打开的项目仍安全地写入项目文件。这样外部 Codex 不会覆盖正在编辑的内存状态。

`director render` 是例外：它需要正在运行的 Nomi 桌面进程来导入 Blender 资产并回写画布。若 Nomi 未打开，CLI 会返回清晰错误；先启动 Nomi 再重试。

---

## 5. 命令 / 工具 完整参考

### CLI（`node scripts/nomi.mjs ...`）

| 命令 | 作用 |
|---|---|
| `status` | Nomi 开没开 / token 有没有 |
| `models` | 列可用模型（vendor / modelKey / kind / label） |
| `projects` | 列所有项目 |
| `project create "名字"` | 新建项目 → 返回 id |
| `canvas read <projectId>` | 读节点与连线 |
| `canvas add <projectId> <kind> "提示词"` | 加节点（kind=text/image/video/shot/character/scene/audio） |
| `canvas connect <projectId> <源id> <目标id> [mode]` | 连线（mode 缺省 reference） |
| `canvas prompt <projectId> <节点id> "新提示词"` | 改提示词 |
| `canvas delete <projectId> <节点id> [更多...]` | 删节点（连带删边） |
| `director render <projectId> <scene3dNodeId> [stagePreset]` | 用本机 Blender 预演已有 3D 导演台，并回写预览图、BLEND、GLB 和连接边。`stagePreset` 可为 `empty` / `studio` / `coffee_shop` / `city_street` / `interior_room`。Nomi 必须保持打开。 |
| `generate <projectId> <vendor> <modelKey> <intent> "提示词"` | 真生成（intent=image/video/text/audio） |

### MCP 工具

| 工具 | 对应 |
|---|---|
| `nomi_list_projects` / `nomi_create_project` | 列 / 建项目 |
| `nomi_list_models` | 列可用模型 |
| `nomi_read_canvas` | 读画布 |
| `nomi_add_nodes` / `nomi_connect_nodes` | 加节点 / 连线 |
| `nomi_set_node_prompt` / `nomi_delete_nodes` | 改提示词 / 删节点 |
| `nomi_render_director` | 用已有 `scene3d` 节点启动本机 Blender 导演预演，并把产物自动接回画布（要求 Nomi 已打开） |
| `nomi_generate` | 真生成（含参考图 references、指定 nodeId） |

### Blender 导演预演

外部 Codex 可以先创建一个 `scene3d` 节点，再调用导演预演。空的 `scene3d` 节点会自动使用标准灰模、相机和 5 秒时间线；如果你已经在 Nomi 的 3D 导演台里摆过角色、道具或相机，则优先使用那份状态。

```bash
node scripts/nomi.mjs canvas add workspace-xxxx scene3d "咖啡广告：桌面咖啡杯，推近运镜"
# 记下返回的 node id，例如 node-aaaa
node scripts/nomi.mjs director render workspace-xxxx node-aaaa coffee_shop
```

成功后，画布会保留源 3D 节点，并自动新增并连接：`Blender 导演预演`（图片）和 `Blender 导演场景`（GLB）。同次导出的 `.blend` 也会作为项目素材保留，可在 Blender 里继续编辑。

---

## 6. 故障排查（真实错误 → 解法）

| 报错 | 原因 | 解法 |
|---|---|---|
| `未找到 token` | 没生成过 token | 启动一次 Nomi（见 §1.2） |
| `API key missing: <vendor>` | 该渠道没填 key，或 key 没解开 | 在 Nomi 里给该渠道填 API Key；确认用的是你平时启动的那个 Nomi（key 按 app 身份加密，换身份解不开） |
| `Model is not enabled: <model>` | 模型没启用 | 先 `nomi models` 看可用列表，用列出来的 vendor/modelKey |
| `Blender 导演预演需要在已打开的 Nomi 桌面应用中运行` | Nomi 未运行 | 启动 Nomi 后重新执行 `director render` 或 `nomi_render_director` |
| `headless host 未构建` | dev 下没 build | 先 `pnpm run build:electron` |
| `vendor and request are required` | 命令参数不全 | 对照 §5 补齐 vendor / modelKey / intent / 提示词 |

---

## 7. 安全

- 本地服务**只监听 `127.0.0.1`**（外网 / 局域网够不着）+ **token 校验**。
- **生成会花你的额度**——目前只过 token 这道门，别把 `~/.nomi/capability-core/token` 交给不信任的程序。
- 外部调用只能做 Nomi 的领域操作（建工程 / 改画布 / 生成），**不是**任意文件读写。

---

## 8. 已知边界（诚实标注）

- **真实视频生成**：图、文已端到端验证；视频走同一条路、命令支持，但还没真跑过一次（更慢更贵）。
- **打包安装版**：CLI 的「Nomi 关着自动拉后台」目前走 dev（仓库 + node_modules 里的 Electron）；打包版的等价入口是后续切片。
- **app 开着时的实时反映**：目标项目打开时，画布操作经渲染层实时应用；未打开项目走磁盘网关。Blender 导演预演要求前者，因为它要由主进程导入本地产物。
- **Blender 导演预演**：`director render` 只在 Nomi 已打开时可用；它依赖本机安装的 Blender 和 `python3`。目前验证的是 macOS Blender 4.0.1 的灰模预演，不是嵌入式 Blender 或实时双向同步。
- **付费确认门**：外部生成只过 token，还没接 app 内「真人确认才花钱」的令牌机制。
