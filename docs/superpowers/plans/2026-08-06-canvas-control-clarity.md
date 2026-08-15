# 生成画布控件辨识与比例连续性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让生成数量、自动比例、左侧节点入口和顶栏按钮第一次使用就可辨识，并让比例切换保持节点视觉面积、编辑框连接与参数浮层位置连续。

**Architecture:** 几何规则收敛到 `nodeSizing.ts` 的纯函数，比例参数变化在 `NodeParameterControls` 中一次性提交 meta、size、position，删除 composer 的冻结补偿链。数量和自动项只改变展示/选择层，左栏与顶栏复用现有设计系统 Tooltip、NomiSelect 和 WorkbenchButton，不新增平行组件体系。

**Tech Stack:** React 18、TypeScript、Zustand、Mantine Combobox、Radix Tooltip、Tailwind token、Vitest、Playwright。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/workbench/generationCanvas/nodes/nodeSizing.ts` | 面积守恒尺寸、top/bottom 锚点与原子节点 patch 纯计算 |
| `src/workbench/generationCanvas/nodes/nodeSizing.aspectRatio.test.ts` | 比例、面积、边界、锚点回归测试 |
| `src/workbench/generationCanvas/nodes/parameterOptionPresentation.ts` | `auto` 值的本地化展示判断，保持内部值不变 |
| `src/workbench/generationCanvas/nodes/parameterOptionPresentation.test.ts` | 中英文自动项与普通比例展示测试 |
| `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx` | 自动比例图标/本地化、固定触发器、居中静止浮层 |
| `src/workbench/generationCanvas/nodes/NodeParameterControls.tsx` | 识别比例参数并原子提交 meta/size/position |
| `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx` | 显式 1–4 数量选择，传入 composer 连接侧，删除 freezeShift |
| `src/i18n/locales/generationCommon.ts` | 数量选择中英文文案 |
| `src/workbench/generationCanvas/components/CanvasToolbar.tsx` | 8 个直接入口、分组与 styled tooltip |
| `src/ui/app-shell/NomiAppBar.tsx` | 任务/辅助/配置/主动作四组布局 |
| `src/workbench/taskCenter/TaskCenterButton.tsx` | 队列图标、任务文字和数量徽标 |
| `tests/ux/canvas-control-clarity.walk.mjs` | 真机比例连续性、数量、tooltip、顶栏旅程与截图 |

### Task 1: 面积守恒与连接锚点纯函数

**Files:**
- Create: `src/workbench/generationCanvas/nodes/nodeSizing.aspectRatio.test.ts`
- Modify: `src/workbench/generationCanvas/nodes/nodeSizing.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { anchorNodePosition, resolveAreaPreservingSize } from './nodeSizing'

describe('resolveAreaPreservingSize', () => {
  const bounds = { minWidth: 240, maxWidth: 680, minHeight: 120, maxHeight: 520 }

  it.each([1, 21 / 9, 9 / 16])('保持比例与近似面积：%s', (ratio) => {
    const next = resolveAreaPreservingSize({ width: 381, height: 381 }, ratio, bounds)
    expect(next.width / next.height).toBeCloseTo(ratio, 2)
    expect(next.width * next.height).toBeCloseTo(381 * 381, -3)
  })

  it('超过边界时整体缩放，不破坏目标比例', () => {
    const next = resolveAreaPreservingSize({ width: 680, height: 520 }, 21 / 9, bounds)
    expect(next.width).toBeLessThanOrEqual(680)
    expect(next.height).toBeLessThanOrEqual(520)
    expect(next.width / next.height).toBeCloseTo(21 / 9, 2)
  })
})

describe('anchorNodePosition', () => {
  const position = { x: 100, y: 80 }
  const current = { width: 380, height: 380 }
  const next = { width: 580, height: 250 }

  it('下置 composer 保持底边中心', () => {
    const anchored = anchorNodePosition(position, current, next, 'bottom')
    expect(anchored.x + next.width / 2).toBe(position.x + current.width / 2)
    expect(anchored.y + next.height).toBe(position.y + current.height)
  })

  it('上置 composer 保持顶边中心', () => {
    const anchored = anchorNodePosition(position, current, next, 'top')
    expect(anchored.x + next.width / 2).toBe(position.x + current.width / 2)
    expect(anchored.y).toBe(position.y)
  })
})
```

- [ ] **Step 2: 运行并确认红灯**

Run: `pnpm vitest run src/workbench/generationCanvas/nodes/nodeSizing.aspectRatio.test.ts`

Expected: FAIL，提示 `resolveAreaPreservingSize` / `anchorNodePosition` 未导出。

- [ ] **Step 3: 写最小纯函数实现**

```ts
export type ComposerAttachmentSide = 'top' | 'bottom'

