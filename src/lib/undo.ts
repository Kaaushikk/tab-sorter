import { makeGroup, moveTab, readWindow, ungroup, updateGroup, assertTabs } from './browser';
import { epoch, putSnapshot, snapshots } from './storage';
import type { Group, Result, Snapshot, Strategy, Tab } from './types';

export async function beginSnapshot(windowId: number, label: string): Promise<Snapshot> {
  const state = await readWindow(windowId);
  const s: Snapshot = { id: crypto.randomUUID(), windowId, epoch: await epoch(), createdAt: Date.now(), label, before: state.tabs, beforeGroups: state.groups, after: state.tabs, afterGroups: state.groups, created: [], restored: [], status: 'pending' };
  await putSnapshot(s); return s;
}
export async function checkpoint(s: Snapshot, final = false): Promise<void> {
  const now = await readWindow(s.windowId);
  s.after = now.tabs; s.afterGroups = now.groups;
  if (final) s.status = 'ready';
  await putSnapshot(s);
}
export async function applyPlan(windowId: number, strategy: Strategy, mode: 'keep' | 'merge' | 'dissolve'): Promise<Snapshot> {
  const s = await beginSnapshot(windowId, strategy.label);
  try {
    const ids = strategy.groups.flatMap(g => g.tabIds);
    if (mode === 'dissolve') { await ungroup(windowId, s.before.filter(t => ids.includes(t.id) && t.groupId !== -1).map(t => t.id)); await checkpoint(s); }
    for (const group of strategy.groups) {
      const current = await readWindow(windowId);
      if (mode === 'keep' && current.tabs.some(t => group.tabIds.includes(t.id) && t.groupId !== -1)) throw new Error('A tab was grouped since preview. Refresh before applying.');
      const matches = mode === 'merge' ? current.groups.filter(g => g.title === group.name && g.color === group.color) : [];
      if (matches.length > 1) throw new Error('More than one existing group matches. Rename it or choose Dissolve in settings.');
      const groupId = await makeGroup(windowId, group.tabIds, matches[0]?.id);
      // Persist membership immediately, before metadata updates that can fail.
      s.created.push({ groupId, title: group.name, color: group.color, tabIds: group.tabIds });
      await checkpoint(s);
      await updateGroup(windowId, groupId, { title: group.name, color: group.color });
      await checkpoint(s);
    }
    await checkpoint(s, true); return s;
  } catch {
    s.status = 'partial'; await checkpoint(s); await putSnapshot(s);
    throw new Error('Grouping stopped because tabs changed or the browser rejected an operation. Any completed changes are available in Undo history.');
  }
}

