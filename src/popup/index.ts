import '../style.css';
import { button, el } from '../lib/ui';
import { FAST_OPENROUTER_MODEL } from '../lib/storage';
import { CHATGPT_USAGE } from '../lib/chatgpt';
import type { AiCommand, AiJob, Command, Response, Strategy, WindowState } from '../lib/types';

const root = document.querySelector<HTMLElement>('#app')!; root.className = 'popup';
let windowId: number, state: WindowState, selected: Strategy | undefined, busy = false;
let activeAi: { id: string; startedAt: number; resumed: boolean; cancelling: boolean } | undefined;
let progressTimer: ReturnType<typeof setInterval> | undefined, polling = false;
const status = el('div', undefined, 'status'); status.role = 'status'; status.setAttribute('aria-live', 'polite'); status.hidden = true;
const progressDetails = el('div', undefined, 'row between ai-progress'); progressDetails.hidden = true;
const progressLabel = el('div'), elapsed = el('small'), modelName = el('small');
elapsed.setAttribute('aria-hidden', 'true');
const stopAi = button('Cancel request', cancelRequest);
progressLabel.append(elapsed, modelName); progressDetails.append(progressLabel, stopAi);
const strategies = el('div', undefined, 'stack'), history = el('section'), presets = el('div', undefined, 'row');
const instruction = el('textarea'); instruction.placeholder = 'Group by website, separate work from entertainment…'; instruction.maxLength = 2000; instruction.setAttribute('aria-label', 'Custom grouping instruction');
const refine = el('input'); refine.placeholder = 'Refine this plan…'; refine.maxLength = 2000; refine.setAttribute('aria-label', 'Refine selected grouping');
const scope = el('div', 'This window only', 'scope');
const providerHint = el('p', 'Local strategies always work without an API key.', 'muted');
const apply = button('Apply grouping', () => run(async () => { if (!selected) return; const result = await send<{message:string}>({ type: 'apply', windowId, strategy: selected }); selected = undefined; show(result.message); await reload(); }), 'primary');
const refinement = el('div', undefined, 'stack'); refinement.hidden = true;