export function resolveAreaPreservingSize(
  current: { width: number; height: number },
  targetRatio: number,
  bounds: NodeSizeBounds,
): { width: number; height: number } {
  const area = Math.max(1, current.width * current.height)
  const raw = {
    width: Math.sqrt(area * targetRatio),
    height: Math.sqrt(area / targetRatio),
  }
  const maxScale = Math.min(bounds.maxWidth / raw.width, bounds.maxHeight / raw.height)
  const minScale = Math.max(bounds.minWidth / raw.width, bounds.minHeight / raw.height)
  const scale = minScale <= maxScale ? clampNumber(1, minScale, maxScale) : maxScale
  return { width: Math.round(raw.width * scale), height: Math.round(raw.height * scale) }
}

export function anchorNodePosition(
  position: { x: number; y: number },
  current: { width: number; height: number },
  next: { width: number; height: number },
  side: ComposerAttachmentSide,
): { x: number; y: number } {
  return {
    x: position.x + (current.width - next.width) / 2,
    y: side === 'bottom' ? position.y + current.height - next.height : position.y,
  }
}

export function buildAspectRatioNodePatch(
  node: GenerationCanvasNode,
  nextMeta: Record<string, unknown>,
  targetRatio: number | null,
  side: ComposerAttachmentSide,
): Partial<GenerationCanvasNode> {
  if (!targetRatio || node.result?.url) return { meta: nextMeta }
  const current = resolveNodeVisualSize(node)
  const size = resolveAreaPreservingSize(current, targetRatio, getNodeSizeBounds(node.kind))
  return { meta: nextMeta, size, position: anchorNodePosition(node.position, current, size, side) }
}
```

- [ ] **Step 4: 运行新测试与既有视觉尺寸测试**

Run: `pnpm vitest run src/workbench/generationCanvas/nodes/nodeSizing.aspectRatio.test.ts src/workbench/generationCanvas/nodes/nodeSizing.visualSize.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/workbench/generationCanvas/nodes/nodeSizing.ts src/workbench/generationCanvas/nodes/nodeSizing.aspectRatio.test.ts
git commit -m "feat(canvas): preserve node area across aspect ratios"
```

### Task 2: 比例原子更新并删除冻结补偿

**Files:**
- Modify: `src/workbench/generationCanvas/nodes/NodeParameterControls.tsx`
- Modify: `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx`
- Modify: `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx`
- Test: `src/workbench/generationCanvas/nodes/nodeSizing.aspectRatio.test.ts`

- [ ] **Step 1: 扩充失败测试，覆盖一次 patch 所需结果**

在测试中加入候选节点几何断言：用 `buildAspectRatioNodePatch` 取得一次 `updateNode` 所需的完整 meta/size/position patch，再断言连续切换不漂移。

```ts
it('连续 1:1 → 21:9 → 9:16 时锚点不累积漂移', () => {
  const startPosition = { x: 100, y: 80 }
  const square = { width: 381, height: 381 }
  const wide = resolveAreaPreservingSize(square, 21 / 9, bounds)
  const widePosition = anchorNodePosition(startPosition, square, wide, 'bottom')
  const tall = resolveAreaPreservingSize(wide, 9 / 16, bounds)
  const tallPosition = anchorNodePosition(widePosition, wide, tall, 'bottom')
  expect(tallPosition.x + tall.width / 2).toBeCloseTo(startPosition.x + square.width / 2)
  expect(tallPosition.y + tall.height).toBeCloseTo(startPosition.y + square.height)
})
```

- [ ] **Step 2: 运行并确认测试先失败**

Run: `pnpm vitest run src/workbench/generationCanvas/nodes/nodeSizing.aspectRatio.test.ts`

Expected: FAIL，直到连续切换舍入/边界行为正确。

- [ ] **Step 3: 在参数层增加单次比例更新入口**

`NodeParameterControlsProps` 用连接侧替代旧开合回调：

```ts
type NodeParameterControlsProps = {
  node: GenerationCanvasNode
  section?: 'all' | 'references' | 'parameters' | 'model' | 'controls'
  onInsertMention?: (url: string) => void
  composerAttachmentSide?: ComposerAttachmentSide
}
```

比例参数分支构造一次 patch：

```ts
const updateAspectRatioMeta = (metaPatch: Record<string, unknown>, ratio: number | null) => {
  const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
  if (!latest) return
  const nextMeta = { ...(latest.meta || {}), ...metaPatch }
  updateNode(
    node.id,
    buildAspectRatioNodePatch(latest, nextMeta, ratio, composerAttachmentSide ?? 'bottom'),
  )
}
```

`handleParameterControlChange` 和 `handleCatalogControlChange` 仅在 aspect key 时调用该入口，并把本次选项直接解析出的 ratio 传入；`auto` 传 `null`，保持当前几何且不会误读 meta 中旧模式遗留的比例。其他参数仍调用 `updateMeta`。

- [ ] **Step 4: 删除旧冻结链并固定浮层中心**

在 `NodeGenerationComposer`：

- 删除 `paramPanelOpen`、`freezeShift`、`freezeBaseRef` 及 layout effect 的冻结分支。
- transform 恢复为 `translateX(${shiftX}px) translateX(-50%) scale(...)`。
- 参数控件改为：

```tsx
<NodeParameterControls
  node={node}
  section="parameters"
  composerAttachmentSide={flipUp ? 'top' : 'bottom'}
