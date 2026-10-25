#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = path.join(ROOT, "docs/legal/third-party-assets.json");
const MODEL_EXTENSIONS = new Set([".fbx", ".glb", ".gltf", ".obj"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function discoverBundledModels(root) {
  const assetDir = path.join(root, "src/assets");
  if (!fs.existsSync(assetDir)) return [];
  return fs.readdirSync(assetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MODEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.posix.join("src/assets", entry.name))
    .sort();
}

export function auditThirdPartyAssets({
  root = ROOT,
  manifestPath = DEFAULT_MANIFEST,
} = {}) {
  const errors = [];
  const blockers = [];
  const warnings = [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const coveredBundledPaths = new Set();

  if (manifest.schemaVersion !== 1) errors.push("manifest schemaVersion must be 1");
  if (assets.length === 0) errors.push("manifest must contain at least one asset record");

  for (const asset of assets) {
    const id = text(asset?.id) || "(missing-id)";
    const distribution = text(asset?.distribution);
    const releasePolicy = text(asset?.releasePolicy);
    const paths = Array.isArray(asset?.paths) ? asset.paths : [];

    if (!text(asset?.id)) errors.push("asset record is missing id");
    if (!text(asset?.source?.name) || !text(asset?.source?.url)) {
      errors.push(`${id}: source name and URL are required`);
    }
    if (!text(asset?.license?.name) || !text(asset?.license?.redistribution)) {
      errors.push(`${id}: license name and redistribution status are required`);
    }

    if (distribution === "bundled") {
      if (paths.length === 0) errors.push(`${id}: bundled asset has no paths`);
      if (releasePolicy !== "allowed" && releasePolicy !== "blocked") {
        errors.push(`${id}: bundled releasePolicy must be allowed or blocked`);
      }
      for (const relativePath of paths) {
        if (!text(relativePath) || path.isAbsolute(relativePath)) {
          errors.push(`${id}: bundled path must be repository-relative`);
          continue;
        }
        coveredBundledPaths.add(relativePath);
        const absolutePath = path.join(root, relativePath);
        if (!fs.existsSync(absolutePath)) {
          errors.push(`${id}: missing bundled file ${relativePath}`);
          continue;
        }
        const expectedHash = text(asset?.sha256?.[relativePath]);
        if (!expectedHash) {
          errors.push(`${id}: missing SHA-256 for ${relativePath}`);
          continue;
        }
        const actualHash = sha256File(absolutePath);
        if (actualHash !== expectedHash) {
          errors.push(`${id}: SHA-256 mismatch for ${relativePath}`);
        }
      }
      if (releasePolicy === "blocked") {
        blockers.push(`${id}: bundled redistribution is not cleared`);
      }
      continue;
    }

    if (distribution === "external-user-supplied") {
      if (paths.length > 0) errors.push(`${id}: external integration must not declare bundled paths`);
      if (releasePolicy !== "external-only") {
        errors.push(`${id}: external integration releasePolicy must be external-only`);
      }
      if (asset?.license?.redistribution !== "not-applicable") {
        warnings.push(`${id}: external integration should remain user-supplied and unbundled`);
      }
      continue;
    }

    if (distribution === "remote-on-demand") {
      if (paths.length > 0) errors.push(`${id}: remote-on-demand asset must not declare bundled paths`);
      if (releasePolicy !== "remote-only") {
        errors.push(`${id}: remote-on-demand releasePolicy must be remote-only`);
      }
      if (!/^https:\/\//.test(text(asset?.source?.downloadUrl))) {
        errors.push(`${id}: remote-on-demand source requires an HTTPS downloadUrl`);
      }
      if (!/^[a-f0-9]{64}$/i.test(text(asset?.source?.archiveSha256))) {
        errors.push(`${id}: remote-on-demand source requires a pinned archive SHA-256`);
      }
      if (asset?.license?.projectUse !== "allowed") {
        errors.push(`${id}: remote-on-demand project use must be explicitly allowed`);
      }
      continue;
    }

    errors.push(`${id}: unsupported distribution ${distribution || "(missing)"}`);
  }

  for (const modelPath of discoverBundledModels(root)) {
    if (!coveredBundledPaths.has(modelPath)) {
      errors.push(`unregistered bundled 3D asset: ${modelPath}`);
    }
  }

  return {
    manifestPath,
    assets: assets.length,
    bundled: assets.filter((asset) => asset.distribution === "bundled").length,
    external: assets.filter((asset) => asset.distribution === "external-user-supplied").length,
    remote: assets.filter((asset) => asset.distribution === "remote-on-demand").length,
    errors,
    blockers,
    warnings,
  };
}

function printResult(result, release) {
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  for (const blocker of result.blockers) console.warn(`release blocker: ${blocker}`);
  if (result.errors.length > 0) {
    console.error(`third-party asset audit failed:\n${result.errors.map((item) => `- ${item}`).join("\n")}`);
    return false;
  }
  if (release && result.blockers.length > 0) {
    console.error(`release third-party audit blocked:\n${result.blockers.map((item) => `- ${item}`).join("\n")}`);
    return false;
  }
  console.log(
    `third-party asset audit passed: ${result.assets} records, `
    + `${result.bundled} bundled, ${result.external} external, ${result.remote} remote-on-demand, `
    + `${result.blockers.length} release blocker(s)`,
  );
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const release = process.argv.includes("--release");
  let ok = false;
  try {
    ok = printResult(auditThirdPartyAssets(), release);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(ok ? 0 : 1);
}
