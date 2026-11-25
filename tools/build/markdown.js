'use strict';

// Markdown -> HTML converter for the offline wiki site (Task 6).
//
// Ruled signature: mdToHtml(mdText, lookup, renderInline) -> {html, toc}
//   - lookup(id) -> item|null      item lookup callback
//   - renderInline(item) -> string card HTML callback injected by the caller;
//     T6 never renders the card itself. When lookup misses, T6 emits
//     `<span class="wikilink-missing">[[id]]</span>` and skips renderInline.
//
// Supported: ATX headings (slug ids + toc), GFM pipe tables with alignment
// (`\|` is a literal pipe inside a cell), ordered/unordered lists (2-space
// nesting), **bold**, *italic*, _italic_, ~~strikethrough~~, `code`,
// [text](#anchor), ![alt](src "title") images (the address as written),
// backslash escapes, and paragraphs (single newline joins, blank line splits).
// The item links the CMS's rich-text editor mis-stores are restored
// (restoreItemLinks). Everything else (e.g. blockquotes) survives as escaped
// text.
//
// ```html passthrough fences: an opening fence line of exactly ```html
// (lowercase tag, trailing spaces allowed) starts a raw-html block. The body
// lines are inserted verbatim — no escaping, no markdown parsing, no toc
// entries — until the first closing fence line of exactly ```. Only a bare
// ``` closes; ```js etc. inside the body stays content. An unterminated opener
// falls back to ordinary paragraph text so the rest of the document survives.
// Security: raw html is NOT trusted here. Anyone who can edit content/ can
// write a ```html block, and this renderer lets its lines through as they
// are. What keeps a page safe is the build, not this file: the audit
// (tools/build/audit.js, Ruling T) reads every page and fails the build on
// an executable <script>, an on*= attribute, a javascript: address and the
// like. What this file guarantees on its own is narrower — everything IT
// renders is escaped: the prose, and the attributes of the links and images
// it makes.

