(function initPavoPanel() {
  'use strict';

  const media = globalThis.PavoMedia;
  const $ = id => document.getElementById(id);
  const pageDot = $('pageDot');
  const pageStatus = $('pageStatus');
  const bridgeDot = $('bridgeDot');
  const bridgeStatus = $('bridgeStatus');
  const hostMode = $('hostMode');
  const queueSummary = $('queueSummary');
  const taskContainer = $('tasks');
  const logElement = $('log');
  const manualStatus = $('manualStatus');
  const TASK_LOCK = 'nomi-pavo-web-task-consumer';
  const PANEL_VERSION = '0.2.1-safety-0927';
  const BRIDGE_INSTANCE_ID = 'nomi-pavo-web-v1';
  const SAFETY_CONTRACT_VERSION = 1;
  const ACTIVE_STATUSES = new Set(['configuring', 'submitting', 'generating', 'awaiting_result', 'uploading']);
  const FAILURE_CATEGORIES = new Set(['generation', 'auth', 'quota', 'moderation', 'cancelled', 'unknown']);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  let apiBaseUrl = 'http://127.0.0.1:3458';
  let apiToken = '';
  let clientId = '';
  let tasks = [];
  let bridgeOnline = false;
  let consumer = false;
  let executing = false;
  let polling = false;
  let connectionEpoch = 0;
  let configurationRevision = 0;
  let connectionProbe = null;
  let connectionUpdate = null;
  let pendingConnectionUpdate = false;
  let connectionBlocked = false;
  let reconnectTimer = null;
  let pageProbe = null;
  let lastPageLog = '';
  let harvestForce = false;
  let lastGateLog = { text: '', at: 0 };

  function gateLog(text) {
    const now = Date.now();
    if (lastGateLog.text === text && now - lastGateLog.at < 60_000) return;
    lastGateLog = { text, at: now };
    log(text);
  }

  function eligibleHarvestTasks(force = false) {
    return tasks.filter(task => (task.submittedAt || task.submitClaimedAt)
      && !task.syncedFileCount
      && !task.harvestDone
      && !task.confirmedFailure
      && (force || (task.harvestAttempts || 0) < 288));
  }

  async function syncSubmitFieldsFromGateway() {
    if (!bridgeOnline || pendingConnectionUpdate) return;
    const epoch = connectionEpoch;
    try {
      const result = await apiFetch('/api/tasks');
      if (epoch !== connectionEpoch || pendingConnectionUpdate) return;
      const incoming = Array.isArray(result?.tasks) ? result.tasks : [];
      let merged = 0;
      for (const remote of incoming) {
        if (!remote.submitClaimedAt && !remote.submittedAt) continue;
        let local = tasks.find(task => task.taskCode === remote.taskCode);
        if (!local) {
          local = { ...remote };
          tasks.push(local);
        } else {
          Object.assign(local, remote);
        }
        // Old completed-without-files tasks are not really complete.
        if (local.status === 'failed' && local.failureEvidence) local.confirmedFailure = true;
        if (!local.syncedFileCount && !local.harvestDone && !local.confirmedFailure
          && (local.status === 'completed' || local.status === 'failed')) local.status = 'awaiting_result';
        merged += 1;
      }
      if (merged) {
        await saveState();
        renderTasks();
        log(`已从网关恢复 ${merged} 个已提交任务，仅查询结果，不重新生成`);
      }
    } catch { /* 网关不可达时跳过 */ }
  }
  let eventSource = null;

  function log(message) {
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${message}`;
    logElement.appendChild(line);
    logElement.scrollTop = logElement.scrollHeight;
  }

  function safeError(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function setDot(element, state) {
    element.className = `dot${state ? ` ${state}` : ''}`;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  async function loadState() {
    const stored = await chrome.storage.local.get([
      'apiBaseUrl', 'apiToken', 'pavoClientId', 'pavoTaskQueue', 'preset', 'pavoPrompt',
    ]);
    apiBaseUrl = String(stored.apiBaseUrl || apiBaseUrl).replace(/\/$/, '');
    apiToken = String(stored.apiToken || '');
    clientId = String(stored.pavoClientId || `pavo-${crypto.randomUUID()}`);
    tasks = Array.isArray(stored.pavoTaskQueue) ? stored.pavoTaskQueue : [];
    $('prompt').value = stored.pavoPrompt || '';
    const preset = stored.preset || {};
    for (const key of ['model', 'referenceMode', 'aspectRatio', 'duration']) {
      if (preset[key] && $(key)) $(key).value = preset[key];
    }
    await chrome.storage.local.set({ pavoClientId: clientId });
    renderTasks();
  }

  async function saveState() {
    await chrome.storage.local.set({
      pavoTaskQueue: tasks,
      pavoPrompt: $('prompt').value,
      preset: manualPreset(),
    });
  }

  function manualPreset() {
    return {
      model: $('model').value,
      referenceMode: $('referenceMode').value,
      aspectRatio: $('aspectRatio').value,
      duration: $('duration').value,
    };
  }

  async function findPavoTab(createIfMissing = false) {
    let tabs = await chrome.tabs.query({ url: 'https://app.pavo-ai.cn/*' });
    let tab = tabs.find(candidate => candidate.active) || tabs[0] || null;
    if (!tab && createIfMissing) {
      tab = await chrome.tabs.create({ url: media.pageUrlForMediaType('video'), active: true });
      await sleep(1800);
    }
    return tab;
  }

  async function send(message, timeoutMs = 30_000, createIfMissing = true) {
    const tab = await findPavoTab(createIfMissing);
    if (!tab?.id) throw new Error('Pavo 页面未打开');
    let timer;
    try {
      return await Promise.race([
        chrome.tabs.sendMessage(tab.id, message),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Pavo 页面操作超时')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function refreshPageStatus() {
    if (!pageProbe) pageProbe = inspectPageStatus().finally(() => { pageProbe = null; });
    return pageProbe;
  }

  async function inspectPageStatus() {
    try {
      const response = await send({ action: 'getPageInfo' }, 8_000, false);
      const mediaType = media.normalizeMediaType(response?.info?.mediaType);
      const ready = response?.success && media.pageInfoReadyForMediaType(mediaType, response.info);
      setDot(pageDot, ready ? 'ok' : 'busy');
      pageStatus.textContent = ready ? `Pavo ${media.mediaLabel(mediaType)}工作台已就绪（提交前仍会校验参数）` : 'Pavo 页面已打开，请检查登录和工作台';
      lastPageLog = '';
      return ready;
    } catch (error) {
      setDot(pageDot, '');
      pageStatus.textContent = 'Pavo 页面未连接';
      const detail = safeError(error);
      const hint = /Receiving end does not exist|Could not establish/i.test(detail) ? '（请刷新 Pavo 页面）' : '';
      const line = `页面检查失败：${detail}${hint}`;
      if (line !== lastPageLog) {
        lastPageLog = line;
        log(line);
      }
      return false;
    }
  }

  async function waitForWorkbench(mediaType = 'video', timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const response = await send({ action: 'getPageInfo' }, 8_000);
        if (response?.success && media.pageInfoReadyForMediaType(mediaType, response.info)) return response.info;
        lastError = new Error(`Pavo 页面已打开，请登录并切换到${media.mediaLabel(mediaType)}工作台`);
      } catch (error) {
        lastError = error;
      }
      await sleep(1_000);
    }
    throw lastError || new Error(`Pavo ${media.mediaLabel(mediaType)}工作台等待超时`);
  }

  async function applyPresetWithReadback(mediaType, modelConfig) {
    let validation = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await send({
        action: 'applyPreset',
        preset: { ...modelConfig, mediaType },
      }, 120_000);
      validation = media.validateAppliedPreset(mediaType, modelConfig, response);
      if (validation.ok) return;
      if (attempt < 2) await sleep(1_000);
    }
    let dump = '';
    try {
      const debug = await send({ action: 'dumpSelectControls' }, 8_000);
      if (debug?.success && Array.isArray(debug.controls) && debug.controls.length) {
        dump = `｜页面控件快照: ${debug.controls.join(' ／ ')}`.slice(0, 600);
      }
    } catch { /* 诊断快照尽力而为 */ }
    throw new Error((validation?.error || 'Pavo 参数设置后回读不一致') + dump);
  }

  async function apiFetch(path, options = {}) {
    const response = await fetch(`${localBridgeUrl(apiBaseUrl)}${path}`, {
      method: options.method || 'GET',
      ...(!options.method || options.method === 'GET' ? { signal: AbortSignal.timeout(8_000) } : {}),
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(apiToken ? { 'X-Nomi-Token': apiToken } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const detail = data && typeof data === 'object' ? data.error || data.message : data;
      const error = new Error(`HTTP ${response.status}${detail ? `：${detail}` : ''}`);
      error.status = response.status;
      error.queued = data?.queued === true;
      throw error;
    }
    return data;
  }

  function localBridgeUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('只允许连接本机 Pavo 网关');
    }
    return url.origin;
  }

  function closeEventSource() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    eventSource?.close();
    eventSource = null;
  }

  function disconnectBridge(message) {
    bridgeOnline = false;
    closeEventSource();
    setDot(bridgeDot, '');
    bridgeStatus.textContent = message;
    hostMode.textContent = '未连接';
  }

  function applyConnectionUpdates() {
    if (!pendingConnectionUpdate || executing) return;
    if (!connectionUpdate) connectionUpdate = drainConnectionUpdates().catch(() => {
      pendingConnectionUpdate = false;
      disconnectBridge('连接配置读取失败，请从 Nomi 重新启动网页桥');
    }).finally(() => {
      connectionUpdate = null;
      if (pendingConnectionUpdate && !executing) void applyConnectionUpdates();
    });
    return connectionUpdate;
  }

  async function drainConnectionUpdates() {
    while (pendingConnectionUpdate && !executing) {
      const revision = configurationRevision;
      const stored = await chrome.storage.local.get(['apiBaseUrl', 'apiToken']);
      if (revision !== configurationRevision) continue;
      if (executing) return;
      const nextBase = String(stored.apiBaseUrl || 'http://127.0.0.1:3458').replace(/\/$/, '');
      const nextToken = String(stored.apiToken || '');
      pendingConnectionUpdate = false;
      if (nextBase === apiBaseUrl && nextToken === apiToken && !connectionBlocked) continue;
      connectionEpoch += 1;
      disconnectBridge('正在更新本地连接…');
      // Never rebind a live panel to another gateway, including intents still in flight.
      connectionBlocked = nextBase !== apiBaseUrl;
      if (connectionBlocked) {
        disconnectBridge('网关地址已改变，任务已暂停；请恢复原地址或从 Nomi 重新启动面板');
        continue;
      }
      apiToken = nextToken;
      if (await probeBridge()) await syncSubmitFieldsFromGateway();
    }
  }

  function probeBridge() {
    if (connectionProbe?.epoch === connectionEpoch) return connectionProbe.promise;
    const epoch = connectionEpoch;
    const promise = inspectBridge(epoch).finally(() => {
      if (connectionProbe?.epoch === epoch) connectionProbe = null;
    });
    connectionProbe = { epoch, promise };
    return promise;
  }

  async function inspectBridge(epoch) {
    if (connectionBlocked || pendingConnectionUpdate) return false;
    try {
      localBridgeUrl(apiBaseUrl);
      if (!apiToken) throw new Error('缺少本地连接凭据，请从 Nomi 启动网页桥');
      const info = await apiFetch('/');
      if (epoch !== connectionEpoch) return false;
      if (info?.name !== 'Pavo Web Task Bridge' || info?.instanceId !== BRIDGE_INSTANCE_ID) {
        throw new Error('网关实例不匹配，请使用 Nomi 内置网页桥');
      }
      if (info.safetyContractVersion !== SAFETY_CONTRACT_VERSION) throw new Error('网关安全协议不兼容，请更新网页桥');
      bridgeOnline = true;
      setDot(bridgeDot, 'ok');
      bridgeStatus.textContent = '本地网关已连接（网页状态单独检查）';
      hostMode.textContent = 'Nomi';
      if (consumer) startEventSource();
      return true;
    } catch (error) {
      if (epoch !== connectionEpoch) return false;
      disconnectBridge(error.status === 401 || error.status === 403
        ? '本地连接鉴权失效，请从 Nomi 重新启动网页桥'
        : `本地连接未就绪：${safeError(error)}`);
      return false;
    }
  }

  function startEventSource() {
    if (eventSource || !bridgeOnline) return;
    const query = new URLSearchParams({ clientId });
    if (apiToken) query.set('token', apiToken);
    const epoch = connectionEpoch;
    const source = new EventSource(`${apiBaseUrl}/api/events?${query}`);
    eventSource = source;
    const pullCurrent = () => { if (source === eventSource && epoch === connectionEpoch) void pullTasks(); };
    source.addEventListener('new-tasks', pullCurrent);
    source.addEventListener('task-created', pullCurrent);
    source.addEventListener('task-released', pullCurrent);
    source.onopen = () => {
      if (source !== eventSource || epoch !== connectionEpoch) return;
      log('Agent Gateway 实时通道已连接');
      pullCurrent();
    };
    source.onerror = () => {
      if (source !== eventSource || epoch !== connectionEpoch) return;
      closeEventSource();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (epoch === connectionEpoch && bridgeOnline && consumer) void probeBridge();
      }, 5_000);
    };
  }

  function renderTasks() {
    queueSummary.textContent = `${tasks.length} 个任务 · ${PANEL_VERSION}`;
    const bindingTask = $('bindingTask');
    const selectedTask = bindingTask.value;
    bindingTask.innerHTML = '<option value="">选择已提交任务</option>' + tasks
      .filter(task => (task.submitClaimedAt || task.submittedAt) && !task.syncedFileCount && !task.harvestDone)
      .map(task => `<option value="${escapeHtml(task.taskCode)}">${escapeHtml(task.taskCode)}</option>`).join('');
    bindingTask.value = selectedTask;
    if (!tasks.length) {
      taskContainer.textContent = '暂无任务';
      return;
    }
    taskContainer.innerHTML = tasks.map(task => `
      <div class="task">
        <div class="row between"><strong>${escapeHtml(task.taskCode)}</strong><span>${escapeHtml(task.status)}</span></div>
        <div>${escapeHtml(task.modelConfig?.model || '')} · ${escapeHtml(task.modelConfig?.aspectRatio || '')} · ${escapeHtml(task.modelConfig?.duration || '')}</div>
        ${task.error ? `<div>${escapeHtml(task.error)}</div>` : ''}
      </div>
    `).join('');
  }

  async function pullTasks() {
    if (!bridgeOnline || !consumer || pendingConnectionUpdate) return;
    const epoch = connectionEpoch;
    try {
      const result = await apiFetch(`/api/tasks/pending?clientId=${encodeURIComponent(clientId)}`);
      if (epoch !== connectionEpoch || pendingConnectionUpdate) return;
      const incoming = Array.isArray(result?.tasks) ? result.tasks : [];
      const added = [];
      for (const task of incoming) {
        const existing = tasks.find(item => item.taskCode === task.taskCode);
        if (existing) {
          if (existing.status === 'acked') {
            existing.status = 'pending';
            added.push(task.taskCode);
          }
          continue;
        }
        tasks.push({ ...task, status: 'pending', error: null });
        added.push(task.taskCode);
      }
      if (added.length) {
        await apiFetch('/api/tasks/ack', { method: 'POST', body: { taskCodes: added } });
        log(`收到 ${added.length} 个 Nomi 任务`);
        await saveState();
        renderTasks();
      }
      void runQueue();
    } catch (error) {
      log(`任务拉取失败：${safeError(error)}`);
    }
  }

  async function report(task, status, error = null, failureEvidence = null) {
    let result;
    if (failureEvidence && !bridgeOnline) throw new Error('网关未连接，无法保存失败证据');
    if (bridgeOnline) {
      result = await apiFetch('/api/tasks/status', {
        method: 'POST',
        body: { taskCode: task.taskCode, status, error, updatedAt: new Date().toISOString(),
          ...(failureEvidence ? { failureEvidence, confirmedFailure: true, harvestDone: true } : {}) },
      });
      if (result?.success !== true) throw new Error(result?.error || '任务状态未被网关确认');
    }
    task.status = status;
    task.error = error;
    if (failureEvidence) Object.assign(task, { failureEvidence, confirmedFailure: true, harvestDone: true });
    await saveState();
    renderTasks();
    return result;
  }

  async function dataUrlFromResponse(response, contentType) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return `data:${contentType};base64,${btoa(binary)}`;
  }

  async function hydrateReferences(referenceFiles) {
    const hydrated = [];
    for (const reference of Array.isArray(referenceFiles) ? referenceFiles : []) {
      if (reference.base64 || reference.data) {
        hydrated.push(reference);
        continue;
      }
      if (!reference.downloadPath) throw new Error(`参考素材 ${reference.fileName || ''} 缺少下载地址`);
      const response = await fetch(`${apiBaseUrl}${reference.downloadPath}`, {
        headers: apiToken ? { 'X-Nomi-Token': apiToken } : {},
      });
      if (!response.ok) throw new Error(`参考素材下载 HTTP ${response.status}`);
      const fileType = reference.fileType || response.headers.get('content-type') || 'application/octet-stream';
      hydrated.push({
        fileName: reference.fileName || 'reference',
        fileType,
        base64: await dataUrlFromResponse(response, fileType),
      });
    }
    return hydrated;
  }

  function referenceNamesOf(references) {
    return references.map((reference, index) => reference.fileName || reference.name || `reference-${index + 1}`);
  }

  function preparedInputSignature(task) {
    return JSON.stringify({ prompt: task.prompt || '', mediaType: task.mediaType || 'video',
      modelConfig: task.modelConfig || {}, references: (task.referenceFiles || []).map((reference, index) => ({
        fileName: reference.fileName || reference.name || `reference-${index + 1}`,
        fileType: reference.fileType || reference.type || '', downloadPath: reference.downloadPath || '',
      })) });
  }

  async function verifyPreparedTask(task, referenceNames, { allowMissingSnapshot = false } = {}) {
    const verified = await send({ action: 'verifyPreparedTask', prompt: task.prompt || '', referenceNames }, 120_000);
    if (verified?.success !== true || verified.promptVerified !== true || verified.referencesVerified !== true
      || verified.uploaded !== referenceNames.length
      || JSON.stringify(verified.referenceNames) !== JSON.stringify(referenceNames)
      || (!allowMissingSnapshot && verified.preparedSnapshotVerified !== true)) {
      throw new Error(verified?.error || '当前输入的完整提示词、参考素材或内容脚本准备快照未通过最终验证，未点击生成');
    }
    return verified;
  }

  async function recoverFreshComposer() {
    const recovered = await send({ action: 'recoverComposer' }, 15_000);
    if (recovered?.success !== true || recovered.freshConsoleConfirmed !== true) {
      throw new Error(recovered?.error || '未验证全新空控制台，禁止继续提交');
    }
  }

  async function applyAndFill(task) {
    const mediaType = task.mediaType || 'video';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const ready = await waitForWorkbench(mediaType).catch(() => null);
      if (!ready) {
        log('工作台不在创作态（可能在结果视图），尝试恢复');
        await send({ action: 'recoverComposer' }, 15_000).catch(() => null);
        await waitForWorkbench(mediaType);
      }
      const { referenceMode, ...preset } = { ...(task.modelConfig || {}) };
      try {
        await applyPresetWithReadback(mediaType, preset);
      } catch (error) {
        // 页面半渲染（编辑器在但下拉控件没出来）时刷新创作台重来一次
        if (attempt < 2 && /未找到匹配控件|回读不一致|仍在加载/.test(safeError(error))) {
          log(`参数应用失败（${safeError(error).slice(0, 60)}），刷新创作台后重试`);
          await send({ action: 'recoverComposer' }, 15_000).catch(() => null);
          await waitForWorkbench(mediaType);
          continue;
        }
        throw error;
      }
      const references = await hydrateReferences(task.referenceFiles || []);
      const setup = await send({
        action: 'doGenerate',
        mediaType: task.mediaType || 'video',
        fileReferences: references,
        prompt: task.prompt || '',
      }, 120_000);
      if (!setup?.success) throw new Error(setup?.error || 'Pavo 素材或提示词填写失败');
      if (setup.uploaded !== references.length || setup.referencesVerified !== true) {
        throw new Error('Pavo 参考素材尚未完成上传验证，未点击生成');
      }
      if (referenceMode) await applyPresetWithReadback(mediaType, { referenceMode });
      const referenceNames = setup.referenceNames || referenceNamesOf(references);
      await verifyPreparedTask(task, referenceNames);
      return { ...setup, referenceNames };
    }
  }

  async function releaseTaskComposer(task) {
    if (task.composerReleasedAt) return;
    if (!task.pavoConversationId) {
      if (task.conversationSnapshotComplete !== true || !Array.isArray(task.conversationBaselineIds)) {
        throw new Error('缺少完整会话基线，无法确认当前提交身份');
      }
      const before = new Set(task.conversationBaselineIds);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (pendingConnectionUpdate || !bridgeOnline) throw new Error('连接配置正在更新，暂停释放控制台');
        const current = await send({ action: 'getCurrentConversation' }, 8_000);
        const cid = current?.conversationId;
        if (current?.success === true && typeof cid === 'string' && cid
          && current.prompt === task.prompt && !before.has(cid)
          && !tasks.some(other => other !== task && other.pavoConversationId === cid)) {
          const binding = await apiFetch('/api/tasks/result-binding', {
            method: 'POST', body: { taskCode: task.taskCode, conversationId: cid },
          });
          if (binding?.success !== true) throw new Error(binding?.error || '当前会话绑定未被确认');
          task.pavoConversationId = cid;
          task.bindingSource = 'unique_new_full_prompt';
          await saveState();
          break;
        }
        await sleep(1_000);
      }
      if (!task.pavoConversationId) throw new Error('当前新会话及完整提示词尚未确认，禁止释放或重提');
    }
    if (pendingConnectionUpdate || !bridgeOnline) throw new Error('连接配置正在更新，暂停释放控制台');
    await recoverFreshComposer();
    const released = await apiFetch('/api/tasks/composer-release', {
      method: 'POST', body: { taskCode: task.taskCode, clientId, submitClaimId: task.submitClaimId,
        conversationId: task.pavoConversationId, freshConsoleConfirmed: true },
    });
    if (released?.success !== true || !released.composerReleasedAt) throw new Error(released?.error || '控制台释放未被网关确认');
    task.composerReleasedAt = released.composerReleasedAt;
    delete task.preparedInput;
    await saveState();
    log(`${task.taskCode} 已确认会话并释放控制台，后台继续收片`);
  }

  async function executeBridgeTask(task) {
    const alreadyClaimed = hasSubmission(task);
    try {
      if (alreadyClaimed && isTerminal(task)) {
        await releaseTaskComposer(task);
        return;
      }
      if (!alreadyClaimed) {
        if (task.realSubmit !== false && releasedInflightCount() >= 2) return;
        await report(task, 'configuring');
        let reusePrepared = false;
        if (task.preparedInput) {
          if (task.preparedInput.signature !== preparedInputSignature(task)) {
            throw new Error('已准备输入不属于当前任务参数，暂停排队；禁止重复上传或套用其他输入');
          }
          const verified = await verifyPreparedTask(task, task.preparedInput.referenceNames, { allowMissingSnapshot: true });
          reusePrepared = verified.preparedSnapshotVerified === true;
        }
        if (!reusePrepared) {
          await recoverFreshComposer();
          const setup = await applyAndFill(task);
          task.preparedInput = { signature: preparedInputSignature(task), referenceNames: setup.referenceNames };
          await saveState();
        }
      }
      if (task.realSubmit === false) {
        delete task.preparedInput;
        await report(task, 'completed');
        log(`${task.taskCode} dry-run 完成，未点击生成`);
        return;
      }
      if (!alreadyClaimed) {
        const history = await send({ action: 'harvestAllConversations' }, 120_000);
        if (!history?.success || history.complete !== true || !Array.isArray(history.conversations)) {
          throw new Error('无法建立完整会话基线，未点击生成');
        }
        task.conversationBaselineIds = history.conversations.map(conv => conv.cid).filter(Boolean);
        task.conversationSnapshotComplete = true;
        const snapshot = await send({ action: 'snapshotMediaOutputs', mediaType: task.mediaType || 'video' });
        if (!snapshot?.success || !Array.isArray(snapshot.urls)) throw new Error('无法建立提交前输出快照');
        task.outputBaselineUrls = snapshot.urls;
        await verifyPreparedTask(task, task.preparedInput.referenceNames);
        const claim = await apiFetch('/api/tasks/submit-claim', {
          method: 'POST', body: {
            taskCode: task.taskCode, clientId,
            conversationBaselineIds: task.conversationBaselineIds,
            conversationSnapshotComplete: true,
            outputBaselineUrls: task.outputBaselineUrls,
          },
        });
        task.submitClaimId = claim.submitClaimId;
        task.submitClaimedAt = claim.submitClaimedAt;
        await saveState();
        await verifyPreparedTask(task, task.preparedInput.referenceNames);
        const clicked = await send({ action: 'clickGenerate', taskCode: task.taskCode, submitClaimId: task.submitClaimId });
        if (!clicked?.success) throw new Error(clicked?.error || 'Pavo 生成按钮没有响应');
        const confirmed = await apiFetch('/api/tasks/submit-confirm', {
          method: 'POST',
          body: { taskCode: task.taskCode, clientId, submitClaimId: task.submitClaimId },
        });
        task.submittedAt = confirmed.submittedAt;
      }
      try {
        if (!alreadyClaimed || !task.nextHarvestAt) task.nextHarvestAt = Date.now() + 30_000;
        await saveState();
      } catch { /* 状态保存失败不影响发送 */ }
      await report(task, 'awaiting_result');
      await releaseTaskComposer(task);
      log(`${task.taskCode} 已点击一次，正在等待原任务结果；不会重复提交本次尝试`);
    } catch (error) {
      const message = safeError(error);
      if (alreadyClaimed && isTerminal(task)) {
        gateLog(`${task.taskCode} 终态保留，控制台尚未释放：${message}`);
        return;
      }
      if (error.queued && !task.submitClaimId) {
        await report(task, 'pending', '其他任务尚未结束，正在排队；未点击生成');
        return;
      }
      if (error.status === 409 && !task.submitClaimId) {
        const remote = await apiFetch(`/api/tasks/${encodeURIComponent(task.taskCode)}`).catch(() => null);
        if (remote?.task?.submitClaimedAt) Object.assign(task, remote.task);
      }
      if (task.submitClaimId || task.submitClaimedAt || task.submittedAt) {
        await report(task, 'awaiting_result', `提交状态已锁定：${message}`);
        log(`${task.taskCode} 提交回执异常，已禁止重提`);
      } else if (task.preparedInput) {
        await report(task, 'pending', `已准备输入保留，等待校验恢复；禁止重复上传：${message}`);
      } else {
        await report(task, 'failed', message);
        log(`${task.taskCode} 提交前失败：${message}`);
      }
    }
  }

  async function harvestPendingTasks() {
    const force = harvestForce;
    harvestForce = false;
    const eligible = eligibleHarvestTasks(force)
      .filter(task => force || (task.nextHarvestAt || 0) <= Date.now());
    if (!eligible.length) return;
    for (const task of eligible) {
      task.harvestAttempts = (task.harvestAttempts || 0) + 1;
      task.nextHarvestAt = Date.now() + 60_000;
    }
    await saveState();
    let conversations;
    let complete;
    try {
      const response = await send({ action: 'harvestAllConversations' }, 120_000);
      if (!response?.success || !Array.isArray(response.conversations)) {
        throw new Error(response?.error || '会话列表未返回有效数据');
      }
      conversations = response.conversations;
      complete = response.complete === true;
    } catch (error) {
      gateLog(`收片查询失败，仅重查，不重新生成：${safeError(error)}`);
      conversations = [];
      complete = false;
    }
    const claimed = new Set(tasks.map(task => task.pavoConversationId).filter(Boolean));
    const history = new Map();
    async function withHistory(conv) {
      if (!history.has(conv.cid)) {
        history.set(conv.cid, send({ action: 'fetchConversationVideos', conversationId: conv.cid }, 30_000)
          .catch(() => null));
      }
      const detail = await history.get(conv.cid);
      if (detail?.success !== true || detail.conversationId !== conv.cid
        || typeof detail.prompt !== 'string' || !detail.prompt) return null;
      // List entries only discover ids; the latest verified turn owns all result evidence.
      return { cid: conv.cid, prompt: detail.prompt, status: detail.status || '',
        failureCategory: detail.failureCategory,
        videos: Array.isArray(detail.videos) ? detail.videos : [],
        images: Array.isArray(detail.images) ? detail.images : [] };
    }
    for (const task of eligible) {
      let hit;
      if (!task.pavoConversationId) {
        if (!complete || task.conversationSnapshotComplete !== true
          || !Array.isArray(task.conversationBaselineIds)) {
          await report(task, 'awaiting_result', '缺少完整提交前会话基线，需人工确认会话；禁止猜测或重提');
          continue;
        }
        const before = new Set(task.conversationBaselineIds);
        const candidates = [];
        let historyIncomplete = false;
        for (const conv of conversations) {
          if (conv.cid && !before.has(conv.cid) && !claimed.has(conv.cid)) {
            const verified = await withHistory(conv);
            if (verified) candidates.push(verified);
            else historyIncomplete = true;
          }
        }
        if (historyIncomplete) {
          await report(task, 'awaiting_result', '候选会话历史尚未完整确认，继续等待；禁止使用列表猜测结果');
          continue;
        }
        const matches = candidates.filter(conv => conv.prompt === task.prompt);
        if (matches.length !== 1) {
          await report(task, 'awaiting_result', matches.length > 1
            ? '存在多个同提示词会话，需人工确认会话；不会自动收错视频'
            : '原任务会话尚未唯一确认，继续等待；不会重新生成');
          continue;
        }
        hit = matches[0];
        try {
          const binding = await apiFetch('/api/tasks/result-binding', {
            method: 'POST',
            body: { taskCode: task.taskCode, conversationId: hit.cid },
          });
          if (binding?.success !== true) throw new Error(binding?.error || '会话绑定未被确认');
          task.pavoConversationId = hit.cid;
          claimed.add(hit.cid);
          await saveState();
        } catch (error) {
          await report(task, 'awaiting_result', `会话绑定未保存，暂停收片：${safeError(error)}`);
          continue;
        }
      }
      hit = await withHistory({ cid: task.pavoConversationId });
      if (!hit) {
        await report(task, 'awaiting_result', '绑定会话历史尚未确认，继续查询；不会收片或判定失败');
        continue;
      }
      if (hit.prompt !== task.prompt) {
        await report(task, 'awaiting_result', '绑定会话的完整提示词发生变化，已暂停收片');
        continue;
      }
      if (/^(failed|error)$/i.test(hit.status || '')) {
        const failureEvidence = { conversationId: task.pavoConversationId, status: hit.status.toLowerCase(),
          category: FAILURE_CATEGORIES.has(hit.failureCategory) ? hit.failureCategory : 'unknown' };
        try {
          const result = await report(task, 'failed', '原会话已确认失败；仅由网关决定是否创建重试子任务', failureEvidence);
          if (result?.retryTaskCode) {
            task.retryTaskCode = result.retryTaskCode;
            await saveState();
            await pullTasks();
          }
        } catch (error) {
          gateLog(`${task.taskCode} 失败证据尚未保存，仅重查：${safeError(error)}`);
        }
        continue;
      }
      // Outputs can appear before the provider has finalized the generation.
      // 结果桶按任务媒体面选：image 任务读 images（png/jpg/webp），video 任务读 videos（mp4）。
      const resultUrls = task.mediaType === 'image' ? hit.images : hit.videos;
      if (!/^(completed|success|succeeded)$/i.test(hit.status || '') || !resultUrls?.length) continue;
      try {
        await report(task, 'uploading');
        let uploaded = 0;
        for (let index = 0; index < resultUrls.length; index += 1) {
          const response = await send({
            action: 'captureAndUploadMedia',
            taskCode: task.taskCode, mediaType: task.mediaType || 'video',
            serverUrl: apiBaseUrl, apiToken,
            quality: `original-${index + 1}`, mediaUrl: resultUrls[index],
          }, 120_000);
          if (!response?.success || Number(response.uploaded || 0) < 1) {
            throw new Error(response?.error || `第 ${index + 1} 个结果未保存`);
          }
          uploaded += Number(response.uploaded);
        }
        // The gateway independently verifies persisted files before accepting completion.
        await report(task, 'completed');
        task.syncedFileCount = uploaded;
        task.harvestDone = true;
        await saveState();
        log(`${task.taskCode} 已回传 ${uploaded} 个结果（会话 ${hit.cid}）`);
      } catch (error) {
        await report(task, 'awaiting_result', `原任务收片失败，仅重试下载：${safeError(error)}`);
      }
    }
  }

  function hasSubmission(task) {
    return Boolean(task.submitClaimId || task.submitClaimedAt || task.submittedAt);
  }

  function isTerminal(task) {
    return Boolean(task.harvestDone || task.confirmedFailure || task.status === 'failed' || task.status === 'completed');
  }

  function releasedInflightCount() {
    return tasks.filter(task => hasSubmission(task) && task.composerReleasedAt && !isTerminal(task)).length;
  }

  function ownsComposer(task) {
    return !task.composerReleasedAt && (hasSubmission(task)
      || (!isTerminal(task) && (task.preparedInput || ACTIVE_STATUSES.has(task.status))));
  }

  async function runQueue() {
    if (!consumer || executing || !bridgeOnline || pendingConnectionUpdate) return;
    executing = true;
    try {
      const active = tasks.find(task => hasSubmission(task) && ownsComposer(task));
      if (active) {
        // Legacy claims without their original claim id remain query-only.
        if (active.submitClaimId || (!active.submitClaimedAt && !active.submittedAt)) await executeBridgeTask(active);
        if (ownsComposer(active)) {
          gateLog(`${active.taskCode} 控制台尚未确认释放，后续任务排队；不会重新提交`);
        }
      }
      await harvestPendingTasks();
      if (pendingConnectionUpdate) return;
      if (tasks.some(task => hasSubmission(task) && ownsComposer(task))) return;
      if (releasedInflightCount() >= 2) {
        await syncSubmitFieldsFromGateway();
        if (releasedInflightCount() >= 2) {
          gateLog('已有两条已释放任务等待结果，暂不配置或上传下一任务');
          return;
        }
        if (tasks.some(task => hasSubmission(task) && ownsComposer(task))) return;
      }
      const candidates = tasks.filter(task => !hasSubmission(task)
        && ['pending', 'acked', 'configuring'].includes(task.status));
      const prepared = candidates.find(task => task.preparedInput);
      const due = task => !task.retryAfter || Date.parse(task.retryAfter) <= Date.now();
      const pending = prepared ? (due(prepared) ? prepared : null) : candidates.find(due);
      if (pending) await executeBridgeTask(pending);
    } catch (error) {
      gateLog(`任务编排暂停，仅恢复原任务：${safeError(error)}`);
    } finally {
      executing = false;
      await applyConnectionUpdates();
    }
  }

  async function filesAsReferences(fileList) {
    return Promise.all(Array.from(fileList || []).map(file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
      reader.onload = () => resolve({ fileName: file.name, fileType: file.type, base64: reader.result });
      reader.readAsDataURL(file);
    })));
  }

  async function prepareManual() {
    if (!consumer || executing || tasks.some(ownsComposer)) {
      throw new Error('工作台正在处理其他任务或由其他面板占用，请等待');
    }
    executing = true;
    try {
      const prompt = $('prompt').value.trim();
      if (!prompt) throw new Error('请先填写提示词');
      const { referenceMode, ...preset } = manualPreset();
      await recoverFreshComposer();
      await waitForWorkbench('video');
      await applyPresetWithReadback('video', preset);
      const references = await filesAsReferences($('references').files);
      const setup = await send({ action: 'doGenerate', mediaType: 'video', fileReferences: references, prompt }, 120_000);
      if (!setup?.success) throw new Error(setup?.error || 'Pavo 页面填写失败');
      if (setup.uploaded !== references.length || setup.referencesVerified !== true) {
        throw new Error('Pavo 参考素材尚未完成上传验证');
      }
      if (referenceMode) await applyPresetWithReadback('video', { referenceMode });
      await verifyPreparedTask({ prompt }, setup.referenceNames || referenceNamesOf(references));
      await saveState();
      manualStatus.textContent = `已填写：${references.length} 个参考素材；尚未点击生成。`;
    } finally {
      executing = false;
      await applyConnectionUpdates();
    }
  }

  async function submitManual() {
    if (!bridgeOnline || !consumer || executing || pendingConnectionUpdate) throw new Error('请先连接本地 Gateway 并等待当前操作完成；付费提交必须记录到持久任务队列');
    const epoch = connectionEpoch;
    const revision = configurationRevision;
    executing = true;
    try {
      const prompt = $('prompt').value.trim();
      if (!prompt) throw new Error('请先填写提示词');
      const referenceFiles = await filesAsReferences($('references').files);
      if (epoch !== connectionEpoch || revision !== configurationRevision || pendingConnectionUpdate || !bridgeOnline) {
        throw new Error('连接配置已更改，本次提交已取消；请检查连接后重新确认');
      }
      const result = await apiFetch('/api/tasks/push', {
        method: 'POST',
        body: {
          idempotencyKey: `manual-${crypto.randomUUID()}`, mediaType: 'video',
          prompt, referenceFiles, modelConfig: manualPreset(), realSubmit: true,
        },
      });
      manualStatus.textContent = `已加入原网关队列：${result.taskCodes[0]}。每个任务只点击一次。`;
      await pullTasks();
    } finally {
      executing = false;
      await applyConnectionUpdates();
    }
    void runQueue();
  }

  async function bindManualResult() {
    const taskCode = $('bindingTask').value;
    const conversationId = $('bindingConversation').value.trim();
    if (!consumer || executing || !bridgeOnline) throw new Error('请等待当前操作完成并连接 Gateway');
    if (!taskCode || !conversationId) throw new Error('请选择任务并填写核对后的会话 ID');
    await apiFetch('/api/tasks/result-binding', {
      method: 'POST', body: { taskCode, conversationId, confirmed: true },
    });
    await syncSubmitFieldsFromGateway();
    harvestForce = true;
    await runQueue();
  }

  async function electConsumer() {
    const activate = async () => {
      consumer = true;
      await probeBridge();
      if (bridgeOnline) {
        startEventSource();
        await pullTasks();
      }
      await new Promise(() => {});
    };
    if (navigator.locks?.request) {
      navigator.locks.request(TASK_LOCK, {}, activate).catch(error => {
        consumer = false;
        closeEventSource();
        log(`消费者锁失败：${safeError(error)}`);
      });
    } else {
      log('缺少跨面板互斥锁，已禁用自动执行');
    }
  }

  $('close').addEventListener('click', () => window.parent.postMessage({ type: 'PAVO_DRAWER_CLOSE' }, '*'));
  $('refresh').addEventListener('click', () => { void refreshPageStatus(); void probeBridge(); });
  $('pull').addEventListener('click', () => void pullTasks());
  $('harvestNow').addEventListener('click', () => {
    harvestForce = true;
    log('手动收片已请求，立即扫描');
    void runQueue();
  });
  $('clearLog').addEventListener('click', () => { logElement.textContent = ''; });
  $('prepare').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await prepareManual(); } catch (error) { manualStatus.textContent = safeError(error); }
    finally { event.currentTarget.disabled = false; }
  });
  $('submit').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await submitManual(); } catch (error) { manualStatus.textContent = safeError(error); }
    finally { event.currentTarget.disabled = false; }
  });

  $('bindResult').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await bindManualResult(); } catch (error) { log(safeError(error)); }
    finally { event.currentTarget.disabled = false; }
  });

  window.addEventListener('beforeunload', closeEventSource);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes.apiBaseUrl && !changes.apiToken)) return;
    configurationRevision += 1;
    pendingConnectionUpdate = true;
    void applyConnectionUpdates();
  });

  void (async () => {
    await loadState();
    await probeBridge();
    await syncSubmitFieldsFromGateway();
    void electConsumer();
    // Gateway readiness must not wait for a slow/loading website tab.
    void refreshPageStatus();
    void (async () => {
      try {
        const pong = await send({ action: 'ping' }, 5_000);
        if (!pong?.success) throw new Error('无应答');
      } catch {
        log('⚠ Pavo 页面内容脚本未应答：请在 Pavo 标签页按 F5 刷新一次（扩展重载不会给旧标签页注入新脚本）');
      }
    })();
    void (async () => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          if (await refreshPageStatus()) return;
        } catch { /* 页面尚未就绪，继续重试 */ }
        await sleep(2_000);
      }
    })();
    setInterval(() => {
      void refreshPageStatus();
      if (polling) return;
      polling = true;
      void (async () => {
        try { await pullTasks(); await runQueue(); }
        finally { polling = false; }
      })();
    }, 8_000);
    setInterval(() => void probeBridge(), 20_000);
  })();
})();
