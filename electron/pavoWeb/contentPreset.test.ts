import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = fs.readFileSync(path.join(process.cwd(), 'integrations/pavo-web-adapter/content.js'), 'utf8');
const target = 'Agnes Video 2.5 Flash';
type PresetReply = { success: boolean; result: Record<string, boolean>; error?: string };
type FetchReply = { ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> };

class ElementFixture {
  children: ElementFixture[] = [];
  parent: ElementFixture | null = null;
  get parentElement() { return this.parent; }
  style = {};
  className = '';
  id = '';
  attributes: Record<string, string> = {};
  files?: File[];
  private currentValue = '';
  get value() { return this.currentValue; }
  set value(value: string) { this.currentValue = value; }
  trigger?: ElementFixture;
  click = vi.fn();
  dispatchEvent = vi.fn();
  constructor(public tagName = 'DIV', public innerText = '') {}
  get textContent() { return this.innerText; }
  set textContent(value: string) { this.innerText = value; }
  appendChild(child: ElementFixture) { this.children.push(child); child.parent = this; }
  getAttribute(name: string) { return this.attributes[name] || null; }
  getBoundingClientRect() { return { width: 100, height: 30 }; }
  addEventListener() {}
  focus() {}
  matches(selector: string): boolean {
    return selector.split(',').some(value => {
      const item = value.trim();
      const compound = item.match(/^([a-z]+)(\[[^\]]+\])$/i);
      if (compound) return this.tagName.toLowerCase() === compound[1].toLowerCase() && this.matches(compound[2]);
      const attribute = item.match(/^\[([\w-]+)(?:="([^"]+)")?\]$/);
      if (attribute) return attribute[2] ? this.attributes[attribute[1]] === attribute[2] : attribute[1] in this.attributes;
      return item === '*' || item.toLowerCase() === this.tagName.toLowerCase()
        || (item.startsWith('.') && this.className.split(/\s+/).includes(item.slice(1)))
        || (item === '[role="option"]' && this.attributes.role === 'option')
        || (item === '[role="button"]' && this.attributes.role === 'button')
        || (item === '[role="combobox"]' && this.attributes.role === 'combobox');
    });
  }
  closest(selector: string): ElementFixture | null {
    if (selector === '#pavo-adapter-drawer') return null;
    if (this.matches(selector)) return this;
    return this.parent?.closest(selector) || null;
  }
  querySelector(selector: string) {
    if (selector === '.ant-select-selector') return this.trigger || null;
    if (selector === '.ant-select-selection-item') return null;
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector: string): ElementFixture[] {
    return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child => child.matches(selector));
  }
  contains(element: ElementFixture): boolean { return element === this || this.children.some(child=>child.contains(element)); }
}

