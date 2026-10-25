import { describe, expect, it } from "vitest";
import { resolveNodeRenderKind, isCardRenderKind, nodeHasGenerationComposer } from "./resolveRenderKind";
import { NODE_RENDER_KINDS } from '../../project/projectCategories';

const node = (over: { kind: string; renderKind?: string; categoryId?: string; meta?: Record<string, unknown> }) =>
  over as Parameters<typeof resolveNodeRenderKind>[0];

describe("resolveNodeRenderKind — 渲染分发优先级（kind > categoryId）", () => {
  it("角色/场景卡落 shots 分类（拆镜头拍板 A）仍长成卡，不退化成普通图", () => {
    expect(resolveNodeRenderKind(node({ kind: "character", categoryId: "shots" }))).toBe("character-card");
    expect(resolveNodeRenderKind(node({ kind: "scene", categoryId: "shots" }))).toBe("scene-card");
  });

  it("声音节点任意分类都按 kind → audio-strip", () => {
    expect(resolveNodeRenderKind(node({ kind: "audio", categoryId: "shots" }))).toBe("audio-strip");
  });

  it("素材节点永远纯图片预览（即便落 cast/scene 分类）", () => {
    expect(resolveNodeRenderKind(node({ kind: "asset", categoryId: "cast" }))).toBeUndefined();
  });

  it("3D 导演工作区落 scene 分类时仍保留自己的编辑器，而不是被场景卡截获", () => {
    expect(resolveNodeRenderKind(node({ kind: "scene3d", categoryId: "scene" }))).toBeUndefined();
    expect(resolveNodeRenderKind(node({ kind: "vibingDirector", categoryId: "scene" }))).toBeUndefined();
  });

  it("显式 node.renderKind 覆盖一切", () => {
    expect(resolveNodeRenderKind(node({ kind: "character", renderKind: "shot-frame" }))).toBe("shot-frame");
  });

  it.each(['whiteboard', 'audio', 'character', 'scene'])('%s honors every declared explicit render kind without mutating the node', (kind) => {
    for (const renderKind of NODE_RENDER_KINDS) {
      const input = Object.freeze(node({ kind, categoryId: 'shots', renderKind, meta: { userValue: 'unchanged' } }));
      const before = JSON.stringify(input);
      expect(resolveNodeRenderKind(input)).toBe(renderKind);
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  it.each(['asset', 'skill', 'scene3d', 'vibingDirector', 'agent-artifact'])('%s retains its protected workspace even with an explicit card render kind', (kind) => {
    expect(resolveNodeRenderKind(node({ kind, categoryId: 'cast', renderKind: 'character-card' }))).toBeUndefined();
  });

  it("分镜表语义覆盖 shots 迁移写入的 shot-frame，并走专属卡片 body", () => {
    const renderKind = resolveNodeRenderKind(node({
      kind: "text",
      renderKind: "shot-frame",
      categoryId: "shots",
      meta: { storyboardGroup: true },
    }));
    expect(renderKind).toBe("storyboard-table");
    expect(isCardRenderKind(renderKind)).toBe(true);
  });

  it("普通文本节点仍保留原有文本编辑器分发", () => {
    expect(resolveNodeRenderKind(node({ kind: "text", categoryId: "text" }))).toBeUndefined();
  });

  it("无 kind 信号时按 categoryId 兜底（prop 分类的 image → prop-card）", () => {
    expect(resolveNodeRenderKind(node({ kind: "image", categoryId: "prop" }))).toBe("prop-card");
    expect(resolveNodeRenderKind(node({ kind: "image", categoryId: "cast" }))).toBe("character-card");
  });

  it("普通镜头（image/video 在 shots）不走卡片", () => {
    expect(resolveNodeRenderKind(node({ kind: "image", categoryId: "shots" }))).toBeUndefined();
    expect(isCardRenderKind(resolveNodeRenderKind(node({ kind: "video", categoryId: "shots" })))).toBe(false);
  });
});

describe("nodeHasGenerationComposer", () => {
  // 「承载型」节点拿的是已有的文件、或者正文本身就是功能（画板/3D/全景）——
  // 对它们弹「描述你要生成的画面」是在问一个它答不了的问题。
  it.each(["panorama", "director", "whiteboard", "asset", "agent-artifact"])("%s 不挂生成 composer", (kind) => {
    expect(nodeHasGenerationComposer(kind)).toBe(false);
  });

  it.each(["image", "video", "audio", "shot", "character", "scene", "model3d"])("%s 仍挂生成 composer", (kind) => {
    expect(nodeHasGenerationComposer(kind)).toBe(true);
  });

  // 承载型判定和 renderKind 的「不推断卡片」判定说的是同一件事，两边不许各写一份而各自漂移。
  it("承载型 kind 同时也不被推断成角色/场景/道具卡", () => {
    expect(resolveNodeRenderKind(node({ kind: "agent-artifact", categoryId: "cast" }))).toBeUndefined();
    expect(resolveNodeRenderKind(node({ kind: "asset", categoryId: "scene" }))).toBeUndefined();
  });
});
