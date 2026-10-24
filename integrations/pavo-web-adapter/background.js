const PAVO_URL = 'https://app.pavo-ai.cn/';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['preset'], data => {
    chrome.storage.local.set({
      preset: data.preset || {
        model: 'Agnes Video 2.5 Flash',
        referenceMode: '全能模式',
        aspectRatio: '16:9',
        resolution: '720P',
        duration: '4s',
      },
    });
  });
  void ensureInjected();
});

chrome.alarms.create('pavo-reinject', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'pavo-reinject') void ensureInjected();
});

async function ensureInjected() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://app.pavo-ai.cn/*' });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        // 无条件注入：页面已有健康脚本时 content.js 的守卫会直接空转，
        // 孤儿脚本会被识别并拆卸重建——不依赖 ping 检测（孤儿对 ping 的响应不可靠）
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['pavo-media.js', 'content.js'],
        });
      } catch { /* 无法注入的标签页跳过 */ }
    }
  } catch { /* 忽略巡检异常 */ }
}

chrome.action.onClicked.addListener(async tab => {
  if (tab?.id && tab.url?.startsWith(PAVO_URL)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'toggleDrawer' });
      return;
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['pavo-media.js', 'content.js'],
      });
      await chrome.tabs.sendMessage(tab.id, { action: 'toggleDrawer' });
      return;
    }
  }
  await chrome.tabs.create({ url: PAVO_URL });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'fetchAndUploadMediaUrl') return false;
  fetchAndUploadMediaUrl(message)
    .then(result => sendResponse({ success: true, ...result }))
    .catch(error => sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

function localServerUrl(value) {
  const url = new URL(String(value || ''));
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'http:' || !loopback) throw new Error('媒体结果只能上传到本机 Pavo Bridge');
  return url.toString().replace(/\/$/, '');
}

function mediaExtension(mimeType, mediaType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('webm')) return 'webm';
  return mediaType === 'image' ? 'png' : 'mp4';
}

async function fetchAndUploadMediaUrl(message) {
  const mediaUrl = new URL(String(message.mediaUrl || ''));
  if (mediaUrl.protocol !== 'https:') throw new Error('Pavo 媒体地址不是 HTTPS');
  const serverUrl = localServerUrl(message.serverUrl);
  const mediaType = message.mediaType === 'image' ? 'image' : 'video';
  const taskCode = String(message.taskCode || '').trim();
  const quality = String(message.quality || 'original').trim() || 'original';
  if (!taskCode) throw new Error('缺少任务号');

  const response = await fetch(mediaUrl.toString(), {
    credentials: 'include',
    cache: 'no-store',
    referrer: PAVO_URL,
  });
  if (!response.ok) throw new Error(`Pavo 媒体下载 HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('Pavo 媒体下载返回空文件');

  const mimeType = blob.type || (mediaType === 'image' ? 'image/png' : 'video/mp4');
  const filename = `${taskCode}_${quality}_${Date.now()}.${mediaExtension(mimeType, mediaType)}`;
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('taskCode', taskCode);
  formData.append('quality', quality);
  formData.append('mimeType', mimeType);
  formData.append('originalUrl', mediaUrl.toString());

  const uploadResponse = await fetch(`${serverUrl}/api/files/upload`, {
    method: 'POST',
    headers: message.apiToken ? { 'X-Nomi-Token': String(message.apiToken) } : {},
    body: formData,
  });
  const result = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !result.success) {
    throw new Error(result.error || `本地上传 HTTP ${uploadResponse.status}`);
  }
  return { uploaded: 1, fileId: result.fileId, filename, size: blob.size, quality };
}