const CODE_SENTINEL = /\u0000(\d+)\u0000/g;
const HTML_FENCE_OPEN = /^```html\s*$/;

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Restore the item links the CMS's rich-text editor mis-stored.
 *
 * When what follows `[[id]]` looks like link syntax, that editor reads the
 * link as Markdown and writes it back in one of two shapes. Both are undone
 * here, so the page renders as it did before the edit:
 *   - `[[id]\]`     → `[[id]]`      the editor escaped the link's second
 *                                    closing bracket. Nobody writes a
 *                                    backslash there by hand: unconditional.
 *   - `[\[id\]](…)` → `[[id]](…)`   the editor took the link for a link
 *                                    whose text is `[id]`. Only when the item
 *                                    table knows the id: a link a contributor
 *                                    really made, with a bracketed word for
 *                                    its text, is written the same way and
 *                                    must stay a link.
 *
 * Call it after the code spans are set aside (a code span is never touched)
 * and before the backslash escapes are (it needs them as written).
 * @param {string} text
 * @param {(id: string) => object|null} lookup
 * @returns {string}
 */
function restoreItemLinks(text, lookup) {
  return text
    .replace(/\[\\\[((?:[^\[\]\\]|\\[^\[\]\\])*?)\\\]\]\(/g,
      (match, id) => (lookup(id.trim()) ? `[[${id}]](` : match))
    .replace(/\[\[([^\[\]\\]+?)\]\\\]/g, '[[$1]]');
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
//   2. restore the item links the rich-text editor mis-stored (restoreItemLinks)
//   3. backslash escapes → sentinels of their own: a literal character takes
//      no part in any syntax below (`\_x\_` is not emphasis, `\*a\*` neither)
//   4. escape HTML
//   5. ![alt](src "title") images — parked behind a sentinel of their own
//   6. [text](href) links
//   7. **strong**, *em*, then _em_ and ~~strikethrough~~
//   8. [[item id]] wikilinks (last, per the plan's state machine)
//   9. restore code spans, escapes and images
function renderInline(text, ctx) {
  const codes = []; // what was set aside, as HTML: put back at the very end
  const codeTexts = []; // the code spans as plain escaped text, for attribute values
  const park = (html) => {
    codes.push(html);
    return `\u0000${codes.length - 1}\u0000`;
  };
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codeTexts.push(escapeHtml(code));
    return park(`<code>${codeTexts[codeTexts.length - 1]}</code>`);
  });

  out = restoreItemLinks(out, ctx.lookup);

  // A backslash before an ASCII punctuation character makes that character
  // literal (CommonMark). The pair is parked like a code span, so the literal
  // character cannot open or close anything below; in an attribute it comes
  // back as plain text, like a code span does. A backslash before anything
  // else (a letter, a digit, the end of the line) is an ordinary backslash.
  out = out.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (_, ch) => {
    codeTexts.push(escapeHtml(ch));
    return park(escapeHtml(ch));
  });

  out = escapeHtml(out);

  // An attribute holds the TEXT of a code span written in it, never its
  // markup: ![a `b` c](x.png) gives alt="a b c". An image is set aside as a
  // whole tag, so a placeholder inside it would never be put back — it used
  // to stay in the page as a NUL character; in the href of a link it was put
  // back, as a <code> element inside the attribute.
  const plainText = (value) => value.replace(CODE_SENTINEL, (_, i) => codeTexts[Number(i)]);

  // ![alt](src "title"): an image (task 6b B4, ruling Z). The address is kept
  // exactly as written — relative or not — because what may be loaded is the
  // audit's decision (audit.js: a https:// image fails the build there, with
  // a report for the contributor). A quote in the alt text or the title is
  // escaped rather than let through: it would otherwise end the attribute and
  // open another one. The whole tag is parked until the end, so the inline
  // rules below never rewrite what is inside its attributes; and it is parsed
  // before links, so that [![a](x.png)](page.html) nests an image in a link.
  // What the syntax does not cover (a single-quoted title, an address with a
  // space in it) stays as written.
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
    const attributeText = (value) => plainText(value).replace(/"/g, '&quot;');
    return park(`<img src="${plainText(src).replace(/"/g, '%22')}" alt="${attributeText(alt)}"`
      + (title === undefined ? '' : ` title="${attributeText(title)}"`) + '>');
  });

  // [text](href): an external http(s) link opens in a new tab (task 6b B1 —
  // external links are allowed in the body, ruling of 2026-11-23), with the
  // same two attributes templates.js gives the footer credit. Site-relative
  // links, fragments and other schemes stay as they are.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const address = plainText(href);
    const external = /^https?:\/\//i.test(address) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${address.replace(/"/g, '%22')}"${external}>${label}</a>`;
  });

  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // `_emphasis_` only where CommonMark allows it: the opening `_` must not
  // follow a letter or digit, the closing one must not precede one (letters
  // and digits are judged in Unicode, so an ideograph counts). An item id
  // such as brood_essence keeps its underscore.
  out = out.replace(/(?<![\p{L}\p{N}])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}])/gu, '<em>$1</em>');
  // `~~strikethrough~~` (GFM). A single tilde is an ordinary tilde: Lv6~10.
  out = out.replace(/~~(.+?)~~/g, '<del>$1</del>');

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

/**
 * The cells of a table row, trimmed. A `\` makes the character after it
 * literal, so `\|` is a pipe inside a cell and not a separator, and `\\|` is
 * a literal backslash followed by a separator. The row's leading pipe is
 * dropped, and so is the empty cell after a pipe that ends the row; a pipe
 * at the very end of the row is cell content when it is escaped.
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
  const t = line.trim();
  const cells = [];
  let cell = '';
  let i = t.startsWith('|') ? 1 : 0;
  for (; i < t.length; i += 1) {
    const ch = t[i];
    if (ch === '\\' && i + 1 < t.length) {
      cell += ch + t[i + 1];
      i += 1;
    } else if (ch === '|') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || !t.endsWith('|') || cells.length === 0) cells.push(cell);
  return cells.map((text) => text.trim());
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

module.exports = { mdToHtml, restoreItemLinks };
