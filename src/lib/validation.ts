import { COLORS, type Plan, type Strategy } from './types';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !(k in value))) throw new Error('JSON fields do not match the required schema.');
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid or missing text in AI output.');
  return value.trim();
}
export function parseJSON(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}
export function validatePlan(input: unknown, allowed: Set<number>): Plan {
  const root = object(input); exact(root, ['groups']);
  if (!Array.isArray(root.groups) || root.groups.length > Math.max(allowed.size, 1)) throw new Error('Invalid groups array.');
  const seen = new Set<number>(), names = new Set<string>();
  return { groups: root.groups.map(item => {
    const g = object(item); exact(g, ['name', 'color', 'tabIds']);
    const name = string(g.name, 80);
    if (names.has(name.toLowerCase())) throw new Error('Duplicate group names.');
    names.add(name.toLowerCase());
    if (!COLORS.includes(g.color as typeof COLORS[number])) throw new Error('Invalid group color.');
    if (!Array.isArray(g.tabIds) || !g.tabIds.length) throw new Error('A group must contain tabs.');
    const tabIds = g.tabIds.map(id => {
      if (typeof id !== 'number' || !Number.isInteger(id) || !allowed.has(id) || seen.has(id)) throw new Error('Unknown or duplicate tab ID in grouping plan.');
      seen.add(id); return id;
    });
    return { name, color: g.color as typeof COLORS[number], tabIds };
  }) };
}
export function validateStrategies(input: unknown, allowed: Set<number>): Strategy[] {
  const root = object(input); exact(root, ['strategies']);
  if (!Array.isArray(root.strategies) || root.strategies.length < 3 || root.strategies.length > 5) throw new Error('Expected 3–5 strategies.');
  const ids = new Set<string>();
  return root.strategies.map(item => {
    const s = object(item); exact(s, ['id', 'label', 'description', 'groups']);
    const id = string(s.id, 64);
    if (ids.has(id)) throw new Error('Duplicate strategy ID.'); ids.add(id);
    return { id, label: string(s.label, 80), description: string(s.description, 240), ...validatePlan({ groups: s.groups }, allowed) };
  });
}
