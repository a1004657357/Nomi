import { describe, expect, it } from "vitest";
import { browserAssetOverlayUsesDragCapture } from "./browserViewOverlay";

describe("browserAssetOverlayUsesDragCapture", () => {
  it("limits drag capture to a shaped, docked asset popover", () => {
    expect(browserAssetOverlayUsesDragCapture({
      dragInteractive: true,
      dockMode: "right",
      hasPopoverRect: true,
    })).toBe(true);
  });

  it("does not let a transparent floating overlay block the whole canvas", () => {
    expect(browserAssetOverlayUsesDragCapture({
      dragInteractive: true,
      dockMode: null,
      hasPopoverRect: true,
    })).toBe(false);
  });

  it("does not capture when there is no visible popover", () => {
    expect(browserAssetOverlayUsesDragCapture({
      dragInteractive: true,
      dockMode: "left",
      hasPopoverRect: false,
    })).toBe(false);
  });
});
