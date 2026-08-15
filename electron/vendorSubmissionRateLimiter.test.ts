import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createVendorSubmissionRateLimiter,
  reserveVendorSubmissionSlot,
  vendorSubmissionRatePolicy,
} from "./vendorSubmissionRateLimiter";

const tempRoots: string[] = [];

function tempLedgerPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-provider-rate-"));
  tempRoots.push(root);
  return path.join(root, "provider-submission-rate-limits.json");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("vendor submission rate policy", () => {
  it("uses the public Agnes free/default start intervals by modality", () => {
    expect(vendorSubmissionRatePolicy("agnes", "video")).toMatchObject({
      rateKey: "agnes:video",
      minimumStartIntervalMs: 75_000,
    });
    expect(vendorSubmissionRatePolicy("agnes", "image")).toMatchObject({
      rateKey: "agnes:image",
      minimumStartIntervalMs: 6_000,
    });
    expect(vendorSubmissionRatePolicy("agnes", "text")).toMatchObject({
      rateKey: "agnes:default",
      minimumStartIntervalMs: 3_000,
    });
    expect(vendorSubmissionRatePolicy("other", "video")).toBeNull();
  });

  it("reserves ordered slots without depending on request completion time", () => {
    const policy = vendorSubmissionRatePolicy("agnes", "video");
    expect(policy).not.toBeNull();
    const first = reserveVendorSubmissionSlot({}, policy!, 1_000);
    const second = reserveVendorSubmissionSlot(first.nextStartByRateKey, policy!, 1_000);

    expect(first).toMatchObject({ startAt: 1_000, waitMs: 0 });
    expect(second).toMatchObject({ startAt: 76_000, waitMs: 75_000 });
    expect(second.nextStartByRateKey["agnes:video"]).toBe(151_000);
  });
});

describe("persistent vendor submission limiter", () => {
  it("shares reservations across limiter instances for headless CLI processes", async () => {
    const ledgerPath = tempLedgerPath();
    let now = 10_000;
    const waits: number[] = [];
    const options = {
      ledgerPath,
      now: () => now,
      sleep: async (ms: number) => {
        waits.push(ms);
        now += ms;
      },
    };
    const firstProcess = createVendorSubmissionRateLimiter(options);
    const secondProcess = createVendorSubmissionRateLimiter(options);

    await firstProcess.wait("agnes", "video");
    const second = await secondProcess.wait("agnes", "video");

    expect(waits).toEqual([75_000]);
    expect(second).toMatchObject({
      rateKey: "agnes:video",
      waitMs: 75_000,
      minimumStartIntervalMs: 75_000,
    });
    expect(JSON.parse(fs.readFileSync(ledgerPath, "utf8"))).toMatchObject({
      version: 1,
      nextStartByRateKey: { "agnes:video": 160_000 },
    });
  });

  it("does not create a ledger for providers without an enforced policy", async () => {
    const ledgerPath = tempLedgerPath();
    const limiter = createVendorSubmissionRateLimiter({ ledgerPath });

    await expect(limiter.wait("codex", "image")).resolves.toBeNull();
    expect(fs.existsSync(ledgerPath)).toBe(false);
  });
});
