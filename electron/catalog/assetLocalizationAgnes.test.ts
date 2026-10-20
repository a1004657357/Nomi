import { describe, expect, it, vi } from "vitest";
import { AGNES_UPLOAD_CHAIN, UGUU_INGESTION, ANON_UPLOAD_CHAIN, localizeAssetsForVendor, resolveAssetIngestionWithFallback } from "./assetLocalization";
import { ingestionVisibility } from "./assetTransportPolicy";

describe("Agnes upload fallback compatibility", () => {
  const target = { key: "agnes" };
  const local = "nomi-local://asset/test/frame.png";
  const read = () => ({ bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64"), contentType: "image/png", fileName: "frame.png" });

  it("retains credentialed candidates ahead of the Uguu anonymous chain", () => {
    const candidates = resolveAssetIngestionWithFallback(target, [target, { key: "kie" }], (key) => key === "kie" ? "fixture-only" : null, "image");
    expect(candidates.map((candidate) => candidate.vendorKey)).toEqual(["kie", "nomi-relay", null]);
    expect(candidates.at(-1)).toEqual({ ingestion: AGNES_UPLOAD_CHAIN, vendorKey: null, uploadApiKey: "" });
  });

  it.each(["audio", "video"] as const)("does not send %s to the image-only Uguu chain", (kind) => {
    const candidates = resolveAssetIngestionWithFallback(target, [target], () => null, kind);
    expect(candidates[0]?.vendorKey).toBe("nomi-relay");
    expect(candidates.at(-1)).toEqual({ ingestion: ANON_UPLOAD_CHAIN, uploadApiKey: "", vendorKey: null });
    expect(candidates.some((candidate) => candidate.ingestion === AGNES_UPLOAD_CHAIN)).toBe(false);
  });

  it.each([AGNES_UPLOAD_CHAIN, UGUU_INGESTION])("treats $strategy as public and never uploads without consent", async (ingestion) => {
    const post = vi.fn();
    const multipart = vi.fn();
    expect(ingestionVisibility(ingestion)).toBe("public-anonymous");
    await expect(localizeAssetsForVendor({ firstFrameUrl: local }, () => [{ ingestion, uploadApiKey: "", vendorKey: null }], read, post, multipart, { anonymousConsent: "ask" })).rejects.toThrow(/公共临时托管/);
    expect(post).not.toHaveBeenCalled();
    expect(multipart).not.toHaveBeenCalled();
  });

  it("uses Uguu then Litterbox after explicit consent, without sending provider credentials", async () => {
    const multipart = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce("https://litter.catbox.moe/fixture.png");
    const result = await localizeAssetsForVendor({ firstFrameUrl: local }, () => resolveAssetIngestionWithFallback(target, [target], (key) => key === "agnes" ? "fixture-only" : null, "image").filter((candidate) => candidate.vendorKey === null), read, vi.fn(), multipart, { anonymousConsent: "allow" });
    expect(result.value).toEqual({ firstFrameUrl: "https://litter.catbox.moe/fixture.png" });
    expect(multipart.mock.calls.map((call) => call[0])).toEqual(["https://uguu.se/upload.php", "https://litterbox.catbox.moe/resources/internals/api.php"]);
    expect(multipart.mock.calls.map((call) => call[1])).toEqual([{}, {}]);
  });
});
