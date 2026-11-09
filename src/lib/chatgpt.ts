export const CHATGPT_HELPER = 'http://127.0.0.1:43128';
export const CHATGPT_PERMISSION = 'http://127.0.0.1/*';
export const CHATGPT_USAGE = 'https://chatgpt.com/settings/usage';

export interface ChatGptStatus {
  active: string | null;
  connected: boolean;
  accounts: { id: string; label: string }[];
  models: { id: string; name: string }[];
  message?: string;
  signIn?: { id: string; status: 'pending' | 'connected' | 'failed' };
}

export const validPairingCode = (key: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(key);

export async function helperRequest<T>(path: string, key: string, method = 'GET'): Promise<T> {
  if (!validPairingCode(key)) throw new Error('Enter the pairing code shown by the Tab Sorter helper.');
  const response = await fetchHelper(path, { Authorization: 'Bearer ' + key }, method);
  return readHelper<T>(response);
}

async function fetchHelper(path: string, headers: Record<string, string>, method: string): Promise<Response> {
  try {
    return await fetch(CHATGPT_HELPER + path, {
      method, headers,
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(35_000),
    });
  } catch { throw new Error('Open Start ChatGPT helper.cmd in the Tab Sorter folder, keep it open, then try again.'); }
}

async function readHelper<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? 'The ChatGPT helper could not complete this request.');
  return data as T;
}

export async function startPairing(): Promise<{ approvalUrl: string; secret: string }> {
  const response = await fetchHelper('/pair/start', { 'X-Tab-Sorter-Setup': '1' }, 'POST');
  if (response.status === 403 || response.status === 404) {
    throw new Error('Restart the Tab Sorter helper for guided setup, or enter a pairing code under Advanced.');
  }
  const result = await readHelper<{ approvalUrl: string; secret: string }>(response);
  const url = new URL(result.approvalUrl);
  if (url.origin !== CHATGPT_HELPER || !/^\/pair\/approve\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
    || url.username || url.password || url.search || url.hash || !validPairingCode(result.secret)) {
    throw new Error('The helper returned an unexpected connection request.');
  }
  return result;
}

export async function finishPairing(secret: string): Promise<string | undefined> {
  const response = await fetchHelper('/pair/redeem', {
    'X-Tab-Sorter-Setup': '1', Authorization: 'Bearer ' + secret,
  }, 'POST');
  if (response.status === 202) return;
  const { key } = await readHelper<{ key: string }>(response);
  if (!validPairingCode(key)) throw new Error('The helper returned an invalid pairing code.');
  return key;
}
