import { check } from "../lib/journeyRunner.mjs";
import { createBlankProject } from "../lib/isoApp.mjs";

export default {
  id: "j5-edit-export",
  name: "修改项目并进入导出",
  needsAgent: false,
  smoke: true,
  successCriterion: "创建并修改当前项目内容后进入导出工作区，导出控制面真实挂载",
  async setup({ win, iso }) {
    return createBlankProject(win, iso.projectsDir);
  },
  milestones: [
    {
      id: "modify-project",
      title: "在空项目中创建一个画面",
      async act(ctx) {
        await ctx.win.getByRole("button", { name: "生成", exact: false }).first().click();
        await ctx.win.locator('button[aria-label="新建一个画面节点"]').first().click({ timeout: 5000 });
        await ctx.win.locator('.generation-canvas-v2-node').first().waitFor({ state: "visible", timeout: 10_000 });
      },
      async verify(ctx) {
        const canvasVisible = await ctx.win.locator('.generation-canvas-v2-node').first().isVisible().catch(() => false);
        return [check("项目内容已从空态变为生成画布", canvasVisible, "generation canvas not visible")];
      },
    },
    {
      id: "open-export",
      title: "进入导出工作区",
      async act(ctx) {
        await ctx.win.locator('[aria-label="去出片"]:visible').first().click({ timeout: 5000 });
        await ctx.win.locator('[data-workspace-mode="preview"]').waitFor({ state: "attached", timeout: 5000 });
        await ctx.win.getByRole("button", { name: "导出 MP4", exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
      },
      async verify(ctx) {
        const previewMode = await ctx.win.locator('[data-workspace-mode="preview"]').count() > 0;
        const exportButtonVisible = await ctx.win.getByRole("button", { name: "导出 MP4", exact: true }).first().isVisible().catch(() => false);
        return [check("导出工作区已挂载", previewMode && exportButtonVisible, `mode=${previewMode} exportButton=${exportButtonVisible}`)];
      },
    },
  ],
};
