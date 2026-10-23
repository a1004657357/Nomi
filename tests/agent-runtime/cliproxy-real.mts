import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createDocumentLaneTools, type DocumentLanePort } from '../../electron/agentLane/laneDocumentTools.js';
import type { LaneHandle, LaneProjection } from '../../electron/shared/agentLane/laneContracts.js';
import { laneSessionsRoot } from '../../electron/agentLane/laneSession.mjs';

export const MODEL_ID = 'gpt-6-sol';
export const ENDPOINT = 'http://127.0.0.1:8317/v1/chat/completions';
export const MAX_POSTS = 8;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

type Message = {
  role?: string; content?: unknown; tool_call_id?: string;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
};
type Wire = { turn: number; body: { messages?: Message[]; [key: string]: unknown } };
type ReadReceipt = { turn: number; toolCallId: string; scope: string; sha256: string };
type TurnReceipt = { number: number; text: string; elapsedMs?: number; parts?: LaneProjection['parts']; usage?: LaneProjection['usage'] };
type RequestReceipt = {
  number: number; turn: number; model: string; startedAt: string; inputBytes: number;
  messageRoles: string[]; httpStatus?: number; headersMs?: number; elapsedMs?: number;
  streamEnd?: 'eof' | 'cancelled' | 'error' | 'no-body'; failure?: string;
};

export function createTransportGuard(options: {
  transport: typeof fetch; signal: AbortSignal; onReceipt?: () => void;
}) {
  const requests: RequestReceipt[] = [];
  const wires: Wire[] = [];
  const payloads = new Set<string>();
  let turn = 0;
  let locked = false;
  let blockedRequests = 0;
  const refuse = (code: string): never => { blockedRequests++; throw new Error(code); };
  const guardedFetch: typeof fetch = async (input, init) => {
    if (locked) return refuse('CLIPROXY_LOCKED');
    options.signal.throwIfAborted();
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    if (request.url !== ENDPOINT || request.method !== 'POST') return refuse('CLIPROXY_ENDPOINT_REFUSED');
    let body: Wire['body'];
    const raw = await request.clone().text();
    try { body = JSON.parse(raw) as Wire['body']; }
    catch { return refuse('CLIPROXY_BODY_REFUSED'); }
    if (!body || body.model !== MODEL_ID || !Array.isArray(body.messages)) return refuse('CLIPROXY_MODEL_REFUSED');
    options.signal.throwIfAborted();
    request.signal.throwIfAborted();
    if (requests.length >= MAX_POSTS) return refuse('CLIPROXY_POST_LIMIT');
    const fingerprint = sha256(raw);
    if (payloads.has(fingerprint)) { locked = true; return refuse('CLIPROXY_DUPLICATE_PAYLOAD'); }
    payloads.add(fingerprint);
    const started = performance.now();
    const receipt: RequestReceipt = { number: requests.length + 1, turn, model: MODEL_ID,
      startedAt: new Date().toISOString(), inputBytes: Buffer.byteLength(raw),
      messageRoles: body.messages.map(message => message.role ?? 'unknown') };
    requests.push(receipt);
    wires.push({ turn, body });
    options.onReceipt?.();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 90_000);
    timer.unref();
    const signal = AbortSignal.any([options.signal, request.signal, timeout.signal]);
    const finish = (end: RequestReceipt['streamEnd']) => {
      clearTimeout(timer);
      if (receipt.elapsedMs !== undefined) return;
      receipt.streamEnd = end;
      receipt.elapsedMs = Math.round(performance.now() - started);
      options.onReceipt?.();
    };
    try {
      const response = await options.transport(request, { redirect: 'error', signal });
      receipt.httpStatus = response.status;
      receipt.headersMs = Math.round(performance.now() - started);
      options.onReceipt?.();
      if (!response.ok) {
        locked = true;
        receipt.failure = 'HTTP_FAILURE';
        await response.body?.cancel();
        throw new Error('CLIPROXY_HTTP_FAILURE');
      }
      if (!response.body) { finish('no-body'); return response; }
      const reader = response.body.getReader();
      // Observe stream lifetime only. Pi owns SSE parsing, tool dispatch and usage.
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) { finish('eof'); controller.close(); }
            else controller.enqueue(next.value);
          } catch {
            locked = true; receipt.failure = 'STREAM_FAILURE'; finish('error');
            controller.error(new Error('CLIPROXY_STREAM_FAILURE'));
          }
        },
        async cancel(reason) { finish('cancelled'); await reader.cancel(reason); },
      });
      return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch {
      locked = true;
      receipt.failure ??= 'TRANSPORT_FAILURE';
      finish('error');
      throw new Error(`CLIPROXY_${receipt.failure}`);
    }
  };
  return { requests, wires, fetch: guardedFetch, setTurn(value: number) { turn = value; },
    get blockedRequests() { return blockedRequests; } };
}

