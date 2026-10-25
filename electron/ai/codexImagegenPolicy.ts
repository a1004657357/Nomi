import { desktopT } from "../desktopStrings";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { firstString, trim, type JsonRecord } from "../jsonUtils";
import { runTechnicalCheck, type TechnicalCheckVerdict } from "../review/technicalCheck";
import { resolveFfmpegPath } from "../export/ffmpegRunner";

export type CodexImagegenRequest = {
  prompt: string;
  kind: string;
  extras?: Record<string, unknown> | null;
};

export type CodexImagegenPromptReference = {
  path: string;
  role?: string;
  purpose?: string;
};

function describeAspectRatio(value: string): string {
  if (!value || value === "auto") return "auto";
  return value;
}

type CanvasOrientation = "auto" | "square" | "portrait" | "landscape";

function canvasOrientation(aspectRatio: string): CanvasOrientation {
  const match = aspectRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return "auto";
  const ratio = Number(match[1]) / Number(match[2]);
  if (!Number.isFinite(ratio) || ratio <= 0) return "auto";
  if (Math.abs(ratio - 1) < 0.01) return "square";
  return ratio < 1 ? "portrait" : "landscape";
}

function alignPromptLayoutToAspectRatio(prompt: string, orientation: CanvasOrientation): string {
  if (orientation === "portrait") {
    return prompt
      .replace(/横向版面/g, "竖向版面")
      .replace(/横版画布/g, "竖版画布")
      .replace(/landscape (?:canvas|layout|orientation)/gi, "portrait canvas");
  }
  if (orientation === "landscape") {
    return prompt
      .replace(/竖向版面/g, "横向版面")
      .replace(/竖版画布/g, "横版画布")
      .replace(/portrait (?:canvas|layout|orientation)/gi, "landscape canvas");
  }
  return prompt;
}

function outputCanvasContract(aspectRatio: string, orientation: CanvasOrientation, referenceSheet: boolean): string[] {
  if (aspectRatio === "auto" || orientation === "auto") return [];
  const orientationDetail =
    orientation === "portrait"
      ? "height greater than width"
      : orientation === "landscape"
        ? "width greater than height"
        : "width equal to height";
  const forbidden =
    orientation === "portrait"
      ? "Do not output landscape, square, or 3:2."
      : orientation === "landscape"
        ? "Do not output portrait or square."
        : "Do not output portrait or landscape.";
  return [
    `HIGHEST-PRIORITY OUTPUT CANVAS CONTRACT: the final raster file must use an exact ${aspectRatio} ${orientation} canvas (width:height = ${aspectRatio}; ${orientationDetail}).`,
    `This contract overrides conflicting layout or orientation words in the user prompt. ${forbidden}`,
    "Repeat this exact canvas requirement inside the image_gen.imagegen prompt.",
    ...(referenceSheet && orientation === "portrait"
      ? ["For a reference sheet, reflow and stack panels vertically; never widen the output canvas."]
      : []),
  ];
}

export type CodexAspectRatioCropPlan = {
  width: number;
  height: number;
  x: number;
  y: number;
  retainedAreaRatio: number;
};

export function planCodexAspectRatioCrop(
  sourceWidth: number,
  sourceHeight: number,
  expectedAspectRatio: string,
  minimumRetainedAreaRatio = 0.75,
): CodexAspectRatioCropPlan | null {
  const match = expectedAspectRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const expectedRatio = Number(match[1]) / Number(match[2]);
  const actualRatio = sourceWidth / sourceHeight;
  if (!Number.isFinite(expectedRatio) || expectedRatio <= 0) return null;
  const expectedOrientation = expectedRatio < 0.99 ? "portrait" : expectedRatio > 1.01 ? "landscape" : "square";
  const actualOrientation = actualRatio < 0.99 ? "portrait" : actualRatio > 1.01 ? "landscape" : "square";
  if (expectedOrientation !== actualOrientation) return null;

  const width = actualRatio > expectedRatio ? Math.floor(sourceHeight * expectedRatio) : sourceWidth;
  const height = actualRatio > expectedRatio ? sourceHeight : Math.floor(sourceWidth / expectedRatio);
  const retainedAreaRatio = (width * height) / (sourceWidth * sourceHeight);
  if (retainedAreaRatio < minimumRetainedAreaRatio) return null;
  return {
    width,
    height,
    x: Math.floor((sourceWidth - width) / 2),
    y: Math.floor((sourceHeight - height) / 2),
    retainedAreaRatio,
  };
}

