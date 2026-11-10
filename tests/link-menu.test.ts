import { afterEach, expect, it, vi } from 'vitest';
import { registerLinkMenu } from '../src/background/link-menu';

function event() {
  return { addListener: vi.fn() };
}

afterEach(() => vi.unstubAllGlobals());

it('lists groups from the focused window and opens a clicked link in its selected group', async () => {
  let focused = 1;
  const groups = [
    { id: 5, windowId: 1, title: 'Watch later', color: 'red' },
    { id: 9, windowId: 2, title: 'Work', color: 'blue' },
  ];
  const menu = new Map<string, chrome.contextMenus.CreateProperties>();
  const focus = event(), rename = event(), click = event();
  const create = vi.fn().mockResolvedValue({ id: 42, windowId: 1 });
  const group = vi.fn().mockResolvedValue(5);
  vi.stubGlobal('chrome', {
    runtime: { onInstalled: event(), onStartup: event() },
    windows: { getLastFocused: vi.fn(async () => ({ id: focused })), onFocusChanged: focus },
    tabGroups: {
      query: vi.fn(async ({ windowId }: { windowId: number }) => groups.filter(g => g.windowId === windowId)),
      get: vi.fn(async (id: number) => groups.find(g => g.id === id)),
      onCreated: event(), onUpdated: rename, onMoved: event(), onRemoved: event(),
    },
    tabs: { create, group },
    contextMenus: {
      onClicked: click,
      create(item: chrome.contextMenus.CreateProperties, done: () => void) { menu.set(String(item.id), item); done(); },
      removeAll(done: () => void) { menu.clear(); done(); },
    },
  });
  registerLinkMenu();

  const item = (title: string) => [...menu.values()].find(entry => entry.title === title);
  await vi.waitFor(() => expect(item('Watch later')).toBeDefined());
  expect(item('Work')).toBeUndefined();
  const entry = item('Watch later')!;
  expect(entry).toMatchObject({ contexts: ['link'], targetUrlPatterns: ['https://*/*', 'http://*/*'] });
  const select = click.addListener.mock.calls[0][0];
  const url = 'https://www.youtube.com/watch?v=synthetic';
  select({ menuItemId: entry.id, linkUrl: url }, { windowId: 2 });
  select({ menuItemId: entry.id, linkUrl: 'javascript:alert(1)' }, { windowId: 1 });
  select({ menuItemId: entry.id, linkUrl: url }, { windowId: 1 });
  await vi.waitFor(() => expect(group).toHaveBeenCalledExactlyOnceWith({ tabIds: 42, groupId: 5 }));
  expect(create).toHaveBeenCalledExactlyOnceWith({ windowId: 1, url, active: false });

  groups[0].title = 'Videos';
  rename.addListener.mock.calls[0][0]();
  await vi.waitFor(() => expect(item('Videos')).toBeDefined());
  focused = 2;
  focus.addListener.mock.calls[0][0]();
  await vi.waitFor(() => expect(item('Work')).toBeDefined());
  expect(item('Videos')).toBeUndefined();
});
