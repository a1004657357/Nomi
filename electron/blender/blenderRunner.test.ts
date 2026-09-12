import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  writeAsset: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../runtime", () => ({ writeAsset: mocks.writeAsset }));

import {
  activeBlenderSceneRenderCount,
  buildBlenderCommandArgs,
  cancelBlenderSceneRender,
  runBlenderSceneRender,
} from "./blenderRunner";

const tempDirs: string[] = [];

beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.writeAsset.mockReset();
  mocks.writeAsset.mockImplementation((_projectId: string, _bytes: Buffer, fileName: string) => ({
    id: `asset-${fileName}`,
    name: fileName,
    data: { url: `nomi-local://asset/project/${fileName}` },
  }));
});

afterEach(() => {
  expect(activeBlenderSceneRenderCount()).toBe(0);
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

function fakeBlenderBinary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-blender-bin-"));
  tempDirs.push(dir);
  const binary = path.join(dir, "blender");
  fs.writeFileSync(binary, "#!/bin/sh\n", { mode: 0o755 });
  return binary;
}

function mockSuccessfulBlenderProcess(): void {
  mocks.spawn.mockImplementation((_binary: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    setTimeout(() => {
      const separator = args.lastIndexOf("--");
      const outputDir = args[separator + 2];
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, "preview.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      fs.writeFileSync(path.join(outputDir, "scene.blend"), "BLENDER");
      fs.writeFileSync(path.join(outputDir, "scene.glb"), minimalGlb());
      child.stdout.emit("data", "NOMI_BLENDER_VERSION=4.0.1\n");
      child.emit("close", 0, null);
    }, 0);
    return child;
  });
}

describe("blender scene runner", () => {
  it("builds a background command with factory startup and autoexec disabled", () => {
    expect(buildBlenderCommandArgs("/tmp/render_scene.py", "/tmp/input.json", "/tmp/out")).toEqual([
      "--background",
      "--factory-startup",
      "--disable-autoexec",
      "--python-exit-code",
      "1",
      "--python",
      "/tmp/render_scene.py",
      "--",
      "/tmp/input.json",
      "/tmp/out",
    ]);
  });

  it("renders preview, blend and glb files back into Nomi project assets", async () => {
    mockSuccessfulBlenderProcess();
    const result = await runBlenderSceneRender({
      jobId: "job-success",
      projectId: "project",
      ownerNodeId: "scene-node",
      blenderPath: fakeBlenderBinary(),
      scene: {
        objects: [{ id: "actor", name: "主角", type: "mannequin", position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true }],
        cameras: [{ id: "camera", name: "相机", position: [4, 2, 5], rotation: [0, 0, 0], target: [0, 1, 0], visible: true, fov: 45, aspectRatio: "16:9", lensDepth: 0, near: 0.1, far: 200 }],
        trajectories: [],
        trajectoryBindings: [],
        trajectoryGroups: [],
        sceneTimeline: { totalDuration: 5 },
        environment: {},
        editorCamera: {},
      },
    });

    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringContaining("blender"),
      expect.arrayContaining(["--background", "--disable-autoexec", "--python"]),
      expect.objectContaining({ windowsHide: true }),
    );
    expect(mocks.writeAsset).toHaveBeenCalledTimes(3);
    expect(mocks.writeAsset.mock.calls.find((call) => call[2] === "blender-scene.glb")?.[4]).toMatchObject({
      model3dValidation: { meshCount: 1, primitiveCount: 1 },
    });
    expect(result).toMatchObject({
      jobId: "job-success",
      blenderVersion: "4.0.1",
      preview: { url: "nomi-local://asset/project/blender-preview.png" },
      blend: { url: "nomi-local://asset/project/blender-scene.blend" },
      model: { url: "nomi-local://asset/project/blender-scene.glb" },
    });
  });

  it("kills the active Blender process when the job is cancelled", async () => {
    const childRef: { current?: EventEmitter & { kill: ReturnType<typeof vi.fn> } } = {};
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => {
        setTimeout(() => child.emit("close", null, "SIGTERM"), 0);
        return true;
      });
      childRef.current = child;
      return child;
    });

    const rendering = runBlenderSceneRender({
      jobId: "job-cancel",
      projectId: "project",
      blenderPath: fakeBlenderBinary(),
      scene: { objects: [], cameras: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cancelBlenderSceneRender("job-cancel")).toBe(true);
    await expect(rendering).rejects.toThrow(/已取消/);
    expect(childRef.current?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("force kills Blender when a render times out", async () => {
    const childRef: { current?: EventEmitter & { kill: ReturnType<typeof vi.fn> } } = {};
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn((signal: NodeJS.Signals) => {
        setTimeout(() => child.emit("close", null, signal), 0);
        return true;
      });
      childRef.current = child;
      return child;
    });

    await expect(runBlenderSceneRender({
      jobId: "job-timeout",
      projectId: "project",
      blenderPath: fakeBlenderBinary(),
      scene: { objects: [], cameras: [] },
      timeoutMs: 5,
    })).rejects.toThrow(/超时/);
    expect(childRef.current?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("removes its temp directory when scene serialization fails", async () => {
    const isRunnerTemp = (name: string) => name.startsWith("nomi-blender-") && !name.startsWith("nomi-blender-bin-");
    const before = new Set(fs.readdirSync(os.tmpdir()).filter(isRunnerTemp));
    const scene: Record<string, unknown> = {};
    scene.self = scene;

    await expect(runBlenderSceneRender({
      jobId: "job-circular",
      projectId: "project",
      blenderPath: fakeBlenderBinary(),
      scene,
    })).rejects.toThrow();

    const leaked = fs.readdirSync(os.tmpdir())
      .filter((name) => isRunnerTemp(name) && !before.has(name));
    for (const name of leaked) fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    expect(leaked).toEqual([]);
  });
});
