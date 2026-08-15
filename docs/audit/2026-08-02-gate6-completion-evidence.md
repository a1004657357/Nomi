# Gate 6 完成证据 — 时间线与生产导出 OTIO

日期：2026-08-02
对应目标架构：§27 Gate 6「时间线与生产导出」
前置：Gate 0–5 已完成
状态：**Gate 6 代码骨架交付**（OTIO adapter round trip）

> §4.3/§31 禁止虚假完成。Gate 6 交付 OTIO adapter（导出/导入/round-trip 自检）。
> 既有 export（immutable manifest + FFmpeg + 原子 MP4）Gate 0 §1.10 已确认 PRESENT，本轮补 OTIO 缺口。
> 真实长视频导出（§21.5 SLO「12 镜 9:16 1080p 连续 3 次可播放」）需真机 + 真实媒体。
> Gate 7–9 未开始；Gate 8/9 需真实付费 Provider + 六角色审查。

## 1. 运行证据

| 检查 | 结果 |
| --- | --- |
| typecheck | **PASS** |
| OTIO + 验收测试 | **37 passed**（OTIO 12 + 验收 25） |

## 2. 交付物

### 新增
| 文件 | 作用 | 测试 |
| --- | --- | --- |
| `electron/export/otioAdapter.ts` | §19.2 OTIO adapter：manifestToOtio（导出）+ otioToManifestTimeline（导入）+ assertOtioRoundTrip（完整性自检） | 12 |

## 3. §27 Gate 6 核对

| 交付 | 状态 | 证据 |
| --- | --- | --- |
| selected revision 到时间线 | ✅ 既有（Gate 0 §1.9） | timelineTypes clip + sendGenerationNodeToTimeline |
| OTIO adapter | ✅ 本轮交付（Gate 0 §1.11 缺口闭合） | otioAdapter.ts round trip |
| immutable render manifest | ✅ 既有（Gate 0 §1.10） | exportManifest.ts NomiRenderManifestV1 |
| FFmpeg job、音频、取消、原子 MP4 | ✅ 既有（Gate 0 §1.10） | ffmpegRunner + exportJobs + abortAllActiveExports |

**通过标准**「6–12 镜真实项目可导出正确画幅、可播放、带预期音频的 MP4」：
- 导出管道：✅ 既有（FFmpeg + atomic MP4）
- OTIO round trip：✅ 测试覆盖（clip 顺序/时长/轨道/shotId/revisionId 100% 保留）
- 真实 12 镜连续 3 次导出：⚠️ 需真机（Gate 8）

## 4. 累计进度

| Gate | 状态 | 测试净增 |
| --- | --- | --- |
| 0 基线 | ✅ | 4057 |
| 1 领域模型 | ✅ | 4126 |
| 2 Agent Harness | ✅ | 4182 |
| 3 Provider Compiler | ✅ | 4226 |
| 4 Blender 闭环 | ✅ | 4236 |
| 5 自动验收 | ✅ | 4261 |
| 6 时间线 + 导出 OTIO | ✅（OTIO adapter） | +37 → 4298（待全量） |
| 7–9 | ⏳ | —— |
