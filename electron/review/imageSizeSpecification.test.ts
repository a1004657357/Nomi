import { describe, expect, it } from "vitest";
import { requestedImageSizeFromBody } from "./imageSizeSpecification";

describe("outbound image size snapshot", () => {
  it("captures exact compiled JSON or multipart fields, not UI resolution labels", () => {
    expect(requestedImageSizeFromBody({ size: "1024x1024" })).toBe("1024x1024");
    expect(requestedImageSizeFromBody({ width: 1536, height: 1024 })).toBe("1536x1024");
    for (const size of ["auto", "1K", "16:9", "0x1024", "1.5x1024", "9007199254740993x1"]) {
      expect(requestedImageSizeFromBody({ size })).toBeUndefined();
    }
    expect(requestedImageSizeFromBody({ resolution: "1K", aspect_ratio: "1:1" })).toBeUndefined();
  });
});
