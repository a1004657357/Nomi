import { describe, expect, it } from "vitest";
import { buildVideoModelCandidates, videoArchetypeIdFromMeta } from "../shared/videoCapabilities";
import { modeSlotReach } from "./referenceReachability";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { selectTaskMapping, type CatalogState } from "./types";
import { JIMENG_WEB_SEEDANCE_MODEL_SEED, JIMENG_WEB_VENDOR_SEED } from "./jimengWeb";
import { buildJimengWebTaskPayload } from "../jimengWeb/seedanceBridge";
import { PAVO_WEB_AGNES_FLASH_MODEL_SEED, PAVO_WEB_VENDOR_SEED } from "./pavoWeb";
import { buildPavoWebTaskPayload } from "../pavoWeb/bridge";
import { buildArchetypeInputParams, referenceSlotStorage } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";

function seededState(): CatalogState {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  return applyBuiltinSeeds(empty, "2026-08-24T00:00:00.000Z").state;
}

describe("all curated video providers share their existing GUI capability contracts with planning", () => {
  it("backs every exposed mode with a real execution contract and reachable reference channels", async () => {
    const state = seededState();
    const models = state.models.filter((model) => model.kind === "video" && videoArchetypeIdFromMeta(model.meta));
    const candidates = buildVideoModelCandidates(models.map((model) => ({
      provider: model.vendorKey,
      modelKey: model.modelKey,
      label: model.labelZh,
      archetypeId: videoArchetypeIdFromMeta(model.meta),
    })));
    const violations: string[] = [];

    for (const [index, model] of models.entries()) {
      const candidate = candidates[index]!;
      for (const mode of candidate.archetype.modes) {
        const taskKind = mode.transportTaskKind ?? candidate.archetype.transportTaskKind;
        const mapping = selectTaskMapping(state.mappings, model.vendorKey, taskKind, model.modelKey);
        // runtime dispatches this local browser bridge before HTTP mappings; exercise its real payload builder.
        if (model.vendorKey === JIMENG_WEB_VENDOR_SEED.key && model.modelKey === JIMENG_WEB_SEEDANCE_MODEL_SEED.modelKey) {
          expect(mapping).toBeNull();
          if (taskKind !== "text_to_video" && taskKind !== "image_to_video") throw new Error(`Unsupported bridge task: ${taskKind}`);
          const meta: Record<string, unknown> = { archetype: { id: candidate.archetype.id, modeId: mode.id } };
          const expected: Array<{ base64: string; fileType: string }> = [];
          for (const [slotIndex, slot] of mode.slots.entries()) {
            const storage = referenceSlotStorage(slot);
            if (!storage) throw new Error(`Missing bridge reference storage: ${slot.kind}`);
            const fileType = slot.kind === "video_ref" ? "video/mp4" : slot.kind === "audio_ref" ? "audio/mpeg" : "image/png";
            const values = Array.from({ length: slot.max ?? Math.max(1, slot.min) }, (_, index) => {
              const base64 = `data:${fileType};base64,${Buffer.from(`${slotIndex}-${index}`).toString("base64")}`;
              expected.push({ base64, fileType });
              return base64;
            });
            meta[storage.metaKey] = storage.isArray ? values : values[0];
          }
          const payload = await buildJimengWebTaskPayload({
            kind: taskKind, prompt: "contract fixture", extras: {
              realSubmit: false, archetypeInput: buildArchetypeInputParams(meta, candidate.archetype),
            },
          });
          expect(payload).toMatchObject({ mediaType: "video", expectedResultCount: 1, realSubmit: false });
          expect(payload.referenceFiles.map(({ base64, fileType }) => ({ base64, fileType }))).toEqual(expected);
          expect(payload.modelConfig.referenceMode).toBe(mode.id === "firstlast" ? "首尾帧" : "全能参考");
          continue;
        }
        if (model.vendorKey === PAVO_WEB_VENDOR_SEED.key && model.modelKey === PAVO_WEB_AGNES_FLASH_MODEL_SEED.modelKey) {
          expect(mapping).toBeNull();
          if (taskKind !== "text_to_video" && taskKind !== "image_to_video") throw new Error(`Unsupported bridge task: ${taskKind}`);
          const meta: Record<string, unknown> = { archetype: { id: candidate.archetype.id, modeId: mode.id } };
          const expected: Array<{ base64: string; fileType: string }> = [];
          for (const [slotIndex, slot] of mode.slots.entries()) {
            const storage = referenceSlotStorage(slot);
            if (!storage) throw new Error(`Missing bridge reference storage: ${slot.kind}`);
            const fileType = slot.kind === "audio_ref" ? "audio/mpeg" : "image/png";
            const values = Array.from({ length: slot.max ?? Math.max(1, slot.min) }, (_, valueIndex) => {
              const base64 = `data:${fileType};base64,${Buffer.from(`${slotIndex}-${valueIndex}`).toString("base64")}`;
              expected.push({ base64, fileType });
              return base64;
            });
            meta[storage.metaKey] = storage.isArray ? values : values[0];
          }
          const payload = await buildPavoWebTaskPayload({
            kind: taskKind, prompt: "contract fixture", extras: {
              idempotencyKey: "contract-fixture", realSubmit: false,
              archetypeInput: buildArchetypeInputParams(meta, candidate.archetype),
            },
          });
          expect(payload).toMatchObject({ mediaType: "video", expectedResultCount: 1, realSubmit: false });
          expect(payload.referenceFiles.map(({ base64, fileType }) => ({ base64, fileType }))).toEqual(expected);
          expect(payload.modelConfig.referenceMode).toBe(mode.id === "keyframe" ? "首尾帧" : "全能模式");
          continue;
        }
        if (!mapping) {
          violations.push(`${model.vendorKey}/${model.modelKey}/${mode.id}: missing ${taskKind} mapping`);
          continue;
        }
        if (mode.slots.length === 0) continue;
        const reach = modeSlotReach(mode.slots, mapping.create.body, mode.combineSlotsInto?.key);
        if (reach.every((item) => item === "none")) {
          violations.push(`${model.vendorKey}/${model.modelKey}/${mode.id}: no reference slot reaches the selected mapping`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
