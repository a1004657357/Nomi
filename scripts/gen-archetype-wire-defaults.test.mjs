import { describe, expect, it } from "vitest";
import { buildArchetypeWireDefaults } from "./gen-archetype-wire-defaults.ts";

describe("archetype wire defaults", () => {
  it("uses the default variant parameter overrides for Jimeng Web", () => {
    const defaults = buildArchetypeWireDefaults();

    expect(defaults["jimeng-web-image"].text_to_image["*"]).toMatchObject({
      model: "jimeng-image-5.0-pro",
      ratio: "智能",
      resolution_type: "2K",
    });
    expect(defaults["jimeng-web-seedance-2"].text_to_video["*"]).toMatchObject({
      model: "jimeng-seedance-2.0-mini",
      video_resolution: "720P",
      generation_count: 1,
      duration: 5,
    });
  });
});
