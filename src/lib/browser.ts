import type { Group, Tab } from './types';

export function requireGroups(): void {
  if (!chrome.tabGroups?.query || !chrome.tabs?.group) throw new Error('Native tab groups are unavailable in this browser. Update Chrome or Brave and try again.');
}
export async function readWindow(windowId: number): Promise<{ tabs: Tab[]; groups: Group[] }> {
  if (!Number.isInteger(windowId) || windowId < 0) throw new Error('A specific browser window is required.');
  requireGroups();
  const win = await chrome.windows.get(windowId, { populate: false });
  if (win.incognito || win.type !== 'normal') throw new Error('Use Tab Sorter in a regular, non-incognito browser window.');
  // Never replace these explicit window filters with currentWindow or an unfiltered query.
  const raw = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });
  return {
    tabs: raw.filter(t => t.windowId === windowId && !t.incognito && t.id !== undefined).map(t => {
      const url = t.url || t.pendingUrl || ''; let hostname = '';
      try { hostname = new URL(url).hostname; } catch { /* Loading or browser page. */ }
      return { id: t.id!, windowId, index: t.index, title: t.title || hostname || 'Untitled tab', url, hostname, pinned: t.pinned, incognito: t.incognito, groupId: t.groupId };
    }),
    groups: groups.filter(g => g.windowId === windowId).map(g => ({ id: g.id, title: g.title ?? '', color: g.color, collapsed: g.collapsed })),
  };
}
export async function assertTabs(windowId: number, ids: number[]): Promise<Tab[]> {
  const { tabs } = await readWindow(windowId);
  const selected = tabs.filter(t => ids.includes(t.id));
  if (selected.length !== new Set(ids).size) throw new Error('Tabs changed or moved to another window. Refresh the preview and try again.');
  return selected;
}
export async function ungroup(windowId: number, ids: number[]): Promise<void> {
  if (!ids.length) return;
  await assertTabs(windowId, ids);
  await chrome.tabs.ungroup(ids as [number, ...number[]]);
}
export async function makeGroup(windowId: number, ids: number[], groupId?: number): Promise<number> {
  if (!ids.length) throw new Error('A group needs at least one tab.');
  const tabs = await assertTabs(windowId, ids);
  if (tabs.some(t => t.pinned)) {
    for (const tab of tabs.filter(t => t.pinned)) { await assertTabs(windowId, [tab.id]); await chrome.tabs.update(tab.id, { pinned: false }); }
  }
  if (groupId !== undefined) {
    const { groups } = await readWindow(windowId);
    if (!groups.some(g => g.id === groupId)) throw new Error('The destination group changed. Refresh and try again.');
  }
  const tabIds = ids as [number, ...number[]];
  return chrome.tabs.group(groupId === undefined ? { tabIds, createProperties: { windowId } } : { tabIds, groupId });
}
export async function updateGroup(windowId: number, groupId: number, changes: chrome.tabGroups.UpdateProperties): Promise<void> {
  const { groups } = await readWindow(windowId);
  if (!groups.some(g => g.id === groupId)) throw new Error('This group no longer exists in this window.');
  await chrome.tabGroups.update(groupId, changes);
}
export async function moveTab(windowId: number, id: number, index: number): Promise<void> {
  await assertTabs(windowId, [id]);
  // No destination window: never pull a tab back from another window.
  await chrome.tabs.move(id, { index });
}