/>
```

在 `InlineParameterBar` 删除 `onParamPanelOpenChange` prop/effect/callback，并把打开位置改成触发器中心：

```ts
const centeredLeft = rect.left + rect.width / 2 - PANEL_W / 2
const left = Math.min(Math.max(8, centeredLeft), Math.max(8, vw - PANEL_W - 8))
```

摘要继续在打开时冻结，panelInit 继续只在打开瞬间计算。

- [ ] **Step 5: 运行聚焦测试、typecheck 与 filesize**

Run: `pnpm vitest run src/workbench/generationCanvas/nodes/nodeSizing.aspectRatio.test.ts src/workbench/generationCanvas/nodes/nodeSizing.visualSize.test.ts && pnpm run typecheck && pnpm run check:filesize`

Expected: PASS；`rg "freezeShift|onParamPanelOpenChange" src/workbench/generationCanvas/nodes` 无输出。

- [ ] **Step 6: 提交**

```bash
git add src/workbench/generationCanvas/nodes/NodeParameterControls.tsx src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx src/workbench/generationCanvas/nodes/InlineParameterBar.tsx src/workbench/generationCanvas/nodes/nodeSizing.aspectRatio.test.ts
git commit -m "fix(canvas): keep composer connected during ratio changes"
```

### Task 3: 自动比例展示与显式 1–4 数量选择

**Files:**
- Create: `src/workbench/generationCanvas/nodes/parameterOptionPresentation.ts`
- Create: `src/workbench/generationCanvas/nodes/parameterOptionPresentation.test.ts`
- Modify: `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx`
- Modify: `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx`
- Modify: `src/i18n/locales/generationCommon.ts`
- Test: `src/workbench/generationCanvas/runner/nodeVariants.test.ts`

- [ ] **Step 1: 写自动项与 3 张调度失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { localizeAutoOption } from './parameterOptionPresentation'

describe('localizeAutoOption', () => {
  it('只改展示，不改内部值', () => {
    expect(localizeAutoOption('auto', 'auto', '自动')).toEqual({ value: 'auto', text: '自动', isAuto: true })
    expect(localizeAutoOption('16:9', '16:9', '自动')).toEqual({ value: '16:9', text: '16:9', isAuto: false })
  })
  it('英文使用 Auto', () => {
    expect(localizeAutoOption('auto', 'auto', 'Auto').text).toBe('Auto')
  })
})
```

在 `nodeVariants.test.ts` 加入 count=3，断言执行恰好三次。

- [ ] **Step 2: 运行并确认红灯**

Run: `pnpm vitest run src/workbench/generationCanvas/nodes/parameterOptionPresentation.test.ts src/workbench/generationCanvas/runner/nodeVariants.test.ts`

Expected: 新模块不存在而 FAIL。

- [ ] **Step 3: 实现纯展示映射并接入自动图标**

```ts
export function localizeAutoOption(value: string, text: string, autoLabel: string) {
  const isAuto = value.trim().toLowerCase() === 'auto' || text.trim().toLowerCase() === 'auto'
  return { value, text: isAuto ? autoLabel : text, isAuto }
}
```

`InlineParameterBar` 引入 `IconAspectRatio`；`renderSegmented` 先调用 `localizeAutoOption`，自动项 shape 使用：

```tsx
<IconAspectRatio aria-hidden size={18} stroke={1.6} />
```

