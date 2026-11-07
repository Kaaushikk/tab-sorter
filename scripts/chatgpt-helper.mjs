import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { URL, pathToFileURL } from 'node:url';
import { API, beginSignIn, BridgeError, finishSignIn, random, refresh, revoke } from './chatgpt-auth.mjs';

const HOST = '127.0.0.1';
const PORT = 43128;
const CALLBACK = '/auth/callback';

function reply(res, status, data, plain = false) {
  res.writeHead(status, {
    'Content-Type': plain ? 'text/plain; charset=utf-8' : 'application/json',
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  });
  res.end(plain ? data : JSON.stringify(data));
}

async function readPrompt(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 512_000) throw new BridgeError(413, 'This tab batch is too large.');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new BridgeError(400, 'Invalid grouping request.'); }
  if (!data || typeof data.model !== 'string' || typeof data.instructions !== 'string' || typeof data.input !== 'string') {
    throw new BridgeError(400, 'Invalid grouping request.');
  }
  return data;
}

function permitted(req, key) {
  const origin = req.headers.origin;
  if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return false;
  const sent = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from('Bearer ' + key);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

export async function startHelper({ directory, port = PORT, fetcher = globalThis.fetch } = {}) {
  const folder = directory ?? join(process.env.LOCALAPPDATA || homedir(), '.tab-sorter');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, 'chatgpt.json');
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = { key: random(), profiles: {}, active: null };
  }
  // Earlier versions saved a bare UUID. Keep its value and add the required namespace.
  if (!data.hostId?.startsWith('urn:uuid:')) data.hostId = 'urn:uuid:' + (data.hostId ?? randomUUID());
  let origin, pending, catalog, authMessage;
  let queue = Promise.resolve();
  const streams = new Set();
  const profile = () => Object.hasOwn(data.profiles, data.active) ? data.profiles[data.active] : undefined;
  function stopStreams() {
    for (const stream of streams) stream.abort();
    catalog = undefined;
  }
  async function save(next) {
    const tmp = file + '.' + random() + '.tmp';
    await writeFile(tmp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
    await rename(tmp, file);
    data = next;
  }
  function serialize(action) {
    const work = queue.then(action);
    queue = work.catch(() => {});
    return work;
  }
  async function session() {
    return serialize(async () => {
      const current = profile();
      if (!current?.accessToken) throw new BridgeError(401, 'Continue with ChatGPT in Tab Sorter settings first.');
      if (current.expires > Date.now() + 60_000) return current;
      const updated = await refresh(fetcher, current);
      await save({ ...data, profiles: { ...data.profiles, [updated.clientId]: updated } });
      return updated;
    });
  }
  async function models(current) {
    if (catalog?.clientId === current.clientId && catalog.expires > Date.now()) return catalog.items;
    const response = await fetcher(API + '/models', {
      headers: { Authorization: 'Bearer ' + current.accessToken }, redirect: 'error',
      signal: globalThis.AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw upstreamError(response.status);
    }
    const body = await response.json();
    const items = body.models.filter(item => item.visibility === 'list' &&
      typeof item.slug === 'string' && typeof item.display_name === 'string')
      .map(item => ({ id: item.slug, name: item.display_name }));
    if (!items.length) throw new BridgeError(403, 'This ChatGPT account has no eligible models for Tab Sorter.');
    catalog = { clientId: current.clientId, items, expires: Date.now() + 300_000 };
    return items;
  }
  function upstreamError(status) {
    if (status === 429 || status === 402) return new BridgeError(429, 'ChatGPT plan usage limit reached. Check Manage ChatGPT usage in Settings.');
    if (status === 401) return new BridgeError(401, 'Your ChatGPT session needs to be renewed. Continue with ChatGPT in Settings.');
    if (status === 403) return new BridgeError(403, 'ChatGPT plan access is unavailable for this account or workspace.');
    return new BridgeError(502, 'ChatGPT could not complete the request. Try again or select another available model.');
  }
  async function callback(url, res) {
    const attempt = pending;
    if (!attempt || Date.now() >= attempt.expires || url.searchParams.get('state') !== attempt.state) {
      return reply(res, 400, 'This sign-in link expired or is invalid. Return to Tab Sorter settings and start again.', true);
    }
    pending = undefined;
    try {
      if (url.searchParams.has('error')) throw new BridgeError(403, 'ChatGPT sign-in was cancelled or access was declined.');
      await serialize(async () => {
        const next = await finishSignIn(fetcher, attempt, url.searchParams, data.profiles[attempt.client]);
        stopStreams();
        await save({ ...data, active: next.clientId, profiles: { ...data.profiles, [next.clientId]: next } });
      });
      authMessage = undefined;
      reply(res, 200, 'Connected to ChatGPT. Return to Tab Sorter settings, click Check connection, choose a model and save.', true);
    } catch (error) {
      authMessage = error instanceof BridgeError ? error.message : 'ChatGPT sign-in could not be verified. Try again from Tab Sorter settings.';
      reply(res, 400, authMessage, true);
    }
  }
  async function inference(req, res) {
    const controller = new globalThis.AbortController();
    streams.add(controller);
    res.once('close', () => controller.abort());
    try {
      const { model, instructions, input } = await readPrompt(req);
      const current = await session();
      const list = await models(current);
      if (!list.some(item => item.id === model)) throw new BridgeError(400, 'Choose an available ChatGPT model in Tab Sorter settings.');
      const response = await fetcher(API + '/responses', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + current.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, instructions, input: [{ role: 'user', content: input }], store: false, stream: true }),
      });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel();
        throw upstreamError(response.status);
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.flushHeaders();
      await pipeline(Readable.fromWeb(response.body), res, { signal: controller.signal });
    } finally {
      streams.delete(controller);
    }
  }
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host || !req.url?.startsWith('/')) return reply(res, 403, {});
      const url = new URL(req.url, origin);
      if (url.origin !== origin) return reply(res, 403, {});
      if (req.method === 'GET' && url.pathname === CALLBACK) return await callback(url, res);
      if (!permitted(req, data.key)) return reply(res, 403, { message: 'Check the pairing code shown by the Tab Sorter helper.' });
      if (req.method === 'GET' && url.pathname === '/status') {
        const current = profile();
        const accounts = Object.values(data.profiles).map((p, index) => ({ id: p.clientId, label: p.label + ' · ' + (index + 1) }));
        let items = [], message = authMessage;
        try {
          if (current?.accessToken) items = await models(await session());
        } catch (error) {
          message = error instanceof BridgeError ? error.message : 'Could not load your ChatGPT models. Check the connection and try again.';
        }
        return reply(res, 200, { active: data.active, connected: !!current?.accessToken, accounts, models: items, message });
      }
      if (req.method === 'POST' && url.pathname === '/signin') {
        const id = url.searchParams.get('account');
        const account = id && Object.hasOwn(data.profiles, id) ? data.profiles[id] : undefined;
        if (id && !account) throw new BridgeError(400, 'That account is no longer available.');
        authMessage = undefined;
        pending = beginSignIn(origin + CALLBACK, data.hostId, account);
        return reply(res, 200, { url: pending.url });
      }
      if (req.method === 'POST' && url.pathname === '/signout') {
        const revoked = await serialize(async () => {
          const current = profile();
          pending = undefined;
          stopStreams();
          if (!current) return true;
          const confirmed = await revoke(fetcher, current);
          const { clientId, subject, label } = current;
          await save({ ...data, profiles: { ...data.profiles, [clientId]: { clientId, subject, label } } });
          return confirmed;
        });
        return reply(res, 200, { revoked });
      }
      if (req.method === 'POST' && url.pathname === '/responses') return await inference(req, res);
      reply(res, 404, {});
    } catch (error) {
      if (!res.destroyed && !res.headersSent) reply(res, error instanceof BridgeError ? error.status : 502, {
        message: error instanceof BridgeError ? error.message : 'The Tab Sorter helper could not reach ChatGPT. Try again.',
      });
      else if (!res.writableEnded) res.destroy();
    }
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, HOST, () => {
      origin = 'http://' + HOST + ':' + server.address().port;
      server.off('error', fail);
      done();
    });
  });
  try { await save(data); }
  catch (error) { server.close(); throw error; }
  return { server, origin, key: data.key };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { key } = await startHelper();
    console.log('Tab Sorter ChatGPT helper is running. Keep this window open.');
    console.log('Paste this local pairing code into Tab Sorter settings: ' + key);
  } catch (error) {
    console.error(error.code === 'EADDRINUSE'
      ? 'Port 43128 is already in use. The Tab Sorter helper may already be open.'
      : 'The Tab Sorter helper could not start. Check access to your local profile folder.');
    process.exitCode = 1;
  }
}
