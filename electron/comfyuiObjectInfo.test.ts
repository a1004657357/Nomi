import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetComfyObjectInfoCacheForTest,
  fetchComfyuiCheckpoints,
  fetchComfyuiObjectInfoIndex,
  parseObjectInfoIndex,
} from "./comfyuiObjectInfo";

const FULL = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [["a.safetensors", "b.safetensors"]] } }, output: ["MODEL", "CLIP", "VAE"] },
  KSampler: {
    input: {
      required: {
        seed: ["INT", { default: 0 }], // 非枚举 spec：类型名字符串 → 不进 enums
        sampler_name: [["euler", "ddim"]],
      },
      optional: { extra: [["x"]] }, // optional 组同样收
    },
  },
  WeirdNode: { input: { required: { mixed: [[1, "a"]] } } }, // 非纯字符串数组 → 跳过
  Broken: "not-a-record", // 异形 → class 记录但无枚举
};

describe("parseObjectInfoIndex（纯解析，全防御）", () => {
  it("收 class 集合 + combo 枚举（required/optional 都收；类型名/混杂数组不收）", () => {
    const index = parseObjectInfoIndex(FULL);
    expect(index.classNames.has("CheckpointLoaderSimple")).toBe(true);
    expect(index.classNames.has("KSampler")).toBe(true);
    expect(index.classNames.has("Broken")).toBe(false); // 值不是对象 → 不算已装类
    expect(index.enumsByClass.get("CheckpointLoaderSimple")?.get("ckpt_name")).toEqual(["a.safetensors", "b.safetensors"]);
    expect(index.enumsByClass.get("KSampler")?.get("sampler_name")).toEqual(["euler", "ddim"]);
    expect(index.enumsByClass.get("KSampler")?.get("seed")).toBeUndefined();
    expect(index.enumsByClass.get("KSampler")?.get("extra")).toEqual(["x"]);
    expect(index.enumsByClass.get("WeirdNode")).toBeUndefined();
  });

  it("非对象输入 → 空索引（不抛）", () => {
    expect(parseObjectInfoIndex(null).classNames.size).toBe(0);
    expect(parseObjectInfoIndex("junk").classNames.size).toBe(0);
  });
});

describe("fetch 层（stub 全局 fetch）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetComfyObjectInfoCacheForTest();
  });

  it("fetchComfyuiCheckpoints：/object_info/CheckpointLoaderSimple → 文件名列表", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ CheckpointLoaderSimple: FULL.CheckpointLoaderSimple }))));
    expect(await fetchComfyuiCheckpoints("http://127.0.0.1:8188")).toEqual(["a.safetensors", "b.safetensors"]);
  });

  it("连不上 → null（调用方按「不可核对」处理，不误报全缺）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await fetchComfyuiCheckpoints("http://127.0.0.1:8188")).toBeNull();
    expect(await fetchComfyuiObjectInfoIndex("http://127.0.0.1:8188")).toBeNull();
  });

  it("响应形状不认识（空对象）→ null，不当成「没装任何节点」", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    expect(await fetchComfyuiObjectInfoIndex("http://127.0.0.1:8188")).toBeNull();
  });

  it("60s 缓存：同 URL 第二次不再发请求", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(FULL)));
    vi.stubGlobal("fetch", fetchMock);
    await fetchComfyuiObjectInfoIndex("http://127.0.0.1:8188");
    await fetchComfyuiObjectInfoIndex("http://127.0.0.1:8188");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
