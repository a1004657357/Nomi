import fs from "node:fs";
import path from "node:path";
import { probeMediaMetadata } from "../export/mediaProbe";

const RECOVERABLE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const MINIMUM_RECOVERED_IMAGE_DIMENSION = 512;

export async function recoverGeneratedImageFromCodexHome(
  codexHome: string,
  requestedOutputPath: string,
  generatedAfterMs: number,
): Promise<string | null> {
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  const pending: Array<{ dir: string; depth: number }> = [{ dir: codexHome, depth: 0 }];
  let visited = 0;
  while (pending.length > 0 && visited < 2_000) {
    const current = pending.pop();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      const candidatePath = path.join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < 6) {
        pending.push({ dir: candidatePath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !RECOVERABLE_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        const stat = fs.statSync(candidatePath);
        if (stat.size > 0 && stat.mtimeMs >= generatedAfterMs - 5_000) {
          candidates.push({ path: candidatePath, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // Ignore files that disappear while Codex is finalizing its output.
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates) {
    try {
      const metadata = await probeMediaMetadata(candidate.path);
      if (
        (metadata.width ?? 0) < MINIMUM_RECOVERED_IMAGE_DIMENSION
        || (metadata.height ?? 0) < MINIMUM_RECOVERED_IMAGE_DIMENSION
      ) {
        continue;
      }
      const ext = path.extname(candidate.path).toLowerCase() || ".png";
      const recoveredPath = path.join(path.dirname(requestedOutputPath), `result-recovered${ext}`);
      fs.copyFileSync(candidate.path, recoveredPath);
      return recoveredPath;
    } catch {
      // Auth avatars, thumbnails, and incomplete cache files are not generated outputs.
    }
  }
  return null;
}
