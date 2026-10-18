'use strict';
// Minimal SMTP client (no dependencies). Supports STARTTLS (port 587),
// implicit TLS (port 465) and plain connections, with AUTH PLAIN or LOGIN.
// Works with Gmail/Google Workspace (app password), Microsoft 365, Fastmail,
// Proton Bridge, Mailgun, SendGrid, Postmark, Amazon SES and local relays.
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const crypto = require('node:crypto');
const { getSettings } = require('./db');

const TIMEOUT_MS = 20000;

function mailConfig(settings = getSettings()) {
  return {
    host: String(settings.smtp_host || '').trim(),
    port: parseInt(settings.smtp_port, 10) || 587,
    security: ['starttls', 'tls', 'none'].includes(settings.smtp_security) ? settings.smtp_security : 'starttls',
    user: String(settings.smtp_user || ''),
    pass: String(settings.smtp_pass || ''),
    from: String(settings.mail_from || '').trim(),
  };
}

function isConfigured(settings) {
  const c = mailConfig(settings);
  return !!(c.host && c.from && addressOf(c.from));
}

/** "Beacon <wiki@example.com>" → "wiki@example.com" */
function addressOf(value) {
  const s = String(value || '').trim();
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>\s*$/);
  const addr = m ? m[1] : s;
  return /^[^\s@<>,;]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/.test(addr) ? addr : '';
}

const noBreaks = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

function encodeHeader(value) {
  const v = noBreaks(value);
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

function encodeFrom(from) {
  const v = noBreaks(from);
  const m = v.match(/^(.*?)\s*<([^<>]+)>$/);
  if (!m || !m[1]) return v;
  const name = m[1].replace(/^"|"$/g, '');
  return `${/^[\w .-]*$/.test(name) ? `"${name}"` : encodeHeader(name)} <${m[2]}>`;
}

function b64lines(text) {
  return Buffer.from(text, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
}

function buildMessage({ from, to, subject, text, html }) {
  const boundary = `beacon-${crypto.randomBytes(12).toString('hex')}`;
  const domain = (addressOf(from).split('@')[1]) || 'beacon.local';
  const headers = [
    `From: ${encodeFrom(from)}`,
    `To: ${noBreaks(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
  ];
  let body;
  if (html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64lines(text),
      `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64lines(html),
      `--${boundary}--`, '',
    ].join('\r\n');
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    body = b64lines(text);
  }
  // Dot-stuffing for the DATA phase.
  return (headers.join('\r\n') + '\r\n\r\n' + body).replace(/\r\n\./g, '\r\n..');
}

/** Line-oriented SMTP conversation over a socket that can be upgraded to TLS. */
class Conversation {
  constructor(socket) {
    this.attach(socket);
  }
  attach(socket) {
    this.socket = socket;
    this.buffer = '';
    this.waiters = [];
    this.lines = [];
    socket.setEncoding('utf8');
    const fail = (e) => {
      this.error = e;
      for (const w of this.waiters.splice(0)) w.reject(e);
    };
    socket.on('error', (e) => fail(e));
    socket.on('close', () => fail(new Error('The mail server closed the connection.')));
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).replace(/\r$/, '');
        this.buffer = this.buffer.slice(i + 1);
        this.lines.push(line);
        // A reply ends at a line whose 4th character is a space ("250 OK").
        if (/^\d{3}(?: |$)/.test(line)) {
          const reply = { code: parseInt(line.slice(0, 3), 10), lines: this.lines.map((l) => l.slice(4)) };
          this.lines = [];
          const w = this.waiters.shift();
          if (w) w.resolve(reply);
        }
      }
    });
  }
  read() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The mail server stopped responding.')), TIMEOUT_MS);
      if (this.error && this.socket.destroyed) { clearTimeout(timer); reject(this.error); return; }
      this.waiters.push({ resolve: (r) => { clearTimeout(timer); resolve(r); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    });
  }
  async cmd(line, expect, label) {
    if (line !== null) this.socket.write(line + '\r\n');
    const reply = await this.read();
    const ok = Array.isArray(expect) ? expect.includes(reply.code) : reply.code === expect;
    if (!ok) {
      const err = new Error(`${label || 'Mail server'} refused: ${reply.code} ${reply.lines.join(' ')}`.trim());
      err.code = reply.code;
      throw err;
    }
    return reply;
  }
}

