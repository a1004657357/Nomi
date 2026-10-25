// mock-server.js - 模拟任务 API 服务器 v3.2 (pipeline status broadcast)
// 用于测试扩展的任务获取和执行流程
// 启动: node mock-server.js
// 管理页: http://localhost:3456/admin  (模拟推送任务)
//
// 接口:
//   GET  /api/tasks/pending?clientId=xxx  - 获取并占用待处理任务
//   POST /api/tasks/ack                   - 确认接收任务
//   POST /api/tasks/status                - 更新任务状态
//   GET  /api/tasks/release?taskCode=xxx  - 释放占用的任务
//   GET  /api/events?clientId=xxx         - SSE 长连接（服务器推送新任务通知）
//   POST /api/tasks/push                  - 推送新任务 (支持图片+提示词+realSubmit)
//   GET  /api/config                      - 获取配置信息
//   GET  /admin                           - 任务管理页面

const http = require('http');
const nodeCrypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { taskMediaType } = require('./pavo-media');
const { externalizeTaskReferenceFiles, readTaskReference } = require('./reference-store');
const { createAuthToken, isAllowedOrigin, isAuthorizedRequest } = require('./server-auth');

const PORT = Number(process.env.NOMI_PAVO_WEB_PORT || 3458);
const HOST = '127.0.0.1';
const AUTH_TOKEN = createAuthToken(process.env.NOMI_PAVO_WEB_TOKEN);
const PARENT_PID = Number(process.env.NOMI_PAVO_WEB_PARENT_PID || 0);
const INSTANCE_ID = process.env.NOMI_PAVO_WEB_INSTANCE_ID || 'pavo-web-standalone-v1';
const ALLOW_EXTENSION_PAIRING = process.env.NOMI_PAVO_WEB_ALLOW_EXTENSION_PAIRING === '1';
const MAX_BODY_SIZE = 200 * 1024 * 1024; // 200MB (支持视频上传)
const DATA_DIR = process.env.NOMI_PAVO_WEB_DATA_DIR
  ? path.resolve(process.env.NOMI_PAVO_WEB_DATA_DIR)
  : path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.NOMI_PAVO_WEB_UPLOADS_DIR
  ? path.resolve(process.env.NOMI_PAVO_WEB_UPLOADS_DIR)
  : path.join(__dirname, 'uploads');
const TASKS_JSON = path.join(DATA_DIR, 'tasks.json');
const FILES_JSON = path.join(DATA_DIR, 'files.json');
const TASK_REFERENCES_DIR = path.join(DATA_DIR, 'task-references');
const PAIRED_EXTENSION_FILE = path.join(DATA_DIR, 'paired-extension-origin.txt');

// 确保目录存在
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TASK_REFERENCES_DIR)) fs.mkdirSync(TASK_REFERENCES_DIR, { recursive: true });

// 文件存储: fileId → { fileId, taskCode, quality, filename, mimeType, size, uploadedAt, originalUrl, filePath }
const fileStore = new Map();
let fileIdCounter = 0;

// ============================================================
// 生成测试用 512x512 PNG 图片 (使用 zlib, 无需 canvas)
// ============================================================


// ============================================================
// 持久化任务存储
// ============================================================
let taskIdCounter = 0;
const SESSION_ID = Date.now().toString(36).slice(-4); // 每次启动唯一后缀

// 任务池: taskCode → task object (持久)
const taskStore = new Map();
const REMOTE_MEDIA_HOST_SUFFIXES = [
  '.pavo-ai.cn',
  '.agnes-ai.com',
  '.myqcloud.com',
  '.aliyuncs.com',
];
const REMOTE_MEDIA_MAX_BYTES = 120 * 1024 * 1024;

function remoteMediaUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('远程媒体地址必须是无凭据 HTTPS');
  }
  const host = url.hostname.toLowerCase();
  if (!REMOTE_MEDIA_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error(`远程媒体域名不在 Pavo 结果白名单：${host}`);
  }
  return url;
}

function mediaExtension(contentType, mediaType) {
  const mime = String(contentType || '').toLowerCase();
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('webm')) return 'webm';
  return mediaType === 'image' ? 'png' : 'mp4';
}

