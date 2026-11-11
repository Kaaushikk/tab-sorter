import { canSleep } from '../lib/memory';
import { button, el, field } from '../lib/ui';
import type { MemoryCommand, WindowState } from '../lib/types';

type SleepAction = Omit<Extract<MemoryCommand, { scope: 'selected' }>, 'windowId'>
  | Omit<Extract<MemoryCommand, { scope: 'group' }>, 'windowId'>
  | Omit<Extract<MemoryCommand, { scope: 'inactive' }>, 'windowId'>;

export function memoryPanel(perform: (command: SleepAction) => Promise<void>) {
  const panel = el('details', undefined, 'memory-panel');
  const summary = el('summary', 'Free memory');
  const count = el('p', '', 'muted');
  const groups = el('select'), groupControls = el('div', undefined, 'stack');
  const chosen = new Set<number>();
  const list = el('div', undefined, 'memory-tabs');
  const search = el('input'); search.type = 'search'; search.placeholder = 'Find a tab by title or website';
  search.setAttribute('aria-label', 'Find tabs to unload');
  const individual = el('details');
  let state: WindowState | undefined;
  function renderTabs(): void {
    if (!state || !individual.open) return;
    const query = search.value.trim().toLowerCase();
    list.replaceChildren();
    const candidates = state.tabs.filter(tab => canSleep(tab) && (!query || (tab.title + ' ' + tab.hostname).toLowerCase().includes(query)));
    for (const tab of candidates) {
      const label = el('label', undefined, 'memory-tab'), input = el('input');
      input.type = 'checkbox'; input.checked = chosen.has(tab.id);
      input.addEventListener('change', () => { if (input.checked) chosen.add(tab.id); else chosen.delete(tab.id); });
      label.append(input, el('span', tab.title)); list.append(label);
    }
    if (!candidates.length) list.append(el('small', 'No matching tabs available to unload.'));
  }
  function update(next: WindowState): void {
    state = next;
    if (!panel.open) return;
    const eligible = next.tabs.filter(canSleep), selectedGroup = groups.value;
    const ids = new Set(eligible.map(tab => tab.id));
    for (const id of chosen) if (!ids.has(id)) chosen.delete(id);
    count.textContent = `${eligible.length} tabs available · ${next.tabs.filter(tab => tab.discarded).length} already sleeping`;
    groups.replaceChildren();
    for (const group of next.groups) {
      const option = el('option', `${group.title || 'Unnamed group'} · ${eligible.filter(tab => tab.groupId === group.id).length} available`);
      option.value = String(group.id); groups.append(option);
    }
    if (next.groups.some(group => String(group.id) === selectedGroup)) groups.value = selectedGroup;
    groupControls.hidden = !next.groups.length;
    renderTabs();
  }
  panel.addEventListener('toggle', () => { if (state) update(state); });
  individual.addEventListener('toggle', renderTabs);
  search.addEventListener('input', renderTabs);
  groupControls.append(field('Choose a group', groups), button('Sleep this group', () => perform({ type: 'sleep', scope: 'group', groupId: Number(groups.value) })));
  individual.append(el('summary', 'Choose individual tabs'), search, list,
    button('Sleep selected tabs', () => perform({ type: 'sleep', scope: 'selected', tabIds: [...chosen] })));
  const body = el('div', undefined, 'stack');
  body.append(el('p', 'Unload pages to free memory. Tabs stay in place and reload when opened. Unsaved entries or page state may be lost.'),
    el('p', 'Active, pinned, audio-playing, and browser-protected tabs are skipped.', 'muted'),
    count, button('Sleep inactive tabs', () => perform({ type: 'sleep', scope: 'inactive' })), groupControls, individual);
  panel.append(summary, body);
  return { panel, update };
}
