import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from '../src/lib/providers';
import { DEFAULTS } from '../src/lib/storage';
import { HEADER_TIMEOUT_MS, readCompletion, RESPONSE_TIMEOUT_MS } from '../src/lib/transport';
import { browserMock } from './mock';

const encoder = new TextEncoder();
const text = '{"groups":[{"name":"Reading 📚","color":"blue","tabIds":[1]}]}';
const frame = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
function response(parts: (string | Uint8Array)[], type = 'text/event-stream'): Response {
  return new Response(new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part); controller.close(); } }), { headers: { 'content-type': type } });
}
function provider() { return createProvider({ ...DEFAULTS, provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', apiKey: 'test-placeholder' }); }
let mock: ReturnType<typeof browserMock>;
beforeEach(() => { mock = browserMock(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('streamed provider responses', () => {
  it('handles arbitrary network and UTF-8 boundaries, heartbeats, and the usage frame', async () => {
    const wire = encoder.encode(': OPENROUTER PROCESSING\n\n' + frame(text.slice(0, 20)) + ': heartbeat\r\n\r\n' + frame(text.slice(20)) + 'data: {"choices":[],"usage":{"total_tokens":100}}\n\ndata: [DONE]\n\n');
    const bytes = [...wire].map(byte => new Uint8Array([byte]));
    expect(await readCompletion(response(bytes), 'openai')).toBe(text);
  });
  it('supports CRLF frames and multi-line data fields', async () => {
    const wire = 'data: {"choices":\r\ndata: [{"delta":{"content":"{}"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
    expect(await readCompletion(response([wire]), 'openai')).toBe('{}');
  });
  it('does not leak hidden reasoning into the grouping JSON', async () => {
    expect(await readCompletion(response(['data: {"choices":[{"delta":{"reasoning":"not user content"}}]}\n\n', frame(text), 'data: [DONE]\n\n']), 'openai')).toBe(text);
  });
  it('handles a final event without a terminating blank line', async () => {
    expect(await readCompletion(response([frame(text).trimEnd()]), 'openai')).toBe(text);
  });
  it('maps mid-stream errors without exposing the provider payload', async () => {
    await expect(readCompletion(response(['data: {"error":{"code":429,"message":"private provider diagnostic"}}\n\n']), 'openai')).rejects.toThrow(/rate limit/);
    await expect(readCompletion(response(['data: broken-json\n\n']), 'openai')).rejects.toThrow(/unreadable/);
    await expect(readCompletion(response([': heartbeat\n\ndata: [DONE]\n\n']), 'openai')).rejects.toThrow(/empty/);
  });
  it('still reads providers that return a complete JSON envelope', async () => {
    const payload = JSON.stringify({ choices: [{ message: { content: text } }] });
    expect(await readCompletion(response([payload], 'application/json'), 'openai')).toBe(text);
  });
  it('sends a streaming request without replacing the free model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([frame(text), 'data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);
    expect(await provider().complete('JSON only', 'Synthetic test tabs')).toBe(text);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'openrouter/free', stream: true, reasoning: { effort: 'low', exclude: true } });
  });
});

describe('slow requests and cleanup', () => {
  it('allows generation past 25 seconds once headers arrive and stops its activity timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { setTimeout(() => { controller.enqueue(encoder.encode(frame(text) + 'data: [DONE]\n\n')); controller.close(); }, 45_000); },
    }), { headers: { 'content-type': 'text/event-stream' } })));
    const result = provider().complete('JSON only', 'Synthetic test tabs');
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await result).toBe(text);
    expect(mock.api.storage.session.get).toHaveBeenCalled();
    const calls = mock.api.storage.session.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.api.storage.session.get.mock.calls).toHaveLength(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out a stalled connection with a useful message', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })));
    const result = provider().complete('JSON', 'test').catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(HEADER_TIMEOUT_MS);
    expect(await result).toMatch(/AI provider took too long/);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['application/json', 'text/event-stream'])('catches an abort while reading the %s body', async type => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init: RequestInit) => new Response(new ReadableStream({
      start(controller) { init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason)); },
    }), { headers: { 'content-type': type } })));
    const result = provider().complete('JSON', 'test').catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(RESPONSE_TIMEOUT_MS);
    expect(await result).toMatch(/No tabs were changed/);
    expect(await result).not.toContain('signal timed out');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps HTTP errors actionable and never exposes keys or provider error bodies', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"private diagnostic"}', { status: 402 })));
    await expect(provider().complete('JSON', 'test')).rejects.toThrow(/requires credits/);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans up on a broken body and sanitizes the underlying network error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(new Error('private diagnostic')); } }))));
    await expect(provider().complete('JSON', 'test')).rejects.toThrow(/connection failed or was interrupted/);
    expect(vi.getTimerCount()).toBe(0);
  });
});
