import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let projectRoot = "";

vi.mock("../projects/repository", () => ({
  projectDirById: vi.fn(() => projectRoot),
  sanitizeName: vi.fn((name: string, fallback: string) => name || fallback),
}));

import { projectCacheRelativePath, writeProjectCacheFile } from "./projectCacheFile";

beforeAll(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-cache-"));
});

afterAll(() => {
  if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true });
});

// 回归锁：缓存（可重建的中间产物）绝不能落进 assets/ ——
// listProjectAssets 递归扫 assets/ 整棵树，落那里就会污染用户素材库
// （胶片条曾以 26:1 长条身份涌进素材库，把真素材挤成细线，看着像空的）。

describe("projectCacheRelativePath", () => {
  it("路径固定在 .nomi/cache/<bucket>/ 下，且不含 assets 段", () => {
    const relative = projectCacheRelativePath("filmstrip", "strip.jpg");
    expect(relative).toBe(".nomi/cache/filmstrip/strip.jpg");
    expect(relative.split("/")).not.toContain("assets");
  });
});

describe("writeProjectCacheFile", () => {
  it("写进 .nomi/cache/filmstrip 且 assets/ 保持不存在（素材库扫不到）", () => {
    const result = writeProjectCacheFile("project-a", Buffer.from("jpegbytes"), "filmstrip", ".jpg");

    expect(fs.existsSync(result.absolutePath)).toBe(true);
    expect(path.relative(projectRoot, result.absolutePath).split(path.sep).slice(0, 3)).toEqual([
      ".nomi",
      "cache",
      "filmstrip",
    ]);
    expect(fs.existsSync(path.join(projectRoot, "assets"))).toBe(false);
  });

  it("返回 nomi-local URL，协议侧照常可读（缓存也走同一条读取链）", () => {
    const result = writeProjectCacheFile("project-a", Buffer.from("x"), "filmstrip", "jpg");
    expect(result.url.startsWith("nomi-local://asset/project-a/")).toBe(true);
    expect(result.url).toContain(".nomi/cache/filmstrip/");
  });

  it("同 bucket 连写两次不互相覆盖（随机段）", () => {
    const first = writeProjectCacheFile("project-a", Buffer.from("a"), "filmstrip", ".jpg");
    const second = writeProjectCacheFile("project-a", Buffer.from("b"), "filmstrip", ".jpg");
    expect(first.absolutePath).not.toBe(second.absolutePath);
    expect(fs.readFileSync(first.absolutePath, "utf8")).toBe("a");
    expect(fs.readFileSync(second.absolutePath, "utf8")).toBe("b");
  });
});
