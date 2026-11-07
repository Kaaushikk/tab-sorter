import type { Settings, Snapshot } from './types';

export const DEFAULTS: Settings = {
  provider: 'none', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '',
  chatgptKey: '', chatgptModel: '',
  titlesOnly: false, excludedDomains: [], includePinned: false,
  existingGroups: 'keep', unassigned: 'other', mergeSubdomains: false, presets: [],
};
export const FAST_OPENROUTER_MODEL = 'google/gemma-4-26b-a4b-it:free';
export function isOpenRouter(s: Pick<Settings, 'provider' | 'baseUrl'>): boolean {
  try { return s.provider === 'openai' && new URL(s.baseUrl).hostname === 'openrouter.ai'; }
  catch { return false; }
}
export async function settings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  const value = { ...DEFAULTS, ...(data.settings as Partial<Settings> | undefined) };
  // Upgrade only the old free-router choice, once. Explicit models are preserved.
  if (isOpenRouter(value) && value.model === 'openrouter/free' && !(await chrome.storage.local.get('freeModelMigrated')).freeModelMigrated) {
    value.model = FAST_OPENROUTER_MODEL;
    await chrome.storage.local.set({ settings: value, freeModelMigrated: true });
  }
  return value;
}
export async function saveSettings(value: Settings): Promise<void> { await chrome.storage.local.set({ settings: value, freeModelMigrated: true }); }
export async function epoch(): Promise<string> {
  const data = await chrome.storage.session.get('epoch');
  if (typeof data.epoch === 'string') return data.epoch;
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ epoch: id });
  return id;
}
export async function snapshots(windowId: number): Promise<Snapshot[]> {
  return ((await chrome.storage.local.get(`undo:${windowId}`))[`undo:${windowId}`] as Snapshot[] | undefined) ?? [];
}
export async function putSnapshot(s: Snapshot): Promise<void> {
  const prior = await snapshots(s.windowId);
  await chrome.storage.local.set({ [`undo:${s.windowId}`]: [s, ...prior.filter(x => x.id !== s.id)].sort((a,b) => b.createdAt - a.createdAt).slice(0, 5) });
}
export async function frequency(id?: string): Promise<Record<string, number>> {
  const data = ((await chrome.storage.local.get('frequency')).frequency as Record<string, number> | undefined) ?? {};
  if (id) { data[id] = (data[id] ?? 0) + 1; await chrome.storage.local.set({ frequency: data }); }
  return data;
}
export async function clearUndo(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('undo:')));
}