async function conformCodexImageAspectRatio(outputPath: string, plan: CodexAspectRatioCropPlan): Promise<void> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new Error(desktopT("custom.ai.codexImagegenPolicy.text1"));
  const parsed = path.parse(outputPath);
  const conformedPath = path.join(parsed.dir, `${parsed.name}-conformed${parsed.ext || ".png"}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        outputPath,
        "-vf",
        `crop=${plan.width}:${plan.height}:${plan.x}:${plan.y}`,
        "-frames:v",
        "1",
        conformedPath,
      ],
      { windowsHide: true },
    );
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(desktopT("custom.ai.codexImagegenPolicy.text2")));
    }, 30_000);
    timeout.unref?.();
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(conformedPath)) finish();
      else finish(new Error(desktopT("custom.ai.codexImagegenPolicy.text3", { value0: `${code ?? "unknown"}`, value1: `${stderr.slice(-500)}` })));
    });
  });
  const originalPath = path.join(parsed.dir, `${parsed.name}-original${parsed.ext || ".png"}`);
  fs.copyFileSync(outputPath, originalPath);
  fs.rmSync(outputPath, { force: true });
  fs.renameSync(conformedPath, outputPath);
}

export function buildCodexImagegenPrompt(
  request: CodexImagegenRequest,
  outputPath: string,
  referenceInput: number | readonly CodexImagegenPromptReference[],
): string {
  const extras = request.extras || {};
  const archetypeInput = (
    extras.archetypeInput && typeof extras.archetypeInput === "object" ? extras.archetypeInput : {}
  ) as JsonRecord;
  const aspectRatio = describeAspectRatio(firstString(archetypeInput.aspect_ratio, extras.aspect_ratio, "auto"));
  const resolution = firstString(archetypeInput.resolution, extras.resolution, "1K");
  const orientation = canvasOrientation(aspectRatio);
  const prompt = alignPromptLayoutToAspectRatio(request.prompt, orientation);
  const references = typeof referenceInput === "number" ? [] : referenceInput;
  const referenceCount = typeof referenceInput === "number" ? referenceInput : references.length;
  const mode =
    request.kind === "image_edit" || referenceCount > 0
      ? "edit/reference image generation"
      : "text-to-image generation";
  const referenceBindings = references.flatMap((reference, index) => {
    const role = trim(reference.role).replace(/\s+/g, " ");
    const purpose = trim(reference.purpose).replace(/\s+/g, " ");
    return [
      `Reference ${index + 1}: ${reference.path}`,
      `Role: ${role || "general visual reference"}`,
      `Purpose: ${purpose || "use only for the visual constraints stated in the user prompt"}`,
    ];
  });
  return [
    ...outputCanvasContract(aspectRatio, orientation, extras.referenceSheet === true),
    "Use the built-in image_gen.imagegen tool only. Do not use the OpenAI API fallback.",
    "Invoke image_gen.imagegen exactly once. If that call fails, times out, or reports a network/service error, do not retry; return the failure immediately.",
    "Do not inspect project files, memory, profiles, or other skills. Do not read AGENTS files. Invoke image_gen.imagegen immediately.",
    `Task: ${mode}.`,
    referenceCount > 0
      ? `Use ${referenceCount} attached image file(s) as references/edit targets. Pass every attached local path through referenced_image_paths; do not use num_last_images_to_include.`
      : "No reference images. This is a brand-new image: omit both referenced_image_paths and num_last_images_to_include entirely. Never pass either field as 0, null, or an empty array.",
    ...(referenceBindings.length
      ? ["Bind the attached images to these exact roles in attachment order:", ...referenceBindings]
      : []),
    `Prompt: ${prompt}`,
    `Aspect ratio: ${aspectRatio}. Resolution: ${resolution}.`,
    "No watermark. Do not add text unless explicitly requested.",
    `Save/copy the final raster image to: ${outputPath}`,
    `Reply JSON only: {"ok":true,"path":"${outputPath}"} or {"ok":false,"error":"short reason"}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type ImagegenInvocationAudit = {
  count: number;
  status: "verified" | "unobservable";
  retryDetected: boolean;
};

export function auditCodexImagegenInvocations(stdout: string, stderr: string): ImagegenInvocationAudit {
  const callIds = new Set<string>();
  let anonymousCalls = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: unknown;
        item?: {
          id?: unknown;
          type?: unknown;
          name?: unknown;
          tool?: unknown;
          tool_name?: unknown;
          function?: { name?: unknown };
        };
      };
      const item = event.item;
      if (!item) continue;
      const toolName = firstString(item.name, item.tool, item.tool_name, item.function?.name).toLowerCase();
      if (!/(^|[./])image_gen(?:[./]imagegen)?$/.test(toolName)) continue;
      const callId = trim(item.id);
      if (callId) callIds.add(callId);
      else if (/started|created|requested|tool_call/i.test(firstString(event.type, item.type))) anonymousCalls += 1;
    } catch {
      // Codex may mix progress text into JSONL; only structured tool events count.
    }
  }
  const detail = `${stdout}\n${stderr}`;
  const retryDetected =
    /(?:image_gen|imagegen|image generation)[\s\S]{0,100}(?:retry|retrying|attempt\s*[2-9])/i.test(detail) ||
    /(?:retry|retrying|attempt\s*[2-9])[\s\S]{0,100}(?:image_gen|imagegen|image generation)/i.test(detail);
  const count = callIds.size + anonymousCalls;
  return { count, status: count > 0 ? "verified" : "unobservable", retryDetected };
}

