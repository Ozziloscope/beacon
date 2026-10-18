'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const config = require('./lib/config');
const db = require('./lib/db');
const auth = require('./lib/auth');
const { HttpError, Router, parseCookies, readBody, parseForm, clientIp, isSecure, cookie, sendFile } = require('./lib/http');
const { html } = require('./lib/html');
const ui = require('./views/ui');

const SESSION_COOKIE = 'beacon_session';
const CSRF_COOKIE = 'beacon_csrf';
const FLASH_COOKIE = 'beacon_flash';

// Cache-busting version for static assets: changes whenever any file in /public changes.
function computeAssetVersion() {
  const h = crypto.createHash('sha1');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(p + fs.statSync(p).mtimeMs);
    }
  };
  walk(config.publicDir);
  return h.digest('hex').slice(0, 10);
}
const assetVersion = computeAssetVersion();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' https: data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
function requireUser(ctx) {
  if (!ctx.user) {
    const next = ctx.req.method === 'GET' ? `?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}` : '';
    if (ctx.wantsJson) throw new HttpError(401, 'Sign in to do that.');
    return ctx.redirect(`/login${next}`);
  }
}

function requirePerm(perm) {
  return (ctx) => {
    if (ctx.can(perm)) return;
    if (!ctx.user) return requireUser(ctx);
    throw new HttpError(403, "Your role doesn't allow that. Ask an admin if you need access.");
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const router = new Router();
const helpers = { requireUser, requirePerm };
require('./routes/users')(router, helpers);
require('./routes/articles')(router, helpers);
require('./routes/admin')(router, helpers);

router.get('/healthz', (ctx) => {
  db.get('SELECT 1');
  ctx.res.writeHead(200, { 'Content-Type': 'text/plain' });
  ctx.res.end('ok');
  ctx.sent = true;
});

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------
function errorPage(ctx, status, message) {
  const titles = { 400: "That didn't work", 401: 'Sign in required', 403: 'Not allowed', 404: 'Not found', 409: 'Edit conflict', 413: 'Too large', 415: 'Unsupported file', 429: 'Slow down', 500: 'Something went wrong' };
  const title = titles[status] || 'Error';
  const body = html`
    <div class="error-page">
      <p class="error-code">${status}</p>
      <h1>${title}</h1>
      <p>${message}</p>
      <p><a class="btn" href="/">Go to the home page</a>${ctx.user ? '' : html` <a class="btn btn-ghost" href="/login">Sign in</a>`}</p>
    </div>`;
  return ui.layout(ctx, { title, body });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

  // Static assets
  if (pathname.startsWith('/static/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const rel = decodeURIComponent(pathname.slice('/static/'.length));
    const versioned = url.searchParams.has('v');
    if (sendFile(req, res, config.publicDir, rel, { maxAge: versioned ? 31536000 : 300, immutable: versioned })) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  if (pathname === '/favicon.ico') {
    res.writeHead(301, { Location: '/static/img/favicon.svg' });
    res.end();
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const secure = isSecure(req);
  const setCookies = [];
  const settings = db.getSettings();

  const ctx = {
    req, res, url,
    query: Object.fromEntries(url.searchParams),
    params: {},
    ip: clientIp(req),
    settings,
    assetVersion,
    user: null,
    token: null,
    session: null,
    flash: [],
    sent: false,
    wantsJson: pathname.startsWith('/api/') || String(req.headers.accept || '').includes('application/json'),
    spaces: db.all('SELECT * FROM spaces ORDER BY sort, name'),
  };

  // Session
  const token = cookies[SESSION_COOKIE];
  const session = auth.loadSession(token);
  if (session) {
    const user = auth.loadUser(session.user_id);
    if (user && user.status === 'active') {
      ctx.user = user;
      ctx.token = token;
      ctx.session = session;
      if (session.renewed) setCookies.push(cookie(SESSION_COOKIE, token, { maxAge: config.sessionDays * 86400, secure }));
    } else {
      auth.destroySession(token);
      setCookies.push(cookie(SESSION_COOKIE, '', { maxAge: 0, secure }));
    }
  } else if (token) {
    setCookies.push(cookie(SESSION_COOKIE, '', { maxAge: 0, secure }));
  }

  // CSRF token: per session when signed in, double-submit cookie otherwise.
  if (ctx.session) ctx.csrf = ctx.session.csrf;
  else {
    ctx.csrf = cookies[CSRF_COOKIE];
    if (!ctx.csrf || !/^[A-Za-z0-9_-]{20,}$/.test(ctx.csrf)) {
      ctx.csrf = crypto.randomBytes(24).toString('base64url');
      setCookies.push(cookie(CSRF_COOKIE, ctx.csrf, { secure }));
    }
  }

  // Flash messages survive exactly one redirect.
  if (cookies[FLASH_COOKIE]) {
    try { ctx.flash = JSON.parse(Buffer.from(cookies[FLASH_COOKIE], 'base64url').toString('utf8')).slice(0, 5); } catch { ctx.flash = []; }
    setCookies.push(cookie(FLASH_COOKIE, '', { maxAge: 0, secure }));
  }
  const pendingFlash = [];

  ctx.can = (perm) => {
    if (ctx.user) return auth.can(ctx.user, perm);
    return perm === 'articles.read' && settings.require_login === '0';
  };
  ctx.setFlash = (type, message) => pendingFlash.push({ type, message: String(message).slice(0, 400) });

  ctx.checkCsrf = (formToken) => {
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let host;
      try { host = new URL(origin).host; } catch { host = ''; }
      const expected = (config.trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
      if (host !== expected) throw new HttpError(403, 'This request came from another site and was blocked.');
    }
    const supplied = formToken || req.headers['x-csrf-token'];
    const a = Buffer.from(String(supplied || ''));
    const b = Buffer.from(String(ctx.csrf || ''));
    if (!supplied || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new HttpError(403, 'Your session expired or the form was stale. Go back, refresh the page and try again.');
    }
  };
  ctx.form = async () => {
    if (ctx._form) return ctx._form;
    const buf = await readBody(req, config.maxFormBytes);
    ctx._form = parseForm(buf);
    ctx.checkCsrf(ctx._form._csrf);
    return ctx._form;
  };

  const finishHeaders = () => {
    if (pendingFlash.length) setCookies.push(cookie(FLASH_COOKIE, Buffer.from(JSON.stringify(pendingFlash)).toString('base64url'), { secure, maxAge: 60 }));
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
  };
  ctx.html = (body, status = 200) => {
    finishHeaders();
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(String(body));
    ctx.sent = true;
  };
  ctx.json = (obj, status = 200) => {
    finishHeaders();
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
    ctx.sent = true;
  };
  ctx.redirect = (location, status = 303) => {
    finishHeaders();
    res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
    ctx.sent = true;
  };
  ctx.startSession = (userId) => {
    if (ctx.token) auth.destroySession(ctx.token);
    const s = auth.createSession(userId, { ip: ctx.ip, userAgent: req.headers['user-agent'] });
    setCookies.push(cookie(SESSION_COOKIE, s.token, { maxAge: config.sessionDays * 86400, secure }));
    ctx.token = s.token;
  };
  ctx.endSession = () => {
    auth.destroySession(ctx.token);
    ctx.user = null;
    setCookies.push(cookie(SESSION_COOKIE, '', { maxAge: 0, secure }));
  };

  try {
    // Members whose password was reset must pick a new one before anything else.
    if (ctx.user && ctx.user.must_change_password && !/^\/(account|logout|static|avatars)/.test(pathname)) {
      ctx.setFlash('error', 'Choose a new password to keep using your account.');
      return ctx.redirect('/account');
    }

    const match = router.match(req.method, pathname);
    if (!match) throw new HttpError(404, "There's no page at this address.");
    if (match.methodMismatch) throw new HttpError(405, 'That action is not available here.');
    ctx.params = match.params;
    for (const h of match.handlers) {
      await h(ctx);
      if (ctx.sent) return;
    }
    if (!ctx.sent) throw new HttpError(500, 'The page did not produce a response.');
  } catch (err) {
    if (ctx.sent || res.headersSent) {
      if (!(err instanceof HttpError)) console.error(err);
      return;
    }
    if (err instanceof HttpError && err.location) {
      return ctx.redirect(err.location, err.status);
    }
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : 'An unexpected error happened. It has been logged on the server.';
    if (!(err instanceof HttpError)) console.error(`[${new Date().toISOString()}] ${req.method} ${pathname}\n`, err);
    if (ctx.wantsJson) return ctx.json({ error: message }, status);
    return ctx.html(errorPage(ctx, status, message), status);
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error');
  });
});
server.headersTimeout = 30e3;
server.requestTimeout = 120e3;

if (require.main === module) {
  server.listen(config.port, config.host, () => {
    const users = db.get('SELECT COUNT(*) AS n FROM users').n;
    console.log(`Beacon ${config.version} listening on http://${config.host}:${config.port}`);
    console.log(`Data directory: ${config.dataDir}`);
    if (!users) console.log('No accounts yet: open the site and create the first account. It becomes the admin.');
  });
  const shutdown = (sig) => {
    console.log(`${sig} received, shutting down`);
    server.close(() => {
      try { db.db.close(); } catch {}
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { server, handle };
