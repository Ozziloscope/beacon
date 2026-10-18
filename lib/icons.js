'use strict';
const { raw } = require('./html');

// 24px stroke icons drawn for Beacon. Inherit color via currentColor.
const PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>',
  tag: '<path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1L21 12l-8.4 8.5Z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c1.2-3.8 4.3-5.5 8-5.5s6.8 1.7 8 5.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.9-3.2 3.4-4.8 6.5-4.8s5.6 1.6 6.5 4.8"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.9c1.8.6 3 2.1 3.5 4.6"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5.5-5 4 3.5 2.5-2 4.5 3.5"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6Z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/>',
  listOrdered: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5h1.2V9M3.8 9h2.6M3.8 14.5c.3-.6.9-1 1.6-1 1.5 0 1.6 1.7.6 2.5l-2.2 1.9h2.8"/>',
  logout: '<path d="M14 4h4.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m4.5 12.5 4.5 4.5 10.5-10.5"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  bold: '<path d="M7 4.5h6a3.75 3.75 0 0 1 0 7.5H7Zm0 7.5h7a3.75 3.75 0 0 1 0 7.5H7Z"/>',
  italic: '<path d="M10 4.5h8M6 19.5h8M14.5 4.5l-5 15"/>',
  heading: '<path d="M5 4.5v15M15 4.5v15M5 12h10"/><path d="M18.5 19.5v-6l-1.8 1.2"/>',
  code: '<path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5"/>',
  quote: '<path d="M5 18.5V13c0-4 1.6-6.5 5-7.5M14 18.5V13c0-4 1.6-6.5 5-7.5"/><path d="M5 13h4.5v5.5H5zM14 13h4.5v5.5H14z"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  columns: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M12 4.5v15"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6.5L20.5 7"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3A2 2 0 0 1 18.5 20 15.5 15.5 0 0 1 4.5 6 2 2 0 0 1 6.5 3.5Z"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5S14.3 18.1 12 20.5C9.7 18.1 8.6 15.3 8.6 12S9.7 5.9 12 3.5Z"/>',
  chat: '<path d="M4 5.5h16v10.5H9.5L5 20v-4H4Z"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5v-2h6v2M3.5 12.5h17"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  restore: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4 3.5v4.5h4.5"/>',
  diff: '<path d="M7 3.5v11M3.5 9h7M14 19.5h7"/><path d="M17.5 3.5v11"/>',
  upload: '<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  space: '<path d="M4 6.5 12 3l8 3.5-8 3.5Z"/><path d="m4 12 8 3.5 8-3.5M4 17.5 12 21l8-3.5"/>',
  dashboard: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/>',
  toc: '<path d="M4 6h10M4 12h16M8 18h12"/>',
  dots: '<circle cx="5.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.5" cy="12" r="1"/>',
};

function icon(name, { size = 18, label, cls = '' } = {}) {
  const body = PATHS[name] || '';
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return raw(`<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`);
}

// Lighthouse Techs mark, redrawn from the brand wordmark: lantern, gallery,
// tapered tower and four beams. Uses the brand orange via var(--accent).
const MARK = `<g fill="currentColor"><path d="M35.5 2 42.5 7.6h-14Z"/><rect x="29" y="10" width="13" height="7.6" rx=".4"/><rect x="28" y="20" width="15" height="2.4" rx=".4"/><rect x="23" y="54.8" width="25" height="3" rx=".4"/></g>
  <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M28.8 22.4 25.2 55M42.2 22.4 45.8 55"/><path d="M6.8 7 23 11.8M6.8 20.4 23 15.8M64.2 7 48 11.8M64.2 20.4 48 15.8"/></g>`;

function logo(size = 28) {
  return raw(`<svg class="logo-mark" width="${Math.round(size * 61 / 58)}" height="${size}" viewBox="5 0.5 61 58" aria-hidden="true">${MARK}</svg>`);
}

/** Two-weight wordmark: first word bold, the rest regular in slate. */
function wordmark(name) {
  const words = String(name || '').trim().split(/\s+/);
  const first = words.shift() || '';
  const esc = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return raw(`<span class="brand-name"><span class="brand-primary">${esc(first)}</span>${words.length ? `<span class="brand-secondary">${esc(words.join(' '))}</span>` : ''}</span>`);
}

module.exports = { icon, logo, wordmark, MARK };
