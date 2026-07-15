import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedLocalAssetThumbnail,
  parseLocalAssetThumbnailSize,
  resetLocalAssetThumbnailCacheForTests,
} from "./localAssetThumbnail";

beforeEach(() => resetLocalAssetThumbnailCacheForTests());

describe("parseLocalAssetThumbnailSize", () => {
  it("accepts bounded width and height", () => {
    expect(parseLocalAssetThumbnailSize(new URL("nomi-local://asset/p/a.png?nomi-thumbnail=160x96")))
      .toEqual({ width: 160, height: 96 });
  });

  it("rejects malformed or oversized requests", () => {
    expect(parseLocalAssetThumbnailSize(new URL("nomi-local://asset/p/a.png?nomi-thumbnail=full"))).toBeNull();
    expect(parseLocalAssetThumbnailSize(new URL("nomi-local://asset/p/a.png?nomi-thumbnail=1024x1024"))).toBeNull();
  });
});

describe("cachedLocalAssetThumbnail", () => {
  it("shares thumbnail work for repeated requests", async () => {
    const create = vi.fn(async () => Buffer.from("thumbnail"));
    const first = cachedLocalAssetThumbnail("asset:160x96", create);
    const second = cachedLocalAssetThumbnail("asset:160x96", create);
    await expect(first).resolves.toEqual(Buffer.from("thumbnail"));
    await expect(second).resolves.toEqual(Buffer.from("thumbnail"));
    expect(create).toHaveBeenCalledTimes(1);
  });
});
