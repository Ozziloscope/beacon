(function () {
  'use strict';
  var form = document.querySelector('[data-editor]');
  if (!form) return;

  var $ = function (sel, r) { return (r || form).querySelector(sel); };
  var $$ = function (sel, r) { return Array.prototype.slice.call((r || form).querySelectorAll(sel)); };
  var ta = $('[data-content]');
  var preview = $('[data-preview]');
  var shell = $('.editor-shell');
  var csrf = $('input[name="_csrf"]').value;
  var canUpload = form.getAttribute('data-can-upload') === '1';
  var wordCount = $('[data-word-count]');
  var uploadStatus = $('[data-upload-status]');
  var draftKey = 'beacon-draft-' + form.getAttribute('data-draft-key');
  var submitting = false;

  // ------------------------------------------------------------- preview
  var renderTimer = null;
  function renderPreview() {
    renderTimer = null;
    if (shell.getAttribute('data-mode') === 'write') return;
    var out = window.BeaconMarkdown.render(ta.value);
    preview.innerHTML = out.html || '<p class="muted">Nothing to preview yet.</p>';
    if (window.Beacon && window.Beacon.addCopyButtons) window.Beacon.addCopyButtons(preview);
  }
  function schedulePreview() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 120);
  }
  function updateCount() {
    var words = (window.BeaconMarkdown.toPlainText(ta.value).match(/\S+/g) || []).length;
    wordCount.textContent = words + (words === 1 ? ' word' : ' words') + ', about ' + Math.max(1, Math.round(words / 220)) + ' min read';
  }

  // --------------------------------------------------------------- modes
  function setMode(mode) {
    if (mode === 'split' && window.matchMedia('(max-width: 860px)').matches) mode = 'write';
    shell.setAttribute('data-mode', mode);
    $$('[data-mode-btn]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-mode-btn') === mode)); });
    try { localStorage.setItem('beacon-editor-mode', mode); } catch (e) {}
    renderPreview();
  }
  $$('[data-mode-btn]').forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode-btn')); });
  });
  var savedMode = 'split';
  try { savedMode = localStorage.getItem('beacon-editor-mode') || 'split'; } catch (e) {}
  setMode(savedMode);

  // Keep the preview roughly aligned with the editor in split view.
  ta.addEventListener('scroll', function () {
    if (shell.getAttribute('data-mode') !== 'split') return;
    var max = ta.scrollHeight - ta.clientHeight;
    var pmax = preview.scrollHeight - preview.clientHeight;
    if (max > 0 && pmax > 0) preview.scrollTop = (ta.scrollTop / max) * pmax;
  });

  // Grow the textarea with its content so the page scrolls naturally.
  function autosize() {
    if (shell.getAttribute('data-mode') === 'split') { ta.style.height = ''; return; }
    ta.style.height = 'auto';
    ta.style.height = Math.max(480, ta.scrollHeight + 4) + 'px';
  }

  // ------------------------------------------------------- text helpers
  function insert(text, selectFrom, selectTo) {
    ta.focus();
    var start = ta.selectionStart;
    // execCommand keeps the browser's undo history intact where supported.
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (selectFrom !== undefined) ta.setSelectionRange(start + selectFrom, start + (selectTo === undefined ? selectFrom : selectTo));
  }

  function wrap(before, after, placeholder) {
    var s = ta.selectionStart, e = ta.selectionEnd;
    var sel = ta.value.slice(s, e) || placeholder;
    insert(before + sel + after, before.length, before.length + sel.length);
  }

  function lineRange() {
    var v = ta.value;
    var start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    var end = v.indexOf('\n', ta.selectionEnd);
    if (end === -1) end = v.length;
    return { start: start, end: end };
  }

  function prefixLines(makePrefix, stripRe) {
    var r = lineRange();
    var lines = ta.value.slice(r.start, r.end).split('\n');
    var allHave = lines.every(function (l) { return !l.trim() || stripRe.test(l); });
    var out = lines.map(function (l, i) {
      if (allHave) return l.replace(stripRe, '');
      return l.trim() ? makePrefix(i) + l.replace(stripRe, '') : l;
    }).join('\n');
    ta.setSelectionRange(r.start, r.end);
    insert(out, 0, out.length);
  }

  function ensureBlankLineBefore() {
    var s = ta.selectionStart, v = ta.value;
    if (s === 0) return '';
    if (v.slice(Math.max(0, s - 2), s) === '\n\n') return '';
    return v.charAt(s - 1) === '\n' ? '\n' : '\n\n';
  }

  var COMMANDS = {
    bold: function () { wrap('**', '**', 'bold text'); },
    italic: function () { wrap('*', '*', 'italic text'); },
    code: function () {
      var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel.indexOf('\n') !== -1) { var pre = ensureBlankLineBefore(); insert(pre + '```\n' + sel + '\n```\n', pre.length + 3, pre.length + 3); }
      else wrap('`', '`', 'code');
    },
    link: function () {
      var s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
      if (/^https?:\/\//.test(sel)) insert('[link text](' + sel + ')', 1, 10);
      else { var text = sel || 'link text'; insert('[' + text + '](https://)', text.length + 3, text.length + 11); }
    },
    heading: function () {
      var r = lineRange(), line = ta.value.slice(r.start, r.end);
      var m = line.match(/^(#{1,6})\s/);
      var next = !m ? '## ' : m[1].length >= 4 ? '' : '#'.repeat(m[1].length + 1) + ' ';
      ta.setSelectionRange(r.start, r.end);
      var text = next + line.replace(/^#{1,6}\s+/, '');
      insert(text, text.length);
    },
    ul: function () { prefixLines(function () { return '- '; }, /^\s*[-*+]\s+(?!\[[ xX]\])/); },
    ol: function () { prefixLines(function (i) { return (i + 1) + '. '; }, /^\s*\d+[.)]\s+/); },
    task: function () { prefixLines(function () { return '- [ ] '; }, /^\s*[-*+]\s+\[[ xX]\]\s+/); },
    quote: function () { prefixLines(function () { return '> '; }, /^>\s?/); },
    callout: function () {
      var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || 'Callout text';
      var pre = ensureBlankLineBefore();
      var body = sel.split('\n').map(function (l) { return '> ' + l; }).join('\n');
      insert(pre + '> [!NOTE]\n' + body + '\n', pre.length + 4, pre.length + 8);
    },
    table: function () {
      var pre = ensureBlankLineBefore();
      var t = '| Column | Column |\n|--------|--------|\n| Cell   | Cell   |\n';
      insert(pre + t, pre.length + 2, pre.length + 8);
    },
    image: function () {
      if (!canUpload) { setStatus("Your role can't upload photos. Link to an image with ![description](https://...) instead.", true); return; }
      fileInput.click();
    },
  };
  $$('[data-cmd]').forEach(function (b) {
    b.addEventListener('click', function () { COMMANDS[b.getAttribute('data-cmd')](); });
  });

  // ----------------------------------------------------------- keyboard
  ta.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); COMMANDS.bold(); return; }
      if (k === 'i') { e.preventDefault(); COMMANDS.italic(); return; }
      if (k === 'k') { e.preventDefault(); COMMANDS.link(); return; }
      if (k === 's' || k === 'enter') { e.preventDefault(); requestSave(); return; }
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
      var r = lineRange(), line = ta.value.slice(r.start, ta.selectionStart);
      var m = line.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)([.)])\s+|>\s?)(.*)$/);
      if (m) {
        e.preventDefault();
        if (!m[5].trim()) {
          // Empty item: end the list.
          ta.setSelectionRange(r.start, ta.selectionStart);
          insert('');
          return;
        }
        var marker = m[3] ? (parseInt(m[3], 10) + 1) + m[4] + ' ' : m[2].replace(/\[[xX]\]/, '[ ]');
        insert('\n' + m[1] + marker);
        return;
      }
    }
    if (e.key === 'Tab' && !mod) {
      var lr = lineRange(), ln = ta.value.slice(lr.start, lr.end);
      if (/^\s*([-*+]|\d+[.)])\s/.test(ln)) {
        e.preventDefault();
        var pos = ta.selectionStart;
        ta.setSelectionRange(lr.start, lr.start + (e.shiftKey ? Math.min(2, ln.match(/^ */)[0].length) : 0));
        insert(e.shiftKey ? '' : '  ');
        var delta = e.shiftKey ? -Math.min(2, ln.match(/^ */)[0].length) : 2;
        ta.setSelectionRange(pos + delta, pos + delta);
      }
    }
  });

  // -------------------------------------------------------------- photos
  var fileInput = $('[data-file-input]');
  var dropOverlay = $('[data-drop-overlay]');
  var active = 0;
  var ACCEPT = /^image\/(png|jpeg|gif|webp)$/;
  var MAX_EDGE = 2560;

  function setStatus(msg, isError) {
    uploadStatus.textContent = msg || '';
    uploadStatus.style.color = isError ? 'var(--danger)' : '';
    if (isError) setTimeout(function () { if (uploadStatus.textContent === msg) setStatus(''); }, 8000);
  }

  // Downscale very large photos in the browser; also strips camera metadata.
  function prepare(file) {
    if (file.type === 'image/gif' || !window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 1.5 * 1024 * 1024) { bmp.close && bmp.close(); return file; }
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close && bmp.close();
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          if (!blob || blob.type !== 'image/webp') {
            canvas.toBlob(function (jpg) { resolve(jpg && jpg.size < file.size ? jpg : file); }, 'image/jpeg', 0.88);
          } else resolve(blob.size < file.size ? blob : file);
        }, 'image/webp', 0.86);
      });
    }).catch(function () { return file; });
  }

  function altFromName(name) {
    return (name || 'photo').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/[\[\]]/g, '').trim() || 'photo';
  }

  function uploadFiles(files) {
    files = Array.prototype.filter.call(files, function (f) { return ACCEPT.test(f.type); });
    if (!files.length) { setStatus('Only PNG, JPEG, GIF and WebP photos can be added.', true); return; }
    if (!canUpload) { setStatus("Your role can't upload photos.", true); return; }
    var pre = ensureBlankLineBefore();
    var tokens = files.map(function (f, i) { return { file: f, id: 'up-' + Date.now().toString(36) + '-' + i }; });
    var placeholder = tokens.map(function (t) { return '![Uploading ' + altFromName(t.file.name) + '…](' + t.id + ')'; }).join('\n\n');
    insert(pre + placeholder + '\n');
    tokens.forEach(function (t) {
      active++;
      setStatus('Uploading ' + active + (active === 1 ? ' photo…' : ' photos…'));
      prepare(t.file).then(function (blob) {
        return fetch('/api/uploads', {
          method: 'POST',
          headers: { 'Content-Type': blob.type || t.file.type, 'X-CSRF-Token': csrf, 'X-Filename': encodeURIComponent(t.file.name || 'photo') },
          body: blob,
          credentials: 'same-origin',
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Upload failed (' + res.status + ').');
          return data;
        });
      }).then(function (data) {
        replacePlaceholder(t.id, '![' + altFromName(t.file.name) + '](' + data.url + ')');
        active--;
        setStatus(active ? 'Uploading ' + active + '…' : 'Photo added.');
        if (!active) setTimeout(function () { if (uploadStatus.textContent === 'Photo added.') setStatus(''); }, 2500);
      }).catch(function (err) {
        replacePlaceholder(t.id, '');
        active--;
        setStatus(err.message || 'Upload failed.', true);
      });
    });
  }

  function replacePlaceholder(id, replacement) {
    var re = new RegExp('!\\[Uploading [^\\]]*\\]\\(' + id + '\\)\\n?');
    var m = ta.value.match(re);
    if (!m) return;
    var start = m.index, end = start + m[0].length;
    var keepStart = ta.selectionStart, keepEnd = ta.selectionEnd;
    var text = replacement ? replacement + (m[0].slice(-1) === '\n' ? '\n' : '') : '';
    ta.setRangeText(text, start, end, 'preserve');
    var delta = text.length - (end - start);
    var adj = function (p) { return p > start ? p + delta : p; };
    ta.setSelectionRange(adj(keepStart), adj(keepEnd));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length) uploadFiles(fileInput.files);
    fileInput.value = '';
  });

  ta.addEventListener('paste', function (e) {
    var dt = e.clipboardData;
    if (!dt) return;
    var files = Array.prototype.slice.call(dt.files || []);
    if (!files.length && dt.items) {
      files = Array.prototype.slice.call(dt.items).filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.getAsFile(); }).filter(Boolean);
    }
    if (files.length && files.some(function (f) { return ACCEPT.test(f.type); })) {
      e.preventDefault();
      uploadFiles(files);
    }
  });

  var dragDepth = 0;
  var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; };
  var writePane = $('.editor-write');
  writePane.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dropOverlay.hidden = false; });
  writePane.addEventListener('dragover', function (e) { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  writePane.addEventListener('dragleave', function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropOverlay.hidden = true; });
  writePane.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    // Put the cursor where the photo was dropped when the browser can tell us.
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (p && p.offsetNode === ta) ta.setSelectionRange(p.offset, p.offset);
    }
    uploadFiles(e.dataTransfer.files);
  });
  // Dropping a file elsewhere on the page shouldn't navigate away from the editor.
  window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', function (e) { if (hasFiles(e) && !writePane.contains(e.target)) e.preventDefault(); });

  // ---------------------------------------------------------------- tags
  var tagBox = $('[data-tag-input]');
  var tagHidden = $('input[name="tags"]', tagBox);
  var tagEntry = $('input[type="text"]', tagBox);
  var chipList = $('[data-chips]', tagBox);
  var suggest = $('.tag-suggest', tagBox);
  var canCreate = tagBox.getAttribute('data-can-create') === '1';
  var tags = tagHidden.value ? tagHidden.value.split(',').filter(Boolean) : [];
  var suggestions = [], selIdx = -1, fetchTimer = null;

  function normTag(t) {
    t = String(t).trim().toLowerCase().replace(/^#/, '').replace(/\s*:\s*/, ':').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return t.slice(0, 48);
  }
  function tagColor(name) {
    var P = ['#D55C13', '#3E7F6E', '#5B6FA8', '#9A7B12', '#A24B6B', '#2F7A8C', '#6E8B3D', '#4F5755'];
    var key = name.indexOf(':') > 0 ? name.split(':')[0] : name, h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return P[h % P.length];
  }
  function renderChips() {
    chipList.innerHTML = '';
    tags.forEach(function (t, i) {
      var li = document.createElement('li');
      var chip = document.createElement('span');
      chip.className = 'tag';
      chip.style.setProperty('--tag', tagColor(t));
      var ns = t.indexOf(':') > 0 ? t.split(':')[0] : '';
      chip.innerHTML = '<span class="tag-dot" aria-hidden="true"></span>' +
        (ns ? '<span class="tag-ns"></span>' : '') + '<span class="tag-name"></span>';
      if (ns) chip.querySelector('.tag-ns').textContent = ns + ':';
      chip.querySelector('.tag-name').textContent = ns ? t.slice(ns.length + 1) : t;
      var x = document.createElement('button');
      x.type = 'button';
      x.setAttribute('aria-label', 'Remove tag ' + t);
      x.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      x.addEventListener('click', function () { tags.splice(i, 1); sync(); tagEntry.focus(); });
      chip.appendChild(x);
      li.appendChild(chip);
      chipList.appendChild(li);
    });
  }
  function sync() { tagHidden.value = tags.join(','); renderChips(); markDirty(); }
  function addTag(raw) {
    var t = normTag(raw);
    if (!t || tags.indexOf(t) !== -1) { tagEntry.value = ''; closeSuggest(); return; }
    // Unknown tags from someone without tags.create are rejected by the server with an explanation.
    tags.push(t);
    tagEntry.value = '';
    closeSuggest();
    sync();
  }
  function closeSuggest() { suggest.hidden = true; tagEntry.setAttribute('aria-expanded', 'false'); selIdx = -1; }
  function showSuggest() {
    var q = normTag(tagEntry.value);
    var items = suggestions.filter(function (s) { return tags.indexOf(s.name) === -1; }).slice(0, 8);
    var exact = items.some(function (s) { return s.name === q; }) || tags.indexOf(q) !== -1;
    suggest.innerHTML = '';
    items.forEach(function (s, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = 'tag-opt-' + i;
      li.dataset.value = s.name;
      li.innerHTML = '<span></span><span class="muted small"></span>';
      li.firstChild.textContent = s.name;
      li.lastChild.textContent = s.count + (s.count === 1 ? ' article' : ' articles');
      suggest.appendChild(li);
    });
    if (q && !exact && canCreate) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = 'tag-opt-new';
      li.dataset.value = q;
      li.className = 'new-tag';
      li.textContent = 'Create tag “' + q + '”';
      suggest.appendChild(li);
    }
    var opts = $$('[role="option"]', suggest);
    if (!opts.length) { closeSuggest(); return; }
    suggest.hidden = false;
    tagEntry.setAttribute('aria-expanded', 'true');
    selIdx = Math.min(selIdx, opts.length - 1);
    opts.forEach(function (o, i) {
      o.setAttribute('aria-selected', String(i === selIdx));
      o.addEventListener('mousedown', function (e) { e.preventDefault(); addTag(o.dataset.value); });
    });
    if (selIdx >= 0) tagEntry.setAttribute('aria-activedescendant', opts[selIdx].id); else tagEntry.removeAttribute('aria-activedescendant');
  }
  function fetchSuggestions() {
    var q = normTag(tagEntry.value);
    if (!q) { suggestions = []; closeSuggest(); return; }
    fetch('/api/tags?q=' + encodeURIComponent(q), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (normTag(tagEntry.value) === q) { suggestions = d.tags || []; showSuggest(); } })
      .catch(function () {});
  }
  tagEntry.addEventListener('input', function () {
    if (/,/.test(tagEntry.value)) {
      tagEntry.value.split(',').slice(0, -1).forEach(addTag);
      tagEntry.value = tagEntry.value.split(',').pop();
    }
    selIdx = -1;
    clearTimeout(fetchTimer);
    fetchTimer = setTimeout(fetchSuggestions, 140);
    showSuggest();
  });
  tagEntry.addEventListener('keydown', function (e) {
    var opts = $$('[role="option"]', suggest);
    if (e.key === 'ArrowDown' && opts.length) { e.preventDefault(); selIdx = (selIdx + 1) % opts.length; showSuggest(); }
    else if (e.key === 'ArrowUp' && opts.length) { e.preventDefault(); selIdx = (selIdx - 1 + opts.length) % opts.length; showSuggest(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (selIdx >= 0 && opts[selIdx]) addTag(opts[selIdx].dataset.value);
      else if (tagEntry.value.trim()) addTag(tagEntry.value);
    } else if (e.key === 'Tab' && tagEntry.value.trim()) { e.preventDefault(); addTag(selIdx >= 0 && opts[selIdx] ? opts[selIdx].dataset.value : tagEntry.value); }
    else if (e.key === 'Backspace' && !tagEntry.value && tags.length) { tags.pop(); sync(); }
    else if (e.key === 'Escape') closeSuggest();
  });
  tagEntry.addEventListener('blur', function () { setTimeout(function () { if (tagEntry.value.trim()) addTag(tagEntry.value); closeSuggest(); }, 120); });
  tagBox.addEventListener('click', function (e) { if (e.target === tagBox || e.target === chipList) tagEntry.focus(); });
  renderChips();

  // ------------------------------------------------- local draft autosave
  var titleInput = $('input[name="title"]'), summaryInput = $('input[name="summary"]'), noteInput = $('input[name="note"]');
  var initial = JSON.stringify(snapshot());
  var dirty = false;
  function snapshot() { return { title: titleInput.value, summary: summaryInput.value, content: ta.value, tags: tags.join(',') }; }
  var saveTimer = null;
  function markDirty() {
    dirty = JSON.stringify(snapshot()) !== initial;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        if (dirty) localStorage.setItem(draftKey, JSON.stringify({ data: snapshot(), at: Date.now() }));
        else localStorage.removeItem(draftKey);
      } catch (e) {}
    }, 600);
  }

  // Offer to restore text that never got saved (closed tab, crash, lost connection).
  (function offerRestore() {
    var stored;
    try { stored = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch (e) { stored = null; }
    if (!stored || !stored.data) return;
    if (JSON.stringify(stored.data) === initial) { try { localStorage.removeItem(draftKey); } catch (e) {} return; }
    if (Date.now() - stored.at > 14 * 86400e3) return;
    var bar = document.createElement('div');
    bar.className = 'form-errors';
    bar.setAttribute('role', 'status');
    bar.style.display = 'flex'; bar.style.gap = '10px'; bar.style.alignItems = 'center'; bar.style.flexWrap = 'wrap';
    var mins = Math.round((Date.now() - stored.at) / 60000);
    bar.innerHTML = '<span style="flex:1">Unsaved changes from ' + (mins < 1 ? 'moments' : mins < 120 ? mins + ' min' : Math.round(mins / 60) + ' hours') + ' ago are stored in this browser.</span>';
    var restore = document.createElement('button'); restore.type = 'button'; restore.className = 'btn btn-sm btn-primary'; restore.textContent = 'Restore them';
    var discard = document.createElement('button'); discard.type = 'button'; discard.className = 'btn btn-sm btn-ghost'; discard.textContent = 'Discard';
    bar.appendChild(restore); bar.appendChild(discard);
    $('.editor-head').insertBefore(bar, titleInput.previousElementSibling);
    restore.addEventListener('click', function () {
      titleInput.value = stored.data.title; summaryInput.value = stored.data.summary; ta.value = stored.data.content;
      tags = stored.data.tags ? stored.data.tags.split(',').filter(Boolean) : [];
      sync(); renderPreview(); updateCount(); bar.remove();
    });
    discard.addEventListener('click', function () { try { localStorage.removeItem(draftKey); } catch (e) {} bar.remove(); });
  })();

  [titleInput, summaryInput].forEach(function (i) { i.addEventListener('input', markDirty); });
  ta.addEventListener('input', function () { schedulePreview(); updateCount(); markDirty(); autosize(); });
  window.addEventListener('beforeunload', function (e) {
    if (dirty && !submitting) { e.preventDefault(); e.returnValue = ''; }
  });

  // --------------------------------------------------------------- saving
  function requestSave() {
    if (noteInput.value.trim().length < 3) { noteInput.focus(); showNoteError(); return; }
    if (form.requestSubmit) form.requestSubmit(); else form.submit();
  }
  function showNoteError() {
    var field = noteInput.closest('.field');
    field.classList.add('has-error');
    var err = field.querySelector('.field-error');
    if (!err) { err = document.createElement('p'); err.className = 'field-error'; err.id = 'note-error'; field.appendChild(err); }
    err.textContent = 'Describe what you changed and why. A revision note is required.';
    noteInput.setAttribute('aria-invalid', 'true');
    noteInput.setAttribute('aria-describedby', 'note-error');
  }
  noteInput.addEventListener('input', function () {
    if (noteInput.value.trim().length >= 3) {
      var field = noteInput.closest('.field');
      field.classList.remove('has-error');
      noteInput.removeAttribute('aria-invalid');
      var err = field.querySelector('.field-error'); if (err) err.remove();
    }
  });
  noteInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); requestSave(); } });

  form.addEventListener('submit', function (e) {
    if (tagEntry.value.trim()) addTag(tagEntry.value);
    if (!titleInput.value.trim()) { e.preventDefault(); titleInput.focus(); titleInput.setAttribute('aria-invalid', 'true'); return; }
    if (noteInput.value.trim().length < 3) { e.preventDefault(); noteInput.focus(); showNoteError(); return; }
    if (active > 0) { e.preventDefault(); setStatus('Wait for photos to finish uploading, then save.', true); return; }
    submitting = true;
    try { localStorage.removeItem(draftKey); } catch (err) {}
    $('[data-save]').disabled = true;
  });

  renderPreview();
  updateCount();
  autosize();
  if (!titleInput.value) titleInput.focus();
})();
