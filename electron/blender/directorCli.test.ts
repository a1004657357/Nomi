import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  projectDirById: vi.fn(),
  writeAsset: vi.fn(),
  captureAssetWriteContext: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../projects/repository", () => ({ projectDirById: mocks.projectDirById }));
vi.mock("../runtime", () => ({ writeAsset: mocks.writeAsset }));
vi.mock("../assets/assetWriteContext", () => ({ captureAssetWriteContext: mocks.captureAssetWriteContext }));

import {
  activeDirectorBlenderRenderCount,
  buildDirectorBridgeArgs,
  parseDirectorBridgeOutput,
  runDirectorBlenderRender,
} from "./directorCli";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.projectDirById.mockReset();
  mocks.writeAsset.mockReset();
  mocks.captureAssetWriteContext.mockReset();
  mocks.captureAssetWriteContext.mockImplementation(async () => ({ root: mocks.projectDirById(), assertCurrent: vi.fn() }));
  mocks.projectDirById.mockReturnValue("/project-dir");
  mocks.writeAsset.mockImplementation(async (_projectId: string, _bytes: Buffer, fileName: string) => ({
    id: `asset-${fileName}`,
    data: { url: `nomi-local://asset/project/${fileName}` },
  }));
});

afterEach(() => {
  expect(activeDirectorBlenderRenderCount()).toBe(0);
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function minimalGlb(): Buffer {
  const binary = Buffer.alloc(36);
  [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ].flat().forEach((value, index) => binary.writeFloatLE(value, index * 4));
  const source = Buffer.from(JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.length }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [0, 0, 0],
      max: [1, 1, 0],
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }), "utf8");
  const json = Buffer.concat([source, Buffer.alloc((4 - (source.length % 4)) % 4, 0x20)]);
  const body = Buffer.alloc(8 + json.length + 8 + binary.length);
  body.writeUInt32LE(json.length, 0);
  body.writeUInt32LE(0x4e4f534a, 4);
  json.copy(body, 8);
  const binaryHeader = 8 + json.length;
  body.writeUInt32LE(binary.length, binaryHeader);
  body.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(body, binaryHeader + 8);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + body.length, 8);
  return Buffer.concat([header, body]);
}

describe("director Blender CLI bridge", () => {
  it("builds fixed module arguments rather than a shell or arbitrary bpy input", () => {
    expect(buildDirectorBridgeArgs({
      projectDir: "/project-dir",
      sceneInputPath: "/tmp/scene.json",
      jobId: "director-job",
      ownerNodeId: "scene-node",
      title: "咖啡广告",
      stagePreset: "coffee_shop",
      timeoutSeconds: 120,
    })).toEqual([
      "-m",
      "cli_anything.blender.bridge",
      "--project-dir",
      "/project-dir",
      "--scene-input",
      "/tmp/scene.json",
      "--job-id",
      "director-job",
      "--owner-node-id",
      "scene-node",
      "--title",
      "咖啡广告",
      "--stage-preset",
      "coffee_shop",
      "--timeout-seconds",
      "120",
    ]);
  });

  it("parses only a successful structured bridge result", () => {
    expect(parseDirectorBridgeOutput('{"ok":true,"jobId":"job","artifacts":{"preview":"/a.png","blend":"/a.blend","model":"/a.glb"}}')).toMatchObject({
      jobId: "job",
      artifacts: { preview: "/a.png", blend: "/a.blend", model: "/a.glb" },
    });
    expect(() => parseDirectorBridgeOutput('{"ok":false,"error":{"message":"bad manifest"}}')).toThrow("bad manifest");
    expect(() => parseDirectorBridgeOutput("not-json")).toThrow(/JSON/);
  });

  it("runs the typed bridge and imports preview, blend, and GLB into project assets", async () => {
    const projectDir = tempDir("nomi-director-project-");
    mocks.projectDirById.mockReturnValue(projectDir);
    const harnessRoot = tempDir("nomi-director-harness-");
    const bridgePath = path.join(harnessRoot, "cli_anything", "blender", "bridge.py");
    fs.mkdirSync(path.dirname(bridgePath), { recursive: true });
    fs.writeFileSync(bridgePath, "# bridge");
    const outputDir = path.join(projectDir, ".nomi-director", "exports", "render-test");
    fs.mkdirSync(outputDir, { recursive: true });
    const artifacts = {
      preview: path.join(outputDir, "preview.png"),
      blend: path.join(outputDir, "scene.blend"),
      model: path.join(outputDir, "scene.glb"),
    };
    fs.writeFileSync(artifacts.preview, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(artifacts.blend, "BLENDER");
    fs.writeFileSync(artifacts.model, minimalGlb());
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true);
      setTimeout(() => {
        child.stdout.emit("data", `${JSON.stringify({ ok: true, jobId: "director-job", blenderVersion: "4.0.1", artifacts })}\n`);
        child.emit("close", 0, null);
      }, 0);
      return child;
    });

    const result = await runDirectorBlenderRender({
      jobId: "director-job",
      projectId: "project",
      ownerNodeId: "scene-node",
      title: "咖啡广告",
      stagePreset: "coffee_shop",
      scene: { objects: [], cameras: [] },
      pythonPath: "/usr/bin/python3",
      harnessRoot,
    });

    const [binary, args, options] = mocks.spawn.mock.calls[0] as [string, string[], { shell?: boolean; windowsHide?: boolean }];
    expect(binary).toBe("/usr/bin/python3");
    expect(args).toEqual(expect.arrayContaining(["-m", "cli_anything.blender.bridge", "--project-dir", projectDir]));
    expect(options).toMatchObject({ shell: false, windowsHide: true });
    expect(mocks.writeAsset).toHaveBeenCalledTimes(3);
    expect(mocks.writeAsset.mock.calls.find((call) => call[2] === "blender-director-scene.glb")?.[4]).toMatchObject({
      model3dValidation: { meshCount: 1, primitiveCount: 1 },
    });
    expect(result).toMatchObject({
      jobId: "director-job",
      blenderVersion: "4.0.1",
      preview: { url: "nomi-local://asset/project/blender-director-preview.png" },
      blend: { url: "nomi-local://asset/project/blender-director-scene.blend" },
      model: { url: "nomi-local://asset/project/blender-director-scene.glb" },
    });
  });
});
