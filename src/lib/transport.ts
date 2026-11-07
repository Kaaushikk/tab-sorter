import type { AiControl, ProviderKind } from './types';

export const HEADER_TIMEOUT_MS = 25_000;
export const RESPONSE_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 8_000_000;
const MAX_TEXT_LENGTH = 2_000_000;

class ProviderError extends Error {}

export function httpError(status: number): Error {
  if ([401, 403].includes(status)) return new ProviderError('Provider denied access. Check the API key, endpoint permission, or local server allowed origins.');
  if (status === 402) return new ProviderError('This provider requires credits for the selected model. For free OpenRouter requests, use openrouter/free or an available model ending in :free.');
  if (status === 429) return new ProviderError('Provider rate limit or quota reached. Wait before trying again; free models have limited capacity.');
  return new ProviderError(`Provider returned HTTP ${status}. Check the endpoint and model in Settings.`);
}

interface CompletionPayload {
  error?: { code?: number };
  content?: { type: string; text?: string }[];
  message?: { content?: string };
  choices?: { delta?: { content?: string }; message?: { content?: string }; finish_reason?: string }[];
}

function checkText(text: unknown): string {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH) throw new ProviderError('Provider returned an empty or oversized response. Try another model.');
  return text;
}

/** Collect only visible content, never reasoning or diagnostic payloads. */
export async function readCompletion(response: Response, provider: ProviderKind, control?: AiControl): Promise<string> {
  if (!response.body) throw new ProviderError('Provider returned an empty response. Try again or choose another model.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const streaming = response.headers.get('content-type')?.includes('text/event-stream');
  let buffer = '', output = '', bytes = 0, finished = false, lastReport = -Infinity, reportedCharacters = 0;

  function event(frame: string): void {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) return; // SSE comments/heartbeats contain no data fields.
    if (data.trim() === '[DONE]') { finished = true; return; }
    let payload: CompletionPayload;
    try { payload = JSON.parse(data); } catch { throw new ProviderError('Provider sent an unreadable response stream. Try again or choose another model.'); }
    if (!payload || typeof payload !== 'object') throw new ProviderError('Provider sent an invalid response stream.');
    if (payload.error) throw httpError(typeof payload.error.code === 'number' ? payload.error.code : 502);
    const choice = payload.choices?.[0];
    if (choice?.finish_reason === 'error') throw new ProviderError('The provider stopped while generating suggestions. Try again or choose another model.');
    const text = choice?.delta?.content;
    if (typeof text === 'string') output += text;
    if (output.length > MAX_TEXT_LENGTH) throw new ProviderError('Provider returned an oversized response. Try another model.');
  }

  try {
    while (!finished) {
      control?.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); break; }
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new ProviderError('Provider returned an oversized response. Try another model.');
      buffer += decoder.decode(value, { stream: true });
      if (streaming) {
        let boundary: RegExpExecArray | null;
        while (!finished && (boundary = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          event(frame);
        }
      }
      const characters = streaming ? output.length : buffer.length;
      if (characters > reportedCharacters && (finished || Date.now() - lastReport >= 750)) {
        reportedCharacters = characters; lastReport = Date.now();
        await control?.report({ stage: 'receiving', characters });
      }
    }
    if (streaming) {
      if (!finished && buffer.trim()) event(buffer);
      return checkText(output);
    }
    let payload: CompletionPayload;
    try { payload = JSON.parse(buffer); } catch { throw new ProviderError('Provider returned an unreadable response. Check the endpoint and try again.'); }
    if (!payload || typeof payload !== 'object') throw new ProviderError('Provider returned an invalid response.');
    if (payload.error) throw httpError(typeof payload.error.code === 'number' ? payload.error.code : 502);
    const text = provider === 'anthropic'
      ? payload.content?.filter(x => x.type === 'text').map(x => x.text ?? '').join('')
      : provider === 'ollama' ? payload.message?.content : payload.choices?.[0]?.message?.content;
    return checkText(text);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Separate a short connection deadline from a longer generation deadline. */
export async function requestCompletion(url: string, headers: Record<string, string>, body: object, provider: ProviderKind, control?: AiControl): Promise<string> {
  const controller = new AbortController();
  const signal = control ? AbortSignal.any([controller.signal, control.signal]) : controller.signal;
  const connectionTimer = setTimeout(() => controller.abort(new DOMException('Connection deadline', 'TimeoutError')), HEADER_TIMEOUT_MS);
  const responseTimer = setTimeout(() => controller.abort(new DOMException('Generation deadline', 'TimeoutError')), RESPONSE_TIMEOUT_MS);
  // Only while this bounded request is active: extension API activity protects
  // streamed generation from the MV3 idle timer. No permanent background polling.
  const activity = setInterval(() => { void chrome.storage.session.get('epoch').catch(() => undefined); }, 15_000);
  let receivedHeaders = false;
  try {
    await control?.report({ stage: 'connecting', characters: 0 });
    signal.throwIfAborted();
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', signal });
    receivedHeaders = true;
    clearTimeout(connectionTimer);
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw httpError(response.status); }
    await control?.report({ stage: 'waiting' });
    return await readCompletion(response, provider, control);
  } catch (error) {
    if (control?.signal.aborted) throw control.signal.reason;
    if (controller.signal.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) {
      throw new Error(`The AI provider took too long to respond. ${receivedHeaders ? 'The response did not finish within 60 seconds.' : 'The provider did not start a response within 25 seconds.'} No tabs were changed. Try again shortly or choose another model.`);
    }
    if (error instanceof ProviderError) throw error;
    throw new Error('Provider connection failed or was interrupted. Check the endpoint, network, and local server origin settings, then try again.');
  } finally {
    clearTimeout(connectionTimer); clearTimeout(responseTimer); clearInterval(activity);
  }
}
