// 唯一读法（#1213）：先合同、再通用规则；通用规则核媒体类型、排除回显的参考地址、排除缩略图 / 尾帧，
// 说出用的是哪条规则；状态问共享词表，认不出不当失败。
import { describe, expect, it } from "vitest";
import { findResultUrlByGenericRule, readTaskResponse, requestEchoUrls } from "./taskResultReading";
import { classifyUpstreamTaskStatus } from "../shared/taskStatus";

const MP4 = "https://cdn.example.test/out.mp4";

// 结构有效的最小图片文件头（供 b64_json 夹具；≥12 字节才过 contentTypeFromMagicBytes 的
// 通用嗅探门槛）：JPEG = SOI + APP0("JFIF\0")，PNG = 签名 + IHDR chunk 头。
const JPEG_HEADER_B64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
]).toString("base64");
const PNG_HEADER_B64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]).toString("base64");

describe("共享状态词表", () => {
  it("各家真实写法都认得（大小写不敏感）", () => {
    for (const word of ["SUCCESS", "succeeded", "completed", "done", "finished", "COMPLETED", "SUCCEEDED"]) expect(classifyUpstreamTaskStatus(word)).toBe("succeeded");
    for (const word of ["NOT_START", "SUBMITTED", "QUEUED", "IN_QUEUE", "pending", "waiting", "THROTTLED"]) expect(classifyUpstreamTaskStatus(word)).toBe("queued");
    for (const word of ["IN_PROGRESS", "processing", "generating", "RUNNING", "in-progress"]) expect(classifyUpstreamTaskStatus(word)).toBe("running");
    for (const word of ["FAILURE", "failed", "fail", "error", "rejected", "expired"]) expect(classifyUpstreamTaskStatus(word)).toBe("failed");
    for (const word of ["cancelled", "CANCELED"]) expect(classifyUpstreamTaskStatus(word)).toBe("cancelled");
  });

  it("认不出 / 空 → unknown（绝不当失败）", () => {
    expect(classifyUpstreamTaskStatus("marinating")).toBe("unknown");
    expect(classifyUpstreamTaskStatus("UNKNOWN")).toBe("unknown");
    expect(classifyUpstreamTaskStatus("")).toBe("unknown");
    expect(classifyUpstreamTaskStatus(undefined)).toBe("unknown");
  });
});

describe("readTaskResponse：先合同、再通用规则", () => {
  it("合同读得到就用合同（rule=contract）", () => {
    const reading = readTaskResponse({ response: { status: "succeeded", content: { video_url: MP4 } }, responseMapping: { status: "status", video_url: "content.video_url" }, statusMapping: undefined, wantedKind: "video" });
    expect(reading).toMatchObject({ status: "succeeded", assetUrls: [MP4], rule: "contract" });
  });

  it("合同读不到、上游说成了 → 通用规则在响应里找到地址，并说出路径", () => {
    const reading = readTaskResponse({ response: { code: "success", data: { status: "SUCCESS", result_url: MP4 } }, responseMapping: { video_url: "data[*].url" }, statusMapping: undefined, wantedKind: "video" });
    expect(reading).toMatchObject({ status: "succeeded", assetUrls: [MP4], rule: "generic:data.result_url" });
  });

  it("进行中的响应里出现的地址不拿去落盘", () => {
    const reading = readTaskResponse({ response: { status: "processing", url: MP4 }, responseMapping: null, statusMapping: undefined, wantedKind: "video" });
    expect(reading).toMatchObject({ status: "running", assetUrls: [], rule: "none" });
  });

  it("上游说成了却哪里都没有地址 → succeeded + 空（由取回层交「可找回」，不判失败）", () => {
    expect(readTaskResponse({ response: { status: "completed", id: "x" }, responseMapping: null, statusMapping: undefined, wantedKind: "video" })).toMatchObject({ status: "succeeded", assetUrls: [], rule: "none" });
  });
});

