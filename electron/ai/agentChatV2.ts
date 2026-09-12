import crypto from "node:crypto";
import { tool, type CoreMessage, type CoreUserMessage } from "ai";
import { z } from "zod";
import { capAgentHistory, createLinkedAbortController } from "./agentChatHarness";
import { clearAgentSession, hasPersistedAgentSession, loadAgentSession, saveAgentSession } from "./agentSessionStore";
import { runAgentLoop } from "./agentLoop";
import { traceContextCapped } from "../events/agentChatTrace";
import { projectIdFromSessionKey } from "../events/eventLogRepository";
import { getProjectMemory, formatMemoryForPrompt } from "../memory/projectMemory";
import { consumeAgentStreamWithTimeout } from "./agentStreamConsumer";
import { buildLanguageModelForVendor, chooseTextModel } from "./vendorLanguageModel";
export { orderTextModelsForAgent, selectTextModelCandidates, resolveTextBrainKeys, resolveTextBrainStatus, type TextModelPreference } from "./vendorLanguageModel";
import { getModelProfile } from "./modelProfiles";
import { describeEmptyAgentReply } from "./agentError";
import { sanitizeForBroadCompat } from "./promptSanitize";
import {
  canvasNodeKindSchema,
  plannedEdgeSchema,
  plannedNodeSchema,
  storyboardPlanParamsSchema,
  updateStoryboardShotParamsSchema,
  batchUpdateStoryboardShotsParamsSchema,
  stagingReferenceParamsSchema,
  cameraMoveParamsSchema,
  externalImageAttachmentParamsSchema,
  capabilityRecipeRunParamsSchema,
  saveCreativeResourceParamsSchema,
  model3dHandoffParamsSchema,
  type CanvasToolName,
} from "./canvasTools";
import { documentTools, type DocumentToolName } from "./documentTools";
import {
  applyVibingDirectorPlanParamsSchema,
  parseVibingDirectorPlanRequest,
  readVibingDirectorParamsSchema,
  type VibingDirectorToolName,
} from "./vibingDirectorTools";
import { readNestedRecord, trim, type JsonRecord } from "../jsonUtils";
import { readSkillRecords } from "../skills/skillStore";
import { normalizeProviderKind } from "../catalog/catalogStore";
import { readNomiLocalAsset } from "../assets/localAssetFile";
import { extractTextFromLocalAsset } from "../files/extractText";
import {
  buildAgentUserContent,
  modelSupportsImageInput,
  modelSupportsPdfInput,
  type AgentUserAttachment,
} from "./agentUserContent";
import { filterAgentTools, resolveAgentSkillExecution } from "./agentSkillRuntime";
import {
  cinematicDirectorToolSchemas,
  type CinematicDirectorToolName,
} from "./cinematicDirectorTools";

function readRequestedSkill(payload: JsonRecord): { key: string; name: string } {
  const chatContext = payload.chatContext;
  const skill = readNestedRecord(chatContext, ["skill"]);
  return {
    key: trim(readNestedRecord(skill, ["key"])),
    name: trim(readNestedRecord(skill, ["name"])),
  };
}

/**
 * Nomi 助手核心身份（单一真相源，P4 通用第一）。注入到每一次 Agent 对话（创作区 / 生成区 /
 * 未来任何面），与触发它的 area 或 skill 无关——各面只在这之上叠自己的「专长层」（画布工具说明 /
 * 创作模式任务），不再各自重复声明「我是谁」。改身份只改这一处。
 *
 * 三层结构：① 这里 = 共享身份 + 产品/流程认知 + 输出铁律 + 语言规则；
 * ② payload.systemPrompt = 当前面的专长（如画布工具集）；③ skillSystemPrompt = 当前 skill 方法论。
 */
export const NOMI_AGENT_IDENTITY = [
  "你是 Nomi 的 AI 创作伙伴。",
  "",
  "Nomi 是一个本地优先的 AI 视频创作工作台。用户在这里把一个想法做成视频，路径是：创作区写文案/故事/剧本 →（拆镜头）→ 生成画布把每个镜头排成节点、选模型配参数 → 时间轴拼接预览 → 导出 MP4。你始终清楚用户正处在这条链的哪一环，给的帮助要能把他推进到下一环。",
  "用户是创作者，要的是能直接用的成品，不是方法论。",
  "",
  "输出铁律：",
  "- 具体、可执行、可视化：给画面、给细节、给能直接落地的内容；不要空泛建议和正确的废话。",
  "- 密度优先、少即是多：克制利落，不堆套话、不复述用户的话、不写「希望对你有帮助」这类填充。",
  "- 模型与能力一律用它的真名（vendor 原词，如 Seedance、全能参考），不要替用户翻译成自创词，以免把能力说窄。",
  "- 不泄露内部推理链路，直接给结论和成品。",
  "- 主动但不越权：该调工具就调，但所有写入/生成都要等用户在卡片上确认后才生效。",
  "",
  "语言规则（最高优先级，覆盖一切其他指令）：",
  "始终用与用户相同的自然语言回复——用户用中文你就用中文，用英文就用英文，用日文就用日文；写进文稿和节点 prompt 的内容同样跟随用户语言。",
  "永远不要因为本系统提示或某个 skill 是用中文/英文写的，就固定用那种语言；以用户最近一条消息的语言为准。",
].join("\n");

