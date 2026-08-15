import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { auditThirdPartyAssets } from "./check-third-party-assets.mjs";

const temporaryRoots = [];

function makeFixture({ hash = true, registerModel = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-third-party-audit-"));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, "src/assets"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs/legal"), { recursive: true });
  const modelPath = path.join(root, "src/assets/model.glb");
  fs.writeFileSync(modelPath, "model-bytes");
  const digest = crypto.createHash("sha256").update("model-bytes").digest("hex");
  const assets = registerModel ? [{
    id: "model",
    distribution: "bundled",
    paths: ["src/assets/model.glb"],
    sha256: { "src/assets/model.glb": hash ? digest : "bad-hash" },
    source: { name: "Fixture", url: "https://example.com/model" },
    license: { name: "Unknown", redistribution: "unverified" },
    releasePolicy: "blocked",
  }] : [{
    id: "external",
    distribution: "external-user-supplied",
    paths: [],
    source: { name: "External", url: "https://example.com/external" },
    license: { name: "None", redistribution: "not-applicable" },
    releasePolicy: "external-only",
  }];
  const manifestPath = path.join(root, "docs/legal/third-party-assets.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, assets }));
  return { root, manifestPath };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("third-party asset audit", () => {
  test("validates the repository manifest and reports the reviewed UE spike release blocker", () => {
    const result = auditThirdPartyAssets();
    expect(result.errors).toEqual([]);
    expect(result.blockers).toEqual([
      "scene3d-ue-mannequin-retopology-spike: bundled redistribution is not cleared",
    ]);
    expect(result.external).toBe(1);
    expect(result.remote).toBe(1);
  });

  test("detects a changed bundled binary", () => {
    const fixture = makeFixture({ hash: false });
    const result = auditThirdPartyAssets(fixture);
    expect(result.errors).toContain("model: SHA-256 mismatch for src/assets/model.glb");
  });

  test("rejects an unregistered bundled 3D asset", () => {
    const fixture = makeFixture({ registerModel: false });
    const result = auditThirdPartyAssets(fixture);
    expect(result.errors).toContain("unregistered bundled 3D asset: src/assets/model.glb");
  });

  test("requires HTTPS, a pinned hash, and explicit project use for remote catalogs", () => {
    const fixture = makeFixture({ registerModel: false });
    const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
    manifest.assets.push({
      id: "remote",
      distribution: "remote-on-demand",
      paths: [],
      source: {
        name: "Remote",
        url: "https://example.com/catalog",
        downloadUrl: "http://example.com/archive.zip",
        archiveSha256: "bad",
      },
      license: { name: "CC0", projectUse: "unknown", redistribution: "allowed" },
      releasePolicy: "remote-only",
    });
    fs.writeFileSync(fixture.manifestPath, JSON.stringify(manifest));

    const result = auditThirdPartyAssets(fixture);
    expect(result.errors).toContain("remote: remote-on-demand source requires an HTTPS downloadUrl");
    expect(result.errors).toContain("remote: remote-on-demand source requires a pinned archive SHA-256");
    expect(result.errors).toContain("remote: remote-on-demand project use must be explicitly allowed");
  });
});
