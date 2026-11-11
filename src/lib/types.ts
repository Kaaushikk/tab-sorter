export const COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'] as const;
export type Color = typeof COLORS[number];
export type ContentType = 'video' | 'article' | 'docs' | 'code' | 'social' | 'shopping' | 'search' | 'other';
export interface Tab { id: number; windowId: number; index: number; title: string; url: string; hostname: string; pinned: boolean; incognito: boolean; groupId: number; active?: boolean; audible?: boolean; discarded?: boolean; autoDiscardable?: boolean }
export interface Group { id: number; title: string; color: Color; collapsed: boolean }
export interface PlanGroup { name: string; color: Color; tabIds: number[] }
export interface Plan { groups: PlanGroup[] }
export interface Strategy extends Plan { id: string; label: string; description: string }
export type ProviderKind = 'none' | 'anthropic' | 'openai' | 'ollama' | 'chatgpt';
export interface Settings {
  provider: ProviderKind; baseUrl: string; model: string; apiKey: string;
  chatgptKey: string; chatgptModel: string;
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
export interface WindowState { windowId: number; tabs: Tab[]; groups: Group[]; strategies: Strategy[]; snapshots: Snapshot[]; settings: Omit<Settings, 'apiKey' | 'chatgptKey'>; notice?: string }
export interface Result { restored: number; skipped: number; message: string }
export interface MemoryResult { discarded: number; skipped: number; message: string }
export type MemoryCommand = (
  | { type: 'sleep'; scope: 'selected'; tabIds: number[] }
  | { type: 'sleep'; scope: 'group'; groupId: number }
  | { type: 'sleep'; scope: 'inactive' }
) & { windowId: number };
export type AiStage = 'preparing' | 'connecting' | 'waiting' | 'receiving' | 'validating' | 'retrying';
export interface AiProgress { stage?: AiStage; attempt?: number; batch?: number; batches?: number; characters?: number }
export interface AiControl { signal: AbortSignal; report(progress: AiProgress): Promise<void> | void }
export interface AiJob extends AiProgress {
  id: string; model: string; startedAt: number; updatedAt: number; stage: AiStage;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'; error?: string; selectedId?: string;
}
export type AiCommand = ({ type: 'suggest' } | { type: 'custom'; instruction: string } | { type: 'refine'; strategy: Strategy; instruction: string }) & { windowId: number; requestId?: string };
export type Command =
  | { type: 'load'; windowId: number }
  | AiCommand
  | MemoryCommand
  | { type: 'aiStatus'; windowId: number }
  | { type: 'cancelAi'; windowId: number; requestId: string }
  | { type: 'ungroupAll'; windowId: number }
  | { type: 'collapseAll'; windowId: number }
  | { type: 'apply'; windowId: number; strategy: Strategy }
  | { type: 'undo'; windowId: number; snapshotId: string; groupId?: number }
  | { type: 'groupAction'; windowId: number; groupId: number; action: 'ungroup' | 'toggle' };
export type Response<T> = { ok: true; value: T } | { ok: false; error: string };