/**
 * systemPrompt 合成器（B1c 单一合成点）——把四层收成一处：
 *   ① identity        = NOMI_AGENT_IDENTITY（共享身份，单一真相源）
 *   ② panelSystemPrompt = 当前面板专长（payload.systemPrompt，如生成画布工具说明）
 *   ③ skillSystemPrompt = 当前 skill 方法论（resolveAgentSkillExecution）
 *   ④ memoryBlock       = 项目记忆（殿后，见 runAgentChatV2 注）
 *
 * **字节稳定铁律**：vendor 前缀缓存依赖 system 段 byte 逐字节稳定——本函数只做
 * 「过滤空段 → join('\n\n') → sanitizeForBroadCompat」，与旧内联逻辑逐字节等价，改一处不得漂移。
 * 全空返回 undefined（不发 system 槽）。记忆放末尾：它变更最频繁，殿后只击穿后缀缓存，
 * 前面身份/专长/skill 的前缀缓存仍命中。
 */
export function composeAgentSystemPrompt(layers: {
  identity: string;
  panelSystemPrompt: string;
  skillSystemPrompt: string;
  toolFreeProtocol?: string;
  memoryBlock: string;
}): string | undefined {
  const parts = [
    layers.identity,
    layers.panelSystemPrompt,
    layers.skillSystemPrompt,
    layers.toolFreeProtocol,
    layers.memoryBlock,
  ].filter((part) => part && part.length > 0);
  return parts.length > 0 ? sanitizeForBroadCompat(parts.join("\n\n")) : undefined;
}


// vendor→LanguageModel 构造已抽到 ./vendorLanguageModel（单一真相,与文本任务引擎共用）。

// ---------------------------------------------------------------------------
// runAgentChatV2 — Phase B: tool-calling + real streaming
// ---------------------------------------------------------------------------
//
// v2 wires the canvas tools through `streamText` and surfaces token deltas +
// tool-call lifecycle to the renderer via an injected `emit` callback. The IPC layer (electron/
// main.ts) is responsible for forwarding those events on a per-session
// channel and for resolving the `awaitToolConfirmation` promise once the
// user confirms or rejects the proposed tool call.
// ---------------------------------------------------------------------------

// A tool call may target either the generation-canvas tool group or the
// creation-document tool group; the engine picks the group by skillKey.
export type AgentToolName = CanvasToolName | DocumentToolName | VibingDirectorToolName | CinematicDirectorToolName;

export type AgentChatV2Event =
  | {
      type: "harness-config";
      vendorKey: string;
      modelKey: string;
      skillKey: string;
      allowedTools: string[];
      playbook: import("./agentSkillRuntime").AgentPlaybookStage | null;
    }
  | { type: "content-delta"; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: AgentToolName; args: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: AgentToolName; result: unknown }
  | { type: "tool-error"; toolCallId: string; toolName: AgentToolName; message: string }
  | { type: "step-finish"; finishReason: string }
  | { type: "finish"; finishReason: string; usage?: unknown }
  | { type: "error"; message: string };

export type AgentToolConfirmation = { ok: true; result: unknown } | { ok: false; message: string };

export type AgentChatV2Hooks = {
  emit: (event: AgentChatV2Event) => void;
  /**
   * Called when the LLM emits a tool call. The host (renderer over IPC) must
   * resolve with either `{ ok: true, result }` to feed the result back to
   * the model and continue the loop, or `{ ok: false, message }` to short
   * circuit the tool with an error result.
   */
  awaitToolConfirmation: (call: {
    toolCallId: string;
    toolName: AgentToolName;
    args: unknown;
  }) => Promise<AgentToolConfirmation>;
  abortSignal?: AbortSignal; // external cancel (user "Stop") → stream abort
};

// Wraps a tool descriptor so every invocation routes through the
// human-in-the-loop confirmation channel: emit `tool-call`, await the user's
// decision, then emit `tool-result` / `tool-error` and feed a structured
// result back to the model. Shared by both the canvas and document tool groups.
// 导出仅供集成测试（agentLoopIntegration.test.ts）驱动真实「确认门焊接」路径——
// 生产代码仍只经 buildCanvasToolsForV2 / 文档工具组取用，不直接调。
export function makeAgentTool<TParams extends z.ZodTypeAny>(
  hooks: AgentChatV2Hooks,
  toolName: AgentToolName,
  description: string,
  parameters: TParams,
  normalizeArgs?: (args: unknown) => unknown | null,
) {
  return tool({
    description,
    parameters,
    execute: async (args: unknown, opts: { toolCallId: string }) => {
      const confirmedArgs = normalizeArgs ? normalizeArgs(args) : args;
      if (confirmedArgs == null) {
        return {
          ok: false as const,
          error: `Invalid arguments for ${toolName}. Correct the declared operation fields and retry.`,
        };
      }
      hooks.emit({ type: "tool-call", toolCallId: opts.toolCallId, toolName, args: confirmedArgs });
      const confirmation = await hooks.awaitToolConfirmation({
        toolCallId: opts.toolCallId,
        toolName,
        args: confirmedArgs,
      });
      if (!confirmation.ok) {
        hooks.emit({
          type: "tool-error",
          toolCallId: opts.toolCallId,
          toolName,
          message: confirmation.message,
        });
        // Surface as a structured tool result so the LLM can gracefully stop.
        return { ok: false as const, error: confirmation.message };
      }
      hooks.emit({
        type: "tool-result",
        toolCallId: opts.toolCallId,
        toolName,
        result: confirmation.result,
      });
      return { ok: true as const, result: confirmation.result };
    },
  });
}

