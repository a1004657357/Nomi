import { desktopT } from "./desktopStrings";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { readJsonFile, writeJsonFileAtomic } from "./jsonFile";

// Provider-side rolling windows can reject requests exactly at 60s. The extra
// 15s also absorbs request-transform and network timing variance.
export const AGNES_VIDEO_MIN_START_INTERVAL_MS = 75_000;
export const AGNES_IMAGE_MIN_START_INTERVAL_MS = 6_000;
export const AGNES_DEFAULT_MIN_START_INTERVAL_MS = 3_000;

const LEDGER_VERSION = 1;
const DEFAULT_LOCK_RETRY_MS = 50;
const DEFAULT_STALE_LOCK_MS = 5_000;
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const MAX_RESERVATION_HORIZON_MS = 24 * 60 * 60 * 1000;

export type VendorSubmissionRatePolicy = {
  rateKey: string;
  minimumStartIntervalMs: number;
  source: string;
};

export type VendorSubmissionReservation = VendorSubmissionRatePolicy & {
  startAt: number;
  waitMs: number;
};

type RateLedger = {
  version: 1;
  updatedAt: number;
  nextStartByRateKey: Record<string, number>;
};

type LimiterOptions = {
  ledgerPath?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  lockRetryMs?: number;
  staleLockMs?: number;
  lockTimeoutMs?: number;
};

export type VendorSubmissionRateLimiter = {
  wait: (vendorKey: string, kind: string) => Promise<VendorSubmissionReservation | null>;
};

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Agnes public free/default limits published on 2026-06-28:
 * video 1 RPM, image 1K 20 RPM / 2K 10 RPM, text 20 RPM.
 * Images use the conservative 2K interval because Nomi exposes high-resolution output.
 */
export function vendorSubmissionRatePolicy(vendorKey: string, kind: string): VendorSubmissionRatePolicy | null {
  if (normalized(vendorKey) !== "agnes") return null;
  const normalizedKind = normalized(kind);
  if (normalizedKind === "video") {
    return {
      rateKey: "agnes:video",
      minimumStartIntervalMs: AGNES_VIDEO_MIN_START_INTERVAL_MS,
      source: "Agnes public free/default video limit, 2026-06-28",
    };
  }
  if (normalizedKind === "image") {
    return {
      rateKey: "agnes:image",
      minimumStartIntervalMs: AGNES_IMAGE_MIN_START_INTERVAL_MS,
      source: "Agnes public free/default image 2K limit, 2026-06-28",
    };
  }
  return {
    rateKey: "agnes:default",
    minimumStartIntervalMs: AGNES_DEFAULT_MIN_START_INTERVAL_MS,
    source: "Agnes public free/default text or 1K image limit, 2026-06-28",
  };
}

export function reserveVendorSubmissionSlot(
  current: Readonly<Record<string, number>>,
  policy: VendorSubmissionRatePolicy,
  now: number,
): VendorSubmissionReservation & { nextStartByRateKey: Record<string, number> } {
  const prior = Number(current[policy.rateKey]);
  const startAt = Math.max(now, Number.isFinite(prior) ? prior : 0);
  return {
    ...policy,
    startAt,
    waitMs: Math.max(0, startAt - now),
    nextStartByRateKey: {
      ...current,
      [policy.rateKey]: startAt + policy.minimumStartIntervalMs,
    },
  };
}

function defaultLedgerPath(): string {
  return path.join(app.getPath("userData"), "provider-submission-rate-limits.json");
}

function sleepWithTimer(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function emptyLedger(now: number): RateLedger {
  return { version: LEDGER_VERSION, updatedAt: now, nextStartByRateKey: {} };
}

function readLedger(filePath: string, now: number): RateLedger {
  if (!fs.existsSync(filePath)) return emptyLedger(now);
  const raw = readJsonFile(filePath) as Partial<RateLedger>;
  if (raw.version !== LEDGER_VERSION || !raw.nextStartByRateKey || typeof raw.nextStartByRateKey !== "object") {
    throw new Error(desktopT("custom.vendorSubmissionRateLimiter.text1"));
  }
  const nextStartByRateKey: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw.nextStartByRateKey)) {
    if (!Number.isFinite(value) || value <= now) continue;
    if (value > now + MAX_RESERVATION_HORIZON_MS) continue;
    nextStartByRateKey[key] = value;
  }
  return { version: LEDGER_VERSION, updatedAt: now, nextStartByRateKey };
}

async function acquireLedgerLock(input: {
  lockPath: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  retryMs: number;
  staleMs: number;
  timeoutMs: number;
}): Promise<() => void> {
  fs.mkdirSync(path.dirname(input.lockPath), { recursive: true });
  const startedAt = input.now();
  while (true) {
    try {
      fs.mkdirSync(input.lockPath);
      return () => fs.rmSync(input.lockPath, { recursive: true, force: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(input.lockPath).mtimeMs;
        if (age >= input.staleMs) {
          fs.rmSync(input.lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
        continue;
      }
      if (input.now() - startedAt >= input.timeoutMs) {
        throw new Error(desktopT("custom.vendorSubmissionRateLimiter.text2"), { cause: error });
      }
      await input.sleep(input.retryMs);
    }
  }
}

export function createVendorSubmissionRateLimiter(options: LimiterOptions = {}): VendorSubmissionRateLimiter {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepWithTimer;
  const retryMs = Math.max(10, options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS);
  const staleMs = Math.max(retryMs, options.staleLockMs ?? DEFAULT_STALE_LOCK_MS);
  const timeoutMs = Math.max(staleMs, options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);

  return {
    async wait(vendorKey, kind) {
      const policy = vendorSubmissionRatePolicy(vendorKey, kind);
      if (!policy) return null;
      const ledgerPath = options.ledgerPath || defaultLedgerPath();
      const release = await acquireLedgerLock({
        lockPath: `${ledgerPath}.lock`,
        now,
        sleep,
        retryMs,
        staleMs,
        timeoutMs,
      });
      let reservation: VendorSubmissionReservation;
      try {
        const reservedAt = now();
        const ledger = readLedger(ledgerPath, reservedAt);
        const next = reserveVendorSubmissionSlot(ledger.nextStartByRateKey, policy, reservedAt);
        reservation = {
          rateKey: next.rateKey,
          minimumStartIntervalMs: next.minimumStartIntervalMs,
          source: next.source,
          startAt: next.startAt,
          waitMs: next.waitMs,
        };
        writeJsonFileAtomic(ledgerPath, {
          version: LEDGER_VERSION,
          updatedAt: reservedAt,
          nextStartByRateKey: next.nextStartByRateKey,
        } satisfies RateLedger);
      } finally {
        release();
      }
      if (reservation.waitMs > 0) await sleep(reservation.waitMs);
      return reservation;
    },
  };
}

const defaultVendorSubmissionRateLimiter = createVendorSubmissionRateLimiter();

export function waitForVendorSubmissionWindow(
  vendorKey: string,
  kind: string,
): Promise<VendorSubmissionReservation | null> {
  return defaultVendorSubmissionRateLimiter.wait(vendorKey, kind);
}
