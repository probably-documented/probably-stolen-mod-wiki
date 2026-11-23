'use strict';

// Markdown -> HTML converter for the offline wiki site (Task 6).
//
// Ruled signature: mdToHtml(mdText, lookup, renderInline) -> {html, toc}
//   - lookup(id) -> item|null      item lookup callback
//   - renderInline(item) -> string card HTML callback injected by the caller;
//     T6 never renders the card itself. When lookup misses, T6 emits
//     `<span class="wikilink-missing">[[id]]</span>` and skips renderInline.
//
// Supported: ATX headings (slug ids + toc), GFM pipe tables with alignment,
// ordered/unordered lists (2-space nesting), **bold**, *italic*, `code`,
// [text](#anchor), paragraphs (single newline joins, blank line splits).
// Everything else (e.g. blockquotes) survives as escaped text.
//
// ```html passthrough fences: an opening fence line of exactly ```html
// (lowercase tag, trailing spaces allowed) starts a raw-html block. The body
// lines are inserted verbatim — no escaping, no markdown parsing, no toc
// entries — until the first closing fence line of exactly ```. Only a bare
// ``` closes; ```js etc. inside the body stays content. An unterminated opener
// falls back to ordinary paragraph text so the rest of the document survives.
// Security: passthrough content comes only from first-party hand-written md
// under content/ (no user input) and the site ships as a static offline
// bundle, so raw html there is as trusted as the build itself.

const CODE_SENTINEL = /\u0000(\d+)\u0000/g;
const HTML_FENCE_OPEN = /^```html\s*$/;

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Slug rules: lowercase, whitespace -> '-', punctuation stripped (CJK kept),
// duplicates get a -2 / -3 ... suffix. `usedCounts` tracks collisions.
function makeSlug(title, usedCounts) {
  let slug = title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) slug = 'section';
  const seen = (usedCounts.get(slug) || 0) + 1;
  usedCounts.set(slug, seen);
  return seen === 1 ? slug : `${slug}-${seen}`;
}

// Inline renderer. Order matters:
//   1. extract `code` spans into sentinels (their content gets no further parsing)
//   2. escape HTML
//   3. [text](href) links
//   4. **strong**, then *em*
//   5. [[item id]] wikilinks (last, per the plan's state machine)
//   6. restore code spans
function renderInline(text, ctx) {
  const codes = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = escapeHtml(out);

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const safeHref = href.replace(/"/g, '%22');
    return `<a href="${safeHref}">${label}</a>`;
  });

  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');

  out = out.replace(/\[\[([^\[\]]+?)\]\]/g, (_, rawId) => {
    const item = ctx.lookup(rawId.trim());
    if (!item) return `<span class="wikilink-missing">[[${rawId}]]</span>`;
    return ctx.renderInline(item);
  });

  out = out.replace(CODE_SENTINEL, (_, i) => codes[Number(i)]);
  return out;
}

// Single newlines join into one paragraph. CJK lines concatenate directly
// (no stray spaces between Chinese sentences); a space is only inserted when
// both sides of the join look like latin words/symbols.
function joinParagraphLines(lines, ctx) {
  let text = '';
  for (const line of lines) {
    if (text && /[A-Za-z0-9)\].!?%'"-]$/.test(text) && /^[A-Za-z0-9(\[+"'`]/.test(line)) {
      text += ' ';
    }
    text += line;
  }
  return `<p>${renderInline(text, ctx)}</p>`;
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((cell) => cell.trim());
}

function isDelimiterRow(line) {
  const t = line.trim();
  if (!t.includes('-')) return false;
  const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

function parseAlign(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
}

function renderTable(header, aligns, rows, ctx) {
  const alignAttr = (idx) => {
    const a = aligns[idx];
    return a ? ` style="text-align:${a}"` : '';
  };

  let html = '<table><thead><tr>';
  header.forEach((cell, idx) => {
    html += `<th${alignAttr(idx)}>${renderInline(cell, ctx)}</th>`;
  });
  html += '</tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr>';
    for (let idx = 0; idx < header.length; idx++) {
      html += `<td>${renderInline(idx < row.length ? row[idx] : '', ctx)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// items: [{level, ordered, text}]. Levels grow by one per 2 spaces of indent.
// Same-level runs of one list kind emit a single <ul>/<ol>; a nested list is
// placed inside the parent <li> before it closes.
function renderList(items, ctx) {
  let idx = 0;

  function renderLevel(level) {
    let html = '';
    while (idx < items.length && items[idx].level >= level) {
      if (items[idx].level > level) {
        html += renderLevel(items[idx].level);
        continue;
      }
      const ordered = items[idx].ordered;
      const tag = ordered ? 'ol' : 'ul';
      html += `<${tag}>`;
      while (idx < items.length && items[idx].level === level && items[idx].ordered === ordered) {
        const item = items[idx];
        idx++;
        let li = `<li>${renderInline(item.text, ctx)}`;
        while (idx < items.length && items[idx].level > level) {
          li += renderLevel(items[idx].level);
        }
        li += '</li>';
        html += li;
      }
      html += `</${tag}>`;
    }
    return html;
  }

  return renderLevel(items[0].level);
}

function isListItem(line) {
  return /^([-*+]|\d+[.)])\s+/.test(line.trim());
}

function mdToHtml(mdText, lookup, renderInlineCard) {
  const ctx = { lookup, renderInline: renderInlineCard };
  const usedCounts = new Map();
  const toc = [];
  const blocks = [];
  const lines = (mdText == null ? '' : String(mdText)).replace(/\r\n?/g, '\n').split('\n');

  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(joinParagraphLines(paragraph, ctx));
      paragraph = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      i++;
      continue;
    }

    // ```html passthrough fence: raw html block, verbatim (see header note).
    if (HTML_FENCE_OPEN.test(trimmed)) {
      flushParagraph();
      let close = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '```') {
          close = j;
          break;
        }
      }
      if (close === -1) {
        // Unterminated: treat the opener as ordinary text, keep parsing so
        // the rest of the document is not swallowed.
        paragraph.push(trimmed);
        i++;
        continue;
      }
      blocks.push(lines.slice(i + 1, close).join('\n'));
      i = close + 1;
      continue;
    }

    // ATX heading: # .. ######
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const title = heading[2].trim();
      const id = makeSlug(title, usedCounts);
      toc.push({ id, level, title });
      blocks.push(`<h${level} id="${id}">${renderInline(title, ctx)}</h${level}>`);
      i++;
      continue;
    }

    // Pipe table: a `|` line whose next line is an alignment delimiter row.
    if (trimmed.includes('|') && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      flushParagraph();
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(parseAlign);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(renderTable(header, aligns, rows, ctx));
      continue;
    }

    // Lists: consecutive list lines; deeper items use 2-space indent steps.
    if (isListItem(line)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && lines[i].trim() && isListItem(lines[i])) {
        const item = lines[i].trim().match(/^([-*+]|\d+[.)])\s+(.*)$/);
        const indent = lines[i].match(/^\s*/)[0].length;
        items.push({
          level: Math.floor(indent / 2),
          ordered: /^\d/.test(item[1]),
          text: item[2].trim(),
        });
        i++;
      }
      blocks.push(renderList(items, ctx));
      continue;
    }

    // Everything else feeds the current paragraph (blockquotes etc. survive
    // as escaped text inside <p>).
    paragraph.push(trimmed);
    i++;
  }
  flushParagraph();

  return { html: blocks.join('\n'), toc };
}

module.exports = { mdToHtml };
