/**
 * 项目封面派生（媒体类型分流版）——从画布节点的生成产物派生项目库卡片封面。
 *
 * 为什么按 `result.type` 分流（2026-08-01 根治「导入视频项目封面加载失败」）：
 * 旧派生对任何有产物的节点直接取 `url || thumbnailUrl`，视频/音频结果的 url 被塞进
 * `<img>` 必然 decode 失败 → 卡片「加载失败」。封面 URL 必须按可渲染性分桶：
 *  - `imageUrls`：可 `<img>` 渲染的 URL（图片结果、视频/3D 的 poster）。
 *  - `videoUrl`：没有任何可 `<img>` 封面时的兜底——首个视频结果的 url，卡片用
 *    `<video>` 首帧当封面（纯导入素材项目就靠它有真封面）。
 *  - text / audio 结果没有可视封面，跳过。
 *  - `type` 缺失（脏/残缺数据）→ 维持旧行为按图片取（url || thumbnailUrl），健壮降级。
 *
 * 单一来源关系（P4 / 封面派生唯一真相源）：本模块是**算法真相源**；主进程侧
 * `electron/workspace/workspaceRepository.ts` 的 `deriveProjectCover` 是同一逻辑的 main 副本
 * （桌面 list 不经渲染层、直接读 manifest 派生封面）。两份分属 electron(CJS, rootDir=electron/)
 * 与 renderer(ESM, src/)，跨 tsconfig 无法直接 import 共享一个纯模块，故以「逻辑等价 +
 * 注释锚定 + 等价回归测试」收口：`electron/workspace/thumbnailDerive.equivalence.test.ts`
 * 用同一组 fixture 跑两份并断言输出逐字相等，任一侧改动漂移即红。改本模块务必同步 main 侧。
 *
 * 无产物降级：示例项目 / 空项目 / 脏节点时返回 `{ imageUrls: [] }`——这是给 UI 的
 * 「此项目暂无封面，请用占位」信号，而不是抛错或返回脏值。
 */
export type ProjectCover = {
  /** 可直接 `<img>` 渲染的封面 URL（最多 max 个）。 */
  imageUrls: string[]
  /** imageUrls 为空时的兜底：首个视频结果的 url（卡片用 `<video>` 首帧渲染）。 */
  videoUrl?: string
}

export function deriveProjectCoverFromNodes(nodes: unknown, max = 4): ProjectCover {
  // 降级：非数组（undefined / null / 残缺记录）→ 空标记，不崩。
  if (!Array.isArray(nodes)) return { imageUrls: [] }
  const imageUrls: string[] = []
  let videoUrl: string | undefined
  for (const node of nodes) {
    if (imageUrls.length >= max) break
    // 脏数据健壮：数组里混入 null / 非对象节点时跳过，不读 .result 触发崩溃。
    if (!node || typeof node !== 'object') continue
    const result = (node as { result?: { type?: unknown; url?: unknown; thumbnailUrl?: unknown } }).result
    if (!result || typeof result !== 'object') continue
    const type = typeof result.type === 'string' ? result.type : ''
    const url = typeof result.url === 'string' ? result.url : ''
    const thumbnailUrl = typeof result.thumbnailUrl === 'string' ? result.thumbnailUrl : ''
    const imageCandidate =
      type === 'image'
        ? url || thumbnailUrl
        : type === 'video' || type === 'model3d'
          ? thumbnailUrl
          : type === 'text' || type === 'audio'
            ? ''
            : url || thumbnailUrl
    // 过短 url（length <= 4）视为脏值过滤——与旧派生语义一致。
    if (imageCandidate.length > 4) {
      imageUrls.push(imageCandidate)
      continue
    }
    if (!videoUrl && type === 'video' && url.length > 4) videoUrl = url
  }
  return videoUrl ? { imageUrls, videoUrl } : { imageUrls }
}

export function deriveProjectCoverFromRaw(raw: unknown): ProjectCover {
  if (!raw || typeof raw !== 'object') return { imageUrls: [] }
  const r = raw as Record<string, unknown>
  const payload = r.payload
  const gc = (payload && typeof payload === 'object' ? (payload as Record<string, unknown>).generationCanvas : undefined) ?? r.generationCanvas
  const nodes = (gc as { nodes?: unknown } | undefined)?.nodes
  return deriveProjectCoverFromNodes(nodes)
}
