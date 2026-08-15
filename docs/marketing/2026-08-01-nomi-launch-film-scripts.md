# Nomi 国际宣传片成片脚本

日期：2026-08-01  
版本：中文 60 秒母版 / 英文 60 秒适配稿  
核心主张：**不只是写提示词，而是把镜头真正导出来。** / **Direct the shot. Not just the prompt.**

## 中文 60 秒母版

| 时间 | 旁白 | 屏幕短句 | 画面正在证明什么 |
|---|---|---|---|
| 00–04s | 你知道镜头该是什么样，但模型只能猜。 | 不只是提示词 | 摩擦不是“不会写提示词”，而是镜头意图无法被稳定表达。 |
| 04–12s | Nomi 把故事、分镜和生成放进同一个上下文。 | 故事 → 分镜 → 生成 | 脚本文案、拆镜头和生成助手在同一条创作路径中。 |
| 12–24s | 先固定人物、场景、道具和风格，让每个镜头继承同一个世界。 | 先固定世界，再生成镜头 | 视觉锚点和镜头连接关系承担跨镜一致性的组织工作。 |
| 24–35s | 在画布上直接组织镜头，让助手写提示词、放素材、调用生成。 | 导演画布 | 创作者能看到镜头关系，同时让助手执行具体动作。 |
| 35–43s | 看到合适的参考，直接采集、反推并复用，不用来回搬运。 | 采集 · 反推 · 复用 | 浏览器素材进入项目，画面可被反推为提示词并回到画布。 |
| 43–50s | 接入自有模型、ComfyUI 和 AI 助手，不被单一供应商锁住。 | Bring your own stack | 稳定展示模型列表、ComfyUI 与 Claude Code / Codex / Cursor 入口。 |
| 50–55s | 从意图到时间线，成为一条连续的导演流程。 | 从意图，到时间线 | 生成结果最终回到可预览、可收束的时间线。 |
| 55–60s | 下载开源版 Nomi。定制、集成、贴牌，联系团队。 | 下载开源版 / For Teams | 个人用户立即下载；团队进入定制、集成、贴牌与持续演进合作。 |

### 中文旁白纯文本

> 你知道镜头该是什么样，但模型只能猜。
>
> Nomi 把故事、分镜和生成放进同一个上下文。
>
> 先固定人物、场景、道具和风格，让每个镜头继承同一个世界。
>
> 在画布上直接组织镜头，让助手写提示词、放素材、调用生成。
>
> 看到合适的参考，直接采集、反推并复用，不用来回搬运。
>
> 接入自有模型、ComfyUI 和 AI 助手，不被单一供应商锁住。
>
> 从意图到时间线，成为一条连续的导演流程。
>
> 下载开源版 Nomi。定制、集成、贴牌，联系团队。

## English 60-second adaptation

| Time | Voice-over | On-screen line | Proof on screen |
|---|---|---|---|
| 00–04s | You know the shot. The model can only guess. | Direct the shot. | The problem is lost directing intent, not a missing prompt trick. |
| 04–12s | Nomi keeps the story, storyboard, and generation context connected from the first line. | Story → storyboard → generation | Writing, shot breakdown, and generation live in one creative path. |
| 12–24s | Lock characters, locations, props, and style first, so every shot inherits the same world instead of restarting from another prompt. | Build the world first. | Visual anchors and shot relationships carry context across the sequence. |
| 24–35s | Build on a visual canvas. Let the assistant draft prompts, place media, and call generation tools while you keep the whole sequence in view. | The directing canvas | The assistant acts inside a visible, editable shot system. |
| 35–43s | Found the right reference? Capture it, reverse the prompt, and reuse it without changing tools. | Capture · reverse · reuse | Browser research becomes reusable project media and prompt context. |
| 43–50s | Connect your models, ComfyUI, and AI coding assistants without locking into one provider. | Bring your own stack. | The product shows the real integration surfaces, not a conceptual logo wall. |
| 50–55s | From intent to timeline, directing becomes one continuous workflow. | Intent → timeline | Generated material resolves into a timeline the creator can finish. |
| 55–60s | Download Nomi. For custom or white-label builds, talk to us. | Download Nomi / For Teams | Self-serve download remains primary; team services are an honest secondary path. |

### English voice-over copy

