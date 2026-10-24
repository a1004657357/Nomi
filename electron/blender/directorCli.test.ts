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
  cancelDirectorBlenderRender,
} from "./directorCli";
import { setDesktopLocale } from "../desktopLocale";
import { desktopT } from "../desktopStrings";
import { matchNomiErrorCode } from "../shared/nomiErrorCodes";

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
  setDesktopLocale('zh-CN');
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
  it.each(['zh-CN', 'en'])('keeps historical Director cancellation identity in %s', locale => {
    setDesktopLocale(locale);
    const message = desktopT('custom.blender.directorCli.text12');
    expect(matchNomiErrorCode(message)).toBe('operation-cancelled');
    expect(matchNomiErrorCode(`Error invoking remote method 'scene:render': Error: ${message}`)).toBe('operation-cancelled');
    expect(matchNomiErrorCode(`User authored note: ${message}`)).toBeNull();
    expect(matchNomiErrorCode(`${message} unexpectedly timed out`)).toBeNull();
  });

  it.each(['zh-CN', 'en'].flatMap(locale => ['pending', 'error', 'close', 'persist'].map(route => [locale, route])))('codes the actual %s Director cancellation route %s without resubmission', async (locale, route) => {
    setDesktopLocale(locale);
    const root = tempDir('nomi-director-cancel-');
    const harnessRoot = path.join(root, 'harness');
    const bridge = path.join(harnessRoot, 'cli_anything', 'blender', 'bridge.py');
    fs.mkdirSync(path.dirname(bridge), { recursive: true });
    fs.writeFileSync(bridge, '# isolated test harness');
    mocks.projectDirById.mockReturnValue(root);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(() => true) });
    mocks.spawn.mockReturnValue(child);
    let release: (() => void) | undefined;
    if (route === 'pending') mocks.captureAssetWriteContext.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ root, assertCurrent: vi.fn() });
    }));
    const request = { jobId: 'cancel-job', projectId: 'project', ownerNodeId: 'scene-node', scene: { objects: [], cameras: [] }, harnessRoot };
    const outcome = runDirectorBlenderRender(request).catch(error => error as Error);
    if (route === 'pending') {
      expect(cancelDirectorBlenderRender(request.jobId)).toBe(true);
      release!();
    } else {
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
      if (route === 'persist') {
        const output = path.join(root, '.nomi-director', 'exports', 'cancel');
        fs.mkdirSync(output, { recursive: true });
        const artifacts = { preview: path.join(output, 'preview.png'), blend: path.join(output, 'scene.blend'), model: path.join(output, 'scene.glb') };
        fs.writeFileSync(artifacts.preview, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        fs.writeFileSync(artifacts.blend, 'BLENDER');
        fs.writeFileSync(artifacts.model, minimalGlb());
        mocks.writeAsset.mockImplementationOnce(async () => {
          expect(cancelDirectorBlenderRender(request.jobId)).toBe(true);
          return { id: 'partial-preview', data: { url: 'nomi-local://asset/project/partial.png' } };
        });
        child.stdout.emit('data', JSON.stringify({ ok: true, jobId: request.jobId, artifacts }));
        child.emit('close', 0, null);
      } else {
        expect(cancelDirectorBlenderRender(request.jobId)).toBe(true);
        if (route === 'error') child.emit('error', new Error('Transport closed after cancellation'));
        else child.emit('close', 0, null);
      }
    }
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(matchNomiErrorCode((error as Error).message)).toBe('operation-cancelled');
    expect(mocks.spawn).toHaveBeenCalledTimes(route === 'pending' ? 0 : 1);
    expect(mocks.writeAsset).toHaveBeenCalledTimes(route === 'persist' ? 1 : 0);
    expect(activeDirectorBlenderRenderCount()).toBe(0);
  });

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
