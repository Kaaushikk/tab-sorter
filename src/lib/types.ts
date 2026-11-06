export const COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'] as const;
export type Color = typeof COLORS[number];
export type ContentType = 'video' | 'article' | 'docs' | 'code' | 'social' | 'shopping' | 'search' | 'other';
export interface Tab { id: number; windowId: number; index: number; title: string; url: string; hostname: string; pinned: boolean; incognito: boolean; groupId: number }
export interface Group { id: number; title: string; color: Color; collapsed: boolean }
export interface PlanGroup { name: string; color: Color; tabIds: number[] }
export interface Plan { groups: PlanGroup[] }
export interface Strategy extends Plan { id: string; label: string; description: string }
export type ProviderKind = 'none' | 'anthropic' | 'openai' | 'ollama';
export interface Settings {
  provider: ProviderKind; baseUrl: string; model: string; apiKey: string;
  titlesOnly: boolean; excludedDomains: string[]; includePinned: boolean;
  existingGroups: 'keep' | 'merge' | 'dissolve'; unassigned: 'other' | 'ungrouped';
  mergeSubdomains: boolean; presets: { id: string; name: string; instruction: string }[];
}
export interface Snapshot {
  id: string; windowId: number; epoch: string; createdAt: number; label: string;
  before: Tab[]; beforeGroups: Group[]; after: Tab[]; afterGroups: Group[];
  created: { groupId: number; title: string; color: Color; tabIds: number[]; undone?: boolean }[];
  restored: number[]; restoredGroups?: Record<number, number>; status: 'pending' | 'ready' | 'partial' | 'undone'; closedAt?: number;
}
export interface WindowState { windowId: number; tabs: Tab[]; groups: Group[]; strategies: Strategy[]; snapshots: Snapshot[]; settings: Omit<Settings, 'apiKey'>; notice?: string }
export interface Result { restored: number; skipped: number; message: string }
export type Command =
  | { type: 'load'; windowId: number }
  | { type: 'suggest'; windowId: number }
  | { type: 'ungroupAll'; windowId: number }
  | { type: 'collapseAll'; windowId: number }
  | { type: 'custom'; windowId: number; instruction: string }
  | { type: 'refine'; windowId: number; strategy: Strategy; instruction: string }
  | { type: 'apply'; windowId: number; strategy: Strategy }
  | { type: 'undo'; windowId: number; snapshotId: string; groupId?: number }
  | { type: 'groupAction'; windowId: number; groupId: number; action: 'ungroup' | 'toggle' };
export type Response<T> = { ok: true; value: T } | { ok: false; error: string };