function storeResultFile({ taskCode, quality, mimeType, originalUrl, filename, bytes }) {
  const existingFile = Array.from(fileStore.values()).find((file) => (
    file.taskCode === taskCode
    && file.quality === quality
    && fs.existsSync(file.filePath)
  ));
  if (existingFile) {
    saveFileStore();
    return {
      success: true,
      fileId: existingFile.fileId,
      filename: existingFile.filename,
      size: existingFile.size,
      quality,
      taskCode,
      deduplicated: true,
    };
  }

  fileIdCounter++;
  const fileId = `F${String(fileIdCounter).padStart(4, '0')}`;
  const ext = (filename || '').split('.').pop() || mediaExtension(mimeType, 'video');
  const safeFilename = `${taskCode}_${quality}_${fileId}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, safeFilename);
  fs.writeFileSync(filePath, bytes);

  const taskInfo = taskStore.get(taskCode);
  const meta = {
    fileId,
    taskCode,
    quality,
    filename: safeFilename,
    originalFilename: filename || safeFilename,
    mimeType,
    size: bytes.length,
    uploadedAt: new Date().toISOString(),
    originalUrl,
    filePath,
    taskDescription: taskInfo?.description || '',
    taskPrompt: taskInfo?.prompt || '',
    taskTags: taskInfo?.tags || [],
    taskModelConfig: taskInfo?.modelConfig || null,
    taskMediaType: taskMediaType(taskInfo),
    taskRealSubmit: taskInfo?.realSubmit || false,
    taskCreatedAt: taskInfo?.createdAt || '',
  };
  fileStore.set(fileId, meta);
  saveFileStore();
  console.log(`  📁 文件上传: ${safeFilename} (${quality}, ${Math.round(meta.size / 1024)}KB) ← ${taskCode}`);
  return {
    success: true,
    fileId,
    filename: safeFilename,
    size: meta.size,
    quality,
    taskCode,
  };
}

// --- 持久化: 从磁盘加载/保存 ---
function saveTaskStore() {
  const temporary = `${TASKS_JSON}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(Array.from(taskStore.values()), null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, TASKS_JSON);
}
function saveFileStore() {
  const temporary = `${FILES_JSON}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(Array.from(fileStore.values()), null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, FILES_JSON);
}
function loadPersistedData() {
  // 加载任务
  if (fs.existsSync(TASKS_JSON)) {
    try {
      const arr = JSON.parse(fs.readFileSync(TASKS_JSON, 'utf-8'));
      let migratedReferences = false;
      for (const rawTask of arr) {
        const migrated = externalizeTaskReferenceFiles(rawTask, TASK_REFERENCES_DIR);
        taskStore.set(migrated.task.taskCode, migrated.task);
        migratedReferences = migratedReferences || migrated.changed;
      }
      // 恢复 taskIdCounter
      const maxId = arr.reduce((max, t) => {
        const m = t.taskCode?.match(/(\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      if (maxId > taskIdCounter) taskIdCounter = maxId;
      console.log(`  📂 从磁盘恢复 ${arr.length} 个任务`);
      if (migratedReferences) {
        saveTaskStore();
        console.log('  📦 已把旧任务参考图迁移为按需文件引用');
      }
    } catch (e) { throw new Error(`任务日志读取失败，停止服务以避免重复提交：${e.message}`, { cause: e }); }
  }
  // 加载文件元数据
  if (fs.existsSync(FILES_JSON)) {
    try {
      const arr = JSON.parse(fs.readFileSync(FILES_JSON, 'utf-8'));
      for (const meta of arr) {
        // 只加载文件仍然存在的记录
        if (fs.existsSync(meta.filePath)) {
          fileStore.set(meta.fileId, meta);
        }
      }
      // 恢复 fileIdCounter
      const maxFid = arr.reduce((max, f) => {
        const m = f.fileId?.match(/(\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      if (maxFid > fileIdCounter) fileIdCounter = maxFid;
      console.log(`  📂 从磁盘恢复 ${fileStore.size} 个文件记录`);
    } catch (e) { throw new Error(`结果日志读取失败，停止服务以避免丢失结果：${e.message}`, { cause: e }); }
  }
}

// 占用状态: taskCode → { clientId, occupiedAt }
const occupiedTasks = new Map();
const OCCUPY_TTL_MS = 24 * 60 * 60 * 1000; // 1天自动释放

// SSE 连接管理
const sseClients = new Map(); // clientId → res

function generateTaskCode() {
  taskIdCounter++;
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(taskIdCounter).padStart(3, '0');
  return `SD-${dateStr}-${SESSION_ID}-${seq}`;
}

function normalizedIdempotencyKey(value) {
  const key = String(value || '').trim();
  return key.slice(0, 200);
}

function taskForIdempotencyKey(value) {
  const key = normalizedIdempotencyKey(value);
  if (!key) return null;
  return Array.from(taskStore.values()).find((task) => task.idempotencyKey === key) || null;
}

const RETRY_COOLDOWN_MS = 30_000;
const FAILURE_CATEGORIES = new Set(['generation', 'auth', 'quota', 'moderation', 'cancelled', 'unknown']);

function normalizedOwner(value) {
  if (value == null) return null;
  if (typeof value.projectId !== 'string' || !value.projectId.trim()
    || typeof value.nodeId !== 'string' || !value.nodeId.trim()) {
    throw new Error('owner must contain nonempty projectId and nodeId');
  }
  return { projectId: value.projectId.trim(), nodeId: value.nodeId.trim() };
}

function isFlashVideo(task) {
  const model = task.modelConfig ? task.modelConfig.model : 'Agnes Video 2.5 Flash';
  return taskMediaType(task) === 'video'
    && String(model || '').replace(/\s+/g, '').toLowerCase() === 'agnesvideo2.5flash';
}

function normalizedRetryPolicy(task, owner) {
  const maxAttempts = task.retryPolicy == null ? 1 : task.retryPolicy.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error('retryPolicy.maxAttempts must be an integer from 1 to 3');
  }
  if (maxAttempts > 1 && (!owner || !isFlashVideo(task) || !normalizedIdempotencyKey(task.idempotencyKey))) {
    throw new Error('Automatic retry requires an explicit owner and the exact Flash video model');
  }
  return { maxAttempts };
}

function attemptFinished(task) {
  return task.harvestDone === true || task.status === 'completed' || task.status === 'failed';
}

function retryDue(task) {
  return !task.retryAfter || Date.now() >= Date.parse(task.retryAfter);
}

function latestAttempt(task) {
  if (task.rootTaskCode && task.rootTaskCode !== task.taskCode) return task;
  return Array.from(taskStore.values()).filter(other => other.rootTaskCode === task.taskCode)
    .reduce((latest, other) => (other.attemptNumber || 1) > (latest.attemptNumber || 1) ? other : latest, task);
}

function projectedTask(task) {
  const latest = latestAttempt(task);
  return { ...latest, taskCode: task.taskCode, attemptTaskCode: latest.taskCode, idempotencyKey: task.idempotencyKey };
}

function attemptIdentity(task) {
  return {
    owner: task.owner || null,
    rootTaskCode: task.rootTaskCode || task.taskCode,
    parentTaskCode: task.parentTaskCode || null,
    attemptNumber: task.attemptNumber || 1,
    retryPolicy: task.retryPolicy || { maxAttempts: 1 },
    retryAfter: task.retryAfter || null,
  };
}

function validatedFailure(task, evidence) {
  if (!task.submitClaimedAt || !task.pavoConversationId || !evidence
    || evidence.conversationId !== task.pavoConversationId
    || !['failed', 'error'].includes(evidence.status)
    || !FAILURE_CATEGORIES.has(evidence.category)) return null;
  return { conversationId: evidence.conversationId, status: evidence.status, category: evidence.category };
}

function childFor(task) {
  return Array.from(taskStore.values()).find(other => other.parentTaskCode === task.taskCode) || null;
}

function createRetry(task) {
  const existing = childFor(task);
  if (existing) return existing;
  const attemptNumber = (task.attemptNumber || 1) + 1;
  if (task.failureEvidence?.category !== 'generation' || !task.owner || !isFlashVideo(task)
    || attemptNumber > (task.retryPolicy?.maxAttempts || 1)) return null;
  // Persist the failed parent and its new child together; never reopen a historical claim.
  const rootTaskCode = task.rootTaskCode || task.taskCode;
  const rootTask = taskStore.get(rootTaskCode);
  const keyHash = nodeCrypto.createHash('sha256').update(rootTask.idempotencyKey).digest('hex');
  return addTask({
    idempotencyKey: `pavo-attempt:${keyHash}:${attemptNumber}`,
    mediaType: task.mediaType, expectedResultCount: task.expectedResultCount,
    priority: task.priority, tags: task.tags, description: task.description,
    modelConfig: task.modelConfig, prompt: task.prompt, realSubmit: task.realSubmit,
    owner: task.owner, retryPolicy: task.retryPolicy, referenceFiles: task.referenceFiles,
  }, { rootTaskCode, parentTaskCode: task.taskCode, attemptNumber, retryAfter: new Date(Date.now() + RETRY_COOLDOWN_MS).toISOString() });
}

/**
 * 检查任务是否被占用（未过期）
 * @param {string} taskCode
 * @param {string} excludeClientId - 该 clientId 自身占用的不算
 */
function isOccupied(taskCode, excludeClientId) {
  const occ = occupiedTasks.get(taskCode);
  if (!occ) return false;
  if (Date.now() - new Date(occ.occupiedAt).getTime() > OCCUPY_TTL_MS) {
    occupiedTasks.delete(taskCode);
    console.log(`  ⏰ 任务 ${taskCode} 占用已过期，自动释放`);
    return false;
  }
  if (excludeClientId && occ.clientId === excludeClientId) return false;
  return true;
}

/**
 * 占用指定任务到指定 clientId
 */
function occupyTask(taskCode, clientId) {
  occupiedTasks.set(taskCode, {
    clientId,
    occupiedAt: new Date().toISOString(),
  });
}

/**
 * 广播 SSE 事件给所有连接的客户端
 */
function broadcastSSE(event, data, excludeClientId) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [cid, res] of sseClients) {
    if (cid === excludeClientId) continue;
    try { res.write(payload); } catch { /* ignore */ }
  }
}

/**
 * 添加任务到任务池
 */
function addTask(taskData, lineage = null) {
  const taskCode = generateTaskCode();
  const mediaType = taskMediaType(taskData);
  const expectedResultCount = mediaType === 'image'
    ? Math.max(1, Math.min(4, Number(taskData.expectedResultCount) || 1))
    : 1;
  const task = {
    taskCode,
    owner: normalizedOwner(taskData.owner),
    rootTaskCode: lineage?.rootTaskCode || taskCode,
    parentTaskCode: lineage?.parentTaskCode || null,
    attemptNumber: lineage?.attemptNumber || 1,
    retryAfter: lineage?.retryAfter || null,
    retryPolicy: normalizedRetryPolicy(taskData, normalizedOwner(taskData.owner)),
    idempotencyKey: normalizedIdempotencyKey(taskData.idempotencyKey) || null,
    mediaType,
    expectedResultCount,
    createdAt: new Date().toISOString(),
    priority: taskData.priority || 1,
    tags: taskData.tags || [],
    description: taskData.description || '',
    modelConfig: taskData.modelConfig || {
      model: 'Agnes Video 2.5 Flash',
      referenceMode: '全能参考',
      aspectRatio: '16:9',
      duration: '4s',
    },
    referenceFiles: (taskData.referenceFiles || []).map((file, index) => file.filePath
      ? { ...file, downloadPath: `/api/task-references/${encodeURIComponent(taskCode)}/${index}` }
      : file),
    prompt: taskData.prompt || '',
    realSubmit: taskData.realSubmit === true,
    // 服务端状态
    status: 'pending',
    occupiedBy: null,
    ackedAt: null,
    completedAt: null,
    error: null,
  };
  const storedTask = externalizeTaskReferenceFiles(task, TASK_REFERENCES_DIR).task;
  taskStore.set(taskCode, storedTask);
  saveTaskStore();
  return storedTask;
}

/**
 * 获取可领取的待处理任务
 */
function getPendingTasks(clientId) {
  const result = [];
  for (const [code, task] of taskStore) {
    if (task.status !== 'pending' && task.status !== 'occupied') continue;
    if (task.submitClaimedAt || task.submittedAt) continue;
    if (!retryDue(task)) continue;
    if (isOccupied(code, clientId)) continue;
    result.push(task);
  }
  return result;
}

// ============================================================
// 初始化预制测试数据
// ============================================================

// ============================================================
// HTTP 工具
// ============================================================
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('请求体超过 50MB 限制'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, data, statusCode = 200) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(body);
}

function sendHTML(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': `nomi_token=${encodeURIComponent(AUTH_TOKEN)}; HttpOnly; SameSite=Strict; Path=/`,
  });
  res.end(html);
}

// ============================================================
// Multipart 解析器 (纯 Node.js, 无外部依赖)
// ============================================================
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    if (!match) {
      reject(new Error('Missing boundary in Content-Type'));
      return;
    }
    const boundary = match[1] || match[2];
    const chunks = [];
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error(`文件超过 ${MAX_BODY_SIZE / 1024 / 1024}MB 限制`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const parts = {};
        const boundaryBuf = Buffer.from('--' + boundary);
        const endBuf = Buffer.from('--' + boundary + '--');

        // Split by boundary
        let pos = 0;
        const sections = [];
        while (pos < buffer.length) {
          const idx = buffer.indexOf(boundaryBuf, pos);
          if (idx === -1) break;
          if (sections.length > 0) {
            // content between previous boundary and this one (strip trailing \r\n)
            let end = idx;
            if (end >= 2 && buffer[end - 2] === 13 && buffer[end - 1] === 10) end -= 2;
            sections[sections.length - 1].end = end;
          }
          const start = idx + boundaryBuf.length;
          // Skip \r\n after boundary
          const afterBoundary = start + 2 <= buffer.length ? start + 2 : start;
          sections.push({ start: afterBoundary, end: buffer.length });
          pos = afterBoundary;
          // Check if this is the end boundary
          if (buffer.indexOf(endBuf, idx) === idx) break;
        }

        for (const section of sections) {
          const data = buffer.slice(section.start, section.end);
          // Find header/body separator (\r\n\r\n)
          const sepIdx = data.indexOf('\r\n\r\n');
          if (sepIdx === -1) continue;
          const headerStr = data.slice(0, sepIdx).toString('utf-8');
          const body = data.slice(sepIdx + 4);

          const nameMatch = headerStr.match(/name="([^"]+)"/);
          if (!nameMatch) continue;
          const name = nameMatch[1];
          const filenameMatch = headerStr.match(/filename="([^"]+)"/);

          if (filenameMatch) {
            // File field
            const contentTypeMatch = headerStr.match(/Content-Type:\s*(.+)/i);
            parts[name] = {
              filename: filenameMatch[1],
              contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
              data: body,
            };
          } else {
            // Text field
            parts[name] = body.toString('utf-8');
          }
        }

        resolve(parts);
      } catch (e) {
        reject(e);
      }
    });

    req.on('error', reject);
  });
}

// ============================================================
// HTTP 路由
// ============================================================
const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || '');
  const allowedOrigin = isAllowedOrigin(origin, PORT);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Nomi-Token');
  if (req.method === 'OPTIONS') {
    if (!allowedOrigin) {
      sendJSON(res, { success: false, error: 'Origin not allowed' }, 403);
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (pathname !== '/api/events') {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${pathname}`);
  }

  try {
    if (req.method === 'GET' && pathname === '/api/bootstrap') {
      if (!ALLOW_EXTENSION_PAIRING) {
        sendJSON(res, { success: false, error: 'Extension pairing is disabled' }, 404);
        return;
      }
      const extensionId = String(url.searchParams.get('extensionId') || '');
      const claimedOrigin = /^[a-p]{32}$/.test(extensionId) ? `chrome-extension://${extensionId}` : '';
      if (!claimedOrigin || (origin && origin !== claimedOrigin)) {
        sendJSON(res, { success: false, error: 'Only a Chrome extension can pair' }, 403);
        return;
      }
      const pairedOrigin = fs.existsSync(PAIRED_EXTENSION_FILE)
        ? fs.readFileSync(PAIRED_EXTENSION_FILE, 'utf8').trim()
        : '';
      if (pairedOrigin && pairedOrigin !== claimedOrigin) {
        sendJSON(res, { success: false, error: 'Another Chrome extension is already paired' }, 403);
        return;
      }
      if (!pairedOrigin) fs.writeFileSync(PAIRED_EXTENSION_FILE, claimedOrigin, { mode: 0o600 });
      res.setHeader('Cache-Control', 'no-store');
      sendJSON(res, { success: true, token: AUTH_TOKEN, instanceId: INSTANCE_ID });
      return;
    }
    if ((pathname === '/' || pathname.startsWith('/api/')) && !isAuthorizedRequest(req, url, AUTH_TOKEN)) {
      sendJSON(res, { success: false, error: 'Unauthorized' }, 401);
      return;
    }
    // ===== SSE 长连接 =====
    if (req.method === 'GET' && pathname === '/api/events') {
      const clientId = url.searchParams.get('clientId') || 'anon-' + Date.now();
      console.log(`  📡 SSE 客户端连接: ${clientId}`);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ clientId, time: new Date().toISOString() })}\n\n`);
      sseClients.set(clientId, res);

      const heartbeat = setInterval(() => {
        try { res.write(`: heartbeat\n\n`); } catch { /* ignore */ }
      }, 15000);

      req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(clientId);
        console.log(`  📡 SSE 客户端断开: ${clientId} (在线: ${sseClients.size})`);
      });
      return;
    }

    // ===== 获取并占用待处理任务 =====
    if (req.method === 'GET' && pathname === '/api/tasks/pending') {
      const clientId = url.searchParams.get('clientId') || 'unknown';
      const pendingTasks = getPendingTasks(clientId);

      // 占用每个任务 (taskCode → clientId)
      if (pendingTasks.length > 0 && clientId !== 'unknown') {
        for (const task of pendingTasks) {
          occupyTask(task.taskCode, clientId);
          task.status = 'occupied';
          task.occupiedBy = clientId;
        }
        saveTaskStore();
        console.log(`  🔒 ${clientId} 占用 ${pendingTasks.length} 个任务: ${pendingTasks.map(t => t.taskCode).join(', ')}`);
      }

      // 返回客户端数据
      const clientTasks = pendingTasks.map(t => ({
        taskCode: t.taskCode,
        ...attemptIdentity(t),
        mediaType: taskMediaType(t),
        expectedResultCount: t.expectedResultCount || 1,
        createdAt: t.createdAt,
        priority: t.priority,
        tags: t.tags,
        description: t.description,
        modelConfig: t.modelConfig,
        referenceFiles: t.referenceFiles,
        prompt: t.prompt,
        realSubmit: t.realSubmit,
      }));

      sendJSON(res, {
        success: true,
        total: clientTasks.length,
        tasks: clientTasks,
        occupiedBy: clientId,
      });
      return;
    }

    // ===== 确认接收任务 =====
    if (req.method === 'POST' && pathname === '/api/tasks/ack') {
      const body = await parseBody(req);
      const { taskCodes } = body;
      if (Array.isArray(taskCodes) && taskCodes.some(code => {
        const task = taskStore.get(code);
        return task && (task.submitClaimedAt || attemptFinished(task) || !retryDue(task));
      })) {
        sendJSON(res, { success: false, error: '已领取提交权的任务不能重新确认入队' }, 409);
        return;
      }
      if (Array.isArray(taskCodes)) {
        for (const code of taskCodes) {
          const task = taskStore.get(code);
          if (task) {
            task.status = 'acked';
            task.ackedAt = new Date().toISOString();
          }
        }
        console.log(`  ✅ 确认任务: ${taskCodes.join(', ')}`);
        saveTaskStore();
      }
      sendJSON(res, { success: true, acknowledged: taskCodes || [] });
      return;
    }

    // ===== 释放占用 =====
    if (req.method === 'GET' && pathname === '/api/tasks/release') {
      const taskCode = url.searchParams.get('taskCode');
      const task = taskCode ? taskStore.get(taskCode) : null;
      if (task && (task.status === 'occupied' || task.status === 'acked')) {
        const previousOwner = occupiedTasks.get(taskCode)?.clientId || task.occupiedBy || '未知';
        occupiedTasks.delete(taskCode);
        task.status = 'pending';
        task.occupiedBy = null;
        console.log(`  🔓 释放任务 ${taskCode} (原占用: ${previousOwner})`);
        broadcastSSE('task-released', { taskCode });
        saveTaskStore();
        sendJSON(res, { success: true, taskCode, released: true });
      } else {
        sendJSON(res, { success: false, taskCode, released: false, error: `任务不存在或状态不可释放（当前: ${task?.status ?? '无此任务'}）` }, 409);
      }
      return;
    }

    // ===== 更新任务状态 =====
    if (req.method === 'POST' && pathname === '/api/tasks/status') {
      const body = await parseBody(req);
      const { taskCode, status, error, completedAt, updatedAt } = body;
      console.log(`  任务状态更新: ${taskCode} → ${status}${error ? ' (' + error + ')' : ''}`);

      const task = taskStore.get(taskCode);
      if (!task) {
        sendJSON(res, { success: false, error: '任务不存在' }, 404);
        return;
      }
      const failureEvidence = status === 'failed' ? validatedFailure(task, body.failureEvidence) : null;
      if (status === 'failed' && task.submitClaimedAt && !failureEvidence) {
        sendJSON(res, { success: false, error: 'A bound terminal website failure is required; keep querying an unknown attempt' }, 409);
        return;
      }
      if (attemptFinished(task)) {
        if (status !== task.status || (task.failureEvidence && status === 'failed'
          && JSON.stringify(task.failureEvidence) !== JSON.stringify(failureEvidence))) {
          sendJSON(res, { success: false, error: 'Historical terminal attempts cannot be reopened or have their evidence replaced' }, 409);
          return;
        }
        const retry = childFor(task);
        sendJSON(res, { success: true, taskCode, status, retryTaskCode: retry?.taskCode || null, retryAfter: retry?.retryAfter || null });
        return;
      }
      if (task) {
        const forbiddenAfterClaim = new Set(['pending', 'occupied', 'acked', 'configuring', 'submitting']);
        if ((task.submitClaimedAt || task.submittedAt) && forbiddenAfterClaim.has(status)) {
          sendJSON(res, {
            success: false,
            error: `任务 ${taskCode} 已经提交过，不能重新进入待提交队列`,
            taskCode,
            status: task.status,
          }, 409);
          return;
        }
        if (status === 'completed' && task.realSubmit) {
          const files = Array.from(fileStore.values()).filter(file => file.taskCode === taskCode
            && file.size > 0 && fs.existsSync(file.filePath) && fs.statSync(file.filePath).size === file.size);
          if (!task.pavoConversationId || files.length < (task.expectedResultCount || 1)) {
            sendJSON(res, { success: false, error: '会话未绑定或结果未成功落盘，不能标记完成' }, 409);
            return;
          }
          task.syncedFileCount = files.length;
          task.harvestDone = true;
          task.completedAt = new Date().toISOString();
        }
        if (status === 'failed' && task.submitClaimedAt) task.harvestDone = true;
        if (failureEvidence) task.failureEvidence = failureEvidence;
        task.status = status;
        task.error = error || null;
        if (completedAt) task.completedAt = completedAt;
        if (updatedAt) task.updatedAt = updatedAt;
      }
      if (status === 'completed' || status === 'failed') {
        occupiedTasks.delete(taskCode);
      }
      const retry = status === 'failed' && failureEvidence ? createRetry(task) : null;
      if (!retry) saveTaskStore();

      // 广播状态更新给所有 SSE 客户端
      broadcastSSE('task-status', {
        taskCode,
        status,
        error: error || null,
        time: new Date().toISOString(),
      });

      if (retry) broadcastSSE('new-tasks', { count: 1, taskCodes: [retry.taskCode], retryAfter: retry.retryAfter });
      sendJSON(res, { success: true, taskCode, status, retryTaskCode: retry?.taskCode || null, retryAfter: retry?.retryAfter || null });
      return;
    }

    // ===== 付费提交占位：同一任务代码最多允许一次官网点击 =====
    if (req.method === 'POST' && pathname === '/api/tasks/submit-claim') {
      const body = await parseBody(req);
      const taskCode = String(body.taskCode || '').trim();
      const task = taskStore.get(taskCode);
      if (!task) {
        sendJSON(res, { success: false, error: '任务不存在' }, 404);
        return;
      }
      if (task.submitClaimedAt) {
        sendJSON(res, {
          success: false,
          error: `任务 ${taskCode} 已经提交过，已拦截重复生成`,
          taskCode,
          submitClaimedAt: task.submitClaimedAt,
        }, 409);
        return;
      }
      if (attemptFinished(task) || !retryDue(task)) {
        sendJSON(res, { success: false, error: 'Attempt is terminal or still cooling down', retryAfter: task.retryAfter || null, queued: !attemptFinished(task) }, 409);
        return;
      }
      if (task.realSubmit && !task.idempotencyKey) {
        sendJSON(res, {
          success: false,
          error: `真实任务 ${taskCode} 缺少幂等标识，禁止提交以避免重复扣费`,
          taskCode,
        }, 409);
        return;
      }
      const inflight = Array.from(taskStore.values()).filter(other => other.taskCode !== taskCode
        && other.submitClaimedAt && !attemptFinished(other));
      const active = inflight.find(other => !other.composerReleasedAt);
      if (active || inflight.length >= 2) {
        sendJSON(res, { success: false, error: active ? `任务 ${active.taskCode} 尚未释放控制台` : 'At most two attempts may be inflight', queued: true }, 409);
        return;
      }
      if (task.realSubmit && (body.conversationSnapshotComplete !== true || !Array.isArray(body.conversationBaselineIds))) {
        sendJSON(res, { success: false, error: '缺少完整会话基线，禁止付费提交' }, 409);
        return;
      }
      task.conversationBaselineIds = Array.isArray(body.conversationBaselineIds) ? body.conversationBaselineIds.map(String) : [];
      task.conversationSnapshotComplete = body.conversationSnapshotComplete === true;
      task.outputBaselineUrls = Array.isArray(body.outputBaselineUrls) ? body.outputBaselineUrls.map(String) : [];
      task.submitClaimedAt = new Date().toISOString();
      task.submitClaimId = nodeCrypto.randomUUID();
      task.submittedBy = String(body.clientId || '').trim() || null;
      task.status = 'submitting';
      task.updatedAt = task.submitClaimedAt;
      saveTaskStore();
      sendJSON(res, {
        success: true,
        taskCode,
        submitClaimedAt: task.submitClaimedAt,
        submitClaimId: task.submitClaimId,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/tasks/composer-release') {
      const body = await parseBody(req);
      const task = taskStore.get(String(body.taskCode || '').trim());
      if (!task?.submitClaimedAt || !task.submitClaimId || !task.submittedBy || !task.pavoConversationId
        || body.submitClaimId !== task.submitClaimId || body.clientId !== task.submittedBy
        || body.conversationId !== task.pavoConversationId || body.freshConsoleConfirmed !== true) {
        sendJSON(res, { success: false, error: 'Composer release requires the original claim, client, bound conversation and a fresh console' }, 409);
        return;
      }
      if (!task.composerReleasedAt) {
        task.composerReleasedAt = new Date().toISOString();
        saveTaskStore();
      }
      sendJSON(res, { success: true, taskCode: task.taskCode, composerReleasedAt: task.composerReleasedAt });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/tasks/result-binding') {
      const body = await parseBody(req);
      const task = taskStore.get(String(body.taskCode || ''));
      const conversationId = String(body.conversationId || '').trim();
      if (!task?.submitClaimedAt || !conversationId) {
        sendJSON(res, { success: false, error: '缺少已提交任务或会话标识' }, 409);
        return;
      }
      const owner = Array.from(taskStore.values()).find(other => other.taskCode !== task.taskCode
        && other.pavoConversationId === conversationId);
      const manualConfirmed = body.confirmed === true;
      if (owner || (task.pavoConversationId && task.pavoConversationId !== conversationId)
        || (!manualConfirmed && (task.conversationSnapshotComplete !== true
          || !Array.isArray(task.conversationBaselineIds)
          || task.conversationBaselineIds.includes(conversationId)))) {
        sendJSON(res, { success: false, error: '会话已被绑定、属于旧基线或基线缺失，禁止错配' }, 409);
        return;
      }
      if (attemptFinished(task)) {
        if (task.pavoConversationId !== conversationId) {
          sendJSON(res, { success: false, error: 'Cannot bind a new conversation to a terminal attempt' }, 409);
          return;
        }
        sendJSON(res, { success: true, conversationId });
        return;
      }
      task.pavoConversationId = conversationId;
      task.bindingSource = manualConfirmed ? 'user_confirmed' : 'unique_new_full_prompt';
      if (!task.syncedFileCount) {
        task.status = 'awaiting_result';
        task.harvestDone = false;
      }
      saveTaskStore();
      sendJSON(res, { success: true, conversationId });
      return;
    }

    // ===== 官网点击确认：仅确认已经发生的单次点击，不会创建或重提任务 =====
    if (req.method === 'POST' && pathname === '/api/tasks/submit-confirm') {
      const body = await parseBody(req);
      const taskCode = String(body.taskCode || '').trim();
      const task = taskStore.get(taskCode);
      if (!task || !task.submitClaimedAt) {
        sendJSON(res, { success: false, error: '任务尚未取得官网提交权' }, 409);
        return;
      }
      const claimId = String(body.submitClaimId || '').trim();
      if (!claimId || claimId !== task.submitClaimId) {
        sendJSON(res, { success: false, error: '官网提交确认标识不匹配' }, 409);
        return;
      }
      if (attemptFinished(task)) {
        sendJSON(res, { success: false, error: 'Cannot confirm or reopen a terminal attempt' }, 409);
        return;
      }
      if (!task.submittedAt) task.submittedAt = new Date().toISOString();
      task.status = 'generating';
      task.updatedAt = task.submittedAt;
      saveTaskStore();
      sendJSON(res, {
        success: true,
        taskCode,
        submittedAt: task.submittedAt,
      });
      return;
    }

    // ===== 获取配置 =====
    if (req.method === 'GET' && pathname === '/api/config') {
      sendJSON(res, {
        success: true,
        config: {
          maxConcurrent: 1,
          maxInflight: 2,
          retryCooldownMs: RETRY_COOLDOWN_MS,
          taskDelay: 3,
          autoExecute: false,
          apiBaseUrl: `http://localhost:${PORT}`,
        },
      });
      return;
    }

    // ===== 推送新任务 =====
    if (req.method === 'POST' && pathname === '/api/tasks/push') {
      const body = await parseBody(req);
      const tasks = body.tasks || [body];
      const pushed = [];

      if (!Array.isArray(tasks) || tasks.some(t => !t || typeof t !== 'object' || Array.isArray(t))) {
        sendJSON(res, { success: false, error: 'tasks must be an array of task objects' }, 400);
        return;
      }
      // Validate the whole batch before storing any root or externalizing references.
      const batchOwners = new Map();
      for (const t of tasks) {
        let owner;
        try {
          owner = normalizedOwner(t.owner);
          normalizedRetryPolicy(t, owner);
        } catch (error) {
          sendJSON(res, { success: false, error: error.message }, 400);
          return;
        }
        if (t.realSubmit === true && taskMediaType(t) === 'video' && !normalizedIdempotencyKey(t.idempotencyKey)) {
          sendJSON(res, { success: false, error: '真实视频任务必须携带幂等标识，已拒绝提交以避免重复扣费' }, 400);
          return;
        }
        const key = normalizedIdempotencyKey(t.idempotencyKey);
        const existing = taskForIdempotencyKey(key);
        const identity = JSON.stringify(owner);
        if ((existing && JSON.stringify(existing.owner || null) !== identity)
          || (key && batchOwners.has(key) && batchOwners.get(key) !== identity)) {
          sendJSON(res, { success: false, error: 'Idempotency key belongs to a different project/node owner' }, 409);
          return;
        }
        if (key) batchOwners.set(key, identity);
      }

      for (const t of tasks) {
        const existing = taskForIdempotencyKey(t.idempotencyKey);
        if (existing) {
          pushed.push(existing.taskCode);
          console.log(`  🛡️ 幂等复用任务 ${existing.taskCode}，未创建重复任务`);
          continue;
        }
        const task = addTask({
          idempotencyKey: t.idempotencyKey,
          owner: t.owner,
          retryPolicy: t.retryPolicy,
          mediaType: taskMediaType(t),
          expectedResultCount: t.expectedResultCount,
          description: t.description || '',
          prompt: t.prompt || '',
          tags: t.tags || [],
          priority: t.priority || 1,
          modelConfig: t.modelConfig || undefined,
          referenceFiles: t.referenceFiles || [],
          realSubmit: t.realSubmit === true,
        });
        pushed.push(task.taskCode);
        console.log(`  📥 创建${task.mediaType === 'image' ? '图片' : '视频'}任务 ${task.taskCode}: "${(task.prompt || '').substring(0, 40)}" (realSubmit: ${task.realSubmit})`);
      }

      broadcastSSE('new-tasks', {
        count: pushed.length,
        taskCodes: pushed,
        message: `有 ${pushed.length} 个新任务待领取`,
        time: new Date().toISOString(),
      });
      console.log(`  📤 推送 ${pushed.length} 个任务, 通知 ${sseClients.size} 个 SSE 客户端`);

      sendJSON(res, { success: true, taskCodes: pushed, notified: sseClients.size });
      return;
    }

    // ===== 任务参考素材按需下载（tasks.json 只存路径，不再持久 Base64） =====
    const taskReferenceMatch = pathname.match(/^\/api\/task-references\/([^/]+)\/(\d+)$/);
    if (req.method === 'GET' && taskReferenceMatch) {
      const taskCode = decodeURIComponent(taskReferenceMatch[1]);
      const referenceIndex = Number(taskReferenceMatch[2]);
      const task = taskStore.get(taskCode);
      if (!task || !Number.isInteger(referenceIndex)) {
        sendJSON(res, { success: false, error: '参考素材不存在' }, 404);
        return;
      }
      const reference = readTaskReference(task, referenceIndex, TASK_REFERENCES_DIR);
      res.writeHead(200, {
        'Content-Type': reference.fileType,
        'Content-Length': reference.bytes.length,
        'Content-Disposition': `inline; filename="${encodeURIComponent(reference.fileName)}"`,
        'Cache-Control': 'private, max-age=300',
      });
      res.end(reference.bytes);
      return;
    }

    // ===== 文件上传 =====
    if (req.method === 'POST' && pathname === '/api/files/upload') {
      const parts = await parseMultipart(req);
      const taskCode = parts.taskCode || 'unknown';
      const quality = parts.quality || 'standard';
      const mimeType = parts.mimeType || 'video/mp4';
      const originalUrl = parts.originalUrl || '';
      const filePart = parts.file;

      if (!filePart || !filePart.data || filePart.data.length === 0) {
        sendJSON(res, { success: false, error: '未提供文件' }, 400);
        return;
      }

      sendJSON(res, storeResultFile({
        taskCode,
        quality,
        mimeType: filePart.contentType || mimeType,
        originalUrl,
        filename: filePart.filename,
        bytes: filePart.data,
      }));
      return;
    }

    // ===== 服务端抓取 Pavo 结果（规避页面/扩展跨域与防盗链限制） =====
    if (req.method === 'POST' && pathname === '/api/files/fetch-remote') {
      const body = await parseBody(req);
      const taskCode = String(body.taskCode || '').trim();
      const quality = String(body.quality || 'standard').trim() || 'standard';
      const mediaType = body.mediaType === 'image' ? 'image' : 'video';
      if (!taskCode) {
        sendJSON(res, { success: false, error: '缺少任务号' }, 400);
        return;
      }
      const sourceUrl = remoteMediaUrl(body.mediaUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      let remoteResponse;
      try {
        remoteResponse = await fetch(sourceUrl, {
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            Accept: mediaType === 'image' ? 'image/*' : 'video/*',
            Referer: 'https://app.pavo-ai.cn/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36',
          },
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!remoteResponse.ok) {
        sendJSON(res, { success: false, error: `Pavo 结果下载 HTTP ${remoteResponse.status}` }, 502);
        return;
      }
      remoteMediaUrl(remoteResponse.url || sourceUrl.toString());
      const contentType = String(remoteResponse.headers.get('content-type') || '').split(';')[0].trim();
      if (!contentType.startsWith(`${mediaType}/`)) {
        sendJSON(res, { success: false, error: `Pavo 结果类型不匹配：${contentType || 'unknown'}` }, 502);
        return;
      }
      const declaredSize = Number(remoteResponse.headers.get('content-length') || 0);
      if (declaredSize > REMOTE_MEDIA_MAX_BYTES) {
        sendJSON(res, { success: false, error: 'Pavo 结果文件超过 120MB 限制' }, 413);
        return;
      }
      const bytes = Buffer.from(await remoteResponse.arrayBuffer());
      if (!bytes.length || bytes.length > REMOTE_MEDIA_MAX_BYTES) {
        sendJSON(res, { success: false, error: bytes.length ? 'Pavo 结果文件超过 120MB 限制' : 'Pavo 结果下载返回空文件' }, 502);
        return;
      }
      const filename = `${taskCode}_${quality}_${Date.now()}.${mediaExtension(contentType, mediaType)}`;
      sendJSON(res, storeResultFile({
        taskCode,
        quality,
        mimeType: contentType,
        originalUrl: sourceUrl.toString(),
        filename,
        bytes,
      }));
      return;
    }

    // ===== 文件列表 (按任务号查询, 支持 tags 过滤) =====
    if (req.method === 'GET' && pathname === '/api/files') {
      const filterTaskCode = url.searchParams.get('taskCode');
      const filterTask = filterTaskCode ? taskStore.get(filterTaskCode) : null;
      const attemptTaskCode = filterTask ? latestAttempt(filterTask).taskCode : filterTaskCode;
      const filterTags = url.searchParams.get('tags'); // 逗号分隔多标签
      const filterTagSet = filterTags ? new Set(filterTags.split(',').map(t => t.trim()).filter(Boolean)) : null;

      // 收集所有唯一标签 (用于前端标签选择器)
      const allTagsSet = new Set();

      const files = [];
      for (const [, meta] of fileStore) {
        if (filterTaskCode && meta.taskCode !== attemptTaskCode) continue;

        // 动态从 taskStore 补全缺失的任务元数据 (兼容旧数据)
        let taskDescription = meta.taskDescription || '';
        let taskPrompt = meta.taskPrompt || '';
        let taskTags = meta.taskTags || [];
        let taskModelConfig = meta.taskModelConfig || null;
        let taskOutputMediaType = meta.taskMediaType || 'video';
        let taskRealSubmit = meta.taskRealSubmit || false;
        let taskCreatedAt = meta.taskCreatedAt || '';

        if (!taskDescription && !taskPrompt && taskTags.length === 0 && !taskModelConfig) {
          const taskInfo = taskStore.get(meta.taskCode);
          if (taskInfo) {
            taskDescription = taskInfo.description || '';
            taskPrompt = taskInfo.prompt || '';
            taskTags = taskInfo.tags || [];
            taskModelConfig = taskInfo.modelConfig || null;
            taskOutputMediaType = taskMediaType(taskInfo);
            taskRealSubmit = taskInfo.realSubmit || false;
            taskCreatedAt = taskInfo.createdAt || '';
            // 回写到 fileStore 以持久化
            meta.taskDescription = taskDescription;
            meta.taskPrompt = taskPrompt;
            meta.taskTags = taskTags;
            meta.taskModelConfig = taskModelConfig;
            meta.taskMediaType = taskOutputMediaType;
            meta.taskRealSubmit = taskRealSubmit;
            meta.taskCreatedAt = taskCreatedAt;
          }
        }

        // 收集所有标签
        for (const tag of taskTags) allTagsSet.add(tag);

        // 按标签过滤 (取交集: 文件必须包含所有选中的标签)
        if (filterTagSet && filterTagSet.size > 0) {
          const fileTags = new Set(taskTags);
          let allMatch = true;
          for (const ft of filterTagSet) {
            if (!fileTags.has(ft)) { allMatch = false; break; }
          }
          if (!allMatch) continue;
        }

        files.push({
          fileId: meta.fileId,
          taskCode: filterTaskCode || meta.taskCode,
          attemptTaskCode: meta.taskCode,
          quality: meta.quality,
          filename: meta.filename,
          mimeType: meta.mimeType,
          size: meta.size,
          uploadedAt: meta.uploadedAt,
          taskDescription,
          taskPrompt,
          taskTags,
          taskModelConfig,
          taskMediaType: taskOutputMediaType,
          taskRealSubmit,
          taskCreatedAt,
        });
      }

      // 如果有回写, 保存一次
      saveFileStore();

      // 按任务号分组
      const grouped = {};
      for (const f of files) {
        if (!grouped[f.taskCode]) grouped[f.taskCode] = [];
        grouped[f.taskCode].push(f);
      }
      sendJSON(res, {
        success: true,
        files,
        grouped,
        total: files.length,
        allTags: Array.from(allTagsSet).sort(),
      });
      return;
    }

    // ===== 提供文件下载/预览 =====
    if (req.method === 'GET' && pathname.startsWith('/api/files/')) {
      const fileId = pathname.split('/').pop();
      const meta = fileStore.get(fileId);
      if (!meta || !fs.existsSync(meta.filePath)) {
        sendJSON(res, { success: false, error: '文件不存在' }, 404);
        return;
      }
      const stat = fs.statSync(meta.filePath);
      res.writeHead(200, {
        'Content-Type': meta.mimeType || 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `inline; filename="${encodeURIComponent(meta.filename)}"`,
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(meta.filePath).pipe(res);
      return;
    }

    // ===== 文件预览页面 =====
    if (req.method === 'GET' && pathname === '/files') {
      const filesHtmlPath = path.join(__dirname, 'files.html');
      if (fs.existsSync(filesHtmlPath)) {
        const html = fs.readFileSync(filesHtmlPath, 'utf-8');
        sendHTML(res, html);
      } else {
        sendHTML(res, '<h1>files.html not found</h1>');
      }
      return;
    }

    // ===== 获取所有任务列表 =====
    const singleTaskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (req.method === 'GET' && singleTaskMatch) {
      const task = taskStore.get(decodeURIComponent(singleTaskMatch[1]));
      if (!task) {
        sendJSON(res, { success: false, error: '任务不存在' }, 404);
        return;
      }
      sendJSON(res, { success: true, task: projectedTask(task) });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/tasks') {
      const allTasks = [];
      for (const task of taskStore.values()) {
        allTasks.push({
          taskCode: task.taskCode,
          ...attemptIdentity(task),
          mediaType: taskMediaType(task),
          description: task.description,
          prompt: task.prompt || '',
          modelConfig: task.modelConfig,
          referenceFiles: task.referenceFiles,
          expectedResultCount: task.expectedResultCount || 1,
          status: task.status,
          idempotencyKey: task.idempotencyKey || null,
          submitClaimedAt: task.submitClaimedAt || null,
          submitClaimId: task.submitClaimId || null,
          submittedAt: task.submittedAt || null,
          submittedBy: task.submittedBy || null,
          composerReleasedAt: task.composerReleasedAt || null,
          failureEvidence: task.failureEvidence || null,
          pavoConversationId: task.pavoConversationId || null,
          bindingSource: task.bindingSource || null,
          conversationBaselineIds: task.conversationBaselineIds,
          conversationSnapshotComplete: task.conversationSnapshotComplete === true,
          outputBaselineUrls: task.outputBaselineUrls,
          syncedFileCount: task.syncedFileCount || 0,
          harvestDone: task.harvestDone === true,
          error: task.error || null,
          realSubmit: task.realSubmit,
          occupiedBy: task.occupiedBy,
          createdAt: task.createdAt,
          referenceFileCount: (task.referenceFiles || []).length,
        });
      }
      sendJSON(res, { success: true, tasks: allTasks, total: allTasks.length });
      return;
    }

    // ===== 管理页面 =====
    if (req.method === 'GET' && pathname === '/admin') {
      const adminHtmlPath = path.join(__dirname, 'admin.html');
      if (fs.existsSync(adminHtmlPath)) {
        const html = fs.readFileSync(adminHtmlPath, 'utf-8');
        sendHTML(res, html);
      } else {
        sendHTML(res, '<h1>admin.html not found</h1>');
      }
      return;
    }

    // ===== 欢迎页 =====
    if (req.method === 'GET' && pathname === '/') {
      const taskSummary = {};
      for (const [, task] of taskStore) {
        taskSummary[task.status] = (taskSummary[task.status] || 0) + 1;
      }
      sendJSON(res, {
        name: 'Pavo Web Task Bridge',
        ...require('./contract.json'),
        version: '3.5.0',
        instanceId: INSTANCE_ID,
        endpoints: [
          'GET  /api/events?clientId=xxx     - SSE 长连接',
          'GET  /api/tasks/pending?clientId=  - 获取并占用待处理任务',
          'POST /api/tasks/ack               - 确认接收任务',
          'POST /api/tasks/status            - 更新任务状态',
          'POST /api/tasks/submit-claim      - 领取唯一官网提交权',
          'POST /api/tasks/submit-confirm    - 确认唯一官网点击',
          'POST /api/tasks/composer-release  - Release the bound attempt console',
          'GET  /api/tasks/release?taskCode=  - 释放占用',
          'POST /api/tasks/push              - 推送新任务',
          'GET  /api/task-references/:task/:index - 按需读取任务参考素材',
          'GET  /api/tasks                   - 查看所有任务',
          'GET  /api/config                  - 配置',
          'GET  /admin                       - 管理页面',
          'POST /api/files/upload            - 上传图片或视频结果',
          'POST /api/files/fetch-remote      - 服务端抓取 Pavo 结果',
          'GET  /api/files                   - 文件列表',
          'GET  /api/files/:fileId           - 文件下载/预览',
          'GET  /files                       - 文件预览页面',
        ],
        sseClients: sseClients.size,
        taskStore: { total: taskStore.size, ...taskSummary },
        occupiedTasks: Object.fromEntries(occupiedTasks),
      });
      return;
    }

    sendJSON(res, { success: false, error: 'Not Found' }, 404);
  } catch (err) {
    console.error('请求处理错误:', err);
    sendJSON(res, { success: false, error: err.message }, 500);
  }
});

// ============================================================
// 启动
// ============================================================
// 从磁盘加载持久化数据
loadPersistedData();
// Offline examples live in electron/pavoWeb/fixtures/preset-tasks.cjs; normal startup never seeds tasks.

server.listen(PORT, HOST, () => {
  console.log(`\nPavo Web Task Bridge v3.5 已启动`);
  console.log(`   地址: http://${HOST}:${PORT} (仅本机)`);
  console.log(`   管理: http://${HOST}:${PORT}/admin`);
  console.log(`   文件: http://localhost:${PORT}/files`);
  console.log(`   SSE:  http://localhost:${PORT}/api/events?clientId=test`);
  console.log(`   任务: http://localhost:${PORT}/api/tasks/pending?clientId=test`);
  console.log(`   推送: POST http://localhost:${PORT}/api/tasks/push`);
  console.log(`   列表: http://localhost:${PORT}/api/tasks`);
  console.log(`   上传: POST http://localhost:${PORT}/api/files/upload\n`);
});

if (Number.isInteger(PARENT_PID) && PARENT_PID > 1) {
  const parentWatch = setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      console.log(`Nomi 父进程 ${PARENT_PID} 已退出，关闭 Pavo 本地服务`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1_000).unref();
    }
  }, 2_000);
  parentWatch.unref();
}