export async function validateCodexGeneratedImage(
  outputPath: string,
  request: CodexImagegenRequest,
  reviewImage: typeof runTechnicalCheck = runTechnicalCheck,
  conformImage: typeof conformCodexImageAspectRatio = conformCodexImageAspectRatio,
): Promise<TechnicalCheckVerdict> {
  const extras = request.extras || {};
  const archetypeInput = (
    extras.archetypeInput && typeof extras.archetypeInput === "object" ? extras.archetypeInput : {}
  ) as JsonRecord;
  const expectedAspectRatio = firstString(archetypeInput.aspect_ratio, extras.aspect_ratio, extras.aspectRatio);
  const verdict = await reviewImage(outputPath, "image", {
    ...(expectedAspectRatio && expectedAspectRatio !== "auto" ? { expectedAspectRatio } : {}),
  });
  // Ratio is only a soft prompt constraint for the built-in Codex imagegen
  // tool. Keep a valid generated image and let the normal technical-review
  // badge report the mismatch instead of discarding an already paid result.
  const blockingChecks = verdict.checks.filter((check) => check.suspect && check.id === "undecodable");
  if (blockingChecks.length > 0) {
    throw new Error(desktopT("custom.ai.codexImagegenPolicy.text4", { value0: `${blockingChecks.map((check) => check.detail).join("；")}` }));
  }
  const aspectCheck = verdict.checks.find((check) => check.suspect && check.id === "aspect-ratio");
  const width = verdict.metadata?.width ?? aspectCheck?.metrics?.width ?? 0;
  const height = verdict.metadata?.height ?? aspectCheck?.metrics?.height ?? 0;
  const cropPlan = aspectCheck ? planCodexAspectRatioCrop(width, height, expectedAspectRatio) : null;
  if (cropPlan) {
    try {
      await conformImage(outputPath, cropPlan);
      return await reviewImage(outputPath, "image", { expectedAspectRatio });
    } catch {
      // Keep the original image and its review warning; never trigger another
      // paid generation because a local normalization step failed.
    }
  }
  return verdict;
}