const messageText = (message: Message): string => typeof message.content === 'string' ? message.content
  : Array.isArray(message.content) ? message.content.flatMap(part => part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('') : '';

export function assessRoundTrip(input: {
  token: string; firstPrompt: string; followupPrompt: string;
  wires: Wire[]; reads: ReadReceipt[]; turns: TurnReceipt[];
}): Record<string, boolean> {
  const readIds = new Set(input.reads.filter(read => read.turn === 1 && read.scope === 'full').map(read => read.toolCallId));
  const paired = (messages: Message[]) => messages.some((message, index) => message.role === 'tool'
    && readIds.has(message.tool_call_id ?? '') && messageText(message).includes(input.token)
    && messages.slice(0, index).some(previous => previous.role === 'assistant'
      && previous.tool_calls?.some(call => call.id === message.tool_call_id && call.function?.name === 'read_script')));
  const firstWires = input.wires.filter(wire => wire.turn === 1);
  const nextWires = input.wires.filter(wire => wire.turn === 2);
  return {
    toolCalled: readIds.size > 0,
    toolResultReturned: firstWires.some(wire => paired(wire.body.messages ?? [])),
    continuation: input.turns.some(turn => turn.number === 1 && turn.text.includes(`FIRST:${input.token}`)),
    nextTurnContext: nextWires.some(wire => {
      const messages = wire.body.messages ?? [];
      return paired(messages)
        && messages.some(message => message.role === 'user' && messageText(message) === input.firstPrompt)
        && messages.some(message => message.role === 'assistant' && messageText(message).includes(`FIRST:${input.token}`))
        && messages.at(-1)?.role === 'user' && messageText(messages.at(-1)!) === input.followupPrompt;
    }),
    followup: input.turns.some(turn => turn.number === 2 && turn.text.includes(`FOLLOWUP:${input.token}`)),
    noFollowupRead: !input.reads.some(read => read.turn === 2),
    tokenNotPrompted: firstWires.length > 0 && !input.firstPrompt.includes(input.token) && !input.followupPrompt.includes(input.token)
      && !(firstWires[0]!.body.messages ?? []).some(message => messageText(message).includes(input.token)),
  };
}

export function createDiskDocumentPort(file: string, reads: ReadReceipt[], currentTurn: () => number): DocumentLanePort {
  return {
    async read(scope, context) {
      context.signal.throwIfAborted();
      if (scope !== 'full') throw new Error('CLIPROXY_FULL_DOCUMENT_REQUIRED');
      const text = readFileSync(file, 'utf8');
      reads.push({ turn: currentTurn(), toolCallId: context.toolCallId, scope, sha256: sha256(text) });
      return { text };
    },
    async write() { throw new Error('CLIPROXY_DOCUMENT_WRITE_DISABLED'); },
  };
}

function filesBelow(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'CLIPROXY_SYMLINK_REFUSED');
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

export function readNativeSession(projectDir: string) {
  const root = laneSessionsRoot(projectDir);
  // Native logs are direct slug children; .trace/trace.jsonl is derived evidence, not a session.
  const files = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const slug = path.join(root, entry.name);
    return readdirSync(slug, { withFileTypes: true }).filter(file => file.isFile() && file.name.endsWith('.jsonl'))
      .map(file => path.join(slug, file.name));
  });
  assert.equal(files.length, 1, 'CLIPROXY_ONE_SESSION_REQUIRED');
  const bytes = readFileSync(files[0]!, 'utf8');
  assert.ok(bytes.endsWith('\n'), 'CLIPROXY_INCOMPLETE_TRANSCRIPT');
  const rows = bytes.trimEnd().split('\n').flatMap(line => {
    const value: unknown = JSON.parse(line);
    return Array.isArray(value) ? value : [value];
  }) as Array<{ kind?: string; id?: string; seq?: number; message?: { role?: string; toolCallId?: string; toolName?: string; isError?: boolean; content?: unknown; usage?: unknown } }>;
  const entries = rows.filter(row => row.kind === 'entry');
  return { file: files[0]!, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), sessionId: rows[0]?.id,
    entries, messages: entries.flatMap(entry => entry.message ? [entry.message] : []) };
}

