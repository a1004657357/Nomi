import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, importRemoteAsset, listProjectAssets, localizedTaskAssetFileName } from "./runtime";
import { importLocalFile, importLocalPath } from "./assets/localFileImport";
import { localizeTaskAsset } from "./tasks/profileTaskExecution";

vi.mock("./export/mediaProbe", () => ({
  probeMediaMetadata: vi.fn(async () => ({ kind: "video", hasAudio: false, durationSeconds: 3.0625 })),
}));

vi.mock("./review/reviewTrace", () => ({
  scheduleTechnicalReview: vi.fn(),
}));

type AssetRecord = {
  data: {
    relativePath: string;
    absolutePath: string;
    url: string;
    contentType: string;
    model3dValidation?: {
      meshCount: number;
      primitiveCount: number;
      bounds: { diagonal: number };
    };
  };
};

const tempRoots: string[] = [];
let mockedDocumentsRoot = "";
let mockedUserDataRoot = "";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "documents") return mockedDocumentsRoot;
      if (name === "userData") return mockedUserDataRoot;
      return mockedUserDataRoot;
    },
    getAppPath: () => process.cwd(),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
  mockedDocumentsRoot = makeTempDir("nomi-runtime-assets-documents-");
  mockedUserDataRoot = makeTempDir("nomi-runtime-assets-user-data-");
  delete process.env.NOMI_PROJECTS_DIR;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NOMI_PROJECTS_DIR;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(name = "nomi-runtime-assets-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

function createWorkspace(): { id: string; rootPath: string } {
  const rootPath = makeTempDir();
  const project = createProject({ rootPath, name: "Asset Workspace", payload: {} });
  return { id: project.id, rootPath };
}

describe("runtime workspace asset storage", () => {
  it("keeps provider video filename extensions when localizing task assets", () => {
    expect(
      localizedTaskAssetFileName(
        "video",
        "http://127.0.0.1:8188/view?filename=ComfyUI_00123_.webm&subfolder=&type=output",
        123,
      ),
    ).toBe("video-123.webm");
    expect(localizedTaskAssetFileName("video", "https://cdn.example.com/result.mov", 123)).toBe("video-123.mov");
    expect(localizedTaskAssetFileName("video", "https://cdn.example.com/result", 123)).toBe("video-123.mp4");
  });

  it("includes probed video duration when localizing task assets", async () => {
    const workspace = createWorkspace();

    const asset = await localizeTaskAsset(
      workspace.id,
      "data:video/mp4;base64,aGVsbG8=",
      "video",
      "node-1",
    );

    expect(asset.url).toContain("nomi-local://asset/");
    expect(asset.durationSeconds).toBe(3.0625);
  });

  it("writes generated remote assets under assets/generated/YYYY-MM-DD", async () => {
    const workspace = createWorkspace();

    const asset = (await importRemoteAsset({
      projectId: workspace.id,
      url: "data:image/png;base64,aGVsbG8=",
      fileName: "render.png",
      kind: "generated",
    })) as AssetRecord;

    expect(asset.data.relativePath).toBe("assets/generated/2026-05-31/render.png");
    expect(asset.data.absolutePath).toBe(path.join(workspace.rootPath, "assets", "generated", "2026-05-31", "render.png"));
    expect(fs.readFileSync(asset.data.absolutePath, "utf8")).toBe("hello");
    expect(asset.data.url).toBe(`nomi-local://asset/${encodeURIComponent(workspace.id)}/assets/generated/2026-05-31/render.png`);
  });

  it("validates a generated GLB before writing it and persists the inspection summary", async () => {
    const workspace = createWorkspace();
    const bytes = fs.readFileSync(path.resolve(process.cwd(), "src/assets/nomi-mannequin.glb"));

    const asset = (await importRemoteAsset({
      projectId: workspace.id,
      url: `data:model/gltf-binary;base64,${bytes.toString("base64")}`,
      fileName: "generated-model.glb",
      kind: "generated",
      mediaType: "model3d",
    })) as AssetRecord;

    expect(asset.data.contentType).toBe("model/gltf-binary");
    expect(asset.data.model3dValidation).toMatchObject({
      meshCount: expect.any(Number),
      primitiveCount: expect.any(Number),
      bounds: { diagonal: expect.any(Number) },
    });
    expect(asset.data.model3dValidation?.meshCount).toBeGreaterThan(0);
    expect(asset.data.model3dValidation?.bounds.diagonal).toBeGreaterThan(0);
  });

  it("rejects an invalid generated GLB before it reaches the project asset library", async () => {
    const workspace = createWorkspace();

    await expect(importRemoteAsset({
      projectId: workspace.id,
      url: "data:model/gltf-binary;base64,Z2xURg==",
      fileName: "broken.glb",
      kind: "generated",
      mediaType: "model3d",
    })).rejects.toThrow(/GLB.*过短/);

    expect(fs.existsSync(path.join(workspace.rootPath, "assets", "generated", "2026-05-31", "broken.glb"))).toBe(false);
  });

  it("writes imported user files under assets/imported/YYYY-MM-DD", async () => {
    const workspace = createWorkspace();

    const asset = (await importLocalFile({
      projectId: workspace.id,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      fileName: "photo.png",
    })) as AssetRecord;

    expect(asset.data.relativePath).toBe("assets/imported/2026-05-31/photo.png");
    expect(asset.data.absolutePath).toBe(path.join(workspace.rootPath, "assets", "imported", "2026-05-31", "photo.png"));
    expect([...fs.readFileSync(asset.data.absolutePath)]).toEqual([1, 2, 3]);
  });

  it("imports a generated local path under assets/generated/YYYY-MM-DD", async () => {
    const workspace = createWorkspace();
    const sourcePath = path.join(makeTempDir("nomi-codex-source-"), "codex-output.png");
    fs.writeFileSync(sourcePath, Buffer.from([4, 5, 6]));

    const asset = (await importLocalPath({
      projectId: workspace.id,
      path: sourcePath,
      fileName: "codex-output.png",
      kind: "generated",
      ownerNodeId: "node-1",
    })) as AssetRecord;

    expect(asset.data.relativePath).toBe("assets/generated/2026-05-31/codex-output.png");
    expect(asset.data.absolutePath).toBe(path.join(workspace.rootPath, "assets", "generated", "2026-05-31", "codex-output.png"));
    expect([...fs.readFileSync(asset.data.absolutePath)]).toEqual([4, 5, 6]);
    expect(asset.data.contentType).toBe("image/png");
  });

  it("restores imported asset metadata when listing project assets", async () => {
    const workspace = createWorkspace();

    await importLocalFile({
      projectId: workspace.id,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      fileName: "photo.png",
      kind: "upload",
    });
    await importRemoteAsset({
      projectId: workspace.id,
      url: "data:image/png;base64,aGVsbG8=",
      fileName: "capture.png",
      kind: "browser-capture",
    });
    await importLocalFile({
      projectId: workspace.id,
      bytes: new Uint8Array([4, 5, 6]),
      contentType: "image/png",
      fileName: "box.png",
      kind: "browser-upload",
    });

    const listed = listProjectAssets({ projectId: workspace.id, limit: 20 });

    expect(listed.items.map((item) => item.name).sort()).toEqual(["box.png", "capture.png", "photo.png"]);
    expect(listed.items.find((item) => item.name === "photo.png")?.data.kind).toBe("upload");
    expect(listed.items.find((item) => item.name === "capture.png")?.data.kind).toBe("browser-capture");
    expect(listed.items.find((item) => item.name === "box.png")?.data.kind).toBe("browser-upload");
    expect(listed.items.every((item) => !item.name.endsWith(".meta"))).toBe(true);
  });

  it("dedupes colliding generated asset filenames", async () => {
    const workspace = createWorkspace();

    await importRemoteAsset({ projectId: workspace.id, url: "data:image/png;base64,Zmlyc3Q=", fileName: "render.png" });
    const second = (await importRemoteAsset({ projectId: workspace.id, url: "data:image/png;base64,c2Vjb25k", fileName: "render.png" })) as AssetRecord;

    expect(second.data.relativePath).toBe("assets/generated/2026-05-31/render-2.png");
    expect(fs.readFileSync(second.data.absolutePath, "utf8")).toBe("second");
  });
});
