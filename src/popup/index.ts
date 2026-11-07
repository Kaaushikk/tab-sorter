import '../style.css';
import { button, el } from '../lib/ui';
import type { Command, Response, Strategy, WindowState } from '../lib/types';

const root = document.querySelector<HTMLElement>('#app')!; root.className = 'popup';
let windowId: number, state: WindowState, selected: Strategy | undefined, busy = false;
const status = el('div', undefined, 'status'); status.role = 'status'; status.setAttribute('aria-live', 'polite'); status.hidden = true;
const strategies = el('div', undefined, 'stack'), history = el('section'), presets = el('div', undefined, 'row');
const instruction = el('textarea'); instruction.placeholder = 'Group by website, separate work from entertainment…'; instruction.maxLength = 2000; instruction.setAttribute('aria-label', 'Custom grouping instruction');
const refine = el('input'); refine.placeholder = 'Refine this plan…'; refine.maxLength = 2000; refine.setAttribute('aria-label', 'Refine selected grouping');
const scope = el('div', 'This window only', 'scope');
const apply = button('Apply grouping', () => run(async () => { if (!selected) return; const result = await send<{message:string}>({ type: 'apply', windowId, strategy: selected }); selected = undefined; show(result.message); await reload(); }), 'primary');
const refinement = el('div', undefined, 'stack'); refinement.hidden = true;

async function send<T>(command: Command): Promise<T> {
  const r = await chrome.runtime.sendMessage(command) as Response<T>;
  if (!r?.ok) throw new Error(r && !r.ok ? r.error : 'The background worker disconnected. Reopen the popup and check Undo history.');
  return r.value;
}
function show(message: string, error = false): void { status.hidden = false; status.textContent = message; status.className = `status${error ? ' error' : ''}`; }
function locks(): void { root.querySelectorAll('button,input,textarea').forEach(n => { (n as HTMLButtonElement).disabled = busy; }); apply.disabled = busy || !selected?.groups.length; root.setAttribute('aria-busy', String(busy)); }
async function run(fn: () => Promise<void>, pendingMessage = 'Working on this window…'): Promise<void> {
  if (busy) return; busy = true; locks(); show(pendingMessage);
  try { await fn(); } catch (e) { show(e instanceof Error ? e.message : 'Something went wrong.', true); }
  finally { busy = false; locks(); }
}
function colorDot(color: string): HTMLElement { const dot = el('span', undefined, 'dot'); dot.dataset.color = color; dot.setAttribute('aria-hidden', 'true'); return dot; }
function renderStrategies(): void {
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
  if (selected) selected = state.strategies.find(s => s.id === selected!.id);
  scope.textContent = `This window only · ${state.tabs.length} tabs`;
  presets.replaceChildren();
  for (const preset of state.settings.presets) presets.append(button(preset.name, () => { instruction.value = preset.instruction; void custom(); }, 'chip'));
  renderStrategies(); renderHistory();
  if (state.notice) show(state.notice);
}
async function custom(): Promise<void> {
  await run(async () => {
    const result = await send<{state:WindowState;selectedId:string}>({ type: 'custom', windowId, instruction: instruction.value });
    state = result.state; selected = state.strategies.find(s => s.id === result.selectedId); renderStrategies(); show('Preview ready. Review the groups before applying.');
  }, 'Asking your AI provider… This can take up to 2 minutes per request.');
}
async function init(): Promise<void> {
  const current = await chrome.windows.getCurrent({ populate: false });
  if (current.id === undefined) throw new Error('Open Tab Sorter from a browser window.'); windowId = current.id;
  const header = el('header'), brand = el('div', undefined, 'brand'), logo = el('img'); logo.src = 'icons/48.png'; logo.alt = '';
  const title = el('div'); title.append(el('h1', 'Tab Sorter'), scope); brand.append(logo, title);
  const settings = button('⚙', () => chrome.runtime.openOptionsPage(), 'icon-button'); settings.setAttribute('aria-label', 'Open settings'); header.append(brand, settings);
  const suggest = button('✦ Suggest groupings', () => run(async () => {
    const result = await send<{state:WindowState}>({ type: 'suggest', windowId }); state = result.state; renderStrategies(); show('Suggestions ready. Choose a strategy to preview.');
  }, 'Asking your AI provider… This can take up to 2 minutes per request.'), 'primary wide');
  const customLabel = el('label', 'Or tell me how to group your tabs', 'muted'); customLabel.htmlFor = 'instruction'; instruction.id = 'instruction';
  const customBox = el('div', undefined, 'stack'); customBox.append(customLabel, instruction, button('Preview instruction', custom), presets);
  refinement.append(refine, button('Refine preview', () => run(async () => {
    if (!selected) return;
    const result = await send<{state:WindowState;selectedId:string}>({ type: 'refine', windowId, strategy: selected, instruction: refine.value });
    state = result.state; selected = state.strategies.find(s => s.id === result.selectedId); renderStrategies(); refine.value = ''; show('Refined preview ready.');
  }, 'Asking your AI provider to refine the preview… This can take up to 2 minutes per request.')));
  const tools = el('div', undefined, 'row');
  tools.append(button('Ungroup all', () => run(async () => { const r = await send<{message:string}>({ type: 'ungroupAll', windowId }); show(r.message); await reload(); })), button('Collapse all groups', () => run(async () => { await send({ type: 'collapseAll', windowId }); await reload(); show('Groups collapsed.'); })));
  const toolbar = el('div', undefined, 'toolbar row'); toolbar.append(button('Cancel', () => { selected = undefined; renderStrategies(); status.hidden = true; }), apply);
  root.append(header, suggest, el('p', 'Local strategies always work without an API key.', 'muted'), el('hr', undefined, 'divider'), customBox, status, el('hr', undefined, 'divider'), strategies, refinement, toolbar, el('hr', undefined, 'divider'), history, el('hr', undefined, 'divider'), tools);
  instruction.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); void custom(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!apply.disabled) apply.click(); } });
  await reload();
}
void init().catch(e => { root.append(status); show(e instanceof Error ? e.message : 'Unable to open Tab Sorter.', true); });