function buildCanvasToolsForV2(hooks: AgentChatV2Hooks) {
  const makeTool = <TParams extends z.ZodTypeAny>(toolName: CanvasToolName, description: string, parameters: TParams) =>
    makeAgentTool(hooks, toolName, description, parameters);

  return {
    read_canvas_state: makeTool(
      "read_canvas_state",
      "Read the current generation canvas (nodes + edges).",
      z.object({}),
    ),
    propose_storyboard_plan: makeTool(
      "propose_storyboard_plan",
      "Produce a structured storyboard plan (cross-shot anchors + shots) for the user to review/edit in the creation area before anything lands on the canvas. Does not touch the canvas and costs nothing. Emit exactly one call.",
      storyboardPlanParamsSchema,
    ),
    update_storyboard_shot: makeTool(
      "update_storyboard_shot",
      "Update one shot in the current storyboard plan, including storyboard-table fields and a highly specific videoPrompt built from those fields. Edits the storyboard source-of-truth; does not call a model.",
      updateStoryboardShotParamsSchema,
    ),
    batch_update_storyboard_shots: makeTool(
      "batch_update_storyboard_shots",
      "Batch update many shots in the current storyboard plan. Use this for storyboard-table autofill; set deriveVideoPrompts=true so Nomi rebuilds detailed video prompts from final table fields and syncs video nodes.",
      batchUpdateStoryboardShotsParamsSchema,
    ),
    create_canvas_nodes: makeTool(
      "create_canvas_nodes",
      "Propose a batch of new canvas nodes AND their reference edges in this one call (never split edges into a separate connect_canvas_edges call).",
      z.object({
        summary: z.string(),
        nodes: z.array(plannedNodeSchema).min(1).max(24),
        edges: z.array(plannedEdgeSchema).max(48).optional(),
      }),
    ),
    connect_canvas_edges: makeTool(
      "connect_canvas_edges",
      "Connect EXISTING nodes with reference edges (follow-up edits only; new plans carry edges inside create_canvas_nodes).",
      z.object({
        edges: z.array(plannedEdgeSchema).min(1).max(48),
      }),
    ),
    set_node_prompt: makeTool(
      "set_node_prompt",
      "Rewrite the prompt of an existing node.",
      z.object({
        nodeId: z.string().min(1),
        prompt: z.string().min(1),
      }),
    ),
    delete_canvas_nodes: makeTool(
      "delete_canvas_nodes",
      "Delete one or more existing canvas nodes (destructive).",
      z.object({
        nodeIds: z.array(z.string().min(1)).min(1).max(24),
        // Keep a hint slot so the model can surface its rationale to the user
        // before destructive confirmation.
        reason: z.string().optional(),
      }),
    ),
    // S6b:受理语义——批准前零网络调用,批准即受理并启动,回执不含生成结果。
    run_generation_batch: makeTool(
      "run_generation_batch",
      "Start real generation for existing canvas nodes (costs credits; user must confirm). Existing results are regenerated into new version nodes, leaving prior results and downstream edges unchanged. Returns an acceptance receipt.",
      z.object({
        nodeIds: z.array(z.string().min(1)).min(1).max(24),
      }),
    ),
    attach_external_image_to_node: makeTool(
      "attach_external_image_to_node",
      "Import an externally generated image from a local path, http(s) URL, or data:image URL into the current Nomi project and attach it as the result of an existing image-like canvas node. Use this for Codex/imagegen outputs that already exist; it does not call an image model itself.",
      externalImageAttachmentParamsSchema,
    ),
    arrange_storyboard_to_timeline: makeTool(
      "arrange_storyboard_to_timeline",
      "Arrange the storyboard's generated shot videos onto the timeline media track in script order (ordering decided by stored shot numbers, not by you). Ungenerated shots fall back to their keyframe image; clips are appended to the end. Omit nodeIds for the whole storyboard.",
      z.object({
        nodeIds: z.array(z.string().min(1)).max(48).optional(),
      }),
    ),
    tidy_canvas: makeTool(
      "tidy_canvas",
      "Tidy the canvas: re-layout one category's nodes into an organized grid in script/shot order. Non-destructive, free, undoable. Use when the user says the canvas is messy or asks to arrange/sort the nodes. Omit categoryId to tidy the category the user is viewing.",
      z.object({ categoryId: z.string().optional() }),
    ),
    create_staging_reference: makeTool(
      "create_staging_reference",
      "Create a 3D staging reference image locking character blocking + poses + camera for a shot (auto-connects to shotClientId as composition_ref). Use when ≥2 characters have a spatial relationship, a specific physical action is needed, or a director-specified camera angle. Not for simple single talking-head shots. Tiered rule: the vocab (characters/layout/pose/camera) is the precise first choice (3D staging render); if the blocking is OUTSIDE the vocab, do NOT force a wrong value — use customBlocking (prompt-guided into the keyframe image prompt, honest about lower fidelity).",
      stagingReferenceParamsSchema,
    ),
    create_camera_move: makeTool(
      "create_camera_move",
      "Create a 3D camera-move reference clip locking a shot's camera motion (orbit / push-in / pull-out / crane / track / arc / dolly-zoom), fed to the shot's VIDEO node as a reference video (or degraded to a camera-move prompt directive on models without a video_ref slot). Call ONLY when a shot has a specific camera-move intent; do NOT call for a static / locked-off shot or a simple talking-head. Tiered rule: the `move` enum is the precise first choice (3D camera-path render); if the intended move is OUTSIDE the enum (whip-pan, handheld follow, compound/sequenced moves, 'match this reference video'), do NOT force a wrong enum — leave move empty and use customMove (prompt-guided into the video prompt, honest about lower fidelity). shotClientId MUST point to the shot's VIDEO node — not its keyframe image; if none exists yet, create the video node first.",
      cameraMoveParamsSchema,
    ),
    list_capability_recipes: makeTool(
      "list_capability_recipes",
      "List Nomi's provider-independent creative recipes, controls, input/output contracts, and compatible connected models. Read-only and free. Use this before choosing a recipe or model when compatibility is unknown.",
      z.object({}),
    ),
    apply_capability_recipe: makeTool(
      "apply_capability_recipe",
      "Apply a creative recipe to an existing source node. Always creates a new derived node and result collection; never overwrites earlier generations. May call a paid model and therefore requires user confirmation. Use recipe and compatible model ids returned by list_capability_recipes.",
      capabilityRecipeRunParamsSchema,
    ),
    save_creative_resource: makeTool(
      "save_creative_resource",
      "Save an existing node result as a reusable style, effect, identity, or palette resource with provenance and license metadata. Creates a new resource node, leaves the source unchanged, and does not call a model.",
      saveCreativeResourceParamsSchema,
    ),
    handoff_model3d: makeTool(
      "handoff_model3d",
      "Hand off an existing generated GLB to a new or existing Scene3D or Blender Director node. This is non-destructive and local: the source stays unchanged, Scene3D receives a real model object, and Blender Director copies the GLB into its licensed local asset library. Requires user confirmation because it changes the canvas.",
      model3dHandoffParamsSchema,
    ),
    // Silence unused-import warning for canvasNodeKindSchema by re-exporting
    // it through the tool registry shape (it's enforced via plannedNodeSchema).
    _kindSchema: canvasNodeKindSchema,
  } as const;
}

