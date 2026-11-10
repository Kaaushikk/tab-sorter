const MENU = 'tab-sorter:open-link';
const LINK_CONTEXT: Pick<chrome.contextMenus.CreateProperties, 'contexts' | 'targetUrlPatterns'> = {
  contexts: ['link'],
  targetUrlPatterns: ['https://*/*', 'http://*/*'],
};

function menuOperation(operation: (done: () => void) => void): Promise<void> {
  return new Promise((resolve, reject) => operation(() => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message));
    else resolve();
  }));
}

function createItem(properties: chrome.contextMenus.CreateProperties): Promise<void> {
  return menuOperation(done => { chrome.contextMenus.create({ ...LINK_CONTEXT, ...properties }, done); });
}

function groupItems(groups: chrome.tabGroups.TabGroup[]): { id: string; title: string }[] {
  const names = groups.map(group => group.title?.trim() || 'Unnamed group');
  const totals = new Map<string, number>(), seen = new Map<string, number>();
  for (const name of names) totals.set(name, (totals.get(name) ?? 0) + 1);
  return groups.map((group, index) => {
    const name = names[index], occurrence = (seen.get(name) ?? 0) + 1;
    seen.set(name, occurrence);
    return {
      id: `${MENU}:${group.windowId}:${group.id}`,
      title: totals.get(name) === 1 ? name : `${name} (${group.color}, ${occurrence})`,
    };
  });
}

async function openLink(info: chrome.contextMenus.OnClickData, source?: chrome.tabs.Tab): Promise<void> {
  if (typeof info.menuItemId !== 'string' || !info.menuItemId.startsWith(MENU + ':') || !info.linkUrl || !source || source.incognito) return;
  const ids = /^(\d+):(\d+)$/.exec(info.menuItemId.slice(MENU.length + 1));
  if (!ids) return;
  const windowId = Number(ids[1]), groupId = Number(ids[2]);
  if (source.windowId !== windowId) return;
  const url = new URL(info.linkUrl);
  if (!['https:', 'http:'].includes(url.protocol)) return;
  if ((await chrome.tabGroups.get(groupId)).windowId !== windowId) return;

  const tab = await chrome.tabs.create({ windowId, url: url.href, active: false });
  if (tab.id === undefined || tab.windowId !== windowId) return;
  // The group can move or disappear while the browser creates the tab.
  if ((await chrome.tabGroups.get(groupId)).windowId === windowId) {
    await chrome.tabs.group({ tabIds: tab.id, groupId });
  }
}

export function registerLinkMenu(): void {
  if (!chrome.contextMenus || !chrome.tabGroups?.get || !chrome.tabs?.group) return;
  let pending = false, running = false, rendered = '';
  async function rebuild(): Promise<void> {
    const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const groups = window.id !== undefined && !window.incognito
      ? (await chrome.tabGroups.query({ windowId: window.id })).filter(group => group.windowId === window.id)
      : [];
    if (pending) return;
    const items = groupItems(groups);
    const signature = JSON.stringify(items);
    if (rendered === signature) return;
    rendered = '';
    await menuOperation(done => { chrome.contextMenus.removeAll(done); });
    await createItem({ id: MENU, title: items.length ? 'Open link in tab group' : 'Open link in tab group (no groups)', enabled: !!items.length });
    await Promise.all(items.map(item => createItem({ ...item, parentId: MENU })));
    rendered = signature;
  }
  async function refresh(): Promise<void> {
    pending = true;
    if (running) return;
    running = true;
    try {
      while (pending) {
        pending = false;
        await rebuild().catch(() => { rendered = ''; });
      }
    } finally { running = false; }
  }
  const changed = () => { void refresh(); };
  chrome.windows.onFocusChanged.addListener(changed);
  chrome.tabGroups.onCreated.addListener(changed);
  chrome.tabGroups.onUpdated.addListener(changed);
  chrome.tabGroups.onMoved.addListener(changed);
  chrome.tabGroups.onRemoved.addListener(changed);
  chrome.runtime.onInstalled.addListener(changed);
  chrome.runtime.onStartup.addListener(changed);
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    // If a group vanishes after opening the link, leave the new tab in place.
    void openLink(info, tab).catch(changed);
  });
  changed();
}
