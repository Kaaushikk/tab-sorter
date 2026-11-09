import { CHATGPT_PERMISSION, CHATGPT_USAGE, finishPairing, helperRequest, startPairing, validPairingCode, type ChatGptStatus } from '../lib/chatgpt';
import { button, el, field } from '../lib/ui';

function addOption(select: HTMLSelectElement, id: string, label: string): void {
  const option = el('option', label); option.value = id; select.append(option);
}

async function waitFor<T>(read: () => Promise<T | undefined>, signal: AbortSignal): Promise<T> {
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    signal.throwIfAborted();
    const result = await read();
    signal.throwIfAborted();
    if (result !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Setup timed out. Start again when you’re ready.');
}

export function chatgptSettings(savedKey: string, savedModel: string, activate: (key: string, model: string) => Promise<void>) {
  const panel = el('div', undefined, 'stack');
  const status = el('p', '', 'muted'); status.setAttribute('role', 'status');
  const key = el('input'), model = el('select'), account = el('select');
  key.type = 'password'; key.autocomplete = 'off'; key.spellcheck = false; key.value = savedKey;
  if (savedModel) addOption(model, savedModel, savedModel);
  addOption(account, '', 'Connect an account');
  const usage = el('a', 'Manage ChatGPT usage'); usage.href = CHATGPT_USAGE; usage.target = '_blank'; usage.rel = 'noopener';
  let ready = false, refreshing = false;
  let setup: AbortController | undefined;

  const connect = button('Continue with ChatGPT', () => connectPlan(), 'primary');
  const changeAccount = button('Sign in to selected account', () => connectPlan(true));
  const stop = button('Cancel setup', () => setup?.abort());
  stop.hidden = true;
  const disconnect = button('Sign out', async () => {
    try {
      const { revoked } = await helperRequest<{ revoked: boolean }>('/signout', key.value.trim(), 'POST');
      await refresh();
      if (!revoked) status.textContent = 'Signed out locally. Open Manage ChatGPT usage to remove access if needed.';
    } catch (error) { report(error); }
  });
  disconnect.hidden = true;
  const check = button('Check connection', refresh);
  function report(error: unknown): void {
    status.textContent = error instanceof Error ? error.message : 'Could not connect to ChatGPT.';
  }
  function render(result: ChatGptStatus): void {
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
    status.textContent = result.message ?? (ready ? 'ChatGPT is connected.' : 'Continue with ChatGPT to connect.');
  }
  async function refresh(): Promise<void> {
    if (refreshing || setup || !key.value.trim()) return;
    refreshing = true;
    ready = false;
    const pairingCode = key.value.trim();
    try {
      if (!await chrome.permissions.contains({ origins: [CHATGPT_PERMISSION] })) {
        throw new Error('Use Continue with ChatGPT to allow access to the local helper.');
      }
      const result = await helperRequest<ChatGptStatus>('/status', pairingCode);
      if (key.value.trim() === pairingCode && !setup) render(result);
    } catch (error) { report(error); }
    finally { refreshing = false; }
  }
  async function confirmPlan(): Promise<void> {
    if ((await chrome.storage.local.get('chatgptWelcome')).chatgptWelcome) return;
    const welcome = el('dialog');
    welcome.append(el('h2', 'Use your ChatGPT plan'), el('p', 'Eligible AI requests in Tab Sorter use your ChatGPT plan or available credits. You can review your limits in ChatGPT settings.'), button('Got it', () => welcome.close()));
    welcome.addEventListener('close', () => welcome.remove(), { once: true });
    document.body.append(welcome);
    await chrome.storage.local.set({ chatgptWelcome: true });
    welcome.showModal();
  }
  async function connectPlan(change = false): Promise<void> {
    if (setup) return;
    const selected = change ? account.value : undefined;
    const controller = new AbortController();
    const { signal } = controller;
    setup = controller;
    for (const control of [connect, changeAccount, disconnect, check, key, model, account]) control.disabled = true;
    stop.hidden = false;
    status.textContent = 'Connecting to the local helper…';
    try {
      const allowed = await chrome.permissions.request({ origins: [CHATGPT_PERMISSION] });
      if (!allowed) throw new Error('Allow Tab Sorter to reach its local helper to continue.');
      signal.throwIfAborted();
      let pairingCode = key.value.trim();
      if (!validPairingCode(pairingCode)) {
        const { approvalUrl, secret } = await startPairing();
        signal.throwIfAborted();
        await chrome.tabs.create({ url: approvalUrl });
        status.textContent = 'Click Allow connection in the new tab. Setup will continue here.';
        pairingCode = await waitFor(() => finishPairing(secret), signal);
        key.value = pairingCode;
      }
      let result = await helperRequest<ChatGptStatus>('/status', pairingCode);
      if (change || !result.connected) {
        const target = selected ?? result.active;
        const query = target ? '?account=' + encodeURIComponent(target) : '';
        const { url, attemptId } = await helperRequest<{ url: string; attemptId?: string }>('/signin' + query, pairingCode, 'POST');
        const signIn = new URL(url);
        if (signIn.origin !== 'https://auth.openai.com' || signIn.pathname !== '/api/accounts/authorize' || signIn.username || signIn.password) {
          throw new Error('The helper returned an unexpected sign-in address.');
        }
        signal.throwIfAborted();
        await chrome.tabs.create({ url: signIn.href });
        if (!attemptId) {
          status.textContent = 'After signing in, click Continue with ChatGPT again to finish setup.';
          return;
        }
        status.textContent = 'Finish signing in on the ChatGPT page, then return here.';
        result = await waitFor(async () => {
          const current = await helperRequest<ChatGptStatus>('/status', pairingCode);
          if (current.signIn?.id !== attemptId || current.signIn.status === 'pending') return;
          if (current.signIn.status === 'failed') throw new Error(current.message ?? 'ChatGPT sign-in was not completed.');
          return current;
        }, signal);
      }
      signal.throwIfAborted();
      render(result);
      if (!ready) throw new Error(result.message ?? 'This account has no available models. Check your ChatGPT plan.');
      await activate(pairingCode, model.value);
      status.textContent = 'Ready. Open the Tab Sorter popup and click Suggest groupings.';
      await confirmPlan();
    } catch (error) {
      if (signal.aborted) status.textContent = 'Setup cancelled. You can continue later.';
      else report(error);
    } finally {
      setup = undefined;
      stop.hidden = true;
      for (const control of [connect, changeAccount, disconnect, check, key, model, account]) control.disabled = false;
    }
  }
  key.addEventListener('input', () => { ready = false; });
  const controls = el('div', undefined, 'row'); controls.append(connect, stop);
  const advanced = el('details');
  advanced.append(el('summary', 'Advanced connection settings'), field('Local pairing code', key), field('ChatGPT account', account),
    changeAccount, check, disconnect, field('ChatGPT model', model), usage);
  panel.append(el('p', 'Use your ChatGPT plan for grouping suggestions. On Windows, open Start ChatGPT helper.cmd from the Tab Sorter folder and keep it running.'), controls, status, advanced);
  return { panel, key, model, refresh, isReady: () => ready };
}
