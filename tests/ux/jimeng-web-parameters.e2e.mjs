import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchNomiApp } from "./_launchApp.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-jimeng-params-e2e-"));
const { app } = await launchNomiApp({
  name: "nomi-jimeng-params-e2e",
  tempRoot,
  env: { NOMI_SOURCE_RUN: "1", NOMI_CAPABILITY_DIR: path.join(tempRoot, "capability-core") },
});

try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1000);

  const project = await win.evaluate(() => {
    window.localStorage.setItem("nomi:splash:v1", "seen");
    window.localStorage.setItem("nomi:journey-tour:v1", "seen");
    window.localStorage.setItem("nomi:canvas-gesture-hint:v1", "seen");
    return window.nomiDesktop.projects.create({
      name: "即梦参数 E2E",
      version: 1,
      payload: {
        generationCanvas: {
          nodes: [{
            id: "jimeng-image-params",
            kind: "image",
            title: "即梦 Web 图片参数",
            position: { x: 120, y: 120 },
            size: { width: 620, height: 380 },
            prompt: "零消耗界面参数验收",
            status: "idle",
            categoryId: "shots",
            meta: {
              modelKey: "jimeng-web-image",
              modelAlias: "jimeng-web-image",
              modelVendor: "jimeng-web",
              vendor: "jimeng-web",
              modelLabel: "即梦 Web 图片（实验）",
              archetype: {
                id: "jimeng-web-image",
                modeId: "t2i",
                variantId: "v5_0_pro",
              },
            },
          }, {
            id: "jimeng-video-params",
            kind: "video",
            title: "即梦 Web 视频参数",
            position: { x: 820, y: 120 },
            size: { width: 680, height: 400 },
            prompt: "零消耗视频界面参数验收",
            status: "idle",
            categoryId: "shots",
            meta: {
              modelKey: "jimeng-web-seedance-2.0",
              modelAlias: "jimeng-web-seedance-2.0",
              modelVendor: "jimeng-web",
              vendor: "jimeng-web",
              modelLabel: "即梦 Web Seedance 2.0（实验）",
              archetype: {
                id: "jimeng-web-seedance-2",
                modeId: "t2v",
                variantId: "mini",
              },
            },
          }],
          edges: [],
          selectedNodeIds: ["jimeng-image-params"],
          groups: [],
        },
      },
    });
  });

  await win.reload();
  await win.waitForLoadState("domcontentloaded");
  const card = win.locator("[data-project-card]", { hasText: "即梦参数 E2E" }).first();
  await card.waitFor({ state: "visible", timeout: 8000 });
  await card.click();
  await win.waitForTimeout(500);
  const continueButton = win.getByText("继续创作", { exact: false }).first();
  if (await continueButton.count()) await continueButton.click().catch(() => undefined);
  await win.waitForTimeout(1800);
  await win.getByRole("button", { name: "生成", exact: false }).first().click().catch(() => undefined);
  const canvas = win.locator('[aria-label="AI 影像创作画布"]');
  await canvas.waitFor({ state: "visible", timeout: 8000 });
  await win.getByRole("button", { name: "适应视图", exact: true }).click();

  const node = win.locator('[data-node-id="jimeng-image-params"]');
  await node.waitFor({ state: "visible", timeout: 8000 });
  await node.click({ position: { x: 40, y: 40 } });
  const variant = node.getByLabel("变体");
  const ratio = node.getByLabel("比例");
  const resolution = node.getByLabel("清晰度");
  await variant.waitFor({ state: "visible", timeout: 5000 });
  if (!(await variant.textContent())?.includes("图片 5.0 Pro")) {
    throw new Error("即梦图片节点未显示默认官网型号");
  }
  if (!(await ratio.textContent())?.includes("智能")) {
    throw new Error("即梦图片节点未显示官网比例参数");
  }
  if (!(await resolution.textContent())?.includes("2K")) {
    throw new Error("即梦图片节点未显示官网清晰度参数");
  }

  await variant.evaluate((element) => element.click());
  await win.getByRole("option").first().waitFor({ state: "visible", timeout: 3000 });
  const labels = await win.getByRole("option").allTextContents();
  const expectedModels = [
    "图片 5.0 Pro",
    "图片 5.0 Lite",
    "图片 4.7",
    "图片 4.6",
    "图片 4.5",
    "图片 4.1",
    "图片 4.0",
    "图片 3.1",
    "图片 3.0",
  ];
  for (const label of expectedModels) {
    if (!labels.some((value) => value.includes(label))) {
      throw new Error(`即梦图片型号下拉缺少：${label}`);
    }
  }
  await win.keyboard.press("Escape");

  const videoNode = win.locator('[data-node-id="jimeng-video-params"]');
  await videoNode.click({ position: { x: 40, y: 40 }, force: true });
  const videoVariant = videoNode.getByLabel("变体");
  if (!(await videoVariant.textContent())?.includes("Seedance 2.0 mini")) {
    throw new Error("即梦视频节点未显示默认官网型号");
  }
  if (!(await videoNode.getByLabel("比例").textContent())?.includes("16:9")) {
    throw new Error("即梦视频节点未显示官网比例参数");
  }
  if (!(await videoNode.getByLabel("清晰度").textContent())?.includes("720P")) {
    throw new Error("即梦视频节点未显示官网清晰度参数");
  }
  await videoVariant.evaluate((element) => element.click());
  await win.getByRole("option").first().waitFor({ state: "visible", timeout: 3000 });
  const videoLabels = await win.getByRole("option").allTextContents();
  const expectedVideoModels = [
    "Seedance 2.0 mini",
    "Seedance 2.0 Fast VIP",
    "Seedance 2.0 VIP",
    "Seedance 2.0 Fast",
    "Seedance 2.0",
  ];
  for (const label of expectedVideoModels) {
    if (!videoLabels.some((value) => value.includes(label))) {
      throw new Error(`即梦视频型号下拉缺少：${label}`);
    }
  }
  await win.keyboard.press("Escape");
  await videoNode.getByLabel("更多参数").evaluate((element) => element.click());
  const durationInput = win.getByLabel("时长(秒)");
  const generationCount = win.getByLabel("生成数量");
  if ((await durationInput.getAttribute("min")) !== "4" || (await durationInput.getAttribute("max")) !== "15") {
    throw new Error("即梦视频时长范围不是官网的 4–15 秒");
  }
  if (!(await generationCount.textContent())?.includes("1")) {
    throw new Error("即梦视频节点未显示生成数量参数");
  }
  console.log(
    `✓ 即梦 Web 节点显示 ${expectedModels.length} 个图片型号、${expectedVideoModels.length} 个视频型号及对应参数`,
  );
  await win.evaluate((projectId) => window.nomiDesktop.projects.delete(projectId), project.id);
} finally {
  await app.close().catch(() => undefined);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
