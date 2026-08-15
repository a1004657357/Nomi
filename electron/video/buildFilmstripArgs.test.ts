import { describe, it, expect } from "vitest";
import { buildFilmstripArgs, FILMSTRIP_TILES, FILMSTRIP_TILE_HEIGHT } from "./extractVideoFrame";

// 胶片条参数纯函数：fps 轻微过采样保证凑满 tiles 帧（tile 只吃前 tiles 帧），
// 单张输出 + 去音轨字幕。时长异常向下夹到 0.2s，避免 fps 爆表。

describe("buildFilmstripArgs", () => {
  it("默认 16 帧 x 高 54，fps=(tiles/duration)*1.02", () => {
    const args = buildFilmstripArgs({ inputPath: "in.mp4", outPath: "out.jpg", durationSeconds: 8 });
    expect(args).toContain("-an");
    expect(args).toContain("-frames:v");
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toBe(`fps=${((FILMSTRIP_TILES / 8) * 1.02).toFixed(6)},scale=-2:${FILMSTRIP_TILE_HEIGHT},tile=${FILMSTRIP_TILES}x1`);
    expect(args[args.length - 1]).toBe("out.jpg");
  });

  it("时长非法时夹到 0.2s 下限，不产出 Infinity/NaN", () => {
    const vf = buildFilmstripArgs({ inputPath: "in.mp4", outPath: "o.jpg", durationSeconds: 0 })[
      buildFilmstripArgs({ inputPath: "in.mp4", outPath: "o.jpg", durationSeconds: 0 }).indexOf("-vf") + 1
    ];
    expect(vf.includes("Infinity") || vf.includes("NaN")).toBe(false)
  });

  it("tiles/tileHeight 可覆写并有下限", () => {
    const args = buildFilmstripArgs({ inputPath: "i", outPath: "o", durationSeconds: 4, tiles: 1, tileHeight: 4 });
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("tile=2x1");
    expect(vf).toContain("scale=-2:16");
  });
})
