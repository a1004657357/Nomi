// Explicitly authorized, isolated real-provider acceptance. Never retries a create.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { app, safeStorage, nativeImage, session } = require('electron');

const repoRoot = path.resolve(__dirname, '../..');
const runRoot = process.env.NOMI_ACCEPTANCE_RUN_ROOT;
const channel = process.env.NOMI_ACCEPTANCE_CHANNEL;
const paid = process.env.NOMI_SPEND_OK === '1';
const batch = process.env.NOMI_ACCEPTANCE_BATCH === '1';
if (batch && channel !== 'cliproxy') throw new Error('Batch acceptance is limited to CLIProxy');
if (!runRoot || !path.isAbsolute(runRoot) || !['cliproxy', 'plan'].includes(channel)) {
  throw new Error('An absolute isolated NOMI_ACCEPTANCE_RUN_ROOT and cliproxy/plan channel are required');
}
if (!process.env.NOMI_ACCEPTANCE_NONCE || fs.readFileSync(path.join(runRoot, '.nomi-acceptance'), 'utf8') !== process.env.NOMI_ACCEPTANCE_NONCE
  || fs.existsSync(path.join(runRoot, 'report.json'))) throw new Error('Use the fresh-run acceptance launcher; never replay an existing run');
const userData = path.join(runRoot, 'user-data');
const settings = path.join(runRoot, 'settings');
const projects = path.join(runRoot, 'projects');
for (const dir of [runRoot, userData, settings, projects]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
Object.assign(process.env, {
  NOMI_ELECTRON_USER_DATA_DIR: userData, NOMI_SETTINGS_DIR: settings,
  NOMI_PROJECTS_DIR: projects, NOMI_CAPABILITY_DIR: path.join(runRoot, 'capability'),
});
app.setName('nomi');
app.setPath('userData', userData);
app.setPath('logs', path.join(userData, 'logs'));
if (!app.requestSingleInstanceLock()) throw new Error('Acceptance profile is already in use');

const report = { runId: path.basename(runRoot), channel, startedAt: new Date().toISOString(),
  state: 'running', paidAuthorized: paid, createIntents: 0, maxCreateIntents: batch ? 4 : 2,
  upstreamInternalAttempts: 'unavailable', automaticHarnessRetry: false,
  credentialsRemoved: false, cases: [], projectId: null };
const reportPath = path.join(runRoot, 'report.json');
const secrets = [];
const intentContext = new AsyncLocalStorage();
const nativeFetch = globalThis.fetch.bind(globalThis);
// Observe the real production HTTP entry; fail before any fallback can create twice.
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const provider = (url.hostname === '127.0.0.1' && url.port === '8317') || url.hostname === 'ark.cn-beijing.volces.com';
  if (provider && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const activeIntent = intentContext.getStore();
    if (!paid || !activeIntent) throw new Error('Provider POST blocked outside an authorized media intent');
    if (activeIntent.httpPosts >= 1) {
      activeIntent.blockedAdditionalPost = true;
      persist();
      throw new Error('A second provider POST was blocked before transmission');
    }
    activeIntent.httpPosts += 1;
    activeIntent.httpRequest = { method, origin: url.origin, path: url.pathname, sentAt: new Date().toISOString() };
    const fields = ['model', 'size', 'quality', 'n', 'ratio', 'resolution', 'duration'];
    if (typeof init?.body === 'string') {
      const body = JSON.parse(init.body);
      activeIntent.httpRequest.parameters = Object.fromEntries(fields.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
    } else if (init?.body instanceof FormData) {
      activeIntent.httpRequest.parameters = Object.fromEntries(fields.filter(key => init.body.has(key)).map(key => [key, init.body.get(key)]));
      activeIntent.httpRequest.referenceFileCount = [...init.body.values()].filter(value => typeof value !== 'string').length;
    }
    persist();
    try {
      const response = await nativeFetch(input, init);
      activeIntent.httpStatus = response.status;
      persist();
      return response;
    } catch (error) {
      activeIntent.transportError = { name: error.name, causeCode: error.cause?.code, causeMessage: scrub(error.cause?.message) };
      persist();
      throw error;
    }
  }
  return nativeFetch(input, init);
};
const scrub = value => {
  let text = String(value || '');
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').slice(0, 1200);
};
const persist = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const status = stage => { report.stage = stage; persist(); console.log(JSON.stringify({ runId: report.runId, stage })); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceCatalog = path.join(app.getPath('appData'), 'nomi', 'model-catalog.json');
const originalFingerprint = () => fs.existsSync(sourceCatalog) ? hash(fs.readFileSync(sourceCatalog)) : null;
report.originalCatalogBefore = originalFingerprint();
persist();

app.whenReady().then(async () => {
  require('tsx/cjs');
  const { applySystemProxy } = require(path.join(repoRoot, 'electron/systemProxy.ts'));
  const { readProxyPrefs } = require(path.join(repoRoot, 'electron/proxySettings.ts'));
  const route = await applySystemProxy(session.defaultSession, readProxyPrefs());
  report.networkRoute = { kind: route.kind, source: route.source };
  status('loading-production-runtime');
  const runtime = require(path.join(repoRoot, 'electron/runtime.ts'));
  const catalog = require(path.join(repoRoot, 'electron/catalog/catalogStore.ts'));
  const { mintSpendGrant } = require(path.join(repoRoot, 'electron/spendGrant.ts'));
  const { quoteSpendLine } = require(path.join(repoRoot, 'electron/spendQuote.ts'));
  if (!safeStorage.isEncryptionAvailable()) throw new Error('System credential storage is unavailable');
  catalog.ensureBuiltinModelSeeds();
  let vendorKey;
  let imageModel;
  if (channel === 'cliproxy') {
    const dependencyRequire = createRequire(path.join(repoRoot, 'node_modules/.pnpm/node_modules/acceptance.cjs'));
    const config = dependencyRequire('js-yaml').load(fs.readFileSync('/usr/local/etc/cliproxyapi.conf', 'utf8'));
    const key = config.access?.['api-keys']?.find(value => typeof value === 'string' && value.trim());
    if (!key) throw new Error('CLIProxy has no configured client key');
    secrets.push(key);
    report.proxyRequestRetry = config.routing?.retry?.['request-retry'] ?? null;
    vendorKey = 'acceptance-cliproxy';
    imageModel = 'gpt-image-2';
    catalog.upsertModelCatalogVendor({ key: vendorKey, name: 'CLIProxy acceptance',
      baseUrlHint: 'http://127.0.0.1:8317', authType: 'bearer', providerKind: 'openai-compatible', enabled: true,
      network: { proxyEnabled: false } });
    catalog.upsertModelCatalogVendorApiKey(vendorKey, { apiKey: key, enabled: true });
    status('certifying-cli-proxy-shape-without-generation');
    const { ConnectionCertificationService } = require(path.join(repoRoot, 'electron/integrationCertification/service.ts'));
    const certification = new ConnectionCertificationService();
    const started = await certification.startExistingHttp({ entryPoint: 'programmatic-session', vendorKey,
      models: [{ modelKey: imageModel, kind: 'image' }], idempotencyKey: `${report.runId}-certification` });
    if (!started.ok) throw new Error(`Certification could not start: ${started.code}`);
    const terminal = new Set(['completed', 'partial', 'failed', 'needs_ai', 'cancelled', 'timed_out', 'stale']);
    const deadline = Date.now() + 120_000;
    let current = started.run;
    while (!terminal.has(current.stage) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
      current = certification.get(started.run.id);
      if (!current) throw new Error('Certification run disappeared');
    }
    report.certification = { runId: current.id, stage: current.stage, evidence: 'self-check-not-media-generation' };
    if (current.stage !== 'completed') throw new Error(`Certification ended in ${current.stage}`);
    const published = catalog.readCatalog().models.filter(model => model.modelKey === imageModel && model.meta?.adapter?.activeRevision);
    if (published.length !== 1) throw new Error('Certification did not identify one published model');
    vendorKey = published[0].vendorKey;
  } else {
    vendorKey = 'volcengine-agent-plan';
    imageModel = 'doubao-seedream-5.0-pro';
    if (!fs.existsSync(sourceCatalog)) throw new Error('Nomi real catalog is missing');
    const original = JSON.parse(fs.readFileSync(sourceCatalog, 'utf8'));
    const record = original.apiKeysByVendor?.[vendorKey];
    const { decryptApiKeyRecord } = require(path.join(repoRoot, 'electron/catalog/secrets.ts'));
    const key = decryptApiKeyRecord(record);
    if (!key) throw new Error('Existing Plan credential cannot be opened by this system-keychain host');
    secrets.push(key);
    catalog.upsertModelCatalogVendorApiKey(vendorKey, { apiKey: key, enabled: true });
  }
  const resolved = runtime.findExecutableModel(vendorKey, imageModel, 'image');
  report.credentialReady = Boolean(resolved.apiKey);
  report.modelKey = resolved.model.modelKey;
  report.providerBaseUrl = resolved.vendor.baseUrlHint;
  const previewRequest = { kind: 'text_to_image', prompt: 'Network-free contract preview',
    extras: { modelKey: imageModel, size: channel === 'cliproxy' ? '1024x1024' : '1K',
      aspect_ratio: '1:1', resolution: '1K', quality: 'low', n: 1 } };
  const previewMapping = runtime.findTaskMapping(vendorKey, 'text_to_image', imageModel);
  const preview = runtime.buildProfileHttpRequest({ ...resolved, request: previewRequest, operation: previewMapping.create });
  report.compiledParameters = Object.fromEntries(['model', 'size', 'quality', 'n'].filter(key => preview.body?.[key] !== undefined).map(key => [key, preview.body[key]]));
  if (channel === 'plan') {
    const { appFetch } = require(path.join(repoRoot, 'electron/appFetch.ts'));
    const response = await appFetch(`${resolved.vendor.baseUrlHint.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${resolved.apiKey}` }, signal: AbortSignal.timeout(15_000),
    });
    report.connectionProbeHttpStatus = response.status;
    await response.body?.cancel();
    if ([401, 403].includes(response.status)) throw new Error(`Plan credential probe was rejected (HTTP ${response.status})`);
  }
  status('credential-and-mapping-ready');
  if (!paid) { report.state = 'preflight_passed'; return; }

  const project = runtime.createProject({ name: `真实渠道验收-${channel}-${report.runId}`, version: 1, payload: {} });
  report.projectId = project.id;
  const templates = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/ux/fixtures/perf-heavy.project.json'), 'utf8')).payload.generationCanvas.nodes;
  const { buildCatalogTaskRequest } = require(path.join(repoRoot, 'src/workbench/generationCanvas/runner/catalogTaskActions.ts'));
  const { resolveArchetypeForModel } = require(path.join(repoRoot, 'electron/shared/modelArchetypes/index.ts'));
  const nodes = [];
  const edges = [];
  async function generate(name, modelKey, kind, prompt, parameters) {
    if (report.createIntents >= report.maxCreateIntents) throw new Error('Create intent budget exhausted');
    const nodeId = `acceptance-${name}`;
    const quote = quoteSpendLine({ vendorKey, modelKey, parameters });
    const grantId = mintSpendGrant({ nodeIds: [nodeId], maxAttemptsPerNode: 1,
      quote: { lines: [quote], amount: quote.amount } });
    const publicParameters = Object.fromEntries(Object.entries(parameters).filter(([, value]) =>
      typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && !/^(data:|https?:|nomi-local:)/.test(value))));
    const entry = { name, nodeId, vendorKey, modelKey, kind, startedAt: new Date().toISOString(), state: 'submitting',
      requested: publicParameters, hasReference: Boolean(parameters.referenceImages?.length || parameters.firstFrameUrl),
      httpPosts: 0, actualCost: 'unavailable' };
    const archetype = channel === 'cliproxy' ? resolveArchetypeForModel({ modelKey, vendorKey }) : null;
    const submissionNode = archetype ? {
      ...templates.find(node => node.kind === 'image'), id: nodeId, kind: 'image', prompt,
      meta: { ...parameters, modelKey, modelVendor: vendorKey, vendor: vendorKey,
        archetype: { id: archetype.id, modeId: kind === 'image_edit' ? 'i2i' : 't2i' } },
    } : null;
    const request = submissionNode ? buildCatalogTaskRequest(submissionNode, {
      grantId, idempotencyKey: `${report.runId}-${name}`,
      references: { referenceImages: parameters.referenceImages || [] },
    }).request : { kind, prompt, extras: { ...parameters, modelKey, nodeId, grantId } };
    if (request.kind !== kind) throw new Error('Canvas task mode differs from the authorized intent');
    request.extras = { ...request.extras, projectId: project.id,
      idempotencyKey: `${report.runId}-${name}`, maxNetworkAttempts: 1 };
    entry.canvasAssembly = Boolean(submissionNode);
    entry.projectedModeModel = request.extras.archetypeInput?.model || null;
    report.cases.push(entry);
    report.createIntents += 1;
    status(`submitting-${name}`);
    const start = Date.now();
    return intentContext.run(entry, async () => { try {
      let result = await runtime.runTask({ vendor: vendorKey, request });
      entry.taskId = result.id;
      entry.state = result.status;
      persist();
      const deadline = Date.now() + 15 * 60_000;
      while (!['succeeded', 'failed'].includes(result.status) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10_000));
        result = (await runtime.fetchTaskResult({ taskId: entry.taskId })).result;
        entry.state = result.status;
        persist();
      }
      if (result.status !== 'succeeded' || !result.assets.length) throw new Error(result.error || `Task state ${result.status}`);
      if (entry.httpPosts !== 1) throw new Error('Acceptance requires exactly one observed production POST');
      const assets = runtime.listProjectAssets({ projectId: project.id }).items;
      const asset = result.assets[0];
      const stored = assets.find(item => item.id === asset.assetId);
      const file = stored?.data?.absolutePath;
      if (!file || !fs.existsSync(file)) throw new Error('Production asset was not persisted');
      const bytes = fs.readFileSync(file);
      entry.asset = { id: asset.assetId, path: file, bytes: bytes.length, sha256: hash(bytes), type: asset.type };
      let referenceDataUrl;
      if (asset.type === 'image') {
        const image = nativeImage.createFromBuffer(bytes);
        const size = image.getSize();
        if (image.isEmpty() || size.width < 512 || size.height < 512) throw new Error('Generated image is not decodable or is too small');
        entry.asset.width = size.width;
        entry.asset.height = size.height;
        const exactSize = String(parameters.size || '').match(/^(\d+)x(\d+)$/);
        entry.pixelSizeMatched = exactSize ? size.width === Number(exactSize[1]) && size.height === Number(exactSize[2]) : null;
        const ratioText = parameters.aspect_ratio || parameters.ratio;
        if (typeof ratioText === 'string' && /^\d+:\d+$/.test(ratioText)) {
          const [w, h] = ratioText.split(':').map(Number);
          entry.aspectRatioMatched = Math.abs(size.width / size.height - w / h) <= 0.025;
          if (!entry.aspectRatioMatched) throw new Error(`Requested ratio ${ratioText}, received ${size.width}x${size.height}; asset retained, not accepted`);
        }
        referenceDataUrl = `data:image/png;base64,${image.toPNG().toString('base64')}`;
      } else if (asset.type === 'video') {
        const probe = JSON.parse(execFileSync(process.env.NOMI_FFPROBE_PATH || 'ffprobe',
          ['-v', 'error', '-show_entries', 'stream=width,height,codec_type:format=duration', '-of', 'json', file], { encoding: 'utf8', timeout: 30_000 }));
        const video = probe.streams.find(stream => stream.codec_type === 'video');
        const seconds = Number(probe.format?.duration);
        if (!video?.width || !video?.height || !Number.isFinite(seconds) || seconds <= 0) throw new Error('Video metadata is not valid');
        execFileSync(require('@ffmpeg-installer/ffmpeg').path,
          ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'null', '-'], { timeout: 30_000, stdio: 'pipe' });
        entry.asset.width = video.width; entry.asset.height = video.height; entry.asset.durationSeconds = seconds;
        const [ratioWidth, ratioHeight] = String(parameters.ratio || '').split(':').map(Number);
        entry.aspectRatioMatched = Boolean(ratioWidth && ratioHeight)
          && Math.abs(video.width / video.height - ratioWidth / ratioHeight) <= 0.025;
        if (!entry.aspectRatioMatched) throw new Error('Video aspect ratio does not match the request');
        entry.pixelSizeMatched = null;
        entry.resolutionAcceptance = 'unverified_no_official_pixel_matrix';
        if (Math.abs(seconds - Number(parameters.duration)) > 1) throw new Error('Video duration does not match the requested duration');
      }
      if (result.provenance?.cost) entry.actualCost = result.provenance.cost;
      const template = templates.find(node => node.kind === asset.type);
      const node = { ...template, id: nodeId, title: name, kind: asset.type, prompt,
        position: { x: 80 + nodes.length * 420, y: 80 }, references: [], history: [], runs: [], status: 'success',
        result: { id: asset.assetId, assetId: asset.assetId, type: asset.type, url: asset.url, createdAt: Date.now() },
        meta: { modelKey, modelVendor: vendorKey, vendor: vendorKey, ...publicParameters,
          ...(submissionNode ? { archetype: submissionNode.meta.archetype } : {}) } };
      if (nodes.length && entry.hasReference) edges.push({ id: `edge-${nodes[0].id}-${nodeId}`, source: nodes[0].id,
        target: nodeId, mode: asset.type === 'video' ? 'first_frame' : 'style_ref', order: 0 });
      nodes.push(node);
      await runtime.saveProject(project.id, { ...project, draft: false,
        payload: { generationCanvas: { nodes, edges, groups: [], selectedNodeIds: [] } } });
      const readBack = runtime.readProject(project.id);
      entry.canvasReadBack = readBack.payload.generationCanvas.nodes.some(node => node.id === nodeId && node.result?.url === asset.url);
      if (!entry.canvasReadBack) throw new Error('Canvas result did not survive project readback');
      entry.state = entry.pixelSizeMatched === false || entry.resolutionAcceptance ? 'partial' : 'passed';
      entry.elapsedMs = Date.now() - start;
      persist();
      return { result, bytes, dataUrl: referenceDataUrl };
    } catch (error) {
      entry.state = 'failed'; entry.elapsedMs = Date.now() - start;
      entry.error = { name: error.name, message: scrub(error.message), httpStatus: error.structured?.httpStatus,
        category: error.structured?.category, upstreamCode: error.structured?.upstreamCode };
      persist();
      throw error;
    } });
  }

  const initial = await generate('image', imageModel, 'text_to_image',
    `Square 1:1 photograph, exactly 1024 by 1024 pixels. One red ceramic cup beside one green pear on a grey kitchen table, soft neutral daylight, no text, no people. Acceptance ${report.runId}.`,
    channel === 'cliproxy' ? { size: '1024x1024', aspect_ratio: '1:1', resolution: '1K', quality: 'low', n: 1 }
      : { size: '1K', aspect_ratio: '1:1', n: 1 });
  if (channel === 'cliproxy' && batch) {
    const { createGenerationProviderScheduler } = require(path.join(repoRoot, 'src/workbench/generationCanvas/runner/generationProviderScheduler.ts'));
    const scheduler = createGenerationProviderScheduler({ globalLimit: 2, defaultProviderLimit: 2 });
    report.batch = { concurrencyLimit: 2, productionDefaultCertified: false, queueEvents: [], snapshots: [], maxActive: 0 };
    const jobs = ['blue', 'yellow', 'purple'].map(color => scheduler.run(vendorKey, async () => {
      const snapshot = scheduler.snapshot();
      report.batch.maxActive = Math.max(report.batch.maxActive, snapshot.active);
      report.batch.snapshots.push({ at: new Date().toISOString(), ...snapshot });
      persist();
      return generate(`reference-${color}`, imageModel, 'image_edit',
        `Keep the same square photograph, exactly 1024x1024 pixels. Change only the red cup to ${color}. Preserve the green pear, kitchen table, light and camera position. One image, no lettering.`,
        { size: '1024x1024', aspect_ratio: '1:1', resolution: '1K', quality: 'low', n: 1, referenceImages: [initial.dataUrl] });
    }, { onQueueWait: event => { report.batch.queueEvents.push({ color, ...event }); persist(); } }));
    const outcomes = await Promise.allSettled(jobs);
    report.batch.outcomes = outcomes.map(result => ({ status: result.status }));
    report.batch.finalSnapshot = scheduler.snapshot();
    const savedNodes = runtime.readProject(project.id).payload.generationCanvas.nodes;
    report.batch.persistedNodeBindings = report.cases.map(entry => ({ nodeId: entry.nodeId,
      matches: savedNodes.some(node => node.id === entry.nodeId && node.result?.assetId === entry.asset?.id) }));
    report.batch.distinctAssets = new Set(report.cases.map(entry => entry.asset?.sha256).filter(Boolean)).size;
    report.batch.transportPassed = outcomes.every(result => result.status === 'fulfilled')
      && report.batch.maxActive === 2 && report.batch.queueEvents.length > 0
      && report.batch.finalSnapshot.active === 0 && report.batch.finalSnapshot.queued === 0
      && report.batch.distinctAssets === 4 && report.batch.persistedNodeBindings.every(item => item.matches)
      && report.cases.every(entry => entry.httpPosts === 1 && entry.canvasReadBack);
  } else if (channel === 'cliproxy') {
    await generate('reference-edit', imageModel, 'image_edit',
      'Keep the square 1:1 image and its 1024 by 1024 pixel output. Change only the red ceramic cup to blue. Keep the pear, table, daylight and camera position unchanged. One image.',
      { size: '1024x1024', aspect_ratio: '1:1', resolution: '1K', quality: 'low', n: 1, referenceImages: [initial.dataUrl] });
  } else {
    await generate('reference-video', 'doubao-seedance-2.0', 'image_to_video',
      'Use the reference as the first frame. A single continuous static-camera shot: the ceramic cup slides gently a short distance toward the pear and comes to rest. The pear remains still. Preserve the tabletop, object shapes and neutral daylight. No text, no cuts.',
      { model: 'doubao-seedance-2.0-fast', variantId: 'fast', archetype: { id: 'volcengine-plan-seedance', modeId: 'first', variantId: 'fast' },
        firstFrameUrl: initial.dataUrl, ratio: '1:1', resolution: '480p', duration: 4, generate_audio: false });
  }
  report.state = report.cases.some(entry => entry.state === 'failed') || report.batch?.transportPassed === false
    ? 'failed' : report.cases.every(entry => entry.state === 'passed') ? 'passed' : 'partial';
  if (report.state === 'failed') process.exitCode = 1;
}).catch(error => {
  report.state = 'failed';
  report.error = { name: error.name, message: scrub(error.message), httpStatus: error.structured?.httpStatus,
    category: error.structured?.category };
  process.exitCode = 1;
}).finally(() => {
  for (const file of fs.readdirSync(settings)) {
    if (file.startsWith('model-catalog') && file.endsWith('.json')) fs.rmSync(path.join(settings, file), { force: true });
  }
  report.credentialsRemoved = !fs.readdirSync(settings).some(file => file.startsWith('model-catalog') && file.endsWith('.json'));
  report.originalCatalogAfter = originalFingerprint();
  report.originalCatalogUnchanged = report.originalCatalogBefore === report.originalCatalogAfter;
  report.finishedAt = new Date().toISOString();
  persist();
  console.log(JSON.stringify({ runId: report.runId, state: report.state, createIntents: report.createIntents, reportPath }));
  app.exit(process.exitCode || 0);
});
