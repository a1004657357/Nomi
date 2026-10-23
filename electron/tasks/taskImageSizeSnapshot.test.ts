import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskImageSizeSnapshotStore } from "./taskImageSizeSnapshot";

let root = "";
const identity = { projectId: "project", vendor: "provider", modelKey: "image-model", taskKind: "text_to_image", taskId: "provider/task-id" };
const make = () => createTaskImageSizeSnapshotStore({ projectDirResolver: () => root });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-image-size-snapshot-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("durable original image-size snapshots", () => {
  it("recovers exact outbound pixels in a new store instance and does not overwrite them", () => {
    expect(make().write(identity, "1024x1024")).toBe(true);
    expect(make().read(identity)).toEqual({ expectedImageSize: "1024x1024" });
    expect(make().write(identity, "2048x2048")).toBe(false);
    expect(make().read(identity)).toEqual({ expectedImageSize: "1024x1024" });
  });

  it("distinguishes a new unspecified expectation from missing legacy evidence", () => {
    expect(make().read(identity)).toBeNull();
    expect(make().write(identity, undefined)).toBe(true);
    expect(make().read(identity)).toEqual({ expectedImageSize: undefined });
  });

  it.each(["projectId", "vendor", "modelKey", "taskKind", "taskId"] as const)("binds the %s identity, not just a provider task number", (key) => {
    make().write(identity, "1024x1024");
    expect(make().read({ ...identity, [key]: "different" })).toBeNull();
  });

  it("does not accept corrupt or mismatched stored evidence", () => {
    make().write(identity, "1024x1024");
    const dir = path.join(root, ".nomi", "tasks", "image-size");
    const file = path.join(dir, fs.readdirSync(dir)[0]);
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...receipt, vendor: "another-provider" }));
    expect(make().read(identity)).toBeNull();
    fs.writeFileSync(file, "{torn");
    expect(make().read(identity)).toBeNull();
    expect(make().write(identity, "1024x1024")).toBe(false);
  });

  it("does not throw or create outside an unresolved project", () => {
    const store = createTaskImageSizeSnapshotStore({ projectDirResolver: () => null });
    expect(store.write(identity, "1024x1024")).toBe(false);
    expect(store.read(identity)).toBeNull();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("does not fail an accepted task when the snapshot directory cannot be written", () => {
    fs.writeFileSync(path.join(root, ".nomi"), "not a directory");
    expect(make().write(identity, "1024x1024")).toBe(false);
    expect(make().read(identity)).toBeNull();
  });
});
