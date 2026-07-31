import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(repoRoot, "tests/ux/fixtures/perf-heavy.project.json");
const imageFixturePath = path.join(repoRoot, "src/workbench/onboarding/assets/robot/shot-2.jpg");
const videoFixturePath = path.join(repoRoot, "marketing/assets/demo.mp4");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-creative-perf-"));
const projectsDir = path.join(tempRoot, "projects");
const fixtureRoot = path.join(projectsDir, "ZZ-perf-fixture-project-perf-fixture-0001");
const reportPath = path.resolve(
  process.env.NOMI_CREATIVE_PERF_EVIDENCE_DIR?.trim()
    || path.join(repoRoot, "evals/runs/creative-capability-perf"),
  "report.json",
);

function collectLocalAssetUrls(value, urls = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("nomi-local://asset/")) urls.add(value);
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLocalAssetUrls(item, urls);
    return urls;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectLocalAssetUrls(item, urls);
  }
  return urls;
}

function rewriteLocalAssetProject(value, projectId) {
  if (typeof value === "string" && value.startsWith("nomi-local://asset/")) {
    const rest = value.slice("nomi-local://asset/".length);
    const slashIndex = rest.indexOf("/");
    return slashIndex >= 0
      ? `nomi-local://asset/${encodeURIComponent(projectId)}/${rest.slice(slashIndex + 1)}`
      : value;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteLocalAssetProject(item, projectId));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteLocalAssetProject(item, projectId)]),
    );
  }
  return value;
}

function relativePathFromLocalAssetUrl(url) {
  const rest = url.slice("nomi-local://asset/".length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex < 0) throw new Error(`Invalid local asset URL: ${url}`);
  return rest
    .slice(slashIndex + 1)
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

function materializeFixture() {
  const source = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const fixtureNodeCount = source.payload?.generationCanvas?.nodes?.length;
  if (!Number.isFinite(fixtureNodeCount)) throw new Error("Performance fixture node count is unavailable");
  const localAssetUrls = collectLocalAssetUrls(source);
  const record = rewriteLocalAssetProject(source, source.id);
  record.lastKnownRootPath = fixtureRoot;

  fs.mkdirSync(path.join(fixtureRoot, ".nomi"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "exports"), { recursive: true });
  for (const url of localAssetUrls) {
    const relativePath = relativePathFromLocalAssetUrl(url);
    const destination = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const sourcePath = /\.(mp4|mov|webm)$/i.test(relativePath) ? videoFixturePath : imageFixturePath;
    try {
      fs.linkSync(sourcePath, destination);
    } catch {
      fs.copyFileSync(sourcePath, destination);
    }
  }
  fs.writeFileSync(
    path.join(fixtureRoot, ".nomi", "project.json"),
    JSON.stringify(record, null, 1),
    "utf8",
  );
  return fixtureNodeCount;
}

function runPerfHarness(fixtureNodeCount) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/ux/perf.e2e.mjs", "creative-gate8"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NOMI_E2E: "1",
        NOMI_E2E_ALLOW_MULTI_INSTANCE: "1",
        NOMI_SOURCE_RUN: "1",
        NOMI_PERF_USER_DATA: path.join(tempRoot, "user-data"),
        NOMI_PROJECTS_DIR: projectsDir,
        NOMI_SETTINGS_DIR: path.join(tempRoot, "settings"),
        NOMI_PERF_OUTPUT_PATH: reportPath,
        NOMI_PERF_FIXTURE_NODE_COUNT: String(fixtureNodeCount),
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Creative performance harness failed: code=${String(code)} signal=${signal || "none"}`));
    });
  });
}

try {
  const fixtureNodeCount = materializeFixture();
  await runPerfHarness(fixtureNodeCount);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.error) throw new Error(report.error);
  if (report.fixtureNodeCount !== 96) {
    throw new Error(`Expected a 96-node performance fixture, received ${String(report.fixtureNodeCount)}`);
  }
  if (
    typeof report.visibleNodes !== "number"
    || report.visibleNodes <= 0
    || report.visibleNodes > report.totalCanvasNodes
  ) {
    throw new Error(`Invalid mounted performance-node count: ${String(report.visibleNodes)}`);
  }
  for (const scenario of ["canvas-pan", "canvas-zoom"]) {
    const metrics = report.scenarios?.[scenario];
    if (!metrics || typeof metrics.fps !== "number" || typeof metrics.maxFrameGapMs !== "number") {
      throw new Error(`Missing performance metrics for ${scenario}`);
    }
  }
  if (
    report.panPreflight?.denseEdges === "true"
    && (
      report.panPreflight?.viewportMoving !== "true"
      || report.panPreflight?.edgeVisibility !== "hidden"
    )
  ) {
    throw new Error(`Dense edge layer was not deferred during pan: ${JSON.stringify(report.panPreflight)}`);
  }
  if (report.viewportBefore?.viewportMoving || report.viewportBefore?.edgeVisibility === "hidden") {
    throw new Error(`Edge layer did not recover after pan: ${JSON.stringify(report.viewportBefore)}`);
  }
  const thresholds = {
    "canvas-pan": { minFps: 50, maxFrameGapMs: 200, maxLongTaskMs: 500 },
    "canvas-zoom": { minFps: 50, maxFrameGapMs: 100, maxLongTaskMs: 250 },
    "timeline-play": { minFps: 50, maxFrameGapMs: 100, maxLongTaskMs: 250 },
  };
  const failures = [];
  for (const [scenario, threshold] of Object.entries(thresholds)) {
    const metrics = report.scenarios?.[scenario];
    if (!metrics || metrics.skipped) {
      failures.push(`${scenario}: missing metrics`);
      continue;
    }
    if (metrics.fps < threshold.minFps) failures.push(`${scenario}: fps ${metrics.fps} < ${threshold.minFps}`);
    if (metrics.maxFrameGapMs > threshold.maxFrameGapMs) {
      failures.push(`${scenario}: max frame gap ${metrics.maxFrameGapMs}ms > ${threshold.maxFrameGapMs}ms`);
    }
    if (metrics.longTaskMs > threshold.maxLongTaskMs) {
      failures.push(`${scenario}: long tasks ${metrics.longTaskMs}ms > ${threshold.maxLongTaskMs}ms`);
    }
  }
  report.acceptance = {
    passed: failures.length === 0,
    thresholds,
    failures,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (failures.length > 0) throw new Error(`Creative performance acceptance failed: ${failures.join("; ")}`);
  console.log(`Creative capability performance evidence: ${reportPath}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
