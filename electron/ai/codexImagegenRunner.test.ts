import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDesktopLocale } from "../desktopLocale";
import { matchNomiErrorCode } from "../shared/nomiErrorCodes";

const spawnMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn(() => { throw new Error("Unexpected external execFile in offline Codex fixture"); }));
const probeMediaMetadataMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  execFile: execFileMock,
}));
vi.mock("../export/mediaProbe", () => ({
  probeMediaMetadata: probeMediaMetadataMock,
}));

import {
  buildCodexImagegenPrompt,
  cleanupStaleCodexImagegenTempDirs,
  collectCodexReferenceUrls,
  cancelCodexImageGeneration,
  prepareIsolatedCodexHome,
  resolveCodexImagegenIdleTimeoutMs,
  resolveCodexImagegenTimeoutMs,
  runCodexImageGeneration as runCodexImageGenerationRaw,
} from "./codexImagegenRunner";
import { planCodexAspectRatioCrop, validateCodexGeneratedImage } from "./codexImagegenPolicy";
import { rememberProxyStateForTests, resetProxyStateForTests } from "../systemProxy";

const tempDirs: string[] = [];

type TestRunInput = Parameters<typeof runCodexImageGenerationRaw>[0] & {
  validateOutput?: (outputPath: string) => Promise<void>;
};

function runCodexImageGeneration(input: TestRunInput) {
  return runCodexImageGenerationRaw({
    ...input,
    validateOutput: input.validateOutput || (async () => undefined),
  } as Parameters<typeof runCodexImageGenerationRaw>[0]);
}

function rememberDiagnosticDir(error: unknown): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const tempDir = normalized.message.match(/诊断目录：([^\n]+)/)?.[1];
  if (tempDir) tempDirs.push(tempDir);
  return normalized;
}

async function expectRunFailure(run: ReturnType<typeof runCodexImageGeneration>): Promise<Error> {
  const result = await run.catch(rememberDiagnosticDir);
  if (result instanceof Error) return result;
  tempDirs.push(result.tempDir);
  throw new Error("Expected Codex generation to fail");
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-codex-runner-test-"));
  const sourceHome = path.join(root, "source-home");
  tempDirs.push(root);
  fs.mkdirSync(sourceHome);
  fs.writeFileSync(path.join(sourceHome, "auth.json"), "{}", { mode: 0o600 });
  vi.spyOn(os, "tmpdir").mockReturnValue(root);
  vi.stubEnv("TMPDIR", root);
  vi.stubEnv("CODEX_HOME", sourceHome);
  spawnMock.mockReset();
  probeMediaMetadataMock.mockReset();
  probeMediaMetadataMock.mockResolvedValue({ width: 1024, height: 1024 });
  resetProxyStateForTests();
});

afterEach(() => {
  expect(execFileMock).not.toHaveBeenCalled();
  setDesktopLocale("zh-CN");
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetProxyStateForTests();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function mockCodexExecSuccess(): void {
  spawnMock.mockImplementation((_bin: string, args: string[], _options: unknown) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.stdin.end.mockImplementation((promptInput: string) => {
      setTimeout(() => {
        const prompt = String(promptInput || "");
        const outputPath = prompt.match(/"path":"([^"]+)"/)?.[1] || "";
        const lastMessagePath = args[args.indexOf("--output-last-message") + 1];
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        fs.writeFileSync(lastMessagePath, `{"ok":true,"path":"${outputPath}"}`);
        child.stdout.emit("data", '{"type":"thread.started","thread_id":"thread-fast"}\n');
        child.emit("close", 0);
      }, 0);
    });
    return child;
  });
}

function mockCodexExecFailure(): void {
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.stdin.end.mockImplementation(() => {
      setTimeout(() => {
        child.stdout.emit("data", '{"type":"thread.started","thread_id":"thread-fail"}\n');
        child.stderr.emit("data", "imagegen tool failed before writing output\n");
        child.emit("close", 1);
      }, 0);
    });
    return child;
  });
}

