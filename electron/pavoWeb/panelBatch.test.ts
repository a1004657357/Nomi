import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = fs.readFileSync(path.join(process.cwd(), 'integrations/pavo-web-adapter/panel.js'), 'utf8');
const mediaSource = fs.readFileSync(path.join(process.cwd(), 'integrations/pavo-web-adapter/pavo-media.js'), 'utf8');
type Task = Record<string, any>;
type Options = {
  conversations?: Task[];
  pending?: Task[];
  remote?: Task[];
  page?: (message: Task) => Task | Promise<Task> | undefined;
  gateway?: (route: string, body: Task) => { status?: number; body: Task } | undefined;
};

function pending(taskCode = 'ROOT', extra: Task = {}): Task {
  return { taskCode, status: 'pending', prompt: 'Exact original user prompt', mediaType: 'video',
    modelConfig: {}, referenceFiles: [], realSubmit: true, ...extra };
}

function submitted(taskCode = 'ROOT', extra: Task = {}): Task {
  return pending(taskCode, { status: 'awaiting_result', submitClaimId: `claim-${taskCode}`,
    submitClaimedAt: '2026-10-22T00:00:00Z', submittedAt: '2026-10-22T00:00:01Z',
    conversationSnapshotComplete: true, conversationBaselineIds: ['OLD'], ...extra });
}

