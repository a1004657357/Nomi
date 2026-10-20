import { describe, expect, it } from "vitest";
import { buildWireDefaultsFor } from "../../scripts/gen-archetype-wire-defaults";
import { getArchetypeById, resolveArchetypeForModel } from "../shared/modelArchetypes";
import type { ModelArchetype } from "../shared/modelArchetypes/types";
import { sourceBackedVideoProfiles } from "../shared/videoCapabilities";
import { AGNES_VIDEO_25_FLASH_ARCHETYPE } from "../shared/modelArchetypes/agnesVideo25Flash";
import { DREAMINA_SEEDANCE_25_ARCHETYPE } from "../shared/modelArchetypes/dreaminaSeedance25";
import { JIMENG_WEB_SEEDANCE_ARCHETYPE } from "../shared/modelArchetypes/jimengWebSeedance";
import { MINIMAX_H3_PIXSTAG_ARCHETYPE } from "../shared/modelArchetypes/minimaxH3Pixstag";
import { builtinVendorSeed } from "./builtinVendorSeeds";
import { deriveModelListing, videoBodyKeysForModel } from "./modelCatalogListing";
import { applyBuiltinSeeds, builtinCatalogModelKeys } from "./seedBuiltins";
import type { CatalogState } from "./types";

const emptyCatalog = (): CatalogState => ({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
const now = "2026-10-20T00:00:00.000Z";

describe("v0.23.2 customized catalog integration", () => {
  it("keeps custom video compatibility imports on the canonical shared objects", () => {
    for (const profile of [AGNES_VIDEO_25_FLASH_ARCHETYPE, DREAMINA_SEEDANCE_25_ARCHETYPE, JIMENG_WEB_SEEDANCE_ARCHETYPE, MINIMAX_H3_PIXSTAG_ARCHETYPE]) {
      expect(getArchetypeById(profile.id)).toBe(profile);
      expect(sourceBackedVideoProfiles()).toContain(profile);
    }
  });

  it("retains each custom model in the immutable builtin contract table and seed output", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), now).state;
    for (const [vendorKey, modelKey] of [
      ["codex", "codex-img2"],
      ["jimeng-web", "jimeng-web-image"],
      ["jimeng-web", "jimeng-web-seedance-2.0"],
      ["pavo-web", "pavo-agnes-video-2.5-flash"],
      ["pixstag", "MiniMax-H3"],
      ["dreamina", "dreamina-seedance-2.5"],
    ]) {
      expect(builtinVendorSeed(vendorKey)).toBeDefined();
      expect(builtinCatalogModelKeys(vendorKey).has(modelKey)).toBe(true);
      expect(state.models.find((model) => model.vendorKey === vendorKey && model.modelKey === modelKey)).toBeDefined();
    }
    expect(builtinVendorSeed("codex")?.baseUrl).toBeNull();
    expect(applyBuiltinSeeds(state, now).changed).toBe(false);
  });

  it("does not reseed a deliberately suppressed custom model", () => {
    const state = emptyCatalog();
    state.suppressedBuiltinModels = [{ vendorKey: "jimeng-web", modelKey: "jimeng-web-image" }];
    const seeded = applyBuiltinSeeds(state, now).state;
    expect(seeded.models.some((model) => model.vendorKey === "jimeng-web" && model.modelKey === "jimeng-web-image")).toBe(false);
  });

  it("preserves Codex identity aliases and Pavo vendor-specific controls", () => {
    for (const modelKey of ["codex-img2", "codex-imagegen-img2", "gpt_image_2"]) {
      expect(resolveArchetypeForModel({ vendorKey: null, modelKey })?.id).toBe("gpt-image-2");
    }
    const pavo = resolveArchetypeForModel({
      vendorKey: "pavo-web", modelKey: "pavo-agnes-video-2.5-flash", meta: { archetypeId: "agnes-video-2.5-flash" },
    });
    expect(pavo?.modes.every((mode) => mode.params.find((param) => param.key === "duration")?.options.map((option) => option.value).join() === "5,10")).toBe(true);
    const reference = pavo?.modes.find((mode) => mode.id === "reference");
    expect(reference?.slots.map((slot) => [slot.kind, slot.max])).toEqual([["image_ref", 5], ["audio_ref", 3]]);
  });

  it("keeps Pavo multi-image/audio support without manufacturing HTTP mappings", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), now).state;
    expect(state.mappings.some((mapping) => mapping.vendorKey === "pavo-web")).toBe(false);
    expect(videoBodyKeysForModel(state, "pavo-web", "pavo-agnes-video-2.5-flash")).toEqual(["first_frame", "last_frame", "mm_audios", "mm_images"]);
    // A certified projection isolates reference reporting from the separate publication integration.
    const pavo = state.models.find((model) => model.vendorKey === "pavo-web")!;
    pavo.meta = { archetypeId: "agnes-video-2.5-flash", adapter: { activeRevision: "fixture", modes: [{ taskKind: "image_to_video", state: "verified" }] } };
    expect(deriveModelListing(state).find((model) => model.vendor === "pavo-web")?.references).toEqual({
      image: true, multiImage: true, audio: true, video: false, referenceModes: ["image_to_video"],
    });
  });

  it("keeps default-variant overrides after vendor parameters and transport bucketing", () => {
    const profile: ModelArchetype = {
      id: "variant-vendor-fixture", family: "fixture", label: "fixture", kind: "video", identifierPatterns: [],
      defaultModeId: "text", transportTaskKind: "text_to_video", defaultVariantId: "fast",
      variants: [{ id: "fast", label: "Fast", modelKey: "fixture-fast", paramOverrides: {
        text: (params) => params.map((param) => ({ ...param, defaultValue: Number(param.defaultValue) + 1 })),
      } }],
      modes: [{
        id: "text", intent: "text", vendorTerm: "", hint: "", slots: [], promptRequired: true,
        params: [{ key: "duration", label: "", type: "number", options: [], defaultValue: 5 }],
        vendorParams: { fixture: [{ key: "duration", label: "", type: "number", options: [], defaultValue: 7 }] },
        vendorTransportTaskKind: { fixture: "image_to_video" },
      }],
    };
    const defaults = buildWireDefaultsFor([profile])[profile.id];
    expect(defaults.text_to_video["*"]).toEqual({ duration: 6, model: "fixture-fast" });
    expect(defaults.image_to_video.fixture).toEqual({ duration: 8, model: "fixture-fast" });
  });
});