function connect(c) {
  return new Promise((resolve, reject) => {
    const opts = { host: c.host, port: c.port, servername: net.isIP(c.host) ? undefined : c.host };
    const socket = c.security === 'tls' ? tls.connect(opts) : net.connect(opts);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Couldn't reach ${c.host}:${c.port}.`)); }, TIMEOUT_MS);
    socket.once(c.security === 'tls' ? 'secureConnect' : 'connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (e) => { clearTimeout(timer); reject(new Error(`Couldn't connect to ${c.host}:${c.port}: ${e.message}`)); });
  });
}

function upgrade(socket, host) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: net.isIP(host) ? undefined : host });
    secure.once('secureConnect', () => resolve(secure));
    secure.once('error', (e) => reject(new Error(`TLS with the mail server failed: ${e.message}`)));
  });
}

/**
 * Send one email. Resolves when the server accepts it; rejects with a
 * readable message otherwise.
 */
async function send({ to, subject, text, html }, settings) {
  const c = mailConfig(settings);
  if (!isConfigured(settings)) throw new Error('Email is not set up. Add the mail server under Administration → Site settings.');
  const rcpt = addressOf(to);
  if (!rcpt) throw new Error(`"${to}" isn't a valid email address.`);
  const helo = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'beacon.local';

  let socket = await connect(c);
  const conv = new Conversation(socket);
  try {
    await conv.cmd(null, 220, 'Greeting');
    let ehlo = await conv.cmd(`EHLO ${helo}`, 250, 'EHLO');
    if (c.security === 'starttls') {
      if (!ehlo.lines.some((l) => /^STARTTLS/i.test(l))) throw new Error('The mail server does not offer STARTTLS. Choose TLS (port 465) or "None" in Site settings.');
      await conv.cmd('STARTTLS', 220, 'STARTTLS');
      socket.removeAllListeners('data');
      socket.removeAllListeners('close');
      socket.removeAllListeners('error');
      socket.on('error', () => {});
      conv.error = null;
      socket = await upgrade(socket, c.host);
      conv.attach(socket);
      ehlo = await conv.cmd(`EHLO ${helo}`, 250, 'EHLO');
    }
    if (c.user) {
      const authLine = ehlo.lines.find((l) => /^AUTH[ =]/i.test(l)) || '';
      if (/\bPLAIN\b/i.test(authLine) || !/\bLOGIN\b/i.test(authLine)) {
        await conv.cmd(`AUTH PLAIN ${Buffer.from(`\0${c.user}\0${c.pass}`).toString('base64')}`, 235, 'Sign-in');
      } else {
        await conv.cmd('AUTH LOGIN', 334, 'Sign-in');
        await conv.cmd(Buffer.from(c.user).toString('base64'), 334, 'Sign-in');
        await conv.cmd(Buffer.from(c.pass).toString('base64'), 235, 'Sign-in');
      }
    }
    await conv.cmd(`MAIL FROM:<${addressOf(c.from)}>`, 250, 'Sender');
    await conv.cmd(`RCPT TO:<${rcpt}>`, [250, 251], 'Recipient');
    await conv.cmd('DATA', 354, 'DATA');
    socket.write(buildMessage({ from: c.from, to: rcpt, subject, text, html }) + '\r\n.\r\n');
    await conv.cmd(null, 250, 'Message');
    socket.write('QUIT\r\n');
  } finally {
    setTimeout(() => socket.destroy(), 200).unref();
  }
}

module.exports = { send, isConfigured, mailConfig, addressOf, buildMessage };