`summaryPart` 对匹配到的 auto 同样返回 `autoLabel`，内部 onChange 继续发 `auto`。

- [ ] **Step 4: 用 NomiSelect 替换循环按钮**

```ts
type VariantCount = 1 | 2 | 3 | 4
const VARIANT_COUNTS: VariantCount[] = [1, 2, 3, 4]
const [variantCount, setVariantCount] = React.useState<VariantCount>(1)
```

```tsx
<NomiSelect
  ariaLabel={t('generationCommon.composer.variantCountAria')}
  value={String(variantCount)}
  disabled={isGenerating}
  options={VARIANT_COUNTS.map((count) => ({
    value: String(count),
    label: t('generationCommon.composer.variantCountOption', { count }),
  }))}
  onChange={(value) => setVariantCount(Number(value) as VariantCount)}
/>
```

删除旧 `×N` button 和 1→2→4 循环。i18n：

```ts
variantCountAria: '每次生成张数',
variantCountTitle: '每次生成 {{count}} 张',
variantCountOption: '{{count}} 张',
```

英文分别为 `Images per run`、`Generate {{count}} per run`、`{{count}} image(s)`（使用现有 i18next count 插值规则）。

- [ ] **Step 5: 运行聚焦测试与 i18n/typecheck 门禁**

Run: `pnpm vitest run src/workbench/generationCanvas/nodes/parameterOptionPresentation.test.ts src/workbench/generationCanvas/runner/nodeVariants.test.ts && pnpm run check:i18n && pnpm run typecheck`

Expected: PASS；`rg "1 \| 2 \| 4|prev === 1 \? 2" src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx` 无输出。

- [ ] **Step 6: 提交**

```bash
git add src/workbench/generationCanvas/nodes/parameterOptionPresentation.ts src/workbench/generationCanvas/nodes/parameterOptionPresentation.test.ts src/workbench/generationCanvas/nodes/InlineParameterBar.tsx src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx src/i18n/locales/generationCommon.ts src/workbench/generationCanvas/runner/nodeVariants.test.ts
git commit -m "feat(canvas): make ratio and variant choices explicit"
```

### Task 4: 左侧 8 个入口的命名 tooltip

**Files:**
- Modify: `src/workbench/generationCanvas/components/CanvasToolbar.tsx`

- [ ] **Step 1: 保持单一能力清单并分组渲染**

```ts
const PRIMARY_NODE_GROUPS: GenerationNodeKind[][] = [
  ['text', 'image', 'video', 'audio'],
  ['model3d', 'whiteboard', 'panorama', 'scene3d'],
]
```

`PRIMARY_ADD_ITEMS` 仍从 render registry 派生，不复制 icon/label 数据；只按 group 插入弱分隔线。

- [ ] **Step 2: 用设计系统 Tooltip 替换原生 title**

```tsx
<TooltipProvider delayDuration={250}>
  {groups.map((items, groupIndex) => (
    <React.Fragment key={groupIndex}>
      {groupIndex > 0 ? <span className="my-0.5 h-px w-5 bg-nomi-line" aria-hidden /> : null}
      {items.map((item) => (
        <Tooltip key={item.kind}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">{nodeKindLabel(item.kind, t)}</TooltipContent>
        </Tooltip>
      ))}
    </React.Fragment>
  ))}
</TooltipProvider>
```

按钮保留 `aria-label={t('canvas.addNode', { type: label })}`，删除 `title`，添加 `data-node-kind` 供旅程测试定位。工具栏加可视区最大高度与纵向滚动，不新增 overflow 省略号。

- [ ] **Step 3: 跑设计门禁和类型检查**

Run: `pnpm run check:tokens && pnpm run check:i18n && pnpm run typecheck`

Expected: PASS；源码仍有 8 个 `PRIMARY_NODE_KINDS`，工具栏无 ellipsis/overflow trigger。

- [ ] **Step 4: 提交**

```bash
git add src/workbench/generationCanvas/components/CanvasToolbar.tsx
git commit -m "feat(canvas): name every quick-add tool"
```

### Task 5: 顶栏语义分组与任务入口

**Files:**
- Modify: `src/ui/app-shell/NomiAppBar.tsx`
- Modify: `src/workbench/taskCenter/TaskCenterButton.tsx`

- [ ] **Step 1: 任务按钮换语义图标并显示名称**

```tsx
import { IconListDetails } from '@tabler/icons-react'

<IconListDetails size={15} stroke={1.8} />
<span className="max-[1400px]:hidden">{t('taskCenter.title')}</span>
{pending > 0 ? (
  <span className="min-w-4 rounded-pill bg-nomi-paper px-1 text-center text-micro tabular-nums text-nomi-accent">
    {pending}
  </span>
) : null}
```