describe("codexImagegenRunner", () => {
  it("does not kill a silent image generation before the hard timeout by default", () => {
    expect(resolveCodexImagegenIdleTimeoutMs(undefined)).toBe(0);
    expect(resolveCodexImagegenIdleTimeoutMs(12_345)).toBe(12_345);
  });

  it("uses the smoke timeout environment value unless the caller overrides it", () => {
    expect(resolveCodexImagegenTimeoutMs(undefined, "12500")).toBe(12_500);
    expect(resolveCodexImagegenTimeoutMs(5_000, "12500")).toBe(5_000);
    expect(resolveCodexImagegenTimeoutMs(undefined, "invalid")).toBe(10 * 60_000);
  });

  it("collects de-duped reference images from archetype input and legacy extras", () => {
    const urls = collectCodexReferenceUrls({
      kind: "image_edit",
      prompt: "keep the cup",
      extras: {
        archetypeInput: {
          input_urls: ["nomi-local://asset/proj/assets/imported/a.png", ""],
          reference_image_urls: ["https://cdn.example.com/ref.png"],
        },
        referenceImages: ["data:image/png;base64,AAAA", "https://cdn.example.com/ref.png"],
        referenceImageUrls: ["nomi-local://asset/proj/assets/imported/a.png"],
      },
    });

    expect(urls).toEqual([
      "nomi-local://asset/proj/assets/imported/a.png",
      "https://cdn.example.com/ref.png",
      "data:image/png;base64,AAAA",
    ]);
  });

  it("builds a Codex exec prompt that requires the built-in imagegen tool and exact output path", () => {
    const prompt = buildCodexImagegenPrompt(
      {
        kind: "text_to_image",
        prompt: "single white ceramic coffee cup, no text",
        extras: { archetypeInput: { aspect_ratio: "1:1", resolution: "high" } },
      },
      "/tmp/nomi-codex-img2/result.png",
      0,
    );

    expect(prompt).toContain("Use the built-in image_gen.imagegen tool only");
    expect(prompt).toContain("Do not use the OpenAI API fallback");
    expect(prompt).toContain("Invoke image_gen.imagegen exactly once");
    expect(prompt).toContain("do not retry");
    expect(prompt).toContain("Do not inspect project files, memory, profiles, or other skills");
    expect(prompt).toContain("Task: text-to-image generation.");
    expect(prompt).toContain("No reference images.");
    expect(prompt).toContain("omit both referenced_image_paths and num_last_images_to_include entirely");
    expect(prompt).toContain("Never pass either field as 0, null, or an empty array");
    expect(prompt).toContain("Aspect ratio: 1:1. Resolution: high.");
    expect(prompt).toContain("Save/copy the final raster image to: /tmp/nomi-codex-img2/result.png");
    expect(prompt).toContain('{"ok":true,"path":"/tmp/nomi-codex-img2/result.png"}');
  });

  it("defaults Codex Img2 prompt resolution to 1K for faster test runs", () => {
    const prompt = buildCodexImagegenPrompt(
      {
        kind: "text_to_image",
        prompt: "coffee cup",
      },
      "/tmp/out.png",
      0,
    );

    expect(prompt).toContain("Aspect ratio: auto. Resolution: 1K.");
  });

  it("makes 9:16 the highest-priority canvas contract and removes a stored horizontal-layout conflict", () => {
    const prompt = buildCodexImagegenPrompt(
      {
        kind: "text_to_image",
        prompt: "角色定妆参考卡。横向版面、分格清晰。",
        extras: { archetypeInput: { aspect_ratio: "9:16", resolution: "2K" }, referenceSheet: true },
      },
      "/tmp/out.png",
      0,
    );

    expect(prompt).toContain("HIGHEST-PRIORITY OUTPUT CANVAS CONTRACT");
    expect(prompt).toContain("exact 9:16 portrait canvas");
    expect(prompt).toContain("Prompt: 角色定妆参考卡。竖向版面、分格清晰。");
    expect(prompt).not.toContain("Prompt: 角色定妆参考卡。横向版面");
  });

  it("keeps a decodable Codex image when only the soft aspect-ratio review is suspect", async () => {
    await expect(
      validateCodexGeneratedImage(
        "/tmp/result.png",
        { kind: "text_to_image", prompt: "portrait", extras: { aspect_ratio: "9:16" } },
        async () => ({
          suspect: true,
          checks: [{ id: "aspect-ratio", suspect: true, detail: "实际 1536×1024，不符合请求画幅 9:16" }],
        }),
      ),
    ).resolves.toMatchObject({ suspect: true });
  });

  it("plans a bounded same-orientation crop but refuses a destructive landscape-to-portrait crop", () => {
    expect(planCodexAspectRatioCrop(1024, 1536, "9:16")).toMatchObject({
      width: 864,
      height: 1536,
      x: 80,
      y: 0,
    });
    expect(planCodexAspectRatioCrop(1536, 1024, "16:9")).toMatchObject({
      width: 1536,
      height: 864,
      x: 0,
      y: 80,
    });
    expect(planCodexAspectRatioCrop(1536, 1024, "9:16")).toBeNull();
  });

  it("locally conforms a compatible portrait result and verifies it again without another generation", async () => {
    const reviewImage = vi
      .fn()
      .mockResolvedValueOnce({
        suspect: true,
        checks: [
          {
            id: "aspect-ratio",
            suspect: true,
            detail: "实际 1024×1536，不符合请求画幅 9:16",
            metrics: { width: 1024, height: 1536 },
          },
        ],
        metadata: { width: 1024, height: 1536 },
      })
      .mockResolvedValueOnce({
        suspect: false,
        checks: [{ id: "aspect-ratio", suspect: false, detail: "实际 864×1536，符合请求画幅 9:16" }],
        metadata: { width: 864, height: 1536 },
      });
    const conformImage = vi.fn(async () => undefined);

    const verdict = await validateCodexGeneratedImage(
      "/tmp/result.png",
      { kind: "text_to_image", prompt: "portrait", extras: { aspect_ratio: "9:16" } },
      reviewImage,
      conformImage,
    );

    expect(conformImage).toHaveBeenCalledWith(
      "/tmp/result.png",
      expect.objectContaining({ width: 864, height: 1536, retainedAreaRatio: 0.84375 }),
    );
    expect(reviewImage).toHaveBeenCalledTimes(2);
    expect(verdict.suspect).toBe(false);
  });

  it("still rejects an undecodable or undersized Codex image", async () => {
    await expect(
      validateCodexGeneratedImage("/tmp/result.png", { kind: "text_to_image", prompt: "portrait" }, async () => ({
        suspect: true,
        checks: [{ id: "undecodable", suspect: true, detail: "图片尺寸过小：100×100" }],
      })),
    ).rejects.toThrow(/尺寸过小/);
  });

  it("switches to reference/edit instructions when images are attached", () => {
    const prompt = buildCodexImagegenPrompt(
      {
        kind: "image_edit",
        prompt: "change the background to warm studio light",
      },
      "/tmp/out.png",
      2,
    );

    expect(prompt).toContain("Task: edit/reference image generation.");
    expect(prompt).toContain("Use 2 attached image file(s) as references/edit targets.");
    expect(prompt).toContain("Pass every attached local path through referenced_image_paths");
    expect(prompt).toContain("do not use num_last_images_to_include");
  });

  it("binds every attached reference path to its role and purpose in attachment order", () => {
    const prompt = buildCodexImagegenPrompt(
      {
        kind: "image_edit",
        prompt: "create a vertical storyboard frame",
      },
      "/tmp/out.png",
      [
        { path: "/tmp/character.png", role: "角色身份参考", purpose: "只锁定脸、发型和服装" },
        { path: "/tmp/scene.png", role: "场景参考", purpose: "锁定咖啡馆空间和光线" },
      ],
    );

    expect(prompt).toContain("Reference 1: /tmp/character.png");
    expect(prompt).toContain("Role: 角色身份参考");
    expect(prompt).toContain("Purpose: 只锁定脸、发型和服装");
    expect(prompt).toContain("Reference 2: /tmp/scene.png");
    expect(prompt).toContain("Role: 场景参考");
    expect(prompt).toContain("Purpose: 锁定咖啡馆空间和光线");
  });

  it("materializes multiple inline references to distinct paths even within one millisecond", async () => {
    mockCodexExecSuccess();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456789);
    try {
      const result = await runCodexImageGeneration({
        request: {
          kind: "image_edit",
          prompt: "keep identity and scene",
          extras: {
            archetypeInput: {
              input_urls: ["data:image/png;base64,AA==", "data:image/png;base64,AQ=="],
            },
            referenceImages: ["data:image/png;base64,AA==", "data:image/png;base64,AQ=="],
            referenceImageRoles: ["角色身份参考", "场景参考"],
            referenceImagePurposes: ["锁定人物", "锁定空间"],
          },
        },
      });
      tempDirs.push(result.tempDir);

      const args = spawnMock.mock.calls[0]?.[1] as string[];
      const imagePaths = args.flatMap((value, index) => (value === "--image" ? [args[index + 1]] : []));
      const prompt = String(
        (spawnMock.mock.results[0]?.value as { stdin: { end: ReturnType<typeof vi.fn> } }).stdin.end.mock
          .calls[0]?.[0] || "",
      );
      expect(imagePaths).toHaveLength(2);
      expect(new Set(imagePaths).size).toBe(2);
      expect(prompt).toContain(`Reference 1: ${imagePaths[0]}`);
      expect(prompt).toContain("Role: 角色身份参考");
      expect(prompt).toContain(`Reference 2: ${imagePaths[1]}`);
      expect(prompt).toContain("Role: 场景参考");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("runs Codex from an empty temp cwd with git repo check skipped and returns timings", async () => {
    mockCodexExecSuccess();
    rememberProxyStateForTests({ kind: "http", url: "http://127.0.0.1:7897", source: "system" });

    const result = await runCodexImageGeneration({
      request: { kind: "text_to_image", prompt: "coffee cup" },
      timeoutMs: 5_000,
    });
    tempDirs.push(result.tempDir);

    expect(result.threadId).toBe("thread-fast");
    expect(result.timings.referenceCount).toBe(0);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.cwd).toBe(path.join(result.tempDir, "cwd"));
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    const options = spawnMock.mock.calls[0]?.[2] as { cwd?: string; stdio?: string[]; env?: NodeJS.ProcessEnv };
    const child = spawnMock.mock.results[0]?.value as { stdin: { end: ReturnType<typeof vi.fn> } };
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--disable");
    expect(args).toContain("apps");
    expect(args).toContain("code_mode_host");
    expect(args).toContain("code_mode");
    expect(args).toContain("image_generation");
    expect(args).not.toContain("coffee cup");
    expect(child.stdin.end).toHaveBeenCalledWith(expect.stringContaining("Prompt: coffee cup"));
    expect(options.cwd).toBe(result.timings.cwd);
    expect(options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(options.env?.HTTPS_PROXY).toBe("http://127.0.0.1:7897");
    expect(options.env?.HTTP_PROXY).toBe("http://127.0.0.1:7897");
    expect(options.env?.NO_PROXY).toContain("127.0.0.1");
  });

  it("rejects a generated file before returning when the synchronous validator fails", async () => {
    mockCodexExecSuccess();

    await expect(
      runCodexImageGeneration({
        request: { kind: "text_to_image", prompt: "coffee cup" },
        validateOutput: async () => {
          throw new Error("图片尺寸过小：100×100");
        },
      }),
    ).rejects.toThrow("图片尺寸过小：100×100");
  });

  it("rejects a Codex exec that exposes two imagegen invocations", async () => {
    spawnMock.mockImplementation((_bin: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin.end.mockImplementation((promptInput: string) => {
        setTimeout(() => {
          const outputPath = String(promptInput).match(/"path":"([^"]+)"/)?.[1] || "";
          const lastMessagePath = args[args.indexOf("--output-last-message") + 1];
          fs.writeFileSync(outputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          fs.writeFileSync(lastMessagePath, `{"ok":true,"path":"${outputPath}"}`);
          child.stdout.emit(
            "data",
            '{"type":"item.started","item":{"id":"call-1","type":"tool_call","name":"image_gen.imagegen"}}\n',
          );
          child.stdout.emit(
            "data",
            '{"type":"item.started","item":{"id":"call-2","type":"tool_call","name":"image_gen.imagegen"}}\n',
          );
          child.emit("close", 0);
        }, 0);
      });
      return child;
    });

    await expect(
      runCodexImageGeneration({
        request: { kind: "text_to_image", prompt: "coffee cup" },
      }),
    ).rejects.toThrow(/调用了 2 次/);
  });

  it("recovers a generated image from the isolated Codex home before cleaning it", async () => {
    let isolatedHome = "";
    spawnMock.mockImplementation((_bin: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin.end.mockImplementation(() => {
        setTimeout(() => {
          isolatedHome = String(options.env?.CODEX_HOME || "");
          const generatedDir = path.join(isolatedHome, "generated_images");
          fs.mkdirSync(generatedDir, { recursive: true });
          fs.writeFileSync(path.join(generatedDir, "tool-output.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          const lastMessagePath = args[args.indexOf("--output-last-message") + 1];
          fs.writeFileSync(lastMessagePath, '{"ok":false,"error":"generated image was saved to a different path"}');
          child.emit("close", 0);
        }, 0);
      });
      return child;
    });

    const result = await runCodexImageGeneration({
      request: { kind: "text_to_image", prompt: "coffee cup" },
      timeoutMs: 5_000,
    });
    tempDirs.push(result.tempDir);

    expect(result.outputPath).toContain("result-recovered.png");
    expect(fs.readFileSync(result.outputPath)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(fs.existsSync(isolatedHome)).toBe(false);
  });

  it("reports the real network failure instead of recovering a 100x100 cache thumbnail", async () => {
    probeMediaMetadataMock.mockResolvedValue({ width: 100, height: 100 });
    spawnMock.mockImplementation((_bin: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin.end.mockImplementation(() => {
        setTimeout(() => {
          const isolatedHome = String(options.env?.CODEX_HOME || "");
          const generatedDir = path.join(isolatedHome, "generated_images");
          fs.mkdirSync(generatedDir, { recursive: true });
          fs.writeFileSync(path.join(generatedDir, "thumbnail.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          const lastMessagePath = args[args.indexOf("--output-last-message") + 1];
          fs.writeFileSync(lastMessagePath, '{"ok":false,"error":"network error"}');
          child.stdout.emit("data", '{"type":"item.completed","item":{"type":"agent_message","text":"network error"}}\n');
          child.stderr.emit("data", "image generation failed: network error: error sending request\n");
          child.emit("close", 0);
        }, 0);
      });
      return child;
    });

    try {
      await runCodexImageGeneration({
        request: { kind: "text_to_image", prompt: "coffee cup" },
        timeoutMs: 5_000,
      });
      throw new Error("expected network failure");
    } catch (error) {
      const normalized = rememberDiagnosticDir(error);
      expect(normalized.message).toContain("网络请求失败");
      expect(matchNomiErrorCode(normalized.message)).toBe("codex-network");
      expect(normalized.message).toContain("没有自动重试");
      expect(normalized.message).not.toContain("100×100");
    }
    expect(probeMediaMetadataMock).not.toHaveBeenCalled();
  });

  it("does not recover a cache thumbnail after image generation reports a timeout", async () => {
    probeMediaMetadataMock.mockResolvedValue({ width: 100, height: 100 });
    spawnMock.mockImplementation((_bin: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin.end.mockImplementation(() => {
        setTimeout(() => {
          const isolatedHome = String(options.env?.CODEX_HOME || "");
          const generatedDir = path.join(isolatedHome, "generated_images");
          fs.mkdirSync(generatedDir, { recursive: true });
          fs.writeFileSync(path.join(generatedDir, "thumbnail.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          const lastMessagePath = args[args.indexOf("--output-last-message") + 1];
          fs.writeFileSync(lastMessagePath, '{"ok":false,"error":"image generation timed out"}');
          child.emit("close", 0);
        }, 0);
      });
      return child;
    });

    try {
      await runCodexImageGeneration({
        request: { kind: "text_to_image", prompt: "coffee cup" },
        timeoutMs: 5_000,
      });
      throw new Error("expected timeout failure");
    } catch (error) {
      const normalized = rememberDiagnosticDir(error);
      expect(normalized.message).toContain("image generation timed out");
      expect(normalized.message).not.toContain("100×100");
    }
    expect(probeMediaMetadataMock).not.toHaveBeenCalled();
  });

  it("skips a newer cache thumbnail and recovers the newest decodable full-size image", async () => {
    probeMediaMetadataMock.mockImplementation(async (candidatePath: string) =>
      candidatePath.endsWith("thumbnail.png")
        ? { width: 100, height: 100 }
        : { width: 1024, height: 1024 },
    );
    const fullImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    spawnMock.mockImplementation((_bin: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin.end.mockImplementation(() => {
        setTimeout(() => {
          const isolatedHome = String(options.env?.CODEX_HOME || "");
          const generatedDir = path.join(isolatedHome, "generated_images");
          fs.mkdirSync(generatedDir, { recursive: true });
          const fullPath = path.join(generatedDir, "full.png");
          const thumbnailPath = path.join(generatedDir, "thumbnail.png");
          fs.writeFileSync(fullPath, fullImage);
          fs.writeFileSync(thumbnailPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          const now = new Date();
          fs.utimesSync(fullPath, new Date(now.getTime() - 1_000), new Date(now.getTime() - 1_000));
          fs.utimesSync(thumbnailPath, now, now);
          const lastMessagePath = args[args.indexOf("--output-last-message") + 1];
          fs.writeFileSync(lastMessagePath, '{"ok":false,"error":"generated image was saved to a different path"}');
          child.emit("close", 0);
        }, 0);
      });
      return child;
    });

    const result = await runCodexImageGeneration({
      request: { kind: "text_to_image", prompt: "coffee cup" },
      timeoutMs: 5_000,
    });
    tempDirs.push(result.tempDir);

    expect(result.outputPath).toContain("result-recovered.png");
    expect(fs.readFileSync(result.outputPath)).toEqual(fullImage);
    expect(probeMediaMetadataMock).toHaveBeenCalledTimes(2);
  });

  it("isolates Codex from user skills and removes the temporary home after exit", async () => {
    mockCodexExecSuccess();
    const sourceHome = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "nomi-codex-source-home-"));
    tempDirs.push(sourceHome);
    fs.writeFileSync(path.join(sourceHome, "auth.json"), "{}", { mode: 0o600 });
    fs.writeFileSync(path.join(sourceHome, "models_cache.json"), "{}");
    fs.mkdirSync(path.join(sourceHome, "skills"));
    const previousHome = process.env.CODEX_HOME;
    const previousModel = process.env.NOMI_CODEX_IMG2_MODEL;
    process.env.CODEX_HOME = sourceHome;
    process.env.NOMI_CODEX_IMG2_MODEL = "test-imagegen-model";

    try {
      const result = await runCodexImageGeneration({
        request: { kind: "text_to_image", prompt: "isolated" },
        timeoutMs: 5_000,
      });
      tempDirs.push(result.tempDir);
    } finally {
      if (previousHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousHome;
      if (previousModel === undefined) delete process.env.NOMI_CODEX_IMG2_MODEL;
      else process.env.NOMI_CODEX_IMG2_MODEL = previousModel;
    }

    const args = spawnMock.mock.calls[0]?.[1] as string[];
    const options = spawnMock.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
    const isolatedHome = String(options.env?.CODEX_HOME || "");
    expect(isolatedHome).not.toBe(sourceHome);
    expect(isolatedHome).toContain("nomi-codex-home-");
    expect(fs.existsSync(isolatedHome)).toBe(false);
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual([
      "--model",
      "test-imagegen-model",
    ]);
  });

  it("creates a minimal Codex home without copying user skills or auth contents", () => {
    const sourceHome = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "nomi-codex-source-home-"));
    const tempRoot = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "nomi-codex-home-root-"));
    tempDirs.push(sourceHome, tempRoot);
    const authPath = path.join(sourceHome, "auth.json");
    fs.writeFileSync(authPath, "secret-placeholder", { mode: 0o600 });
    fs.mkdirSync(path.join(sourceHome, "skills"));

    const isolated = prepareIsolatedCodexHome({ sourceHome, tempRoot });

    expect(isolated).not.toBeNull();
    if (!isolated) return;
    expect(fs.realpathSync(path.join(isolated.path, "auth.json"))).toBe(fs.realpathSync(authPath));
    expect(fs.existsSync(path.join(isolated.path, "skills"))).toBe(false);
    isolated.cleanup();
    expect(fs.existsSync(isolated.path)).toBe(false);
  });

  it("fails before spawning when the local Codex login is unavailable", async () => {
    const sourceHome = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "nomi-codex-no-auth-"));
    tempDirs.push(sourceHome);
    const previousHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = sourceHome;

    try {
      await expect(
        runCodexImageGeneration({
          request: { kind: "text_to_image", prompt: "coffee cup" },
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow(/未检测到 ChatGPT\/Codex 登录状态/);
    } finally {
      if (previousHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousHome;
    }

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("persists Codex stdout and stderr diagnostics when exec exits non-zero", async () => {
    mockCodexExecFailure();

    let message = "";
    try {
      await runCodexImageGeneration({
        request: { kind: "text_to_image", prompt: "coffee cup" },
        timeoutMs: 5_000,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("codex exec 退出码 1");
    const tempDir = message.match(/诊断目录：([^\n]+)/)?.[1];
    expect(tempDir).toBeTruthy();
    if (!tempDir) throw new Error("missing diagnostic temp dir");
    tempDirs.push(tempDir);
    expect(message).toContain(path.join(tempDir, "codex-stderr.txt"));
    expect(message).toContain(path.join(tempDir, "codex-stdout.jsonl"));
    expect(fs.readFileSync(path.join(tempDir, "codex-stderr.txt"), "utf8")).toContain("imagegen tool failed");
    expect(fs.readFileSync(path.join(tempDir, "codex-stdout.jsonl"), "utf8")).toContain("thread-fail");
  });

  it("does not retry a network transport failure unless the caller explicitly opts in", async () => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin.end.mockImplementation(() => {
        setTimeout(() => {
          child.stderr.emit(
            "data",
            "network error: error sending request for url https://chatgpt.com/backend-api/codex/images/edits\n",
          );
          child.emit("close", 1);
        }, 0);
      });
      return child;
    });

    const error = await expectRunFailure(runCodexImageGeneration({
      request: { kind: "text_to_image", prompt: "coffee cup" },
      timeoutMs: 5_000,
      networkRetryDelayMs: 0,
    }));

    expect(error.message).toContain("codex exec 退出码 1");
    expect(matchNomiErrorCode(error.message)).toBe("codex-network");
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it("retries one explicit network transport failure when the caller opts in", async () => {
    let attempt = 0;
    spawnMock.mockImplementation((_bin: string, args: string[]) => {
      attempt += 1;
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin.end.mockImplementation((promptInput: string) => {
        setTimeout(() => {
          if (attempt === 1) {
            child.stderr.emit(
              "data",
              "network error: error sending request for url https://chatgpt.com/backend-api/codex/images/edits\n",
            );
            child.emit("close", 1);
            return;
          }
          const outputPath = String(promptInput).match(/"path":"([^"]+)"/)?.[1] || "";
          const lastMessagePath = args[args.indexOf("--output-last-message") + 1];
          fs.writeFileSync(outputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          fs.writeFileSync(lastMessagePath, `{"ok":true,"path":"${outputPath}"}`);
          child.stdout.emit("data", '{"type":"thread.started","thread_id":"thread-retry"}\n');
          child.emit("close", 0);
        }, 0);
      });
      return child;
    });

    const result = await runCodexImageGeneration({
      request: { kind: "text_to_image", prompt: "coffee cup" },
      timeoutMs: 5_000,
      maxNetworkAttempts: 2,
      networkRetryDelayMs: 0,
    });
    tempDirs.push(result.tempDir);

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(result.timings.attemptCount).toBe(2);
    expect(fs.readFileSync(path.join(result.tempDir, "codex-stderr.txt"), "utf8")).toContain("attempt 2");
  });

  it("retries a structured imagegen network failure when explicitly enabled", async () => {
    let attempt = 0;
    spawnMock.mockImplementation((_bin: string, args: string[]) => {
      attempt += 1;
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin.end.mockImplementation((promptInput: string) => {
        setTimeout(() => {
          const outputPath = String(promptInput).match(/"path":"([^"]+)"/)?.[1] || "";
          const lastMessagePath = args[args.indexOf("--output-last-message") + 1];
          if (attempt === 1) {
            fs.writeFileSync(lastMessagePath, '{"ok":false,"error":"image generation failed: network error"}');
            child.stdout.emit(
              "data",
              '{"type":"item.completed","item":{"type":"agent_message","text":"image generation failed: network error"}}\n',
            );
            child.emit("close", 0);
            return;
          }
          fs.writeFileSync(outputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          fs.writeFileSync(lastMessagePath, `{"ok":true,"path":"${outputPath}"}`);
          child.emit("close", 0);
        }, 0);
      });
      return child;
    });

    const result = await runCodexImageGeneration({
      request: { kind: "text_to_image", prompt: "coffee cup" },
      timeoutMs: 5_000,
      maxNetworkAttempts: 2,
      networkRetryDelayMs: 0,
    });
    tempDirs.push(result.tempDir);

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(result.timings.attemptCount).toBe(2);
    expect(fs.readFileSync(path.join(result.tempDir, "codex-stdout.jsonl"), "utf8")).toContain("attempt 2");
  });

  it.each(["zh-CN", "en"] as const)("terminates an idle child with stable timeout identity: %s", async (locale) => {
    setDesktopLocale(locale);
    const childRef: { current?: EventEmitter & { kill: ReturnType<typeof vi.fn> } } = {};
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn((signal: NodeJS.Signals) => {
        if (signal === "SIGTERM") setTimeout(() => child.emit("close", null), 0);
        return true;
      });
      childRef.current = child;
      return child;
    });

    const error = await expectRunFailure(runCodexImageGeneration({
      request: { kind: "text_to_image", prompt: "idle" },
      timeoutMs: 5_000,
      idleTimeoutMs: 10,
      terminationGraceMs: 10,
      maxNetworkAttempts: 1,
    }));

    expect(error.message).toMatch(locale === "zh-CN" ? /长时间无进展/ : /no progress/);
    expect(matchNomiErrorCode(error.message)).toBe("codex-timeout");
    expect(childRef.current?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("cancels the Codex child that belongs to a node run", async () => {
    const childRef: { current?: EventEmitter & { kill: ReturnType<typeof vi.fn> } } = {};
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn((signal: NodeJS.Signals) => {
        if (signal === "SIGTERM") setTimeout(() => child.emit("close", null), 0);
        return true;
      });
      childRef.current = child;
      return child;
    });

    const running = runCodexImageGeneration({
      request: {
        kind: "text_to_image",
        prompt: "cancel me",
        extras: { idempotencyKey: "run-cancel-1" },
      },
      timeoutMs: 5_000,
      maxNetworkAttempts: 1,
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));

    expect(cancelCodexImageGeneration("run-cancel-1")).toBe(true);
    const error = await expectRunFailure(running);
    expect(error.message).toMatch(/取消/);
    expect(childRef.current?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("globally serializes separate Codex Img2 child processes", async () => {
    const releases: Array<() => void> = [];
    spawnMock.mockImplementation((_bin: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.stdin.end.mockImplementation((promptInput: string) => {
        releases.push(() => {
          const outputPath = String(promptInput).match(/"path":"([^"]+)"/)?.[1] || "";
          const lastMessagePath = args[args.indexOf("--output-last-message") + 1];
          fs.writeFileSync(outputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          fs.writeFileSync(lastMessagePath, `{"ok":true,"path":"${outputPath}"}`);
          child.emit("close", 0);
        });
      });
      return child;
    });

    const runs = ["a", "b", "c"].map((prompt) =>
      runCodexImageGeneration({
        request: { kind: "text_to_image", prompt },
        timeoutMs: 5_000,
      }),
    );

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(3));
    releases.shift()?.();
    const results = await Promise.all(runs);
    results.forEach((result) => tempDirs.push(result.tempDir));
    expect(results[2]?.timings.queueMs).toBeGreaterThanOrEqual(0);
  });

  it("escalates an unresponsive timed-out child from SIGTERM to SIGKILL", async () => {
    const childRef: { current?: EventEmitter & { kill: ReturnType<typeof vi.fn> } } = {};
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn((signal: NodeJS.Signals) => {
        if (signal === "SIGKILL") setTimeout(() => child.emit("close", null), 0);
        return true;
      });
      childRef.current = child;
      return child;
    });

    const error = await expectRunFailure(runCodexImageGeneration({
      request: { kind: "text_to_image", prompt: "timeout" },
      timeoutMs: 10,
      terminationGraceMs: 10,
    }));

    expect(error.message).toMatch(/生成超时/);
    expect(matchNomiErrorCode(error.message)).toBe("codex-timeout");
    expect(childRef.current?.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(childRef.current?.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("removes only stale Codex Img2 diagnostic directories", () => {
    const rootDir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "nomi-codex-cleanup-test-"));
    tempDirs.push(rootDir);
    const oldDir = path.join(rootDir, "nomi-codex-img2-old");
    const freshDir = path.join(rootDir, "nomi-codex-img2-fresh");
    const unrelatedDir = path.join(rootDir, "keep-me");
    [oldDir, freshDir, unrelatedDir].forEach((dir) => fs.mkdirSync(dir));
    const now = Date.now();
    fs.utimesSync(oldDir, new Date(now - 25 * 60 * 60_000), new Date(now - 25 * 60 * 60_000));

    const removed = cleanupStaleCodexImagegenTempDirs({ rootDir, now, maxAgeMs: 24 * 60 * 60_000 });

    expect(removed).toBe(1);
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.existsSync(freshDir)).toBe(true);
    expect(fs.existsSync(unrelatedDir)).toBe(true);
  });
});
