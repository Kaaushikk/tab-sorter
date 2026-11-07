export const CHATGPT_HELPER = 'http://127.0.0.1:43128';
export const CHATGPT_PERMISSION = 'http://127.0.0.1/*';
export const CHATGPT_USAGE = 'https://chatgpt.com/settings/usage';

export interface ChatGptStatus {
  active: string | null;
  connected: boolean;
  accounts: { id: string; label: string }[];
  models: { id: string; name: string }[];
  message?: string;
}

export const validPairingCode = (key: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(key);

export async function helperRequest<T>(path: string, key: string, method = 'GET'): Promise<T> {
  if (!validPairingCode(key)) throw new Error('Enter the pairing code shown by the Tab Sorter helper.');
  let response: Response;
  try {
    response = await fetch(CHATGPT_HELPER + path, {
      method, headers: { Authorization: 'Bearer ' + key },
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(35_000),
    });
  } catch { throw new Error('Start the Tab Sorter ChatGPT helper and keep it running.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? 'The ChatGPT helper could not complete this request.');
  return data as T;
}
