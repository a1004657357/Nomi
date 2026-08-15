const fs = require('node:fs');
const path = require('node:path');
const { PLATFORM_PACKAGES, targetPackageName } = require('./platform-binaries.cjs');

function directoryBytes(root) {
  if (!fs.existsSync(root)) return 0;
  const stat = fs.statSync(root);
  if (stat.isFile()) return stat.size;
  return fs.readdirSync(root).reduce((total, entry) => total + directoryBytes(path.join(root, entry)), 0);
}

function findUnpackedRoot(input) {
  const candidates = [
    input,
    path.join(input, 'app.asar.unpacked', 'node_modules'),
    path.join(input, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules'),
    path.join(input, 'Resources', 'app.asar.unpacked', 'node_modules'),
    path.join(input, 'resources', 'app.asar.unpacked', 'node_modules'),
  ];
  const result = candidates.find((candidate) => fs.existsSync(path.join(candidate, '@ffmpeg-installer')) || fs.existsSync(path.join(candidate, '@ffprobe-installer')));
  if (!result) throw new Error(`Could not find app.asar.unpacked/node_modules below ${input}`);
  return result;
}

function auditPackagedMedia(input, platform, arch) {
  const target = targetPackageName(platform, arch);
  const nodeModules = findUnpackedRoot(path.resolve(input));
  const families = Object.fromEntries(Object.keys(PLATFORM_PACKAGES).map((family) => {
    const root = path.join(nodeModules, `@${family}-installer`);
    const present = PLATFORM_PACKAGES[family]
      .filter((packageName) => fs.existsSync(path.join(root, packageName)))
      .map((packageName) => ({ packageName, bytes: directoryBytes(path.join(root, packageName)) }));
    return [family, present];
  }));
  const foreign = Object.values(families).flat().filter(({ packageName }) => packageName !== target);
  if (foreign.length) {
    throw new Error(`Foreign packaged media targets remain: ${foreign.map(({ packageName }) => packageName).join(', ')}`);
  }
  return { input: path.resolve(input), platform, arch, target, families };
}

if (require.main === module) {
  const [input, platform = process.platform, arch = process.arch] = process.argv.slice(2);
  if (!input) throw new Error('Usage: node scripts/packaging/audit-packaged-media.cjs <app-or-resources-path> <platform> <arch>');
  console.log(JSON.stringify(auditPackagedMedia(input, platform, arch), null, 2));
}

module.exports = { auditPackagedMedia, directoryBytes, findUnpackedRoot };