function buildCinematicDirectorToolsForV2(hooks: AgentChatV2Hooks) {
  const makeTool = <TParams extends z.ZodTypeAny>(
    toolName: CinematicDirectorToolName,
    description: string,
    parameters: TParams,
  ) => makeAgentTool(hooks, toolName, description, parameters);
  const schema = cinematicDirectorToolSchemas;

  return {
    read_project_summary: makeTool("read_project_summary", "Read a compact project summary: Film Bible state, storyboard, assets, shots, and generated results.", schema.read_project_summary),
    read_film_bible: makeTool("read_film_bible", "Read the persisted project Film Bible. Old projects fall back to a non-persisted view derived from storyboard anchors.", schema.read_film_bible),
    read_storyboard: makeTool("read_storyboard", "Read the ordered storyboard as canonical ShotSpec views, including selected image/video revisions.", schema.read_storyboard),
    read_shot_spec: makeTool("read_shot_spec", "Read one canonical ShotSpec by stable shot id or one-based shot index.", schema.read_shot_spec),
    read_asset_registry: makeTool("read_asset_registry", "Read reusable character, scene, prop, style, image, video, and model3d asset records with revision pointers.", schema.read_asset_registry),
    read_provider_capabilities: makeTool("read_provider_capabilities", "Read connected provider-independent generation recipes, supported modes, models, and controls.", schema.read_provider_capabilities),
    read_task_status: makeTool("read_task_status", "Read current generation task and node-run status without submitting or retrying anything.", schema.read_task_status),
    propose_film_bible_patch: makeTool("propose_film_bible_patch", "Return a structured Film Bible patch for review. Proposal only: do not mutate project state and never include credentials.", schema.propose_film_bible_patch),
    propose_shot_patch: makeTool("propose_shot_patch", "Return a structured patch for one ShotSpec for review. Proposal only: do not mutate the storyboard.", schema.propose_shot_patch),
    propose_generation_plan: makeTool("propose_generation_plan", "Return a generation plan with node/model/mode choices and submission estimates. Proposal only: never call a provider.", schema.propose_generation_plan),
    propose_timeline_assembly: makeTool("propose_timeline_assembly", "Return a proposed storyboard-to-timeline assembly. Proposal only: do not edit the timeline.", schema.propose_timeline_assembly),
    apply_film_bible_patch: makeTool("apply_film_bible_patch", "Apply a user-confirmed Film Bible patch to the project. Local write, no provider call.", schema.apply_film_bible_patch),
    apply_storyboard_patch: makeTool("apply_storyboard_patch", "Apply user-confirmed updates to one or more storyboard shots and rederive detailed video prompts.", schema.apply_storyboard_patch),
    create_asset_records: makeTool("create_asset_records", "Create user-confirmed character, scene, prop, style, image, video, or model3d asset nodes. Local write only.", schema.create_asset_records),
    select_asset_revision: makeTool("select_asset_revision", "Select one existing asset revision as current without deleting any prior revision.", schema.select_asset_revision),
    archive_asset_revision: makeTool("archive_asset_revision", "Archive one existing asset revision without physically deleting it.", schema.archive_asset_revision),
    place_assets_on_timeline: makeTool("place_assets_on_timeline", "Place user-confirmed generated storyboard assets on the timeline in deterministic shot order.", schema.place_assets_on_timeline),
    submit_generation_intent: makeTool("submit_generation_intent", "Submit a user-confirmed paid generation intent for existing nodes. Never call this before the user approves the confirmation card.", schema.submit_generation_intent),
    cancel_provider_task: makeTool("cancel_provider_task", "Cancel an existing Provider task after user confirmation. This never creates or retries a generation; unsupported Providers return an explicit not-supported result.", schema.cancel_provider_task),
  } as const;
}

