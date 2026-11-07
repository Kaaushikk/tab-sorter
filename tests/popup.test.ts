import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/lib/storage';
import type { Command } from '../src/lib/types';

class ElementStub {
  textContent = '';
  children: (ElementStub | string)[] = [];
  constructor(readonly tag: string) {}
  append(...nodes: (ElementStub | string)[]): void { this.children.push(...nodes); }
  replaceChildren(...nodes: (ElementStub | string)[]): void { this.children = nodes; }
  setAttribute(): void {}
  addEventListener(): void {}
  querySelectorAll(): ElementStub[] { return []; }
  get text(): string { return this.textContent + this.children.map(child => typeof child === 'string' ? child : child.text).join(''); }
}

afterEach(() => vi.unstubAllGlobals());

it.each(['none', 'chatgpt'] as const)('opens the popup with %s settings after loading window state', async provider => {
  vi.resetModules();
  const root = new ElementStub('main');
  vi.stubGlobal('document', {
    querySelector: () => root, createElement: (tag: string) => new ElementStub(tag), addEventListener: () => {},
  });
  const sendMessage = vi.fn(async (command: Command) => ({
    ok: true, value: command.type === 'aiStatus' ? null : {
      tabs: [], groups: [], strategies: [], snapshots: [], settings: { ...DEFAULTS, provider },
    },
  }));
  vi.stubGlobal('chrome', { windows: { getCurrent: async () => ({ id: 1 }) }, runtime: { sendMessage } });
  await import('../src/popup/index');
  await vi.waitFor(() => expect(root.text).toContain('This window only · 0 tabs'));
  expect(root.text).toContain('Suggest groupings');
  expect(root.text).toContain(provider === 'chatgpt' ? 'Using ChatGPT plan · Manage ChatGPT usage' : 'Local strategies always work');
});
