import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import { assessRoundTrip, createDiskDocumentPort, createTransportGuard, ENDPOINT, MAX_POSTS, MODEL_ID, readNativeSession, verifyRecordedRun } from './cliproxy-real.mjs';

const post = (nonce: number, model = MODEL_ID): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: `fixture-${nonce}` }] }),
});
const okTransport: typeof fetch = async () => new Response('fixture', { status: 200 });

test('hard budget counts at most eight actual POSTs across turns', async () => {
  let sent = 0;
  const guard = createTransportGuard({ transport: async () => { sent++; return new Response('ok'); }, signal: new AbortController().signal });
  for (let i = 0; i < MAX_POSTS; i++) {
    guard.setTurn(i < 4 ? 1 : 2);
    await (await guard.fetch(ENDPOINT, post(i))).text();
  }
  await assert.rejects(guard.fetch(ENDPOINT, post(9)), /POST_LIMIT/);
  assert.equal(sent, 8);
  assert.equal(guard.requests.length, 8);
});

test('refuses another origin, path, URL query, method or model before transport', async () => {
  for (const [url, init] of [
    ['https://example.test/v1/chat/completions', post(1)],
    ['http://127.0.0.1:8317/v1/responses', post(1)],
    [ENDPOINT + '?key=fixture', post(1)],
    [ENDPOINT, { method: 'GET' }],
    [ENDPOINT, post(1, 'another-model')],
  ] as Array<[string, RequestInit]>) {
    let sent = 0;
    const guard = createTransportGuard({ transport: async () => { sent++; return new Response(); }, signal: new AbortController().signal });
    await assert.rejects(guard.fetch(url, init), /REFUSED/);
    assert.equal(sent, 0);
  }
});

test('never transmits a repeated payload as an SDK retry', async () => {
  let sent = 0;
  const guard = createTransportGuard({ transport: async () => { sent++; return new Response('ok'); }, signal: new AbortController().signal });
  await (await guard.fetch(ENDPOINT, post(1))).text();
  await assert.rejects(guard.fetch(ENDPOINT, post(1)), /DUPLICATE/);
  assert.equal(sent, 1);
});

test('HTTP failure locks all later requests without another transmission', async () => {
  let sent = 0;
  const guard = createTransportGuard({ transport: async () => { sent++; return new Response('fixture failure', { status: 503 }); }, signal: new AbortController().signal });
  await assert.rejects(guard.fetch(ENDPOINT, post(1)), /HTTP_FAILURE/);
  await assert.rejects(guard.fetch(ENDPOINT, post(2)), /LOCKED/);
  assert.equal(sent, 1);
});

test('network failure locks retries and never records the error message', async () => {
  const guard = createTransportGuard({ transport: async () => { throw new Error('fixture-secret'); }, signal: new AbortController().signal });
  await assert.rejects(guard.fetch(ENDPOINT, post(1)), /TRANSPORT_FAILURE/);
  await assert.rejects(guard.fetch(ENDPOINT, post(2)), /LOCKED/);
  assert.equal(JSON.stringify(guard.requests).includes('fixture-secret'), false);
});

test('an aborted run cannot start transport', async () => {
  let sent = 0;
  const controller = new AbortController(); controller.abort();
  const guard = createTransportGuard({ transport: async () => { sent++; return new Response(); }, signal: controller.signal });
  await assert.rejects(guard.fetch(ENDPOINT, post(1)));
  assert.equal(sent, 0);
});

test('transport receives redirect:error and combined abort signal', async () => {
  const controller = new AbortController();
  let observed: RequestInit | undefined;
  const guard = createTransportGuard({ transport: async (_input, init) => { observed = init; return new Response('ok'); }, signal: controller.signal });
  await (await guard.fetch(ENDPOINT, post(1))).text();
  assert.equal(observed?.redirect, 'error');
  assert.ok(observed?.signal);
  controller.abort();
  assert.equal(observed.signal.aborted, true);
});