// Only a unique URL can identify a tab across browser restarts. Never guess duplicates.
export function remapSnapshot(s: Snapshot, tabs: Tab[], groups: Group[], currentEpoch: string, windowId: number): Snapshot | undefined {
  if (s.epoch === currentEpoch) return s.windowId === windowId ? s : undefined;
  const mapping = new Map<number, number>();
  for (const tab of s.after) {
    if (tab.id < 0) continue;
    const old = s.after.filter(t => t.url === tab.url), now = tabs.filter(t => t.url === tab.url);
    if (tab.url && old.length === 1 && now.length === 1) mapping.set(tab.id, now[0].id);
  }
  if (!mapping.size) return undefined;
  const gm = new Map<number, number>();
  for (const group of s.afterGroups) {
    const members = s.after.filter(t => t.groupId === group.id).map(t => mapping.get(t.id)).filter((id): id is number => id !== undefined);
    const matches = groups.filter(g => g.title === group.title && g.color === group.color && members.length > 0 && members.every(id => tabs.some(t => t.id === id && t.groupId === g.id)));
    if (matches.length === 1) gm.set(group.id, matches[0].id);
  }
  for (const [oldIdText, restoredId] of Object.entries(s.restoredGroups ?? {})) {
    const oldId = Number(oldIdText), old = s.beforeGroups.find(g => g.id === oldId);
    const members = s.before.filter(t => t.groupId === oldId && s.restored.includes(t.id)).map(t => mapping.get(t.id)).filter((id): id is number => id !== undefined);
    const matches = groups.filter(g => old && g.title === old.title && g.color === old.color && members.length > 0 && members.every(id => tabs.some(t => t.id === id && t.groupId === g.id)));
    if (matches.length === 1) { gm.set(oldId, matches[0].id); gm.set(restoredId, matches[0].id); }
  }
  const missing = (id: number) => id < 0 ? id : -1000000 - id;
  const mapTabs = (items: Tab[]) => items.map(t => ({ ...t, windowId, id: mapping.get(t.id) ?? missing(t.id), groupId: gm.get(t.groupId) ?? (t.groupId === -1 ? -1 : missing(t.groupId)) }));
  const mapGroups = (items: Group[]) => items.map(g => ({ ...g, id: gm.get(g.id) ?? missing(g.id) }));
  return { ...s, windowId, epoch: currentEpoch, before: mapTabs(s.before), after: mapTabs(s.after), beforeGroups: mapGroups(s.beforeGroups), afterGroups: mapGroups(s.afterGroups), restoredGroups: Object.fromEntries(Object.entries(s.restoredGroups ?? {}).map(([old,id]) => [gm.get(Number(old)) ?? missing(Number(old)), gm.get(id) ?? missing(id)])), restored: s.restored.map(id => mapping.get(id) ?? missing(id)), created: s.created.map(g => ({ ...g, groupId: gm.get(g.groupId) ?? missing(g.groupId), tabIds: g.tabIds.map(id => mapping.get(id) ?? missing(id)) })) };
}
export async function recoverWindow(windowId: number): Promise<string | undefined> {
  const currentEpoch = await epoch();
  const current = await readWindow(windowId);
  const local = await snapshots(windowId);
  const all = await chrome.storage.local.get(null);
  // Preserve shutdown histories for restart recovery; expire unmatched histories.
  const expired = Object.entries(all).filter(([key,value]) => key.startsWith('undo:') && key !== `undo:${windowId}` && Array.isArray(value) && value.every((s: Snapshot) => s.closedAt && (s.epoch === currentEpoch || Date.now() - s.closedAt > 7 * 86400000))).map(([key]) => key);
  if (expired.length) { await chrome.storage.local.remove(expired); for (const key of expired) delete all[key]; }
  if (local.length && local.every(s => s.epoch === currentEpoch)) return;
  const candidates = Object.entries(all).filter(([key, value]) => key.startsWith('undo:') && Array.isArray(value)).map(([key,value]) => ({ key, entries: value as Snapshot[] }));
  const matches = candidates.filter(({ entries }) => entries.some(s => s.epoch !== currentEpoch && s.after.filter(t => t.url && current.tabs.some(n => n.url === t.url)).length >= Math.max(1, Math.ceil(s.after.length * .6))));
  if (matches.length !== 1) return matches.length > 1 ? 'Undo history could match several old windows; no history was attached.' : undefined;
  const match = matches[0];
  const mapped = match.entries.flatMap(s => { const result = remapSnapshot(s, current.tabs, current.groups, currentEpoch, windowId); return result ? [result] : []; });
  if (!mapped.length) return;
  await chrome.storage.local.set({ [`undo:${windowId}`]: mapped.slice(0, 5) });
  if (match.key !== `undo:${windowId}`) await chrome.storage.local.remove(match.key);
  return 'Undo history recovered from this window’s URLs. Ambiguous or missing tabs will be skipped.';
}