> You know the shot. The model can only guess.
>
> Nomi keeps the story, storyboard, and generation context connected from the first line.
>
> Lock characters, locations, props, and style first, so every shot inherits the same world instead of restarting from another prompt.
>
> Build on a visual canvas. Let the assistant draft prompts, place media, and call generation tools while you keep the whole sequence in view.
>
> Found the right reference? Capture it, reverse the prompt, and reuse it without changing tools.
>
> Connect your models, ComfyUI, and AI coding assistants without locking into one provider.
>
> From intent to timeline, directing becomes one continuous workflow.
>
> Download Nomi. For custom or white-label builds, talk to us.

## 逐镜素材来源图

时间均为原始素材时间，不是成片时间。所有录屏片段默认静音，最终旁白独立生成。

| 成片范围 | 主素材与精确源范围 | 选择理由 | 备用素材 | 禁用边界 |
|---|---|---|---|---|
| 00–04s | demo.mp4 00:35–00:39，后续由全屏品牌动效覆盖 | 用真实 Nomi 作品画面做底，不从黑帧起片；品牌动效仍是视觉主体。 | nomi-logo.svg + 暖纸色全屏动效 | demo.mp4 00:00 黑帧 |
| 04–12s | 完整录屏 00:47.5–00:55.5 | AI 助手建议动作进入生成配置，8 秒内同时看到“助手”和“镜头设置”的连接。 | 完整录屏 00:30–00:38 的脚本编辑器；demo.mp4 00:05–00:09 | 鼠标长时间游移、空白等待 |
| 12–24s | 完整录屏 02:14–02:26 | 从视觉锚点配置进入画布关系，能看到人物、场景、道具/镜头节点，而不是只听口播。 | 完整录屏 02:31–02:43；screen-3d.png 只作补充，不冒充视觉锚点 UI | 仅有说明文字、没有锚点证据的段落 |
| 24–35s | 完整录屏 03:05–03:16 | 生成画布和右侧助手同屏，能看到助手动作与镜头节点的直接关系。 | 完整录屏 03:23–03:34 | 只展示素材库或分组说明的远景 |
| 35–39s | 完整录屏 07:00–07:04 | 浏览器与素材盒同屏，证明参考素材被采集进项目。 | 完整录屏 06:52–06:56 | 登录提示、抓取失败 |
| 39–43s | 完整录屏 08:06–08:10 | 反推后的提示词/素材回到画布，证明“反推并复用”的结果。 | 完整录屏 08:16–08:20 | 后台等待、结果尚未出现 |
| 43–50s | 完整录屏 09:13–09:20 | 模型/助手接入面板和列表稳定可见，覆盖 Codex、模型入口与 ComfyUI 邻近区域。 | 完整录屏 09:20–09:27 | 09:55–10:06 供应商不稳定说明 |
| 50–55s | 完整录屏 10:36–10:41 | 画布下方时间线已经展开，画面干净，没有进入后续生成失败状态。 | marketing/assets/screen-timeline.png；demo.mp4 00:05–00:09 | 10:42 之后任何可见生成失败或空白状态 |
| 55–60s | demo.mp4 00:38–00:43，后续由全屏 CTA 动效覆盖 | 用真实成片结果支撑“下载 / 团队方案”，结尾不落回空白 UI。 | nomi-logo.svg + 暖纸色全屏 CTA | 未核验的客户或合作案例 |

## 声音与字幕节奏

- 旁白按八个语义段分别生成，允许在剪辑中单独替换；不把整段锁成一个音频文件。
- 中文语速目标为克制的产品纪录片语气，句间保留约 0.18–0.35 秒呼吸。
- 英文按英语自然重音重写，不逐字追随中文断句；“ComfyUI”与“Nomi”必须在试听时核对发音。
- 字幕只显示“屏幕短句”或旁白的语义短句，不逐字蹦字；同屏最多两行。
- 最终中文声线：豆包 `liuchang`；最终英文声线：ElevenLabs `peter`。两版均按八段独立生成，并以真实音频时长回填时间线。

## 事实与宣称审计

- 已移除未经证实的最高级、竞争性和全量兼容等绝对宣称。
- “开源版”来自项目当前定位；正式发布前需再次核对 README 的许可证与下载入口。
- “定制、集成、贴牌”是团队服务能力，不表述为已经交付过的客户案例。
- “不被单一供应商锁住”由片中展示的自有模型、ComfyUI 和多个 AI 助手接入面板共同支持，不承诺兼容任意供应商。
