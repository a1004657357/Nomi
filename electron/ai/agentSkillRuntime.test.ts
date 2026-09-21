import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { SkillRecord } from "../skills/skillStore";
import {
  filterAgentTools,
  resolveAgentSkillExecution,
} from "./agentSkillRuntime";

function record(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    name: "brand.promo",
    description: "Brand promo stage fixture",
    directoryName: "brand-promo",
    filePath: "/tmp/brand-promo/SKILL.md",
    body: "# Brand promo\nFollow the current stage.",
    origin: "builtin",
    manifest: {
      name: "brand.promo",
      version: "1.0.0",
      description: "promo",
      tools: ["read_canvas_state", "create_canvas_nodes", "run_generation_batch"],
      requiredProviders: ["text", "image", "video"],
      permissions: ["create"],
      stages: [
        {
          id: "plan",
          goal: "plan the storyboard",
          tools: ["read_canvas_state"],
          pause: true,
        },
        {
          id: "build",
          goal: "build canvas nodes",
          tools: ["create_canvas_nodes"],
          dependsOn: ["plan"],
          pause: true,
        },
      ],
    },
    ...overrides,
  };
}

describe("agent skill runtime", () => {
  it("hard-filters tools to the requested playbook stage", () => {
    const execution = resolveAgentSkillExecution(
      { skillKey: "brand.promo", skillName: "品牌宣传片", stageId: "build", mode: "agent" },
      [record()],
    );
    const tools = filterAgentTools(
      {
        read_canvas_state: { parameters: z.object({}) },
        create_canvas_nodes: { parameters: z.object({}) },
        run_generation_batch: { parameters: z.object({}) },
      },
      execution.allowedTools,
    );

    expect(Object.keys(tools)).toEqual(["create_canvas_nodes"]);
    expect(execution.playbook).toMatchObject({ stageId: "build", index: 1, total: 2, pause: true });
    expect(execution.systemPrompt).toContain("build canvas nodes");
  });

  it("uses the manifest whitelist for a single-stage skill", () => {
    const skill = record({ manifest: { ...record().manifest!, stages: undefined } });
    const execution = resolveAgentSkillExecution(
      { skillKey: skill.name, skillName: skill.name, mode: "agent" },
      [skill],
    );

    expect(execution.allowedTools).toEqual([
      "read_canvas_state",
      "create_canvas_nodes",
      "run_generation_batch",
    ]);
  });

  it("enforces chat and refine modes after the skill whitelist", () => {
    const records = [record({ manifest: { ...record().manifest!, stages: undefined } })];
    const chat = resolveAgentSkillExecution(
      { skillKey: "brand.promo", skillName: "品牌宣传片", mode: "chat" },
      records,
    );
    const refine = resolveAgentSkillExecution(
      { skillKey: "brand.promo", skillName: "品牌宣传片", mode: "refine" },
      records,
    );

    expect(chat.allowedTools).toEqual([]);
    expect(refine.allowedTools).toEqual([]);
  });

  it("rejects a stage id that is not declared by the selected playbook", () => {
    expect(() => resolveAgentSkillExecution(
      { skillKey: "brand.promo", skillName: "品牌宣传片", stageId: "ghost", mode: "agent" },
      [record()],
    )).toThrow(/ghost/);
  });

  it("keeps legacy markdown-only skills compatible with the tool group", () => {
    const legacy = record({ name: "legacy", manifest: null });
    const execution = resolveAgentSkillExecution(
      { skillKey: "legacy", skillName: "legacy", mode: "agent" },
      [legacy],
    );

    expect(execution.allowedTools).toBeNull();
    expect(execution.systemPrompt).toContain("Follow the current stage");
  });
});
