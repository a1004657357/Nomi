import { describe, expect, it } from "vitest";
import { MockLanguageModelV1 } from "ai/test";
import type { CoreMessage } from "ai";
import { runAgentLoop } from "./agentLoop";

const makeModel = () =>
  new MockLanguageModelV1({
    doGenerate: async () => ({
      finishReason: "stop" as const,
      usage: { promptTokens: 1, completionTokens: 1 },
      text: "ok",
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  });

const userMessage = (content: string): CoreMessage[] => [{ role: "user", content }];

describe("runAgentLoop", () => {
  it("oneshot 模式跑通并回传文本", async () => {
    const result = await runAgentLoop(
      { model: makeModel(), messages: userMessage("hi"), tools: {} },
      {},
      { mode: "oneshot" },
    );
    expect(result.text).toBe("ok");
  });

  it("可重入:并发两次,各自 stepIndex 从 1 计数互不污染(S0 不变量①)", async () => {
    const seenA: number[] = [];
    const seenB: number[] = [];
    await Promise.all([
      runAgentLoop(
        { model: makeModel(), messages: userMessage("a"), tools: {} },
        { onStepFinish: ({ stepIndex }) => seenA.push(stepIndex) },
        { mode: "oneshot" },
      ),
      runAgentLoop(
        { model: makeModel(), messages: userMessage("b"), tools: {} },
        { onStepFinish: ({ stepIndex }) => seenB.push(stepIndex) },
        { mode: "oneshot" },
      ),
    ]);
    expect(seenA).toEqual([1]);
    expect(seenB).toEqual([1]);
  });

  it("兼容协议返回 Blender 计划文本，并让 SDK 的 JSON schema 与该计划一致", async () => {
    const model = new MockLanguageModelV1({
      doGenerate: async () => ({
          finishReason: "stop" as const,
          usage: { promptTokens: 1, completionTokens: 1 },
          text: '{"directorNodeId":"director-1","summary":"创建 Blender 场景","plan":{"mode":"replace","actions":[{"op":"set_stage","preset":"coffee_shop"}]}}',
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
    });

    const result = await runAgentLoop(
      { model, messages: userMessage("搭一个咖啡店"), tools: {}, structuredJson: true },
      {},
      { mode: "oneshot" },
    );

    expect(result.text).toContain('"directorNodeId"');
    expect(result.experimental_output).toMatchObject({
      directorNodeId: 'director-1',
      plan: { mode: 'replace' },
    });
  });

  it("兼容协议保留非旧 schema 的 JSON 文本，让调用方执行方言迁移", async () => {
    const model = new MockLanguageModelV1({
      doGenerate: async () => ({
        finishReason: "stop" as const,
        usage: { promptTokens: 1, completionTokens: 1 },
        text: '{"directorNodeId":"director-1","summary":"创建 Blender 场景","plan":{"mode":"replace","actions":[{"op":"set_stage","preset":"coffee_shop"}]}}',
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
    });

    const result = await runAgentLoop(
      { model, messages: userMessage("搭一个咖啡店"), tools: {}, structuredJson: true },
      {},
      { mode: "oneshot" },
    );

    expect(result.text).toContain('"plan"');
    expect(result.text).toContain('"set_stage"');
  });
});
