import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ importRemoteAsset: vi.fn(), appendEvents: vi.fn(), send: vi.fn(), probeMedia: vi.fn(async () => ({ kind: "image", width: 1254, height: 1254, hasAudio: false })) }));
vi.mock("electron", () => ({ webContents: { getAllWebContents: () => [{ isDestroyed: () => false, send: mocks.send }] } }));
vi.mock("../events/eventLogRepository", () => ({ appendEvents: mocks.appendEvents }));
vi.mock("../assets/projectAssetStore", () => ({ importRemoteAsset: mocks.importRemoteAsset, writeDeterministicAsset: vi.fn() }));
vi.mock("../assets/assetEvents", () => ({ broadcastAssetLocalizationStarted: vi.fn() }));
vi.mock("../catalog/assetLocalization", () => ({ trustedLocalOutputOrigin: () => null }));
vi.mock("../export/mediaProbe", () => ({ probeMediaMetadata: mocks.probeMedia }));

import { localizeTaskAsset } from "../assets/localizeTaskAsset";
import { createGenerationOutputMaterializer } from "../capabilityCore/generationOutputMaterializer";
import { readAssetSidecarMeta } from "../assets/assetSidecar";
import { flushPendingTechnicalReviews } from "./reviewTrace";

const dirs: string[] = [];
afterEach(async () => {
  await flushPendingTechnicalReviews();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("shared original-image specification recovery", () => {
  it("records unavailable requested pixels on recovered legacy originals without dropping or changing the image", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-size-legacy-"));
    dirs.push(dir);
    const absolutePath = path.join(dir, "original.png");
    const bytes = Buffer.from("legacy-original");
    fs.writeFileSync(absolutePath, bytes);
    mocks.importRemoteAsset.mockResolvedValue({ id: "legacy-asset", data: { absolutePath, url: "nomi-local://legacy.png", width: 1254, height: 1254 } });
    const receipt = await localizeTaskAsset("project", "data:image/png;base64,b3JpZ2luYWw=", "image", "node", undefined, undefined, null);
    expect(receipt.imageSizeValidation).toMatchObject({ requested: null, actual: { width: 1254, height: 1254 }, status: "unavailable", warning: "image_size_unavailable" });
    expect(readAssetSidecarMeta(absolutePath)).toMatchObject({ imageSizeValidation: receipt.imageSizeValidation });
    expect(fs.readFileSync(absolutePath)).toEqual(bytes);
    expect(mocks.importRemoteAsset).toHaveBeenCalledTimes(1);
  });
  it.each(["canvas", "agent"] as const)("%s keeps recovered images available when size probing fails", async (entrance) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-size-unavailable-"));
    dirs.push(dir);
    const absolutePath = path.join(dir, "original.png");
    const bytes = Buffer.from("unchanged-original");
    fs.writeFileSync(absolutePath, bytes);
    mocks.probeMedia.mockRejectedValueOnce(new Error("offline probe failure"));
    const stored = { id: "original-asset", data: { absolutePath, relativePath: "assets/generated/original.png", url: "nomi-local://original.png" } };
    mocks.importRemoteAsset.mockResolvedValue(stored);
    const receipt = entrance === "canvas"
      ? await localizeTaskAsset("project", "data:image/png;base64,b3JpZ2luYWw=", "image", "node", undefined, undefined, "1024x1024")
      : await createGenerationOutputMaterializer({ writeAsset: vi.fn(() => stored) }).materialize({ projectId: "project", providerTaskId: "task", output: { kind: "image", url: `data:image/png;base64,${bytes.toString("base64")}` }, expectedImageSize: "1024x1024" });
    expect(receipt.imageSizeValidation).toMatchObject({ status: "unavailable", actual: null, warning: "image_size_unavailable", requested: { width: 1024, height: 1024 } });
    expect(fs.readFileSync(absolutePath)).toEqual(bytes);
    expect(readAssetSidecarMeta(absolutePath)).toMatchObject({ imageSizeValidation: { status: "unavailable" } });
  });
  it.each(["canvas", "agent"] as const)("%s preserves original bytes and records a warning without repeating generation/download", async (entrance) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-size-warning-"));
    dirs.push(dir);
    const absolutePath = path.join(dir, "original.png");
    const bytes = Buffer.from("provider-original-fixture-not-a-resized-image");
    fs.writeFileSync(absolutePath, bytes);
    fs.writeFileSync(`${absolutePath}.meta`, JSON.stringify({ source: "provider", keep: "existing" }));
    const hash = () => crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
    const before = hash();
    const stored = { id: "original-asset", data: { absolutePath, relativePath: "assets/generated/original.png", url: "nomi-local://original.png", width: 1254, height: 1254 } };
    const fetchOutput = vi.fn();
    const writeAsset = vi.fn(() => stored);
    mocks.importRemoteAsset.mockResolvedValue(stored);
    const receipt = entrance === "canvas"
      ? await localizeTaskAsset("project", "data:image/png;base64,b3JpZ2luYWw=", "image", "node", undefined, undefined, "1024x1024")
      : await createGenerationOutputMaterializer({ fetchOutput, writeAsset }).materialize({ projectId: "project", providerTaskId: "task", output: { kind: "image", url: `data:image/png;base64,${bytes.toString("base64")}` }, expectedImageSize: "1024x1024" });
    expect(receipt).toMatchObject({ imageSizeValidation: {
      status: "mismatch", warning: "image_size_mismatch", requested: { width: 1024, height: 1024 }, actual: { width: 1254, height: 1254 }, originalPreserved: true, normalizationApplied: false,
    } });
    expect(hash()).toBe(before);
    expect(readAssetSidecarMeta(absolutePath)).toMatchObject({ keep: "existing", imageSizeValidation: { status: "mismatch" } });
    expect(mocks.appendEvents).toHaveBeenCalledWith("project", [expect.objectContaining({ type: "review.technical.completed", payload: expect.objectContaining({ verdict: "suspect", imageSizeValidation: { ...receipt.imageSizeValidation } }) })]);
    expect(mocks.send).toHaveBeenCalledWith("nomi:review:event", expect.objectContaining({ verdict: expect.objectContaining({ imageSizeValidation: receipt.imageSizeValidation }) }));
    expect(fetchOutput).not.toHaveBeenCalled();
    expect(entrance === "canvas" ? mocks.importRemoteAsset : writeAsset).toHaveBeenCalledTimes(1);
  });
});