“任务”入口始终常驻；没有 entries/batches 或 pending=0 时只是不显示数量徽标。紧凑宽度仍有 `aria-label` 和 Tooltip，用户随时能打开任务面板与通知设置。

- [ ] **Step 2: 把右簇拆成四组**

`NomiAppBar` 顺序固定为：

```tsx
<AppBarGroup className="nomi-appbar__group--tasks">...</AppBarGroup>
<AppBarGroup className="nomi-appbar__group--assist">上手 + 浏览器</AppBarGroup>
<AppBarGroup className="nomi-appbar__group--config">设置 + 模型接入</AppBarGroup>
<span className="nomi-appbar__group--primary">去出片</span>
```

不额外创建公共组件文件；在本文件内用一个小 `AppBarGroup` 函数组装“内容 + 条件分隔线”。设置按钮改成与浏览器/模型相同的 `icon + label` 尺寸和 `max-[1400px]` 收起规则。模型接入从主动作组移到配置组。

- [ ] **Step 3: 运行类型、token、i18n 与 taskCenter 单测**

Run: `pnpm vitest run src/workbench/taskCenter && pnpm run check:tokens && pnpm run check:i18n && pnpm run typecheck`

Expected: PASS；`TaskCenterButton.tsx` 不再导入 `IconProgress`，`NomiAppBar.tsx` 中设置与模型接入位于同一 group。

- [ ] **Step 4: 提交**

```bash
git add src/ui/app-shell/NomiAppBar.tsx src/workbench/taskCenter/TaskCenterButton.tsx
git commit -m "feat(appbar): group actions by user intent"
```

### Task 6: 真机旅程、样张对账与完整门禁

**Files:**
- Create: `tests/ux/canvas-control-clarity.walk.mjs`
- Modify only if journey exposes a root cause in the files above.

- [ ] **Step 1: 写 Playwright 用户旅程**

脚本必须从真实生成画布入口开始，创建/选择图像节点并记录：

```js
const composerBefore = await composer.boundingBox()
const triggerBefore = await ratioTrigger.boundingBox()
const panelBefore = await ratioPanel.boundingBox()

for (const ratio of ['1:1', '21:9', '9:16']) {
  await page.getByRole('button', { name: ratio }).click()
  const nodeBox = await node.boundingBox()
  states.push({ ratio, nodeBox })
  expect(await composer.boundingBox()).toEqual(composerBefore)
  expect(await ratioTrigger.boundingBox()).toEqual(triggerBefore)
  expect(await ratioPanel.boundingBox()).toEqual(panelBefore)
}
```

同时检查：数量菜单有 1–4 且可选 3；左栏 8 个按钮均能触发 tooltip；任务有 pending 时显示 `任务 2`；设置与模型接入相邻；保存光/暗和紧凑宽度截图。

- [ ] **Step 2: 运行旅程并亲读截图**

Run: `node tests/ux/canvas-control-clarity.walk.mjs`

Expected: PASS，并输出截图目录。逐张与 2026-08-06 获批样张对账：节点不缩成条、底边/顶边不断口、弹层不漂、无名 icon 清零。

- [ ] **Step 3: 运行完整七道门禁**

Run:

```bash
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run lint:ci
pnpm run typecheck
pnpm run test
pnpm run build
```

Expected: 全部 exit 0；Lint warning 不超过仓库棘轮。

- [ ] **Step 4: 规格逐项反查**

Run:

```bash
rg "freezeShift|onParamPanelOpenChange|prev === 1 \? 2|IconProgress" \
  src/workbench/generationCanvas/nodes src/workbench/taskCenter/TaskCenterButton.tsx
```

Expected: 无旧实现命中。确认未修改供应商/API 合同、上下文 `NodeAddMenu` 仍存在、内部 auto 值仍为 `auto`。

- [ ] **Step 5: 提交旅程并推送最新 main**

```bash
git add tests/ux/canvas-control-clarity.walk.mjs
git commit -m "test(ux): cover canvas control clarity journey"
git fetch origin main
git rebase origin/main
pnpm run check:filesize && pnpm run check:tokens && pnpm run check:i18n && pnpm run lint:ci && pnpm run typecheck && pnpm run test && pnpm run build
git push origin HEAD:main
```

Expected: push 成功；远端 main 包含设计契约、实现、自动化和真机证据。