function roundTripFixture() {
  const token = 'DOC_fixture_only';
  const firstPrompt = 'Read the current document and reply FIRST with its token.';
  const followupPrompt = 'Use the previous tool result and reply FOLLOWUP; no tool calls.';
  const call = { role: 'assistant', content: null, tool_calls: [{ id: 'call_fixture', type: 'function', function: { name: 'read_script', arguments: '{"scope":"full"}' } }] };
  const result = { role: 'tool', tool_call_id: 'call_fixture', content: token };
  const base = [{ role: 'system', content: 'Synthetic acceptance.' }, { role: 'user', content: firstPrompt }];
  return { token, firstPrompt, followupPrompt,
    reads: [{ turn: 1, toolCallId: 'call_fixture', scope: 'full', sha256: 'fixture' }],
    turns: [{ number: 1, text: `FIRST:${token}` }, { number: 2, text: `FOLLOWUP:${token}` }],
    wires: [{ turn: 1, body: { messages: base } },
      { turn: 1, body: { messages: [...base, call, result] } },
      { turn: 2, body: { messages: [...base, call, result, { role: 'assistant', content: `FIRST:${token}` }, { role: 'user', content: followupPrompt }] } }],
  };
}

test('accepts a matching production-tool round trip and retained next-turn context', () => {
  assert.ok(Object.values(assessRoundTrip(roundTripFixture())).every(Boolean));
});

test('missing or mismatched tool result cannot pass round-trip evidence', () => {
  const fixture = roundTripFixture();
  fixture.wires[1]!.body.messages[3] = { role: 'tool', tool_call_id: 'wrong-call', content: fixture.token } as any;
  assert.equal(assessRoundTrip(fixture).toolResultReturned, false);
});

test('a follow-up answer without prior tool history cannot pass context evidence', () => {
  const fixture = roundTripFixture();
  fixture.wires[2]!.body.messages = [{ role: 'user', content: fixture.followupPrompt }] as any;
  assert.equal(assessRoundTrip(fixture).nextTurnContext, false);
});

test('a new read in turn two does not prove retained-context-only followup', () => {
  const fixture = roundTripFixture();
  fixture.reads.push({ ...fixture.reads[0]!, turn: 2 });
  assert.equal(assessRoundTrip(fixture).noFollowupRead, false);
});

test('a token supplied in the initial prompt cannot prove document discovery', () => {
  const fixture = roundTripFixture();
  fixture.wires[0]!.body.messages[1]!.content = fixture.token;
  assert.equal(assessRoundTrip(fixture).tokenNotPrompted, false);
});

test('receipt records timing and request metadata without headers or bodies', async () => {
  const guard = createTransportGuard({ transport: okTransport, signal: new AbortController().signal });
  await (await guard.fetch(ENDPOINT, { ...post(1), headers: { authorization: 'Bearer fixture-secret' } })).text();
  assert.equal(guard.requests.length, 1);
  assert.equal(typeof guard.requests[0]?.elapsedMs, 'number');
  assert.equal(JSON.stringify(guard.requests).includes('fixture-secret'), false);
  assert.equal(JSON.stringify(guard.requests).includes('fixture-1'), false);
});

test('production document adapter reads actual disk bytes without modifying the manuscript', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cliproxy-document-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'manuscript.md');
  await writeFile(file, 'DOC_disk_fixture', { mode: 0o600 });
  const reads: Parameters<typeof createDiskDocumentPort>[1] = [];
  const port = createDiskDocumentPort(file, reads, () => 1);
  const tool = createDocumentLaneTools(port).find(tool => tool.name === 'read_script')!;
  const outcome = await tool.execute({ scope: 'full' }, { toolCallId: 'call_disk', signal: new AbortController().signal });
  assert.equal(outcome.ok && outcome.text, 'DOC_disk_fixture');
  assert.equal(reads[0]?.toolCallId, 'call_disk');
  assert.equal(reads[0]?.sha256.length, 64);
  assert.equal(await readFile(file, 'utf8'), 'DOC_disk_fixture');
  await assert.rejects(port.write({ operation: 'append', content: 'forbidden' } as any,
    { toolCallId: 'call_write', signal: new AbortController().signal }), /WRITE_DISABLED/);
});

