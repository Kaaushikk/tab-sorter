import { canSleep, SLEEP_IDLE_MINUTES, suggestSleepGroups } from '../lib/memory';
import { button, el, field } from '../lib/ui';
import type { MemoryCommand, Tab, WindowState } from '../lib/types';

type SleepAction = Omit<Extract<MemoryCommand, { scope: 'selected' }>, 'windowId'>
  | Omit<Extract<MemoryCommand, { scope: 'group' }>, 'windowId'>
  | Omit<Extract<MemoryCommand, { scope: 'inactive' }>, 'windowId'>;

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' });

function timeAgo(last: number | undefined, now: number): string | undefined {
  if (typeof last !== 'number' || !Number.isFinite(last) || last <= 0) return;
  const minutes = Math.max(0, Math.floor((now - last) / 60_000));
  if (minutes >= 1440) return relativeTime.format(-Math.floor(minutes / 1440), 'day');
  if (minutes >= 60) return relativeTime.format(-Math.floor(minutes / 60), 'hour');
  return minutes ? relativeTime.format(-minutes, 'minute') : 'just now';
}

function tabStatus(tab: Tab, now: number): string {
  if (tab.discarded) return 'Sleeping · Page unloaded';
  const details: string[] = [];
  if (tab.active) details.push('Active');
  if (tab.pinned) details.push('Pinned');
  if (tab.audible) details.push('Playing audio');
  if (!details.length && !canSleep(tab)) details.push('Protected');
  const used = timeAgo(tab.lastAccessed, now);
  if (used && !tab.active) details.push(`Last used ${used}`);
  return ['Loaded', ...details].join(' · ');
}

export function memoryPanel(perform: (command: SleepAction) => Promise<void>) {
  const panel = el('details', undefined, 'memory-panel');
  const summary = el('summary', 'Free memory');
  const count = el('p', '', 'muted');
  const suggestions = el('div', undefined, 'stack');
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
    const now = Date.now();
    const matches = state.tabs.filter(tab => !query || `${tab.title} ${tab.hostname}`.toLowerCase().includes(query));
    for (const tab of matches) {
      const eligible = canSleep(tab);
      const row = el(eligible ? 'label' : 'div', undefined, 'memory-tab');
      if (eligible) {
        const input = el('input');
        input.type = 'checkbox';
        input.checked = chosen.has(tab.id);
        input.addEventListener('change', () => {
          if (input.checked) chosen.add(tab.id);
          else chosen.delete(tab.id);
        });
        row.append(input);
      }
      const info = el('span', undefined, 'memory-tab-info');
      info.append(el('span', tab.title), el('small', tabStatus(tab, now), 'muted'));
      row.append(info);
      list.append(row);
    }
    if (!matches.length) list.append(el('small', 'No matching tabs.'));
  }
  function update(next: WindowState): void {
    state = next;
    if (!panel.open) return;
    const eligible = next.tabs.filter(canSleep), selectedGroup = groups.value;
    const ids = new Set(eligible.map(tab => tab.id));
    for (const id of chosen) if (!ids.has(id)) chosen.delete(id);
    count.textContent = `${eligible.length} tabs available · ${next.tabs.filter(tab => tab.discarded).length} already sleeping`;
    const now = Date.now();
    const recommended = suggestSleepGroups(next.tabs, next.groups, now).slice(0, 3);
    suggestions.replaceChildren(el('strong', 'Suggested groups'));
    if (!next.groups.length) {
      suggestions.append(el('small', 'Create a tab group to get sleep suggestions.', 'muted'));
    } else if (!recommended.length) {
      suggestions.append(el('small', `Suggestions appear when all loaded tabs in a group can sleep and were last used at least ${SLEEP_IDLE_MINUTES} minutes ago.`, 'muted'));
    }
    for (const group of recommended) {
      const title = group.title || 'Unnamed group';
      const row = el('div', undefined, 'memory-suggestion');
      const info = el('div', undefined, 'memory-tab-info');
      info.append(el('strong', title), el('small', `${group.count} loaded ${group.count === 1 ? 'tab' : 'tabs'} · Last used ${timeAgo(group.lastUsed, now)}`, 'muted'));
      const action = button('Sleep group', () => perform({ type: 'sleep', scope: 'group', groupId: group.id, onlyIdle: true }));
      action.setAttribute('aria-label', `Sleep group ${title}`);
      row.append(info, action);
      suggestions.append(row);
    }
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
  individual.append(el('summary', 'Choose individual tabs'),
    el('small', 'For RAM and CPU readings, open your browser’s Task Manager with Shift+Esc.', 'muted'), search, list,
    button('Sleep selected tabs', () => perform({ type: 'sleep', scope: 'selected', tabIds: [...chosen] })));
  const body = el('div', undefined, 'stack');
  body.append(el('p', 'Unload pages to free memory. Tabs stay in place and reload when opened. Unsaved entries or page state may be lost.'),
    el('p', 'Active, pinned, audio-playing, and browser-protected tabs are skipped.', 'muted'),
    count, suggestions, button('Sleep inactive tabs', () => perform({ type: 'sleep', scope: 'inactive' })), groupControls, individual);
  panel.append(summary, body);
  return { panel, update };
}
