const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { auditPackagedMedia } = require("./audit-packaged-media.cjs");
const { prunePlatformBinaries, targetPackageName } = require("./platform-binaries.cjs");

assert.equal(targetPackageName("darwin", 3), "darwin-arm64");
assert.equal(targetPackageName("win32", "x64"), "win32-x64");
assert.throws(() => targetPackageName("darwin", "universal"), /Unsupported packaged media target/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-packaging-test-"));
for (const family of ["ffmpeg", "ffprobe"]) {
  const familyPath = path.join(root, `@${family}-installer`);
  fs.mkdirSync(familyPath, { recursive: true });
  for (const packageName of ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"]) {
    fs.mkdirSync(path.join(familyPath, packageName), { recursive: true });
  }
}

const result = prunePlatformBinaries(root, "darwin", 3);
assert.equal(result.target, "darwin-arm64");
assert.equal(result.removed.length, 6);
assert.ok(fs.existsSync(path.join(root, "@ffmpeg-installer", "darwin-arm64")));
assert.ok(fs.existsSync(path.join(root, "@ffprobe-installer", "darwin-arm64")));
assert.ok(!fs.existsSync(path.join(root, "@ffmpeg-installer", "win32-x64")));
assert.ok(!fs.existsSync(path.join(root, "@ffprobe-installer", "linux-x64")));
const audit = auditPackagedMedia(root, "darwin", 3);
assert.equal(audit.target, "darwin-arm64");
assert.deepEqual(audit.families.ffmpeg.map(({ packageName }) => packageName), ["darwin-arm64"]);
assert.deepEqual(audit.families.ffprobe.map(({ packageName }) => packageName), ["darwin-arm64"]);
fs.rmSync(root, { recursive: true, force: true });

console.log("PACKAGED MEDIA BINARY TEST PASS");

