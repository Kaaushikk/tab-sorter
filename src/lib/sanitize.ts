import { contentType } from './grouping';
import type { Settings, Tab } from './types';

export function excluded(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase();
  return domains.some(raw => { const d = raw.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, ''); return d && (host === d || host.endsWith(`.${d}`)); });
}
export function aiTabs(tabs: Tab[], settings: Settings) {
  return tabs.flatMap(tab => {
    if (tab.incognito || excluded(tab.hostname, settings.excludedDomains)) return [];
    try {
      const url = new URL(tab.url);
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      const title = (tab.title || tab.hostname).slice(0, 400);
      if (settings.titlesOnly) return [{ id: tab.id, title }];
      return [{ id: tab.id, title, hostname: url.hostname, path: url.pathname.slice(0, 600), contentType: contentType(tab) }];
    } catch { return []; }
  });
}
export function endpointOrigin(base: string): string {
  const u = new URL(base);
  if (u.username || u.password || u.search || u.hash) throw new Error('Use an endpoint without credentials, query strings, or fragments.');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('Use HTTPS, or HTTP on localhost for a local provider.');
  return `${u.origin}/*`;
}