function content(childFrame = false) {
  vi.useFakeTimers();
  const body = new ElementFixture('BODY');
  const editor = new ElementFixture('TEXTAREA');
  const controls: ElementFixture[] = [];
  const options: ElementFixture[] = [];
  const selected: ElementFixture[] = [];
  const popup = new ElementFixture();
  popup.children = options;
  const submit = new ElementFixture('BUTTON', '生成');
  const location = { hostname: 'app.pavo-ai.cn', href: 'https://app.pavo-ai.cn/chat?conversationId=1234' };
  const newWork = new ElementFixture('DIV', '新作品');
  newWork.click.mockImplementation(() => { location.href = 'https://app.pavo-ai.cn/chat'; editor.value = ''; images = []; });
  const generationClicks = submit.click;
  const fetch = vi.fn(async (): Promise<FetchReply> => { throw new Error('Network forbidden in preset tests'); });
  let settingsButton: ElementFixture | null = null;
  let settingsPopup: ElementFixture | null = null;
  let settingsOpen = false;
  const unownedPopups: ElementFixture[] = [];
  const composer = new ElementFixture('DIV');
  composer.className = 'intelli-input';
  composer.appendChild(editor);
  const fileInput = new ElementFixture('INPUT');
  fileInput.attributes.type = 'file';
  composer.appendChild(fileInput);
  const composerShell = new ElementFixture('DIV');
  composerShell.appendChild(composer);
  composerShell.appendChild(submit);
  let attachmentState: 'ready' | 'busy' | 'absent' | 'stale' = 'ready';
  let images: ElementFixture[] = [];
  fileInput.dispatchEvent.mockImplementation((event: { type: string }) => {
    if (event.type !== 'change') return;
    images = attachmentState === 'absent' ? [] : Array.from(fileInput.files || []).map(file => {
      const image = Object.assign(new ElementFixture('IMG'), { complete: true, naturalWidth: 720, naturalHeight: 1280 });
      image.attributes.alt = attachmentState === 'stale' ? 'other.png' : file.name;
      return image;
    });
  });
  composer.querySelectorAll = selector => selector === '*' ? composer.children : selector === 'input[type="file"]' ? [fileInput] : selector === '.group img[alt]' ? images
    : selector.includes('anticon-loading') ? attachmentState === 'busy' ? [new ElementFixture()] : [] : [];
  let listener: (message: object, sender: object, respond: (reply: PresetReply) => void) => unknown;
  const document = {
    body,
    getElementById: (id: string) => {
      if (id === 'model-options') return popup;
      return id === 'output-settings' && settingsOpen ? settingsPopup : null;
    },
    createElement: (tag: string) => new ElementFixture(tag.toUpperCase()),
    querySelector: (selector: string) => selector.includes('.intelli-input-settings') ? settingsButton : null,
    querySelectorAll(selector: string) {
      if (selector === 'textarea') return [editor];
      if (selector === 'input[type="file"]') return [fileInput];
      if (selector === '[class~="group/newwork"]') return [newWork];
      if (selector === 'select') return controls.filter(control => control.tagName === 'SELECT');
      if (selector === 'button, [role="button"]') return [submit];
      if (selector === '[role="combobox"], select, button[aria-haspopup="listbox"], button[aria-haspopup="menu"]') {
        return controls.map(control => control.tagName === 'SELECT' ? control : control.trigger);
      }
      if (selector === '[aria-selected="true"], [data-state="checked"]') return selected;
      if (selector === '[role="tooltip"], .ant-popover') {
        return [...unownedPopups, ...(settingsOpen && settingsPopup ? [settingsPopup] : [])];
      }
      if (selector.startsWith('.ant-select-dropdown,')) return options.length ? [popup] : [];
      if (selector.startsWith('[role="option"],')) return options;
      return [];
    },
  };
  const frame: { top?: unknown; addEventListener: () => void } = { addEventListener() {} };
  frame.top = childFrame ? {} : frame;
  const context = vm.createContext({ document, Element: ElementFixture,
    HTMLTextAreaElement: ElementFixture, HTMLInputElement: ElementFixture,
    Event: class { constructor(public type: string) {} },
    InputEvent: class { constructor(public type: string) {} },
    MouseEvent: class { constructor(public type: string) {} },
    KeyboardEvent: class { constructor(public type: string) {} },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    location, URL, window: frame,
    chrome: { runtime: { id: 'fixture', getURL: (file: string) => `chrome-extension://fixture/${file}`,
      onMessage: { addListener: (callback: typeof listener) => { listener = callback; }, removeListener() {} } } },
    PavoMedia: {}, setTimeout, clearTimeout, Date, fetch,
    File, Uint8Array, atob, localStorage: { getItem: () => 'fixture-only' },
    DataTransfer: class { files: File[] = []; items = { add: (file: File) => this.files.push(file) }; },
  });
  vm.runInContext(source, context);
  function control(label: string, onClick?: () => void) {
    const root = new ElementFixture('DIV', label);
    root.className = 'ant-select';
    root.trigger = new ElementFixture('INPUT');
    root.trigger.attributes.role = 'combobox';
    root.trigger.attributes['aria-controls'] = 'model-options';
    root.appendChild(root.trigger);
    root.trigger.click.mockImplementation(onClick || (() => {}));
    return root;
  }
  function option(label: string, onClick: () => void) {
    const item = new ElementFixture('LI', label);
    item.attributes.role = 'option';
    item.click.mockImplementation(onClick);
    options.push(item);
    return item;
  }
  function nativeSelect() {
    const oldOption = new ElementFixture('OPTION', 'Agnes Video 2.5');
    oldOption.value = 'old';
    const newOption = new ElementFixture('OPTION', target);
    newOption.value = 'new';
    const root = Object.assign(new ElementFixture('SELECT'), { options: [oldOption, newOption] });
    root.attributes['aria-label'] = '模型';
    root.value = 'old';
    Object.defineProperty(root, 'selectedOptions', { get: () => root.options.filter(option => option.value === root.value) });
    return root;
  }
  async function applyPreset(preset: object) {
    const reply = new Promise<PresetReply>(resolve => listener({ action: 'applyPreset', preset }, {}, resolve));
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await reply;
    expect(fetch).not.toHaveBeenCalled();
    expect(generationClicks).not.toHaveBeenCalled();
    return result;
  }
  const apply = (model = target) => applyPreset({ model });
  function outputSettings(accept = true) {
    const ratio = new ElementFixture('SPAN', '16:9');
    const duration = new ElementFixture('SPAN', '4s');
    const resolution = new ElementFixture('SPAN', '720p');
    const button = new ElementFixture('BUTTON', '16:9 4s 720p');
    button.className = 'intelli-input-settings';
    button.attributes['aria-describedby'] = 'output-settings';
    button.children = [ratio, duration, resolution];
    const container = new ElementFixture('DIV', '比例 9:16 16:9 时长 分辨率 720P');
    container.id = 'output-settings';
    container.className = 'ant-popover-inner';
    container.attributes.role = 'tooltip';
    const ratioOption = new ElementFixture('BUTTON', '9:16');
    ratioOption.click.mockImplementation(() => { if (accept) ratio.innerText = '9:16'; });
    const resolutionOption = new ElementFixture('BUTTON', '720P');
    const durationInput = new ElementFixture('INPUT');
    durationInput.attributes = { 'aria-label': '时长', type: 'number', min: '2', max: '15' };
    durationInput.value = '4';
    durationInput.dispatchEvent.mockImplementation(event => {
      if (event.type === 'input' && accept) duration.innerText = durationInput.value + 's';
    });
    container.querySelectorAll = selector => selector === 'input' ? [durationInput]
      : selector.startsWith('[aria-checked') ? [] : [ratioOption, resolutionOption, durationInput];
    settingsPopup = container;
    button.click.mockImplementation(() => { settingsOpen = true; });
    settingsButton = button;
    return { ratio, duration, ratioOption, durationInput, container, button,
      close: () => { settingsOpen = false; } };
  }
  const dispatch = (message: object, respond: (reply: PresetReply) => void) => listener(message, {}, respond);
  async function prepare(state: typeof attachmentState) {
    attachmentState = state;
    const reply = new Promise<any>(resolve => listener({ action: 'doGenerate', prompt: 'reference motion',
      fileReferences: [{fileName:'reference-1.png',fileType:'image/png',base64:'data:image/png;base64,YQ=='}] }, {}, resolve));
    await vi.advanceTimersByTimeAsync(100_000);
    return reply;
  }
  async function harvest(raw: string) {
    fetch.mockResolvedValue({ok:true,json:async()=>JSON.parse(raw),text:async()=>raw});
    return new Promise<any>(resolve => listener({action:'harvestAllConversations'}, {}, resolve));
  }
  async function history(data: object) {
    const raw=JSON.stringify({code:'000000',data});
    fetch.mockResolvedValue({ok:true,json:async()=>JSON.parse(raw),text:async()=>raw});
    return new Promise<any>(resolve => listener({action:'getCurrentConversation'}, {}, resolve));
  }
  async function verifyPrepared() { return new Promise<any>(resolve=>listener({action:'verifyPreparedTask',prompt:'reference motion',referenceNames:['reference-1.png']},{},resolve)); }
  return { controls, options, selected, control, option, nativeSelect, apply, applyPreset, outputSettings, unownedPopups, dispatch, generationClicks, prepare, newWork, location, harvest, history, verifyPrepared, submit, clearAttachments:()=>{images=[];} };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('Pavo model preset control identity (zero submission)', () => {
  it.each(['发送','Send'])('finds the composer submit action named %s even when visible content is a price', async label => {
    const app=content();app.submit.innerText='0';app.submit.attributes['aria-label']=label;
    const reply=await new Promise<any>(resolve=>app.dispatch({action:'getPageInfo'},resolve));
    expect(reply.info.hasSubmitButton).toBe(true);
    expect(app.generationClicks).not.toHaveBeenCalled();
  });
  it('rejects reference loss after a successful preparation', async () => {
    const app=content();expect((await app.prepare('ready')).success).toBe(true);
    app.clearAttachments();expect((await app.verifyPrepared()).success).toBe(false);
  });
  it('reads only the current turn and never recycles earlier failure or media', async () => {
    const old={user:[{type:'Message',data:{content:'old'}}],assistant:[{type:'GenerationFailed',data:{error:'provider failed'}},{type:'GenerationRetryAvailable'}]};
    const current={user:[{type:'Message',data:{content:'current'}}],assistant:[{type:'GenerationStart',data:{task_id:'new'}}]};
    expect(await content().history({turns:[old,current],is_running:true})).toMatchObject({success:true,conversationId:'1234',prompt:'current',status:'processing',videos:[]});
  });
  it('does not authorize a later failure from an earlier retry-offer event', async () => {
    const reply=await content().history({is_running:false,turns:[{user:[{type:'Message',data:{content:'p'}}],assistant:[
      {type:'GenerationRetryAvailable'}, {type:'GenerationStart',data:{task_id:'second'}},
      {type:'GenerationFailed',data:{task_id:'second',error:'provider failed'}}]}]});
    expect(reply).toMatchObject({success:true,status:'failed',failureCategory:'unknown'});
  });
  it('requires the terminal provider task identity to match the latest start', async () => {
    const reply=await content().history({is_running:false,turns:[{user:[{type:'Message',data:{content:'p'}}],assistant:[
      {type:'GenerationStart',data:{task_id:'current'}}, {type:'GenerationFailed',data:{error:'failed'}},
      {type:'GenerationRetryAvailable'}]}]});
    expect(reply).toMatchObject({success:true,status:'unknown',failureCategory:'unknown',videos:[]});
  });
  it.each(['provider failed','insufficient credits'])('uses explicit current-turn retry evidence and classifies %s', async error => {
    const reply=await content().history({is_running:false,turns:[{user:[{type:'Message',data:{content:'p'}}],assistant:[
      {type:'GenerationStart',data:{task_id:'current'}}, {type:'GenerationFailed',data:{task_id:'current',error}},{type:'GenerationRetryAvailable'}]}]});
    expect(reply).toMatchObject({success:true,status:'failed',failureCategory:error.includes('credits')?'quota':'generation'});
  });
  it('preserves exact long numeric conversation identities instead of rounding IDs', async () => {
    const reply=await content().harvest('{"code":"000000","data":{"list":[{"data":{"conversation_id":371331365678886464,"status":"processing","visuals":[]}}]}}');
    expect(reply.conversations[0].cid).toBe('371331365678886464');
  });
  it.each([true, false])('only releases a console if the new conversation is actually empty (%s)', async changes => {
    const app = content();
    if (!changes) app.newWork.click.mockImplementation(() => {});
    const reply = new Promise<any>(resolve => app.dispatch({action:'recoverComposer'},resolve));
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await reply).success).toBe(changes);
    expect(app.newWork.click).toHaveBeenCalledTimes(1);
    expect(app.generationClicks).not.toHaveBeenCalled();
  });
  it.each(['busy', 'absent', 'stale'] as const)('does not accept selected files with %s website attachments', async state => {
    const app = content();
    expect((await app.prepare(state)).success).toBe(false);
    expect(app.generationClicks).not.toHaveBeenCalled();
  });
  it('verifies website attachment identity and upload completion', async () => {
    expect(await content().prepare('ready')).toMatchObject({success:true,uploaded:1,referencesVerified:true});
  });
  it('waits for model hydration without opening the media-type dropdown', async () => {
    const app = content();
    const type = app.control('视频生成');
    app.controls.push(type);
    setTimeout(() => app.controls.push(app.control(target)), 300);
    expect((await app.apply()).result.model).toBe(true);
    expect(type.trigger!.click).not.toHaveBeenCalled();
  });

  it('fails within a bounded wait when no semantic model control appears', async () => {
    const app = content();
    const type = app.control('视频生成');
    app.controls.push(type);
    expect((await app.apply()).result.model).toBe(false);
    expect(type.trigger!.click).not.toHaveBeenCalled();
  });

  it('recognizes an exact current model after a preceding media-type control', async () => {
    const app = content();
    const type = app.control('视频生成');
    const model = app.control(target);
    app.controls.push(type, model, app.control('全能模式'));
    expect((await app.apply()).result.model).toBe(true);
    expect(type.trigger!.click).not.toHaveBeenCalled();
    expect(model.trigger!.click).not.toHaveBeenCalled();
  });

  it('does not accept an unrelated globally selected target when the model did not change', async () => {
    const app = content();
    const model = app.control('Agnes Video 2.5');
    app.controls.push(model);
    app.option(target, () => app.selected.push(new ElementFixture('SPAN', target)));
    expect((await app.apply()).result.model).toBe(false);
    expect(model.innerText).toBe('Agnes Video 2.5');
  });

  it('reads the newly mounted model control after option selection', async () => {
    const app = content();
    app.controls.push(app.control('Agnes Video 2.5'));
    app.option(target, () => app.controls.splice(0, 1, app.control(target)));
    expect((await app.apply()).result.model).toBe(true);
  });

  it('does not treat a longer model name containing the target as an exact selection', async () => {
    const app = content();
    app.controls.push(app.control(`${target} Pro`));
    expect((await app.apply()).result.model).toBe(false);
  });

  it('does not click a longer popup option whose label only contains the target', async () => {
    const app = content();
    app.controls.push(app.control('Agnes Video 2.5'));
    const wrongOption = app.option(`${target} Pro`, () => {});
    expect((await app.apply()).result.model).toBe(false);
    expect(wrongOption.click).not.toHaveBeenCalled();
  });

  it('does not treat an explicitly unrelated dropdown value as the model selection', async () => {
    const app = content();
    const unrelated = app.control(target);
    unrelated.attributes['aria-label'] = '场景';
    const model = app.control('Agnes Video 2.5');
    app.controls.push(unrelated, model);
    app.option(target, () => { model.innerText = target; });
    expect((await app.apply()).result.model).toBe(true);
    expect(model.innerText).toBe(target);
  });

  it('checks the complete clickable option instead of an exact nested child label', async () => {
    const app = content();
    app.controls.push(app.control('Agnes Video 2.5'));
    const wrong = app.option(`${target} Pro`, () => {});
    wrong.appendChild(new ElementFixture('SPAN', target));
    expect((await app.apply()).result.model).toBe(false);
    expect(wrong.click).not.toHaveBeenCalled();
  });

  it('does not use an unowned popup even when it is the only visible popup', async () => {
    const app = content();
    const model = app.control('Agnes Video 2.5');
    delete model.trigger!.attributes['aria-controls'];
    app.controls.push(model);
    const unowned = app.option(target, () => { model.innerText = target; });
    expect((await app.apply()).result.model).toBe(false);
    expect(unowned.click).not.toHaveBeenCalled();
  });

  it('re-reads the current native select after a React replacement rejects the selection', async () => {
    const app = content();
    const old = app.nativeSelect();
    app.controls.push(old);
    old.dispatchEvent.mockImplementation(() => app.controls.splice(0, 1, app.nativeSelect()));
    expect((await app.apply()).result.model).toBe(false);
    expect(app.controls[0].value).toBe('old');
  });

  it('uses the same semantic boundary to change the reference mode', async () => {
    const app = content();
    const mode = app.control('首帧');
    app.controls.push(app.control(target), mode);
    app.option('全能模式', () => { mode.innerText = '全能模式'; });
    expect((await app.applyPreset({ referenceMode: '全能模式' })).result.referenceMode).toBe(true);
    expect(mode.innerText).toBe('全能模式');
  });

  it('recognizes the current Omni Mode as the Chinese reference-mode identity', async () => {
    const app = content();
    const mode = app.control('Omni Mode');
    mode.attributes['aria-label'] = 'Mode';
    app.controls.push(app.control(target), mode);
    expect((await app.applyPreset({ referenceMode: '全能模式' })).result.referenceMode).toBe(true);
    expect(mode.trigger!.click).not.toHaveBeenCalled();
  });

  it('selects an exact Omni Mode option for the Chinese reference-mode identity', async () => {
    const app = content();
    const model = app.control(target);
    const mode = app.control('First Frame');
    mode.attributes['aria-label'] = 'Mode';
    app.controls.push(model, mode);
    const omni = app.option('Omni Mode', () => { mode.innerText = 'Omni Mode'; });
    expect((await app.applyPreset({ referenceMode: '全能模式' })).result.referenceMode).toBe(true);
    expect(omni.click).toHaveBeenCalledTimes(1);
    expect(mode.innerText).toBe('Omni Mode');
    expect(model.innerText).toBe(target);
    expect(model.trigger!.click).not.toHaveBeenCalled();
  });

  it('does not apply reference-mode aliases to model identity', async () => {
    const app = content();
    const model = app.control('Omni Mode');
    model.attributes['aria-label'] = 'Model';
    app.controls.push(model);
    expect((await app.apply('全能模式')).result.model).toBe(false);
    expect(model.innerText).toBe('Omni Mode');
  });

  it('rejects composer broadcasts in a child with its own editor while the top frame answers', async () => {
    const top = content();
    top.controls.push(top.control(target));
    const child = content(true);
    child.controls.push(child.control(target));
    const topReply = vi.fn();
    const childReply = vi.fn();
    const message = { action: 'applyPreset', preset: { model: target } };
    expect(top.dispatch(message, topReply)).toBe(true);
    for (const action of ['applyPreset', 'doGenerate', 'setPrompt', 'clickGenerate']) {
      expect(child.dispatch({ ...message, action }, childReply)).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(20_000);
    expect(topReply).toHaveBeenCalledWith({ success: true, result: { model: true } });
    expect(childReply).not.toHaveBeenCalled();
    expect(top.generationClicks).not.toHaveBeenCalled();
    expect(child.generationClicks).not.toHaveBeenCalled();
  });
});

