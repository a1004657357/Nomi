import { describe, expect, it } from "vitest";
import {
  SHOT_CUT_DETECT_THRESHOLD,
  SHOT_SHEET_COLUMNS,
  buildDetectFilter,
  buildSheetFilter,
  parseShotCutOutput,
} from "./detectShotCuts";

// 真实 ffmpeg 4.4 输出样本（本仓 @ffmpeg-installer 实测，别改成手编的）：
// metadata=print:file=- 写的是 **stdout**，一个切点两行。
const REAL_STDOUT = `frame:0    pts:20480   pts_time:2
lavfi.scene_score=0.673689
frame:1    pts:40960   pts_time:4
lavfi.scene_score=0.520391
frame:2    pts:61440   pts_time:6
lavfi.scene_score=0.630627
`;

describe("parseShotCutOutput", () => {
  it("按真实样本解出秒数 + 分数", () => {
    expect(parseShotCutOutput(REAL_STDOUT)).toEqual([
      { seconds: 2, score: 0.673689 },
      { seconds: 4, score: 0.520391 },
      { seconds: 6, score: 0.630627 },
    ]);
  });

  it("一镜到底（无切点）→ 空数组，不抛", () => {
    expect(parseShotCutOutput("")).toEqual([]);
    expect(parseShotCutOutput("frame:0 pts_time:1\n")).toEqual([]);
  });

  it("小数秒照收", () => {
    expect(parseShotCutOutput("pts_time:12.583\nlavfi.scene_score=0.41")).toEqual([
      { seconds: 12.583, score: 0.41 },
    ]);
  });

  it("不把 ffmpeg 的横幅/进度行当成切点", () => {
    const noise = `  Duration: 00:00:08.00, start: 0.000000, bitrate: 17 kb/s\n${REAL_STDOUT}`;
    expect(parseShotCutOutput(noise)).toHaveLength(3);
  });
});

describe("filtergraph — 检测与联系表必须同阈值", () => {
  it("检测用 select+metadata，写 stdout", () => {
    expect(buildDetectFilter(0.1)).toBe("select='gt(scene,0.1)',metadata=print:file=-");
  });

  it("联系表用同一个 select 条件 —— 否则第 i 格就不是第 i 个切点了", () => {
    const threshold = SHOT_CUT_DETECT_THRESHOLD;
    const detect = buildDetectFilter(threshold);
    const sheet = buildSheetFilter(threshold, SHOT_SHEET_COLUMNS, 2, 90);
    const selectOf = (filter: string) => filter.slice(0, filter.indexOf("',") + 1);
    expect(selectOf(sheet)).toBe(selectOf(detect));
  });

  it("联系表带 scale + tile", () => {
    expect(buildSheetFilter(0.1, 8, 2, 90)).toBe("select='gt(scene,0.1)',scale=-2:90,tile=8x2");
  });
});
