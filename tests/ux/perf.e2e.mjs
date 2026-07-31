// 性能基准 harness（卡顿专项 before/after 工具）。
//
// 在标准重 fixture(96 节点+156 边+20 clip)上跑三场景，用注入探针量 longTasks/maxFrameGap/fps：
//   canvas-pan   画布平移（god-component 每帧重渲的规模卡顿，P0-D）
//   canvas-zoom  画布缩放
//   timeline-play 时间轴播放（playhead 每帧 {...timeline} → TimelinePreview 重渲，P0-B）
//
// 用法（先 pnpm run build；fixture 先 node tests/ux/fixtures/gen-perf-fixture.mjs）：
//   node tests/ux/perf.e2e.mjs <label>     label 默认 "run"，结果写 tests/ux/perf-results/<label>.json
// before/after：改前 `node tests/ux/perf.e2e.mjs baseline`，改后 `... after-A`，diff 两个 JSON。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const label = process.argv[2] || "run";
const resultPath = process.env.NOMI_PERF_OUTPUT_PATH?.trim()
  ? path.resolve(process.env.NOMI_PERF_OUTPUT_PATH)
  : path.join(repoRoot, "tests/ux/perf-results", `${label}.json`);
fs.mkdirSync(path.dirname(resultPath), { recursive: true });

const PROBE = `(() => {
  if (window.__perfProbe) return 'exists';
  window.__perfProbe = {
    start() {
      const r = { t0: performance.now(), frames: 0, last: performance.now(), maxGap: 0, longTasks: 0, longTaskMs: 0, longTaskEntries: [] };
      const loop = () => { const n = performance.now(); const g = n - r.last; if (g > r.maxGap) r.maxGap = g; r.last = n; r.frames++; r.raf = requestAnimationFrame(loop); };
      r.raf = requestAnimationFrame(loop);
      try {
        r.po = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            r.longTasks++;
            r.longTaskMs += e.duration;
            r.longTaskEntries.push({
              atMs: Math.round(e.startTime - r.t0),
              durationMs: Math.round(e.duration),
            });
          }
        });
        r.po.observe({ entryTypes: ['longtask'] });
      } catch (e) {}
      this._r = r; return 'started';
    },
    stop() {
      const r = this._r; if (!r) return null; cancelAnimationFrame(r.raf); if (r.po) r.po.disconnect(); this._r = null;
      const ms = performance.now() - r.t0;
      return {
        elapsedMs: Math.round(ms),
        frames: r.frames,
        fps: Math.round(r.frames / ms * 1000 * 10) / 10,
        longTasks: r.longTasks,
        longTaskMs: Math.round(r.longTaskMs),
        maxFrameGapMs: Math.round(r.maxGap),
        longTaskEntries: r.longTaskEntries,
      };
    },
  };
  return 'installed';
})()`;

