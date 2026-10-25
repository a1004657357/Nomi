import { app, ipcMain } from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import { createTaskSubmissionRuntime } from "./taskSubmissionRuntime";
import { taskCancellationRuntime } from "./taskCancellationRuntime";
import { mintSpendGrant } from "../spendGrant";
import { prepareSpendQuote, takeSpendQuote } from "../spendQuote";
import type { SpendQuoteInput } from "../shared/contracts/spendQuote";
import { runTaskIpcGuard } from "./taskIpcGuard";
import { withTaskOwner } from "./localTaskJobs";
import { antigravityImageJobs } from "../catalog/antigravityImageOperation";
import { recordPersistedTaskCancellation } from "../submissionLedger";
import { cancelComfyCandidateTest, failComfyCandidateEnvelope, runComfyCandidateTest } from "./comfyCandidateTest";

type RuntimeLoader = () => Promise<typeof import("../runtime")>;

/** Register the renderer task boundary, including the spend-grant trust check. */
export function registerTaskIpcHandlers(
  loadRuntimeModule: RuntimeLoader,
  taskRuntime = createTaskSubmissionRuntime(loadRuntimeModule),
): void {
  const owners = new Set<number>();
  let draining = false;
  let drained = false;
  app.on("will-quit", (event) => {
    if (drained) return;
    event.preventDefault();
    if (draining) return;
    draining = true;
    void antigravityImageJobs.cancelAll().finally(() => { drained = true; app.quit(); });
  });
  ipcMain.handle("nomi:tasks:quote-spend", (event, inputs: SpendQuoteInput[]) => {
    assertTrustedSender(event);
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 1000) throw new Error("Invalid quote targets");
    return prepareSpendQuote(inputs);
  });
  // 付费守卫铸令牌：仅由渲染层「真人确认」事件链调用（务实纵深：铸造面小而审计过 + 主进程硬闸兜底）。
  ipcMain.handle("nomi:tasks:grant-spend", (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as { nodeIds?: unknown; maxAttemptsPerNode?: unknown; quoteId?: string; ttlMs?: number };
    const nodeIds = Array.isArray(raw.nodeIds) ? raw.nodeIds.map((id) => String(id)) : [];
    const maxAttemptsPerNode = typeof raw.maxAttemptsPerNode === "number" ? raw.maxAttemptsPerNode : undefined;
    const ttlMs = typeof raw.ttlMs === 'number' && Number.isFinite(raw.ttlMs)
      ? Math.max(60_000, Math.min(4 * 60 * 60_000, Math.floor(raw.ttlMs))) : undefined;
    return { grantId: mintSpendGrant({ nodeIds, ...(maxAttemptsPerNode ? { maxAttemptsPerNode } : {}), ...(ttlMs ? { ttlMs } : {}), ...(raw.quoteId ? { quote: takeSpendQuote(raw.quoteId) } : {}) }) };
  });

  // 提交幂等包在 IPC 边界：渲染层每次提交（含控制器重试）都经此，同 idempotencyKey 的提交内核 at-most-once。
  ipcMain.handle("nomi:tasks:run", (event, payload) => {
    assertTrustedSender(event);
    if (!owners.has(event.sender.id)) {
      const owner = event.sender.id; owners.add(owner);
      event.sender.once("destroyed", () => { owners.delete(owner); void antigravityImageJobs.cancelOwner(owner); });
    }
    return runTaskIpcGuard(payload, () => withTaskOwner(event.sender.id, () => taskRuntime.run(payload)));
  });

  ipcMain.handle("nomi:tasks:result", (event, payload) => {
    assertTrustedSender(event);
    return runTaskIpcGuard(payload, () => withTaskOwner(event.sender.id, () => taskRuntime.result(payload)));
  });
  ipcMain.handle("nomi:tasks:comfy-candidate-test", async (event, payload) => {
    assertTrustedSender(event);
    let ownerDestroyed = false;
    const envelope = (payload as { candidate?: unknown })?.candidate;
    const onDestroyed = () => {
      ownerDestroyed = true;
      cancelComfyCandidateTest(envelope);
      failComfyCandidateEnvelope(payload, "candidate_cancelled");
    };
    event.sender.once("destroyed", onDestroyed);
    try {
      return await runTaskIpcGuard(payload, async () => {
        const { runTask, fetchTaskResult } = await loadRuntimeModule();
        if (ownerDestroyed) return failComfyCandidateEnvelope(payload, "candidate_cancelled");
        return withTaskOwner(event.sender.id, () => runComfyCandidateTest(payload, { runTask, fetchTaskResult }));
      });
    } catch (error) {
      // 绑住这个 error：空 catch 曾把上游真因（含我们自己的出站策略拒绝）整个丢掉，
      // 只留一个裸码给界面渲染。真因脱敏后随 params.detail 一起交出去。
      return failComfyCandidateEnvelope(
        payload,
        ownerDestroyed ? "candidate_cancelled" : "provider_failed",
        ownerDestroyed ? undefined : error,
      );
    } finally {
      event.sender.removeListener("destroyed", onDestroyed);
    }
  });
  ipcMain.handle("nomi:tasks:comfy-candidate-cancel", (event, payload) => {
    assertTrustedSender(event);
    const result = cancelComfyCandidateTest(payload);
    failComfyCandidateEnvelope(payload, "candidate_cancelled");
    return result;
  });
  ipcMain.handle("nomi:tasks:cancel", (event, taskId: unknown) => {
    assertTrustedSender(event);
    const structured = taskId !== null && typeof taskId === "object";
    if (structured) {
      const payload = taskId as { taskId?: unknown; runId?: unknown };
      const localId = payload.taskId || payload.runId;
      if (typeof localId === "string" && localId.startsWith("local-")) taskId = localId;
      else return taskCancellationRuntime(payload);
    }
    if (typeof taskId !== "string" || !/^local-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(taskId)) throw new Error("LOCAL_TASK_INVALID_ID");
    const cancelled = antigravityImageJobs.cancel(taskId, event.sender.id).then((result) => {
      if (result.ok) recordPersistedTaskCancellation({ providerTaskId: taskId as string });
      return result;
    });
    return structured
      ? cancelled.then((result) => ({ cancelled: result.ok, remoteCancelled: false }))
      : cancelled;
  });
}
