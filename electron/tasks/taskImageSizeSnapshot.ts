import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { projectDirById } from "../projects/repository";
import { writeJsonFileAtomic } from "../jsonFile";
import { logWarn } from "../logging/logger";
import { requestedImageSizeFromBody } from "../review/imageSizeSpecification";

export type TaskImageSizeIdentity = {
  projectId: string;
  vendor: string;
  modelKey: string;
  taskKind: string;
  taskId: string;
};
type Snapshot = { expectedImageSize: string | undefined };
const IDENTITY_KEYS = ["projectId", "vendor", "modelKey", "taskKind", "taskId"] as const;

/** Pixel evidence only: admission status and submission idempotency keep their existing owners. */
export function createTaskImageSizeSnapshotStore(deps: { projectDirResolver?: (projectId: string) => string | null } = {}) {
  function fileFor(identity: TaskImageSizeIdentity): string | null {
    if (IDENTITY_KEYS.some(key => !identity[key]?.trim())) return null;
    const root = (deps.projectDirResolver ?? projectDirById)(identity.projectId);
    if (!root || !path.isAbsolute(root)) return null;
    const key = crypto.createHash("sha256").update(JSON.stringify(IDENTITY_KEYS.map(field => identity[field]))).digest("hex");
    return path.join(root, ".nomi", "tasks", "image-size", `${key}.json`);
  }

  function read(identity: TaskImageSizeIdentity): Snapshot | null {
    try {
      const file = fileFor(identity);
      if (!file) return null;
      const stored = JSON.parse(fs.readFileSync(file, "utf8"));
      if (stored?.version !== 1 || IDENTITY_KEYS.some(key => stored[key] !== identity[key])) return null;
      if (stored.expectedImageSize === null) return { expectedImageSize: undefined };
      const size = requestedImageSizeFromBody({ size: stored.expectedImageSize });
      return size ? { expectedImageSize: size } : null;
    } catch {
      return null;
    }
  }

  function write(identity: TaskImageSizeIdentity, expectedImageSize: string | undefined): boolean {
    try {
      const file = fileFor(identity);
      if (!file) return false;
      const size = expectedImageSize === undefined ? undefined : requestedImageSizeFromBody({ size: expectedImageSize });
      if (expectedImageSize !== undefined && !size) return false;
      // Never replace old evidence with a later query, catalog edit, or guessed recovery payload.
      if (fs.existsSync(file)) {
        const existing = read(identity);
        const matches = existing !== null && existing.expectedImageSize === size;
        if (!matches) logWarn("tasks", "image-size-snapshot-conflict");
        return matches;
      }
      writeJsonFileAtomic(file, { version: 1, ...identity, expectedImageSize: size ?? null });
      return true;
    } catch (error) {
      logWarn("tasks", "image-size-snapshot-write-failed", undefined, error);
      return false;
    }
  }

  return { read, write };
}

export const taskImageSizeSnapshots = createTaskImageSizeSnapshotStore();
