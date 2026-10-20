import { describe, expect, it, vi } from "vitest";
import { CODEX_IMG2_MODEL_SEED, CODEX_VENDOR_SEED } from "../catalog/codexImagegen";
import { JIMENG_WEB_IMAGE_MODEL_SEED, JIMENG_WEB_SEEDANCE_MODEL_SEED, JIMENG_WEB_VENDOR_SEED } from "../catalog/jimengWeb";
import { PAVO_WEB_AGNES_FLASH_MODEL_SEED, PAVO_WEB_VENDOR_SEED } from "../catalog/pavoWeb";
import { applyBuiltinSeeds } from "../catalog/seedBuiltins";
import { deriveModelListing } from "../catalog/modelCatalogListing";
import type { CatalogState, ProfileKind } from "../catalog/types";
import { deriveModelAvailability } from "./modelAvailability";
import { derivePublishedExecution } from "./modelPublication";

const entries: { vendorKey: string; modelKey: string; kind: string; modes: ProfileKind[] }[] = [
  { vendorKey: CODEX_VENDOR_SEED.key, ...CODEX_IMG2_MODEL_SEED, modes: ["text_to_image", "image_edit"] },
  { vendorKey: JIMENG_WEB_VENDOR_SEED.key, ...JIMENG_WEB_IMAGE_MODEL_SEED, modes: ["text_to_image", "image_edit"] },
  { vendorKey: JIMENG_WEB_VENDOR_SEED.key, ...JIMENG_WEB_SEEDANCE_MODEL_SEED, modes: ["text_to_video", "image_to_video"] },
  { vendorKey: PAVO_WEB_VENDOR_SEED.key, ...PAVO_WEB_AGNES_FLASH_MODEL_SEED, modes: ["text_to_video", "image_to_video"] },
];
const unpublished = { published: false, publishedModes: [] };

describe.each(entries)("native publication: $vendorKey/$modelKey", (entry) => {
  const row = { vendorKey: entry.vendorKey, modelKey: entry.modelKey, kind: entry.kind, enabled: true };

  it("publishes only the shipped native task modes without HTTP mappings", () => {
    expect(derivePublishedExecution(row)).toEqual({ published: true, publishedModes: entry.modes });
  });

  it("does not publish disabled models", () => {
    expect(derivePublishedExecution({ ...row, enabled: false })).toEqual(unpublished);
  });

  it("does not promote sibling, candidate, prefixed or unrelated vendor identities", () => {
    for (const vendorKey of ["relay", `${entry.vendorKey}--second`, `${entry.vendorKey}--candidate-1234567890abcdef`, `custom-${entry.vendorKey}`]) {
      expect(derivePublishedExecution({ ...row, vendorKey, meta: { nativeExecution: true, builtinVendorKey: entry.vendorKey } })).toEqual(unpublished);
    }
  });

  it("does not publish arbitrary models or wrong kinds under the native vendor", () => {
    expect(derivePublishedExecution({ ...row, modelKey: `${entry.modelKey}-unshipped` })).toEqual(unpublished);
    expect(derivePublishedExecution({ ...row, kind: entry.kind === "image" ? "video" : "image" })).toEqual(unpublished);
    expect(derivePublishedExecution({ ...row, vendorKey: "relay", meta: { archetypeId: entry.modelKey } })).toEqual(unpublished);
  });

  it("keeps an active certified revision authoritative over native capability", () => {
    const taskKind = entry.modes[1];
    expect(derivePublishedExecution({ ...row, meta: { adapter: {
      activeRevision: "certified", modes: [
        { taskKind, state: "verified" },
        { taskKind: entry.modes[0], state: "failed" },
      ],
    } } })).toEqual({ published: true, publishedModes: [taskKind] });
    expect(derivePublishedExecution({ ...row, meta: { adapter: { activeRevision: "certified", modes: [] } } })).toEqual(unpublished);
    expect(derivePublishedExecution({ ...row, meta: { adapter: { activeRevision: "certified" } } })).toEqual(unpublished);
  });

  it("preserves the upstream non-destructive failed-self-check policy", () => {
    expect(derivePublishedExecution({ ...row, meta: { adapter: { state: "failed", modes: [] } } }))
      .toEqual({ published: true, publishedModes: entry.modes });
  });

  it("keeps publication masks authoritative and never manufactures unsupported modes", () => {
    expect(derivePublishedExecution({ ...row, meta: { adapter: { publicationModes: [entry.modes[1]] } } }))
      .toEqual({ published: true, publishedModes: [entry.modes[1]] });
    for (const publicationModes of [[], null, "all", ["chat", "transcribe"]]) {
      expect(derivePublishedExecution({ ...row, meta: { adapter: { publicationModes } } })).toEqual(unpublished);
    }
  });

  it("does not bypass missing vendors, disabled connections or credential health", () => {
    const credentialStatus = vi.fn(() => "ok" as const);
    expect(deriveModelAvailability({ model: row, vendor: null, credentialStatus }))
      .toEqual({ usable: false, reason: "vendor_missing" });
    expect(deriveModelAvailability({ model: row, vendor: { enabled: false, authType: "none" }, credentialStatus }))
      .toEqual({ usable: false, reason: "vendor_disabled" });
    for (const [status, reason] of [
      ["missing", "credential_missing"], ["locked", "credential_locked"], ["needs_resave", "credential_needs_resave"],
    ] as const) {
      expect(deriveModelAvailability({ model: row, vendor: { enabled: true, authType: "bearer" }, credentialStatus: () => status }))
        .toEqual({ usable: false, reason });
    }
    expect(deriveModelAvailability({ model: row, vendor: { enabled: true, authType: "none" }, credentialStatus }))
      .toEqual({ usable: true });
    expect(credentialStatus).not.toHaveBeenCalled();
  });
});

it("publishes actual builtin seed rows into the model listing without fake mappings", () => {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  const state = applyBuiltinSeeds(empty, "2026-10-20T00:00:00.000Z").state;
  const listing = deriveModelListing(state);
  for (const entry of entries) {
    const seeded = state.models.find((model) => model.vendorKey === entry.vendorKey && model.modelKey === entry.modelKey);
    expect(seeded).toBeDefined();
    expect(state.mappings.filter((mapping) => mapping.vendorKey === entry.vendorKey)).toEqual([]);
    expect(derivePublishedExecution(seeded)).toEqual({ published: true, publishedModes: entry.modes });
    expect(listing.find((model) => model.vendor === entry.vendorKey && model.modelKey === entry.modelKey)).toBeDefined();
  }
  expect(listing.find((model) => model.vendor === PAVO_WEB_VENDOR_SEED.key)?.references)
    .toMatchObject({ image: true, multiImage: true, audio: true, video: false });
});
