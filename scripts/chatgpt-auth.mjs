import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { URL, URLSearchParams } from 'node:url';

const ISSUER = 'https://auth.openai.com';
export const API = 'https://api.openai.com/v1';
const TOKEN = ISSUER + '/api/accounts/oauth/token';
const REVOCATION = ISSUER + '/api/accounts/oauth/revoke';
const CLIENT = 'dynamic_agent_client';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export const random = () => randomBytes(32).toString('base64url');

export class BridgeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function beginSignIn(redirect, hostId, profile) {
  const state = random(), nonce = random(), verifier = random();
  const client = profile?.clientId ?? CLIENT;
  const url = new URL(ISSUER + '/api/accounts/authorize');
  url.search = new URLSearchParams({
    client_id: client, ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirect,
    scope: 'openid profile email offline_access resource.invoke ' + PLAN_SCOPE, resource: API,
    state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  if (client === CLIENT) url.searchParams.set('agent_name_hint', 'Tab Sorter');
  if (profile?.idToken) url.searchParams.set('id_token_hint', profile.idToken);
  return { url: url.href, client, redirect, state, nonce, verifier, expires: Date.now() + 600_000 };
}

async function formPost(fetcher, endpoint, fields) {
  return fetcher(endpoint, {
    method: 'POST', body: new URLSearchParams(fields), redirect: 'error',
    signal: globalThis.AbortSignal.timeout(10_000),
  });
}

async function tokenRequest(fetcher, fields) {
  const response = await formPost(fetcher, TOKEN, { ...fields, resource: API });
  if (!response.ok) {
    await response.body?.cancel();
    throw new BridgeError(response.status < 500 ? 401 : 502, 'OpenAI could not authorize this session. Continue with ChatGPT to try again.');
  }
  return response.json();
}

async function verifyIdentity(fetcher, jwt, client, nonce) {
  const parts = String(jwt ?? '').split('.');
  if (parts.length !== 3) throw new Error('Missing signed identity');
  const [header, payload, signature] = parts;
  const { alg, kid } = JSON.parse(Buffer.from(header, 'base64url'));
  if (alg !== 'RS256' || typeof kid !== 'string') throw new Error('Unexpected signing algorithm');
  const response = await fetcher(ISSUER + '/.well-known/jwks.json', {
    signal: globalThis.AbortSignal.timeout(10_000), redirect: 'error',
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Signing keys unavailable'); }
  const { keys } = await response.json();
  const jwk = keys.find(key => key.kid === kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256'));
  if (!jwk || !verify('RSA-SHA256', Buffer.from(header + '.' + payload),
    createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url'))) {
    throw new Error('Invalid identity signature');
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audience.includes(client) ||
    ((audience.length > 1 || claims.azp !== undefined) && claims.azp !== client) ||
    (nonce !== undefined && claims.nonce !== nonce) || typeof claims.sub !== 'string' ||
    typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw new Error('Invalid identity claims');
  return claims;
}

function credentials(tokens, existingScope = '') {
  const scope = tokens.scope ?? existingScope;
  if (!scope.split(/\s+/).includes(PLAN_SCOPE)) throw new BridgeError(403, 'ChatGPT plan access was not granted. Continue with ChatGPT to authorize it.');
  if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
    throw new Error('Missing session credentials');
  }
  return {
    scope, accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    expires: Date.now() + tokens.expires_in * 1000,
  };
}

export async function finishSignIn(fetcher, attempt, query, profile) {
  const issued = query.get('client_id'), code = query.get('code');
  const clientId = attempt.client === CLIENT ? issued : attempt.client;
  if (!code || !clientId || !/^oaiapp_[\w-]+$/.test(clientId) || (issued && issued !== clientId)) {
    throw new BridgeError(400, 'OpenAI did not complete the Tab Sorter registration. Try signing in again.');
  }
  const tokens = await tokenRequest(fetcher, {
    grant_type: 'authorization_code', client_id: clientId, code,
    code_verifier: attempt.verifier, redirect_uri: attempt.redirect,
  });
  const identity = await verifyIdentity(fetcher, tokens.id_token, clientId, attempt.nonce);
  if (profile && profile.subject !== identity.sub) throw new Error('Account changed during sign-in');
  return {
    ...credentials(tokens), clientId, idToken: tokens.id_token, subject: identity.sub,
    label: typeof identity.email === 'string' ? identity.email : 'ChatGPT account',
  };
}

export async function refresh(fetcher, profile) {
  const tokens = await tokenRequest(fetcher, {
    grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: profile.refreshToken,
  });
  if (tokens.id_token) {
    const identity = await verifyIdentity(fetcher, tokens.id_token, profile.clientId);
    if (identity.sub !== profile.subject) throw new Error('Account changed during token refresh');
  }
  return { ...profile, ...credentials(tokens, profile.scope), idToken: tokens.id_token ?? profile.idToken };
}

export async function revoke(fetcher, profile) {
  if (!profile.refreshToken) return true;
  for (const wait of [0, 500, 1500]) {
    if (wait) await delay(wait);
    try {
      const response = await formPost(fetcher, REVOCATION, {
        token: profile.refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId,
      });
      await response.body?.cancel();
      if (response.ok) return true;
      if (response.status < 500) break;
    } catch { /* Retry transient failures. */ }
  }
  return false;
}
