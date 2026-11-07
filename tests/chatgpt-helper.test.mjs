import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { startHelper } from '../scripts/chatgpt-helper.mjs';

const issuer = 'https://auth.openai.com';
const client = 'oaiapp_tab_sorter_test';
const scope = 'resource.invoke chatgpt.tokens.use.direct';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

it('requires pairing and a verified OAuth callback, then streams grouping through the plan', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tab-sorter-chatgpt-'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test' };
  let nonce, challenge, callback, badNonce = true;
  const fetcher = vi.fn(async (url, options) => {
    if (url.endsWith('/oauth/token')) {
      expect(options.body.get('client_id')).toBe(client);
      expect(options.body.get('redirect_uri')).toBe(callback);
      expect(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url')).toBe(challenge);
      const claims = { aud: client, iss: issuer, sub: 'test-subject', nonce: badNonce ? 'wrong' : nonce, exp: Math.floor(Date.now() / 1000) + 600 };
      const payload = encode({ alg: 'RS256', kid: 'test' }) + '.' + encode(claims);
      const jwt = payload + '.' + sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64url');
      return globalThis.Response.json({ access_token: 'fake-access', refresh_token: 'fake-refresh', id_token: jwt, expires_in: 3600, scope });
    }
    if (url.endsWith('/jwks.json')) return globalThis.Response.json({ keys: [jwk] });
    if (url.endsWith('/models')) {
      expect(options.headers.Authorization).toBe('Bearer fake-access');
      return globalThis.Response.json({ models: [{ slug: 'test-model', visibility: 'list', display_name: 'Test model' }, { slug: 'hidden', visibility: 'hidden' }] });
    }
    if (url.endsWith('/oauth/revoke')) {
      expect(options.body.get('token')).toBe('fake-refresh');
      return new globalThis.Response(null);
    }
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options.headers.Authorization).toBe('Bearer fake-access');
    expect(JSON.parse(options.body)).toEqual({
      model: 'test-model', instructions: 'Return grouping JSON', input: [{ role: 'user', content: 'Synthetic tabs' }],
      store: false, stream: true,
    });
    return new globalThis.Response('data: {"type":"response.completed"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const { origin, key, server } = await startHelper({ directory, port: 0, fetcher });
  const request = (path, options = {}) => globalThis.fetch(origin + path, {
    ...options, headers: { Authorization: 'Bearer ' + key, ...options.headers },
  });
  async function begin() {
    const { url } = await (await request('/signin', { method: 'POST' })).json();
    const auth = new URL(url);
    expect(auth.origin).toBe(issuer);
    expect(auth.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(auth.searchParams.get('ext_agent_host_id')).toMatch(/^urn:uuid:[\da-f-]{36}$/);
    expect(auth.searchParams.get('scope')).toContain(scope);
    callback = auth.searchParams.get('redirect_uri');
    challenge = auth.searchParams.get('code_challenge');
    nonce = auth.searchParams.get('nonce');
    const target = new URL(callback);
    target.searchParams.set('code', 'synthetic-code');
    target.searchParams.set('client_id', client);
    return { target, state: auth.searchParams.get('state') };
  }
  try {
    expect((await globalThis.fetch(origin + '/status')).status).toBe(403);
    expect((await request('/status', { headers: { Origin: 'https://example.com' } })).status).toBe(403);
    let { target, state } = await begin();
    target.searchParams.set('state', 'wrong');
    expect((await globalThis.fetch(target)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    target.searchParams.set('state', state);
    expect((await globalThis.fetch(target)).status).toBe(400);
    expect(await (await request('/status')).json()).toMatchObject({ connected: false });

    badNonce = false;
    ({ target, state } = await begin());
    target.searchParams.set('state', state);
    expect((await globalThis.fetch(target)).status).toBe(200);
    const status = await (await request('/status')).json();
    expect(status).toMatchObject({ connected: true, models: [{ id: 'test-model', name: 'Test model' }] });
    expect(JSON.stringify(status)).not.toMatch(/fake-access|fake-refresh/);
    const result = await request('/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', instructions: 'Return grouping JSON', input: 'Synthetic tabs', store: true }),
    });
    expect(result.status).toBe(200);
    expect(await result.text()).toContain('response.completed');
    expect(await (await request('/signout', { method: 'POST' })).json()).toEqual({ revoked: true });
    expect(await readFile(join(directory, 'chatgpt.json'), 'utf8')).not.toMatch(/fake-access|fake-refresh/);
  } finally {
    await new Promise(done => server.close(done));
    await rm(join(directory, 'chatgpt.json'), { force: true });
    await rmdir(directory);
  }
});

it('upgrades the host identifier of an existing helper without changing its pairing code', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tab-sorter-chatgpt-'));
  const file = join(directory, 'chatgpt.json');
  const original = { key: 'synthetic-pairing-code', hostId: '26fb78dc-940a-46b2-bce3-ab0daf7c110c', profiles: {}, active: null };
  await writeFile(file, JSON.stringify(original));
  const { key, server } = await startHelper({ directory, port: 0 });
  try {
    expect(key).toBe(original.key);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ...original, hostId: 'urn:uuid:' + original.hostId });
  } finally {
    await new Promise(done => server.close(done));
    await rm(file, { force: true });
    await rmdir(directory);
  }
});
