import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/lib/storage';
import type { Command, Strategy } from '../src/lib/types';

class ElementStub {
  textContent = '';
  hidden = false;
  dataset: Record<string, string> = {};
  children: (ElementStub | string)[] = [];
  private clickHandler?: () => void;
  constructor(readonly tag: string) {}
  append(...nodes: (ElementStub | string)[]): void { this.children.push(...nodes); }
  replaceChildren(...nodes: (ElementStub | string)[]): void { this.children = nodes; }
  setAttribute(): void {}
  addEventListener(event: string, listener: () => void): void { if (event === 'click') this.clickHandler = listener; }
  click(): void { this.clickHandler?.(); }
  querySelectorAll(): ElementStub[] { return []; }
  get childElementCount(): number { return this.children.filter(node => typeof node !== 'string').length; }
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

it('shows returned AI groupings below the suggest button and above local strategies', async () => {
  vi.resetModules();
  const root = new ElementStub('main');
  vi.stubGlobal('document', {
    querySelector: () => root, createElement: (tag: string) => new ElementStub(tag),
    createTextNode: (text: string) => text, addEventListener: () => {},
  });
  const local: Strategy = { id: 'website', label: 'By website', description: '', groups: [] };
  const ai: Strategy = { id: 'ai:topic', label: 'By topic', description: '', groups: [{ name: 'Reading', color: 'blue', tabIds: [1] }] };
  const state = { tabs: [], groups: [], strategies: [local], snapshots: [], settings: DEFAULTS };
  const sendMessage = vi.fn(async (command: Command) => ({
    ok: true, value: command.type === 'aiStatus' ? null
      : command.type === 'suggest' ? { state: { ...state, strategies: [local, ai] } } : state,
  }));
  vi.stubGlobal('chrome', { windows: { getCurrent: async () => ({ id: 1 }) }, runtime: { sendMessage } });
  await import('../src/popup/index');
  await vi.waitFor(() => expect(root.text).toContain('By website'));
  const elements = root.children.filter((node): node is ElementStub => typeof node !== 'string');
  const buttonIndex = elements.findIndex(node => node.tag === 'button' && node.text.includes('Suggest groupings'));
  const resultsIndex = elements.findIndex(node => node.text === 'Suggested groupings');
  const localIndex = elements.findIndex(node => node.text.startsWith('Local strategiesBy website'));
  expect(elements[resultsIndex].hidden).toBe(true);
  elements[buttonIndex].click();
  await vi.waitFor(() => expect(elements[resultsIndex].text).toContain('By topicReading · 1'));
  expect(elements[resultsIndex].hidden).toBe(false);
  expect(resultsIndex).toBeGreaterThan(buttonIndex);
  expect(localIndex).toBeGreaterThan(resultsIndex);
  expect(elements[localIndex].text).not.toContain('By topic');
});
