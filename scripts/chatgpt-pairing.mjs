import { random } from './chatgpt-auth.mjs';

const TTL = 5 * 60_000;
const idPattern = '[A-Za-z0-9_-]{43}';
const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;

function page(res, status, title, content) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Frame-Options': 'DENY',
  });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>
  body{color-scheme:light dark;font:1rem/1.5 system-ui;margin:10vh auto;padding:0 1.5rem;max-width:32rem}
  button{font:inherit;font-weight:600;padding:.65rem 1rem;cursor:pointer}
  </style><main><h1>${title}</h1>${content}</main></html>`);
}

export function createPairing(key, reply) {
  const requests = new Map();
  return function handlePairing(req, res, url, origin) {
    if (!url.pathname.startsWith('/pair/')) return false;
    for (const [id, request] of requests) {
      if (request.expires <= Date.now()) requests.delete(id);
    }
    const caller = req.headers.origin ?? '';
    const extensionRequest = req.headers['x-tab-sorter-setup'] === '1' && (!caller || extensionOrigin.test(caller));
    if (req.method === 'POST' && url.pathname === '/pair/start' && extensionRequest) {
      if (requests.size >= 8) {
        reply(res, 429, { message: 'Too many pairing requests. Wait a few minutes and try again.' });
        return true;
      }
      const approval = random(), secret = random();
      requests.set(approval, { caller, secret, approved: false, expires: Date.now() + TTL });
      reply(res, 200, { approvalUrl: origin + '/pair/approve/' + approval, secret });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/pair/redeem' && extensionRequest) {
      const authorization = req.headers.authorization;
      const match = [...requests].find(([, request]) => request.caller === caller && authorization === 'Bearer ' + request.secret);
      if (!match) reply(res, 404, { message: 'The connection request expired. Try again from Tab Sorter.' });
      else if (!match[1].approved) reply(res, 202, {});
      else {
        requests.delete(match[0]);
        reply(res, 200, { key });
      }
      return true;
    }
    const approve = new RegExp('^/pair/approve/(' + idPattern + ')$').exec(url.pathname);
    const request = approve && requests.get(approve[1]);
    if (request && req.method === 'GET') {
      page(res, 200, 'Connect Tab Sorter', '<p>Allow the browser that just requested setup to use the Tab Sorter helper on this computer. Only approve if you started setup in Tab Sorter.</p><form method="post"><button>Allow connection</button></form>');
    } else if (request && req.method === 'POST' && caller === origin) {
      request.approved = true;
      page(res, 200, 'Connection allowed', '<p>Return to Tab Sorter settings to finish setup.</p>');
    } else {
      page(res, 403, 'Connection request unavailable', '<p>Start a new connection from Tab Sorter settings.</p>');
    }
    return true;
  };
}
