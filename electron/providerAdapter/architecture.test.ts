import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("provider adapter architecture", () => {
  it("does not borrow provider-specific builtins or executable custom-call code", () => {
    const dir = path.resolve(__dirname);
    const productionFiles = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    const productionSource = productionFiles
      .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
      .join("\n")
      .toLowerCase();

    for (const forbidden of [
      "agnesvendor",
      "agnesimages",
      "agnesvideos",
      "agnestexts",
      "nativewireprofiles",
      "seedbuiltins",
      "customcallrunner",
      "new function(",
    ]) {
      expect(productionSource, `forbidden dependency: ${forbidden}`).not.toContain(forbidden);
    }
  });
});
