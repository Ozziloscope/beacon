(function () {
  'use strict';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var root = document.documentElement;

  // ---------------------------------------------------------------- theme
  var ORDER = ['system', 'light', 'dark'];
  var LABEL = { system: 'Theme follows your system', light: 'Light theme', dark: 'Dark theme' };
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme(pref) {
    var dark = pref === 'dark' || (pref === 'system' && mq.matches);
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-pref', pref);
    $$('[data-theme-toggle]').forEach(function (b) {
      var next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
      b.title = LABEL[pref] + '. Switch to ' + next + '.';
      b.setAttribute('aria-label', b.title);
    });
  }
  function currentPref() { return root.getAttribute('data-theme-pref') || 'system'; }
  applyTheme(currentPref());
  $$('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = ORDER[(ORDER.indexOf(currentPref()) + 1) % ORDER.length];
      try { localStorage.setItem('beacon-theme', next); } catch (e) {}
      applyTheme(next);
    });
  });
  if (mq.addEventListener) mq.addEventListener('change', function () { if (currentPref() === 'system') applyTheme('system'); });

  // ----------------------------------------------------------------- menus
  $$('[data-menu]').forEach(function (menu) {
    var trigger = $('.menu-trigger', menu), panel = $('.menu-panel', menu);
    function close() { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = panel.hidden;
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      if (open) { var first = $('[role="menuitem"]', panel); if (first) first.focus(); }
    });
    document.addEventListener('click', function (e) { if (!menu.contains(e.target)) close(); });
    menu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); trigger.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var items = $$('[role="menuitem"]', panel), i = items.indexOf(document.activeElement);
        if (items.length) { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
      }
    });
  });

  // Spaces drawer (right side). Opened from the header; Esc, the backdrop or a link closes it.
  var drawer = $('#spaces-drawer'), backdrop = $('.drawer-backdrop'), opener = $('[data-drawer-open]');
  if (drawer && opener) {
    var setDrawer = function (open) {
      drawer.hidden = !open;
      backdrop.hidden = !open;
      opener.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
      if (open) { var cur = $('[aria-current="page"]', drawer) || $('a', drawer); if (cur) cur.focus(); }
      else opener.focus();
    };
    opener.addEventListener('click', function () { setDrawer(drawer.hidden); });
    $$('[data-drawer-close]').forEach(function (el) { el.addEventListener('click', function () { setDrawer(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !drawer.hidden) setDrawer(false); });
  }

  // ---------------------------------------------------------------- flashes
  $$('.flash').forEach(function (f) {
    var close = function () { f.remove(); };
    $('.flash-close', f).addEventListener('click', close);
    if (f.classList.contains('flash-success')) setTimeout(close, 6000);
  });

  // ------------------------------------------------------- confirm actions
  $$('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // ------------------------------------------------- "/" focuses search
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var s = $('.header-search input');
    if (s) { e.preventDefault(); s.focus(); s.select(); }
  });

  // -------------------------------------------------------- code copy buttons
  function addCopyButtons(scope) {
    $$('pre.code', scope).forEach(function (pre) {
      if (pre.querySelector('.copy-btn')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.setAttribute('aria-label', 'Copy code');
      btn.title = 'Copy code';
      btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>';
      btn.addEventListener('click', function () {
        var text = pre.querySelector('code').innerText;
        var done = function () {
          btn.classList.add('copied');
          btn.setAttribute('aria-label', 'Copied');
          setTimeout(function () { btn.classList.remove('copied'); btn.setAttribute('aria-label', 'Copy code'); }, 1500);
        };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done);
        else {
          var ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) {}
          ta.remove();
        }
      });
      pre.appendChild(btn);
    });
  }
  addCopyButtons(document);
  window.Beacon = window.Beacon || {};
  window.Beacon.addCopyButtons = addCopyButtons;

  // --------------------------------------------------------------- lightbox
  var lb = $('[data-lightbox]');
  if (lb) {
    var lbImg = $('img', lb), lbCap = $('.lightbox-caption', lb);
    $$('[data-prose] img').forEach(function (img) {
      img.addEventListener('click', function () {
        lbImg.src = img.currentSrc || img.src;
        lbImg.alt = img.alt;
        var fig = img.closest('figure'), cap = fig && fig.querySelector('figcaption');
        lbCap.textContent = cap ? cap.textContent : img.alt;
        lb.hidden = false;
      });
    });
    var closeLb = function () { lb.hidden = true; lbImg.removeAttribute('src'); };
    lb.addEventListener('click', closeLb);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !lb.hidden) closeLb(); });
  }

  // ------------------------------------------------- floating table of contents
  var toc = $('[data-toc]');
  if (toc) {
    var links = $$('[data-toc-link]', toc);
    var headings = links.map(function (a) { return document.getElementById(a.getAttribute('data-toc-link')); }).filter(Boolean);
    var progress = $('.toc-progress', toc);
    var prose = $('[data-prose]');
    var ticking = false;

    function update() {
      ticking = false;
      var offset = parseInt(getComputedStyle(root).getPropertyValue('--header-h'), 10) + 40 || 100;
      var active = null;
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top - offset <= 0) active = headings[i];
        else break;
      }
      if (!active && headings.length) active = headings[0];
      // At the very bottom of the page the last heading is the current one.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = headings[headings.length - 1];
      links.forEach(function (a) {
        var on = active && a.getAttribute('data-toc-link') === active.id;
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
      });
      if (prose && progress) {
        var r = prose.getBoundingClientRect();
        var total = r.height - window.innerHeight + offset;
        var pct = total > 0 ? Math.min(100, Math.max(0, ((offset - r.top) / total) * 100)) : 100;
        progress.style.setProperty('--progress', pct.toFixed(1) + '%');
      }
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update);
    update();

    var fab = $('[data-toc-open]');
    if (fab) {
      fab.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = toc.classList.toggle('open');
        fab.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', function (e) { if (!toc.contains(e.target)) toc.classList.remove('open'); });
      links.forEach(function (a) { a.addEventListener('click', function () { toc.classList.remove('open'); }); });
    }
  }

  // ---------------------------------------------------------- tags filter
  var tagFilter = $('[data-tag-filter]');
  if (tagFilter) {
    tagFilter.addEventListener('input', function () {
      var q = tagFilter.value.trim().toLowerCase();
      $$('[data-tag-group]').forEach(function (g) {
        var any = false;
        $$('[data-tag-name]', g).forEach(function (li) {
          var show = !q || li.getAttribute('data-tag-name').indexOf(q) !== -1;
          li.hidden = !show;
          if (show) any = true;
        });
        g.hidden = !any;
      });
    });
  }
})();