describe("通用规则的三道筛", () => {
  it("按期望媒体类型核扩展名：要视频不接一张图", () => {
    expect(findResultUrlByGenericRule({ status: "succeeded", url: "https://cdn.example.test/a.png" }, "video")).toBeNull();
    expect(findResultUrlByGenericRule({ status: "succeeded", url: "https://cdn.example.test/a.png", video_url: MP4 }, "video")?.urls).toEqual([MP4]);
  });

  it("排除本次请求回显的参考地址", () => {
    const echo = requestEchoUrls({ image_url: "https://refs.example.test/cat.mp4", nested: [{ url: "https://refs.example.test/b.mp4" }] });
    expect(echo.has("https://refs.example.test/cat.mp4")).toBe(true);
    expect(findResultUrlByGenericRule({ status: "succeeded", url: "https://refs.example.test/cat.mp4" }, "video", echo)).toBeNull();
    expect(findResultUrlByGenericRule({ status: "succeeded", output: { url: MP4 }, input: { url: "https://refs.example.test/b.mp4" } }, "video", echo)?.urls).toEqual([MP4]);
  });

  it("排除缩略图 / 封面 / 尾帧 / 参考字段", () => {
    expect(findResultUrlByGenericRule({ thumbnail_url: "https://cdn.example.test/t.mp4", content: { last_frame_url: "https://cdn.example.test/l.mp4" }, reference_urls: ["https://cdn.example.test/r.mp4"] }, "video")).toBeNull();
  });

  it("同一张列表里的兄弟一起取（多产物），别处的地址不搭车", () => {
    const found = findResultUrlByGenericRule({ data: { result: { videos: [{ url: ["https://cdn.example.test/1.mp4"] }, { url: ["https://cdn.example.test/2.mp4"] }] }, poster: "https://cdn.example.test/p.mp4" } }, "video");
    expect(found).toEqual({ urls: ["https://cdn.example.test/1.mp4", "https://cdn.example.test/2.mp4"], path: "data.result.videos.*.url.*" });
  });

  it("被当字符串二次嵌套的 JSON 也认（KIE 的 resultJson）", () => {
    expect(findResultUrlByGenericRule({ data: { state: "success", resultJson: JSON.stringify({ resultUrls: [MP4] }) } }, "video")?.urls).toEqual([MP4]);
  });

  it("已知形状：同步接口的 b64_json 解成 data: 地址（深扫就地转，路径可追溯）", () => {
    const found = findResultUrlByGenericRule({ data: [{ b64_json: PNG_HEADER_B64 }] }, "image");
    expect(found?.path).toBe("data.*.url");
    expect(found?.urls[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("多张 b64_json 结果一起收（gpt-image 系代理按 n>1 回 b64 数组），类型按魔数说真话", () => {
    // 夹具是结构有效的最小文件头（≥12 字节才过通用魔数嗅探门槛：JPEG=SOI+APP0+JFIF，
    // PNG=签名+IHDR chunk 头）——真实小图，不是 6 字节片段（片段会按 image/png 兜底，
    // 那是嗅探的既定行为，不是 bug）。
    const found = findResultUrlByGenericRule({ created: 1, data: [{ b64_json: JPEG_HEADER_B64 }, { b64_json: PNG_HEADER_B64 }, { revised_prompt: "x" }] }, "image");
    expect(found?.urls).toHaveLength(2);
    expect(found?.urls[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(found?.urls[1]).toMatch(/^data:image\/png;base64,/);
  });

  it("要视频时 b64 图片不冒充产物", () => {
    expect(findResultUrlByGenericRule({ data: [{ b64_json: PNG_HEADER_B64 }] }, "video")).toBeNull();
  });

  it("base64 input and reference images are not returned as generated outputs", () => {
    const found = findResultUrlByGenericRule({
      input: { b64_json: JPEG_HEADER_B64 },
      references: [{ b64_json: JPEG_HEADER_B64 }],
      data: [{ b64_json: PNG_HEADER_B64 }],
    }, "image");
    expect(found?.urls).toEqual([`data:image/png;base64,${PNG_HEADER_B64}`]);
  });

  for (const url of ["https://cdn.example.test/a.png", "https://cdn.example.test/download?id=1"]) {
    for (const serialized of [false, true]) {
      it.each([null, { image_url: "data[*].url" }])(`collects mixed siblings (${url}, serialized=${serialized}) with mapping %j`, (responseMapping) => {
        const items = [{ url }, { b64_json: PNG_HEADER_B64 }];
        const response = { data: serialized ? JSON.stringify(items) : items };
        const result = readTaskResponse({ response, responseMapping, statusMapping: undefined, wantedKind: "image" });
        expect(result.assetUrls).toEqual([url, `data:image/png;base64,${PNG_HEADER_B64}`]);
        if (responseMapping) expect(result.rule).toBe("contract");
      });
    }
  }

  it("does not duplicate a result represented by both url and base64", () => {
    expect(findResultUrlByGenericRule({ data: [{ url: "https://cdn.example.test/a.png", b64_json: PNG_HEADER_B64 }] }, "image")?.urls)
      .toEqual(["https://cdn.example.test/a.png"]);
  });

  it.each(["processing", "failed"])("does not materialize mapped inline outputs while status is %s", (status) => {
    const result = readTaskResponse({ response: { status, data: [{ b64_json: PNG_HEADER_B64 }] },
      responseMapping: { image_url: "data[*].url", status: "status" }, statusMapping: undefined, wantedKind: "image" });
    expect(result.status).not.toBe("succeeded");
    expect(result.assetUrls).toEqual([]);
  });
});
