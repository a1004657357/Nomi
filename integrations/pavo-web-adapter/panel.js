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
  const ACTIVE_STATUSES = new Set(['configuring', 'submitting', 'generating', 'awaiting_result', 'uploading']);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  let apiBaseUrl = 'http://127.0.0.1:3458';
  let apiToken = '';
  let clientId = '';
  let tasks = [];
  let bridgeOnline = false;
  let consumer = false;
  let executing = false;
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
      && (force || (task.harvestAttempts || 0) < 288));
  }

  async function syncSubmitFieldsFromGateway() {
    try {
      const result = await apiFetch('/api/tasks');
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
        if (!local.syncedFileCount && (local.status === 'completed'
          || (local.status === 'failed' && !local.harvestDone))) local.status = 'awaiting_result';
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

  async function send(message, timeoutMs = 30_000) {
    const tab = await findPavoTab(true);
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

  async function refreshPageStatus() {
    try {
      const response = await send({ action: 'getPageInfo' }, 8_000);
      const ready = response?.success && media.pageInfoReadyForMediaType('video', response.info);
      setDot(pageDot, ready ? 'ok' : 'busy');
      pageStatus.textContent = ready ? 'Pavo 视频工作台已就绪' : 'Pavo 页面已打开，工作台未就绪';
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
        lastError = new Error('Pavo 页面已打开，但视频工作台仍在加载');
      } catch (error) {
        lastError = error;
      }
      await sleep(1_000);
    }
    throw lastError || new Error('Pavo 视频工作台等待超时');
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
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method || 'GET',
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

  async function probeBridge() {
    try {
      if (!apiToken) {
        const candidates = [...new Set([apiBaseUrl, 'http://127.0.0.1:3460'])];
        for (const candidate of candidates) {
          try {
            const bootstrapUrl = new URL('/api/bootstrap', candidate);
            bootstrapUrl.searchParams.set('extensionId', chrome.runtime.id);
            const paired = await fetch(bootstrapUrl, { cache: 'no-store' });
            if (!paired.ok) continue;
            const pairing = await paired.json();
            const pairedToken = String(pairing.token || '');
            if (!pairedToken) continue;
            apiBaseUrl = candidate;
            apiToken = pairedToken;
            await chrome.storage.local.set({ apiBaseUrl, apiToken });
            break;
          } catch {
            // Try the next local gateway candidate.
          }
        }
      }
      const info = await apiFetch('/');
      bridgeOnline = info?.name === 'Pavo Web Task Bridge' && info?.instanceId;
      setDot(bridgeDot, bridgeOnline ? 'ok' : '');
      bridgeStatus.textContent = bridgeOnline ? 'Agent Gateway 已连接' : '独立模式';
      hostMode.textContent = bridgeOnline ? 'Agent' : '独立 Chrome';
      if (bridgeOnline && consumer) startEventSource();
      return bridgeOnline;
    } catch {
      bridgeOnline = false;
      setDot(bridgeDot, '');
      bridgeStatus.textContent = '独立模式';
      hostMode.textContent = '独立 Chrome';
      return false;
    }
  }

  function startEventSource() {
    if (eventSource || !bridgeOnline) return;
    const query = new URLSearchParams({ clientId });
    if (apiToken) query.set('token', apiToken);
    eventSource = new EventSource(`${apiBaseUrl}/api/events?${query}`);
    eventSource.addEventListener('new-tasks', () => void pullTasks());
    eventSource.addEventListener('task-created', () => void pullTasks());
    eventSource.addEventListener('task-released', () => void pullTasks());
    eventSource.onopen = () => log('Agent Gateway 实时通道已连接');
    eventSource.onerror = () => {
      eventSource?.close();
      eventSource = null;
      setTimeout(() => { if (bridgeOnline && consumer) startEventSource(); }, 5_000);
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
    if (!bridgeOnline || !consumer) return;
    try {
      const result = await apiFetch(`/api/tasks/pending?clientId=${encodeURIComponent(clientId)}`);
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

  async function report(task, status, error = null) {
    task.status = status;
    task.error = error;
    await saveState();
    renderTasks();
    if (bridgeOnline) {
      await apiFetch('/api/tasks/status', {
        method: 'POST',
        body: { taskCode: task.taskCode, status, error, updatedAt: new Date().toISOString() },
      });
    }
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

  async function applyAndFill(task) {
    const mediaType = task.mediaType || 'video';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let ready = await waitForWorkbench(mediaType).catch(() => null);
      if (!ready) {
        log('工作台不在创作态（可能在结果视图），尝试恢复');
        await send({ action: 'recoverComposer' }, 15_000).catch(() => null);
        ready = await waitForWorkbench(mediaType);
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
      if (referenceMode) await applyPresetWithReadback(mediaType, { referenceMode });
      return setup;
    }
  }

  async function executeBridgeTask(task) {
    const alreadyClaimed = Boolean(task.submitClaimId || task.submitClaimedAt || task.submittedAt);
    try {
      if (!alreadyClaimed) {
        await report(task, 'configuring');
        await applyAndFill(task);
      }
      if (task.realSubmit === false) {
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
        const clicked = await send({ action: 'clickGenerate', taskCode: task.taskCode, submitClaimId: task.submitClaimId });
        if (!clicked?.success) throw new Error(clicked?.error || 'Pavo 生成按钮没有响应');
        const confirmed = await apiFetch('/api/tasks/submit-confirm', {
          method: 'POST',
          body: { taskCode: task.taskCode, clientId, submitClaimId: task.submitClaimId },
        });
        task.submittedAt = confirmed.submittedAt;
      }
      try {
        task.nextHarvestAt = Date.now() + 30_000;
        await saveState();
      } catch { /* 状态保存失败不影响发送 */ }
      await report(task, 'awaiting_result');
      log(`${task.taskCode} 已点击一次，正在等待原任务结果；不会自动重提`);
    } catch (error) {
      const message = safeError(error);
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
      return;
    }
    const claimed = new Set(tasks.map(task => task.pavoConversationId).filter(Boolean));
    for (const task of eligible) {
      let hit = task.pavoConversationId
        ? conversations.find(conv => conv.cid === task.pavoConversationId)
        : null;
      if (!task.pavoConversationId) {
        if (!complete || task.conversationSnapshotComplete !== true
          || !Array.isArray(task.conversationBaselineIds)) {
          await report(task, 'awaiting_result', '缺少完整提交前会话基线，需人工确认会话；禁止猜测或重提');
          continue;
        }
        const before = new Set(task.conversationBaselineIds);
        const matches = conversations.filter(conv => conv.cid && !before.has(conv.cid)
          && !claimed.has(conv.cid) && conv.prompt === task.prompt);
        if (matches.length !== 1) {
          await report(task, 'awaiting_result', matches.length > 1
            ? '存在多个同提示词会话，需人工确认会话；不会自动收错视频'
            : '原任务会话尚未唯一确认，继续等待；不会重新生成');
          continue;
        }
        hit = matches[0];
        try {
          await apiFetch('/api/tasks/result-binding', {
            method: 'POST',
            body: { taskCode: task.taskCode, conversationId: hit.cid },
          });
          task.pavoConversationId = hit.cid;
          claimed.add(hit.cid);
          await saveState();
        } catch (error) {
          await report(task, 'awaiting_result', `会话绑定未保存，暂停收片：${safeError(error)}`);
          continue;
        }
      }
      if (!hit) continue;
      if (task.bindingSource !== 'user_confirmed' && hit.prompt && hit.prompt !== task.prompt) {
        await report(task, 'awaiting_result', '绑定会话的完整提示词发生变化，已暂停收片');
        continue;
      }
      if (/^(failed|failure|error)$/i.test(hit.status || '')) {
        task.harvestDone = true;
        await report(task, 'failed', '原会话生成失败；未自动重发，如需再生成请另行确认');
        continue;
      }
      // Outputs can appear before the provider has finalized the generation.
      if (!/^(completed|success|succeeded)$/i.test(hit.status || '') || !hit.videos?.length) continue;
      try {
        await report(task, 'uploading');
        let uploaded = 0;
        for (let index = 0; index < hit.videos.length; index += 1) {
          const response = await send({
            action: 'captureAndUploadMedia',
            taskCode: task.taskCode, mediaType: task.mediaType || 'video',
            serverUrl: apiBaseUrl, apiToken,
            quality: `original-${index + 1}`, mediaUrl: hit.videos[index],
          }, 120_000);
          if (!response?.success || Number(response.uploaded || 0) < 1) {
            throw new Error(response?.error || `第 ${index + 1} 个成片未保存`);
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

  async function runQueue() {
    if (!consumer || executing) return;
    executing = true;
    try {
      await harvestPendingTasks();
      const active = tasks.find(task => ACTIVE_STATUSES.has(task.status)
        || ((task.submitClaimedAt || task.submittedAt) && !task.syncedFileCount && !task.harvestDone));
      if (active) {
        if (active.status === 'configuring' && !active.submitClaimedAt && !active.submitClaimId && !active.submittedAt) {
          await executeBridgeTask(active);
          return;
        }
        gateLog(`${active.taskCode} 正在等待或收取原任务结果，后续任务排队；不会强制失败或重提`);
        return;
      }
      const pending = tasks.find(task => task.status === 'pending' || task.status === 'acked');
      if (pending) await executeBridgeTask(pending);
    } finally {
      executing = false;
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
    if (!consumer || executing || tasks.some(task => ACTIVE_STATUSES.has(task.status))) {
      throw new Error('工作台正在处理其他任务或由其他面板占用，请等待');
    }
    executing = true;
    try {
      const prompt = $('prompt').value.trim();
      if (!prompt) throw new Error('请先填写提示词');
      const { referenceMode, ...preset } = manualPreset();
      await waitForWorkbench('video');
      await applyPresetWithReadback('video', preset);
      const references = await filesAsReferences($('references').files);
      const setup = await send({ action: 'doGenerate', mediaType: 'video', fileReferences: references, prompt }, 120_000);
      if (!setup?.success) throw new Error(setup?.error || 'Pavo 页面填写失败');
      if (referenceMode) await applyPresetWithReadback('video', { referenceMode });
      await saveState();
      manualStatus.textContent = `已填写：${references.length} 个参考素材；尚未点击生成。`;
    } finally {
      executing = false;
    }
  }

  async function submitManual() {
    if (!bridgeOnline || !consumer) throw new Error('请先连接本地 Gateway；付费提交必须记录到持久任务队列');
    const prompt = $('prompt').value.trim();
    if (!prompt) throw new Error('请先填写提示词');
    const referenceFiles = await filesAsReferences($('references').files);
    const result = await apiFetch('/api/tasks/push', {
      method: 'POST',
      body: {
        idempotencyKey: `manual-${crypto.randomUUID()}`, mediaType: 'video',
        prompt, referenceFiles, modelConfig: manualPreset(), realSubmit: true,
      },
    });
    manualStatus.textContent = `已加入队列：${result.taskCodes[0]}。每个任务只点击一次。`;
    await pullTasks();
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
        eventSource?.close();
        eventSource = null;
        log(`消费者锁失败：${safeError(error)}`);
      });
    } else {
      log('缺少跨面板互斥锁，已禁用自动执行');
    }
  }

  $('close').addEventListener('click', () => window.parent.postMessage({ type: 'PAVO_DRAWER_CLOSE' }, '*'));
  $('refresh').addEventListener('click', async () => { await refreshPageStatus(); await probeBridge(); });
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

  window.addEventListener('beforeunload', () => eventSource?.close());

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
    setInterval(() => void (async () => {
      await refreshPageStatus();
      await pullTasks();
      await runQueue();
    })(), 8_000);
    setInterval(() => void probeBridge(), 20_000);
  })();
})();
