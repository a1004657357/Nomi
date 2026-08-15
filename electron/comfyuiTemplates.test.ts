import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetTemplateCacheForTest, fetchComfyuiTemplates, parseTemplateIndex } from "./comfyuiTemplates";

// 形状取自真 ComfyUI 0.29.0 的 /templates/index.json（实测截取）。
const REAL_INDEX = [
  {
    moduleName: "default",
    category: "GENERATION TYPE",
    title: "Video",
    type: "video",
    templates: [
      {
        name: "video_ltx2_i2v",
        title: "LTX-2.3: Image to Video",
        description: "Upload an image to generate a video",
        mediaType: "image",
        mediaSubtype: "webp",
        tags: ["Video", "LTX"],
        tutorialUrl: "https://docs.comfy.org/tutorials/video/ltx",
      },
      { name: "video_wan22_i2v", title: "WAN2.2 图生视频", description: "", mediaSubtype: "webp", tags: [] },
    ],
  },
  {
    moduleName: "default",
    title: "Image",
    type: "image",
    templates: [{ name: "image_z_turbo", title: "Z-Image-Turbo", description: "Fast t2i", mediaSubtype: "webp" }],
  },
];

describe("parseTemplateIndex（官方模板索引 → 扁平清单）", () => {
  it("展平分组、带上组名/组类型、拼出预览图绝对地址", () => {
    const list = parseTemplateIndex(REAL_INDEX, "http://127.0.0.1:8188/");
    expect(list).toHaveLength(3);
    const ltx = list[0];
    expect(ltx.name).toBe("video_ltx2_i2v");
    expect(ltx.title).toBe("LTX-2.3: Image to Video");
    expect(ltx.group).toBe("Video");
    expect(ltx.groupType).toBe("video");
    expect(ltx.tags).toEqual(["Video", "LTX"]);
    expect(ltx.thumbnailUrl).toBe("http://127.0.0.1:8188/templates/video_ltx2_i2v-1.webp");
    expect(ltx.tutorialUrl).toContain("docs.comfy.org");
  });

  it("缺 title 回落成 name；缺 tags/tutorialUrl 给空不炸", () => {
    const list = parseTemplateIndex([{ title: "G", type: "image", templates: [{ name: "bare" }] }], "http://h");
    expect(list[0]).toMatchObject({ name: "bare", title: "bare", tags: [], tutorialUrl: "", thumbnailUrl: "" });
  });

  it("异形输入一律跳过、不抛（非数组/组里没 templates/条目没 name）", () => {
    expect(parseTemplateIndex(null)).toEqual([]);
    expect(parseTemplateIndex({ nope: 1 })).toEqual([]);
    expect(parseTemplateIndex([{ title: "x" }, { title: "y", templates: [{ noName: 1 }, "junk"] }])).toEqual([]);
  });
});

describe("fetchComfyuiTemplates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetTemplateCacheForTest();
  });

  it("拉到就返回清单", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(REAL_INDEX))));
    const list = await fetchComfyuiTemplates("http://127.0.0.1:8188");
    expect(list).toHaveLength(3);
  });

  it("连不上 / 非 2xx / 空清单 → null（UI 整块不出现，不报错吓人）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await fetchComfyuiTemplates("http://127.0.0.1:8188")).toBeNull();
    _resetTemplateCacheForTest();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect(await fetchComfyuiTemplates("http://127.0.0.1:8188")).toBeNull();
    _resetTemplateCacheForTest();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]")));
    expect(await fetchComfyuiTemplates("http://127.0.0.1:8188")).toBeNull();
  });

  it("60s 缓存：同地址第二次不再发请求（几百条别反复拉）", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(REAL_INDEX)));
    vi.stubGlobal("fetch", fetchMock);
    await fetchComfyuiTemplates("http://127.0.0.1:8188");
    await fetchComfyuiTemplates("http://127.0.0.1:8188/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
