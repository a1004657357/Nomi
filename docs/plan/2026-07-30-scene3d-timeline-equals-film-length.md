# 第 3 期 · 时间轴 = 成片长度（所见即所得）

> 日期：2026-07-30 · 状态：**实现中**（第 0-2 期已并 main `2d318491`；本期承接 [2026-07-26 全盘方案](2026-07-26-scene3d-export-and-timeline-alignment.md) §第3期）
> 方法：亲读真实代码钉根因（下每条带 file:line），不凭印象。

## 0. 根因（真实代码）

`totalDuration`（`state.sceneTimeline.totalDuration`）是**只增不减**的中心状态：
- **只增**：新绑定 `endTime = totalDuration`（[useScene3DTrajectoryEditing.ts:58](../../src/workbench/generationCanvas/nodes/scene3d/useScene3DTrajectoryEditing.ts:58)）；`patchBinding` 只把 totalDuration 涨到 `max(totalDuration, endTime)`（:386-403）；预设/录 take 各自把它顶高。
- **从不减**：`deleteBinding`（:442）、`unbindObject`（:429）、`deleteTrajectory`（:235）删内容后**都不动 totalDuration**——删掉长绑定后尺子还停在旧高点。
- **后果**：时间轴显示长度 = 历史最高点 ≠ 当前成片长度（偏长）；导出得靠 `exportWithState` 专门裁一刀（[useScene3DFullscreenActions.ts:719-727](../../src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:719) 的 `motionEnd` 补丁）才对——**尺子与成片两套长度**，补丁在下游擦屁股。

**根因一句话**：totalDuration 是「历史最大值」不是「当前内容长度」，删/缩内容不回收。

## 1. 目标与不变量

**目标**：totalDuration = 当前成片长度（= 所有绑定 endTime 与角色 poseTrack 关键帧时间的最大值），随内容增删**双向**同步；导出裁尾补丁随根因消失而删（P1 加新删旧）。

**不变量**：
- 单一真相：`sceneContentEndSeconds(state)` = 内容真实终点，唯一来源；totalDuration、导出都读它（P1 无并行版）。
- 拖动不闪：拖绑定条时**冻结**参考系（不同步 totalDuration），松手一次性重算 —— 否则「拖右沿→endTime 涨→totalDuration 涨→同像素更多秒→endTime 涨更快」正反馈（现象=拖动跳动）。
- 录 take / 预设行为不变：录 take 仍显式 `totalDuration = durationSeconds`（其绑定 endTime 本就 = duration，与新同步一致）；预设仍追加式增长（同步只读 maxEnd，与只增结果一致）。
- 空场景兜底：无内容 → totalDuration = `DEFAULT_SCENE_TIMELINE_DURATION`(10)（空时间轴不塌成 0）。

## 2. 为什么测试全安全（关键论证）

三处锁 totalDuration 的测试，其场景 **content-end 恰 === totalDuration**（绑定就是按 duration 建的），故「同步 = content-end」在这些**增长**场景与现状**逐字节相同**，只在**收缩**（删/缩，无测试覆盖）时才有新行为：
- `takeRecording.test.ts:148/385` `=== 4`：录 take 绑定 `buildTakeBinding(...,0,duration=4)` → maxEnd=4 → 同步=4 ✅
- `cameraMovePreset.test.ts:141` `>= 4`、`:149` `=== 11`：预设建绑定 endTime=该值 → maxEnd=该值 → 同步同值 ✅
- `cameraMoveBuilder.test.ts:94` `=== duration`（且 :95 `binding.endTime === duration`）→ maxEnd=duration ✅

## 3. 改动（全在 live 路径，死码 `useScene3DTrajectoryEditor.ts`/`scene3dTrajectoryState.ts` 不碰，另单清理）

1. **单源纯函数**（`useScene3DTrajectoryEditing.ts`，export 供导出复用）：
   - `sceneContentEndSeconds(state)` = `max(0, ...binding.endTime, ...object.poseTrack[].time)`。
   - `syncSceneTimelineDuration(state)` = 把 totalDuration 置为 `content>0 ? content : DEFAULT`（值未变则原样返回，省新对象）。
2. **写路径双向同步**：`addObjectTrajectoryBinding` 结果过 sync；`deleteBinding`/`unbindObject`/`deleteTrajectory` 结果过 sync；`patchBinding` **改纯**（去掉 grow，只 patch 绑定）——拖动期间 totalDuration 自然冻结（prop 稳定），无正反馈。
3. **提交式重算**：新增 hook 动作 `syncTimelineDuration()`；`TrajectoryTimeline` 绑定条拖动 `pointerup` 调它（松手一次性 re-fit）；`TrajectoryPanel` 数字输入（start/end）改完调它。两处经 `onCommitTimeline` prop 从 `scene3dMoveHub`/`scene3dTrajectorySurfaces` 注入 `trajectory.syncTimelineDuration`。
4. **删导出裁尾补丁**（P1 根治）：`exportWithState` 去掉 `motionEnd < totalDuration ? 裁 : 源`，直接用 source（totalDuration 现已恒 = content-end）。
5. **加载即同步**：`scene3dSerializer` 反序列化后过 sync —— 老工程存的 stale-high totalDuration 一并回收（迁移-free，派生即正确），使补丁彻底无依赖可删。

## 4. 有意取舍（诚实标注 D4）

- **拖绑定条右沿只能在当前成片长度内调**（最长那条绑定已在右边缘、拖不出去）。**延长时长走属性面板 endTime 数字输入**（本就无上限、改完 sync）。理由：避免「拖动即改参考系」的正反馈 + 保持拖动零闪；延长非高频、数字输入更精确。
- totalDuration **自动**派生、不做「显式可编辑总时长」控件（方案 §第3期 二选一里选自动）——effect-first、零新 UI、所见即所得（D1/D4）。

## 5. 验收门

`pnpm run gates` 五门全过 + R13 真机走查：应用 3s 预设→时间轴显示≈3s（非 10s）；删一条长绑定→尺子回缩到剩余内容；拖绑定条右沿不跳动、松手 re-fit；导出 mp4 时长 = 时间轴显示长度（逐帧核）。截图人眼判断。
