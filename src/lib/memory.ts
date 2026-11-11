import { readWindow } from './browser';
import type { Group, MemoryCommand, MemoryResult, Tab } from './types';

type SleepState = Partial<Pick<chrome.tabs.Tab, 'active' | 'pinned' | 'audible' | 'discarded' | 'autoDiscardable' | 'incognito' | 'url'>>;
export const SLEEP_IDLE_MINUTES = 30;

export function canSleep(tab: SleepState): boolean {
  return !tab.active && !tab.pinned && !tab.audible && !tab.discarded && !tab.incognito &&
    tab.autoDiscardable !== false && /^https?:\/\//i.test(tab.url ?? '');
}

function isIdle(tab: SleepState & { lastAccessed?: number }, now: number): boolean {
  const last = tab.lastAccessed;
  return canSleep(tab) && typeof last === 'number' && Number.isFinite(last) && last > 0 &&
    now - last >= SLEEP_IDLE_MINUTES * 60_000;
}

export function suggestSleepGroups(tabs: Tab[], groups: Group[], now = Date.now()) {
  const loadedByGroup = new Map<number, Tab[]>();
  for (const tab of tabs) {
    if (tab.groupId < 0 || tab.discarded) continue;
    const members = loadedByGroup.get(tab.groupId) ?? [];
    members.push(tab);
    loadedByGroup.set(tab.groupId, members);
  }
  return groups.flatMap(group => {
    const loaded = loadedByGroup.get(group.id);
    if (!loaded?.length || !loaded.every(tab => isIdle(tab, now))) return [];
    const lastUsed = loaded.reduce((latest, tab) => Math.max(latest, tab.lastAccessed ?? 0), 0);
    return [{ id: group.id, title: group.title, count: loaded.length, lastUsed }];
  }).sort((a, b) => b.count - a.count || a.lastUsed - b.lastUsed);
}

export async function sleepTabs(command: MemoryCommand): Promise<MemoryResult> {
  if (!chrome.tabs.discard) throw new Error('This browser does not support unloading tabs.');
  if (!['selected', 'group', 'inactive'].includes(command.scope)) throw new Error('Choose which tabs to unload.');
  const onlyIdle = command.scope === 'group' && command.onlyIdle === true;
  const { tabs, groups } = await readWindow(command.windowId, { includeLastAccessed: onlyIdle });
  let target = tabs;
  if (command.scope === 'selected') {
    if (!Array.isArray(command.tabIds) || !command.tabIds.length || command.tabIds.some(id => !Number.isInteger(id) || id < 0)) {
      throw new Error('Select at least one tab to unload.');
    }
    const ids = new Set(command.tabIds);
    target = tabs.filter(tab => ids.has(tab.id));
    if (target.length !== ids.size) throw new Error('Selected tabs changed or moved. Reopen Free memory and try again.');
  }
  if (command.scope === 'group') {
    if (!groups.some(group => group.id === command.groupId)) throw new Error('That group is no longer in this window.');
    target = tabs.filter(tab => tab.groupId === command.groupId);
  }
  const now = Date.now();
  if (onlyIdle && target.some(tab => !tab.discarded && !isIdle(tab, now))) {
    throw new Error('This group has a recently used or protected tab. Review it before putting it to sleep.');
  }
  let discarded = 0;
  for (const before of target) {
    if (!canSleep(before)) continue;
    try {
      const current = await chrome.tabs.get(before.id);
      if (current.windowId !== command.windowId || current.url !== before.url || !canSleep(current)) continue;
      if (command.scope === 'group' && current.groupId !== command.groupId) continue;
      if (onlyIdle && !isIdle(current, now)) continue;
      const result = await chrome.tabs.discard(before.id);
      if (result?.discarded) discarded++;
    } catch {
      // A tab can close, move, or become ineligible while this request is running.
    }
  }
  const skipped = target.length - discarded;
  return {
    discarded, skipped,
    message: `Unloaded ${discarded} tab${discarded === 1 ? '' : 's'}.${skipped ? ` Skipped ${skipped} protected, sleeping, or unavailable tab${skipped === 1 ? '' : 's'}.` : ''} Open an unloaded tab to reload it.`,
  };
}