function panel(initial: Task[], options: Options = {}) {
  vi.useFakeTimers();
  const elements = new Map<string, any>();
  const events: Array<{ action: string; body: Task }> = [];
  const stored: Task = { pavoTaskQueue: initial, apiToken: 'local-fixture', pavoClientId: 'client-fixture' };
  let currentTask = initial[0];
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', files: [],
      appendChild() {}, addEventListener() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => ({ textContent: '' }) },
    chrome: { runtime: { id: 'fixture' }, storage: {
      local: { get: async () => stored, set: async (values: Task) => Object.assign(stored, values) },
      onChanged: { addListener() {} },
    }, tabs: { query: async () => [{ id: 1, active: true }], sendMessage: async (_id: number, message: Task) => {
      events.push({ action: message.action, body: message });
      if (message.action === 'clickGenerate') currentTask = stored.pavoTaskQueue.find((task: Task) => task.taskCode === message.taskCode)!;
      const custom = await options.page?.(message);
      if (custom !== undefined) return custom;
      switch (message.action) {
        case 'getPageInfo': return { success: true, info: { hostname: 'app.pavo-ai.cn', mediaType: 'video', hasSubmitButton: true, hasPromptEditor: true } };
        case 'applyPreset': return { success: true, applied: {} };
        case 'doGenerate': return { success: true, uploaded: message.fileReferences.length, referencesVerified: true };
        case 'verifyPreparedTask': return { success: true, promptVerified: true, referencesVerified: true, preparedSnapshotVerified: true,
          uploaded: message.referenceNames.length, referenceNames: message.referenceNames };
        case 'harvestAllConversations': return { success: true, complete: true, conversations: options.conversations || [] };
        case 'fetchConversationVideos': {
          const conv = options.conversations?.find(item => item.cid === message.conversationId);
          return { success: Boolean(conv), conversationId: message.conversationId, prompt: conv?.prompt || '',
            status: conv?.status || 'processing', failureCategory: conv?.failureCategory,
            videos: conv?.videos || [], images: conv?.images || [] };
        }
        case 'snapshotMediaOutputs': return { success: true, urls: [] };
        case 'clickGenerate': return { success: true };
        case 'getCurrentConversation': return { success: true, conversationId: `CID-${currentTask.taskCode}`,
          prompt: currentTask.prompt, status: 'generating' };
        case 'recoverComposer': return { success: true, freshConsoleConfirmed: true };
        case 'captureAndUploadMedia': return { success: true, uploaded: 1 };
        default: throw new Error(`Unexpected page action: ${message.action}`);
      }
    } } },
    window: { addEventListener() {}, parent: { postMessage() {} } },
    navigator: { locks: { request() {} } },
    crypto: { randomUUID: () => 'fixture' }, URL, URLSearchParams, AbortSignal, Date,
    setTimeout, clearTimeout, setInterval() {},
    fetch: async (input: string, init: RequestInit = {}) => {
      const route = new URL(input).pathname;
      const body = init.body ? JSON.parse(String(init.body)) : {};
      events.push({ action: route, body });
      const custom = options.gateway?.(route, body);
      if (custom) return Response.json(custom.body, { status: custom.status || 200 });
      switch (route) {
        case '/api/tasks': return Response.json({ tasks: options.remote || [] });
        case '/api/tasks/pending': return Response.json({ tasks: options.pending || [] });
        case '/api/tasks/ack': return Response.json({ success: true });
        case '/api/tasks/submit-claim': return Response.json({ success: true, submitClaimId: `claim-${body.taskCode}`, submitClaimedAt: '2026-10-22T00:00:00Z' });
        case '/api/tasks/submit-confirm': return Response.json({ success: true, submittedAt: '2026-10-22T00:00:01Z' });
        case '/api/tasks/result-binding': return Response.json({ success: true, conversationId: body.conversationId });
        case '/api/tasks/composer-release': return Response.json({ success: true, composerReleasedAt: '2026-10-22T00:00:02Z' });
        case '/api/tasks/status': return Response.json({ success: true });
        default: throw new Error(`Unexpected gateway route: ${route}`);
      }
    },
  });
  vm.runInContext(mediaSource, context);
  // Expose existing closure operations only in the VM; do not add production test hooks.
  vm.runInContext(source.replace('  void (async () => {\n    await loadState();', `
    globalThis.fixture = { runQueue, harvestPendingTasks, executeBridgeTask, applyAndFill,
      syncSubmitFieldsFromGateway, pullTasks, prepareManual,
      init: async () => { await loadState(); consumer = true; bridgeOnline = true; },
      get tasks() { return tasks; } };
    return;
    void (async () => {\n    await loadState();`), context);
  const api = context.fixture as {
    init(): Promise<void>; runQueue(): Promise<void>; harvestPendingTasks(): Promise<void>;
    executeBridgeTask(task: Task): Promise<void>; applyAndFill(task: Task): Promise<Task>;
    syncSubmitFieldsFromGateway(): Promise<void>; pullTasks(): Promise<void>; prepareManual(): Promise<void>;
    tasks: Task[];
  };
  return { api, events, stored, element,
    actions: () => events.map(event => event.action),
    posts: (route: string) => events.filter(event => event.action === route).map(event => event.body),
  };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('Pavo panel batch orchestration (no website or generation)', () => {
  it('binds the exact current new conversation, verifies a fresh console, then persists release', async () => {
    const task = pending();
    const app = panel([task]);
    await app.api.init();
    await app.api.runQueue();
    const actions = app.actions();
    expect(actions.indexOf('getCurrentConversation')).toBeGreaterThan(actions.indexOf('clickGenerate'));
    expect(actions.indexOf('/api/tasks/result-binding')).toBeGreaterThan(actions.indexOf('getCurrentConversation'));
    const recoveryAfterBinding = actions.findIndex((action, index) => action === 'recoverComposer'
      && index > actions.indexOf('/api/tasks/result-binding'));
    expect(recoveryAfterBinding).toBeGreaterThan(actions.indexOf('/api/tasks/result-binding'));
    expect(actions.indexOf('/api/tasks/composer-release')).toBeGreaterThan(recoveryAfterBinding);
    expect(app.posts('/api/tasks/result-binding')).toEqual([{ taskCode: 'ROOT', conversationId: 'CID-ROOT' }]);
    expect(app.posts('/api/tasks/composer-release')[0]).toMatchObject({ taskCode: 'ROOT', clientId: 'client-fixture',
      submitClaimId: 'claim-ROOT', freshConsoleConfirmed: true });
    expect(app.stored.pavoTaskQueue[0]).toMatchObject({ status: 'awaiting_result', pavoConversationId: 'CID-ROOT',
      composerReleasedAt: '2026-10-22T00:00:02Z' });
  });

  it('polls past an empty or stale current identity before binding', async () => {
    const task = pending();
    const identities = [ { success: true, conversationId: '', prompt: '' },
      { success: true, conversationId: 'OLD', prompt: task.prompt },
      { success: true, conversationId: 'NEW', prompt: task.prompt, status: 'generating' } ];
    const app = panel([task], { conversations: [{ cid: 'OLD' }], page: message =>
      message.action === 'getCurrentConversation' ? identities.shift() : undefined });
    await app.api.init();
    const running = app.api.runQueue();
    await vi.advanceTimersByTimeAsync(35_000);
    await running;
    expect(app.posts('/api/tasks/result-binding')).toEqual([{ taskCode: 'ROOT', conversationId: 'NEW' }]);
    expect(task.composerReleasedAt).toBeTruthy();
  });

  it.each([
    { success: true, conversationId: '', prompt: '' },
    { success: true, conversationId: 'OLD', prompt: 'Exact original user prompt' },
    { success: true, conversationId: 'NEW', prompt: 'Exact original user prompt ' },
    { success: false, conversationId: 'NEW', prompt: 'Exact original user prompt' },
  ])('never releases or resubmits an unknown current conversation: %j', async identity => {
    const task = submitted();
    const app = panel([task, pending('NEXT')], { page: message =>
      message.action === 'getCurrentConversation' ? identity : undefined });
    await app.api.init();
    const running = app.api.runQueue();
    await vi.advanceTimersByTimeAsync(35_000);
    await running;
    expect(app.posts('/api/tasks/composer-release')).toHaveLength(0);
    expect(app.posts('/api/tasks/submit-claim')).toHaveLength(0);
    expect(app.actions()).not.toContain('clickGenerate');
    expect(task.status).toBe('awaiting_result');
  });

  it.each([ { success: true }, { success: false, freshConsoleConfirmed: true } ])(
    'does not release on incomplete fresh-console evidence: %j', async recovery => {
      const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT' });
      const app = panel([task, pending('NEXT')], { page: message => message.action === 'recoverComposer' ? recovery : undefined });
      await app.api.init();
      await app.api.runQueue();
      expect(app.posts('/api/tasks/composer-release')).toHaveLength(0);
      expect(app.actions()).not.toContain('clickGenerate');
    });

  it('prioritizes releasing an active console and submits pending while its result is still generating', async () => {
    const active = submitted('ROOT', { pavoConversationId: 'CID-ROOT', nextHarvestAt: Date.now() + 60_000 });
    const next = pending('NEXT');
    const app = panel([active, next]);
    await app.api.init();
    await app.api.runQueue();
    const release = app.events.findIndex(event => event.action === '/api/tasks/composer-release' && event.body.taskCode === 'ROOT');
    const nextClaim = app.events.findIndex(event => event.action === '/api/tasks/submit-claim' && event.body.taskCode === 'NEXT');
    expect(release).toBeGreaterThanOrEqual(0);
    expect(nextClaim).toBeGreaterThan(release);
    expect(active.status).toBe('awaiting_result');
    expect(next.composerReleasedAt).toBeTruthy();
  });

  it('honors the server two-in-flight gate without clicking a third task', async () => {
    const task = pending('THIRD');
    const app = panel([task], { gateway: route => route === '/api/tasks/submit-claim'
      ? { status: 409, body: { queued: true, error: 'Two released attempts in flight' } } : undefined });
    await app.api.init();
    await app.api.runQueue();
    expect(task.status).toBe('pending');
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it('serializes concurrent queue calls across all console operations', async () => {
    let finish: (value: Task) => void = () => {};
    const task = pending();
    const app = panel([task, pending('NEXT')], { page: message => message.action === 'doGenerate'
      ? new Promise(resolve => { finish = resolve; }) : undefined });
    await app.api.init();
    const first = app.api.runQueue();
    for (let i = 0; i < 100; i++) await Promise.resolve();
    await app.api.runQueue();
    expect(app.actions().filter(action => action === 'doGenerate')).toHaveLength(1);
    finish({ success: true, uploaded: 0, referencesVerified: true });
    await first;
    expect(app.actions().filter(action => action === 'clickGenerate')).toHaveLength(1);
  });

  it.each([
    { uploaded: 0, referencesVerified: true },
    { uploaded: 1, referencesVerified: false },
    { uploaded: 1 },
    { uploaded: '1', referencesVerified: true },
  ])('blocks submission when reference preparation is unverified: %j', async setup => {
    const task = pending('ROOT', { referenceFiles: [{ fileName: 'ref.png', base64: 'fixture' }] });
    const app = panel([task], { page: message => message.action === 'doGenerate' ? { success: true, ...setup } : undefined });
    await app.api.init();
    await app.api.runQueue();
    expect(task.status).toBe('failed');
    expect(app.posts('/api/tasks/submit-claim')).toHaveLength(0);
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it('requires referencesVerified even when there are no attachments, including manual prepare', async () => {
    const app = panel([], { page: message => message.action === 'doGenerate' ? { success: true, uploaded: 0 } : undefined });
    await app.api.init();
    app.element('prompt').value = 'Manual fixture';
    await expect(app.api.prepareManual()).rejects.toThrow();
  });

  it.each(['generation', 'quota', 'auth', 'moderation', 'cancelled', 'unknown', undefined, 'unrecognized'])(
    'reports only content failure classification (%s) with bound evidence and terminal local state', async category => {
      const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
      const app = panel([task], { conversations: [{ cid: 'CID-ROOT', prompt: task.prompt, status: 'failed', failureCategory: category }] });
      await app.api.init();
      await app.api.harvestPendingTasks();
      expect(app.posts('/api/tasks/status').at(-1)).toMatchObject({ taskCode: 'ROOT', status: 'failed',
        failureEvidence: { conversationId: 'CID-ROOT', status: 'failed',
          category: !category || category === 'unrecognized' ? 'unknown' : category } });
      expect(task).toMatchObject({ status: 'failed', confirmedFailure: true, harvestDone: true });
    });

  it('pulls a retry child without resetting or clicking the failed root', async () => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    const child = pending('CHILD', { rootTaskCode: 'ROOT', parentTaskCode: 'ROOT', attemptNumber: 2 });
    const app = panel([task], { pending: [child], conversations: [
      { cid: 'CID-ROOT', prompt: task.prompt, status: 'error', failureCategory: 'generation' },
    ], gateway: (route, body) => route === '/api/tasks/status' && body.status === 'failed'
      ? { body: { success: true, retryTaskCode: 'CHILD', retryAfter: '2026-10-22T00:00:30Z' } } : undefined });
    await app.api.init();
    await app.api.runQueue();
    expect(app.actions()).toContain('/api/tasks/pending');
    expect(task).toMatchObject({ taskCode: 'ROOT', status: 'failed', harvestDone: true });
    expect(app.api.tasks.find(item => item.taskCode === 'CHILD')?.composerReleasedAt).toBeTruthy();
    expect(app.posts('/api/tasks/submit-claim').map(body => body.taskCode)).toEqual(['CHILD']);
  });

  it('keeps confirmed failed tasks terminal on gateway sync and out of the active console gate', async () => {
    const remote = submitted('ROOT', { status: 'failed', confirmedFailure: true, harvestDone: false, pavoConversationId: 'CID-ROOT' });
    const app = panel([submitted(), pending('NEXT')], { remote: [remote] });
    await app.api.init();
    await app.api.syncSubmitFieldsFromGateway();
    expect(app.api.tasks[0].status).toBe('failed');
    await app.api.runQueue();
    expect(app.posts('/api/tasks/submit-claim').map(body => body.taskCode)).toEqual(['NEXT']);
  });

  it('releases harvested terminal console ownership before moving on', async () => {
    const app = panel([submitted('DONE', { status: 'generating', harvestDone: true, pavoConversationId: 'CID-DONE' }), pending('NEXT')]);
    await app.api.init();
    await app.api.runQueue();
    expect(app.posts('/api/tasks/submit-claim').map(body => body.taskCode)).toEqual(['NEXT']);
  });

  it('completes only the matching bound media and never retries a download error as generation failure', async () => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    const app = panel([task], { conversations: [
      { cid: 'CID-OTHER', prompt: task.prompt, status: 'completed', videos: ['https://fixture.invalid/wrong.mp4'] },
      { cid: 'CID-ROOT', prompt: task.prompt, status: 'completed', videos: ['https://fixture.invalid/right.mp4'] },
    ], page: message => message.action === 'captureAndUploadMedia' ? { success: false, error: 'download failed' } : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(app.events.find(event => event.action === 'captureAndUploadMedia')?.body.mediaUrl).toBe('https://fixture.invalid/right.mp4');
    expect(task.status).toBe('awaiting_result');
    expect(task.confirmedFailure).not.toBe(true);
    expect(app.posts('/api/tasks/status').some(body => body.failureEvidence)).toBe(false);
  });

  it('fills an empty prompt from only a new cid history, never the old or another task cid', async () => {
    const task = submitted();
    const app = panel([task, submitted('OTHER', { pavoConversationId: 'TAKEN', harvestDone: true })], { conversations: [
      { cid: 'OLD', prompt: '', status: 'failed' }, { cid: 'TAKEN', prompt: '', status: 'failed' },
      { cid: 'NEW', prompt: '', status: 'generating' },
    ], page: message => message.action === 'fetchConversationVideos'
      ? { success: true, conversationId: message.conversationId, prompt: task.prompt, status: 'error', failureCategory: 'generation', videos: [] } : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(app.events.filter(event => event.action === 'fetchConversationVideos').map(event => event.body.conversationId)).toEqual(['NEW']);
    expect(app.posts('/api/tasks/result-binding')).toEqual([{ taskCode: 'ROOT', conversationId: 'NEW' }]);
    expect(app.posts('/api/tasks/status').at(-1)?.failureEvidence).toEqual({ conversationId: 'NEW', status: 'error', category: 'generation' });
  });

  it('does not postpone due harvesting each time an unreleased current identity remains unknown', async () => {
    const task = submitted('ROOT', { nextHarvestAt: Date.now() });
    const app = panel([task], { conversations: [{ cid: 'NEW', prompt: task.prompt, status: 'failed' }],
      page: message => message.action === 'getCurrentConversation' ? Promise.reject(new Error('History unavailable')) : undefined });
    await app.api.init();
    await app.api.runQueue();
    expect(task).toMatchObject({ status: 'failed', confirmedFailure: true, harvestDone: true });
    expect(app.posts('/api/tasks/composer-release')).toHaveLength(0);
    expect(app.posts('/api/tasks/status').at(-1)?.failureEvidence.category).toBe('unknown');
  });

  it('allows two released attempts in flight but never clicks the server-rejected third', async () => {
    const initial = [pending('ONE'), pending('TWO'), pending('THREE')];
    let claims = 0;
    const app = panel(initial, { gateway: route => route === '/api/tasks/submit-claim' && ++claims > 2
      ? { status: 409, body: { queued: true, error: 'Two attempts in flight' } } : undefined });
    await app.api.init();
    await app.api.runQueue();
    await app.api.runQueue();
    await app.api.runQueue();
    expect(app.events.filter(event => event.action === 'clickGenerate').map(event => event.body.taskCode)).toEqual(['ONE', 'TWO']);
    expect(initial.map(task => task.status)).toEqual(['awaiting_result', 'awaiting_result', 'pending']);
    expect(app.posts('/api/tasks/composer-release').map(body => body.taskCode)).toEqual(['ONE', 'TWO']);
  });

  it.each([ { success: true }, { success: false, composerReleasedAt: 'not-accepted' } ])(
    'keeps the console occupied until the gateway acknowledges release: %j', async release => {
      const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT' });
      const app = panel([task, pending('NEXT')], { gateway: route => route === '/api/tasks/composer-release'
        ? { body: release } : undefined });
      await app.api.init();
      await app.api.runQueue();
      expect(task.composerReleasedAt).toBeUndefined();
      expect(app.posts('/api/tasks/submit-claim')).toHaveLength(0);
    });

  it('retains query eligibility when the gateway rejects terminal failure evidence', async () => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    const app = panel([task], { conversations: [{ cid: 'CID-ROOT', prompt: task.prompt, status: 'failed', failureCategory: 'generation' }],
      gateway: route => route === '/api/tasks/status' ? { status: 409, body: { error: 'Evidence rejected' } } : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(task.status).toBe('awaiting_result');
    expect(task.confirmedFailure).not.toBe(true);
    expect(task.harvestDone).not.toBe(true);
    expect(app.actions()).not.toContain('/api/tasks/pending');
  });

  it('does not infer generation failure from another category property or an ambiguous status', async () => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    const app = panel([task], { conversations: [{ cid: 'CID-ROOT', prompt: task.prompt, status: 'failure', category: 'generation' }] });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(task.status).toBe('awaiting_result');
    expect(app.posts('/api/tasks/status')).toHaveLength(0);
  });

  it('does not bind an HTTP-success history response that lacks a verified original prompt', async () => {
    const task = submitted();
    const app = panel([task], { conversations: [{ cid: 'NEW', prompt: '', status: 'failed' }],
      page: message => message.action === 'fetchConversationVideos'
        ? { success: true, error: 'Business error', videos: [] } : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(app.posts('/api/tasks/result-binding')).toHaveLength(0);
    expect(task.status).toBe('awaiting_result');
    expect(task.confirmedFailure).not.toBe(true);
  });

  it('preserves failed roots and retry cooldown when pending tasks are pulled', async () => {
    const root = submitted('ROOT', { status: 'failed', confirmedFailure: true, harvestDone: true });
    const child = pending('CHILD', { parentTaskCode: 'ROOT', rootTaskCode: 'ROOT', retryAfter: new Date(Date.now() + 60_000).toISOString() });
    const app = panel([root], { pending: [pending('ROOT'), child] });
    await app.api.init();
    await app.api.pullTasks();
    for (let i = 0; i < 100; i++) await Promise.resolve();
    await app.api.runQueue();
    expect(root.status).toBe('failed');
    expect(app.api.tasks.find(task => task.taskCode === 'CHILD')?.status).toBe('pending');
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it('does not release a new current cid already owned by a different attempt', async () => {
    const task = submitted('ROOT');
    const other = submitted('OTHER', { pavoConversationId: 'TAKEN', composerReleasedAt: 'released' });
    const app = panel([task, other], { page: message => message.action === 'getCurrentConversation'
      ? { success: true, conversationId: 'TAKEN', prompt: task.prompt } : undefined });
    await app.api.init();
    const running = app.api.runQueue();
    await vi.advanceTimersByTimeAsync(35_000);
    await running;
    expect(app.posts('/api/tasks/result-binding')).toHaveLength(0);
    expect(app.posts('/api/tasks/composer-release')).toHaveLength(0);
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it('preserves a long current conversation id byte-for-byte in binding and release', async () => {
    const conversationId = '987654321098765431';
    const task = pending();
    const app = panel([task], { page: message => message.action === 'getCurrentConversation'
      ? { success: true, conversationId, prompt: task.prompt, status: 'generating' } : undefined });
    await app.api.init();
    await app.api.runQueue();
    expect(app.posts('/api/tasks/result-binding')[0].conversationId).toBe('987654321098765431');
    expect(app.posts('/api/tasks/composer-release')[0].conversationId).toBe('987654321098765431');
    expect(task.pavoConversationId).toBe('987654321098765431');
  });

  it('does not turn a dry run into a submission or console release', async () => {
    const task = pending('DRY', { realSubmit: false });
    const app = panel([task]);
    await app.api.init();
    await app.api.runQueue();
    expect(task.status).toBe('completed');
    expect(app.posts('/api/tasks/submit-claim')).toHaveLength(0);
    expect(app.posts('/api/tasks/composer-release')).toHaveLength(0);
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it.each([
    { composerReleasedAt: 'released' },
    { status: 'generating', harvestDone: true, composerReleasedAt: 'released' },
  ])('uses the same console ownership gate for manual preparation: %j', async state => {
    const app = panel([submitted('ROOT', state)]);
    await app.api.init();
    app.element('prompt').value = 'Manual fixture';
    await expect(app.api.prepareManual()).resolves.toBeUndefined();
    expect(app.actions()).toContain('doGenerate');
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it('refuses ambiguous same-prompt failed conversations instead of authorizing a retry', async () => {
    const task = submitted();
    const app = panel([task], { conversations: ['NEW-1', 'NEW-2'].map(cid =>
      ({ cid, prompt: task.prompt, status: 'failed', failureCategory: 'generation' })) });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(task.status).toBe('awaiting_result');
    expect(app.posts('/api/tasks/result-binding')).toHaveLength(0);
    expect(app.posts('/api/tasks/status').some(body => body.failureEvidence)).toBe(false);
  });

  it('collects only finalized bound output and marks persisted completion locally', async () => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    const app = panel([task], { conversations: [{ cid: 'CID-ROOT', prompt: task.prompt, status: 'completed',
      videos: ['https://fixture.invalid/final.mp4'] }] });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(task).toMatchObject({ status: 'completed', syncedFileCount: 1, harvestDone: true });
    expect(app.posts('/api/tasks/status').map(body => body.status)).toEqual(['uploading', 'completed']);
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it('reads history even when a bound failed list entry already contains its prompt', async () => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    const app = panel([task], { conversations: [{ cid: 'CID-ROOT', prompt: task.prompt, status: 'failed' }],
      page: message => message.action === 'fetchConversationVideos' ? { success: true, conversationId: 'CID-ROOT',
        prompt: task.prompt, status: 'failed', failureCategory: 'generation', videos: [], images: [] } : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(app.posts('/api/tasks/status').at(-1)?.failureEvidence).toEqual({
      conversationId: 'CID-ROOT', status: 'failed', category: 'generation',
    });
    expect(task).toMatchObject({ confirmedFailure: true, harvestDone: true });
  });

  it.each(['failed', 'completed'])('does not trust stale list %s when latest history is processing', async status => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    const app = panel([task], { conversations: [{ cid: 'CID-ROOT', prompt: task.prompt, status,
      failureCategory: 'generation', videos: ['https://fixture.invalid/stale.mp4'] }],
      page: message => message.action === 'fetchConversationVideos' ? { success: true, conversationId: 'CID-ROOT',
        prompt: task.prompt, status: 'processing', videos: [], images: [] } : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(task.status).toBe('awaiting_result');
    expect(task.harvestDone).not.toBe(true);
    expect(app.actions()).not.toContain('captureAndUploadMedia');
    expect(app.posts('/api/tasks/status').some(body => body.failureEvidence)).toBe(false);
  });

  it.each([
    { success: false, error: 'History business failure' },
    { success: true, conversationId: 'WRONG', prompt: 'Exact original user prompt', status: 'failed', failureCategory: 'generation' },
    { success: true, conversationId: 'CID-ROOT', prompt: 'Different user prompt', status: 'failed', failureCategory: 'generation' },
    { success: true, conversationId: 'CID-ROOT', prompt: '', status: 'completed', videos: ['https://fixture.invalid/wrong.mp4'] },
  ])('waits without uploading or confirming failure on invalid bound history: %j', async history => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    const app = panel([task], { conversations: [{ cid: 'CID-ROOT', prompt: task.prompt, status: 'completed',
      videos: ['https://fixture.invalid/list-only.mp4'] }],
      page: message => message.action === 'fetchConversationVideos' ? history : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(task.status).toBe('awaiting_result');
    expect(task.harvestDone).not.toBe(true);
    expect(app.actions()).not.toContain('captureAndUploadMedia');
    expect(app.posts('/api/tasks/status').some(body => body.failureEvidence)).toBe(false);
  });

  it('keeps querying a bound cid missing from the list and later collects only its current history results', async () => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    let done = false;
    const app = panel([task], { conversations: [], page: message => message.action === 'fetchConversationVideos'
      ? { success: true, conversationId: 'CID-ROOT', prompt: task.prompt, status: done ? 'completed' : 'processing',
        videos: done ? ['https://fixture.invalid/latest.mp4'] : [], images: [] } : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(app.events.filter(event => event.action === 'fetchConversationVideos').map(event => event.body.conversationId)).toEqual(['CID-ROOT']);
    expect(task.status).toBe('awaiting_result');
    done = true;
    task.nextHarvestAt = 0;
    await app.api.harvestPendingTasks();
    expect(task).toMatchObject({ status: 'completed', harvestDone: true, syncedFileCount: 1 });
    expect(app.events.find(event => event.action === 'captureAndUploadMedia')?.body.mediaUrl).toBe('https://fixture.invalid/latest.mp4');
  });

  it('does not bind a prompt-populated candidate when its history identity or prompt is unverified', async () => {
    const task = submitted();
    const app = panel([task], { conversations: [{ cid: 'NEW', prompt: task.prompt, status: 'failed', failureCategory: 'generation' }],
      page: message => message.action === 'fetchConversationVideos' ? { success: false, error: 'History unavailable' } : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(app.posts('/api/tasks/result-binding')).toHaveLength(0);
    expect(task.status).toBe('awaiting_result');
    expect(task.confirmedFailure).not.toBe(true);
  });

  it('keeps terminal failure unknown when only the list supplied a generation category', async () => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    const app = panel([task], { conversations: [{ cid: 'CID-ROOT', prompt: task.prompt, status: 'failed', failureCategory: 'generation' }],
      page: message => message.action === 'fetchConversationVideos' ? { success: true, conversationId: 'CID-ROOT',
        prompt: task.prompt, status: 'failed', videos: [], images: [] } : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(app.posts('/api/tasks/status').at(-1)?.failureEvidence.category).toBe('unknown');
  });

  it('does not fall back to list outputs when a bound history request throws', async () => {
    const task = submitted('ROOT', { pavoConversationId: 'CID-ROOT', composerReleasedAt: 'released' });
    const app = panel([task], { conversations: [{ cid: 'CID-ROOT', prompt: task.prompt, status: 'completed',
      videos: ['https://fixture.invalid/stale.mp4'] }], page: message => message.action === 'fetchConversationVideos'
      ? Promise.reject(new Error('History request failed')) : undefined });
    await app.api.init();
    await app.api.harvestPendingTasks();
    expect(task.status).toBe('awaiting_result');
    expect(task.harvestDone).not.toBe(true);
    expect(app.actions()).not.toContain('captureAndUploadMedia');
  });

  it.each([
    { status: 'failed', confirmedFailure: true, harvestDone: true },
    { status: 'completed', syncedFileCount: 1, harvestDone: true },
    { status: 'generating', harvestDone: true },
  ])('releases a terminal but dirty console before preparing the next task: %j', async state => {
    const root = submitted('ROOT', { ...state, pavoConversationId: 'CID-ROOT' });
    const app = panel([root, pending('NEXT')]);
    await app.api.init();
    await app.api.runQueue();
    const actions = app.actions();
    expect(actions.indexOf('recoverComposer')).toBeLessThan(actions.indexOf('doGenerate'));
    expect(app.posts('/api/tasks/composer-release').map(body => body.taskCode)).toEqual(['ROOT', 'NEXT']);
    expect(app.events.findIndex(event => event.action === '/api/tasks/composer-release' && event.body.taskCode === 'ROOT'))
      .toBeLessThan(app.events.findIndex(event => event.action === '/api/tasks/submit-claim' && event.body.taskCode === 'NEXT'));
    expect(root).toMatchObject(state);
    expect(app.posts('/api/tasks/status').filter(body => body.taskCode === 'ROOT')).toHaveLength(0);
  });

  it('keeps terminal attempts immutable and the next task queued when fresh recovery fails', async () => {
    const root = submitted('ROOT', { status: 'failed', confirmedFailure: true, harvestDone: true, pavoConversationId: 'CID-ROOT' });
    const app = panel([root, pending('NEXT')], { page: message => message.action === 'recoverComposer'
      ? { success: true, freshConsoleConfirmed: false } : undefined });
    await app.api.init();
    await app.api.runQueue();
    expect(root.status).toBe('failed');
    expect(root.harvestDone).toBe(true);
    expect(app.actions()).not.toContain('doGenerate');
    expect(app.posts('/api/tasks/submit-claim')).toHaveLength(0);
    expect(app.posts('/api/tasks/status')).toHaveLength(0);
  });

  it('does not let manual preparation bypass terminal unreleased console ownership', async () => {
    const root = submitted('ROOT', { status: 'failed', confirmedFailure: true, harvestDone: true, pavoConversationId: 'CID-ROOT' });
    const app = panel([root]);
    await app.api.init();
    app.element('prompt').value = 'Manual fixture';
    await expect(app.api.prepareManual()).rejects.toThrow();
    expect(app.actions()).not.toContain('doGenerate');
  });

  it('revalidates current references after mode changes and never claims a remounted empty input', async () => {
    let attached: string[] = [];
    const task = pending('ROOT', { modelConfig: { referenceMode: '全能参考' },
      referenceFiles: [{ fileName: 'first.png', base64: 'fixture' }] });
    const app = panel([task], { page: message => {
      if (message.action === 'doGenerate') {
        attached = ['first.png'];
        return { success: true, uploaded: 1, referencesVerified: true, referenceNames: attached };
      }
      if (message.action === 'applyPreset' && message.preset.referenceMode) {
        attached = [];
        return { success: true, result: { referenceMode: true } };
      }
      if (message.action === 'verifyPreparedTask') return { success: true, promptVerified: true,
        referencesVerified: attached.length === 1, preparedSnapshotVerified: true, uploaded: attached.length, referenceNames: attached };
    } });
    await app.api.init();
    await app.api.runQueue();
    expect(app.actions()).toContain('verifyPreparedTask');
    expect(app.posts('/api/tasks/submit-claim')).toHaveLength(0);
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it('validates ordered reference names and exact prompt after all presets, before claim and again before click', async () => {
    const task = pending('ROOT', { modelConfig: { referenceMode: '全能参考' },
      referenceFiles: ['first.png', 'second.png'].map(fileName => ({ fileName, base64: 'fixture' })) });
    const app = panel([task], { page: message => message.action === 'applyPreset'
      ? { success: true, result: { referenceMode: true } } : undefined });
    await app.api.init();
    await app.api.runQueue();
    const verifications = app.events.map((event, index) => ({ event, index })).filter(item => item.event.action === 'verifyPreparedTask');
    expect(verifications.length).toBeGreaterThanOrEqual(2);
    for (const { event } of verifications) expect(event.body).toMatchObject({ prompt: 'Exact original user prompt', referenceNames: ['first.png', 'second.png'] });
    const lastPreset = app.actions().lastIndexOf('applyPreset');
    const claim = app.actions().indexOf('/api/tasks/submit-claim');
    const click = app.actions().indexOf('clickGenerate');
    expect(verifications.some(item => item.index > lastPreset && item.index < claim)).toBe(true);
    expect(verifications.some(item => item.index > claim && item.index < click)).toBe(true);
    expect(task.composerReleasedAt).toBeTruthy();
  });

  it('stops before clicking when inputs change while the claim request is in flight', async () => {
    let claimed = false;
    const task = pending();
    const app = panel([task], { gateway: route => { if (route === '/api/tasks/submit-claim') claimed = true; return undefined; },
      page: message => message.action === 'verifyPreparedTask' ? { success: true, promptVerified: !claimed,
        referencesVerified: true, preparedSnapshotVerified: true, uploaded: 0, referenceNames: [] } : undefined });
    await app.api.init();
    await app.api.runQueue();
    expect(task.submitClaimId).toBe('claim-ROOT');
    expect(task.status).toBe('awaiting_result');
    expect(app.actions()).not.toContain('clickGenerate');
    expect(app.posts('/api/tasks/composer-release')).toHaveLength(0);
  });

  it.each([
    { success: true, promptVerified: false, referencesVerified: true },
    { success: true, promptVerified: true, referencesVerified: false },
    { success: true, referencesVerified: true },
  ])('requires final read-only validation for manual preparation: %j', async validation => {
    const app = panel([], { page: message => message.action === 'verifyPreparedTask' ? validation : undefined });
    await app.api.init();
    app.element('prompt').value = 'Manual fixture';
    await expect(app.api.prepareManual()).rejects.toThrow();
    expect(app.actions()).toContain('verifyPreparedTask');
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it('does not touch the composer at the local two-inflight limit, then prepares once capacity returns', async () => {
    const first = submitted('ONE', { composerReleasedAt: 'released', nextHarvestAt: Date.now() + 60_000 });
    const second = submitted('TWO', { composerReleasedAt: 'released', nextHarvestAt: Date.now() + 60_000 });
    const third = pending('THIRD', { referenceFiles: [{ fileName: 'third.png', base64: 'fixture' }] });
    const app = panel([first, second, third]);
    await app.api.init();
    await app.api.runQueue();
    expect(app.actions()).not.toContain('doGenerate');
    expect(app.actions()).not.toContain('applyPreset');
    expect(app.posts('/api/tasks/submit-claim')).toHaveLength(0);
    expect(third.status).toBe('pending');
    first.harvestDone = true;
    first.status = 'completed';
    first.syncedFileCount = 1;
    await app.api.runQueue();
    expect(app.actions().filter(action => action === 'doGenerate')).toHaveLength(1);
    expect(app.events.filter(event => event.action === 'clickGenerate').map(event => event.body.taskCode)).toEqual(['THIRD']);
  });

  it('reuses only the same verified prepared task after a queued rejection instead of uploading twice', async () => {
    let attached: string[] = [];
    let currentPrompt = '';
    let uploads = 0;
    let claims = 0;
    const task = pending('THIRD', { referenceFiles: [{ fileName: 'third.png', base64: 'fixture' }] });
    const app = panel([task], { gateway: route => route === '/api/tasks/submit-claim' && ++claims === 1
      ? { status: 409, body: { queued: true, error: 'Capacity changed' } } : undefined,
      page: message => {
        if (message.action === 'recoverComposer') { attached = []; currentPrompt = ''; }
        if (message.action === 'doGenerate') {
          if (attached.length) return { success: false, error: 'Residual attachments' };
          uploads++;
          attached = message.fileReferences.map((reference: Task) => reference.fileName);
          currentPrompt = message.prompt;
          return { success: true, uploaded: attached.length, referencesVerified: true, referenceNames: attached };
        }
        if (message.action === 'verifyPreparedTask') return { success: true,
          promptVerified: currentPrompt === message.prompt,
          referencesVerified: JSON.stringify(attached) === JSON.stringify(message.referenceNames),
          preparedSnapshotVerified: true, uploaded: attached.length, referenceNames: attached };
      } });
    await app.api.init();
    await app.api.runQueue();
    expect(task.status).toBe('pending');
    app.api.tasks.unshift(pending('OTHER', { prompt: 'A different task' }));
    await app.api.runQueue();
    expect(uploads).toBe(1);
    expect(claims).toBe(2);
    expect(app.events.filter(event => event.action === 'clickGenerate').map(event => event.body.taskCode)).toEqual(['THIRD']);
    expect(task.composerReleasedAt).toBeTruthy();
  });

  it('does not adopt changed prepared input or reupload attachments after a queued rejection', async () => {
    let rejected = false;
    const task = pending('THIRD', { referenceFiles: [{ fileName: 'third.png', base64: 'fixture' }] });
    const app = panel([task], { gateway: route => {
      if (route === '/api/tasks/submit-claim' && !rejected) { rejected = true; return { status: 409, body: { queued: true, error: 'Capacity changed' } }; }
    }, page: message => message.action === 'verifyPreparedTask' && rejected
      ? { success: true, promptVerified: false, referencesVerified: true, preparedSnapshotVerified: true, uploaded: 1, referenceNames: ['third.png'] } : undefined });
    await app.api.init();
    await app.api.runQueue();
    await app.api.runQueue();
    expect(app.actions().filter(action => action === 'doGenerate')).toHaveLength(1);
    expect(app.posts('/api/tasks/submit-claim')).toHaveLength(1);
    expect(app.actions()).not.toContain('clickGenerate');
    expect(task.status).toBe('pending');
  });

  it('restores queued prepared ownership after reopening the panel without reuploading', async () => {
    let uploads = 0;
    const page = (message: Task) => {
      if (message.action === 'doGenerate') {
        uploads++;
        return { success: true, uploaded: 1, referencesVerified: true, referenceNames: ['resume.png'] };
      }
    };
    const task = pending('RESUME', { referenceFiles: [{ fileName: 'resume.png', base64: 'fixture' }] });
    const first = panel([task], { page, gateway: route => route === '/api/tasks/submit-claim'
      ? { status: 409, body: { queued: true, error: 'Full' } } : undefined });
    await first.api.init();
    await first.api.runQueue();
    expect(first.stored.pavoTaskQueue[0].preparedInput).toBeDefined();
    const persisted = JSON.parse(JSON.stringify(first.stored.pavoTaskQueue));
    const reopened = panel(persisted, { page });
    await reopened.api.init();
    await reopened.api.runQueue();
    expect(uploads).toBe(1);
    expect(reopened.actions()).not.toContain('doGenerate');
    expect(reopened.actions().indexOf('verifyPreparedTask')).toBeLessThan(reopened.actions().indexOf('/api/tasks/submit-claim'));
    expect(reopened.api.tasks[0].composerReleasedAt).toBeTruthy();
  });

  it('does not reuse a queued snapshot under changed task parameters even if the page reports verification success', async () => {
    const task = pending('THIRD', { referenceFiles: [{ fileName: 'third.png', base64: 'fixture' }] });
    const app = panel([task], { gateway: route => route === '/api/tasks/submit-claim'
      ? { status: 409, body: { queued: true, error: 'Full' } } : undefined });
    await app.api.init();
    await app.api.runQueue();
    task.prompt = 'A different original user prompt';
    await app.api.runQueue();
    expect(app.actions().filter(action => action === 'doGenerate')).toHaveLength(1);
    expect(app.posts('/api/tasks/submit-claim')).toHaveLength(1);
    expect(task.status).toBe('pending');
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it('rebuilds a persisted prepared input before claiming when a page reload lost the content snapshot', async () => {
    let snapshotPresent = false;
    let uploads = 0;
    let claims = 0;
    const page = (message: Task) => {
      if (message.action === 'recoverComposer') snapshotPresent = false;
      if (message.action === 'doGenerate') {
        snapshotPresent = true;
        uploads++;
        return { success: true, uploaded: 1, referencesVerified: true, referenceNames: ['resume.png'] };
      }
      if (message.action === 'verifyPreparedTask') return { success: true, promptVerified: true,
        referencesVerified: true, uploaded: 1, referenceNames: ['resume.png'], preparedSnapshotVerified: snapshotPresent };
      if (message.action === 'clickGenerate' && !snapshotPresent) return { success: false, error: 'No content prepared snapshot' };
    };
    const gateway = (route: string) => route === '/api/tasks/submit-claim' && ++claims === 1
      ? { status: 409, body: { queued: true, error: 'Full' } } : undefined;
    const first = panel([pending('RESUME', { referenceFiles: [{ fileName: 'resume.png', base64: 'fixture' }] })], { page, gateway });
    await first.api.init();
    await first.api.runQueue();
    expect(first.api.tasks[0].status).toBe('pending');
    const persisted = JSON.parse(JSON.stringify(first.stored.pavoTaskQueue));
    snapshotPresent = false;
    const reopened = panel(persisted, { page, gateway });
    await reopened.api.init();
    await reopened.api.runQueue();
    const actions = reopened.actions();
    expect(actions.indexOf('verifyPreparedTask')).toBeLessThan(actions.indexOf('recoverComposer'));
    expect(actions.indexOf('recoverComposer')).toBeLessThan(actions.indexOf('doGenerate'));
    expect(actions.indexOf('doGenerate')).toBeLessThan(actions.indexOf('/api/tasks/submit-claim'));
    expect(uploads).toBe(2);
    expect(claims).toBe(2);
    expect(actions.filter(action => action === 'clickGenerate')).toHaveLength(1);
    expect(reopened.api.tasks[0].composerReleasedAt).toBeTruthy();
  });

  it.each([false, undefined, 'true'])('never claims on an unconfirmed content snapshot (%s)', async preparedSnapshotVerified => {
    const app = panel([pending()], { page: message => message.action === 'verifyPreparedTask'
      ? { success: true, promptVerified: true, referencesVerified: true, uploaded: 0, referenceNames: [], preparedSnapshotVerified } : undefined });
    await app.api.init();
    await app.api.runQueue();
    expect(app.posts('/api/tasks/submit-claim')).toHaveLength(0);
    expect(app.actions()).not.toContain('clickGenerate');
  });

  it('checks snapshot presence again immediately before claiming after baseline collection', async () => {
    let snapshotPresent = true;
    const app = panel([pending()], { page: message => {
      if (message.action === 'snapshotMediaOutputs') snapshotPresent = false;
      if (message.action === 'verifyPreparedTask') return { success: true, promptVerified: true,
        referencesVerified: true, uploaded: 0, referenceNames: [], preparedSnapshotVerified: snapshotPresent };
    } });
    await app.api.init();
    await app.api.runQueue();
    expect(app.posts('/api/tasks/submit-claim')).toHaveLength(0);
    expect(app.actions()).not.toContain('clickGenerate');
    expect(app.api.tasks[0].status).toBe('pending');
  });

  it('does not reprepare or click if snapshot presence is lost after the claim was granted', async () => {
    let claimed = false;
    const app = panel([pending()], { gateway: route => { if (route === '/api/tasks/submit-claim') claimed = true; return undefined; },
      page: message => message.action === 'verifyPreparedTask' ? { success: true, promptVerified: true,
        referencesVerified: true, uploaded: 0, referenceNames: [], preparedSnapshotVerified: !claimed } : undefined });
    await app.api.init();
    await app.api.runQueue();
    expect(app.api.tasks[0].status).toBe('awaiting_result');
    expect(app.api.tasks[0].submitClaimId).toBe('claim-ROOT');
    expect(app.actions().filter(action => action === 'doGenerate')).toHaveLength(1);
    expect(app.actions()).not.toContain('clickGenerate');
    expect(app.posts('/api/tasks/composer-release')).toHaveLength(0);
  });
});
