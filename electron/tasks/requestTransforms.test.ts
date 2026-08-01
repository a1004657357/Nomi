import { describe, expect, it } from "vitest";
import { applyRequestTransform, registerRequestTransform } from "./requestTransforms";

describe("requestTransforms 注册表", () => {
  it("未声明 / 未注册 → 原样返回（对现有 vendor 零影响）", async () => {
    const body = { a: 1 };
    expect(await applyRequestTransform(undefined, body, { baseUrl: "" })).toBe(body);
    expect(await applyRequestTransform("nope-not-registered", body, { baseUrl: "" })).toBe(body);
  });

  it("已注册 → 变换执行，拿到 baseUrl 上下文；支持 async", async () => {
    registerRequestTransform("test-echo", async (body, { baseUrl }) => ({ body, baseUrl }));
    expect(await applyRequestTransform("test-echo", { x: 1 }, { baseUrl: "http://h" })).toEqual({ body: { x: 1 }, baseUrl: "http://h" });
  });

  it("变换抛错要冒泡（fail fast 给人话，与 responseTransforms 吞错的契约刻意相反）", async () => {
    registerRequestTransform("test-throw", () => {
      throw new Error("确定性人话错误");
    });
    await expect(applyRequestTransform("test-throw", {}, { baseUrl: "" })).rejects.toThrow("确定性人话错误");
  });
});