// Creation-area document tools. We reuse the zod schemas + descriptions from
// `documentTools` (the source of truth) but wrap each in the v2 confirmation
// channel via `makeAgentTool`. read_* tools auto-confirm on the renderer; the
// write tools (insert/replace/append) surface a confirmation card.
function buildDocumentToolsForV2(hooks: AgentChatV2Hooks) {
  const make = (name: DocumentToolName) =>
    makeAgentTool(hooks, name, documentTools[name].description ?? name, documentTools[name].parameters as z.ZodTypeAny);

  return {
    read_full_text: make("read_full_text"),
    read_selection: make("read_selection"),
    insert_at_cursor: make("insert_at_cursor"),
    replace_selection: make("replace_selection"),
    append_to_end: make("append_to_end"),
    author_skill: make("author_skill"),
  } as const;
}

function buildVibingDirectorToolsForV2(hooks: AgentChatV2Hooks) {
  const make = <TParams extends z.ZodTypeAny>(
    name: VibingDirectorToolName,
    description: string,
    parameters: TParams,
    normalizeArgs?: (args: unknown) => unknown | null,
  ) => makeAgentTool(hooks, name, description, parameters, normalizeArgs);
  return {
    read_vibing_director: make(
      "read_vibing_director",
      "Read the current Blender-backed VIBING Director state: creative brief, licensed local asset library, Blender objects, persistent spatial relations, camera, beats and latest returned artifacts. You must call this once in the current turn before proposing any apply_vibing_director_plan call.",
      readVibingDirectorParamsSchema,
    ),
    apply_vibing_director_plan: make(
      "apply_vibing_director_plan",
      "After reading the current Director in this turn, propose one bounded Blender Director plan. It may only select the declared stage preset or blocking template, place an asset already in this node's local asset library, add a semantic blocking marker, move or remove a known object, set or remove persistent spatial relations, set the director camera/path, and set beats. Never use code, Blender Python, shell commands, URLs, arbitrary files, downloads, or canvas operations. The user must confirm before Nomi starts local Blender.",
      applyVibingDirectorPlanParamsSchema,
      parseVibingDirectorPlanRequest,
    ),
  } as const;
}

export type AgentToolGroup = "canvas" | "document" | "vibing-director";

export function agentToolGroupForSkill(skillKey: string | undefined): AgentToolGroup {
  if (typeof skillKey === "string" && skillKey.startsWith("workbench.creation.")) return "document";
  if (typeof skillKey === "string" && skillKey.startsWith("workbench.vibing-director")) return "vibing-director";
  return "canvas";
}

