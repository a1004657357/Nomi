import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Real loopback HTTP and production persistence; provider failure/media are fixtures, not live Pavo.
const fixtureToken = 'batch-http-fixture-only-not-a-provider-key';
const serverFile = path.join(process.cwd(), 'integrations/pavo-web-adapter/mock-server.js');
const clientId = 'fixture-console';
const initialTime = Date.parse('2026-10-22T01:00:00Z');
type Row = Record<string, any>;
let root: string;
let baseUrl: string;
let child: ChildProcess | undefined;

async function start() {
  const clock = path.join(root, 'fixture-clock');
  const bootstrap = `
    const fs = require('node:fs');
    const NativeDate = Date;
    const now = () => Number(fs.readFileSync(${JSON.stringify(clock)}, 'utf8'));
    global.Date = class extends NativeDate {
      constructor(...args) { if (args.length) super(...args); else super(now()); }
      static now() { return now(); }
    };
    const http = require('node:http');
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (...args) {
      this.once('listening', () => console.log('FIXTURE_READY:' + this.address().port));
      return listen.apply(this, args);
    };
    require(${JSON.stringify(serverFile)});
  `;
  const processHandle = spawn(process.execPath, ['-e', bootstrap], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH, HOME: root, TZ: 'UTC',
      NOMI_PAVO_WEB_PORT: '0', NOMI_PAVO_WEB_TOKEN: fixtureToken,
      NOMI_PAVO_WEB_DATA_DIR: path.join(root, 'data'),
      NOMI_PAVO_WEB_UPLOADS_DIR: path.join(root, 'uploads'),
      NOMI_PAVO_WEB_INSTANCE_ID: 'fixture-batch-http-only',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = processHandle;
  await new Promise<void>((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => reject(new Error('Fixture HTTP server startup timed out')), 10_000);
    const fail = (error: Error) => { clearTimeout(timer); reject(error); };
    processHandle.once('error', fail);
    processHandle.once('exit', code => fail(new Error(`Fixture server exited during startup: ${code}: ${errors}`)));
    processHandle.stderr!.on('data', chunk => { errors = (errors + String(chunk)).slice(-4096); });
    processHandle.stdout!.on('data', chunk => {
      output = (output + String(chunk)).slice(-4096);
      const port = output.match(/FIXTURE_READY:(\d+)/);
      if (!port) return;
      baseUrl = `http://127.0.0.1:${port[1]}`;
      clearTimeout(timer);
      resolve();
    });
  });
}

async function stop() {
  const current = child;
  child = undefined;
  if (!current || current.exitCode !== null || current.signalCode !== null) return;
  const exited = once(current, 'exit');
  const timer = setTimeout(() => current.kill('SIGKILL'), 3000);
  current.kill('SIGTERM');
  try { await exited; } finally { clearTimeout(timer); }
}

function advance(ms: number) {
  const clock = path.join(root, 'fixture-clock');
  fs.writeFileSync(clock, String(Number(fs.readFileSync(clock, 'utf8')) + ms));
}

