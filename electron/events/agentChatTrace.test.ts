import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
}));

import { beginTurnTrace, traceChatEvent, traceGateDenied, traceToolDecision } from "./agentChatTrace";
import { createProjectAgentContextBinding } from "../shared/contracts/projectAgentContextBinding";
import {
  readEvents,
  resetEventLogStateForTests,
  setEventLogProjectDirResolverForTests,
  setEventLogSecretsProvider,
} from "./eventLogRepository";

let tmpRoot = "";
const SESSION = "sess-1";
// 用 Host 真实格式：线程身份由不可变项目 UUID 派生（`projectAgentContextBinding`）。
// 曾用可解析的 `nomi:workbench:p1` 掩盖了 trace 全丢的回归；projectId 现在直接从 binding 读。
const history = {
  kind: 'persistent',
  binding: createProjectAgentContextBinding(
    { projectId: 'p1', immutableProjectUuid: '4d80f2e0-4a45-4a8f-8fe1-78ac659177c8', projectGeneration: 3 },
    'explicit-thread',
  ),
};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-trace-"));
  setEventLogProjectDirResolverForTests((projectId) => path.join(tmpRoot, projectId));
  setEventLogSecretsProvider(() => []);
  fs.mkdirSync(path.join(tmpRoot, "p1"), { recursive: true });
});

