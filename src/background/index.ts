import { readWindow, ungroup, updateGroup } from '../lib/browser';
import { eligible, localStrategies } from '../lib/grouping';
import { customPlan, suggest } from '../lib/providers';
import { frequency, settings, snapshots } from '../lib/storage';
import { applyPlan, beginSnapshot, checkpoint, recoverWindow, undoSnapshot } from '../lib/undo';
import { validatePlan } from '../lib/validation';
import { aiTabs } from '../lib/sanitize';
import { aiStatus, cancelAi, clearAiWindow, runAiJob } from '../lib/ai-jobs';
import type { Command, Response, Strategy, WindowState } from '../lib/types';
import { registerLinkMenu } from './link-menu';

async function load(windowId: number): Promise<WindowState> {
  const notice = await recoverWindow(windowId);
  const current = await readWindow(windowId), s = await settings(), counts = await frequency();
  const { apiKey, chatgptKey, ...safeSettings } = s; void apiKey; void chatgptKey;
  const cache = (await chrome.storage.session.get(`preview:${windowId}`))[`preview:${windowId}`] as { strategies: Strategy[]; tabs?: typeof current.tabs } | undefined;
  const local = localStrategies(current.tabs, s);
  await chrome.storage.session.set({ [`seen:${windowId}`]: current.tabs.map(t => ({ id:t.id, url:t.url, groupId:t.groupId, pinned:t.pinned })) });
  const ids = new Set(aiTabs(eligible(current.tabs, s), s).map(t => t.id));
  const ai = ((cache?.strategies ?? []) as Strategy[]).filter(x => {
    try {
      validatePlan({ groups: x.groups }, ids);
      return x.id.startsWith('ai:') && x.groups.flatMap(g => g.tabIds).every(id => {
        const before = cache?.tabs?.find(t => t.id === id), now = current.tabs.find(t => t.id === id);
        return before && now && before.url === now.url && before.groupId === now.groupId && before.pinned === now.pinned;
      });
    } catch { return false; }
  });
  return { windowId, ...current, settings: safeSettings, notice, strategies: [...local, ...ai].sort((a,b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0)), snapshots: await snapshots(windowId) };
}
async function execute(c: Command): Promise<unknown> {
  const windowId = c.windowId;
  if (c.type === 'load') return load(windowId);
  if (c.type === 'aiStatus') return (await aiStatus(windowId)) ?? null;
  if (c.type === 'cancelAi') return { cancelled: await cancelAi(windowId, c.requestId) };
  const current = await readWindow(windowId), s = await settings();
  if (c.type === 'suggest' || c.type === 'custom' || c.type === 'refine') {
    return runAiJob(windowId, c.requestId ?? crypto.randomUUID(), s.provider === 'chatgpt' ? s.chatgptModel : s.model, async (control, publish) => {
      const result = c.type === 'suggest' ? await suggest(current.tabs, s, control) : [await customPlan(current.tabs, s, c.instruction, c.type === 'refine' ? c.strategy : undefined, control)];
      const strategies = c.type === 'suggest' ? result : [...(await load(windowId)).strategies.filter(x => x.id.startsWith('ai:') && x.id !== result[0].id), ...result];
      publish(); // Once results are ready to store, cancellation cannot discard them halfway through.
      await chrome.storage.session.set({ [`preview:${windowId}`]: { strategies, tabs: current.tabs, updatedAt: Date.now() } });
      return { state: await load(windowId), selectedId: c.type === 'suggest' ? undefined : result[0].id };
    });
  }
  if (c.type === 'apply') {
    const eligibleTabs = eligible(current.tabs, s);
    const aiIds = new Set(aiTabs(eligibleTabs, s).map(t => t.id));
    const target = c.strategy.id.startsWith('ai:') ? eligibleTabs.filter(t => aiIds.has(t.id)) : eligibleTabs;
    const plan = validatePlan({ groups: c.strategy.groups }, new Set(target.map(t => t.id)));
    if (!plan.groups.length) throw new Error('There are no tabs in this plan.');
    const seen = (await chrome.storage.session.get(`seen:${windowId}`))[`seen:${windowId}`] as typeof current.tabs | undefined;
    if (!seen || plan.groups.flatMap(g => g.tabIds).some(id => {
      const before = seen.find(t => t.id === id), now = current.tabs.find(t => t.id === id);
      return !before || !now || before.url !== now.url || before.groupId !== now.groupId || before.pinned !== now.pinned;
    })) throw new Error('Tabs changed since the preview. Reopen the popup and review a fresh plan.');
    await applyPlan(windowId, { ...c.strategy, ...plan }, s.existingGroups);
    await frequency(c.strategy.id);
    await chrome.storage.session.remove([`preview:${windowId}`, `seen:${windowId}`]);
    return { message: 'Groups created. Undo individual groups below, or undo the whole grouping.' };
  }
  if (c.type === 'undo') return undoSnapshot(windowId, c.snapshotId, c.groupId);
  if (c.type === 'ungroupAll') {
    const snap = await beginSnapshot(windowId, 'Ungroup all');
    try { await ungroup(windowId, eligible(current.tabs, { ...s, existingGroups: 'dissolve' }).filter(t => t.groupId !== -1).map(t => t.id)); await checkpoint(snap, true); }
    catch { await checkpoint(snap); throw new Error('Ungroup stopped. Use Undo history to restore completed changes.'); }
    return { message: 'Ungrouped this window. Undo is available in history.' };
  }
  if (c.type === 'collapseAll') {
    for (const group of current.groups) await updateGroup(windowId, group.id, { collapsed: true });
    return { message: 'Collapsed this window’s groups.' };
  }
  const group = current.groups.find(g => g.id === c.groupId);
  if (!group) throw new Error('This group no longer exists in this window.');
  if (c.action === 'toggle') await updateGroup(windowId, group.id, { collapsed: !group.collapsed });
  else {
    const snap = await beginSnapshot(windowId, `Ungroup: ${group.title || 'Untitled'}`);
    await ungroup(windowId, current.tabs.filter(t => t.groupId === group.id).map(t => t.id));
    await checkpoint(snap, true);
  }
  return { message: c.action === 'toggle' ? 'Group updated.' : 'Group ungrouped. Restore it from Undo history.' };
}

// Serialize operations per window; progress and cancellation never wait behind fetch.
const queues = new Map<number, Promise<unknown>>();
chrome.runtime.onMessage.addListener((c: Command, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')) || !c || !Number.isInteger(c.windowId) || c.windowId < 0) return false;
  const run = async () => {
    try { const value = await execute(c); sendResponse({ ok: true, value } satisfies Response<unknown>); }
    catch (e) { sendResponse({ ok: false, error: e instanceof Error ? e.message : 'The operation failed. Refresh and try again.' } satisfies Response<unknown>); }
  };
  if (c.type === 'aiStatus' || c.type === 'cancelAi') { void run(); return true; }
  const previous = queues.get(c.windowId) ?? Promise.resolve();
  const pending = previous.then(run, run); queues.set(c.windowId, pending);
  void pending.finally(() => { if (queues.get(c.windowId) === pending) queues.delete(c.windowId); });
  return true;
});
chrome.windows.onRemoved.addListener(windowId => {
  void (async () => {
    await clearAiWindow(windowId);
    await chrome.storage.session.remove([`preview:${windowId}`, `seen:${windowId}`]);
    const history = await snapshots(windowId);
    if (history.length) await chrome.storage.local.set({ [`undo:${windowId}`]: history.map(s => ({ ...s, closedAt: Date.now() })) });
  })();
});
chrome.runtime.onInstalled.addListener(() => { void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }); });
registerLinkMenu();