async function request(route: string, body?: Row, status = 200) {
  const response = await fetch(baseUrl + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Nomi-Token': fixtureToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json() as Row;
  expect(response.status, JSON.stringify(result)).toBe(status);
  return result;
}

function payload(id = 'one', extra: Row = {}): Row {
  return {
    idempotencyKey: `fixture-${id}`, mediaType: 'video', realSubmit: true,
    prompt: 'FIXTURE ONLY: identical multi-reference prompt, no live provider',
    owner: { projectId: 'fixture-project', nodeId: `fixture-node-${id}` },
    retryPolicy: { maxAttempts: 3 },
    modelConfig: { model: 'Agnes Video 2.5 Flash', duration: '5s', aspectRatio: '9:16' },
    referenceFiles: ['front', 'side'].map(name => ({
      fileName: `${name}.png`, fileType: 'image/png',
      base64: 'data:image/png;base64,' + Buffer.from(`fixture-image-${name}`).toString('base64'),
    })),
    ...extra,
  };
}

async function push(id = 'one', extra: Row = {}) {
  return (await request('/api/tasks/push', payload(id, extra))).taskCodes[0] as string;
}
async function task(code: string) { return (await request(`/api/tasks/${code}`)).task as Row; }
async function all() { return (await request('/api/tasks')).tasks as Row[]; }
async function claim(code: string, status = 200) {
  return request('/api/tasks/submit-claim', {
    taskCode: code, clientId, conversationSnapshotComplete: true,
    conversationBaselineIds: [], outputBaselineUrls: [],
  }, status);
}
async function bind(code: string, conversationId: string, status = 200) {
  return request('/api/tasks/result-binding', { taskCode: code, conversationId }, status);
}
async function submitted(code: string, conversationId = `fixture-conversation-${code}`) {
  const claimed = await claim(code);
  await request('/api/tasks/submit-confirm', { taskCode: code, submitClaimId: claimed.submitClaimId });
  await bind(code, conversationId);
  return { taskCode: code, clientId, submitClaimId: claimed.submitClaimId, conversationId, freshConsoleConfirmed: true };
}
async function fail(code: string, category = 'generation', extra: Row = {}, status = 200) {
  return request('/api/tasks/status', {
    taskCode: code, status: 'failed', error: 'FIXTURE provider failure, not a real Pavo failure',
    failureEvidence: { conversationId: `fixture-conversation-${code}`, status: 'failed', category },
    ...extra,
  }, status);
}
async function retryOf(parent: string) {
  const attempts = (await all()).filter(t => t.parentTaskCode === parent);
  expect(attempts).toHaveLength(1);
  return attempts[0];
}
async function upload(code: string, text: string) {
  const data = new FormData();
  data.set('taskCode', code);
  data.set('quality', 'original');
  data.set('file', new Blob([text], { type: 'video/mp4' }), 'fixture-only.mp4');
  const response = await fetch(baseUrl + '/api/files/upload', {
    method: 'POST', headers: { 'X-Nomi-Token': fixtureToken }, body: data,
  });
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pavo-batch-http-fixture-'));
  fs.writeFileSync(path.join(root, 'fixture-clock'), String(initialTime));
  await start();
});
afterEach(async () => {
  await stop();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Pavo batch/attempt ownership over real local HTTP (provider fixtures only)', () => {
  it('persists distinct batch owners and multi-reference bytes despite identical prompts', async () => {
    const data = [payload('a'), payload('b')];
    const codes = (await request('/api/tasks/push', { tasks: data })).taskCodes;
    expect(new Set(codes).size).toBe(2);
    for (let i = 0; i < codes.length; i++) {
      const row = await task(codes[i]);
      expect(row).toMatchObject({ owner: data[i].owner, rootTaskCode: codes[i], parentTaskCode: null, attemptNumber: 1, retryPolicy: { maxAttempts: 3 } });
      expect(row.referenceFiles).toHaveLength(2);
      const ref = await fetch(baseUrl + row.referenceFiles[1].downloadPath, { headers: { 'X-Nomi-Token': fixtureToken } });
      expect(await ref.text()).toBe('fixture-image-side');
    }
    expect((await request('/api/tasks/push', { tasks: data })).taskCodes).toEqual(codes);
  });

  it('requires matching claim, client, bound conversation and fresh console evidence to release', async () => {
    const first = await push('a');
    const second = await push('b');
    const claimed = await claim(first);
    await claim(second, 409);
    const proof = { taskCode: first, clientId, submitClaimId: claimed.submitClaimId, conversationId: `fixture-conversation-${first}`, freshConsoleConfirmed: true };
    await request('/api/tasks/composer-release', proof, 409);
    await bind(first, proof.conversationId);
    for (const invalid of [{ submitClaimId: 'wrong' }, { clientId: 'wrong' }, { conversationId: 'wrong' }, { freshConsoleConfirmed: false }]) {
      await request('/api/tasks/composer-release', { ...proof, ...invalid }, 409);
    }
    await request('/api/tasks/composer-release', proof);
    const released = (await task(first)).composerReleasedAt;
    expect(released).toBeTruthy();
    advance(1000);
    await request('/api/tasks/composer-release', proof);
    expect((await task(first)).composerReleasedAt).toBe(released);
    await claim(second);
  });

  it('allows two released inflight attempts but never a third or an unreleased composer', async () => {
    const codes = await Promise.all(['a', 'b', 'c'].map(id => push(id)));
    const first = await submitted(codes[0]);
    await claim(codes[1], 409);
    await request('/api/tasks/composer-release', first);
    const second = await submitted(codes[1]);
    await request('/api/tasks/composer-release', second);
    await claim(codes[2], 409);
    await fail(codes[1], 'quota');
    await claim(codes[2]);
    await claim(codes[0], 409);
  });

  it('creates one immutable child per confirmed generation failure, with a persisted 30s cooldown', async () => {
    const code = await push();
    const proof = await submitted(code);
    const old = await task(code);
    await Promise.all(Array.from({ length: 5 }, () => fail(code)));
    const next = await retryOf(code);
    expect(next).toMatchObject({ rootTaskCode: code, parentTaskCode: code, attemptNumber: 2, owner: old.owner, prompt: old.prompt, modelConfig: old.modelConfig });
    expect(Date.parse(next.retryAfter)).toBeGreaterThanOrEqual(initialTime + 30_000);
    expect(next.submitClaimedAt).toBeFalsy();
    const original = (await all()).find(t => t.taskCode === code)!;
    expect(original).toMatchObject({ status: 'failed', submitClaimId: proof.submitClaimId, submitClaimedAt: old.submitClaimedAt });
    expect((await request('/api/tasks/pending')).tasks.map((t: Row) => t.taskCode)).not.toContain(next.taskCode);
    await claim(next.taskCode, 409);
    advance(29_999);
    await claim(next.taskCode, 409);
    advance(1);
    expect((await request('/api/tasks/pending')).tasks.map((t: Row) => t.taskCode)).toContain(next.taskCode);
    const nextRow = await task(next.taskCode);
    const reference = await fetch(baseUrl + nextRow.referenceFiles[0].downloadPath, { headers: { 'X-Nomi-Token': fixtureToken } });
    expect(await reference.text()).toBe('fixture-image-front');
  });

  it('projects only the latest child files to the root without changing persisted file ownership', async () => {
    const code = await push();
    await submitted(code);
    await upload(code, 'FIXTURE old attempt bytes');
    await fail(code);
    const next = await retryOf(code);
    expect(await task(code)).toMatchObject({ taskCode: code, attemptTaskCode: next.taskCode, attemptNumber: 2, owner: payload().owner });
    expect((await request(`/api/files?taskCode=${code}`)).files).toEqual([]);
    advance(30_000);
    await submitted(next.taskCode);
    const asset = await upload(next.taskCode, 'FIXTURE current attempt bytes');
    await request('/api/tasks/status', { taskCode: next.taskCode, status: 'completed' });
    const files = (await request(`/api/files?taskCode=${code}`)).files;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ fileId: asset.fileId, taskCode: code, attemptTaskCode: next.taskCode });
    expect(await task(code)).toMatchObject({ taskCode: code, attemptTaskCode: next.taskCode, status: 'completed' });
    const persisted = JSON.parse(fs.readFileSync(path.join(root, 'data/files.json'), 'utf8'));
    expect(persisted.find((f: Row) => f.fileId === asset.fileId).taskCode).toBe(next.taskCode);
    expect(persisted.some((f: Row) => f.taskCode === code)).toBe(true);
  });

  it('keeps cooldown, root idempotency, historical claims and conversation uniqueness across restart', async () => {
    const code = await push();
    const proof = await submitted(code);
    await fail(code);
    const next = await retryOf(code);
    await stop();
    await start();
    expect(await push()).toBe(code);
    await fail(code);
    expect((await all()).length).toBe(2);
    await claim(next.taskCode, 409);
    advance(30_000);
    await claim(next.taskCode);
    await bind(next.taskCode, proof.conversationId, 409);
    await request('/api/tasks/result-binding', { taskCode: next.taskCode, conversationId: proof.conversationId, confirmed: true }, 409);
    expect((await all()).find(t => t.taskCode === code)!.submitClaimId).toBe(proof.submitClaimId);
  });

  it('caps the root at three attempts and refuses to reopen failed historical attempts', async () => {
    const code = await push();
    let current = code;
    for (let n = 1; n <= 3; n++) {
      const proof = await submitted(current);
      await fail(current);
      await request('/api/tasks/submit-confirm', { taskCode: current, submitClaimId: proof.submitClaimId }, 409);
      await bind(current, proof.conversationId);
      expect((await all()).find(t => t.taskCode === current)!.status).toBe('failed');
      if (n < 3) { current = (await retryOf(current)).taskCode; advance(30_000); }
    }
    expect(await all()).toHaveLength(3);
    expect(await task(code)).toMatchObject({ status: 'failed', attemptNumber: 3, attemptTaskCode: current });
    await fail(current);
    expect(await all()).toHaveLength(3);
  });

  it.each(['auth', 'quota', 'moderation', 'cancelled', 'unknown'])('does not retry fixture category %s', async category => {
    const code = await push();
    await submitted(code);
    await fail(code, category);
    expect(await all()).toHaveLength(1);
    expect((await task(code)).status).toBe('failed');
    await fail(code, 'generation', {}, 409);
    expect(await all()).toHaveLength(1);
  });

  it('rejects missing, mismatched or nonterminal failure evidence and keeps unknown submissions claimed', async () => {
    const code = await push();
    await claim(code);
    await fail(code, 'generation', {}, 409);
    await bind(code, `fixture-conversation-${code}`);
    for (const failureEvidence of [undefined,
      { conversationId: 'other', status: 'failed', category: 'generation' },
      { conversationId: `fixture-conversation-${code}`, status: 'processing', category: 'generation' },
    ]) await fail(code, 'generation', { failureEvidence }, 409);
    await request('/api/tasks/status', { taskCode: code, status: 'unknown' });
    await claim(code, 409);
    expect(await all()).toHaveLength(1);
    expect((await request('/api/tasks/pending')).tasks).toEqual([]);
  });

  it('leaves legacy tasks without an explicit retry policy single-attempt', async () => {
    const code = await push('legacy', { retryPolicy: undefined, owner: undefined });
    await submitted(code);
    await stop();
    const journalFile = path.join(root, 'data/tasks.json');
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as Row[];
    for (const row of journal) {
      for (const key of ['owner', 'retryPolicy', 'rootTaskCode', 'parentTaskCode', 'attemptNumber', 'retryAfter']) delete row[key];
    }
    fs.writeFileSync(journalFile, JSON.stringify(journal));
    await start();
    await fail(code);
    expect(await all()).toHaveLength(1);
    expect((await task(code)).status).toBe('failed');
  });

  it('accepts a matching error-status fixture as a terminal generation failure', async () => {
    const code = await push();
    await submitted(code);
    await fail(code, 'generation', { failureEvidence: {
      conversationId: `fixture-conversation-${code}`, status: 'error', category: 'generation',
    } });
    expect((await retryOf(code)).attemptNumber).toBe(2);
  });

  it('serializes concurrent HTTP claims and retains the two-inflight limit after restart', async () => {
    const first = await push('a');
    const second = await push('b');
    const third = await push('c');
    const body = (taskCode: string) => ({ taskCode, clientId, conversationSnapshotComplete: true, conversationBaselineIds: [] });
    const claims = await Promise.all([first, second].map(code => fetch(baseUrl + '/api/tasks/submit-claim', {
      method: 'POST', headers: { 'X-Nomi-Token': fixtureToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body(code)),
    })));
    expect(claims.map(response => response.status).sort()).toEqual([200, 409]);
    const winner = claims[0].status === 200 ? first : second;
    const loser = winner === first ? second : first;
    const claimed = await task(winner);
    const release = { taskCode: winner, clientId, submitClaimId: claimed.submitClaimId,
      conversationId: `fixture-conversation-${winner}`, freshConsoleConfirmed: true };
    await bind(winner, release.conversationId);
    await request('/api/tasks/composer-release', release);
    const next = await submitted(loser);
    await request('/api/tasks/composer-release', next);
    await stop();
    await start();
    await claim(third, 409);
    expect((await all()).filter(t => t.composerReleasedAt)).toHaveLength(2);
  });

  it('treats root and child conversations as globally reserved even after an attempt fails', async () => {
    const code = await push();
    await submitted(code);
    await fail(code);
    const next = await retryOf(code);
    advance(30_000);
    const proof = await submitted(next.taskCode);
    await request('/api/tasks/composer-release', proof);
    const other = await push('other');
    await claim(other);
    for (const conversationId of [`fixture-conversation-${code}`, proof.conversationId]) {
      await request('/api/tasks/result-binding', { taskCode: other, conversationId, confirmed: true }, 409);
    }
  });

  it.each([
    { mediaType: 'image' },
    { modelConfig: { model: 'Agnes Video 2.5 Flash Pro' } },
    { owner: undefined },
    { retryPolicy: { maxAttempts: 4 } },
    { retryPolicy: { maxAttempts: 2.5 } },
  ])('rejects invalid or non-Flash retry policies before storing a batch ($mediaType)', async extra => {
    await request('/api/tasks/push', { tasks: [payload('valid'), payload('invalid', extra)] }, 400);
    expect(await all()).toHaveLength(0);
  });

  it('rejects reuse of a root idempotency key for a different node owner', async () => {
    await push();
    await request('/api/tasks/push', payload('one', { owner: { projectId: 'fixture-project', nodeId: 'other' } }), 409);
    expect(await all()).toHaveLength(1);
  });

  it('retains HTTP authentication and cross-origin preflight rejection', async () => {
    expect((await fetch(baseUrl + '/api/tasks')).status).toBe(401);
    const preflight = await fetch(baseUrl + '/api/tasks/composer-release', { method: 'OPTIONS', headers: { Origin: 'https://fixture.invalid' } });
    expect(preflight.status).toBe(403);
  });
});
