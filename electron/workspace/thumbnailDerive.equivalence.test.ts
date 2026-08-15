import { describe, expect, it } from "vitest";
import { deriveProjectCover } from "./workspaceRepository";
import { deriveProjectCoverFromRaw } from "../../src/workbench/project/projectCoverDerive";

// 封面派生唯一真相源（P4）：renderer(src) 与 main(electron) 各持一份等价实现，跨 tsconfig
// 无法 import 共享一个纯模块（CJS/ESM + rootDir 隔离）。本测试用同一组 fixture 跑两份并断言
// 输出逐字相等——任一侧规则漂移（媒体类型分流、max、length>4 过滤、payload/顶层 generationCanvas
// 取址、脏数据降级）立刻红。这是「证明等价」式收口的回归门。
const fixtures: Array<{ name: string; record: unknown }> = [
  { name: "null", record: null },
  { name: "undefined", record: undefined },
  { name: "非对象", record: 42 },
  { name: "空记录", record: {} },
  { name: "payload 非对象", record: { payload: "oops" } },
  { name: "无 generationCanvas", record: { payload: {} } },
  { name: "nodes 非数组", record: { payload: { generationCanvas: { nodes: "nope" } } } },
  {
    name: "顶层 generationCanvas（无 payload 包裹）",
    record: {
      generationCanvas: {
        nodes: [{ result: { url: "https://cdn/top.png" } }],
      },
    },
  },
  {
    name: "payload.generationCanvas 优先于顶层",
    record: {
      generationCanvas: { nodes: [{ result: { url: "https://cdn/top.png" } }] },
      payload: { generationCanvas: { nodes: [{ result: { url: "https://cdn/inner.png" } }] } },
    },
  },
  {
    name: "脏节点混入（null / 非对象 / 无 result / result 非对象）",
    record: {
      payload: {
        generationCanvas: {
          nodes: [
            null,
            7,
            {},
            { result: null },
            { result: "oops" },
            { result: { url: "https://cdn/a.png" } },
          ],
        },
      },
    },
  },
  {
    name: "thumbnailUrl 兜底 + 过短 url 过滤（length<=4）",
    record: {
      payload: {
        generationCanvas: {
          nodes: [
            { result: { url: "abc" } }, // 过短，丢
            { result: { thumbnailUrl: "https://cdn/thumb.png" } }, // url 缺，取 thumbnailUrl
            { result: { url: "", thumbnailUrl: "https://cdn/fallback.png" } }, // 空 url → thumbnailUrl
          ],
        },
      },
    },
  },
  {
    name: "超过 max 截断",
    record: {
      payload: {
        generationCanvas: {
          nodes: Array.from({ length: 9 }, (_, i) => ({
            result: { url: `https://cdn/n${i}.png` },
          })),
        },
      },
    },
  },
  // —— 媒体类型分流（2026-08-01 根治「导入视频项目封面加载失败」）——
  {
    name: "纯导入视频（type=video 无 poster）→ videoUrl 兜底、imageUrls 空",
    record: {
      payload: {
        generationCanvas: {
          nodes: [
            { kind: "asset", result: { type: "video", url: "nomi-local://asset/p1/assets/imported/clip.mp4" } },
          ],
        },
      },
    },
  },
  {
    name: "视频带 poster → poster 进 imageUrls、视频 url 不混进 <img> 桶",
    record: {
      payload: {
        generationCanvas: {
          nodes: [
            { result: { type: "video", url: "https://cdn/v.mp4", thumbnailUrl: "https://cdn/poster.jpg" } },
          ],
        },
      },
    },
  },
  {
    name: "text/audio 跳过、model3d 只认 poster、type 缺失按图取（混排）",
    record: {
      payload: {
        generationCanvas: {
          nodes: [
            { result: { type: "text", text: "旁白", url: "https://cdn/should-not-leak.txt" } },
            { result: { type: "audio", url: "https://cdn/voice.mp3" } },
            { result: { type: "model3d", url: "https://cdn/x.glb" } },
            { result: { type: "model3d", url: "https://cdn/y.glb", thumbnailUrl: "https://cdn/snap.png" } },
            { result: { url: "https://cdn/legacy-untyped.png" } },
            { result: { type: "video", url: "https://cdn/first-video.mp4" } },
            { result: { type: "video", url: "https://cdn/second-video.mp4" } },
          ],
        },
      },
    },
  },
  {
    name: "非字符串字段脏值（url 数字 / thumbnailUrl 对象）→ 逐字段降级不崩",
    record: {
      payload: {
        generationCanvas: {
          nodes: [
            { result: { type: "image", url: 42, thumbnailUrl: "https://cdn/still-works.png" } },
            { result: { type: "video", url: { nested: true } } },
          ],
        },
      },
    },
  },
];

describe("封面派生 main↔renderer 等价（收口回归门）", () => {
  for (const { name, record } of fixtures) {
    it(`输出逐字相等（默认 max）：${name}`, () => {
      expect(deriveProjectCover(record)).toEqual(deriveProjectCoverFromRaw(record));
    });
  }

  it("自定义 max 一致（main 接受 max 参数；renderer 走默认 4，单独验 main 截断语义）", () => {
    const record = {
      payload: {
        generationCanvas: {
          nodes: Array.from({ length: 6 }, (_, i) => ({
            result: { url: `https://cdn/n${i}.png` },
          })),
        },
      },
    };
    // renderer 入口固定 max=4；main 默认也 4，两者在默认下必相等。
    expect(deriveProjectCover(record, 4)).toEqual(deriveProjectCoverFromRaw(record));
    expect(deriveProjectCover(record, 2).imageUrls).toHaveLength(2);
    expect(deriveProjectCover(record, 2).imageUrls).toEqual([
      "https://cdn/n0.png",
      "https://cdn/n1.png",
    ]);
  });

  it("典型直击：导入 mp4 素材项目在两侧都派生出 videoUrl（修的就是这个案例）", () => {
    const record = {
      payload: {
        generationCanvas: {
          nodes: [{ kind: "asset", result: { type: "video", url: "nomi-local://asset/p/assets/imported/a.mp4" } }],
        },
      },
    };
    const main = deriveProjectCover(record);
    expect(main).toEqual(deriveProjectCoverFromRaw(record));
    expect(main).toEqual({ imageUrls: [], videoUrl: "nomi-local://asset/p/assets/imported/a.mp4" });
  });
});
