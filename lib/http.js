'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message, opts = {}) {
    super(message);
    this.status = status;
    this.expose = true;
    Object.assign(this, opts);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/$/, '').replace(/[.]/g, '\\.').replace(/:(\w+)(\*)?/g, (m, key, star) => {
      keys.push(key);
      return star ? '(.+)' : '([^/]+)';
    }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
    return this;
  }
  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  match(method, pathname) {
    let methodMismatch = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) { methodMismatch = true; continue; }
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handlers: r.handlers, params };
    }
    return methodMismatch ? { methodMismatch: true } : null;
  }
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = parseInt(req.headers['content-length'] || '0', 10);
    if (declared > limit) {
      reject(new HttpError(413, `That upload is too large. The limit is ${Math.round(limit / 1048576)} MB.`));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `That upload is too large. The limit is ${Math.round(limit / 1048576)} MB.`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Parse urlencoded form data, keeping repeated keys as arrays. */
function parseForm(buf) {
  const out = {};
  const params = new URLSearchParams(buf.toString('utf8'));
  for (const [k, v] of params) {
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

function clientIp(req) {
  if (config.trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf);
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function isSecure(req) {
  if (config.secureCookies !== null) return config.secureCookies;
  if (req.socket.encrypted) return true;
  return config.trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function cookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path: p = '/' } = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${p}; SameSite=${sameSite}`;
  if (httpOnly) s += '; HttpOnly';
  if (secure) s += '; Secure';
  if (maxAge !== undefined) s += `; Max-Age=${Math.floor(maxAge)}`;
  return s;
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/**
 * Stream a file from `baseDir`. `rel` must stay inside it.
 * Returns false if the file doesn't exist.
 */
function sendFile(req, res, baseDir, rel, { maxAge = 0, immutable = false, extraHeaders = {} } = {}) {
  const full = path.resolve(baseDir, '.' + path.sep + rel);
  if (!full.startsWith(path.resolve(baseDir) + path.sep)) return false;
  let st;
  try { st = fs.statSync(full); } catch { return false; }
  if (!st.isFile()) return false;
  const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
  const headers = {
    'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Last-Modified': st.mtime.toUTCString(),
    ETag: etag,
    'Cache-Control': immutable ? `public, max-age=${maxAge}, immutable` : `private, max-age=${maxAge}`,
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] });
    res.end();
    return true;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(full).pipe(res);
  return true;
}

module.exports = { HttpError, Router, parseCookies, readBody, parseForm, clientIp, isSecure, cookie, sendFile, MIME };
