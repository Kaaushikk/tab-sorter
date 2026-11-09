import { afterEach, expect, it, vi } from 'vitest';
import { defaultModel, loadModels, OPENROUTER_URL } from '../src/options/model-setup';

afterEach(() => vi.unstubAllGlobals());

it('checks an OpenRouter key, lists compatible models, and never defaults to a paid model', async () => {
  const text = { architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['response_format'] };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: {} }))
    .mockResolvedValueOnce(Response.json({ data: [
      { ...text, id: 'example/paid', pricing: { prompt: '1', completion: '1' } },
      { ...text, id: 'example/free:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'example/embedding:free', pricing: { prompt: '0', completion: '0' } },
    ] }));
  vi.stubGlobal('fetch', fetcher);
  const models = await loadModels('openrouter', 'test-key', 'https://unrelated.example');
  expect(fetcher.mock.calls[0]).toEqual([OPENROUTER_URL + '/key', expect.objectContaining({
    headers: { Authorization: 'Bearer test-key' }, credentials: 'omit', redirect: 'error',
  })]);
  expect(fetcher.mock.calls[1][1].headers).toEqual({});
  expect(models.map(m => m.id)).toEqual(['example/free:free', 'example/paid']);
  expect(defaultModel('openrouter', models, '')?.id).toBe('example/free:free');
  expect(defaultModel('openrouter', models, 'example/paid')?.id).toBe('example/paid');
  expect(defaultModel('openrouter', models.filter(m => !m.free), '')).toBeUndefined();
});

it('offers available Claude models and prefers Haiku for a new connection', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [
    { id: 'claude-opus', display_name: 'Opus' },
    { id: 'claude-haiku', display_name: 'Haiku' },
    { id: 'claude-old', lifecycle: 'deprecated' },
  ] }));
  vi.stubGlobal('fetch', fetcher);
  const models = await loadModels('anthropic', 'test-key', '');
  expect(models.map(m => m.id)).toEqual(['claude-opus', 'claude-haiku']);
  expect(defaultModel('anthropic', models, '')?.id).toBe('claude-haiku');
  expect(fetcher).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', expect.objectContaining({
    headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
  }));
});

it('loads Ollama chat models without sending a key or picking an embedding or cloud model', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ models: [
    { name: 'nomic-embed-text:latest' }, { name: 'gemma4:cloud' }, { model: 'gemma4:4b' },
  ] }));
  vi.stubGlobal('fetch', fetcher);
  const models = await loadModels('ollama', 'ignored', 'http://localhost:11434/');
  expect(models).toEqual([{ id: 'gemma4:4b', label: 'gemma4:4b' }]);
  expect(fetcher).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.objectContaining({ headers: {} }));
});

it('loads a custom endpoint catalog without automatically choosing a model', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'example-model' }] }));
  vi.stubGlobal('fetch', fetcher);
  const models = await loadModels('openai', 'test-key', 'https://example.com/v1');
  expect(fetcher).toHaveBeenCalledWith('https://example.com/v1/models', expect.objectContaining({
    headers: { Authorization: 'Bearer test-key' }, redirect: 'error',
  }));
  expect(defaultModel('openai', models, '')).toBeUndefined();
  expect(defaultModel('openai', models, 'example-model')?.id).toBe('example-model');
});