function equalMembers(a: number[], b: number[]): boolean { return a.length === b.length && a.every(id => b.includes(id)); }
export async function undoSnapshot(windowId: number, snapshotId: string, onlyGroup?: number): Promise<Result> {
  const history = await snapshots(windowId);
  const s = history.find(x => x.id === snapshotId);
  if (!s) throw new Error('This undo snapshot is no longer available.');
  const current = await readWindow(windowId);
  const chosen = onlyGroup === undefined ? s.created.filter(g => !g.undone) : s.created.filter(g => g.groupId === onlyGroup && !g.undone);
  const requested = onlyGroup === undefined
    ? s.before.filter(t => { const after = s.after.find(a => a.id === t.id); return after && (after.groupId !== t.groupId || after.pinned !== t.pinned || chosen.some(g => g.tabIds.includes(t.id))); }).map(t => t.id)
    : chosen.flatMap(g => g.tabIds);
  let skipped = 0, restored = 0;
  const candidates: Tab[] = [];
  for (const id of [...new Set(requested)].filter(id => !s.restored.includes(id))) {
    const before = s.before.find(t => t.id === id), after = s.after.find(t => t.id === id), now = current.tabs.find(t => t.id === id);
    const g = after && current.groups.find(g => g.id === after.groupId), expected = after && s.afterGroups.find(g => g.id === after.groupId);
    if (!before || !after || !now || now.url !== after.url || now.groupId !== after.groupId || now.pinned !== after.pinned || (expected && (!g || g.title !== expected.title || g.color !== expected.color))) { skipped++; continue; }
    candidates.push(before);
  }
  s.restoredGroups ??= {};
  for (const before of candidates.sort((a,b) => a.index - b.index)) {
    const prior = s.beforeGroups.find(g => g.id === before.groupId);
    try {
      if (prior) {
        const fresh = await readWindow(windowId);
        let destination: number | undefined = s.restoredGroups[prior.id];
        {
          const existing = fresh.groups.find(g => g.id === (destination ?? prior.id));
          if (existing) {
            const expectedMembers = [...s.after.filter(t => t.groupId === prior.id && !s.restored.includes(t.id)).map(t => t.id), ...s.before.filter(t => t.groupId === prior.id && s.restored.includes(t.id)).map(t => t.id)];
            const actualMembers = fresh.tabs.filter(t => t.groupId === existing.id).map(t => t.id);
            const expectedGroup = destination === undefined ? s.afterGroups.find(g => g.id === prior.id) : prior;
            if (!expectedGroup || existing.title !== expectedGroup.title || existing.color !== expectedGroup.color || !equalMembers([...new Set(expectedMembers)], actualMembers)) { skipped++; continue; }
            destination = existing.id;
          } else {
            if (fresh.groups.some(g => g.title === prior.title && g.color === prior.color)) { skipped++; continue; }
            destination = undefined;
          }
          // Moving a tab after regrouping can silently ungroup it in Chromium.
          if (destination === undefined || fresh.tabs.find(t => t.id === before.id)?.groupId !== destination) {
            await ungroup(windowId, [before.id]);
            await moveTab(windowId, before.id, before.index);
            destination = await makeGroup(windowId, [before.id], destination);
          }
          await updateGroup(windowId, destination, { title: prior.title, color: prior.color, collapsed: prior.collapsed });
          s.restoredGroups[prior.id] = destination;
        }
      } else { await ungroup(windowId, [before.id]); await moveTab(windowId, before.id, before.index); }
      await assertTabs(windowId, [before.id]);
      if (before.pinned) await chrome.tabs.update(before.id, { pinned: true });
      s.restored.push(before.id); restored++;
      await putSnapshot(s);
    } catch { skipped++; }
  }
  for (const group of chosen) {
    if (group.tabIds.every(id => s.restored.includes(id))) group.undone = true;
  }
  if (onlyGroup === undefined && skipped === 0) s.status = 'undone';
  await putSnapshot(s);
  // Follow recreated group IDs in earlier snapshots for multi-level undo.
  for (const earlier of history.filter(x => x.createdAt < s.createdAt && x.id !== s.id)) {
    let changed = false;
    for (const [oldIdText,newId] of Object.entries(s.restoredGroups)) {
      const oldId = Number(oldIdText); if (oldId === newId) continue;
      for (const tab of [...earlier.before,...earlier.after]) if (tab.groupId === oldId) { tab.groupId = newId; changed = true; }
      for (const group of [...earlier.beforeGroups,...earlier.afterGroups]) if (group.id === oldId) { group.id = newId; changed = true; }
      for (const group of earlier.created) if (group.groupId === oldId) { group.groupId = newId; changed = true; }
    }
    if (changed) await putSnapshot(earlier);
  }
  return { restored, skipped, message: `Restored ${restored} tab${restored === 1 ? '' : 's'}.${skipped ? ` Left ${skipped} missing, moved, or conflicting tab${skipped === 1 ? '' : 's'} alone.` : ''}` };
}