export function verifyRecordedRun(runRoot: string): { state: string; addedPosts: number } {
  const originalFile = path.join(runRoot, 'report.json');
  const originalBytes = readFileSync(originalFile);
  const original = JSON.parse(originalBytes.toString('utf8')) as {
    runId: string; state: string; model: string; endpoint: string; sessionId: string;
    failure?: string; nativeSessionFailure?: string; assertions: Record<string, boolean>;
    requests: RequestReceipt[]; reads: ReadReceipt[]; blockedRequests: number;
    laneClosed: boolean; productionSourceUnchanged: boolean; keyAbsentFromArtifacts: boolean;
    document: { path: string; sha256: string; unchanged: boolean };
  };
  assert.ok(original.state === 'passed' || (original.state === 'failed' && !original.failure
    && original.nativeSessionFailure === 'CLIPROXY_NATIVE_RECEIPT_INCOMPLETE'), 'CLIPROXY_READBACK_NOT_ELIGIBLE');
  for (const name of ['toolCalled', 'toolResultReturned', 'continuation', 'nextTurnContext', 'followup', 'noFollowupRead', 'tokenNotPrompted']) {
    assert.equal(original.assertions[name], true, 'CLIPROXY_ORIGINAL_WIRE_ASSERTION_MISSING');
  }
  assert.equal(original.model, MODEL_ID, 'CLIPROXY_RECORDED_MODEL_REFUSED');
  assert.equal(original.endpoint, ENDPOINT, 'CLIPROXY_RECORDED_ENDPOINT_REFUSED');
  assert.ok(original.requests.length > 0 && original.requests.length <= MAX_POSTS
    && original.requests.every(request => request.httpStatus === 200 && request.model === MODEL_ID && !request.failure), 'CLIPROXY_RECORDED_POSTS_INCOMPLETE');
  assert.ok(original.laneClosed && original.productionSourceUnchanged && original.keyAbsentFromArtifacts
    && original.blockedRequests === 0, 'CLIPROXY_ORIGINAL_SAFETY_INCOMPLETE');
  const projectDir = path.join(runRoot, 'project');
  const documentFile = path.join(projectDir, 'acceptance-document.md');
  assert.equal(original.document.path, documentFile, 'CLIPROXY_DOCUMENT_PATH_REFUSED');
  const document = readFileSync(documentFile, 'utf8');
  assert.equal(sha256(document), original.document.sha256, 'CLIPROXY_DOCUMENT_CHANGED');
  const token = /^Verification token: (DOC_\w+)$/m.exec(document)?.[1];
  assert.ok(token, 'CLIPROXY_DOCUMENT_TOKEN_MISSING');
  const native = readNativeSession(projectDir);
  assert.equal(native.sessionId, original.sessionId, 'CLIPROXY_SESSION_ID_MISMATCH');
  const messages = native.messages;
  const userIndices = messages.flatMap((message, index) => message.role === 'user' ? [index] : []);
  assert.equal(userIndices.length, 2, 'CLIPROXY_NATIVE_TWO_TURNS_REQUIRED');
  const readIndex = messages.findIndex(message => message.role === 'toolResult' && message.toolName === 'read_script'
    && !message.isError && original.reads.some(read => read.turn === 1 && read.toolCallId === message.toolCallId)
    && messageText(message as Message).includes(token));
  assert.ok(readIndex > userIndices[0]! && readIndex < userIndices[1]!, 'CLIPROXY_NATIVE_READ_MISSING');
  const toolResult = messages[readIndex]!;
  assert.ok(messages.slice(0, readIndex).some(message => message.role === 'assistant' && Array.isArray(message.content)
    && message.content.some(part => part.type === 'toolCall' && part.name === 'read_script' && part.id === toolResult.toolCallId)),
  'CLIPROXY_NATIVE_TOOL_ID_MISMATCH');
  assert.ok(messages.slice(readIndex + 1, userIndices[1]).some(message => message.role === 'assistant'
    && messageText(message as Message).includes(`FIRST:${token}`)), 'CLIPROXY_NATIVE_CONTINUATION_MISSING');
  assert.ok(messages.slice(userIndices[1]! + 1).some(message => message.role === 'assistant'
    && messageText(message as Message).includes(`FOLLOWUP:${token}`)), 'CLIPROXY_NATIVE_FOLLOWUP_MISSING');
  assert.ok(!messages.slice(userIndices[1]!).some(message => message.role === 'toolResult'), 'CLIPROXY_NATIVE_FOLLOWUP_REREAD');
  assert.ok(userIndices.every(index => !messageText(messages[index] as Message).includes(token)), 'CLIPROXY_NATIVE_TOKEN_PROMPTED');
  const verification = { state: 'passed', verifiedAt: new Date().toISOString(), runId: original.runId,
    mode: 'read-only recorded-run verification', originalState: original.state, originalReportSha256: sha256(originalBytes),
    addedPosts: 0, modelRequestsObservedInOriginalRun: original.requests.length,
    correction: 'Native session discovery excludes nested derived .trace/trace.jsonl; original report is unchanged',
    originalWireAssertions: original.assertions, native: { path: native.file, sha256: native.sha256, bytes: native.bytes,
      sessionId: native.sessionId, userTurns: userIndices.length, matchingToolId: toolResult.toolCallId,
      toolResultPersisted: true, continuationPersisted: true, followupPersisted: true, noFollowupRead: true },
    document: original.document, originalSafetyReceipts: { laneClosed: original.laneClosed,
      productionSourceUnchanged: original.productionSourceUnchanged, keyAbsentFromArtifacts: original.keyAbsentFromArtifacts },
    limitations: ['Original wire booleans are retained from the live guarded run, not reconstructed by making another request',
      'No credentials are loaded during readback; secret absence is the original live scan receipt'] };
  writeFileSync(path.join(runRoot, 'verification.json'), JSON.stringify(verification, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  assert.equal(sha256(readFileSync(originalFile)), sha256(originalBytes), 'CLIPROXY_ORIGINAL_REPORT_CHANGED');
  return { state: 'passed', addedPosts: 0 };
}

/** Explicit --live gate; importing this module in offline tests never loads a key or calls a provider. */
export async function runRealAcceptance(runRoot: string) {
  assert.equal(process.env.NOMI_SPEND_OK, '1', 'CLIPROXY_EXPLICIT_LIVE_AUTH_REQUIRED');
  assert.ok(path.isAbsolute(runRoot) && !existsSync(runRoot), 'CLIPROXY_FRESH_ABSOLUTE_RUN_REQUIRED');
  assert.ok(statSync(path.dirname(runRoot)).isDirectory(), 'CLIPROXY_EXISTING_PARENT_REQUIRED');
  const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const sourceFiles = ['electron/agentLane', 'electron/shared/agentLane'].flatMap(folder => filesBelow(path.join(repoRoot, folder)));
  const sourceSnapshot = () => Object.fromEntries(sourceFiles.map(file => [path.relative(repoRoot, file), sha256(readFileSync(file))]));
  const before = sourceSnapshot();
  mkdirSync(runRoot, { mode: 0o700 });
  const projectDir = path.join(runRoot, 'project');
  mkdirSync(projectDir, { mode: 0o700 });
  const token = `DOC_${randomUUID().replaceAll('-', '')}`;
  const documentFile = path.join(projectDir, 'acceptance-document.md');
  const document = `# Synthetic isolated manuscript\nVerification token: ${token}\nScene: A silver lantern beside a quiet window.\n`;
  writeFileSync(documentFile, document, { mode: 0o600, flag: 'wx' });
  const firstPrompt = 'Read the full current document using read_script. Then reply exactly FIRST:<verification token>, replacing the placeholder with the actual token from the tool result. Do not guess.';
  const followupPrompt = 'Do not call any tools in this follow-up. From the previous document tool result in our conversation, reply exactly FOLLOWUP:<the same verification token>.';
  const reads: ReadReceipt[] = [];
  const turns: TurnReceipt[] = [];
  const controller = new AbortController();
  let lane: LaneHandle | undefined;
  let currentTurn = 0;
  let key = '';
  const report: Record<string, unknown> = { runId: path.basename(runRoot), state: 'running', startedAt: new Date().toISOString(),
    realProvider: true, syntheticDocument: true, entry: 'production openLane + createDocumentLaneTools + isolated disk DocumentLanePort',
    model: MODEL_ID, endpoint: ENDPOINT, maxPosts: MAX_POSTS, requests: [], reads, turns,
    actualCost: { state: 'unknown', amount: null, reason: 'No verified price or billing receipt' },
    upstreamInternalAttempts: 'unavailable', automaticHarnessRetry: false, productionSourceBefore: before };
  const reportFile = path.join(runRoot, 'report.json');
  const persist = () => {
    const bytes = JSON.stringify(report, null, 2) + '\n';
    if (key && bytes.includes(key)) throw new Error('CLIPROXY_SECRET_IN_REPORT_REFUSED');
    writeFileSync(reportFile, bytes, { mode: 0o600 });
  };
  const guard = createTransportGuard({ transport: globalThis.fetch.bind(globalThis), signal: controller.signal, onReceipt: persist });
  report.requests = guard.requests;
  const stop = () => { controller.abort(); void lane?.execute({ kind: 'abort' }).catch(() => undefined); };
  const timer = setTimeout(stop, 240_000);
  timer.unref();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  persist();
  try {
    const configFile = '/usr/local/etc/cliproxyapi.conf';
    assert.ok(existsSync(configFile), 'CLIPROXY_CLIENT_CONFIG_UNAVAILABLE');
    const dependencyRequire = createRequire(path.join(repoRoot, 'node_modules/.pnpm/node_modules/cliproxy-acceptance.cjs'));
    const config = dependencyRequire('js-yaml').load(readFileSync(configFile, 'utf8')) as { access?: { 'api-keys'?: unknown[] } };
    const configuredKey = config.access?.['api-keys']?.find(value => typeof value === 'string' && value.trim());
    if (typeof configuredKey !== 'string') throw new Error('CLIPROXY_CLIENT_KEY_UNAVAILABLE');
    key = configuredKey;
    report.credentialLoadedInMemory = true;
    const port = createDiskDocumentPort(documentFile, reads, () => currentTurn);
    const tools = createDocumentLaneTools(port).filter(tool => tool.name === 'read_script' && tool.contractId === 'document.read');
    assert.equal(tools.length, 1, 'CLIPROXY_PRODUCTION_READ_TOOL_REQUIRED');
    lane = await openLane({ projectDir, laneName: 'cliproxy-acceptance', fetch: guard.fetch,
      model: { kind: 'openai-compatible', providerId: 'cliproxy-real-acceptance', modelId: MODEL_ID,
        baseURL: 'http://127.0.0.1:8317/v1', authType: 'api-key', apiKey: key, maxOutputTokens: 1024 },
      systemPrompt: 'You are a Nomi document assistant in a synthetic isolated acceptance project. Use real tool results; never invent unseen document contents. Follow the requested exact output format.',
      tools, approval: { hasUserInterface: false, policy: () => ({ mode: 'safe-auto', spend: 'confirm' }) },
      limits: { maxModelRequests: MAX_POSTS }, watchdog: { firstResponseMs: 90_000, idleMs: 45_000 },
    });
    report.sessionId = lane.sessionId;
    for (const [index, prompt] of [firstPrompt, followupPrompt].entries()) {
      currentTurn = index + 1; guard.setTurn(currentTurn);
      const start = lane.projection().parts.length;
      const started = performance.now();
      await lane.execute({ kind: 'prompt', text: prompt }, { admissionSignal: controller.signal });
      controller.signal.throwIfAborted();
      const projection = lane.projection();
      const parts = projection.parts.slice(start);
      const text = parts.flatMap(part => part.kind === 'assistant-text' && !part.streaming ? [part.text] : []).join('\n');
      turns.push({ number: currentTurn, text, elapsedMs: Math.round(performance.now() - started), parts, usage: projection.usage });
      report.usage = projection.usage;
      persist();
      assert.ok(text.includes(`${index === 0 ? 'FIRST' : 'FOLLOWUP'}:${token}`), 'CLIPROXY_TURN_ANSWER_INCOMPLETE');
      if (index === 0) assert.ok(assessRoundTrip({ token, firstPrompt, followupPrompt, wires: guard.wires, reads, turns }).toolResultReturned,
        'CLIPROXY_TOOL_ROUNDTRIP_INCOMPLETE');
    }
    report.assertions = assessRoundTrip({ token, firstPrompt, followupPrompt, wires: guard.wires, reads, turns });
    assert.ok(Object.values(report.assertions as Record<string, boolean>).every(Boolean), 'CLIPROXY_EVIDENCE_INCOMPLETE');
    assert.ok(guard.requests.length > 0 && guard.requests.length <= MAX_POSTS && guard.blockedRequests === 0, 'CLIPROXY_REQUESTS_INCOMPLETE');
    assert.ok(guard.requests.every(request => request.httpStatus === 200 && !request.failure), 'CLIPROXY_HTTP_INCOMPLETE');
    assert.ok((lane.projection().usage.totalTokens ?? 0) > 0, 'CLIPROXY_TOKEN_USAGE_UNAVAILABLE');
    report.state = 'passed';
  } catch (error) {
    report.state = controller.signal.aborted ? 'unknown' : 'failed';
    report.failure = error instanceof Error && /^CLIPROXY_[A-Z_]+$/.test(error.message) ? error.message : 'CLIPROXY_RUNTIME_FAILURE';
  } finally {
    clearTimeout(timer);
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    try { await lane?.close(); report.laneClosed = true; }
    catch { report.laneClosed = false; report.state = 'failed'; report.cleanupFailure = 'CLIPROXY_LANE_CLOSE_FAILED'; }
    controller.abort();
    report.blockedRequests = guard.blockedRequests;
    report.document = { path: documentFile, sha256: sha256(readFileSync(documentFile)), unchanged: readFileSync(documentFile, 'utf8') === document };
    if (lane) {
      try {
        const native = readNativeSession(projectDir);
        const nativeRead = native.messages.some(message => message.role === 'toolResult' && message.toolName === 'read_script'
          && !message.isError && reads.some(read => read.toolCallId === message.toolCallId)
          && messageText(message as Message).includes(token));
        report.nativeSession = { path: native.file, sha256: native.sha256, bytes: native.bytes,
          sessionIdMatches: native.sessionId === lane.sessionId, entries: native.entries.length,
          successfulReadToolPersisted: nativeRead,
          userTurns: native.messages.filter(message => message.role === 'user').length,
          assistantUsages: native.messages.filter(message => message.role === 'assistant').map(message => {
            const usage = message.usage as Record<string, unknown> | undefined;
            return usage ? Object.fromEntries(Object.entries(usage).filter(([name]) => name !== 'cost')) : null;
          }) };
        if (!nativeRead || native.sessionId !== lane.sessionId || native.messages.filter(message => message.role === 'user').length !== 2) report.state = 'failed';
      } catch { report.state = 'failed'; report.nativeSessionFailure = 'CLIPROXY_NATIVE_RECEIPT_INCOMPLETE'; }
    }
    report.productionSourceUnchanged = JSON.stringify(before) === JSON.stringify(sourceSnapshot());
    if (!report.productionSourceUnchanged) report.state = 'partial';
    report.keyAbsentFromArtifacts = !key || filesBelow(runRoot).every(file => !readFileSync(file).includes(Buffer.from(key)));
    if (!report.keyAbsentFromArtifacts) report.state = 'failed';
    report.finishedAt = new Date().toISOString();
    report.limitations = ['Synthetic isolated manuscript, not desktop renderer/IPC/Undo acceptance',
      'Proxy-internal attempts and charged amount unavailable', 'No image, batch, other channel or release acceptance'];
    persist();
    key = '';
  }
  return { reportFile, state: report.state, posts: guard.requests.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootIndex = process.argv.indexOf('--run-root');
  if (process.argv.includes('--verify-run') && !process.argv.includes('--live') && rootIndex >= 0 && process.argv[rootIndex + 1]) {
    try { console.log(JSON.stringify(verifyRecordedRun(process.argv[rootIndex + 1]!))); }
    catch { console.error('CLIPROXY_RECORDED_VERIFICATION_FAILED'); process.exitCode = 1; }
  } else if (!process.argv.includes('--live') || rootIndex < 0 || !process.argv[rootIndex + 1]) {
    console.error('Explicit --live --run-root /absolute/fresh/path and NOMI_SPEND_OK=1 required');
    process.exitCode = 1;
  } else {
    runRealAcceptance(process.argv[rootIndex + 1]!).then(result => {
      console.log(JSON.stringify(result));
      process.exitCode = result.state === 'passed' ? 0 : 1;
    }, () => { console.error('CLIPROXY_ACCEPTANCE_SETUP_FAILED; no secret output'); process.exitCode = 1; });
  }
}
