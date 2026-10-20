import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { pavoExtensionCandidates, resolvePavoExtensionDir, pavoWebServerProcessEnv } from "./runner";
import { resolveArchetypeForModel } from "../shared/modelArchetypes";

describe("Nomi bundled Pavo runtime", () => {
  it("does not overwrite host connection settings when installation initialization finishes late", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "integrations/pavo-web-adapter/background.js"), "utf8");
    let installed: () => void = () => {};
    let completeRead: (data: object) => void = () => {};
    const storage: Record<string, unknown> = {};
    vm.runInNewContext(source, { chrome: {
      runtime: { onInstalled: { addListener: (callback: () => void) => { installed = callback; } }, onMessage: { addListener: () => {} } },
      storage: { local: { get: (_keys: string[], callback: (data: object) => void) => { completeRead = callback; }, set: (values: object) => Object.assign(storage, values) } },
      tabs: { query: async () => [] }, action: { onClicked: { addListener: () => {} } },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
    } });
    installed();
    Object.assign(storage, { apiBaseUrl: "http://127.0.0.1:45678", apiToken: "local-fixture-token" });
    completeRead({});
    expect(storage.apiBaseUrl).toBe("http://127.0.0.1:45678");
    expect(storage.apiToken).toBe("local-fixture-token");
    expect(storage.preset).toMatchObject({ resolution: "720P" });
  });
  it("connects the gateway without awaiting a slow website readiness probe", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "integrations/pavo-web-adapter/panel.js"), "utf8");
    const startup = source.slice(source.lastIndexOf("    await loadState();")).split("    void (async () => {")[0];
    expect(startup).not.toContain("await refreshPageStatus();");
    expect(startup.indexOf("await probeBridge();")).toBeLessThan(startup.indexOf("void refreshPageStatus();"));
  });
  it("resolves the embedded safety-patched adapter, not a sibling legacy extension", () => {
    const dir = resolvePavoExtensionDir();
    expect(dir).toBe(path.join(process.cwd(), "integrations", "pavo-web-adapter"));
    expect(pavoExtensionCandidates()).not.toContain(path.resolve(process.cwd(), "..", "Pavo-Web-Automation-Adapter"));
    expect(JSON.parse(fs.readFileSync(path.join(dir!, "manifest.json"), "utf8")).version).toBe("0.2.1");
  });

  it("rejects an older extension even with manifest and server files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pavo-old-contract-"));
    try {
      fs.writeFileSync(path.join(dir, "manifest.json"), "{}");
      fs.writeFileSync(path.join(dir, "mock-server.js"), "");
      expect(resolvePavoExtensionDir(dir)).toBeNull();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("uses Electron's bundled Node runtime and isolated persistent data", () => {
    const env = pavoWebServerProcessEnv("http://127.0.0.1:3458");
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.NOMI_PAVO_WEB_DATA_DIR).toContain("pavo-web-bridge");
    expect(env.NOMI_PAVO_WEB_PARENT_PID).toBe(String(process.pid));
  });

  it("narrows Pavo controls without changing direct AGNES capabilities", () => {
    const model = { modelKey: "pavo-agnes-video-2.5-flash", meta: { archetypeId: "agnes-video-2.5-flash" } };
    const pavo = resolveArchetypeForModel({ ...model, vendorKey: "pavo-web" })!;
    const direct = resolveArchetypeForModel({ ...model, vendorKey: "agnes" })!;
    for (const mode of pavo.modes) {
      expect(mode.params.find(param => param.key === "duration")?.options.map(option => option.value)).toEqual(["5", "10"]);
      expect(mode.params.find(param => param.key === "aspect_ratio")?.options.map(option => option.value)).toEqual(["16:9", "9:16", "1:1"]);
      expect(mode.params.some(param => param.key === "seed")).toBe(false);
    }
    expect(direct.modes[0].params.find(param => param.key === "duration")?.options).toHaveLength(9);
  });

  it("ships the embedded runtime with packaged Nomi", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.build.extraResources.some((resource: { from: string; to: string }) => resource.from === "integrations/pavo-web-adapter" && resource.to === "pavo-web-adapter")).toBe(true);
  });
});
