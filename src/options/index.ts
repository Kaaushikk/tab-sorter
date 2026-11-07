import '../style.css';
import { button, el, field } from '../lib/ui';
import { clearUndo, DEFAULTS, FAST_OPENROUTER_MODEL, isOpenRouter, saveSettings, settings } from '../lib/storage';
import { endpointOrigin } from '../lib/sanitize';
import type { Settings } from '../lib/types';
import { chatgptSettings } from './chatgpt';

const app = document.querySelector<HTMLElement>('#app')!; app.className = 'options';
const status = el('div', undefined, 'status'); status.role = 'status'; status.setAttribute('aria-live', 'polite'); status.hidden = true;
const form = el('form'), provider = el('select'), base = el('input'), model = el('input'), key = el('input'), domains = el('textarea');
const titles = el('input'), pinned = el('input'), mergeDomains = el('input'), existing = el('select'), unassigned = el('select');
const notice = el('div', undefined, 'notice');
const fastModel = button('Use free Gemma 4', () => { model.value = FAST_OPENROUTER_MODEL; message('Free Gemma 4 selected. Click Save settings to use it.'); });
let value: Settings;
let chatgpt: ReturnType<typeof chatgptSettings>;
const traditional = el('div');
function options(select: HTMLSelectElement, items: [string, string][]): void { for (const [v,label] of items) { const o = el('option', label); o.value = v; select.append(o); } }
function check(label: string, input: HTMLInputElement): HTMLLabelElement { input.type = 'checkbox'; const l = el('label', undefined, 'field check'); l.append(input, el('span', label)); return l; }
function message(text: string, error = false): void { status.hidden = false; status.className = `status${error ? ' error' : ''}`; status.textContent = text; }
function updateNotice(): void {
  const local = provider.value === 'none';
  const usingChatGPT = provider.value === 'chatgpt';
  traditional.hidden = usingChatGPT;
  chatgpt.panel.hidden = !usingChatGPT;
  base.disabled = local || provider.value === 'anthropic'; model.disabled = local; key.disabled = local || provider.value === 'ollama';
  fastModel.hidden = !isOpenRouter({ provider: provider.value as Settings['provider'], baseUrl: base.value.trim() });
  const data = titles.checked ? 'tab IDs and titles' : 'tab IDs, titles, hostnames, URL paths, and locally inferred content types';
  notice.textContent = local ? 'Local mode: no tab data leaves your browser. Website and content-type strategies work entirely on this device.' : `Only when you request AI: ${data}, your instruction, and eligible preview group names/IDs are sent to ${usingChatGPT ? 'OpenAI through the local helper' : provider.value === 'anthropic' ? 'Anthropic (api.anthropic.com)' : base.value || 'your endpoint'}. Query strings, fragments, URL credentials, excluded domains, incognito tabs, and browser pages are omitted. Provider retention policies apply. ${usingChatGPT ? 'Your ChatGPT sign-in tokens stay in the local helper.' : 'Your key stays in this browser profile and is sent to authenticate with that provider.'} No Tab Sorter backend or analytics.`;
}
function read(): Settings {
  return { ...value, provider: provider.value as Settings['provider'], baseUrl: provider.value === 'anthropic' ? 'https://api.anthropic.com' : base.value.trim(), model: model.value.trim(), apiKey: key.value.trim(), titlesOnly: titles.checked, includePinned: pinned.checked, mergeSubdomains: mergeDomains.checked, existingGroups: existing.value as Settings['existingGroups'], unassigned: unassigned.value as Settings['unassigned'], excludedDomains: domains.value.split(/[\s,]+/).filter(Boolean).map(d => d.toLowerCase().replace(/^\*\./, '')) };
}
async function init(): Promise<void> {
  value = await settings();
  chatgpt = chatgptSettings(value.chatgptKey, value.chatgptModel);
  app.append(el('h1', 'Tab Sorter settings'), el('p', 'Your window. Your groups. Your choice of AI.', 'muted'));
  options(provider, [['none','Local only · no network'],['chatgpt','ChatGPT plan'],['anthropic','Anthropic'],['openai','Custom AI provider'],['ollama','Local Ollama']]);
  options(existing, [['keep','Keep existing groups untouched'],['merge','Merge into a matching name and color'],['dissolve','Dissolve participating groups first']]);
  options(unassigned, [['other','Put eligible unassigned AI tabs in Other'],['ungrouped','Leave unassigned tabs unchanged']]);
  provider.value = value.provider; base.value = value.baseUrl; model.value = value.model; key.value = value.apiKey; key.type = 'password'; key.autocomplete = 'off'; key.spellcheck = false;
  titles.checked = value.titlesOnly; pinned.checked = value.includePinned; mergeDomains.checked = value.mergeSubdomains; existing.value = value.existingGroups; unassigned.value = value.unassigned;
  domains.value = value.excludedDomains.join('\n'); domains.placeholder = 'mail.google.com\nbank.example'; model.placeholder = 'Exact model ID from your provider';
  const ai = el('section'); ai.append(el('h2', 'AI provider'), field('Provider', provider), traditional, chatgpt.panel, notice);
  traditional.append(field('Base URL', base, 'Custom provider (for example, OpenRouter): use its Chat Completions base URL. Ollama: http://localhost:11434.'), field('Model', model), fastModel, field('API key', key, 'Stored in chrome.storage.local only. Not synced. Local storage is not encrypted.'));
  const allow = button('Allow endpoint access', async () => {
    try {
      const draft = read(); if (draft.provider === 'none') { message('Local mode needs no endpoint access.'); return; }
      // permissions.request must be called directly from this click, before any await.
      const origin = endpointOrigin(draft.baseUrl);
      const allowed = await chrome.permissions.request({ origins: [origin] });
      message(allowed ? 'Endpoint access allowed. Save settings when ready.' : 'Endpoint access was not granted.', !allowed);
    } catch (e) { message(e instanceof Error ? e.message : 'Unable to request endpoint access.', true); }
  }); traditional.append(allow);
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
    if (provider.value === 'chatgpt') { updateNotice(); if (chatgpt.key.value) void chatgpt.refresh(); return; }
    if (provider.value === value.provider || value.provider === 'chatgpt' && provider.value === 'openai') {
      base.value = value.baseUrl; model.value = value.model; key.value = value.apiKey; updateNotice(); return;
    }
    base.value = provider.value === 'ollama' ? 'http://localhost:11434' : provider.value === 'anthropic' ? 'https://api.anthropic.com' : DEFAULTS.baseUrl;
    model.value = ''; key.value = ''; updateNotice();
  });
  for (const input of [base, titles]) input.addEventListener('input', updateNotice);
  updateNotice();
  if (provider.value === 'chatgpt') void chatgpt.refresh();
}
void init().catch(() => { app.append(el('p', 'Unable to load settings. Reload this page.')); });
