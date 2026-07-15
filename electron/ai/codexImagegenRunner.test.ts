import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import {
  buildCodexImagegenPrompt,
  cleanupStaleCodexImagegenTempDirs,
  collectCodexReferenceUrls,
  cancelCodexImageGeneration,
  runCodexImageGeneration,
} from "./codexImagegenRunner";
import { rememberProxyStateForTests, resetProxyStateForTests } from "../systemProxy";

const tempDirs: string[] = [];

beforeEach(() => {
  spawnMock.mockReset();
  resetProxyStateForTests();
});

afterEach(() => {
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

    expect(prompt).toContain("Use built-in imagegen only");
    expect(prompt).toContain("Do not use the OpenAI API fallback");
    expect(prompt).toContain("Do not inspect project files, memory, profiles, or other skills");
    expect(prompt).toContain("Task: text-to-image generation.");
    expect(prompt).toContain("No reference images.");
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
    expect(args).not.toContain("coffee cup");
    expect(child.stdin.end).toHaveBeenCalledWith(expect.stringContaining("Prompt: coffee cup"));
    expect(options.cwd).toBe(result.timings.cwd);
    expect(options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(options.env?.HTTPS_PROXY).toBe("http://127.0.0.1:7897");
    expect(options.env?.HTTP_PROXY).toBe("http://127.0.0.1:7897");
    expect(options.env?.NO_PROXY).toContain("127.0.0.1");
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

  it("retries one explicit network transport failure inside the same generation invocation", async () => {
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
      networkRetryDelayMs: 0,
    });
    tempDirs.push(result.tempDir);

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(result.timings.attemptCount).toBe(2);
    expect(fs.readFileSync(path.join(result.tempDir, "codex-stderr.txt"), "utf8")).toContain("attempt 2");
  });

  it("terminates a child that produces no output before the hard timeout", async () => {
    let childRef: (EventEmitter & { kill: ReturnType<typeof vi.fn> }) | null = null;
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
      childRef = child;
      return child;
    });

    await expect(
      runCodexImageGeneration({
        request: { kind: "text_to_image", prompt: "idle" },
        timeoutMs: 5_000,
        idleTimeoutMs: 10,
        terminationGraceMs: 10,
        maxNetworkAttempts: 1,
      }),
    ).rejects.toThrow(/长时间无进展/);

    expect(childRef?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("cancels the Codex child that belongs to a node run", async () => {
    let childRef: (EventEmitter & { kill: ReturnType<typeof vi.fn> }) | null = null;
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
      childRef = child;
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
    await expect(running).rejects.toThrow(/取消/);
    expect(childRef?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("globally limits separate Codex Img2 runs to two active child processes", async () => {
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

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(3));
    releases.splice(0).forEach((release) => release());
    const results = await Promise.all(runs);
    results.forEach((result) => tempDirs.push(result.tempDir));
    expect(results[2]?.timings.queueMs).toBeGreaterThanOrEqual(0);
  });

  it("escalates an unresponsive timed-out child from SIGTERM to SIGKILL", async () => {
    let childRef: (EventEmitter & { kill: ReturnType<typeof vi.fn> }) | null = null;
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
      childRef = child;
      return child;
    });

    await expect(
      runCodexImageGeneration({
        request: { kind: "text_to_image", prompt: "timeout" },
        timeoutMs: 10,
        terminationGraceMs: 10,
      }),
    ).rejects.toThrow(/生成超时/);

    expect(childRef?.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(childRef?.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
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
