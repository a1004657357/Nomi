// 本地 ComfyUI「导入工作流」的 store 集成层（S3 电子侧薄壳）。
// 纯解析/建图/建 model+mapping 在 comfyuiWorkflowImport（可测、零副作用）；这里只接 store 写 + 生成唯一
// modelKey + 把异常包成 { ok:false, error } 供 IPC 透传。独立成文件是为了不把 catalogStore 顶破 800 行门。
import { mutateCatalog, readCatalog, upsertModelCatalogModel, upsertModelCatalogMapping } from "./catalogStore";
import {
  parseComfyApiWorkflow,
  analyzeComfyWorkflow,
  importComfyWorkflow,
  reconcileComfyWorkflow,
  slugifyModelKey,
  type MissingEnumValue,
  type WorkflowAnalysis,
  type WorkflowBinding,
} from "./comfyuiWorkflowImport";
import { bustComfyObjectInfoCache, fetchComfyuiObjectInfoIndex } from "../comfyuiObjectInfo";
import { COMFYUI_VENDOR_KEY } from "./types";

export type AnalyzeWorkflowResult = { ok: true; analysis: WorkflowAnalysis } | { ok: false; error: string };
export type ImportWorkflowResult = { ok: true; modelKey: string; kind: string; taskKind: string } | { ok: false; error: string };
export type ReconcileWorkflowResult =
  | { ok: true; serverReachable: boolean; unknownNodeTypes: string[]; missingEnumValues: MissingEnumValue[] }
  | { ok: false; error: string };

/** 校验 + 分析（供 UI 映射预览）。坏格式返回 { ok:false, error } 而非抛——IPC 好透传成人话提示。 */
export function analyzeComfyWorkflowText(text: unknown): AnalyzeWorkflowResult {
  try {
    const graph = parseComfyApiWorkflow(String(text ?? ""));
    return { ok: true, analysis: analyzeComfyWorkflow(graph) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 缺件对账（异步，analyze 之外单独一条 IPC）：workflow vs 本机 ComfyUI /object_info。
 * serverReachable=false = ComfyUI 没开/连不上 → 跳过核对（导入不被阻断，面板给一行「未检查」提示）。
 */
export async function reconcileComfyWorkflowText(text: unknown): Promise<ReconcileWorkflowResult> {
  try {
    const graph = parseComfyApiWorkflow(String(text ?? ""));
    const vendor = readCatalog().vendors.find((v) => v.key === COMFYUI_VENDOR_KEY);
    const baseUrl = String(vendor?.baseUrlHint || "");
    // 对账是用户动作（分析/重新检测）：爆缓存拿新鲜事实——刚装好的模型必须立刻被认出来。
    bustComfyObjectInfoCache(baseUrl);
    const index = await fetchComfyuiObjectInfoIndex(baseUrl);
    if (!index) return { ok: true, serverReachable: false, unknownNodeTypes: [], missingEnumValues: [] };
    return { ok: true, serverReachable: true, ...reconcileComfyWorkflow(graph, index) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 按用户确认的绑定落库（用户自有 model+mapping，走普通 upsert → 不被 seedBuiltins reconcile 覆盖）。
 *  uniq 供 modelKey 去重（默认时间戳；测试传固定值求确定）。 */
export function importComfyWorkflowToCatalog(payload: unknown, uniq: string = Date.now().toString(36)): ImportWorkflowResult {
  try {
    const p = (payload && typeof payload === "object" ? payload : {}) as { text?: string; binding?: WorkflowBinding; labelZh?: string };
    const labelZh = String(p.labelZh || "").trim() || "本地 ComfyUI 工作流";
    const modelKey = slugifyModelKey(labelZh, uniq);
    const r = importComfyWorkflow(
      { text: String(p.text ?? ""), binding: p.binding ?? { numeric: [] }, labelZh, modelKey },
      upsertModelCatalogModel,
      upsertModelCatalogMapping,
    );
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 重新保存已导入 workflow：保留 modelKey，替换 model + mapping，并清掉该 modelKey 的旧 taskKind mapping。 */
export function updateComfyWorkflowInCatalog(payload: unknown): ImportWorkflowResult {
  try {
    const p = (payload && typeof payload === "object" ? payload : {}) as {
      modelKey?: string;
      text?: string;
      binding?: WorkflowBinding;
      labelZh?: string;
    };
    const modelKey = String(p.modelKey || "").trim();
    if (!modelKey) throw new Error("缺少要编辑的工作流 modelKey。");
    const labelZh = String(p.labelZh || "").trim() || "本地 ComfyUI 工作流";
    return mutateCatalog((tx) => {
      tx.deleteModelMappings(COMFYUI_VENDOR_KEY, modelKey);
      const r = importComfyWorkflow(
        { text: String(p.text ?? ""), binding: p.binding ?? { numeric: [] }, labelZh, modelKey },
        tx.upsertModel,
        tx.upsertMapping,
      );
      return { ok: true, ...r };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
