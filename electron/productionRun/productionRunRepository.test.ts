import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ProductionRunRevisionConflictError,
  createProductionRunRepository,
} from "./productionRunRepository";
import { productionRunPaths } from "./productionRunPaths";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-production-run-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function repository() {
  return createProductionRunRepository({
    projectDirResolver: (projectId) => (projectId === "project-1" ? root : null),
    now: () => "2026-08-08T08:00:00.000Z",
  });
}

function createRun() {
  return repository().create({
    runId: "run-1",
    projectId: "project-1",
    playbook: { name: "brand.promo", version: "1.0.0" },
    origin: { host: "codex" },
  });
}

describe("ProductionRunRepository", () => {
  it("creates and reads a checksummed run snapshot", () => {
    const created = createRun();

    expect(created).toMatchObject({ runId: "run-1", revision: 0, status: "draft", snapshotCursor: 1 });
    expect(repository().read("project-1", "run-1")).toEqual(created);
    expect(repository().list("project-1")).toHaveLength(1);
  });

  it("serializes mutations with revision CAS and monotonic cursors", () => {
    createRun();
    const first = repository().execute("project-1", "run-1", {
      commandId: "cmd-1",
      expectedRevision: 0,
      type: "run.status",
      payload: { status: "awaiting_contract" },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });

    expect(first.run).toMatchObject({ revision: 1, status: "awaiting_contract", snapshotCursor: 2 });
    expect(first.events.map((event) => event.cursor)).toEqual([2]);
    expect(() =>
      repository().execute("project-1", "run-1", {
        commandId: "cmd-stale",
        expectedRevision: 0,
        type: "run.status",
        payload: { status: "cancelled" },
        issuedAt: "2026-08-08T08:00:00.000Z",
      }),
    ).toThrow(ProductionRunRevisionConflictError);
  });

  it("returns the original result for a repeated command id", () => {
    createRun();
    const command = {
      commandId: "cmd-repeat",
      expectedRevision: 0,
      type: "run.status",
      payload: { status: "awaiting_contract" },
      issuedAt: "2026-08-08T08:00:00.000Z",
    };
    const first = repository().execute("project-1", "run-1", command);
    repository().execute("project-1", "run-1", {
      commandId: "cmd-2",
      expectedRevision: 1,
      type: "run.status",
      payload: { status: "cancelled" },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });

    const repeated = repository().execute("project-1", "run-1", command);
    expect(repeated).toEqual(first);
    expect(repository().readEvents("project-1", "run-1")).toHaveLength(3);
  });

  it("deduplicates from the durable event even if the command index was lost", () => {
    createRun();
    const command = {
      commandId: "cmd-event-dedupe",
      expectedRevision: 0,
      type: "run.status",
      payload: { status: "awaiting_contract" },
      issuedAt: "2026-08-08T08:00:00.000Z",
    };
    const first = repository().execute("project-1", "run-1", command);
    fs.writeFileSync(productionRunPaths(root, "run-1").commands, "", "utf8");

    expect(repository().execute("project-1", "run-1", command)).toEqual(first);
    expect(repository().readEvents("project-1", "run-1")).toHaveLength(2);
  });

  it("recovers a corrupt snapshot from events and preserves the corrupt bytes", () => {
    createRun();
    const paths = productionRunPaths(root, "run-1");
    const envelope = JSON.parse(fs.readFileSync(paths.snapshot, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(paths.snapshot, JSON.stringify({ ...envelope, checksum: "wrong" }), "utf8");

    expect(repository().read("project-1", "run-1")).toMatchObject({ status: "draft", snapshotCursor: 1 });
    expect(fs.readdirSync(paths.dir).some((name) => name.startsWith("run.corrupt-"))).toBe(true);
  });

  it("ignores a torn final event and keeps cursor ordering after restart", () => {
    createRun();
    const paths = productionRunPaths(root, "run-1");
    fs.appendFileSync(paths.events, "{torn", "utf8");

    const restarted = repository();
    expect(restarted.read("project-1", "run-1")).toMatchObject({ snapshotCursor: 1 });
    expect(restarted.readEvents("project-1", "run-1").map((event) => event.cursor)).toEqual([1]);
  });

  it("rejects an artifact payload with an unknown lifecycle status", () => {
    createRun();

    expect(() =>
      repository().execute("project-1", "run-1", {
        commandId: "cmd-invalid-artifact",
        expectedRevision: 0,
        type: "artifact.add",
        payload: {
          artifact: {
            artifactId: "artifact-1",
            stageId: "brief",
            kind: "brief",
            status: "published",
            createdAt: "2026-08-08T08:00:00.000Z",
          },
        },
        issuedAt: "2026-08-08T08:00:00.000Z",
      }),
    ).toThrow("Invalid artifact status");
  });

  it("persists approved authority in the same revision stream", () => {
    createRun();
    const result = repository().execute("project-1", "run-1", {
      commandId: "cmd-approval",
      expectedRevision: 0,
      type: "approval.record",
      payload: {
        approval: {
          approvalId: "approval-1",
          runId: "run-1",
          scope: "job_set",
          planHash: "plan-1",
          jobIds: ["job-1"],
          allowedProviders: ["tapcanvas"],
          allowedModels: ["seedance-1.0"],
          currency: "CNY",
          maxSpend: 10,
          maxAttemptsPerJob: 2,
          decidedAt: "2026-08-08T08:00:00.000Z",
          expiresAt: "2026-08-08T09:00:00.000Z",
        },
      },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });

    expect(result).toMatchObject({ run: { revision: 1 }, events: [{ type: "approval.recorded" }] });
    expect(repository().readApprovals("project-1", "run-1")).toMatchObject([{ approvalId: "approval-1" }]);
    expect(fs.readFileSync(productionRunPaths(root, "run-1").approvals, "utf8")).not.toContain("/Users/");
  });

  it("derives durable authority and budget from an approved gate without trusting renderer authority", () => {
    repository().create({
      runId: "run-1",
      projectId: "project-1",
      playbook: { name: "brand.promo", version: "1.0.0" },
      origin: { host: "codex" },
      policy: {
        mode: "balanced",
        trustedHosts: ["codex"],
        allowedProviders: ["tapcanvas"],
        allowedModels: ["seedance-1.0"],
        maxSpend: 60,
        maxAttemptsPerJob: 2,
      },
    });
    repository().execute("project-1", "run-1", {
      commandId: "setup-job",
      expectedRevision: 0,
      type: "job.add",
      payload: {
        job: {
          jobId: "job-1", stageId: "production", status: "authorization_required", attempt: 1,
          provider: "tapcanvas", model: "seedance-1.0", idempotencyKey: "job-1:1",
          createdAt: "2026-08-08T08:00:00.000Z", updatedAt: "2026-08-08T08:00:00.000Z",
        },
      },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });
    repository().execute("project-1", "run-1", {
      commandId: "setup-gate",
      expectedRevision: 1,
      type: "gate.add",
      payload: {
        gate: {
          gateId: "gate-contract", scope: "budget_envelope", status: "waiting", planHash: "plan-1", jobIds: ["job-1"],
          title: "Contract", summary: "Summary", createdAt: "2026-08-08T08:00:00.000Z", expiresAt: "2026-08-08T09:00:00.000Z",
        },
      },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });
    repository().execute("project-1", "run-1", {
      commandId: "await-contract",
      expectedRevision: 2,
      type: "run.status",
      payload: { status: "awaiting_contract" },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });

    const result = repository().execute("project-1", "run-1", {
      commandId: "approve-gate",
      expectedRevision: 3,
      type: "gate.decide",
      payload: { gateId: "gate-contract", status: "approved", approval: { maxSpend: 999999 } },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });

    expect(result.run).toMatchObject({
      status: "ready",
      gates: [{ gateId: "gate-contract", status: "approved" }],
      jobs: [{ jobId: "job-1", status: "authorized" }],
      budget: { authorized: 60 },
    });
    expect(repository().readApprovals("project-1", "run-1")).toMatchObject([{
      approvalId: "approval:gate-contract",
      runId: "run-1",
      planHash: "plan-1",
      jobIds: ["job-1"],
      allowedProviders: ["tapcanvas"],
      allowedModels: ["seedance-1.0"],
      maxSpend: 60,
      maxAttemptsPerJob: 2,
    }]);
  });

  it("persists and replays deduplicated budget entries into the run summary", () => {
    createRun();
    const auth = {
      billingEntryId: "billing-auth-1",
      kind: "authorize",
      amount: 20,
      occurredAt: "2026-08-08T08:00:00.000Z",
    };
    const authorized = repository().execute("project-1", "run-1", {
      commandId: "cmd-budget-auth",
      expectedRevision: 0,
      type: "budget.entry",
      payload: { entry: auth },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });
    const reserved = repository().execute("project-1", "run-1", {
      commandId: "cmd-budget-reserve",
      expectedRevision: 1,
      type: "budget.entry",
      payload: {
        entry: {
          billingEntryId: "billing-reserve-1",
          kind: "reserve",
          reservationId: "reservation-1",
          jobId: "job-1",
          amount: 7,
          occurredAt: "2026-08-08T08:00:00.000Z",
        },
      },
      issuedAt: "2026-08-08T08:00:00.000Z",
    });

    expect(authorized.run.budget.authorized).toBe(20);
    expect(reserved.run.budget.reserved).toBe(7);
    expect(repository().readBudgetLedger("project-1", "run-1").entries).toHaveLength(2);
    expect(repository().read("project-1", "run-1")?.budget).toEqual({
      currency: "CNY",
      authorized: 20,
      reserved: 7,
      actual: 0,
      unsettled: 0,
    });
  });
});
