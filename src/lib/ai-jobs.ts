import type { AiControl, AiJob } from './types';

const jobKey = (windowId: number) => `ai-job:${windowId}`;
const cancelKey = (windowId: number) => `ai-cancel:${windowId}`;
const active = new Map<number, { id: string; controller: AbortController; cancellable: boolean }>();
const CANCELLED = 'AI request cancelled. No tabs were changed.';

export async function aiStatus(windowId: number): Promise<AiJob | undefined> {
  const key = jobKey(windowId);
  const job = (await chrome.storage.session.get(key))[key] as AiJob | undefined;
  if (job?.status === 'running' && active.get(windowId)?.id !== job.id) {
    return { ...job, status: 'failed', error: 'The browser interrupted this AI request. Try again; your tabs were not changed.' };
  }
  return job;
}

export async function cancelAi(windowId: number, requestId: string): Promise<boolean> {
  const entry = active.get(windowId);
  if (entry?.id === requestId) {
    if (!entry.cancellable) return false;
    entry.controller.abort(new DOMException(CANCELLED, 'AbortError'));
    return true;
  }
  // An immediate Cancel can arrive before the queued request has read the window.
  const job = await aiStatus(windowId);
  if (job?.id === requestId) return false;
  await chrome.storage.session.set({ [cancelKey(windowId)]: requestId });
  const started = active.get(windowId);
  if (started?.id === requestId && started.cancellable) started.controller.abort(new DOMException(CANCELLED, 'AbortError'));
  return true;
}

export async function runAiJob<T extends { selectedId?: string }>(windowId: number, id: string, model: string, run: (control: AiControl, publish: () => void) => Promise<T>): Promise<T> {
  const controller = new AbortController(), entry = { id, controller, cancellable: true };
  active.set(windowId, entry);
  let job: AiJob = { id, model, startedAt: Date.now(), updatedAt: Date.now(), stage: 'preparing', status: 'running', attempt: 1 };
  const persist = async () => { if (active.get(windowId) === entry) await chrome.storage.session.set({ [jobKey(windowId)]: job }); };
  try {
    await persist();
    const marker = cancelKey(windowId);
    if ((await chrome.storage.session.get(marker))[marker] === id) {
      controller.abort(new DOMException(CANCELLED, 'AbortError'));
      await chrome.storage.session.remove(marker);
    }
    controller.signal.throwIfAborted();
    const result = await run({
      signal: controller.signal,
      async report(progress) {
        if (controller.signal.aborted) return;
        job = { ...job, ...progress, updatedAt: Date.now() };
        await persist();
      },
    }, () => { controller.signal.throwIfAborted(); entry.cancellable = false; });
    job = { ...job, status: 'succeeded', updatedAt: Date.now(), selectedId: result.selectedId };
    await persist(); return result;
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const message = cancelled ? CANCELLED : error instanceof Error ? error.message : 'The AI request failed. Try again.';
    job = { ...job, status: cancelled ? 'cancelled' : 'failed', updatedAt: Date.now(), error: message };
    await persist(); throw new Error(message);
  } finally {
    if (active.get(windowId) === entry) active.delete(windowId);
  }
}

export async function clearAiWindow(windowId: number): Promise<void> {
  active.get(windowId)?.controller.abort(new DOMException(CANCELLED, 'AbortError'));
  active.delete(windowId);
  await chrome.storage.session.remove([jobKey(windowId), cancelKey(windowId)]);
}
