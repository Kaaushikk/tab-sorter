import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULTS, FAST_OPENROUTER_MODEL, saveSettings, settings } from '../src/lib/storage';
import { browserMock } from './mock';
const original = { ...DEFAULTS, provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', apiKey: 'test-placeholder', titlesOnly: true, excludedDomains: ['private.example'] } as const;
let mock: ReturnType<typeof browserMock>;
beforeEach(() => { mock = browserMock(); });
afterEach(() => vi.unstubAllGlobals());

it('migrates only the old OpenRouter free-router selection and preserves other settings', async () => {
  mock.local.settings = original;
  expect(await settings()).toEqual({ ...original, model: FAST_OPENROUTER_MODEL });
  expect(mock.local.settings).toEqual({ ...original, model: FAST_OPENROUTER_MODEL });
  expect(mock.local.freeModelMigrated).toBe(true);
});
it('respects explicit model choices and does not migrate other endpoints', async () => {
  mock.local.settings = { ...original, baseUrl: 'https://example.com/v1' };
  expect((await settings()).model).toBe('openrouter/free');
  mock.local.settings = { ...original, model: 'another-provider/example:free' };
  expect((await settings()).model).toBe('another-provider/example:free');
  expect(mock.api.storage.local.set).not.toHaveBeenCalled();
});
it('does not override an explicit choice to return to the free router', async () => {
  await saveSettings({ ...original, excludedDomains: [...original.excludedDomains] });
  expect((await settings()).model).toBe('openrouter/free');
});
