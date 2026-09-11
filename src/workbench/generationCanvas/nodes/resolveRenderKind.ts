// 节点渲染分发（renderKind）的单一真相源——决定一个画布节点走哪个 body 组件。
// 抽成纯函数以便单测 + 收口「按 kind 还是按 categoryId 渲染」的优先级规则。
import type { GenerationCanvasNode } from "../model/generationCanvasTypes";

/** 走「卡片」式 body（非纯图片预览）的 renderKind 集合。 */
export const CARD_RENDER_KINDS = [
  "character-card",
  "scene-card",
  "prop-card",
  "audio-strip",
  "whiteboard-card",
  "storyboard-table",
] as const;

/** kind 自带专属卡 body 的节点：这些 kind 的 body 就是功能本体，任何分类默认值都不该顶掉它。 */
const RENDER_KIND_BY_NODE_KIND: Record<string, string> = {
  whiteboard: "whiteboard-card",
  audio: "audio-strip",
  character: "character-card",
  scene: "scene-card",
};

/**
 * 推断节点的 renderKind。优先级：
 * 1. 素材节点（kind=asset）永远纯图片预览（renderKind=undefined）——否则落进 cast/scene 分类的
 *    素材会被误判成角色/场景卡。
 * 2. node.renderKind 显式覆盖（对无专属卡的 kind，如 shots 的 image 节点 → shot-frame 媒体预览）。
 * 3. **kind 专属卡**：没有显式覆盖时，画板/声音/角色/场景节点在任意分类都长成自己的卡——V51→V60 迁移曾把
 *    shots 分类默认值 `shot-frame` 盖章到这些节点的 renderKind 上，画板节点因此渲染成通用媒体壳、
 *    「打开画板」入口消失（2026-07-29 真机复现）。kind 压过存量脏显式值 = 行为层自愈全部已损数据。
 * 4. categoryId 仅作「无 kind 信号」时的兜底（如 prop 分类的 image 节点 → prop-card）。
 */
export function resolveNodeRenderKind(
  node: Pick<GenerationCanvasNode, "kind" | "renderKind" | "categoryId" | "meta">,
): string | undefined {
  // 编辑器型节点是一个独立工作区，不是分类卡。即使归在 scene 分类，也必须继续走
  // BaseGenerationNode 里的 Scene3DEditor / VibingDirectorEditor 分支。
  if (node.kind === "asset" || node.kind === "skill" || node.kind === "scene3d" || node.kind === "vibingDirector") return undefined;
  // 分镜表是 text 节点上的专属工作区。旧项目迁移会给 shots 分类补上 shot-frame，
  // 因此该语义标记必须先于显式 renderKind，否则表格会退化成空白文本/媒体节点。
  if (node.kind === "text" && node.meta?.storyboardGroup === true) return "storyboard-table";
  const explicit = node.renderKind as string | undefined;
  // 注：`shot-frame`（shots 分类默认 renderKind，历史迁移回填）不在 CARD_RENDER_KINDS，故按 explicit
  // 返回后走「媒体预览」路径——镜头节点就该显生成出的图/视频，不套卡片。分镜序号由 BaseGenerationNode
  // 的常显「镜头 N」角标提供（不依赖某个 ShotFrameNode 组件，那个组件从未存在，别再当它是死引用）。
  if (explicit) return explicit;
  const intrinsic = RENDER_KIND_BY_NODE_KIND[node.kind];
  if (intrinsic) return intrinsic;
  if (node.categoryId === "cast") return "character-card";
  if (node.categoryId === "scene") return "scene-card";
  if (node.categoryId === "prop") return "prop-card";
  if (node.categoryId === "audio") return "audio-strip";
  return undefined;
}

/** renderKind 是否走卡片式 body。 */
export function isCardRenderKind(renderKind: string | undefined): boolean {
  return CARD_RENDER_KINDS.includes(renderKind as (typeof CARD_RENDER_KINDS)[number]);
}