// Manifest-backed skills are capability-driven: the hard whitelist selects from
// every registered Agent tool, independent of the skill name. Markdown-only
// legacy skills keep the old name-prefix group routing for compatibility.
export function buildToolsForSkill(
  skillKey: string | undefined,
  hooks: AgentChatV2Hooks,
  allowedTools: readonly string[] | null = null,
) {
  if (allowedTools !== null) {
    const { _kindSchema, ...canvasTools } = buildCanvasToolsForV2(hooks);
    void _kindSchema;
    return filterAgentTools({
      ...canvasTools,
      ...buildCinematicDirectorToolsForV2(hooks),
      ...buildDocumentToolsForV2(hooks),
      ...buildVibingDirectorToolsForV2(hooks),
    }, allowedTools);
  }
  const group = agentToolGroupForSkill(skillKey);
  if (group === "document") return filterAgentTools(buildDocumentToolsForV2(hooks), allowedTools);
  if (group === "vibing-director") return filterAgentTools(buildVibingDirectorToolsForV2(hooks), allowedTools);
  {
    const { _kindSchema, ...canvasTools } = buildCanvasToolsForV2(hooks);
    void _kindSchema;
    return filterAgentTools(canvasTools, allowedTools);
  }
}

export type RunAgentChatV2Payload = {
  prompt: string;
  displayPrompt?: string;
  systemPrompt?: string;
  skill?: unknown;
  skillKey?: string;
  skillName?: string;
  /** Explicit playbook stage selected by the canvas skill node / stage confirmation UI. */
  playbookStageId?: string;
  chatContext?: unknown;
  /** Use a text-only compatibility protocol instead of provider-native tools. */
  disableTools?: boolean;
  mode?: string;
  temperature?: number;
  agentModelKey?: string; // 助手模型偏好（用户选的）：优先用，否则回退第一个可用 text 模型
  agentVendorKey?: string;
  /** 待发附件：图片走原生多模态（image part）；文件 S4 抽文本。 */
  attachments?: AgentUserAttachment[];
  /**
   * Shared conversation memory key. Both workbench panels use
   * `nomi:workbench:<projectId|local>` so the agent remembers across turns and
   * across the creation / generation areas. Omitted = no memory (one-shot).
   */
  sessionKey?: string;
  /** Drop any stored history for this sessionKey before running ("新对话"). */
  resetSession?: boolean;
};

// In-memory conversation history, keyed by sessionKey. Lives only for the app
// session (cleared on quit). Capped per key (capAgentHistory) so prompts can't
// grow unbounded. History/maxSteps/repair helpers live in ./ai/agentChatHarness.
const agentChatV2History = new Map<string, CoreMessage[]>();

/** S1b 诚实探针:LLM 是否还记得这个会话(气泡在而记忆空 → UI 必须画「新会话」分隔线)。 */
export function hasAgentChatV2History(sessionKey: string): boolean {
  const key = String(sessionKey || "").trim();
  if (!key) return false;
  if ((agentChatV2History.get(key)?.length ?? 0) > 0) return true;
  // 选项②:内存 Map 冷启动为空时,磁盘有持久工作缓存 → 重启后仍算"记得"(首个请求会回灌)。
  return hasPersistedAgentSession(key);
}

/** Drop stored history for a session (or all sessions when no key given). */
export function clearAgentChatV2History(sessionKey?: string): void {
  if (sessionKey && sessionKey.trim()) {
    agentChatV2History.delete(sessionKey.trim());
    clearAgentSession(sessionKey.trim()); // 选项②:清会话连磁盘工作缓存一起删
  } else {
    agentChatV2History.clear();
  }
}

/**
 * 把界面气泡({role,content})规范化成模型工作缓存的轮次(纯函数,便于单测)。
 * 规则:user/assistant 文本轮保留;**tool 气泡(操作回执)折成一句 assistant 旁注**——让续聊的模型
 * 知道自己上次做过什么(建了哪些节点/连了哪些边),不再整条丢弃以致重复建或指代不存在的 clientId。
 * 合并连续同角色、首条须 user、末条须 assistant(满足 Anthropic 严格交替,下一句 user 接得上)。
 */
