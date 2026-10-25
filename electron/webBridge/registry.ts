import { desktopT } from "../desktopStrings";
import type { WriteAsset } from "../catalog/processOperation";
import type { TaskRequest, TaskResult } from "../runtime";
import { queryJimengWebTask } from "../jimengWeb/seedanceBridge";
import { queryPavoWebTask } from "../pavoWeb/bridge";

type QueryInput = {
  vendor: string;
  taskCode: string;
  request: TaskRequest;
  projectId?: string;
  nodeId?: string;
  serverUrl?: unknown;
  writeAsset: WriteAsset;
};

export function isWebBridgeVendor(vendor: string): boolean {
  return vendor === "jimeng-web" || vendor === "pavo-web";
}

export async function queryWebBridgeTask(input: QueryInput): Promise<TaskResult> {
  if (input.vendor === "jimeng-web") {
    return queryJimengWebTask({
      taskCode: input.taskCode,
      request: input.request,
      projectId: input.projectId,
      nodeId: input.nodeId,
      serverUrl: input.serverUrl,
      writeAsset: input.writeAsset,
    });
  }
  if (input.vendor === "pavo-web") {
    return queryPavoWebTask({
      taskCode: input.taskCode,
      request: input.request,
      projectId: input.projectId,
      nodeId: input.nodeId,
      serverUrl: input.serverUrl,
      writeAsset: input.writeAsset,
    });
  }
  throw new Error(desktopT("custom.webBridge.registry.text1", { value0: `${input.vendor}` }));
}
