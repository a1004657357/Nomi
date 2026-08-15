import path from "node:path";
import type { ToolSet } from "ai";
import { orderPlaybookStages } from "../skills/playbookOrchestrator";
import { findSkillRecord, type SkillRecord } from "../skills/skillStore";

export type AgentSkillMode = "agent" | "auto" | "chat" | "refine" | string;

export type AgentPlaybookStage = {
  skillKey: string;
  stageId: string;
  goal: string;
  index: number;
  total: number;
  pause: boolean;
  nextStageId: string | null;
};

export type AgentSkillExecution = {
  systemPrompt: string;
  /** null keeps the legacy tool group; [] intentionally exposes no tools. */
  allowedTools: string[] | null;
  playbook: AgentPlaybookStage | null;
};

export type ResolveAgentSkillExecutionInput = {
  skillKey: string;
  skillName: string;
  stageId?: string;
  mode?: AgentSkillMode;
};

function modeTools(mode: AgentSkillMode | undefined, allowed: string[] | null): string[] | null {
  if (mode === "chat") return [];
  if (mode === "refine") {
    return (allowed ?? ["set_node_prompt"]).filter((name) => name === "set_node_prompt");
  }
  return allowed;
}

function missingSkillPrompt(input: ResolveAgentSkillExecutionInput): string {
  return [
    "Nomi 桌面 Agent skill 提示：",
    `请求的 skill 未在本地 skills 目录找到：${input.skillKey || input.skillName}`,
    "继续按用户请求和当前上下文完成任务；不要声称已经加载不存在的 skill。",
  ].join("\n");
}

function skillPrompt(input: ResolveAgentSkillExecutionInput, skill: SkillRecord, playbook: AgentPlaybookStage | null): string {
  const stageBlock = playbook
    ? [
        "",
        "当前 Playbook 阶段（后端硬约束）：",
        `stage: ${playbook.index + 1}/${playbook.total} · ${playbook.stageId}`,
        `goal: ${playbook.goal}`,
        `allowedTools: ${skill.manifest?.stages?.[playbook.index]?.tools.join(", ") || "none"}`,
        playbook.pause
          ? "完成当前阶段后必须停止，等待用户确认；不得自行进入下一阶段。"
          : "完成当前阶段后停止并报告结果；后续阶段由运行器继续调度。",
      ]
    : [];
  return [
    "Nomi 桌面 Agent 已加载本地 skill。以下内容是本次回复必须参考的领域方法论和输出约束。",
    "注意：本桌面运行时只把 skill 作为本地知识注入；skill 中提到的外部 CLI、HTTP 或文件工具不会自动执行，除非当前对话/界面明确提供了对应能力。",
    `skillKey: ${input.skillKey || skill.name}`,
    `skillName: ${input.skillName || skill.name}`,
    `skillFile: ${path.relative(process.cwd(), skill.filePath)}`,
    ...stageBlock,
    "",
    skill.body,
  ].join("\n");
}

export function resolveAgentSkillExecution(
  input: ResolveAgentSkillExecutionInput,
  records: SkillRecord[],
): AgentSkillExecution {
  if (!input.skillKey && !input.skillName) {
    return { systemPrompt: "", allowedTools: modeTools(input.mode, null), playbook: null };
  }
  const skill = findSkillRecord(input.skillKey, input.skillName, records);
  if (!skill) {
    return { systemPrompt: missingSkillPrompt(input), allowedTools: modeTools(input.mode, null), playbook: null };
  }

  let allowedTools = skill.manifest ? [...skill.manifest.tools] : null;
  let playbook: AgentPlaybookStage | null = null;
  if (skill.manifest?.stages?.length) {
    const stages = orderPlaybookStages(skill.manifest.stages);
    const stageIndex = input.stageId
      ? stages.findIndex((stage) => stage.id === input.stageId)
      : 0;
    if (stageIndex < 0) {
      throw new Error(`Skill「${skill.name}」没有声明 Playbook 阶段「${input.stageId}」`);
    }
    const stage = stages[stageIndex];
    allowedTools = [...stage.tools];
    playbook = {
      skillKey: skill.name,
      stageId: stage.id,
      goal: stage.goal,
      index: stageIndex,
      total: stages.length,
      pause: stage.pause !== false,
      nextStageId: stages[stageIndex + 1]?.id ?? null,
    };
  }

  return {
    systemPrompt: skillPrompt(input, skill, playbook),
    allowedTools: modeTools(input.mode, allowedTools),
    playbook,
  };
}

export function filterAgentTools<TTools extends ToolSet>(
  tools: TTools,
  allowedTools: readonly string[] | null,
): Partial<TTools> {
  if (allowedTools === null) return tools;
  const allowed = new Set(allowedTools);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => allowed.has(name))) as Partial<TTools>;
}
