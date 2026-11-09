import '../style.css';
import { button, el, field } from '../lib/ui';
import { clearUndo, DEFAULTS, saveSettings, settings } from '../lib/storage';
import { endpointOrigin } from '../lib/sanitize';
import type { Settings } from '../lib/types';
import { chatgptSettings } from './chatgpt';
import { defaultModel, loadModels, MODEL_PRESETS, OPENROUTER_URL, type ModelPreset } from './model-setup';

const app = document.querySelector<HTMLElement>('#app')!; app.className = 'options';
const status = el('div', undefined, 'status'); status.role = 'status'; status.setAttribute('aria-live', 'polite'); status.hidden = true;
const form = el('form'), provider = el('select'), base = el('input'), model = el('input'), key = el('input'), domains = el('textarea');
const titles = el('input'), pinned = el('input'), mergeDomains = el('input'), existing = el('select'), unassigned = el('select');
const notice = el('div', undefined, 'notice');
let value: Settings;
let chatgpt: ReturnType<typeof chatgptSettings>;
const traditional = el('div');
const guided = el('div', undefined, 'stack'), guidedIntro = el('div', undefined, 'stack'), manual = el('details');
const guidedHelp = el('p'), getKey = el('a'), guidedStatus = el('p', '', 'muted'), foundModels = el('select');
guidedStatus.setAttribute('role', 'status');
getKey.target = '_blank'; getKey.rel = 'noopener';
const foundModelsField = field('Available models', foundModels);
foundModelsField.hidden = true;
const connect = button('Connect and use', connectPreset, 'primary');
const keyField = field('API key', key, 'Stored in this browser profile. It is not synced.');
const baseField = field('Base URL', base);
const modelField = field('Model ID', model);

