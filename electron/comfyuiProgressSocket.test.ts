import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ webContents: { fromId: () => null } }));

import { computeOverallPercent, parsePreviewFrame } from "./comfyuiProgressSocket";

describe("parsePreviewFrame（ComfyUI ws 二进制帧 [>I event][>I format][bytes]）", () => {
  const frame = (event: number, format: number, payload: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(event, 0);
    head.writeUInt32BE(format, 4);
    return Buffer.concat([head, payload]);
  };

  it("event=1(PREVIEW_IMAGE) + format 1/2 → jpeg/png", () => {
    const jpeg = parsePreviewFrame(frame(1, 1, Buffer.from("jpegbytes")));
    expect(jpeg?.mime).toBe("image/jpeg");
    expect(jpeg?.bytes.toString()).toBe("jpegbytes");
    expect(parsePreviewFrame(frame(1, 2, Buffer.from("x")))?.mime).toBe("image/png");
  });

  it("非预览事件（TEXT=3 等）/ 空载荷 / 残帧 → null", () => {
    expect(parsePreviewFrame(frame(3, 1, Buffer.from("text")))).toBeNull();
    expect(parsePreviewFrame(frame(1, 1, Buffer.alloc(0)))).toBeNull();
    expect(parsePreviewFrame(Buffer.from([0, 0, 0, 1]))).toBeNull();
  });

  it("超大帧（>1.5MB）拒收——IPC 别被灌爆", () => {
    expect(parsePreviewFrame(frame(1, 1, Buffer.alloc(2_000_000)))).toBeNull();
  });
});

describe("computeOverallPercent（已开跑节点-1 + 当前节点比率 / 总数）", () => {
  it("常规推进单调不倒退", () => {
    expect(computeOverallPercent(1, 0, 10)).toBe(0);
    expect(computeOverallPercent(1, 0.5, 10)).toBe(5);
    expect(computeOverallPercent(3, 0.5, 10)).toBe(25);
    expect(computeOverallPercent(10, 1, 10)).toBe(100);
  });
  it("防御：总数 0 / 比率越界 → 不 NaN 不越界", () => {
    expect(computeOverallPercent(3, 0.5, 0)).toBe(0);
    expect(computeOverallPercent(2, 5, 4)).toBe(50);
    expect(computeOverallPercent(0, -1, 4)).toBe(0);
  });
});
