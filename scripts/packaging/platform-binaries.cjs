const fs = require("node:fs");
const path = require("node:path");

const PLATFORM_PACKAGES = Object.freeze({
  ffmpeg: Object.freeze([
    "darwin-arm64", "darwin-x64", "linux-arm", "linux-arm64",
    "linux-ia32", "linux-x64", "win32-ia32", "win32-x64",
  ]),
  ffprobe: Object.freeze([
    "darwin-arm64", "darwin-x64", "linux-arm", "linux-arm64",
    "linux-ia32", "linux-x64", "win32-ia32", "win32-x64",
  ]),
});

const ARCH_NAMES = Object.freeze({
  0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64",
  ia32: "ia32", x64: "x64", armv7l: "armv7l", arm64: "arm64",
});

function normalizeArch(arch) {
  const name = ARCH_NAMES[arch] || String(arch || "");
  return name === "armv7l" ? "arm" : name;
}

function targetPackageName(electronPlatformName, arch) {
  const platform = String(electronPlatformName || "").trim();
  const normalizedPlatform = platform === "windows" ? "win32" : platform;
  const target = `${normalizedPlatform}-${normalizeArch(arch)}`;
  for (const names of Object.values(PLATFORM_PACKAGES)) {
    if (names.includes(target)) return target;
  }
  throw new Error(`Unsupported packaged media target: ${platform}/${String(arch)}`);
}

function prunePlatformBinaries(unpackedNodeModulesPath, electronPlatformName, arch) {
  const target = targetPackageName(electronPlatformName, arch);
  const removed = [];
  for (const [family, packageNames] of Object.entries(PLATFORM_PACKAGES)) {
    const familyPath = path.join(unpackedNodeModulesPath, `@${family}-installer`);
    if (!fs.existsSync(familyPath)) continue;
    for (const packageName of packageNames) {
      if (packageName === target) continue;
      const packagePath = path.join(familyPath, packageName);
      if (!fs.existsSync(packagePath)) continue;
      fs.rmSync(packagePath, { recursive: true, force: true });
      removed.push(`@${family}-installer/${packageName}`);
    }
  }
  return { target, removed };
}

module.exports = { ARCH_NAMES, PLATFORM_PACKAGES, normalizeArch, targetPackageName, prunePlatformBinaries };

