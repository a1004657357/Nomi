// 技术自检的事件落账 + 渲染层广播(harness S4-2b)。
// 异步旁路:localizeTaskAsset 落地文件后 fire-and-forget,任何失败只 console,
// 绝不挡 addNodeResult 的用户感知(评测方案后端#8 裁定)。
import crypto from "node:crypto";
import { webContents as electronWebContents } from "electron";
import { appendEvents } from "../events/eventLogRepository";
import { runTechnicalCheck } from "./technicalCheck";
import { logError } from "../logging/logger";

const pendingTechnicalReviews = new Set<Promise<void>>();

export function scheduleTechnicalReview(input: {
  projectId: string;
  nodeId?: string;
  absolutePath: string;
  assetUrl: string;
  type: "image" | "video";
  expectedAspectRatio?: string;
  expectedDurationSeconds?: number;
}): void {
  if (!input.projectId || !input.absolutePath) return;
  const review = (async () => {
    try {
      const verdict = await runTechnicalCheck(input.absolutePath, input.type, {
        expectedAspectRatio: input.expectedAspectRatio,
        expectedDurationSeconds: input.expectedDurationSeconds,
      });
      appendEvents(input.projectId, [
        {
          id: `evt_${crypto.randomUUID().slice(0, 12)}`,
          source: "runtime",
          type: "review.technical.completed",
          payload: {
            ...(input.nodeId ? { nodeId: input.nodeId } : {}),
            assetUrl: input.assetUrl,
            verdict: verdict.suspect ? "suspect" : "ok",
            checks: verdict.checks,
          },
        },
      ]);
      // 广播给所有窗口:渲染层把 verdict 写进节点 meta(⚠ 投影的数据源)。
      for (const contents of electronWebContents.getAllWebContents()) {
        if (!contents.isDestroyed()) {
          contents.send("nomi:review:event", { projectId: input.projectId, nodeId: input.nodeId || "", verdict });
        }
      }
    } catch (error) {
      logError("review", "self-check-bypass-failed", error);
    }
  })();
  pendingTechnicalReviews.add(review);
  void review.finally(() => pendingTechnicalReviews.delete(review));
}

/** 一次性 headless host 退出前等待免费技术验收落账；桌面运行时仍保持异步旁路。 */
export async function flushPendingTechnicalReviews(): Promise<void> {
  while (pendingTechnicalReviews.size > 0) {
    await Promise.allSettled(Array.from(pendingTechnicalReviews));
  }
}
