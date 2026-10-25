(function initPavoMedia(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PavoMedia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPavoMedia() {
  const PAGE_URLS = {
    video: 'https://app.pavo-ai.cn/',
    image: 'https://app.pavo-ai.cn/',
  };

  const OFFICIAL_MODELS = {
    video: [
      { key: 'pavo-agnes-video-2.5-flash', label: 'Agnes Video 2.5 Flash' },
    ],
    image: [],
  };

  function normalizeMediaType(value) {
    return String(value || '').toLowerCase() === 'image' ? 'image' : 'video';
  }

  function taskMediaType(task) {
    return normalizeMediaType(task && (task.mediaType || task.generationType));
  }

  function pageUrlForMediaType(value) {
    return PAGE_URLS[normalizeMediaType(value)];
  }

  function isPageForMediaType(urlValue) {
    try {
      return new URL(String(urlValue || '')).hostname === 'app.pavo-ai.cn';
    } catch {
      return false;
    }
  }

  function officialModels(value) {
    return OFFICIAL_MODELS[normalizeMediaType(value)].map(model => ({ ...model }));
  }

  function modelLabelForTask(mediaTypeValue, modelKey) {
    const key = String(modelKey || '').trim().toLowerCase();
    const match = OFFICIAL_MODELS[normalizeMediaType(mediaTypeValue)]
      .find(model => model.key.toLowerCase() === key || model.label.toLowerCase() === key);
    return match ? match.label : String(modelKey || '').trim();
  }

  function compactText(value) {
    return String(value || '').replace(/\s+/g, '').toUpperCase();
  }

  function isOutputSettingsTriggerText(value) {
    const text = compactText(value);
    return /(\d+:\d+|720P|1080P|2K|4K|\d+S|全能模式|首帧|尾帧)/.test(text);
  }

  function outputSettingTextContains(value, targetValue) {
    const text = compactText(value);
    const target = compactText(targetValue);
    return Boolean(target) && text.includes(target);
  }

  function exactSettingTextMatches(value, targetValue) {
    const text = compactText(value);
    const target = compactText(targetValue);
    return Boolean(target) && text === target;
  }

  function aspectRatioFromOutputSettingsText(value) {
    return String(value || '').match(/\d+\s*:\s*\d+/i)?.[0]?.replace(/\s+/g, '') || '';
  }

  function generationCountFromOutputSettingsText(value) {
    const match = String(value || '').match(/(?:数量|生成)\s*([1-8])/i);
    return match ? Number(match[1]) : null;
  }

  function mediaLabel(value) {
    return normalizeMediaType(value) === 'image' ? '图片' : '视频';
  }

  function pageInfoReadyForMediaType(mediaTypeValue, infoValue) {
    const info = infoValue && typeof infoValue === 'object' ? infoValue : {};
    return info.hostname === 'app.pavo-ai.cn'
      && info.hasSubmitButton === true
      && info.hasPromptEditor === true
      && info.mediaType === normalizeMediaType(mediaTypeValue);
  }

  function extensionFromMime(mimeType, value) {
    const mime = String(mimeType || '').toLowerCase();
    if (mime.includes('jpeg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('quicktime')) return 'mov';
    if (mime.includes('webm')) return 'webm';
    return normalizeMediaType(value) === 'image' ? 'png' : 'mp4';
  }

  function validateAppliedPreset(mediaTypeValue, requestedValue, responseValue) {
    const mediaType = normalizeMediaType(mediaTypeValue);
    const requested = requestedValue && typeof requestedValue === 'object' ? requestedValue : {};
    const response = responseValue && typeof responseValue === 'object' ? responseValue : {};
    const result = response.result && typeof response.result === 'object' ? response.result : {};
    if (response.success !== true) {
      return { ok: false, missing: ['页面响应'], error: String(response.error || 'Pavo 页面没有返回参数设置结果') };
    }
    if (result.error || result.warning) {
      return { ok: false, missing: ['Pavo 工作台'], error: String(result.error || result.warning) };
    }
    const checks = [
      ['model', '模型'],
      ['referenceMode', '参考模式'],
      ['aspectRatio', '比例'],
      ['resolution', '清晰度'],
      ['duration', '时长'],
    ];
    const missing = checks.flatMap(([key, label]) => {
      if (mediaType === 'image' && (key === 'duration' || key === 'referenceMode')) return [];
      const wanted = requested[key];
      if (wanted === undefined || wanted === null || wanted === '') return [];
      return result[key] === true ? [] : [label];
    });
    return {
      ok: missing.length === 0,
      missing,
      error: missing.length ? `Pavo 官网页面没有应用这些参数：${missing.join('、')}` : '',
    };
  }

  function comparableMediaUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      const url = new URL(text);
      ['x-oss-expires', 'x-oss-signature', 'x-oss-credential', 'signature', 'token'].forEach(key => {
        url.searchParams.delete(key);
      });
      return `${url.origin}${url.pathname}`;
    } catch {
      return text;
    }
  }

  function isLikelyGeneratedMediaUrl(value, mediaTypeValue) {
    try {
      const url = new URL(String(value || '').trim());
      if (!['https:', 'blob:'].includes(url.protocol)) return false;
      const path = url.pathname.toLowerCase();
      return normalizeMediaType(mediaTypeValue) === 'image'
        ? /\.(png|jpe?g|webp)(?:$|[/?#])/.test(path) || /image|asset|output|result/.test(path)
        : /\.(mp4|mov|webm)(?:$|[/?#])/.test(path) || /video|asset|output|result/.test(path);
    } catch {
      return String(value || '').startsWith('blob:');
    }
  }

  function pickNewOutputUrls(baselineValue, currentValue, mediaTypeValue = 'video') {
    const baseline = new Set((Array.isArray(baselineValue) ? baselineValue : []).map(comparableMediaUrl).filter(Boolean));
    const seen = new Set();
    return (Array.isArray(currentValue) ? currentValue : [])
      .map(value => String(value || '').trim())
      .filter(value => {
        const comparable = comparableMediaUrl(value);
        if (!value || !comparable || baseline.has(comparable) || seen.has(comparable)) return false;
        if (!isLikelyGeneratedMediaUrl(value, mediaTypeValue)) return false;
        seen.add(comparable);
        return true;
      });
  }

  function pickNewOutputUrl(baselineValue, currentValue, mediaTypeValue) {
    return pickNewOutputUrls(baselineValue, currentValue, mediaTypeValue)[0] || '';
  }

  function pickNewImageOutputCandidates(baselineValue, currentValue) {
    return pickNewOutputUrls(baselineValue, currentValue, 'image');
  }

  function selectExpectedImageOutputs(baselineValue, currentValue, expectedValue = 1) {
    const expected = Math.max(1, Math.min(8, Number(expectedValue) || 1));
    const selected = pickNewImageOutputCandidates(baselineValue, currentValue);
    return selected.length >= expected ? selected.slice(0, expected) : [];
  }

  function activateElementOnce(element) {
    if (!element || typeof element.click !== 'function') throw new Error('可点击元素无效');
    element.click();
    return 'native-click';
  }

  function isTaskSubmissionLocked(taskValue) {
    const task = taskValue && typeof taskValue === 'object' ? taskValue : {};
    return Boolean(task.submitClaimedAt || task.submittedAt || task.submitClaimId || task.legacySubmissionUnsafe === true);
  }

  function isRecoverableWorkbenchError(errorValue) {
    const message = String(errorValue?.message || errorValue || '');
    return /Receiving end does not exist|Could not establish connection|message (?:port|channel) closed|No tab with id|Pavo 页面尚未就绪|工作台消息等待超时|正在处理其他任务/i.test(message);
  }

  function canReloadWorkbenchBeforeSubmit(reloadCountValue, maxReloadsValue = 1) {
    return Math.max(0, Number(reloadCountValue) || 0) < Math.max(0, Number(maxReloadsValue) || 0);
  }

  function nextWorkbenchRecoveryAction(inputValue) {
    const input = inputValue && typeof inputValue === 'object' ? inputValue : {};
    if (input.recoverable !== true) return 'fail';
    if (Math.max(0, Number(input.setupAttempt) || 0) === 0 && input.idleReady === true) return 'retry';
    return canReloadWorkbenchBeforeSubmit(input.reloadCount) ? 'reload' : 'fail';
  }

  function shouldContinueZeroCostImageBatch() { return false; }
  function shouldContinueZeroCostImageBatchForTask() { return false; }
  function classifyImageBatchProgress(inputValue) {
    const input = inputValue && typeof inputValue === 'object' ? inputValue : {};
    return Number(input.candidateCount || 0) >= Math.max(1, Number(input.expected || 1)) ? 'completed' : 'generating';
  }
  function quotaFailureMessageFromText(value) {
    return /积分不足|余额不足|额度不足|次数不足/.test(String(value || '')) ? 'Pavo 账号积分或可用额度不足' : '';
  }
  function isOriginalPavoImageUrl(value) { return isLikelyGeneratedMediaUrl(value, 'image'); }

  return {
    PAGE_URLS,
    normalizeMediaType,
    taskMediaType,
    pageUrlForMediaType,
    isPageForMediaType,
    officialModels,
    modelLabelForTask,
    isOutputSettingsTriggerText,
    outputSettingTextContains,
    exactSettingTextMatches,
    aspectRatioFromOutputSettingsText,
    generationCountFromOutputSettingsText,
    mediaLabel,
    pageInfoReadyForMediaType,
    extensionFromMime,
    validateAppliedPreset,
    comparableMediaUrl,
    isLikelyGeneratedMediaUrl,
    isOriginalPavoImageUrl,
    pickNewOutputUrls,
    pickNewOutputUrl,
    pickNewImageOutputCandidates,
    selectExpectedImageOutputs,
    shouldContinueZeroCostImageBatch,
    shouldContinueZeroCostImageBatchForTask,
    classifyImageBatchProgress,
    quotaFailureMessageFromText,
    activateElementOnce,
    isTaskSubmissionLocked,
    isRecoverableWorkbenchError,
    canReloadWorkbenchBeforeSubmit,
    nextWorkbenchRecoveryAction,
  };
});