describe('Pavo current output settings DOM (zero submission)', () => {
  it('does not operate or accept an unrelated Project Settings popup', async () => {
    const app = content();
    const output = app.outputSettings(false);
    const unrelated = new ElementFixture('DIV', 'Project Settings');
    unrelated.className = 'ant-popover-inner';
    unrelated.attributes.role = 'tooltip';
    const wrongOption = new ElementFixture('BUTTON', '9:16');
    wrongOption.attributes['aria-selected'] = 'true';
    unrelated.appendChild(wrongOption);
    app.unownedPopups.push(unrelated);
    const reply = await app.applyPreset({ aspectRatio: '9:16' });
    expect.soft(wrongOption.click).not.toHaveBeenCalled();
    expect(reply.result.aspectRatio).toBe(false);
    expect(output.ratio.innerText).toBe('16:9');
  });

  it('waits for a ratio button mounted 300ms after the owned popup shell opens', async () => {
    const app = content();
    const output = app.outputSettings();
    let optionsReady = false;
    const query = output.container.querySelectorAll.bind(output.container);
    output.container.querySelectorAll = selector => optionsReady ? query(selector) : [];
    const open = output.button.click.getMockImplementation()!;
    output.button.click.mockImplementation(() => {
      open();
      setTimeout(() => { optionsReady = true; }, 300);
    });
    expect((await app.applyPreset({ aspectRatio: '9:16' })).result.aspectRatio).toBe(true);
    expect(optionsReady).toBe(true);
    expect(output.ratioOption.click).toHaveBeenCalledTimes(1);
    expect(output.ratio.innerText).toBe('9:16');
  });

  it('applies output settings with English website labels using the same settings boundary', async () => {
    const app = content();
    const output = app.outputSettings();
    output.container.innerText = 'Aspect Ratio 9:16 16:9 Duration Resolution 720P';
    output.durationInput.attributes['aria-label'] = 'Duration';
    const reply = await app.applyPreset({ aspectRatio: '9:16', duration: '5s' });
    expect(reply.result).toEqual({ aspectRatio: true, duration: true });
    expect(output.ratio.innerText).toBe('9:16');
    expect(output.duration.innerText).toBe('5s');
  });

  it('opens the semantic settings button and reads the updated ratio from the summary', async () => {
    const app = content();
    const output = app.outputSettings();
    expect((await app.applyPreset({ aspectRatio: '9:16' })).result.aspectRatio).toBe(true);
    expect(output.ratio.innerText).toBe('9:16');
    expect(output.ratioOption.click).toHaveBeenCalled();
  });

  it('sets the labeled numeric duration and accepts a current resolution without selected classes', async () => {
    const app = content();
    const output = app.outputSettings();
    const reply = await app.applyPreset({ resolution: '720P', duration: '5s' });
    expect(reply.result).toEqual({ resolution: true, duration: true });
    expect(output.durationInput.value).toBe('5');
    expect(output.duration.innerText).toBe('5s');
  });

  it('rejects an apparent click or input change when the page summary does not commit it', async () => {
    const app = content();
    const output = app.outputSettings(false);
    const reply = await app.applyPreset({ aspectRatio: '9:16', duration: '5s' });
    expect(reply.result).toEqual({ aspectRatio: false, duration: false });
    expect(output.ratio.innerText).toBe('16:9');
    expect(output.duration.innerText).toBe('4s');
  });

  it('rejects selection retained in an unmounted popup when the current summary did not commit it', async () => {
    const app = content();
    const output = app.outputSettings(false);
    const query = output.container.querySelectorAll.bind(output.container);
    output.container.querySelectorAll = selector => selector.startsWith('[aria-checked')
      ? [output.ratioOption] : query(selector);
    output.ratioOption.click.mockImplementation(output.close);
    expect((await app.applyPreset({ aspectRatio: '9:16' })).result.aspectRatio).toBe(false);
    expect(output.ratio.innerText).toBe('16:9');
  });
});