test('native session readback excludes derived trace JSONL under the same session root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cliproxy-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const slug = join(root, '.nomi', 'agent-sessions', 'slug');
  await mkdir(join(slug, 'session.trace'), { recursive: true });
  await writeFile(join(slug, 'native.jsonl'), JSON.stringify({ kind: 'header', id: 'fixture-session' }) + '\n');
  await writeFile(join(slug, 'session.trace', 'trace.jsonl'), JSON.stringify({ derived: true }) + '\n');
  assert.equal(readNativeSession(root).sessionId, 'fixture-session');
});

async function recordedFixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'cliproxy-recorded-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const slug = join(root, 'project', '.nomi', 'agent-sessions', 'slug');
  await mkdir(slug, { recursive: true });
  const token = 'DOC_fixture_recorded';
  const doc = `Verification token: ${token}\n`;
  const messages = [
    { role: 'user', content: 'Read document.' },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'call_recorded', name: 'read_script', arguments: { scope: 'full' } }] },
    { role: 'toolResult', toolCallId: 'call_recorded', toolName: 'read_script', isError: false, content: [{ type: 'text', text: doc }] },
    { role: 'assistant', content: [{ type: 'text', text: `FIRST:${token}` }] },
    { role: 'user', content: 'Follow up.' },
    { role: 'assistant', content: [{ type: 'text', text: `FOLLOWUP:${token}` }] },
  ];
  await writeFile(join(slug, 'native.jsonl'), [JSON.stringify({ kind: 'header', id: 'recorded-session' }),
    ...messages.map((message, seq) => JSON.stringify({ kind: 'entry', seq, type: 'message', message }))].join('\n') + '\n');
  const file = join(root, 'project', 'acceptance-document.md');
  await writeFile(file, doc);
  const { createHash } = await import('node:crypto');
  const report = { runId: 'fixture', model: MODEL_ID, endpoint: ENDPOINT, state: 'failed',
    nativeSessionFailure: 'CLIPROXY_NATIVE_RECEIPT_INCOMPLETE', sessionId: 'recorded-session',
    requests: [1, 2, 3].map(number => ({ number, model: MODEL_ID, httpStatus: 200 })),
    assertions: { toolCalled: true, toolResultReturned: true, continuation: true, nextTurnContext: true, followup: true, noFollowupRead: true, tokenNotPrompted: true },
    reads: [{ turn: 1, toolCallId: 'call_recorded', scope: 'full' }],
    laneClosed: true, productionSourceUnchanged: true, keyAbsentFromArtifacts: true, blockedRequests: 0,
    document: { path: file, sha256: createHash('sha256').update(doc).digest('hex'), unchanged: true },
  };
  await writeFile(join(root, 'report.json'), JSON.stringify(report));
  return { root, report };
}

test('zero-network readback preserves the original failed receipt and verifies native evidence', async (t) => {
  const { root } = await recordedFixture(t);
  const original = await readFile(join(root, 'report.json'), 'utf8');
  assert.deepEqual(verifyRecordedRun(root), { state: 'passed', addedPosts: 0 });
  assert.equal(await readFile(join(root, 'report.json'), 'utf8'), original);
});

test('readback refuses a mismatched persisted session instead of accepting old assertions', async (t) => {
  const { root, report } = await recordedFixture(t);
  report.sessionId = 'wrong-session';
  await writeFile(join(root, 'report.json'), JSON.stringify(report));
  assert.throws(() => verifyRecordedRun(root), /SESSION/);
});
