(function initPavoContent() {
  'use strict';

  if (globalThis.__pavoAdapterLoaded) {
    let alive = false;
    try { alive = globalThis.__pavoAdapterIsAlive?.() === true; } catch { alive = false; }
    if (alive) return;
    var previousDrawerOpen = false;
    try {
      const previousDrawer = document.getElementById('pavo-adapter-drawer');
      previousDrawerOpen = previousDrawer?.style.transform === 'translateX(0)';
      globalThis.__pavoAdapterTeardown?.();
    } catch { /* 旧实例已失效 */ }
  }
  globalThis.__pavoAdapterLoaded = true;
  globalThis.__pavoAdapterIsAlive = () => {
    try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
  };

  const media = globalThis.PavoMedia;
  const SUBMITTED_KEY = 'pavoSubmittedTaskCodes';
  let processing = false;
  let drawerOpen = false;
  let drawer = null;
  let drawerButton = null;
  let lastOptionDebug = '';
  let preparedSnapshot = null;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const textOf = element => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();

  function candidates(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(visible);
  }

  function findPromptEditor() {
    const textareas = candidates('textarea');
    const preferred = textareas.find(element => /输入|描述|提示|prompt|创作/i.test(
      `${element.placeholder || ''} ${element.getAttribute('aria-label') || ''}`,
    ));
    if (preferred) return preferred;
    if (textareas[0]) return textareas[0];
    return candidates('[contenteditable="true"], [role="textbox"]')
      .find(element => !element.closest('#pavo-adapter-drawer')) || null;
  }

  function submitButtonCandidates() {
    return candidates('button, [role="button"]')
      .filter(element => !element.closest('#pavo-adapter-drawer'))
      .filter(element => /发送|生成|创作|提交|send|generate/i.test(
        `${textOf(element)} ${element.getAttribute('aria-label') || ''} ${element.title || ''}`,
      ))
      .slice(0, 8)
      .map(element => `[${textOf(element).slice(0, 12) || '(图标钮)'}]disabled=${element.disabled === true}aria=${element.getAttribute('aria-disabled') || '无'}<${element.tagName.toLowerCase()} class="${String(element.className).slice(0, 30)}">`);
  }

  function findSubmitButton() {
    const exact = value => /^(发送|生成|创作|提交|send|generate|create|submit)$/i.test(String(value || '').trim());
    const buttons = candidates('button, [role="button"]').filter(element => !element.closest('#pavo-adapter-drawer'));
    let root = findPromptEditor();
    // The upload row and submit row are siblings inside the composer shell.
    for (let depth = 0; root && root !== document.body && depth < 8; depth += 1, root = root.parentElement) {
      if (!root.querySelector('input[type="file"]')) continue;
      const elements = buttons.filter(element => root.contains(element));
      // Accessible identity is independent of button content, which may only show a credit price.
      const named = elements.filter(element => exact(element.getAttribute('aria-label')) || exact(element.title));
      const matches = named.length ? named : elements.filter(element => exact(textOf(element)));
      if (!matches.length) continue;
      const enabled = matches.filter(element => !(element.disabled || element.getAttribute('aria-disabled') === 'true'));
      return enabled.length === 1 ? enabled[0] : matches.length === 1 ? matches[0] : null;
    }
    return null;
  }

  function currentMediaType() {
    const active = candidates('[role="tab"][aria-selected="true"], [data-state="active"], .active')
      .map(textOf).join(' ');
    if (/图片|image/i.test(active) && !/视频|video/i.test(active)) return 'image';
    return 'video';
  }

  function getPageInfo() {
    const editor = findPromptEditor();
    const submit = findSubmitButton();
    return {
      hostname: location.hostname,
      url: location.href,
      title: document.title,
      mediaType: currentMediaType(),
      hasPromptEditor: Boolean(editor),
      hasSubmitButton: Boolean(submit),
      submitDisabled: Boolean(submit?.disabled || submit?.getAttribute('aria-disabled') === 'true'),
      fileInputCount: document.querySelectorAll('input[type="file"]').length,
      comboboxCount: candidates('[role="combobox"], select').length,
    };
  }

  function setNativeValue(element, value) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    element.focus();
    element.textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }

  async function setPrompt(prompt) {
    const editor = findPromptEditor();
    if (!editor) throw new Error('Pavo 页面尚未就绪：找不到提示词输入框');
    setNativeValue(editor, String(prompt || ''));
    await sleep(200);
    const actual = editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement
      ? editor.value
      : textOf(editor);
    if (!norm(actual).includes(norm(String(prompt || '')).slice(0, 20))) {
      throw new Error('Pavo 提示词填写后回读不一致');
    }
    return actual;
  }

  function selectControls() {
    const seen = new Set();
    return candidates('[role="combobox"], select, button[aria-haspopup="listbox"], button[aria-haspopup="menu"]')
      .filter(element => !element.closest('#pavo-adapter-drawer'))
      .map(element => {
        const root = element.closest('.ant-select') || element;
        const key = root instanceof Element ? root : element;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          root: key,
          trigger: key.querySelector?.('.ant-select-selector') || element,
        };
      })
      .filter(Boolean);
  }

  function modelTextControls() {
    return candidates('div, span, button, li, p')
      .filter(element => !element.children.length)
      .filter(element => visible(element))
      .filter(element => /agnes|video\s*2\.5|模型/i.test(textOf(element)))
      .filter(element => textOf(element).length <= 60)
      .filter(element => !element.closest('#pavo-adapter-drawer'))
      .map(element => {
        const root = element.closest('.ant-select, button, [role="button"], [role="combobox"]');
        return { root, trigger: root };
      })
      .filter(control => control.root && !control.root.closest('.ant-select-dropdown, [role="listbox"], [role="menu"]'));
  }

  async function dismissTransientOverlays() {
    const close = candidates('button, [role="button"]')
      .find(element => /close promotion|关闭活动|关闭推广/i.test(
        `${textOf(element)} ${element.getAttribute('aria-label') || ''} ${element.title || ''}`,
      ));
    if (!close) return;
    close.click();
    await sleep(200);
  }

  async function waitForDropdownOption(wanted, timeoutMs, control, labels = [wanted]) {
    const deadline = Date.now() + timeoutMs;
    const isMatch = element => {
      const label = textOf(element);
      return Boolean(label) && labels.some(value => norm(label) === norm(value));
    };
    while (Date.now() < deadline) {
      const owner = control?.root.querySelector('[aria-controls]') || control?.trigger;
      const ids = String(owner?.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
      const owned = ids.map(id => document.getElementById(id)).filter(Boolean)
        .map(element => element.closest('.ant-select-dropdown, [role="listbox"], [role="menu"]') || element)
        .find(visible);
      const popup = owned;
      if (popup) {
        const option = Array.from(popup.querySelectorAll('[role="option"], [role="menuitem"], li, button'))
          .find(element => visible(element) && isMatch(element));
        if (option) return option;
      }
      await sleep(150);
    }
    return null;
  }

  function popupDebugText() {
    const popups = candidates('.ant-select-dropdown, [role="listbox"], [role="menu"], .ant-popover, [role="tooltip"]');
    if (!popups.length) return '无弹层';
    return popups.map(popup => `弹层[${textOf(popup).replace(/\s+/g, ' ').slice(0, 60)}]`).join(';');
  }

  function controlDebugText(control) {
    if (!control?.root) return '';
    const tag = control.root.tagName ? control.root.tagName.toLowerCase() : '';
    const className = String(control.root.className || '').slice(0, 40);
    return `<${tag} class="${className}">`;
  }

  function controlLabel(control) {
    if (control?.root.tagName === 'SELECT') return textOf(control.root.selectedOptions[0]);
    return textOf(control?.root.querySelector('.ant-select-selection-item') || control?.root);
  }

  function semanticControl(wanted, hints) {
    const seen = new Set();
    const controls = [...selectControls(), ...modelTextControls()]
      .filter(control => !/(?:^|\s)ant-select-(?:loading|disabled)(?:\s|$)/.test(String(control.root.className))
        && control.root.getAttribute('aria-disabled') !== 'true')
      .filter(control => {
        if (seen.has(control.root)) return false;
        seen.add(control.root);
        const label = control.root.getAttribute('aria-label') || control.root.getAttribute('title');
        return hints.some(hint => hint.test(label || controlLabel(control)));
      });
    return controls.length === 1 ? controls[0] : null;
  }

  async function chooseOption(target, hints, labels = [target]) {
    const wanted = String(target || '').trim();
    if (!wanted) return true;
    const matches = value => labels.some(label => norm(value) === norm(label));

    const readyDeadline = Date.now() + 8_000;
    let control = semanticControl(wanted, hints);
    while (!control && Date.now() < readyDeadline) {
      await sleep(150);
      control = semanticControl(wanted, hints);
    }
    if (!control) {
      lastOptionDebug = `目标[${wanted}]未找到匹配控件；页面文本控件[${modelTextControls().slice(0, 6)
        .map(c => `${textOf(c.root).slice(0, 30)}${controlDebugText(c)}`).join('|') || '无'}]`;
      return false;
    }
    if (matches(controlLabel(control))) return true;
    if (control.root.tagName === 'SELECT') {
      const option = Array.from(control.root.options).find(item => matches(item.textContent));
      if (!option) return false;
      control.root.value = option.value;
      control.root.dispatchEvent(new Event('input', { bubbles: true }));
      control.root.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(200);
      return matches(controlLabel(semanticControl(wanted, hints)));
    }

    const openStrategies = [
      () => control.trigger.click(),
      () => {
        control.trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        control.trigger.click();
      },
      () => {
        try { control.trigger.focus?.(); } catch { /* 非可聚焦元素 */ }
        control.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        control.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      },
    ];

    for (let attempt = 0; attempt < openStrategies.length; attempt += 1) {
      control = semanticControl(wanted, hints);
      if (!control) return false;
      if (matches(controlLabel(control))) return true;
      openStrategies[attempt]();
      const option = await waitForDropdownOption(wanted, 2_000, control, labels);
      if (!option) {
        lastOptionDebug = `目标[${wanted}]控件[${textOf(control.root).slice(0, 30)}]${controlDebugText(control)}未开出选项；${popupDebugText()}；页面模式字样[${modeTextLeaves().join('|')}]`;
        document.body.click();
        control.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await sleep(400);
        continue;
      }
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const clickable = option.closest('button, [role="option"], [role="menuitem"], li') || option;
      clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      clickable.click();
      await sleep(400);
      const applied = matches(controlLabel(semanticControl(wanted, hints)));
      if (applied) {
        lastOptionDebug = '';
        return true;
      }
    }
    lastOptionDebug = lastOptionDebug || `目标[${wanted}]控件[${textOf(control.root).slice(0, 30)}]点击后回读失败`;
    return false;
  }

  function modeTextLeaves() {
    return candidates('div, span, li, button, p, label')
      .filter(element => !element.children.length && /首帧|首尾帧|尾帧|全能模式|参考模式/.test(textOf(element)))
      .slice(0, 12)
      .map(element => `${element.tagName.toLowerCase()}:${textOf(element).slice(0, 16)}`);
  }

  function outputSettingsContainer() {
    const trigger = document.querySelector('.intelli-input-settings, #dle_setting');
    if (!trigger || !visible(trigger)) return null;
    const ids = ['aria-describedby', 'aria-controls'].flatMap(attribute =>
      String(trigger.getAttribute(attribute) || '').split(/\s+/).filter(Boolean));
    const owned = [...new Set(ids.map(id => document.getElementById(id)).filter(Boolean))]
      .filter(element => visible(element) && !element.closest('#pavo-adapter-drawer'));
    return owned.length === 1 ? owned[0] : null;
  }

  function outputSummaryMatches(wanted) {
    const trigger = document.querySelector('.intelli-input-settings, #dle_setting');
    if (!trigger || !visible(trigger)) return false;
    const normalize = value => norm(value).replace(/秒$/, 's');
    const values = Array.from(trigger.querySelectorAll('span')).filter(element => !element.children.length).map(textOf);
    return [...values, ...textOf(trigger).split(/\s+/)].some(value => normalize(value) === normalize(wanted));
  }

  async function openOutputSettings() {
    let container = outputSettingsContainer();
    if (container) return container;
    const deadline = Date.now() + 8_000;
    let trigger;
    while (Date.now() < deadline) {
      trigger = document.querySelector('.intelli-input-settings, #dle_setting');
      if (trigger && visible(trigger)) break;
      await sleep(150);
    }
    if (!trigger || !visible(trigger)) return null;
    trigger.click();
    const popupDeadline = Date.now() + 3_000;
    while (!container && Date.now() < popupDeadline) {
      await sleep(150);
      container = outputSettingsContainer();
    }
    return container;
  }

  async function chooseOutputSetting(target) {
    const wanted = String(target || '').trim();
    if (!wanted) return true;
    if (outputSummaryMatches(wanted)) return true;
    if (!await openOutputSettings()) return false;
    const duration = wanted.match(/^(\d+)\s*(?:s|秒)$/i);
    // A popup shell can mount before its controls; bind and re-read the live owner on every probe.
    const deadline = Date.now() + 3_000;
    let choice = null;
    while (!choice && Date.now() < deadline) {
      if (outputSummaryMatches(wanted)) return true;
      const container = outputSettingsContainer();
      if (container) {
        choice = duration && Array.from(container.querySelectorAll('input'))
          .filter(element => visible(element) && /时长|\bduration\b/i.test(element.getAttribute('aria-label') || ''))
          .sort((a, b) => Number(a.getAttribute('type') === 'range') - Number(b.getAttribute('type') === 'range'))[0];
        choice = choice || Array.from(container.querySelectorAll(
          'button, [role="button"], [role="radio"], [role="option"], label, input',
        )).filter(element => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true')
          .find(element => [textOf(element), element.getAttribute('aria-label'), element.getAttribute('value')]
            .some(value => norm(value) === norm(wanted)));
      }
      if (!choice) await sleep(150);
    }
    if (!choice) return false;
    if (duration && choice.tagName === 'INPUT') {
      const value = Number(duration[1]);
      const min = choice.getAttribute('min');
      const max = choice.getAttribute('max');
      if ((min !== null && value < Number(min)) || (max !== null && value > Number(max))) return false;
      choice.focus();
      setNativeValue(choice, String(value));
      choice.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      choice.blur?.();
    } else {
      const clickable = choice.closest('button, [role="button"], [role="radio"], [role="option"], label') || choice;
      clickable.click();
    }
    for (let check = 0; check < 10; check += 1) {
      await sleep(200);
      if (outputSummaryMatches(wanted)) return true;
    }
    return false;
  }

  function dumpSelectControls() {
    const native = candidates('select').map(select => `原生select[${Array.from(select.options)
      .slice(0, 10).map(option => norm(option.textContent)).filter(Boolean).join('|')}]`);
    const custom = selectControls().map((control, index) => `下拉${index}[${textOf(control.root).slice(0, 40)}]${controlDebugText(control)}`);
    const modelish = modelTextControls().slice(0, 6).map((control, index) => `疑似模型${index}[${textOf(control.root).slice(0, 40)}]${controlDebugText(control)}`);
    const parts = [...native, ...custom, ...modelish];
    if (lastOptionDebug) parts.push(`最近失败:${lastOptionDebug}`);
    return parts;
  }

  async function applyPreset(preset) {
    if (location.hostname !== 'app.pavo-ai.cn') throw new Error('当前不是 Pavo 页面');
    await dismissTransientOverlays();
    const result = {};
    if (preset.model) result.model = await chooseOption(preset.model, [/模型|model|agnes|seedance/i]);
    if (preset.referenceMode) {
      const modeLabels = ['全能模式', 'Omni Mode'];
      const labels = modeLabels.some(label => norm(label) === norm(preset.referenceMode)) ? modeLabels : [preset.referenceMode];
      result.referenceMode = await chooseOption(preset.referenceMode, [/模式|mode|全能|首帧|尾帧/i], labels);
    }
    if (preset.aspectRatio) result.aspectRatio = await chooseOutputSetting(preset.aspectRatio);
    if (preset.resolution) result.resolution = await chooseOutputSetting(preset.resolution);
    if (preset.duration) result.duration = await chooseOutputSetting(preset.duration);
    if (preset.count) result.count = true;
    return result;
  }

  function dataUrlFile(reference, index) {
    const dataUrl = String(reference.base64 || reference.data || '');
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) throw new Error(`第 ${index + 1} 个参考素材不是有效 data URL`);
    const bytes = atob(match[2]);
    const array = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
    return new File([array], reference.fileName || reference.name || `reference-${index + 1}`, {
      type: reference.fileType || reference.type || match[1],
    });
  }

  function composerRoot() {
    let root = findPromptEditor();
    for (let depth = 0; root && depth < 7; depth += 1, root = root.parentElement) {
      if (root.querySelector('input[type="file"]')) return root;
    }
    throw new Error('Pavo 当前输入区的素材入口归属不明确，未提交');
  }

  function composerReferences() {
    const root = composerRoot();
    return {
      images: Array.from(root.querySelectorAll('.group img[alt]')).filter(img => img.getAttribute('alt')),
      busy: root.querySelectorAll('.anticon-loading, [aria-busy="true"], [role="progressbar"], .ant-upload-list-item-uploading').length > 0,
    };
  }

  async function uploadReferences(references) {
    const expected = Array.isArray(references) ? references : [];
    const initial = composerReferences();
    if (initial.images.length || initial.busy) throw new Error('Pavo 当前控制台残留参考素材，请先创建新对话');
    if (!expected.length) return { uploaded: 0, referencesVerified: true };
    if (expected.some(ref => !String(ref.fileType || ref.type || '').startsWith('image/'))) {
      throw new Error('当前网页附件验收仅支持图片，音频附件需单独验证后开放');
    }
    const inputs = Array.from(composerRoot().querySelectorAll('input[type="file"]'));
    if (inputs.length !== 1) throw new Error('Pavo 当前输入区的素材上传入口不唯一');
    const input = inputs[0];
    const transfer = new DataTransfer();
    const files = expected.map(dataUrlFile);
    files.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const deadline = Date.now() + 90_000;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const current = composerReferences();
      const verified = !current.busy && current.images.length === files.length
        && current.images.every((img, index) => img.getAttribute('alt') === files[index].name
          && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
      if (verified) {
        stableSince ||= Date.now();
        if (Date.now() - stableSince >= 1_000) return { uploaded: files.length, referencesVerified: true,
          referenceNames: files.map(file => file.name) };
      } else stableSince = 0;
      await sleep(250);
    }
    throw new Error('Pavo 参考素材未完成上传或网页附件身份/顺序不符，未点击生成');
  }

  async function doGenerate(message) {
    if (processing) throw new Error('正在处理其他任务');
    processing = true;
    preparedSnapshot = null;
    try {
      const uploaded = await uploadReferences(message.fileReferences || []);
      const currentText = await setPrompt(message.prompt || '');
      preparedSnapshot = { prompt: String(message.prompt || ''), referenceNames: uploaded.referenceNames || [] };
      return { ...uploaded, currentText };
    } finally {
      processing = false;
    }
  }

  function verifyPreparedTask(message) {
    const editor = findPromptEditor();
    const actual = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
      ? editor.value : String(editor?.textContent || '');
    const expectedNames = message.referenceNames;
    const current = composerReferences();
    if (!Array.isArray(expectedNames) || actual !== String(message.prompt || '') || current.busy
      || current.images.length !== expectedNames.length
      || current.images.some((img, index) => img.getAttribute('alt') !== expectedNames[index]
        || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0)) {
      throw new Error('Pavo 提交前提示词或参考素材已改变，未点击生成');
    }
    return { promptVerified: true, referencesVerified: true, uploaded: expectedNames.length, referenceNames: expectedNames,
      preparedSnapshotVerified: Boolean(preparedSnapshot && preparedSnapshot.prompt === message.prompt
        && JSON.stringify(preparedSnapshot.referenceNames) === JSON.stringify(expectedNames)) };
  }

  function collectOutputMediaUrls(mediaTypeValue) {
    const mediaType = media.normalizeMediaType(mediaTypeValue);
    const urls = [];
    const add = value => {
      const url = String(value || '').trim();
      if (url && !urls.includes(url) && media.isLikelyGeneratedMediaUrl(url, mediaType)) urls.push(url);
    };
    if (mediaType === 'video') {
      candidates('video').forEach(element => {
        add(element.currentSrc);
        add(element.src);
        element.querySelectorAll('source').forEach(source => add(source.src));
      });
      candidates('a[href]').forEach(element => add(element.href));
    } else {
      candidates('img').forEach(element => {
        const rect = element.getBoundingClientRect();
        if (rect.width >= 128 && rect.height >= 128) add(element.currentSrc || element.src);
      });
    }
    return urls;
  }

  function currentConversationId() {
    const id = new URL(location.href).searchParams.get('conversationId') || '';
    return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : '';
  }

  function emptyComposer() {
    const editor = findPromptEditor();
    if (!editor) return false;
    const input = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement ? editor.value : textOf(editor);
    const refs = composerReferences();
    return !String(input || '').trim() && !refs.images.length && !refs.busy;
  }

  async function recoverComposer() {
    const exactLabel = element => /^(新作品|新对话|新建对话|New (?:Work|Chat|Conversation|Project))$/i.test(textOf(element));
    const named = candidates('[class~="group/newwork"]').filter(exactLabel);
    const targets = named.length ? named : candidates('button, [role="button"], a').filter(exactLabel);
    if (targets.length !== 1) throw new Error('Pavo 新对话入口不唯一或尚未加载，未刷新或继续提交');
    const before = currentConversationId();
    realClick(targets[0]);
    const deadline = Date.now() + 12_000;
    let stableSince = 0;
    while (Date.now() < deadline) {
      if (!currentConversationId() && new URL(location.href).pathname === '/chat' && emptyComposer()) {
        stableSince ||= Date.now();
        if (Date.now() - stableSince >= 750) {
          preparedSnapshot = null;
          return { recovered: 'new-conversation', freshConsoleConfirmed: true, previousConversationId: before };
        }
      } else stableSince = 0;
      await sleep(250);
    }
    throw new Error('Pavo 新对话未确认清空，保留原任务并暂停后续提交');
  }

  async function submittedCodes() {
    const stored = await chrome.storage.local.get([SUBMITTED_KEY]);
    return Array.isArray(stored[SUBMITTED_KEY]) ? stored[SUBMITTED_KEY].map(String) : [];
  }

  function realClick(element) {
    const rect = element.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    try {
      element.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
      element.dispatchEvent(new MouseEvent('mousedown', base));
      element.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
      element.dispatchEvent(new MouseEvent('mouseup', base));
    } catch { /* PointerEvent 不可用时降级为 click */ }
    element.click();
  }

  function pageGeneratingIndication() {
    if (/生成中|排队中|处理中|创作中|预计等待|队列中/.test(textOf(document.body))) return true;
    const button = findSubmitButton();
    return Boolean(button && (button.disabled === true || button.getAttribute('aria-disabled') === 'true'));
  }

  async function clickGenerate(message) {
    const taskCode = String(message?.taskCode || '').trim();
    if (!taskCode) throw new Error('缺少任务号，已拒绝点击生成');
    if (!navigator.locks?.request) throw new Error('浏览器缺少提交互斥锁，已拒绝付费生成');
    return navigator.locks.request('pavo-generate-once', async () => {
      const codes = await submittedCodes();
      if (codes.includes(taskCode)) throw new Error('该任务已进入提交状态，只允许继续查询结果');
      const deadline = Date.now() + 12_000;
      let button = null;
      while (Date.now() < deadline) {
        const candidate = findSubmitButton();
        if (candidate && candidate.disabled !== true && candidate.getAttribute('aria-disabled') !== 'true') {
          button = candidate;
          break;
        }
        await sleep(500);
      }
      if (!button) {
        throw new Error(`页面没有可用生成按钮｜按钮候选: ${submitButtonCandidates().join(' ／ ') || '无'}`);
      }
      if (!preparedSnapshot) throw new Error('Pavo 当前页没有本次任务的已验证输入，未点击生成');
      verifyPreparedTask(preparedSnapshot);
      // Persist before clicking. Unknown feedback must never authorize a second click.
      await chrome.storage.local.set({ [SUBMITTED_KEY]: [...codes, taskCode] });
      verifyPreparedTask(preparedSnapshot);
      realClick(button);
      await sleep(2_000);
      const current = findSubmitButton();
      const buttonGone = !current || current.disabled === true || current.getAttribute('aria-disabled') === 'true';
      const editorCleared = !findPromptEditor();
      return {
        submitted: true, taskCode, attempt: 1,
        confirmationObserved: pageGeneratingIndication() || buttonGone || editorCleared,
      };
    });
  }

  function pageFailureMessage() {
    const bodyText = textOf(document.body);
    if (/请登录|登录后|重新登录/.test(bodyText)) return 'Pavo 登录状态已失效';
    if (/积分不足|余额不足|额度不足|次数不足/.test(bodyText)) return 'Pavo 账号积分或可用额度不足';
    if (/生成失败|审核未通过|内容违规|任务失败/.test(bodyText)) return 'Pavo 页面显示生成失败或内容审核未通过';
    return '';
  }

  async function findMediaByTaskCode(taskCode, mediaTypeValue, baselineUrls, expectedResultCount, conversationId) {
    if (!conversationId) {
      return { found: false, status: 'awaiting_result', message: '结果查询需要已绑定的 conversationId，禁止按页面新媒体猜测', taskCode };
    }
    const { conversations } = await harvestAllConversations();
    const hit = conversations.find(conv => conv.cid === String(conversationId));
    if (!hit) return { found: false, status: 'awaiting_result', taskCode };
    if (/^(failed|failure|error)$/i.test(hit.status)) {
      return { found: true, status: 'failed', message: '绑定的原会话生成失败', taskCode };
    }
    const resultUrls = media.normalizeMediaType(mediaTypeValue) === 'image' ? hit.images : hit.videos;
    const complete = /^(completed|success|succeeded)$/i.test(hit.status) && resultUrls.length > 0;
    return {
      found: complete, status: complete ? 'completed' : 'generating', taskCode,
      videoUrl: complete ? resultUrls[0] : null,
      mediaUrls: complete ? resultUrls : [], conversationId: hit.cid,
    };
  }

  async function uploadMedia(message) {
    const mediaUrl = String(message.mediaUrl || '');
    if (!mediaUrl) throw new Error('缺少 Pavo 结果地址');
    if (!mediaUrl.startsWith('blob:')) {
      // 注意 action 必须放在 ...message 之后：message 自带 action=captureAndUploadMedia，
      // 放前面会被展开覆盖 → 后台不认 → 秒回 undefined（66连无声失败的根因）
      const relayed = await chrome.runtime.sendMessage({ ...message, action: 'fetchAndUploadMediaUrl' });
      if (!relayed || Number(relayed.uploaded || 0) < 1) {
        throw new Error((relayed && relayed.error) || '后台脚本未完成上传（应答为空或无 uploaded 字段）');
      }
      return relayed;
    }
    const response = await fetch(mediaUrl);
    if (!response.ok) throw new Error(`Pavo Blob 下载 HTTP ${response.status}`);
    const blob = await response.blob();
    const form = new FormData();
    const mediaType = message.mediaType === 'image' ? 'image' : 'video';
    const ext = media.extensionFromMime(blob.type, mediaType);
    const filename = `${message.taskCode}_${message.quality || 'original'}_${Date.now()}.${ext}`;
    form.append('file', blob, filename);
    form.append('taskCode', message.taskCode);
    form.append('quality', message.quality || 'original');
    form.append('mimeType', blob.type);
    form.append('originalUrl', mediaUrl);
    const serverUrl = String(message.serverUrl || '').replace(/\/$/, '');
    const uploaded = await fetch(`${serverUrl}/api/files/upload`, {
      method: 'POST',
      headers: message.apiToken ? { 'X-Nomi-Token': String(message.apiToken) } : {},
      body: form,
    });
    const result = await uploaded.json().catch(() => ({}));
    if (!uploaded.ok || !result.success) throw new Error(result.error || `本地上传 HTTP ${uploaded.status}`);
    return { success: true, uploaded: 1, fileId: result.fileId, filename };
  }

  const composerActions = new Set(['applyPreset', 'doGenerate', 'setPrompt', 'clickGenerate', 'verifyPreparedTask']);
  async function readPavoJson(response) {
    if (!response.ok) throw new Error(`Pavo 会话接口 HTTP ${response.status}`);
    const data = JSON.parse(await response.text(), (_key, value, context) => {
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        if (!context?.source || !/^-?\d+$/.test(context.source)) throw new Error('浏览器无法无损读取会话编号，已暂停收片');
        return context.source;
      }
      return value;
    });
    if (data?.code !== undefined && !['000000', 0, '0'].includes(data.code)) throw new Error('Pavo 会话接口拒绝请求，保留原任务等待查询');
    return data;
  }
  async function fetchConversationVideos(message) {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('页面未登录（localStorage 无 token），无法收片');
    const cid = String(message.conversationId || '').trim();
    if (!cid) throw new Error('缺少 conversationId');
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(cid)) throw new Error('会话编号无效');
    const response = await fetch(`https://api.pavo-ai.cn/api/v1/chat/conversation/history?conversation_id=${encodeURIComponent(cid)}`, {
      headers: { Authorization: 'Bearer ' + token, 'X-Platform': 'web' },
    });
    const body = await readPavoJson(response);
    const turns = body?.data?.turns;
    if (!Array.isArray(turns)) throw new Error('Pavo 会话历史结构不匹配，禁止猜测结果');
    const latest = turns.at(-1);
    const prompts = (latest?.user || []).filter(entry => entry.type === 'Message' && typeof entry.data?.content === 'string').map(entry => entry.data.content);
    const events = Array.isArray(latest?.assistant) ? latest.assistant : [];
    const lastStart = events.findLastIndex(entry => entry.type === 'GenerationStart');
    const generationEvents = events.slice(lastStart + 1);
    const candidate = generationEvents.filter(entry => ['GenerationSuccess', 'GenerationFailed'].includes(entry.type)).at(-1);
    const startedId = events[lastStart]?.data?.task_id;
    const terminal = typeof startedId === 'string' && startedId && candidate?.data?.task_id === startedId ? candidate : null;
    const running = body.data.is_running === true;
    const status = running ? 'processing' : terminal?.type === 'GenerationFailed' ? 'failed'
      : terminal?.type === 'GenerationSuccess' ? 'completed' : 'unknown';
    const error = terminal?.type === 'GenerationFailed' ? String(terminal.data?.error || '') : '';
    const failureCategory = /login|unauthori[sz]ed|authentication|登录/i.test(error) ? 'auth'
      : /quota|credits?|balance|rate.?limit|积分|额度|余额|限流/i.test(error) ? 'quota'
      : body.data.pending_review === true || /moderation|policy|safety|审核|违规/i.test(error) ? 'moderation'
      : /cancel|取消/i.test(error) ? 'cancelled'
      : status === 'failed' && generationEvents.slice(generationEvents.indexOf(terminal) + 1)
        .some(entry => entry.type === 'GenerationRetryAvailable') ? 'generation' : 'unknown';
    // Only the current turn's explicit success payload owns outputs. Earlier turns may contain unrelated media.
    const results = status === 'completed' && Array.isArray(terminal?.data?.data?.results) ? terminal.data.data.results : [];
    const urls = results.filter(result => result?.success !== false && typeof result?.url === 'string' && /^https:\/\//.test(result.url)).map(result => result.url);
    const videos = [...new Set(urls.filter(url => /\.mp4(?:[?#]|$)/i.test(url)))];
    const images = [...new Set(urls.filter(url => /\.(png|jpe?g|webp)(?:[?#]|$)/i.test(url)))];
    return { conversationId: cid, prompt: prompts.length === 1 ? prompts[0] : '', status,
      failureCategory, videos, images, count: videos.length, turnCount: turns.length };
  }

  async function getCurrentConversation() {
    const conversationId = currentConversationId();
    if (!conversationId) return { conversationId: '', prompt: '', status: 'unknown' };
    const result = await fetchConversationVideos({conversationId});
    if (currentConversationId() !== conversationId) throw new Error('查询期间当前会话已改变，暂停绑定');
    return result;
  }

  async function harvestAllConversations() {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('页面未登录（localStorage 无 token），无法收片');
    const auth = { Authorization: 'Bearer ' + token, 'X-Platform': 'web' };
    const out = [];
    const seen = new Set();
    for (let page = 1; page <= 100; page += 1) {
      const listRes = await fetch(`https://api.pavo-ai.cn/api/v1/chat/projects?page_size=100&page=${page}`, { headers: auth });
      const data = await readPavoJson(listRes);
      if (!Array.isArray(data?.data?.list)) throw new Error('会话列表结构不匹配，禁止猜测收片');
      const items = data.data.list;
      let added = 0;
      for (const item of items) {
        const d = item?.data || {};
        const cid = String(d.conversation_id || '');
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        added += 1;
        const visuals = Array.isArray(d.visuals) ? d.visuals : [];
        // 会话收割按媒体面分桶：视频=mp4、图片=png/jpg/webp。图片任务（mediaType=image）的结果
        // 只落在 images 桶，视频任务仍只看 videos 桶——两个桶互不串门，绑定判据（prompt 唯一）不变。
        const mediaUrlOf = visual => (typeof visual?.url === 'string' && /^https:\/\//.test(visual.url) ? visual.url : '');
        const videos = [...new Set(visuals.map(mediaUrlOf).filter(url => /\.mp4(?:[?#]|$)/i.test(url)))];
        const images = [...new Set(visuals.map(mediaUrlOf).filter(url => /\.(png|jpe?g|webp)(?:[?#]|$)/i.test(url)))];
        const prompts = [...new Set(visuals.map(visual => String(visual?.prompt || '')).filter(Boolean))];
        out.push({
          cid, createdAt: String(item?.created_at || ''), status: String(d.status || ''),
          videos, images, prompt: prompts.length === 1 ? prompts[0] : '',
        });
      }
      if (!items.length || (items.length < 100 && data.data.has_more !== true)) {
        return { conversations: out, complete: true };
      }
      if (!added) throw new Error('会话列表分页重复，无法建立完整基线');
    }
    throw new Error('会话列表超过安全分页上限，未建立完整基线');
  }

  const messageListener = (message, _sender, sendResponse) => {
    const respond = promise => {
      promise.then(value => sendResponse({ success: true, ...value }))
        .catch(error => sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    };
    if (message.action === 'clickGenerate' && !findSubmitButton()) {
      return false;
    }
    if (composerActions.has(message.action) && (window.top !== window || !findPromptEditor())) {
      return false;
    }
    // 收片动作只由顶层框架应答：iframe 里也有同源 localStorage，会重复拉取 60 个会话并抢答
    if ((message.action === 'harvestAllConversations' || message.action === 'fetchConversationVideos' || message.action === 'getCurrentConversation')
      && window.top !== window) {
      return false;
    }
    if (message.action === 'ping') {
      sendResponse({ success: true, ready: true, processing });
      return false;
    }
    if (message.action === 'getPageInfo') {
      if (window.top !== window) return false;
      sendResponse({ success: true, info: getPageInfo() });
      return false;
    }
    if (message.action === 'applyPreset') return respond(applyPreset(message.preset || {}).then(result => ({ result })));
    if (message.action === 'dumpSelectControls') {
      return respond(Promise.resolve().then(() => ({ controls: dumpSelectControls() })));
    }
    if (message.action === 'doGenerate') return respond(doGenerate(message));
    if (message.action === 'verifyPreparedTask') return respond(Promise.resolve().then(() => verifyPreparedTask(message)));
    if (message.action === 'recoverComposer') {
      if (window.top !== window) return false;
      return respond(recoverComposer());
    }
    if (message.action === 'setPrompt') return respond(setPrompt(message.prompt || '').then(currentText => ({ currentText })));
    if (message.action === 'snapshotMediaOutputs') {
      sendResponse({ success: true, urls: collectOutputMediaUrls(message.mediaType) });
      return false;
    }
    if (message.action === 'clickGenerate') return respond(clickGenerate(message).then(detail => ({ detail })));
    if (message.action === 'findMediaByTaskCode' || message.action === 'findVideoByTaskCode') {
      return respond(findMediaByTaskCode(
        message.taskCode,
        message.action === 'findVideoByTaskCode' ? 'video' : message.mediaType,
        message.baselineUrls,
        message.expectedResultCount,
        message.conversationId,
      ));
    }
    if (message.action === 'fetchConversationVideos') return respond(fetchConversationVideos(message));
    if (message.action === 'getCurrentConversation') return respond(getCurrentConversation());
    if (message.action === 'harvestAllConversations') return respond(harvestAllConversations());
    if (message.action === 'captureAndUploadMedia' || message.action === 'captureAndUpload') {
      return respond(uploadMedia({ ...message, mediaType: message.mediaType || 'video' }));
    }
    if (message.action === 'resolveOriginalImageUrl') {
      sendResponse({ success: true, originalUrl: message.previewUrl || '' });
      return false;
    }
    if (message.action === 'triggerUpscale') {
      sendResponse({ success: true, triggered: false, alreadyHD: true });
      return false;
    }
    if (message.action === 'toggleDrawer') {
      toggleDrawer();
      sendResponse({ success: true, open: drawerOpen });
      return false;
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(messageListener);
  globalThis.__pavoAdapterTeardown = () => {
    try { chrome.runtime.onMessage.removeListener(messageListener); } catch { /* 上下文已失效 */ }
    try { document.getElementById('pavo-adapter-drawer')?.remove(); } catch { /* 忽略 */ }
    try { document.getElementById('pavo-adapter-toggle')?.remove(); } catch { /* 忽略 */ }
  };

  function ensureDrawer() {
    if (drawer) return;
    drawer = document.createElement('aside');
    drawer.id = 'pavo-adapter-drawer';
    Object.assign(drawer.style, {
      position: 'fixed', top: '0', right: '0', width: '380px', height: '100vh', zIndex: '2147483647',
      transform: 'translateX(100%)', transition: 'transform 180ms ease', background: '#111',
      boxShadow: '-8px 0 32px rgba(0,0,0,.28)',
    });
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('panel.html');
    iframe.title = 'Pavo Web Automation Adapter';
    Object.assign(iframe.style, { width: '100%', height: '100%', border: '0', background: '#111' });
    drawer.appendChild(iframe);
    document.body.appendChild(drawer);

    drawerButton = document.createElement('button');
    drawerButton.id = 'pavo-adapter-toggle';
    drawerButton.type = 'button';
    drawerButton.textContent = 'P';
    drawerButton.title = 'Pavo Adapter';
    Object.assign(drawerButton.style, {
      position: 'fixed', right: '0', top: '50%', transform: 'translateY(-50%)', width: '36px', height: '56px',
      zIndex: '2147483646', border: '0', borderRadius: '6px 0 0 6px', background: '#1f78ff', color: '#fff',
      font: '600 14px system-ui', cursor: 'pointer',
    });
    drawerButton.addEventListener('click', toggleDrawer);
    document.body.appendChild(drawerButton);
    window.addEventListener('message', event => {
      if (event.data?.type === 'PAVO_DRAWER_CLOSE') closeDrawer();
    });
  }

  function openDrawer() {
    ensureDrawer();
    drawerOpen = true;
    drawer.style.transform = 'translateX(0)';
    drawerButton.style.right = '380px';
    drawerButton.textContent = '×';
  }

  function closeDrawer() {
    if (!drawer) return;
    drawerOpen = false;
    drawer.style.transform = 'translateX(100%)';
    drawerButton.style.right = '0';
    drawerButton.textContent = 'P';
  }

  function toggleDrawer() {
    if (drawerOpen) closeDrawer();
    else openDrawer();
  }

  ensureDrawer();
  if (typeof previousDrawerOpen === 'boolean' && previousDrawerOpen) openDrawer();
})();