async function send<T>(command: Command): Promise<T> {
  const r = await chrome.runtime.sendMessage(command) as Response<T>;
  if (!r?.ok) throw new Error(r && !r.ok ? r.error : 'The background worker disconnected. Reopen the popup and check Undo history.');
  return r.value;
}
function show(message: string, error = false): void { status.hidden = false; if (status.textContent !== message) status.textContent = message; status.className = `status${error ? ' error' : ''}`; }
function locks(): void { root.querySelectorAll('button,input,textarea').forEach(n => { (n as HTMLButtonElement).disabled = n === stopAi ? !activeAi || activeAi.cancelling : busy; }); apply.disabled = busy || !selected?.groups.length; root.setAttribute('aria-busy', String(busy)); }
async function run(fn: () => Promise<void>): Promise<void> {
  if (busy) return; busy = true; locks(); show('Working on this window…');
  try { await fn(); } catch (e) { show(e instanceof Error ? e.message : 'Something went wrong.', true); }
  finally { busy = false; locks(); }
}
const stages: Record<AiJob['stage'], string> = {
  preparing: 'Preparing tab suggestions…', connecting: 'Connecting to the AI provider…',
  waiting: 'Connected. Waiting for the model to respond…', receiving: 'Receiving the model’s response…',
  validating: 'Checking the response and building previews…', retrying: 'Retrying after an empty or invalid response…',
};
function showAiProgress(job: AiJob): void {
  if (!activeAi || activeAi.cancelling) return;
  const batch = (job.batches ?? 1) > 1 ? `Batch ${job.batch ?? 1} of ${job.batches} · ` : '';
  const retry = (job.attempt ?? 1) > 1 && job.stage !== 'retrying' ? 'Retry · ' : '';
  show(`${batch}${retry}${stages[job.stage]}`);
  modelName.textContent = job.model === FAST_OPENROUTER_MODEL ? 'Gemma 4 · free' : job.model;
  modelName.title = job.model;
}
function beginProgress(id: string, startedAt: number, resumed = false): void {
  activeAi = { id, startedAt, resumed, cancelling: false };
  busy = true; progressDetails.hidden = false; elapsed.textContent = '0s elapsed'; modelName.textContent = ''; locks();
  show('Preparing tab suggestions…');
  progressTimer = setInterval(() => { void pollProgress(); }, 700);
  void pollProgress();
}
function endProgress(): void {
  clearInterval(progressTimer); progressTimer = undefined; activeAi = undefined;
  progressDetails.hidden = true; busy = false; locks();
}
async function pollProgress(): Promise<void> {
  const request = activeAi;
  if (!request || polling) return;
  elapsed.textContent = `${Math.max(0, Math.floor((Date.now() - request.startedAt) / 1000))}s elapsed`;
  polling = true;
  try {
    const job = await send<AiJob | null>({ type: 'aiStatus', windowId });
    if (activeAi !== request || !job || job.id !== request.id) return;
    if (job.status === 'running') { showAiProgress(job); return; }
    if (!request.resumed) return; // The original request will deliver its result directly.
    endProgress();
    busy = true; locks();
    try {
      await reload();
      if (job.selectedId) { selected = state.strategies.find(s => s.id === job.selectedId); renderStrategies(); }
      if (job.status === 'succeeded') show(selected ? 'Preview ready. Review it before applying.' : suggestionMessage());
      else show(job.error ?? 'The AI request did not complete.', job.status === 'failed');
    } catch { show('The AI request ended, but the popup could not reload its preview. Reopen it to check the result.', true); }
    finally { busy = false; locks(); }
  } catch {
    if (activeAi === request && request.resumed) { endProgress(); show('Lost contact with the AI request. Reopen the popup to try again.', true); }
  } finally { polling = false; }
}
async function cancelRequest(): Promise<void> {
  const request = activeAi;
  if (!request || request.cancelling) return;
  request.cancelling = true; locks(); show('Cancelling the AI request…');
  try {
    const result = await send<{ cancelled: boolean }>({ type: 'cancelAi', windowId, requestId: request.id });
    if (activeAi !== request) return;
    if (!result.cancelled) show('Finishing the preview…');
    if (request.resumed) void pollProgress();
  } catch {
    if (activeAi !== request) return;
    request.cancelling = false; locks(); show('Could not cancel the request. Try again.', true);
  }
}
function suggestionMessage(): string {
  return state.strategies.some(s => s.id.startsWith('ai:')) ? 'Suggestions ready. Choose a strategy to preview.' : 'The model found no distinct AI suggestions. You can still use the local strategies.';
}
async function runAi(command: AiCommand): Promise<void> {
  if (busy) return;
  const requestId = crypto.randomUUID();
  beginProgress(requestId, Date.now());
  try {
    const result = await send<{ state: WindowState; selectedId?: string }>({ ...command, requestId });
    state = result.state; selected = state.strategies.find(s => s.id === result.selectedId); renderStrategies();
    if (command.type === 'refine') refine.value = '';
    show(command.type === 'suggest' ? suggestionMessage() : 'Preview ready. Review the groups before applying.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The AI request failed. Try again.';
    show(message, !message.startsWith('AI request cancelled.'));
  } finally { endProgress(); }
}
function colorDot(color: string): HTMLElement { const dot = el('span', undefined, 'dot'); dot.dataset.color = color; dot.setAttribute('aria-hidden', 'true'); return dot; }
function renderStrategies(): void {
  if (!state) return;
  strategies.replaceChildren();
  for (const plan of state.strategies) {
    const card = el('article', undefined, `card${selected?.id === plan.id ? ' selected' : ''}`);
    const pick = button('', () => { selected = plan; renderStrategies(); }); pick.setAttribute('aria-pressed', String(selected?.id === plan.id));
    pick.append(el('h3', `${selected?.id === plan.id ? '✓ ' : ''}${plan.label}`), el('small', plan.description));
    const summary = el('div', undefined, 'summary');
    for (const group of plan.groups) { const pill = el('span', undefined, 'pill'); pill.append(colorDot(group.color), document.createTextNode(`${group.name} · ${group.tabIds.length}`)); summary.append(pill); }
    if (!plan.groups.length) summary.append(el('small', 'No eligible tabs. Existing groups and pinned tabs are kept by default.'));
    pick.append(summary); card.append(pick);
    if (selected?.id === plan.id) {
      const preview = el('div', undefined, 'preview');
      for (const group of plan.groups) {
        const detail = el('details'), label = el('summary', `${group.name} (${group.tabIds.length})`), list = el('ul'); detail.open = true;
        for (const id of group.tabIds) list.append(el('li', state.tabs.find(t => t.id === id)?.title ?? 'Tab no longer available'));
        detail.append(label, list); preview.append(detail);
      }
      const planned = new Set(plan.groups.flatMap(g => g.tabIds));
      const untouched = state.tabs.length - planned.size;
      if (untouched) preview.append(el('small', `${untouched} tab${untouched === 1 ? '' : 's'} will stay as they are.`));
      card.append(preview);
    }
    strategies.append(card);
  }
  refinement.hidden = !selected; locks();
}
function renderHistory(): void {
  history.replaceChildren(el('h2', 'Groups created'));
  const active = state.snapshots.filter(s => s.status !== 'undone');
  if (!active.length) { history.append(el('small', 'Your last five groupings will appear here.')); return; }
  for (const [index, snap] of active.entries()) {
    const detail = el('details', undefined, 'history-item'); detail.open = index === 0;
    detail.append(el('summary', `${snap.label} · ${new Date(snap.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${snap.status === 'pending' || snap.status === 'partial' ? ' · interrupted' : ''}`));
    detail.append(button(`Undo all: ${snap.label}`, () => run(async () => { const r = await send<{message:string}>({ type: 'undo', windowId, snapshotId: snap.id }); show(r.message); await reload(); }), 'wide'));
    for (const group of snap.created) {
      const row = el('div', undefined, 'group-row'), heading = el('strong', `${group.title} · ${group.tabIds.length}${group.undone ? ' · undone' : ''}`);
      heading.prepend(colorDot(group.color)); row.append(heading);
      if (!group.undone) {
        const actions = el('div', undefined, 'row');
        actions.append(button('Undo', () => run(async () => { const r = await send<{message:string}>({ type: 'undo', windowId, snapshotId: snap.id, groupId: group.groupId }); show(r.message); await reload(); })));
        const live = state.groups.find(g => g.id === group.groupId);
        if (live) for (const [action, label] of [['ungroup', 'Ungroup'], ['toggle', live.collapsed ? 'Expand' : 'Collapse']] as const) actions.append(button(label, () => run(async () => { await send({ type: 'groupAction', windowId, groupId: group.groupId, action }); await reload(); show('Group updated.'); })));
        row.append(actions);
      }
      detail.append(row);
    }
    history.append(detail);
  }
}
async function reload(): Promise<void> {
  state = await send<WindowState>({ type: 'load', windowId });
  if (state.settings.provider === 'chatgpt') {
    const usage = el('a', 'Manage ChatGPT usage'); usage.href = CHATGPT_USAGE; usage.target = '_blank'; usage.rel = 'noopener';
    providerHint.replaceChildren('Using ChatGPT plan · ', usage);
  } else {
    providerHint.textContent = 'Local strategies always work without an API key.';
  }
  if (selected) selected = state.strategies.find(s => s.id === selected!.id);
  scope.textContent = `This window only · ${state.tabs.length} tabs`;
  presets.replaceChildren();
  for (const preset of state.settings.presets) presets.append(button(preset.name, () => { instruction.value = preset.instruction; void custom(); }, 'chip'));
  renderStrategies(); renderHistory();
  if (state.notice) show(state.notice);
}
async function custom(): Promise<void> {
  await runAi({ type: 'custom', windowId, instruction: instruction.value });
}
async function init(): Promise<void> {
  const current = await chrome.windows.getCurrent({ populate: false });
  if (current.id === undefined) throw new Error('Open Tab Sorter from a browser window.'); windowId = current.id;
  const header = el('header'), brand = el('div', undefined, 'brand'), logo = el('img'); logo.src = 'icons/48.png'; logo.alt = '';
  const title = el('div'); title.append(el('h1', 'Tab Sorter'), scope); brand.append(logo, title);
  const settings = button('⚙', () => chrome.runtime.openOptionsPage(), 'icon-button'); settings.setAttribute('aria-label', 'Open settings'); header.append(brand, settings);
  const suggest = button('✦ Suggest groupings', () => runAi({ type: 'suggest', windowId }), 'primary wide');
  const customLabel = el('label', 'Or tell me how to group your tabs', 'muted'); customLabel.htmlFor = 'instruction'; instruction.id = 'instruction';
  const customBox = el('div', undefined, 'stack'); customBox.append(customLabel, instruction, button('Preview instruction', custom), presets);
  refinement.append(refine, button('Refine preview', () => selected ? runAi({ type: 'refine', windowId, strategy: selected, instruction: refine.value }) : undefined));
  const tools = el('div', undefined, 'row');
  tools.append(button('Ungroup all', () => run(async () => { const r = await send<{message:string}>({ type: 'ungroupAll', windowId }); show(r.message); await reload(); })), button('Collapse all groups', () => run(async () => { await send({ type: 'collapseAll', windowId }); await reload(); show('Groups collapsed.'); })));
  const toolbar = el('div', undefined, 'toolbar row'); toolbar.append(button('Cancel', () => { selected = undefined; renderStrategies(); status.hidden = true; }), apply);
  root.append(header, suggest, providerHint, status, progressDetails, el('hr', undefined, 'divider'), customBox, el('hr', undefined, 'divider'), strategies, refinement, toolbar, el('hr', undefined, 'divider'), history, el('hr', undefined, 'divider'), tools);
  instruction.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); void custom(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!apply.disabled) apply.click(); } });
  busy = true; locks();
  const job = await send<AiJob | null>({ type: 'aiStatus', windowId });
  if (job?.status === 'running') { beginProgress(job.id, job.startedAt, true); showAiProgress(job); return; }
  try {
    await reload();
    if (job?.status === 'failed' && job.error && Date.now() - job.updatedAt < 60_000) show(job.error, true);
  } finally { busy = false; locks(); }
}
void init().catch(e => { endProgress(); root.append(status); show(e instanceof Error ? e.message : 'Unable to open Tab Sorter.', true); });