// 隔离启动（多会话/多 worktree 并存时避免抢默认 userData 单实例锁）：设 NOMI_PERF_USER_DATA
// + NOMI_PROJECTS_DIR(env 透传)即用独立实例 + 独立项目库。不设则用默认(单会话便利)。
const isoUserData = process.env.NOMI_PERF_USER_DATA;
const launchArgs = isoUserData ? [".", `--user-data-dir=${isoUserData}`] : ["."];
const app = await electron.launch({ executablePath: require("electron"), args: launchArgs, cwd: repoRoot, env: { ...process.env } });
const electronProcess = app.process();
let win = await app.firstWindow();
const live = () => app.windows().filter((w) => !w.isClosed());
const getWin = () => (win && !win.isClosed() ? win : (win = live().find((w) => /studio|library|#\//.test(w.url())) || live().slice(-1)[0] || win));

async function probeStart() { const w = getWin(); await w.evaluate(PROBE); await w.evaluate("window.__perfProbe.start()"); }
async function probeStop() { return getWin().evaluate("window.__perfProbe.stop()"); }
async function sleep(ms) { await getWin().waitForTimeout(ms); }

const declaredFixtureNodeCount = Number(process.env.NOMI_PERF_FIXTURE_NODE_COUNT);
const results = {
  label,
  fixture: "ZZ 性能基准 fixture (96 节点/156 边/20 clip)",
  fixtureNodeCount: Number.isFinite(declaredFixtureNodeCount) ? declaredFixtureNodeCount : null,
  scenarios: {},
};
const log = (...a) => console.log(...a);

try {
  await win.waitForLoadState("domcontentloaded");
  await sleep(2500);

  // 开 fixture 项目
  const card = getWin().locator("[data-project-card]", { hasText: "ZZ 性能基准" }).first();
  if ((await card.count()) === 0) throw new Error("库里找不到 ZZ 性能基准 fixture——先跑 gen-perf-fixture.mjs");
  await card.click();
  await sleep(1200);
  // 卡片可能要点「继续创作」覆盖按钮
  const cont = getWin().locator("[data-project-card]", { hasText: "ZZ 性能基准" }).getByText("继续创作").first();
  if (await cont.count().catch(() => 0)) { await cont.click().catch(() => {}); }
  await sleep(4000);

  const onCanvas = await getWin().evaluate(() => ({
    url: location.hash,
    nodes: document.querySelectorAll(".generation-canvas-v2-node").length,
    onStudio: !document.querySelector("[data-project-card]"),
  }));
  log("opened:", JSON.stringify(onCanvas));
  results.opened = onCanvas;

  // 切到「生成」画布
  await getWin().getByRole("button", { name: "生成", exact: false }).first().click().catch(() => {});
  await sleep(1500);
  // 首次打开可能触发自动适应，也可能恢复历史视口。性能对比必须从同一 100%/原点开始。
  const resetViewButton = getWin().getByRole("button", { name: "重置视图", exact: true }).first();
  if ((await resetViewButton.count()) === 0) throw new Error("未找到重置视图按钮，无法建立稳定性能基线");
  await resetViewButton.click();
  await sleep(300);
  await getWin().mouse.move(640, 420);
  await getWin().mouse.down({ button: "middle" });
  await getWin().mouse.move(600, 400);
  await sleep(80);
  results.panPreflight = await getWin().evaluate(() => ({
    canvasTransform: document.querySelector(".generation-canvas-v2__canvas")?.getAttribute("style") || "",
    panning: document.querySelector(".generation-canvas-v2__stage")?.getAttribute("data-panning") || "",
    viewportMoving: document.querySelector(".generation-canvas-v2__stage")?.getAttribute("data-viewport-moving") || "",
    denseEdges: document.querySelector(".generation-canvas-v2__stage")?.getAttribute("data-dense-edges") || "",
    edgeVisibility: (() => {
      const edgeLayer = document.querySelector(".generation-canvas-v2__edges");
      return edgeLayer ? getComputedStyle(edgeLayer).visibility : "";
    })(),
  }));
  await getWin().mouse.up({ button: "middle" });
  if (!results.panPreflight.panning || /translate\(0px,\s*0px\)/.test(results.panPreflight.canvasTransform)) {
    throw new Error(`中键平移预检失败: ${JSON.stringify(results.panPreflight)}`);
  }
  await resetViewButton.click();
  await sleep(3000);
  const nodeCount = await getWin().evaluate(() => document.querySelectorAll(".generation-canvas-v2-node").length);
  results.visibleNodes = nodeCount;
  log("画布可见节点 DOM:", nodeCount);
  if (process.env.NOMI_PERF_HIDE_MINIMAP === "1") {
    await getWin().getByRole("button", { name: "隐藏小地图", exact: true }).click();
    await sleep(250);
  }
  results.viewportBefore = await getWin().evaluate(() => {
    const canvas = document.querySelector(".generation-canvas-v2__canvas");
    const stage = document.querySelector(".generation-canvas-v2__stage");
    return {
      canvasTransform: canvas instanceof HTMLElement ? canvas.style.transform : "",
      stageWidth: stage instanceof HTMLElement ? stage.clientWidth : 0,
      stageHeight: stage instanceof HTMLElement ? stage.clientHeight : 0,
      minimapVisible: Boolean(document.querySelector(".generation-canvas-v2__minimap")),
      lightweightNodes: document.querySelectorAll('[data-render-mode="lightweight"]').length,
      viewportMoving: document.querySelector(".generation-canvas-v2__stage")?.getAttribute("data-viewport-moving") || "",
      edgeVisibility: (() => {
        const edgeLayer = document.querySelector(".generation-canvas-v2__edges");
        return edgeLayer ? getComputedStyle(edgeLayer).visibility : "";
      })(),
    };
  });
  log("viewport:", JSON.stringify(results.viewportBefore));
  const diagnosticLayer = process.env.NOMI_PERF_DIAGNOSTIC_LAYER?.trim() || "";
  if (diagnosticLayer) {
    const css = diagnosticLayer === "edges"
      ? ".generation-canvas-v2__edges { display: none !important; }"
      : diagnosticLayer === "pan-optimized"
        ? ".generation-canvas-v2__canvas { will-change: transform !important; } .generation-canvas-v2__stage[data-panning] .generation-canvas-v2__edges { visibility: hidden !important; }"
      : diagnosticLayer === "edges-during-pan"
        ? ".generation-canvas-v2__stage[data-panning] .generation-canvas-v2__edges { visibility: hidden !important; }"
      : diagnosticLayer === "edge-details"
        ? ".generation-canvas-v2__edge-tag, .generation-canvas-v2__edge-hit, .generation-canvas-v2__edge-dot, .generation-canvas-v2__edge-cut-object { display: none !important; }"
      : diagnosticLayer === "media"
        ? ".generation-canvas-v2__nodes img, .generation-canvas-v2__nodes video, .generation-canvas-v2__nodes canvas { display: none !important; }"
        : diagnosticLayer === "nodes"
          ? ".generation-canvas-v2__nodes { display: none !important; }"
          : "";
    if (!css) throw new Error(`未知性能诊断层: ${diagnosticLayer}`);
    await getWin().addStyleTag({ content: css });
    results.diagnosticLayer = diagnosticLayer;
    await sleep(250);
  }

  // ── 场景 1：画布平移（中键持续拖拽；左键空白拖是框选，不得混测）──
  await probeStart();
  await getWin().mouse.move(640, 420);
  await getWin().mouse.down({ button: "middle" });
  for (let i = 0; i < 8; i += 1) {
    for (let s = 1; s <= 14; s += 1) { await getWin().mouse.move(640 - s * 22, 420 - s * 10); await getWin().waitForTimeout(11); }
    for (let s = 13; s >= 0; s -= 1) { await getWin().mouse.move(640 - s * 22, 420 - s * 10); await getWin().waitForTimeout(11); }
  }
  await getWin().mouse.up({ button: "middle" });
  results.scenarios["canvas-pan"] = await probeStop();
  log("canvas-pan:", JSON.stringify(results.scenarios["canvas-pan"]));

  // ── 场景 2：画布缩放（wheel 连续）──
  await probeStart();
  for (let i = 0; i < 30; i += 1) { await getWin().mouse.move(660, 420); await getWin().mouse.wheel(0, i % 2 ? 120 : -120); await getWin().waitForTimeout(60); }
  results.scenarios["canvas-zoom"] = await probeStop();
  log("canvas-zoom:", JSON.stringify(results.scenarios["canvas-zoom"]));

  // ── 场景 3：时间轴播放 ~6s ──
  await getWin().getByRole("button", { name: "预览", exact: false }).first().click().catch(() => {});
  await sleep(2000);
  const playBtn = getWin().locator('[aria-label="播放"]').first();
  if (await playBtn.count().catch(() => 0)) {
    await probeStart();
    await playBtn.click().catch(() => {});
    await sleep(6000);
    results.scenarios["timeline-play"] = await probeStop();
    log("timeline-play:", JSON.stringify(results.scenarios["timeline-play"]));
  } else {
    results.scenarios["timeline-play"] = { skipped: "未找到播放按钮（时间轴可能空）" };
    log("timeline-play: 跳过（无播放按钮）");
  }

  fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
  log(`\n✅ 结果写入 ${resultPath}`);
} catch (e) {
  console.error("\nPERF HARNESS ERROR:", e?.message || e);
  results.error = String(e?.message || e);
  fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  const closed = await Promise.race([
    app.close().then(() => true, () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!closed && electronProcess.exitCode == null) electronProcess.kill("SIGKILL");
}
