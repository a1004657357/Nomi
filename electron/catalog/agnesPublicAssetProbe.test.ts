import { describe, expect, it, vi } from "vitest";
import {
  assertAgnesPublicImageReachable,
  isAgnesImageToVideoRequest,
} from "./agnesPublicAssetProbe";

describe("AGNES public image preflight", () => {
  it("only applies to AGNES image-to-video requests", () => {
    expect(isAgnesImageToVideoRequest("agnes", "image_to_video")).toBe(true);
    expect(isAgnesImageToVideoRequest("agnes", "text_to_video")).toBe(false);
    expect(isAgnesImageToVideoRequest("other", "image_to_video")).toBe(false);
    expect(isAgnesImageToVideoRequest("agnes--second-account", "image_to_video")).toBe(true);
    expect(isAgnesImageToVideoRequest("private-relay", "image_to_video", [
      { key: "private-relay", meta: { adapterCandidateRootVendorKey: "agnes" } },
    ])).toBe(true);
  });

  it("accepts a reachable public image and requests only the first byte", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(Buffer.from([137]), {
      status: 206,
      headers: { "Content-Type": "image/png" },
    }));

    const report = await assertAgnesPublicImageReachable(
      "https://cdn.example.com/frame.png",
      { fetchImpl, timeoutMs: 500 },
    );

    expect(report).toMatchObject({
      url: "https://cdn.example.com/frame.png",
      status: 206,
      contentType: "image/png",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://cdn.example.com/frame.png",
      expect.objectContaining({
        method: "GET",
        headers: { Range: "bytes=0-0" },
      }),
    );
  });

  it("rejects local and non-http URLs before making a request", async () => {
    const fetchImpl = vi.fn();

    await expect(assertAgnesPublicImageReachable(
      "http://127.0.0.1/frame.png",
      { fetchImpl },
    )).rejects.toThrow(/不是公网 HTTP/);
    await expect(assertAgnesPublicImageReachable(
      "nomi-local://asset/project/frame.png",
      { fetchImpl },
    )).rejects.toThrow(/不是公网 HTTP/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects expired responses and HTML landing pages with asset-fetch wording", async () => {
    const expiredFetch = vi.fn().mockResolvedValue(new Response("expired", { status: 403 }));
    await expect(assertAgnesPublicImageReachable(
      "https://temp.example.com/expired.png",
      { fetchImpl: expiredFetch },
    )).rejects.toThrow(/参考图下载失败.*HTTP 403/);

    const htmlFetch = vi.fn().mockResolvedValue(new Response("<html></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }));
    await expect(assertAgnesPublicImageReachable(
      "https://temp.example.com/page",
      { fetchImpl: htmlFetch },
    )).rejects.toThrow(/参考图下载失败.*不是图片/);
  });
});
