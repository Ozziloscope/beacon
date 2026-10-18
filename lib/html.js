'use strict';

// Tagged template that escapes every interpolated value unless it is already
// trusted markup (another html`` result or raw()). Arrays are joined.
class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function render(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(String(v));
}

function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Safe(out);
}

const raw = (s) => new Safe(String(s));

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function relTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) { const h = Math.round(diff / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  if (diff < 86400 * 7) { const d = Math.round(diff / 86400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return fmtDate(iso);
}

/** <time> element showing relative time with the exact time on hover. */
function time(iso) {
  if (!iso) return '';
  return html`<time datetime="${iso}" title="${new Date(iso).toUTCString()}">${relTime(iso)}</time>`;
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

module.exports = { html, raw, esc, Safe, fmtDate, relTime, time, plural, fmtBytes };
