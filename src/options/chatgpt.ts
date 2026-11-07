import { CHATGPT_PERMISSION, CHATGPT_USAGE, helperRequest, validPairingCode, type ChatGptStatus } from '../lib/chatgpt';
import { button, el, field } from '../lib/ui';

export function chatgptSettings(savedKey: string, savedModel: string) {
  const panel = el('div', undefined, 'stack');
  const status = el('p', '', 'muted'); status.setAttribute('role', 'status');
  const key = el('input'), model = el('select'), account = el('select');
  key.type = 'password'; key.autocomplete = 'off'; key.spellcheck = false; key.value = savedKey;
  const addOption = (select: HTMLSelectElement, id: string, label: string) => {
    const option = el('option', label); option.value = id; select.append(option);
  };
  if (savedModel) addOption(model, savedModel, savedModel);
  addOption(account, '', 'Connect an account');
  const usage = el('a', 'Manage ChatGPT usage'); usage.href = CHATGPT_USAGE; usage.target = '_blank'; usage.rel = 'noopener';

  const connect = button('Continue with ChatGPT', async () => {
    try {
      const pairingCode = key.value.trim();
      if (!validPairingCode(pairingCode)) throw new Error('Paste the pairing code from the helper window first.');
      const allowed = await chrome.permissions.request({ origins: [CHATGPT_PERMISSION] });
      if (!allowed) throw new Error('Allow Tab Sorter to reach its local helper to continue.');
      const query = account.value ? '?account=' + encodeURIComponent(account.value) : '';
      const { url } = await helperRequest<{ url: string }>('/signin' + query, pairingCode, 'POST');
      const signIn = new URL(url);
      if (signIn.origin !== 'https://auth.openai.com' || signIn.pathname !== '/api/accounts/authorize' || signIn.username || signIn.password) {
        throw new Error('The helper returned an unexpected sign-in address.');
      }
      await chrome.tabs.create({ url: signIn.href });
      status.textContent = 'Complete sign-in, then return here and click Check connection.';
    } catch (error) { report(error); }
  });
  const disconnect = button('Sign out', async () => {
    try {
      const { revoked } = await helperRequest<{ revoked: boolean }>('/signout', key.value.trim(), 'POST');
      await refresh();
      if (!revoked) status.textContent = 'Signed out locally. Open Manage ChatGPT usage to remove access if needed.';
    } catch (error) { report(error); }
  });
  disconnect.hidden = true;
  let ready = false;
  let refreshing = false;
  function report(error: unknown): void {
    status.textContent = error instanceof Error ? error.message : 'Could not connect to ChatGPT.';
  }
  async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    ready = false;
    const pairingCode = key.value.trim();
    try {
      if (!await chrome.permissions.contains({ origins: [CHATGPT_PERMISSION] })) {
        throw new Error('Use Continue with ChatGPT to allow access to the local helper.');
      }
      const result = await helperRequest<ChatGptStatus>('/status', pairingCode);
      if (key.value.trim() !== pairingCode) return;
      const previous = model.value || savedModel;
      account.replaceChildren();
      for (const p of result.accounts) addOption(account, p.id, p.label);
      addOption(account, '', result.accounts.length ? 'Connect a different account' : 'Connect an account');
      account.value = result.active ?? '';
      model.replaceChildren();
      for (const item of result.models) addOption(model, item.id, item.name);
      model.value = result.models.find(m => m.id === previous)?.id
        ?? result.models.find(m => m.id === 'gpt-6.1-sol')?.id
        ?? result.models[0]?.id ?? '';
      disconnect.hidden = !result.connected;
      ready = result.connected && !!model.value;
      status.textContent = result.message ?? (ready ? 'Connected. Save settings to use your ChatGPT plan.' : 'Continue with ChatGPT to connect.');
      if (ready && !result.message && !(await chrome.storage.local.get('chatgptWelcome')).chatgptWelcome) {
        const welcome = el('dialog');
        welcome.append(el('h2', 'Use your ChatGPT plan'), el('p', 'Eligible AI requests in Tab Sorter use your ChatGPT plan or available credits. You can review your limits in ChatGPT settings.'), button('Got it', () => welcome.close()));
        welcome.addEventListener('close', () => welcome.remove(), { once: true });
        document.body.append(welcome);
        await chrome.storage.local.set({ chatgptWelcome: true });
        welcome.showModal();
      }
    } catch (error) { report(error); }
    finally { refreshing = false; }
  }
  key.addEventListener('input', () => { ready = false; });
  const controls = el('div', undefined, 'row');
  controls.append(connect, button('Check connection', refresh), disconnect);
  panel.append(el('p', 'Start the local helper with npm run chatgpt in the Tab Sorter folder. Keep its window open.'), field('Local pairing code', key), field('ChatGPT account', account), controls, status, field('ChatGPT model', model), usage);
  return { panel, key, model, refresh, isReady: () => ready };
}
