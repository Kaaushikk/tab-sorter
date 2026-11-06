import { COLORS, type ContentType, type Plan, type PlanGroup, type Settings, type Strategy, type Tab } from './types';

const labels: Record<ContentType, string> = { video: 'Videos', article: 'Articles', docs: 'Documents', code: 'Code', social: 'Social', shopping: 'Shopping', search: 'Search', other: 'Other' };
export function contentType(tab: Pick<Tab, 'hostname' | 'url'>): ContentType {
  const h = tab.hostname.replace(/^www\./, ''), p = safePath(tab.url);
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|netflix\.com)$/.test(h) || /\.(mp4|webm)$/.test(p)) return 'video';
  if (/(^|\.)(github\.com|gitlab\.com|bitbucket\.org|stackoverflow\.com|codepen\.io|npmjs\.com)$/.test(h)) return 'code';
  if (/(^|\.)(docs\.google\.com|notion\.so|notion\.site|office\.com|overleaf\.com)$/.test(h) || /\.(pdf|docx?|pptx?|xlsx?)$/.test(p) || h.startsWith('docs.')) return 'docs';
  if (/(^|\.)(reddit\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|linkedin\.com|bsky\.app|discord\.com)$/.test(h)) return 'social';
  if (/(^|\.)(amazon\.[a-z.]+|ebay\.[a-z.]+|etsy\.com|walmart\.com|target\.com)$/.test(h) || /\/(product|products|cart|checkout)(\/|$)/.test(p)) return 'shopping';
  if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.brave\.com)$/.test(h) && /^\/(search)?\/?$/.test(p)) return 'search';
  if (/(^|\.)(medium\.com|substack\.com|wikipedia\.org|nytimes\.com|bbc\.com|reuters\.com)$/.test(h) || /\/(article|articles|blog|news|wiki|posts?)\//.test(p)) return 'article';
  return 'other';
}
function safePath(url: string): string { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } }
export function eligible(tabs: Tab[], settings: Settings): Tab[] {
  return tabs.filter(t => !t.incognito && (settings.includePinned || !t.pinned) && (settings.existingGroups !== 'keep' || t.groupId === -1));
}
export function websiteKey(hostname: string, merge = false): string {
  const h = hostname.replace(/^www\./, '');
  if (!merge || !h || /^[\d.]+$/.test(h) || h.includes(':')) return h || 'Browser pages';
  // A small explicit alias map avoids guessing public suffixes (e.g. co.uk).
  const families = ['google.com', 'youtube.com', 'github.com', 'amazon.com', 'microsoft.com', 'wikipedia.org'];
  return families.find(d => h === d || h.endsWith(`.${d}`)) ?? h;
}
function grouped(tabs: Tab[], key: (tab: Tab) => string): PlanGroup[] {
  const map = new Map<string, number[]>();
  for (const tab of tabs) { const k = key(tab); map.set(k, [...(map.get(k) ?? []), tab.id]); }
  return [...map].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([name, tabIds], i) => ({ name, tabIds, color: COLORS[i % COLORS.length] }));
}
export function localStrategies(tabs: Tab[], settings: Settings): Strategy[] {
  const target = eligible(tabs, settings);
  return [
    { id: 'website', label: 'By website', description: 'Keep each website together · on device', groups: grouped(target, t => websiteKey(t.hostname, settings.mergeSubdomains)) },
    { id: 'content-type', label: 'By content type', description: 'Videos, documents, code, and more · on device', groups: grouped(target, t => labels[contentType(t)]) },
  ];
}
export function isWebsiteInstruction(text: string): boolean {
  return /^\s*(?:(?:please\s+)?(?:group|sort|organize|arrange)(?:\s+(?:my|these|the|all))?(?:\s+tabs)?\s+by\s+)?(?:websites?|domains?|hosts?|sites?)(?:\s+only)?[.!]?\s*$/i.test(text);
}
export function batchTabs<T>(tabs: T[], size = 150): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('Invalid batch size');
  const batches: T[][] = [];
  for (let i = 0; i < tabs.length; i += size) batches.push(tabs.slice(i, i + size));
  return batches;
}
export function completePlan(plan: Plan, tabs: Tab[], unassigned: Settings['unassigned']): Plan {
  const assigned = new Set(plan.groups.flatMap(g => g.tabIds));
  const rest = tabs.filter(t => !assigned.has(t.id)).map(t => t.id);
  const groups = plan.groups.map(g => ({ ...g, tabIds: [...g.tabIds] }));
  if (rest.length && unassigned === 'other') {
    const other = groups.find(g => g.name === 'Other');
    if (other) other.tabIds.push(...rest); else groups.push({ name: 'Other', color: 'grey', tabIds: rest });
  }
  return { groups };
}
