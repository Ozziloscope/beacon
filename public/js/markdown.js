/*
 * Beacon Markdown renderer. Runs on the server (article pages) and in the
 * browser (editor preview), so both always agree.
 *
 * Safe by construction: raw HTML in the source is escaped and shown as text,
 * and link/image URLs are restricted to http(s), mailto, tel and relative paths.
 *
 * Supports: headings (with anchor ids + table of contents), paragraphs, bold,
 * italic, strikethrough, ==highlight==, inline code, fenced code blocks,
 * blockquotes, callouts (> [!NOTE] / TIP / INFO / IMPORTANT / WARNING / DANGER),
 * nested ordered/unordered lists, task lists, tables with alignment, horizontal
 * rules, links, autolinks, bare URLs, [[wiki links]] / [[slug|label]],
 * images with optional width (![alt|400](url)) and captions (![alt](url "caption")).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BeaconMarkdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function slugify(s) {
    var out = String(s).toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return out || 'section';
  }

  function safeUrl(url) {
    url = String(url || '').trim();
    if (!url) return '#';
    // Any scheme other than the allowed ones is dropped (javascript:, data:, vbscript: ...)
    var scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme && !/^(https?|mailto|tel)$/i.test(scheme[1])) return '#';
    if (/^\s*\/\//.test(url)) return 'https:' + url;
    return url;
  }
  function safeImageUrl(url) {
    url = String(url || '').trim();
    if (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url)) return url;
    return '';
  }
  function isExternal(url) { return /^https?:\/\//i.test(url); }

  // -------------------------------------------------------------------------
  // Inline
  // -------------------------------------------------------------------------
  function makeInline(ctx) {
    var stash = [];
    function put(html) { return '\u0001' + (stash.push(html) - 1) + '\u0002'; }

    function link(url, inner, title) {
      var href = safeUrl(url);
      var ext = isExternal(href) ? ' rel="noopener noreferrer" target="_blank"' : '';
      return '<a href="' + esc(href) + '"' + (title ? ' title="' + esc(title) + '"' : '') + ext + '>' + inner + '</a>';
    }

    function image(alt, url, title) {
      var src = safeImageUrl(url);
      if (!src) return esc('[image: ' + alt + ']');
      var width = '';
      var m = String(alt).match(/^(.*?)\|\s*(\d{2,4})(?:x(\d{2,4}))?\s*$/);
      if (m) { alt = m[1].trim(); width = ' width="' + m[2] + '"' + (m[3] ? ' height="' + m[3] + '"' : ''); }
      return '<img src="' + esc(src) + '" alt="' + esc(alt) + '"' + (title ? ' title="' + esc(title) + '"' : '') + width + ' loading="lazy" decoding="async">';
    }

    function wikilink(target, label) {
      target = target.trim();
      var info = ctx.resolveWikiLink ? ctx.resolveWikiLink(target) : null;
      var href = info && info.href ? info.href : '/w/' + slugify(target);
      var cls = 'wikilink' + (info && info.exists === false ? ' wikilink-missing' : '');
      var text = label ? label.trim() : (info && info.title) || target;
      return '<a class="' + cls + '" href="' + esc(href) + '">' + esc(text) + '</a>';
    }

    function core(s) {
      // Hard line breaks: two trailing spaces or a trailing backslash.
      s = s.replace(/(?: {2,}|\\)\n/g, function () { return put('<br>'); });
      // Backslash escapes
      s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~=<>])/g, function (m, c) { return put(esc(c)); });
      // Code spans
      s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (m, ticks, code) {
        return put('<code>' + esc(code.replace(/^ ([\s\S]*) $/, '$1')) + '</code>');
      });
      // Images
      s = s.replace(/!\[([^\]\n]*)\]\(\s*<?((?:[^\s()<>]|\([^\s()<>]*\))+)>?(?:\s+"([^"]*)")?\s*\)/g, function (m, alt, url, title) {
        return put(image(alt, url, title));
      });
      // Wiki links
      s = s.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, function (m, target, label) {
        return put(wikilink(target, label));
      });
      // Links (text may contain one level of brackets, e.g. an image placeholder)
      s = s.replace(/\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\(\s*<?((?:[^\s()<>]|\([^\s()<>]*\))*)>?(?:\s+"([^"]*)")?\s*\)/g, function (m, text, url, title) {
        return put(link(url, core(text), title));
      });
      // Autolinks <https://...>
      s = s.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, function (m, url) {
        return put(link(url, esc(url.replace(/^mailto:/, ''))));
      });
      // Bare URLs
      s = s.replace(/\bhttps?:\/\/[^\s<>\u0001\u0002]+/g, function (m) {
        var tail = '';
        var t = m.match(/[.,:;!?)"'\]*_]+$/);
        if (t) { tail = t[0]; m = m.slice(0, -tail.length); }
        return put(link(m, esc(m))) + tail;
      });

      s = esc(s);

      s = s
        .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
        .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>')
        .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
        .replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');
      return s;
    }

    function restore(s) {
      var guard = 0;
      while (/\u0001\d+\u0002/.test(s) && guard++ < 20) {
        s = s.replace(/\u0001(\d+)\u0002/g, function (m, n) { return stash[+n]; });
      }
      return s;
    }

    return function inline(src) {
      return restore(core(String(src).replace(/[\u0001\u0002]/g, '')));
    };
  }

  function stripTags(html) {
    return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------
  var LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
  var FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/;
  var HEADING_RE = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
  var HR_RE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var QUOTE_RE = /^\s{0,3}>/;
  var TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
  var CALLOUTS = { note: 'Note', tip: 'Tip', info: 'Info', important: 'Important', warning: 'Warning', caution: 'Caution', danger: 'Danger' };

  var blank = function (l) { return /^\s*$/.test(l); };
  var indentOf = function (l) { var m = l.match(/^[ \t]*/)[0]; return m.replace(/\t/g, '    ').length; };
  var isOrdered = function (marker) { return /\d/.test(marker); };

  function isTableStart(lines, i) {
    return lines[i].indexOf('|') !== -1 && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1 && (lines[i + 1].indexOf('|') !== -1 || lines[i].trim().charAt(0) === '|');
  }

  function startsBlock(lines, i) {
    var l = lines[i];
    return FENCE_RE.test(l) || HEADING_RE.test(l) || HR_RE.test(l) || QUOTE_RE.test(l) || isTableStart(lines, i) ||
      (LIST_RE.test(l) && !!l.match(LIST_RE)[3]);
  }

  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|' && s.charAt(s.length - 2) !== '\\') s = s.slice(0, -1);
    var cells = [], cur = '', inCode = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\' && s.charAt(i + 1) === '|') { cur += '|'; i++; continue; }
      if (c === '`') inCode = !inCode;
      if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function Renderer(opts) {
    this.opts = opts || {};
    this.toc = [];
    this.ids = Object.create(null);
    this.inline = makeInline(this.opts);
  }

  Renderer.prototype.uniqueId = function (text) {
    var base = slugify(text), id = base, n = 1;
    while (this.ids[id]) id = base + '-' + (++n);
    this.ids[id] = true;
    return id;
  };

  Renderer.prototype.blocks = function (lines) {
    var out = [], i = 0, m;
    while (i < lines.length) {
      var line = lines[i];
      if (blank(line)) { i++; continue; }

      // Fenced code
      if ((m = line.match(FENCE_RE))) {
        var fence = m[2], indent = m[1].length, lang = m[3] || '', buf = [];
        var close = new RegExp('^\\s{0,3}' + (fence.charAt(0) === '`' ? '`' : '~') + '{' + fence.length + ',}\\s*$');
        i++;
        while (i < lines.length && !close.test(lines[i])) {
          buf.push(lines[i].slice(Math.min(indent, indentOf(lines[i]))));
          i++;
        }
        i++; // closing fence
        out.push('<pre class="code"' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // Heading
      if ((m = line.match(HEADING_RE))) {
        var level = m[1].length, inner = this.inline(m[2] || ''), plain = stripTags(inner).trim();
        var id = this.uniqueId(plain);
        if (level >= 2 && level <= 4 && plain) this.toc.push({ level: level, text: plain, id: id });
        out.push('<h' + level + ' id="' + id + '">' + inner + '<a class="heading-anchor" href="#' + id + '" aria-label="Link to this section">#</a></h' + level + '>');
        i++;
        continue;
      }

      // Horizontal rule
      if (HR_RE.test(line)) { out.push('<hr>'); i++; continue; }

      // Blockquote / callout
      if (QUOTE_RE.test(line)) {
        var q = [];
        while (i < lines.length && QUOTE_RE.test(lines[i])) { q.push(lines[i].replace(/^\s{0,3}>[ ]?/, '')); i++; }
        var cm = q[0].match(/^\[!(\w+)\][ \t]*(.*)$/);
        if (cm && CALLOUTS[cm[1].toLowerCase()]) {
          var type = cm[1].toLowerCase();
          var title = cm[2] ? this.inline(cm[2]) : CALLOUTS[type];
          out.push('<aside class="callout callout-' + type + '"><p class="callout-title">' + title + '</p>' + this.blocks(q.slice(1)) + '</aside>');
        } else {
          out.push('<blockquote>' + this.blocks(q) + '</blockquote>');
        }
        continue;
      }

      // Table
      if (isTableStart(lines, i)) {
        var head = splitRow(lines[i]);
        var aligns = splitRow(lines[i + 1]).map(function (c) {
          var l = c.charAt(0) === ':', r = c.charAt(c.length - 1) === ':';
          return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
        });
        i += 2;
        var self = this;
        var cell = function (tag, text, idx) {
          var a = aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : '';
          return '<' + tag + a + '>' + self.inline(text || '') + '</' + tag + '>';
        };
        var html = '<div class="table-wrap"><table><thead><tr>' + head.map(function (c, k) { return cell('th', c, k); }).join('') + '</tr></thead><tbody>';
        while (i < lines.length && !blank(lines[i]) && lines[i].indexOf('|') !== -1) {
          var cells = splitRow(lines[i]);
          html += '<tr>';
          for (var k = 0; k < head.length; k++) html += cell('td', cells[k], k);
          html += '</tr>';
          i++;
        }
        out.push(html + '</tbody></table></div>');
        continue;
      }

      // List
      if ((m = line.match(LIST_RE)) && (m[3] !== undefined || (i + 1 < lines.length && indentOf(lines[i + 1]) > indentOf(line)))) {
        var r = this.list(lines, i);
        out.push(r.html);
        i = r.next;
        continue;
      }

      // Paragraph
      var para = [line];
      i++;
      while (i < lines.length && !blank(lines[i]) && !startsBlock(lines, i)) { para.push(lines[i]); i++; }
      out.push(this.paragraph(para));
    }
    return out.join('\n');
  };

  Renderer.prototype.paragraph = function (lines) {
    var text = lines.map(function (l) { return l.replace(/^\s+/, ''); }).join('\n');
    // A paragraph that is only an image with a title becomes a captioned figure.
    var fig = text.trim().match(/^!\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?\s+"([^"]+)"\s*\)$/);
    if (fig) {
      return '<figure>' + this.inline('![' + fig[1] + '](' + fig[2] + ')') + '<figcaption>' + this.inline(fig[3]) + '</figcaption></figure>';
    }
    return '<p>' + this.inline(text) + '</p>';
  };

  Renderer.prototype.list = function (lines, start) {
    var first = lines[start].match(LIST_RE);
    var base = indentOf(lines[start]);
    var ordered = isOrdered(first[2]);
    var startNum = ordered ? parseInt(first[2], 10) : 1;
    var items = [], cur = null, loose = false, sawBlank = false, i = start;

    while (i < lines.length) {
      var line = lines[i];
      if (blank(line)) {
        var j = i + 1;
        while (j < lines.length && blank(lines[j])) j++;
        if (j >= lines.length) break;
        var nm = lines[j].match(LIST_RE), ind = indentOf(lines[j]);
        if ((nm && ind === base && isOrdered(nm[2]) === ordered) || ind > base) {
          if (cur) cur.lines.push('');
          sawBlank = true;
          i++;
          continue;
        }
        break;
      }
      var m = line.match(LIST_RE), indent = indentOf(line);
      if (m && indent === base) {
        if (isOrdered(m[2]) !== ordered) break;
        if (sawBlank && cur) loose = true;
        sawBlank = false;
        cur = { lines: [m[3] || ''], contentIndent: base + m[2].length + 1 };
        items.push(cur);
        i++;
        continue;
      }
      if (m && indent < base) break;
      if (indent > base || (cur && !sawBlank && !startsBlock(lines, i))) {
        if (sawBlank && indent > base && cur && !LIST_RE.test(line.trim() ? line.slice(Math.min(cur.contentIndent, indent)) : '')) {
          // A blank line followed by an indented paragraph means the item has several paragraphs.
          loose = true;
        }
        sawBlank = false;
        cur.lines.push(line.slice(Math.min(cur.contentIndent, indent)));
        i++;
        continue;
      }
      break;
    }

    var self = this, hasTasks = false;
    var body = items.map(function (item) {
      var task = item.lines[0].match(/^\[([ xX])\][ \t]+(.*)$/);
      var prefix = '';
      if (task) {
        hasTasks = true;
        item.lines[0] = task[2];
        prefix = '<input type="checkbox" disabled' + (task[1] !== ' ' ? ' checked' : '') + '> ';
      }
      var html = self.blocks(item.lines);
      if (!loose) html = html.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      return '<li' + (task ? ' class="task' + (task[1] !== ' ' ? ' done' : '') + '"' : '') + '>' + prefix + html + '</li>';
    }).join('');

    var tag = ordered ? 'ol' : 'ul';
    var attrs = (ordered && startNum !== 1 ? ' start="' + startNum + '"' : '') + (hasTasks ? ' class="tasks"' : '');
    return { html: '<' + tag + attrs + '>' + body + '</' + tag + '>', next: i };
  };

  /**
   * render(markdown, { resolveWikiLink(target) -> { href, exists, title } })
   * returns { html, toc: [{ level, text, id }] }
   */
  function render(src, opts) {
    var r = new Renderer(opts);
    var lines = String(src || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    var html = r.blocks(lines);
    return { html: html, toc: r.toc };
  }

  /** Plain text for search indexes and summaries. */
  function toPlainText(src) {
    return String(src || '')
      .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, function (m, a, b) { return b || a; })
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}>\s?\[!\w+\]/gm, '')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
      .replace(/[*_~=`|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Every [[wiki link]] target in a document. */
  function wikiTargets(src) {
    var out = [], re = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g, m;
    while ((m = re.exec(String(src || '')))) out.push(m[1].trim());
    return out;
  }

  return { render: render, toPlainText: toPlainText, slugify: slugify, escape: esc, wikiTargets: wikiTargets };
});