afterEach(() => {
  resetEventLogStateForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("agentChatTrace — S6-0 对账的米", () => {
  it("approved 携 effectiveArgs/overridesDelta,causeId 回指 proposed", () => {
    beginTurnTrace(SESSION, { history, skillKey: "canvas", prompt: "拆镜头" });
    traceChatEvent(SESSION, {
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "set_node_prompt",
      args: { nodeId: "n1", prompt: "AI 原始提议" },
    });
    traceToolDecision(SESSION, "tc-1", {
      ok: true,
      effectiveArgs: { nodeId: "n1", prompt: "用户改后的提示词" },
      overridesDelta: { prompt: "用户改后的提示词" },
      proposalId: "prop_abc123",
    });

    const events = readEvents("p1");
    const proposed = events.find((e) => e.type === "agent.tool.proposed");
    const approved = events.find((e) => e.type === "agent.proposal.approved");
    expect(proposed).toBeTruthy();
    expect(approved).toBeTruthy();
    // 因果链:approved 回指 proposed 事件 id。
    expect(approved!.causeId).toBe(proposed!.id);
    // 对账的米:合并后全量快照落盘。
    expect(approved!.payload.effectiveArgs).toEqual({ nodeId: "n1", prompt: "用户改后的提示词" });
    // 偏好增量:只记用户实际改动的字段。
    expect(approved!.payload.overridesDelta).toEqual({ prompt: "用户改后的提示词" });
    // S6-2:proposalId/txnId 落事件级字段(与画布事件/txn.committed 同键 join)。
    expect(approved!.proposalId).toBe("prop_abc123");
    expect(approved!.txnId).toBe("txn_prop_abc123");
  });

  it("无 override 时不写空 overridesDelta(空对象不进日志)", () => {
    beginTurnTrace(SESSION, { history, skillKey: "canvas", prompt: "建节点" });
    traceChatEvent(SESSION, { type: "tool-call", toolCallId: "tc-2", toolName: "create_canvas_nodes", args: { nodes: [] } });
    traceToolDecision(SESSION, "tc-2", { ok: true, effectiveArgs: { nodes: [] } });

    const approved = readEvents("p1").find((e) => e.type === "agent.proposal.approved");
    expect(approved!.payload.effectiveArgs).toEqual({ nodes: [] });
    expect("overridesDelta" in approved!.payload).toBe(false);
  });

  it("rejected 只记 message,不混入对账字段", () => {
    beginTurnTrace(SESSION, { history, skillKey: "canvas", prompt: "删节点" });
    traceChatEvent(SESSION, { type: "tool-call", toolCallId: "tc-3", toolName: "delete_canvas_nodes", args: { nodeIds: ["n9"] } });
    traceToolDecision(SESSION, "tc-3", { ok: false, message: "用户拒绝" });

    const rejected = readEvents("p1").find((e) => e.type === "agent.proposal.rejected");
    expect(rejected!.payload.message).toBe("用户拒绝");
    expect("effectiveArgs" in rejected!.payload).toBe(false);
  });

  it("S6-1 gate.denied:reason 人话落盘,causeId 回指 proposed(intent 可反走还原)", () => {
    beginTurnTrace(SESSION, { history, skillKey: "canvas", prompt: "动作" });
    traceChatEvent(SESSION, { type: "tool-call", toolCallId: "tc-4", toolName: "rm_rf", args: {} });
    traceGateDenied(SESSION, "tc-4", "不支持的操作「rm_rf」");

    const events = readEvents("p1");
    const proposed = events.find((e) => e.type === "agent.tool.proposed");
    const denied = events.find((e) => e.type === "agent.gate.denied");
    expect(denied!.source).toBe("system");
    expect(denied!.payload.reason).toBe("不支持的操作「rm_rf」");
    expect(denied!.causeId).toBe(proposed!.id);
    // gate.denied 不是 proposal.rejected(两类语义分开)。
    expect(events.some((e) => e.type === "agent.proposal.rejected")).toBe(false);
  });

  it("records harness configuration, per-step progress and the final step count", () => {
    beginTurnTrace(SESSION, { history, skillKey: "brand.promo", playbookStageId: "build", prompt: "继续" });
    traceChatEvent(SESSION, {
      type: "harness-config",
      vendorKey: "ark-plan",
      modelKey: "doubao-seed-code",
      skillKey: "brand.promo",
      allowedTools: ["create_canvas_nodes"],
      playbook: { stageId: "build", index: 1, total: 4 },
    });
    traceChatEvent(SESSION, { type: "step-finish", finishReason: "tool-calls" });
    traceChatEvent(SESSION, { type: "step-finish", finishReason: "stop" });
    traceChatEvent(SESSION, { type: "result", result: { text: "done", finishReason: "stop" } });

    const events = readEvents("p1");
    expect(events.find((event) => event.type === "agent.turn.configured")?.payload).toMatchObject({
      vendorKey: "ark-plan",
      modelKey: "doubao-seed-code",
      allowedTools: ["create_canvas_nodes"],
      playbook: { stageId: "build" },
    });
    expect(events.filter((event) => event.type === "agent.step.finished").map((event) => event.payload.stepIndex)).toEqual([1, 2]);
    expect(events.find((event) => event.type === "agent.turn.finished")?.payload.stepCount).toBe(2);
  });

  it("reads the real renderer skill shape from chatContext", () => {
    beginTurnTrace(SESSION, {
      history,
      chatContext: { skill: { key: "brand.promo", name: "品牌宣传片" } },
      playbookStageId: "storyboard",
      displayPrompt: "做宣传片",
    });

    expect(readEvents("p1").find((event) => event.type === "agent.turn.started")?.payload).toMatchObject({
      skillKey: "brand.promo",
      playbookStageId: "storyboard",
    });
  });

  it.each(['finished', 'cancelled', 'error'])('records the actual %s status and explicit thread identity', (status) => {
    beginTurnTrace(SESSION, { history, prompt: 'go' });
    traceChatEvent(SESSION, { type: 'result', result: { status, text: 'actual', usage: { totalTokens: 9 } } });
    traceChatEvent(SESSION, { type: 'done', reason: status });
    const events = readEvents('p1');
    expect(events.find((event) => event.type === 'agent.turn.started')?.payload).toMatchObject({ threadId: 'explicit-thread' });
    expect(events.find((event) => event.type === 'agent.turn.finished')?.payload).toMatchObject({ status, usage: { totalTokens: 9 } });
  });
});
