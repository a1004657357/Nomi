import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { applyRequestTransform, validateRequestTransform } from "../tasks/requestTransforms";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { AGNES_VIDEO_MODELS } from "./agnesVideos";
import { normalizeAgnesVideo25 } from "./agnesVideoContract";
import type { CatalogState } from "./types";

const FLASH = "agnes-video-2.5-flash";
const NOW = "2026-09-12T00:00:00.000Z";
const fresh = () => applyBuiltinSeeds({ version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, NOW).state;
const flashMappings = (state: CatalogState) => state.mappings.filter((mapping) => mapping.vendorKey === "agnes" && mapping.modelKey === FLASH);
const upstreamId = (id: string) => id.replace("video-2-5-flash", "video-2.5-flash");

describe("Agnes Flash merge identity", () => {
  it.each(["custom", "upstream", "both"])("%s seeds converge without changing user preferences or duplicating mappings", (source) => {
    const state = fresh();
    const model = state.models.find((item) => item.vendorKey === "agnes" && item.modelKey === FLASH)!;
    Object.assign(model, { enabled: false, labelZh: "My Flash", createdAt: "original" });
    const originals = flashMappings(state);
    originals.forEach((mapping) => Object.assign(mapping, { enabled: false, name: "My mapping", createdAt: "original" }));
    if (source === "upstream") originals.forEach((mapping) => { mapping.id = upstreamId(mapping.id); });
    if (source === "both") state.mappings.push(...originals.map((mapping) => ({ ...mapping, id: upstreamId(mapping.id), enabled: true, name: "Upstream mapping" })));
    const snapshot = JSON.stringify(state);
    const result = applyBuiltinSeeds(state, NOW);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(result.state.models.filter((item) => item.vendorKey === "agnes" && item.modelKey === FLASH)).toEqual([model]);
    expect(flashMappings(result.state)).toHaveLength(2);
    for (const mapping of flashMappings(result.state)) {
      expect(mapping).toMatchObject({ id: `seed-agnes-video-2-5-flash-${mapping.taskKind}`, enabled: false, name: "My mapping", createdAt: "original" });
      expect(mapping.query?.query?.model_name).toBe(FLASH);
    }
    expect(applyBuiltinSeeds(result.state, NOW).changed).toBe(false);
  });

  it("a disabled upstream seed stays disabled when merged with an enabled custom seed", () => {
    const state = fresh();
    state.mappings.push(...flashMappings(state).map((mapping) => ({ ...mapping, id: upstreamId(mapping.id), enabled: false })));
    expect(flashMappings(applyBuiltinSeeds(state, NOW).state).every((mapping) => !mapping.enabled)).toBe(true);
  });

  it("does not rewrite user-created mappings or mappings owned by another vendor", () => {
    const state = fresh();
    const template = flashMappings(state)[0];
    const user = { ...template, id: "user-flash", create: { method: "POST", path: "/custom" } };
    const other = { ...template, id: upstreamId(template.id), vendorKey: "my-relay" };
    state.mappings.push(user, other);
    const result = applyBuiltinSeeds(state, NOW).state;
    expect(result.mappings.find((mapping) => mapping.id === user.id)).toEqual(user);
    expect(result.mappings.find((mapping) => mapping.id === other.id)).toEqual(other);
  });
});

describe("Agnes polling request construction", () => {
  it.each([
    ["https://apihub.agnes-ai.com", "https://apihub.agnes-ai.com/agnesapi"],
    ["https://apihub.agnes-ai.com/v1/", "https://apihub.agnes-ai.com/agnesapi"],
    ["https://relay.example/agnes/v1", "https://relay.example/agnes/agnesapi"],
  ])("keeps the configured host and removes only the version prefix: %s", (baseUrl, expectedUrl) => {
    for (const model of AGNES_VIDEO_MODELS) {
      const request = buildHttpRequest({
        baseUrl, authType: "bearer", apiKey: "fixture-only", operation: model.query,
        context: buildTemplateContext({ request: {}, params: {}, model: {}, modelKey: model.modelKey, apiKey: "fixture-only", providerMeta: { video_id: "video_fixture" } }),
      });
      expect(request).toMatchObject({ method: "GET", url: expectedUrl, query: { video_id: "video_fixture" } });
      expect(request.query.model_name).toBe(model.modelKey === "agnes-video-v2.0" ? undefined : model.modelKey);
    }
  });
});

describe("Agnes current reference limits before spend", () => {
  const body = { model: "agnes-video-2.5", mode: "text", size: "720P", seconds: "5", n: 1 };
  const refs = (count: number) => Array.from({ length: count }, (_, i) => `https://example.com/${i}`);

  it.each(["720P", "1080P", "1K", "2K"])("accepts documented ordinary tier %s", (size) => {
    expect(normalizeAgnesVideo25({ ...body, size })).toMatchObject({ size });
  });

  it.each([
    { size: "960P" }, { n: 2 },
    { mode: "reference", images: refs(9) },
    { mode: "reference", audios: refs(4) },
    { mode: "reference", videos: refs(2) },
    { model: FLASH, mode: "reference", images: refs(6) },
    { model: FLASH, mode: "reference", audios: refs(4) },
    { model: FLASH, mode: "reference", videos: refs(1) },
  ])("rejects unsupported input in both registered preflight and wire transform: %j", async (input) => {
    await expect(validateRequestTransform("agnes-video-2.5", { ...body, ...input }, { baseUrl: "https://example.com" })).rejects.toThrow();
    await expect(applyRequestTransform("agnes-video-2.5", { ...body, ...input }, { baseUrl: "https://example.com" })).rejects.toThrow();
  });

  it("accepts the ordinary twelve-file boundary and Flash image/audio-only boundary", () => {
    expect(normalizeAgnesVideo25({ ...body, mode: "reference", images: refs(8), audios: refs(3), videos: refs(1) })).toMatchObject({ videos: [{ url: refs(1)[0] }] });
    expect(normalizeAgnesVideo25({ ...body, model: FLASH, mode: "reference", images: refs(5), audios: refs(3) })).toMatchObject({ images: refs(5), audios: refs(3) });
  });
});
