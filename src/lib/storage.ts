import type { Settings, Snapshot } from './types';

export const DEFAULTS: Settings = {
  provider: 'none', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '',
  titlesOnly: false, excludedDomains: [], includePinned: false,
  existingGroups: 'keep', unassigned: 'other', mergeSubdomains: false, presets: [],
};
export async function settings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(data.settings as Partial<Settings> | undefined) };
}
export async function saveSettings(value: Settings): Promise<void> { await chrome.storage.local.set({ settings: value }); }
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
