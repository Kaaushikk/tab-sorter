import { afterEach, expect, it, vi } from 'vitest';
import { chatgptSettings } from '../src/options/chatgpt';
import { CHATGPT_HELPER, CHATGPT_PERMISSION } from '../src/lib/chatgpt';

class ElementStub {
  value = '';
  textContent = '';
  children: ElementStub[] = [];
  private onClick?: () => void;
  append(...children: ElementStub[]): void { this.children.push(...children); }
  replaceChildren(...children: ElementStub[]): void { this.children = children; }
  setAttribute(): void {}
  addEventListener(event: string, callback: () => void): void { if (event === 'click') this.onClick = callback; }
  click(): void { this.onClick?.(); }
}

afterEach(() => vi.unstubAllGlobals());

it('pairs a new browser and saves a model without signing in again when the helper already has an account', async () => {
  vi.stubGlobal('document', { createElement: () => new ElementStub() });
  const request = vi.fn().mockResolvedValue(true), create = vi.fn().mockResolvedValue({});
  vi.stubGlobal('chrome', {
    permissions: { request }, tabs: { create },
    storage: { local: { get: vi.fn().mockResolvedValue({ chatgptWelcome: true }) } },
  });
  const key = 'k'.repeat(43), secret = 's'.repeat(43);
  const approvalUrl = CHATGPT_HELPER + '/pair/approve/' + 'a'.repeat(43);
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ approvalUrl, secret }))
    .mockResolvedValueOnce(Response.json({ key }))
    .mockResolvedValueOnce(Response.json({
      active: 'saved', connected: true, accounts: [{ id: 'saved', label: 'Test account' }],
      models: [{ id: 'other', name: 'Other' }, { id: 'gpt-6.1-sol', name: 'Sol' }],
    }));
  vi.stubGlobal('fetch', fetcher);
  const activate = vi.fn().mockResolvedValue(undefined);
  const { panel } = chatgptSettings('', '', activate);
  const controls = (panel as unknown as ElementStub).children[1];
  const connect = controls.children.find(child => child.textContent === 'Continue with ChatGPT');
  expect(connect).toBeDefined();
  connect!.click();

  await vi.waitFor(() => expect(activate).toHaveBeenCalledWith(key, 'gpt-6.1-sol'));
  expect(request).toHaveBeenCalledWith({ origins: [CHATGPT_PERMISSION] });
  expect(create).toHaveBeenCalledExactlyOnceWith({ url: approvalUrl });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/pair/start', '/pair/redeem', '/status'].map(path => CHATGPT_HELPER + path));
});
