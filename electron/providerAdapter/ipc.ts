import { ipcMain } from "electron";
import type { AdapterAuthType } from "./types";
import {
  getProviderAdapterService,
  type ProviderAdapterService,
  type ProviderAdapterStartInput,
} from "./service";
import { runLiveProviderAdapterHarnessFromEnv } from "./liveHarness";

function adapterStartInput(payload: unknown): ProviderAdapterStartInput {
  const raw = (payload || {}) as Record<string, unknown>;
  const models = Array.isArray(raw.models)
    ? raw.models.map((item) => {
        const model = (item || {}) as Record<string, unknown>;
        const kind = String(model.kind || "text");
        return {
          modelKey: String(model.modelKey || model.id || ""),
          labelZh: String(model.labelZh || model.displayName || "") || undefined,
          kind: (kind === "image" || kind === "video" || kind === "audio" || kind === "model3d" ? kind : "text") as ProviderAdapterStartInput["models"][number]["kind"],
        };
      })
    : [];
  const headers: Record<string, string> = {};
  if (raw.headers && typeof raw.headers === "object") {
    for (const [key, value] of Object.entries(raw.headers as Record<string, unknown>)) {
      const cleanKey = key.trim();
      const cleanValue = String(value ?? "").trim();
      if (cleanKey && cleanValue) headers[cleanKey] = cleanValue;
    }
  }
  const authType = String(raw.authType || "bearer") as AdapterAuthType;
  return {
    vendorName: String(raw.vendorName || "").trim(),
    baseUrl: String(raw.baseUrl || "").trim(),
    apiKey: String(raw.apiKey || "").trim(),
    authType: authType === "none" || authType === "x-api-key" || authType === "query" ? authType : "bearer",
    providerKind:
      raw.providerKind === "anthropic" || raw.providerKind === "openai-responses"
        ? raw.providerKind
        : "openai-compatible",
    ...(typeof raw.authHeader === "string" ? { authHeader: raw.authHeader } : {}),
    ...(typeof raw.authQueryParam === "string" ? { authQueryParam: raw.authQueryParam } : {}),
    headers,
    models,
  };
}

export function registerProviderAdapterIpc(service: ProviderAdapterService = getProviderAdapterService()): void {
  ipcMain.handle("nomi:provider-adapter:start", async (_event, payload: unknown) => {
    try {
      return { ok: true, run: service.start(adapterStartInput(payload)) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("nomi:provider-adapter:get", async (_event, payload: unknown) => {
    const runId = String((payload as { runId?: unknown } | null)?.runId || "").trim();
    const run = runId ? service.getRun(runId) : undefined;
    return run ? { ok: true, run } : { ok: false, error: "Provider adapter run not found" };
  });
  ipcMain.handle("nomi:provider-adapter:latest", async (_event, payload: unknown) => {
    const vendorKey = String((payload as { vendorKey?: unknown } | null)?.vendorKey || "").trim();
    const run = vendorKey ? service.latestRun(vendorKey) : undefined;
    return run ? { ok: true, run } : { ok: false, error: "Provider adapter run not found" };
  });
  service.resumeInterrupted();
  void runLiveProviderAdapterHarnessFromEnv(service);
}