export function bubblesToSeedTurns(bubbles: ReadonlyArray<{ role?: string; content?: string }>): CoreMessage[] {
  const turns: CoreMessage[] = [];
  for (const bubble of bubbles) {
    const rawRole = bubble?.role;
    // tool 也并入 assistant 侧(它是 AI 这一方的操作),保持严格交替。
    const role = rawRole === "user" ? "user" : rawRole === "assistant" || rawRole === "tool" ? "assistant" : null;
    if (!role) continue;
    let content = sanitizeForBroadCompat(typeof bubble?.content === "string" ? bubble.content.trim() : "");
    if (!content) continue;
    if (rawRole === "tool") content = `（已执行操作：${content.split("\n")[0].slice(0, 100)}）`;
    const last = turns[turns.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${content}`;
    } else {
      turns.push({ role, content });
    }
  }
  while (turns.length && turns[0].role === "assistant") turns.shift();
  while (turns.length && turns[turns.length - 1].role === "user") turns.pop();
  return turns;
}

/**
 * 会话历史(2026-06-14):翻回旧对话时,从该线程的界面气泡重建模型工作缓存,让模型「记起」这段、
 * 能无缝接着聊。空 → 等价 clear。规范化见 bubblesToSeedTurns。
 */
export function seedAgentChatV2History(
  sessionKey: string,
  bubbles: ReadonlyArray<{ role?: string; content?: string }>,
): void {
  const key = String(sessionKey || "").trim();
  if (!key) return;
  const turns = bubblesToSeedTurns(bubbles);
  if (turns.length === 0) {
    agentChatV2History.delete(key);
    clearAgentSession(key);
    return;
  }
  const capped = capAgentHistory(turns);
  agentChatV2History.set(key, capped);
  saveAgentSession(key, capped);
}

function readAgentAttachments(payload: RunAgentChatV2Payload): AgentUserAttachment[] {
  const raw = (payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return [];
  const out: AgentUserAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const url = typeof rec.url === "string" ? rec.url : "";
    if (!url) continue;
    out.push({
      url,
      contentType: typeof rec.contentType === "string" ? rec.contentType : "application/octet-stream",
      fileName: typeof rec.fileName === "string" ? rec.fileName : "asset",
      kind: rec.kind === "image" ? "image" : "file",
    });
  }
  return out;
}

export async function runAgentChatV2(
  payload: RunAgentChatV2Payload,
  hooks: AgentChatV2Hooks,
): Promise<{ id: string; text: string; finishReason: string; usage?: unknown }> {
  const attachments = readAgentAttachments(payload);
  // 带图片或 PDF 时，优先选支持多模态输入的 text 模型（vision 模型也基本支持 PDF file part）。
  const wantsRichInput = attachments.some(
    (item) =>
      item.kind === "image" ||
      item.contentType.toLowerCase().includes("pdf") ||
      item.fileName.toLowerCase().endsWith(".pdf"),
  );
  const { vendor, model, apiKey } = chooseTextModel(
    {
      modelKey: trim(payload.agentModelKey),
      vendorKey: trim(payload.agentVendorKey),
    },
    wantsRichInput,
    payload.disableTools !== true,
  );
  const systemPrompt = trim(payload.systemPrompt as unknown as JsonRecord["systemPrompt"]);
  const requestedSkill = readRequestedSkill(payload as unknown as JsonRecord);
  const resolvedSkillKey = requestedSkill.key || trim(payload.skillKey);
  const skillExecution = resolveAgentSkillExecution(
    {
      skillKey: resolvedSkillKey,
      skillName: requestedSkill.name || trim(payload.skillName),
      stageId: trim(payload.playbookStageId) || undefined,
      mode: trim(payload.mode) || "auto",
    },
    readSkillRecords(),
  );
  // 收口 sanitize（P0-6）：送进 LLM 的 user/system 文本 ASCII 可移植化（防 Moonshot 等 tokenizer 异常）。
  const userPrompt = sanitizeForBroadCompat(trim(payload.prompt) || trim(payload.displayPrompt));

  // 项目记忆的「共享 block」单一注入点(切片0):按 sessionKey 解析 projectId,创作区/生成区
  // 同走这里 → 两 agent 共享同一份项目记忆(根治「创作助手失明」)。放 system 末尾——记忆变更
  // 最频繁,殿后只击穿后缀缓存,前面身份/专长/skill 的 vendor 前缀缓存仍命中。注入失败不阻断。
  let memoryBlock = "";
  try {
    const memoryProjectId = projectIdFromSessionKey(trim(payload.sessionKey));
    if (memoryProjectId) memoryBlock = formatMemoryForPrompt(getProjectMemory(memoryProjectId).facts);
  } catch {
    /* 记忆读取/提炼失败静默退回无记忆,绝不阻断对话 */
  }

  const toolFreeProtocol = payload.disableTools
    ? "最高优先级：本轮没有可调用的原生工具。忽略任何要求调用工具、展示补丁或解释的说明，严格按当前系统提示指定的结构化 JSON 文本协议回复。"
    : "";
  // 四层收口到单一合成器（B1c）：身份 + 面板专长 + skill 方法论 + 项目记忆，字节逐字节稳定。
  const system = composeAgentSystemPrompt({
    identity: NOMI_AGENT_IDENTITY,
    panelSystemPrompt: systemPrompt,
    skillSystemPrompt: skillExecution.systemPrompt,
    toolFreeProtocol,
    memoryBlock,
  });

  const languageModel = buildLanguageModelForVendor(vendor, model, apiKey);

  // Pick the tool group by skill: creation-area skills get document tools,
  // everything else gets canvas tools. The canonical skill key lives in
  // chatContext.skill.key; fall back to the top-level payload.skillKey.
  const tools = payload.disableTools
    ? {}
    : buildToolsForSkill(resolvedSkillKey, hooks, skillExecution.allowedTools);
  hooks.emit({
    type: "harness-config",
    vendorKey: vendor.key,
    modelKey: model.modelKey,
    skillKey: resolvedSkillKey,
    allowedTools: Object.keys(tools),
    playbook: skillExecution.playbook,
  });

  // Replay stored history for this session so the agent remembers prior turns
  // (within a panel and across the creation / generation areas, which share a
  // sessionKey). "新对话" sends resetSession to wipe it first.
  const sessionKey = trim(payload.sessionKey);
  if (sessionKey && payload.resetSession) {
    agentChatV2History.delete(sessionKey);
    clearAgentSession(sessionKey); // 选项②:「新对话」连磁盘工作缓存一起清
  }
  // 选项②冷启动回灌:内存 Map 没有但磁盘有 → 读回工作缓存,实现重启逐字续聊。
  if (sessionKey && !payload.resetSession && !agentChatV2History.has(sessionKey)) {
    const persisted = loadAgentSession(sessionKey);
    if (persisted && persisted.length) agentChatV2History.set(sessionKey, persisted);
  }
  const priorMessages = sessionKey ? (agentChatV2History.get(sessionKey) ?? []) : [];
  // 图片附件 → 原生多模态 image part（按模型能力门控，不支持则降级为文字 + 清晰提示）。
  const userContent = await buildAgentUserContent({
    prompt: userPrompt,
    attachments,
    supportsImageInput: modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta),
    supportsPdfInput: modelSupportsPdfInput(model.modelKey, model.modelAlias, model.meta),
    resolveBytes: (url) => {
      const asset = readNomiLocalAsset(url);
      return asset ? asset.bytes : null;
    },
    extractText: (att) => extractTextFromLocalAsset(att.url, att.contentType, att.fileName),
  });
  const userMessage: CoreMessage = { role: "user", content: userContent as CoreUserMessage["content"] };
  const messages: CoreMessage[] = [...priorMessages, userMessage];

  const abortController = createLinkedAbortController(hooks.abortSignal);
  // 只使用模型目录明确配置的输出上限，不在代码里编造短上限截断分镜 JSON。
  const metaMaxOutputTokens = Number((model.meta as Record<string, unknown> | undefined)?.maxOutputTokens);
  // 统一循环内核（S0）：maxSteps(skill)/retry/repair/prompt 缓存全在 agentLoop 一处。
  const result = runAgentLoop(
    {
      model: languageModel,
      ...(system ? { system } : {}),
      messages,
      tools,
      isAnthropic: normalizeProviderKind(vendor.providerKind) === "anthropic",
      temperature: payload.disableTools ? 0.2 : typeof payload.temperature === "number" ? payload.temperature : 0.7,
      ...(Number.isFinite(metaMaxOutputTokens) && metaMaxOutputTokens > 0
        ? { maxTokens: Math.floor(metaMaxOutputTokens) }
        : {}),
      skillKey: resolvedSkillKey,
      structuredJson: payload.disableTools === true,
      abortSignal: abortController.signal,
      vendorKey: vendor.key,
    },
    { onError: (message) => hooks.emit({ type: "error", message }) },
    { mode: "stream" },
  );

  const { finalText, finalFinish, finalUsage, ok } = await consumeAgentStreamWithTimeout(
    result,
    abortController,
    hooks,
    {
      firstChunkTimeoutMs: 90_000,
      idleTimeoutMs: 120_000,
      label: `${vendor?.key}/${model?.modelKey}/${resolvedSkillKey}`,
      vendorKey: vendor.key,
    },
  );

  // 空响应说人话（根因2）：finishReason=length + 空文本 = 典型「弱模型把内容塞进写工具 JSON
  // 被 max_tokens 截断」的失败签名（如 moonshot-v1 vision）。抛出带原因 + 换模型引导的错误，
  // 替代 UI 侧无信息量的「空响应：AI 没有返回文本」。canvas「纯工具成功轮」是 stop/tool-calls，不受影响。
  if (ok && !finalText.trim()) {
    const profile = getModelProfile(model.modelAlias || model.modelKey);
    const diagnostic = describeEmptyAgentReply(finalFinish, {
      modelLabel: model.labelZh || model.modelAlias || model.modelKey,
      ...(profile.agentSuitability ? { agentSuitability: profile.agentSuitability } : {}),
      ...(profile.agentNote ? { agentNote: profile.agentNote } : {}),
    });
    if (diagnostic) throw new Error(diagnostic);
  }

  // 历史只存简短 displayPrompt（不存含整张快照的完整 prompt，否则每轮各存一份旧快照、token 膨胀）。
  if (ok && sessionKey) {
    const generated = (await result.response).messages as CoreMessage[];
    const full: CoreMessage[] = [
      ...priorMessages,
      { role: "user", content: sanitizeForBroadCompat(trim(payload.displayPrompt)) || userPrompt },
      ...generated,
    ];
    const capped = capAgentHistory(full);
    // 截断真的发生 → 记 context.capped(C1 触发器观测;对话内"已不再记得最早 N 轮"提示的数据源)。
    if (capped.length < full.length) traceContextCapped(sessionKey, full.length - capped.length, capped.length);
    agentChatV2History.set(sessionKey, capped);
    saveAgentSession(sessionKey, capped); // 选项②:同步把工作缓存落盘,供下次重启回灌
  }

  return {
    id: `agent-${crypto.randomUUID()}`,
    text: finalText,
    finishReason: finalFinish,
    usage: finalUsage,
    ...(skillExecution.playbook ? { playbook: skillExecution.playbook } : {}),
  };
}
