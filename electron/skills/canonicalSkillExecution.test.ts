import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, assert, describe, expect, it } from "vitest";
import { verbToTransportCall } from "../agentLane/laneVerbTransport";
import { createPiGenerationTransportAdapter } from "../capabilityCore/generationTransportAdapters";
import { createGenerationPlanningHandler } from "../capabilityCore/mcpGenerationTools";
import { createModuleRegistry } from "../capabilityCore/moduleRegistry";
import type { ProjectLeaseV2 } from "../capabilityCore/projectLease";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import { createProductionRunService } from "../productionRun/productionRunService";
import { createProductionGenerationOperationStore } from "../productionRun/productionGenerationOperationStore";
import { VERB_DECLARATIONS } from "../shared/agentCapabilities/verbDeclarations";
import { parseSkillFrontmatter } from "./skillFrontmatter";
import { readSkillManifest } from "./skillManifestSchema";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const binding = { projectId: "skill-project", immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1 };
// This fixture starts after the Host's lease verification; no provider or GUI is substituted as evidence.
const lease = { ...binding, scopeSet: ["generation:create", "generation:plan", "generation:read"] } as ProjectLeaseV2;
const source = "asset-source";
const contentHash = "a".repeat(64);
const fixtureModel = "fixture-image-video";
const fixtureProvider = "fixture-provider";
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot", version: "1.0.0",
  inputKinds: ["text", "image"], outputKinds: ["image", "video"],
  modes: ["text-to-image", "image-to-image", "image-to-video"],
  parameterSchema: {}, assetInputSchema: { references: { kind: "image", max: 4 } },
  providers: [{ providerId: fixtureProvider, models: [{
    modelId: fixtureModel, modes: ["text-to-image", "image-to-image", "image-to-video"], parameterSchema: {},
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
  }] }],
}]);
const cases = [
  { directory: "creative-multiview", count: 9, kind: "image_edit", prompt: "Same product, same geometry, camera azimuth" },
  { directory: "creative-mood-identity", count: 25, kind: "image_edit", prompt: "Same identity, energy and affinity coordinate" },
  { directory: "creative-portrait-realism", count: 1, kind: "image_edit", prompt: "Preserve identity; repair skin texture and lighting" },
  { directory: "creative-style-resource", count: 1, kind: "image_edit", prompt: "Preserve geometry and identity; apply the confirmed palette" },
  { directory: "creative-panorama", count: 1, kind: "text_to_image", prompt: "Equirectangular panorama, four continuous quadrants" },
  { directory: "creative-video-look-effect", count: 1, kind: "image_to_video", prompt: "Preserve the source frame; mist develops along the cup" },
] as const;

describe("custom Skills through the canonical generation owner", () => {
  it.each(cases)("$directory persists its supported workflow, references and output count", async ({ directory, count, kind, prompt }) => {
    const markdown = fs.readFileSync(path.resolve("skills", directory, "SKILL.md"), "utf8");
    const { manifest, error } = readSkillManifest(parseSkillFrontmatter(markdown));
    expect(error).toBeUndefined();
    expect(manifest?.tools).toEqual(expect.arrayContaining(["draft_shots", "generate", "check_job", "list_models"]));
    expect(markdown).toContain("`draft_shots`");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-skill-canonical-"));
    roots.push(root);
    const repository = createProductionRunRepository({ projectDirResolver: () => root });
    const service = createProductionRunService({ repository, projectRootResolver: () => root });
    const operations = createProductionGenerationOperationStore(service);
    const planning = createGenerationPlanningHandler({
      registry, operations,
      defaultModelForTaskKind: (taskKind) => ({
        moduleId: "generation.single-shot", providerId: fixtureProvider, modelId: fixtureModel,
        mode: taskKind === "image_edit" ? "image-to-image" : taskKind === "image_to_video" ? "image-to-video" : "text-to-image",
      }),
      resolveAssetReferenceIdentity: (projectId, id) => projectId === binding.projectId && id === source ? { contentHash, version: 1 } : undefined,
    });
    const adapter = createPiGenerationTransportAdapter(binding, { planning, leaseFor: () => lease });
    const shots = Array.from({ length: count }, (_, index) => ({
      title: `Variant ${index + 1}`, prompt: `${prompt} ${index}`, taskKind: kind,
      ...(kind !== "text_to_image" ? { references: [source] } : {}),
    }));
    const args = VERB_DECLARATIONS.find(verb => verb.name === "draft_shots")!.schema.parse({ shots });
    const translated = verbToTransportCall({ toolName: "draft_shots", toolCallId: "skill-draft", args });
    expect(translated?.lane).toBe("generation");
    const outcome = await adapter.tryExecute(translated!.call, new AbortController().signal);
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: true });
    const runs = await repository.list(binding.projectId);
    expect(runs).toHaveLength(1);
    // Reopen the repository: assertions read the durable owner, not a mocked tool return.
    const persisted = createProductionRunRepository({ projectDirResolver: () => root }).read(binding.projectId, runs[0]!.runId);
    assert(persisted, "Expected the canonical draft to persist in its project repository");
    expect(persisted.generationPlan?.state).toBe("draft");
    expect(persisted.generationPlan?.shots).toHaveLength(count);
    expect(persisted.jobs).toHaveLength(0);
    for (const shot of persisted.generationPlan!.shots!) {
      expect(shot.candidate.modelId).toBe(fixtureModel);
      expect(shot.candidate.prompt).toContain(prompt);
      expect(shot.candidate.references).toEqual(kind === "text_to_image" ? [] : [expect.objectContaining({ assetId: source, contentHash, version: 1 })]);
    }
    if (kind !== "text_to_image") {
      const invalid = verbToTransportCall({ toolName: "draft_shots", toolCallId: "missing-source", args: {
        shots: [{ ...shots[0], references: ["asset-outside-project"] }],
      } });
      expect(await adapter.tryExecute(invalid!.call, new AbortController().signal))
        .toMatchObject({ ok: false, code: "generation_input_invalid" });
      expect(await repository.list(binding.projectId)).toHaveLength(1);
    }
    const presented = verbToTransportCall({ toolName: "generate", toolCallId: "skill-present", args: { operationId: runs[0]!.runId } });
    const presentation = await adapter.tryExecute(presented!.call, new AbortController().signal);
    expect(presentation, JSON.stringify(presentation)).toMatchObject({ ok: true });
    expect(JSON.stringify(presentation)).toContain("await_user");
    const presentedRun = repository.read(binding.projectId, runs[0]!.runId);
    assert(presentedRun, "Expected presentation to preserve the persisted draft");
    expect(presentedRun.jobs).toHaveLength(0);
    adapter.dispose();
  });
});
