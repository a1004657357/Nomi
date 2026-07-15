import { describe, expect, it } from "vitest";
import type { CoreMessage } from "ai";
import { capAgentHistory, compactOldToolPayloads } from "./agentChatHarness";

const LONG = "清晨的京都小巷,石板路狭长延伸,两侧木质町屋,". repeat(10);

function toolTurn(idx: number): CoreMessage[] {
  return [
    { role: "user", content: `请求 ${idx}` },
    {
      role: "assistant",
      content: [
        { type: "text", text: `计划 ${idx}` },
        { type: "tool-call", toolCallId: `tc-${idx}`, toolName: "create_canvas_nodes", args: { nodes: [{ clientId: "c1", prompt: LONG }] } },
      ],
    } as CoreMessage,
    {
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: `tc-${idx}`, toolName: "create_canvas_nodes", result: { ok: true, detail: LONG } },
      ],
    } as CoreMessage,
  ];
}

describe("compactOldToolPayloads — T3 旧轮工具载荷压缩", () => {
  it("尾部 8 条原样保留,更早的 tool args/result 长字符串截 120", () => {
    const messages = [...toolTurn(1), ...toolTurn(2), ...toolTurn(3), ...toolTurn(4)]; // 12 条
    const out = compactOldToolPayloads(messages);
    expect(out).toHaveLength(12);
    // 旧轮(前 4 条)被压缩
    const oldAssistant = out[1] as { content: { type: string; args?: { nodes: { prompt: string }[] } }[] };
    const oldPrompt = oldAssistant.content[1].args!.nodes[0].prompt;
    expect(oldPrompt.length).toBeLessThan(130);
    expect(oldPrompt).toContain("[截断]");
    // 尾部 8 条(最近轮)原文不动
    const lastAssistant = out[10] as { content: { type: string; args?: { nodes: { prompt: string }[] } }[] };
    expect(lastAssistant.content[1].args!.nodes[0].prompt).toBe(LONG);
    // 结构保留:配对 id/类型不变
    expect((oldAssistant.content[1] as { toolCallId?: string }).toolCallId).toBe("tc-1");
  });

  it("≤8 条不动;纯文本消息不动", () => {
    const short = toolTurn(1);
    expect(compactOldToolPayloads(short)).toBe(short);
    const out = compactOldToolPayloads([...toolTurn(1), ...toolTurn(2), ...toolTurn(3), ...toolTurn(4)]);
    expect(out[0]).toEqual({ role: "user", content: "请求 1" });
  });

  it("capAgentHistory 内联压缩后仍守 token 预算与孤儿 tool 头清理", () => {
    const messages: CoreMessage[] = [];
    for (let i = 0; i < 12; i += 1) messages.push(...toolTurn(i));
    const out = capAgentHistory(messages);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out[0].role).not.toBe("tool");
    expect(out[0].role).toBe("user");
    expect(String(out[0].content)).toContain("此前对话摘要");
    expect(String(out[0].content)).toContain("工具调用 create_canvas_nodes");
  });

  it("capAgentHistory 超过消息数时用摘要保留被裁旧轮", () => {
    const messages: CoreMessage[] = Array.from({ length: 36 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: index % 2 === 0 ? `第 ${index} 轮用户要求：保留咖啡广告主线` : `第 ${index} 轮助手回应：已拆镜头`,
    }));
    const out = capAgentHistory(messages);
    expect(out).toHaveLength(30);
    expect(out[0]).toMatchObject({ role: "user" });
    expect(String(out[0].content)).toContain("此前对话摘要");
    expect(String(out[0].content)).toContain("咖啡广告主线");
  });
});