function selectedPreset(): ModelPreset | undefined {
  return Object.hasOwn(MODEL_PRESETS, provider.value) ? provider.value as ModelPreset : undefined;
}
function storedChoice(s: Settings): string {
  return s.provider === 'openai' && s.baseUrl.replace(/\/+$/, '') === OPENROUTER_URL ? 'openrouter' : s.provider;
}
function chosenBase(): string {
  const preset = selectedPreset();
  return preset === 'openrouter' || preset === 'anthropic' ? MODEL_PRESETS[preset].url : base.value.trim();
}
function clearModelChoices(): void {
  foundModels.replaceChildren(); foundModelsField.hidden = true; guidedStatus.textContent = '';
}
async function saveConnection(connection: Partial<Settings>): Promise<void> {
  const persisted = { ...await settings(), ...connection };
  await saveSettings(persisted);
  value = { ...persisted, presets: value.presets };
}
async function connectPreset(): Promise<void> {
  const preset = selectedPreset();
  if (!preset) return;
  const url = chosenBase(), apiKey = preset === 'ollama' ? '' : key.value.trim();
  connect.disabled = true;
  guidedStatus.textContent = 'Checking the connection and finding models…';
  try {
    if (preset !== 'ollama' && !apiKey) throw new Error(`Paste your ${MODEL_PRESETS[preset].name} API key first.`);
    const allowed = await chrome.permissions.request({ origins: [endpointOrigin(url)] });
    if (!allowed) throw new Error('Allow access to this provider to continue.');
    const models = await loadModels(preset, apiKey, url);
    if (provider.value !== preset || chosenBase() !== url || (preset !== 'ollama' && key.value.trim() !== apiKey)) return;
    if (!models.length) throw new Error(preset === 'ollama' ? 'No chat models found. Download a model in Ollama and try again.' : 'No compatible models were found for this provider.');
    const selected = defaultModel(preset, models, model.value.trim());
    foundModels.replaceChildren();
    options(foundModels, [['', 'Choose a model'], ...models.map(m => [
      m.id, preset === 'openrouter' ? `${m.label}${m.free ? '' : ' · provider charges may apply'}` : m.label,
    ] as [string, string])]);
    foundModelsField.hidden = false;
    foundModels.value = selected?.id ?? '';
    if (!selected) {
      guidedStatus.textContent = preset === 'openrouter'
        ? 'No free model is available. Choose a model if you want to continue, then click Connect and use.'
        : 'Choose a model, then click Connect and use.';
      return;
    }
    await saveConnection({ provider: preset === 'openrouter' ? 'openai' : preset, baseUrl: url, model: selected.id, apiKey });
    model.value = selected.id;
    guidedStatus.textContent = `Ready. Using ${selected.label}. Open Tab Sorter and click Suggest groupings.`;
  } catch (error) {
    if (provider.value === preset) guidedStatus.textContent = error instanceof Error ? error.message : 'Unable to connect.';
  } finally { connect.disabled = false; }
}
function options(select: HTMLSelectElement, items: [string, string][]): void { for (const [v,label] of items) { const o = el('option', label); o.value = v; select.append(o); } }
function check(label: string, input: HTMLInputElement): HTMLLabelElement { input.type = 'checkbox'; const l = el('label', undefined, 'field check'); l.append(input, el('span', label)); return l; }
function message(text: string, error = false): void { status.hidden = false; status.className = `status${error ? ' error' : ''}`; status.textContent = text; }
function updateNotice(): void {
  const local = provider.value === 'none';
  const usingChatGPT = provider.value === 'chatgpt';
  const preset = selectedPreset();
  traditional.hidden = usingChatGPT || local;
  chatgpt.panel.hidden = !usingChatGPT;
  guided.hidden = guidedIntro.hidden = !preset;
  keyField.hidden = provider.value === 'ollama';
  base.disabled = preset === 'anthropic' || preset === 'openrouter';
  baseField.hidden = base.disabled;
  if (preset === 'openai' && baseField.parentElement !== traditional) traditional.insertBefore(baseField, keyField);
  else if (preset !== 'openai' && baseField.parentElement !== manual) manual.insertBefore(baseField, modelField);
  if (preset) {
    const details = MODEL_PRESETS[preset];
    guidedHelp.textContent = details.help;
    getKey.href = details.link; getKey.textContent = details.linkLabel;
    getKey.hidden = !details.link;
  }
  const data = titles.checked ? 'tab IDs and titles' : 'tab IDs, titles, hostnames, URL paths, and locally inferred content types';
  notice.textContent = local ? 'Local mode: no tab data leaves your browser. Website and content-type strategies work entirely on this device.' : `Only when you request AI: ${data}, your instruction, and eligible preview group names/IDs are sent to ${usingChatGPT ? 'OpenAI through the local helper' : chosenBase() || 'your endpoint'}. Query strings, fragments, URL credentials, excluded domains, incognito tabs, and browser pages are omitted. Provider retention policies apply. ${usingChatGPT ? 'Your ChatGPT sign-in tokens stay in the local helper.' : preset === 'ollama' ? '' : 'Your key stays in this browser profile and is sent to authenticate with that provider.'} No Tab Sorter backend or analytics.`;
}
function read(): Settings {
  const choice = provider.value === 'openrouter' ? 'openai' : provider.value as Settings['provider'];
  return { ...value, provider: choice, baseUrl: chosenBase(), model: model.value.trim(), apiKey: choice === 'ollama' ? '' : key.value.trim(), titlesOnly: titles.checked, includePinned: pinned.checked, mergeSubdomains: mergeDomains.checked, existingGroups: existing.value as Settings['existingGroups'], unassigned: unassigned.value as Settings['unassigned'], excludedDomains: domains.value.split(/[\s,]+/).filter(Boolean).map(d => d.toLowerCase().replace(/^\*\./, '')) };
}
async function init(): Promise<void> {
  value = await settings();
  chatgpt = chatgptSettings(value.chatgptKey, value.chatgptModel, async (chatgptKey, chatgptModel) => {
    if (provider.value !== 'chatgpt') throw new Error('Select ChatGPT plan to finish connecting.');
    await saveConnection({ provider: 'chatgpt', chatgptKey, chatgptModel });
  });
  app.append(el('h1', 'Tab Sorter settings'), el('p', 'Your window. Your groups. Your choice of AI.', 'muted'));
  options(provider, [['none','Local only · no network'],['chatgpt','ChatGPT plan'],['openrouter','OpenRouter'],['anthropic','Claude API'],['ollama','Local Ollama'],['openai','Custom AI provider']]);
  options(existing, [['keep','Keep existing groups untouched'],['merge','Merge into a matching name and color'],['dissolve','Dissolve participating groups first']]);
  options(unassigned, [['other','Put eligible unassigned AI tabs in Other'],['ungrouped','Leave unassigned tabs unchanged']]);
  provider.value = location.hash === '#chatgpt' ? 'chatgpt' : storedChoice(value);
  base.value = value.baseUrl; model.value = value.model; key.value = value.apiKey; key.type = 'password'; key.autocomplete = 'off'; key.spellcheck = false;
  titles.checked = value.titlesOnly; pinned.checked = value.includePinned; mergeDomains.checked = value.mergeSubdomains; existing.value = value.existingGroups; unassigned.value = value.unassigned;
  domains.value = value.excludedDomains.join('\n'); domains.placeholder = 'mail.google.com\nbank.example'; model.placeholder = 'Exact model ID from your provider';
  const ai = el('section'); ai.append(el('h2', 'AI provider'), field('Provider', provider), traditional, chatgpt.panel, notice);
  guidedIntro.append(guidedHelp, getKey);
  guided.append(foundModelsField, connect, guidedStatus);
  traditional.append(guidedIntro, keyField, guided, manual);
  manual.open = provider.value === 'openai';
  manual.append(el('summary', 'Advanced connection settings'), baseField, modelField);
  const allow = button('Allow endpoint access', async () => {
    try {
      const draft = read(); if (draft.provider === 'none') { message('Local mode needs no endpoint access.'); return; }
      // permissions.request must be called directly from this click, before any await.
      const origin = endpointOrigin(draft.baseUrl);
      const allowed = await chrome.permissions.request({ origins: [origin] });
      message(allowed ? 'Endpoint access allowed. Save settings when ready.' : 'Endpoint access was not granted.', !allowed);
    } catch (e) { message(e instanceof Error ? e.message : 'Unable to request endpoint access.', true); }
  }); manual.append(allow);
  const privacy = el('section'); privacy.append(el('h2', 'Privacy'), check('Send titles only to AI', titles), field('Exclude domains from AI', domains, 'One hostname per line. Includes subdomains. Excluded tabs stay untouched by AI plans; local strategies can still group them.'), el('p', 'Titles and URL paths can contain private information. Titles-only mode reduces the data shared but titles can still be sensitive.', 'muted'));
  const behavior = el('section'); behavior.append(el('h2', 'Grouping behavior'), check('Include pinned tabs (grouping unpins them; undo restores pinning)', pinned), check('Merge known website families such as docs.google.com and mail.google.com', mergeDomains), field('Existing groups', existing), field('Unassigned tabs', unassigned));
  const presets = el('section'), list = el('div'), presetName = el('input'), presetInstruction = el('textarea'); presetName.maxLength = 60; presetInstruction.maxLength = 2000;
  function renderPresets(): void {
    list.replaceChildren();
    for (const p of value.presets) { const row = el('div', undefined, 'preset-row'); row.append(el('span', `${p.name} — ${p.instruction}`), button('Remove', () => { value.presets = value.presets.filter(x => x.id !== p.id); renderPresets(); })); list.append(row); }
  }
  presets.append(el('h2', 'Saved presets'), list, field('Preset name', presetName), field('Instruction', presetInstruction), button('Add preset', () => {
    if (!presetName.value.trim() || !presetInstruction.value.trim()) { message('Enter a preset name and instruction.', true); return; }
    value.presets.push({ id: crypto.randomUUID(), name: presetName.value.trim(), instruction: presetInstruction.value.trim() }); presetName.value = ''; presetInstruction.value = ''; renderPresets(); message('Preset added. Save settings to keep it.');
  })); renderPresets();
  const history = el('section'); history.append(el('h2', 'On-device history'), el('p', 'The last five undo snapshots per window contain tab URLs, titles, group metadata, and order. They survive browser restarts. Clear them here at any time.'), button('Clear all undo history', async () => { await clearUndo(); message('Undo history cleared.'); }));
  const save = el('button', 'Save settings', 'primary'); save.type = 'submit';
  form.append(ai, privacy, behavior, presets, history, status, save); app.append(form);
  form.addEventListener('submit', e => { e.preventDefault(); void (async () => {
    try {
      const draft = read();
      if (draft.provider === 'chatgpt') {
        if (!chatgpt.isReady() || !chatgpt.model.value) throw new Error('Connect ChatGPT and select a model first.');
        draft.chatgptKey = chatgpt.key.value.trim();
        draft.chatgptModel = chatgpt.model.value;
      } else if (draft.provider !== 'none') {
        endpointOrigin(draft.baseUrl);
        if (!draft.model) throw new Error('Enter a model name.');
        if (draft.provider !== 'ollama' && !draft.apiKey) throw new Error('Enter an API key.');
      }
      if (draft.excludedDomains.some(d => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(d))) throw new Error('Excluded domains must be hostnames, without a scheme or path.');
      await saveSettings(draft); value = draft; message('Settings saved on this device.');
    } catch (e) { message(e instanceof Error ? e.message : 'Unable to save settings.', true); }
  })(); });
  provider.addEventListener('change', () => {
    clearModelChoices();
    manual.open = provider.value === 'openai';
    if (provider.value === 'chatgpt') { updateNotice(); if (chatgpt.key.value) void chatgpt.refresh(); return; }
    const savedOpenRouter = value.baseUrl.replace(/\/+$/, '') === OPENROUTER_URL;
    if (provider.value === storedChoice(value) || provider.value === 'openrouter' && savedOpenRouter
      || value.provider === 'chatgpt' && provider.value === 'openai' && !savedOpenRouter) {
      base.value = value.baseUrl; model.value = value.model; key.value = value.apiKey; updateNotice(); return;
    }
    const preset = selectedPreset();
    base.value = preset ? MODEL_PRESETS[preset].url : DEFAULTS.baseUrl;
    model.value = ''; key.value = ''; updateNotice();
  });
  foundModels.addEventListener('change', () => { model.value = foundModels.value; });
  key.addEventListener('input', clearModelChoices);
  base.addEventListener('input', clearModelChoices);
  for (const input of [base, titles]) input.addEventListener('input', updateNotice);
  updateNotice();
  if (provider.value === 'chatgpt') void chatgpt.refresh();
}
void init().catch(() => { app.append(el('p', 'Unable to load settings. Reload this page.')); });
