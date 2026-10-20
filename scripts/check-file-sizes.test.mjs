import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { listSourceFiles } from "./check-file-sizes.mjs";

const temporaryRoots = [];

function write(root, relativePath, content = "export const value = 1;\n") {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("file-size gate source discovery", () => {
  test("includes tracked and untracked source while excluding ignored and test files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-file-size-gate-"));
    temporaryRoots.push(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    write(root, ".gitignore", "src/ignored.ts\n");
    write(root, "src/tracked.ts");
    write(root, "src/untracked.ts");
    write(root, "src/ignored.ts");
    write(root, "src/example.test.ts");
    write(root, "electron/main.ts");
    write(root, "docs/outside.ts");
    execFileSync("git", ["add", ".gitignore", "src/tracked.ts", "electron/main.ts"], { cwd: root });
    write(root, "src/deleted.ts");
    execFileSync("git", ["add", "src/deleted.ts"], { cwd: root });
    fs.unlinkSync(path.join(root, "src/deleted.ts"));

    expect(listSourceFiles({ root, scanDirs: ["src", "electron"] })).toEqual([
      "electron/main.ts",
      "src/tracked.ts",
      "src/untracked.ts",
    ]);
  });
});
