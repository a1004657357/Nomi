// Replays retained real image bytes through production recovery; never submits a provider request.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');
const root = process.env.NOMI_ACCEPTANCE_RUN_ROOT;
const sourceReport = process.env.NOMI_ACCEPTANCE_REPLAY_REPORT;
if (!root || !path.isAbsolute(root) || !sourceReport || !path.isAbsolute(sourceReport)) throw new Error('Explicit isolated paths required');
if (!process.env.NOMI_ACCEPTANCE_NONCE || fs.readFileSync(path.join(root, '.nomi-acceptance'), 'utf8') !== process.env.NOMI_ACCEPTANCE_NONCE
  || fs.existsSync(path.join(root, 'report.json'))) throw new Error('Fresh launcher required');
const settings = path.join(root, 'settings');
const userData = path.join(root, 'user-data');
for (const dir of [settings, userData]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
Object.assign(process.env, { NOMI_SETTINGS_DIR: settings, NOMI_ELECTRON_USER_DATA_DIR: userData,
  NOMI_PROJECTS_DIR: path.join(root, 'projects'), NOMI_CAPABILITY_DIR: path.join(root, 'capability') });
app.setName('nomi');
app.setPath('userData', userData);
const report = { runId: path.basename(root), state: 'running', mode: 'real-asset-recovery-no-generation',
  startedAt: new Date().toISOString(), sourceReport, networkAttempts: 0, cases: [] };
const persist = () => fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
globalThis.fetch = async () => { report.networkAttempts++; persist(); throw new Error('Network forbidden during recovery replay'); };
persist();
app.whenReady().then(async () => {
  require('tsx/cjs');
  const runtime = require('../../electron/runtime.ts');
  const { NEWAPI_IMAGE_CREATE_OP } = require('../../electron/catalog/newapiTransport.ts');
  const { requestedImageSizeFromBody } = require('../../electron/review/imageSizeSpecification.ts');
  const source = JSON.parse(fs.readFileSync(sourceReport, 'utf8'));
  const project = runtime.createProject({ name: `CLIProxy-size-recovery-${report.runId}`, version: 1, payload: {} });
  report.projectId = project.id;
  for (const entry of source.cases) {
    const bytes = fs.readFileSync(entry.asset.path);
    if (sha(bytes) !== entry.asset.sha256) throw new Error('Source asset changed');
    const expectedImageSize = requestedImageSizeFromBody(entry.httpRequest.parameters);
    const result = await runtime.buildProfileTaskResult({
      response: { data: [{ b64_json: bytes.toString('base64') }] },
      mapping: { create: NEWAPI_IMAGE_CREATE_OP }, operation: NEWAPI_IMAGE_CREATE_OP,
      request: { kind: 'text_to_image', prompt: 'Retained real output recovery; no provider submission' },
      taskIdFallback: `recovery-${entry.nodeId}`, wantedKind: 'image', projectId: project.id,
      nodeId: entry.nodeId, expectedImageSize,
    });
    const asset = result.result.assets[0];
    const stored = runtime.listProjectAssets({ projectId: project.id }).items.find(item => item.id === asset.assetId);
    const output = stored?.data?.absolutePath;
    const sidecar = JSON.parse(fs.readFileSync(`${output}.meta`, 'utf8'));
    const evidence = asset.imageSizeValidation;
    const passed = result.result.status === 'succeeded' && evidence?.status === 'mismatch'
      && evidence.requested.width === 1024 && evidence.actual.width === 1254
      && evidence.originalPreserved === true && evidence.normalizationApplied === false
      && JSON.stringify(sidecar.imageSizeValidation) === JSON.stringify(evidence)
      && sha(fs.readFileSync(output)) === entry.asset.sha256 && sha(fs.readFileSync(entry.asset.path)) === entry.asset.sha256;
    report.cases.push({ nodeId: entry.nodeId, state: passed ? 'passed' : 'failed', assetId: asset.assetId,
      path: output, originalSha256: entry.asset.sha256, imageSizeValidation: evidence, pixelsUnchanged: passed });
    persist();
    if (!passed) throw new Error('Recovered original or dimension evidence mismatch');
  }
  report.state = report.cases.length === 4 && report.networkAttempts === 0 ? 'passed' : 'failed';
}).catch(error => { report.state = 'failed'; report.error = String(error.message).slice(0, 400); })
  .finally(() => { report.finishedAt = new Date().toISOString(); persist(); app.exit(report.state === 'passed' ? 0 : 1); });
