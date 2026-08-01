// 本地 ComfyUI 域的全部 IPC 注册（从 main.ts 拆出，给 800 行门腾空间；后续 comfy 通道加这里，别回填 main.ts）。
// 通道语义：probe / reconcile 是异步网络问询（ipcMain.handle）；analyze 纯解析、import/update 落库（同步）。
// 本文件自身被 main.ts 惰性 require（registerIpc 时才载入），内部用静态 import 即可，不再层层 require。
import { ipcMain } from "electron";
import { probeComfyuiSystemStats } from "./comfyuiProbe";
import {
  analyzeComfyWorkflowText,
  importComfyWorkflowToCatalog,
  reconcileComfyWorkflowText,
  updateComfyWorkflowInCatalog,
} from "./catalog/comfyuiWorkflowImportStore";
import { listComfyuiPresets } from "./catalog/comfyuiPresets";
import { interruptComfyuiTask, unwatchComfyuiTask, watchComfyuiTask } from "./comfyuiProgressSocket";

type RegisterSyncIpc = (channel: string, handler: (...args: unknown[]) => unknown) => void;

export function registerComfyuiIpc(registerSyncIpc: RegisterSyncIpc): void {
  // 健康探测（接入卡启用/重检调用；直连 localhost /system_stats，不走系统代理）。
  ipcMain.handle("nomi:model-catalog:comfyui:probe", (_event, baseUrl: unknown) => probeComfyuiSystemStats(String(baseUrl || "")));
  // 自定义 workflow 导入（S3）：analyze 同步纯解析；reconcile 异步问本机 /object_info 对账缺节点/缺模型；
  // import/update 落库为用户自有 model+mapping。
  registerSyncIpc("nomi:model-catalog:comfyui:analyze-workflow", (text: unknown) => analyzeComfyWorkflowText(text));
  ipcMain.handle("nomi:model-catalog:comfyui:reconcile-workflow", (_event, text: unknown) => reconcileComfyWorkflowText(text));
  registerSyncIpc("nomi:model-catalog:comfyui:import-workflow", (payload: unknown) => importComfyWorkflowToCatalog(payload));
  registerSyncIpc("nomi:model-catalog:comfyui:update-workflow", (payload: unknown) => updateComfyWorkflowInCatalog(payload));
  // 预置模板（S5）：静态清单，启用前经 reconcile 缺件闸、启用走既有 import 链。
  registerSyncIpc("nomi:model-catalog:comfyui:presets", () => listComfyuiPresets());
  // ws 进度桥（P 轨）：提交后 watch 登记 prompt_id→节点，进度/预览经 nomi:tasks:comfyui:progress 推回；
  // interrupt = 遮罩取消按钮（/interrupt + /queue delete 双发 best-effort）。
  ipcMain.handle("nomi:tasks:comfyui:watch", (event, payload: unknown) =>
    watchComfyuiTask((payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>, event.sender.id));
  ipcMain.handle("nomi:tasks:comfyui:unwatch", (_event, promptId: unknown) => unwatchComfyuiTask(promptId));
  ipcMain.handle("nomi:tasks:comfyui:interrupt", (_event, promptId: unknown) => interruptComfyuiTask(promptId));
}
