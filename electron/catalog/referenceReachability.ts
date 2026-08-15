// 「这条渠道到底带得动哪些参考」——**UI 收窄与第三闸共用的唯一判据**。
//
// 为什么必须共用：UI 的能力由**模型档案**声明（供应商无关，同一模型走哪家都显示同一套模式/槽），而
// 真正发出去的 body 由**渠道 mapping** 决定。两者此前只在「点生成那一刻」才对账（unreachableReferenceLabels），
// 于是 UI 热情地给出「首尾帧 / 全能参考 / 参考视频」，用户连好、切模式、点生成，才被拒。把判据抽到这里
// 供两侧共用，UI 才能提前说实话，且不会与闸门各自漂移（那正是本轮修掉的病）。
//
// 住在 electron/ 而非 src/：electron tsconfig 是 rootDir:"." 反向 import 不了 src；渲染层则本就 import
// 得到 electron（bridge.ts 已在做），且本模块依赖链纯净（paramTranslate → jsonUtils，后者零 import）。
import { bodyReferencedParamKeys } from "./paramTranslate";

/** 一个参考槽在某条渠道上的真实承载力。 */
export type SlotReach =
  /** body 直接引用了这个槽的 inputKey → 该槽整组（含数组）都发得出。 */
  | "full"
  /** 槽本身发不出，但能挤进渠道的「单图聚合位」→ **只有 1 张**能过去。 */
  | "single"
  /** 完全发不出：连了也不会进请求。 */
  | "none";

/**
 * 渠道的「单图聚合位」。通用中转最小模板只有 `image: {{request.params.image_url}}`，而 params.image_url
 * 由 taskParams.firstReferenceImage 用 **firstString 优先级链** 聚合而来：
 *   image_url → imageUrl → firstFrameUrl → lastFrameUrl → referenceImages[0]
 * 是「链」不是「并」——**一次只有一个值挤得进去**。所以这类渠道的真实承载力是「一共 1 张」，
 * 不是「每个槽 1 张」。下面 modeSlotReach 按同一优先级把这唯一名额发给排最前的那个槽。
 */
const AGGREGATE_SINGLE_KEYS = ["image_url", "imageUrl", "image"];

/** 能挤进单图聚合位的槽 kind，**顺序即 firstReferenceImage 的优先级**（首帧 > 尾帧 > 参考图数组）。 */
const AGGREGATE_ELIGIBLE_KINDS = ["first_frame", "last_frame", "image_ref"];

/** 缺省 API 输入键（模型契约，供应商无关）。与渲染层 archetypeMeta.DEFAULT_INPUT_KEY 同表——
 *  两处都要改时靠 referenceReachability.test 的一致性用例兜住（那条会对着渲染层的表逐项比）。 */
export const DEFAULT_SLOT_INPUT_KEY: Record<string, string> = {
  first_frame: "first_frame_url",
  last_frame: "last_frame_url",
  image_ref: "reference_image_urls",
  video_ref: "reference_video_urls",
  audio_ref: "reference_audio_urls",
  source_video: "video_url",
};

/** 一个槽的最小描述（渲染层的 ArchetypeReferenceSlot 与 electron 侧共用的交集）。 */
export type ReachSlot = { kind: string; inputKey?: string };

function inputKeyOf(slot: ReachSlot): string {
  return (slot.inputKey || DEFAULT_SLOT_INPUT_KEY[slot.kind] || "").trim();
}

/**
 * 算一个模式下每个槽在这条渠道上的真实承载力。**纯函数**（可零网络单测）。
 *
 * @param slots      该模式声明的参考槽（顺序即档案里的声明顺序，仅用于稳定输出）
 * @param createBody 这条 mapping 的 create.body（判据 derive 自它引用的 {{request.params.X}}，不 hardcode 供应商）
 * @returns 与 slots 等长、一一对应的承载力数组
 */
export function modeSlotReach(slots: ReachSlot[], createBody: unknown, combineKey?: string): SlotReach[] {
  const referenced = new Set(bodyReferencedParamKeys(createBody));
  // body 完全不引用任何参数（如纯静态 body）→ 判不出来，一律放行不误伤（与第三闸同口径）。
  if (referenced.size === 0) return slots.map(() => "full");

  // 合并槽（mode.combineSlotsInto）：整组槽序列化进**同一个**参数发出——apimart 首尾帧走
  // `image_with_roles`、Veo 首尾帧走 `image_urls`(flat)。这时逐槽查自己的 inputKey 必然全落空，
  // 会把好端端的原生通道判死（reachNoOverNarrow.test 就是这么抓住我的）。认合并键即可。
  if (combineKey && referenced.has(combineKey.trim())) return slots.map(() => "full");

  const reach: SlotReach[] = slots.map((slot) => {
    const key = inputKeyOf(slot);
    return key && referenced.has(key) ? "full" : "none";
  });

  // 单图聚合位：只有一个名额，按 firstReferenceImage 的优先级发给排最前的、且自己发不出的那个槽。
  const hasAggregate = AGGREGATE_SINGLE_KEYS.some((k) => referenced.has(k));
  if (hasAggregate) {
    for (const kind of AGGREGATE_ELIGIBLE_KINDS) {
      const idx = slots.findIndex((slot, i) => slot.kind === kind && reach[i] === "none");
      if (idx >= 0) {
        reach[idx] = "single";
        break; // 名额用完——后面的槽仍是 none，这正是「首尾帧只过得去首帧」的真相。
      }
    }
  }
  return reach;
}

/** 整个模式在这条渠道上能不能用：所有声明的参考槽都发不出 = 这个模式在这里是空的。 */
export function modeIsUsable(slots: ReachSlot[], createBody: unknown, combineKey?: string): boolean {
  if (slots.length === 0) return true; // 纯文生模式没有参考槽，永远可用。
  return modeSlotReach(slots, createBody, combineKey).some((r) => r !== "none");
}
