'use strict';

// Site audit (task 6b A) — what the built site may reference and may contain.
//
// Two rulings of 2026-11-23 shape the rules:
//
//   外链政策 B   External links in the body are allowed; loading external
//                resources is still forbidden.
//   Ruling T     A ```html block can be written by any contributor once the
//                CMS is online, so obviously dangerous HTML is refused at
//                build time: it would run for every reader, and on a page
//                that is same-origin with the CMS.
//
// What is a violation — one { file, line, code, detail } per occurrence:
//
//   A1  allowed: <a href="http(s)://…">, an external link. No whitelist.
//   A2  src="http(s)://…" on any element
//         href="http(s)://…" on any element but <a> (<link>, an SVG <image> …
//         load something; an <a> only navigates)
//         protocol-relative src="//…" and href="//…"
//         CSS url(http…) and url(//…) — a stylesheet, a <style> block, a
//         style="" attribute
//         a fetch( call, the word XMLHttpRequest
//   A3  root-relative href="/…", src="/…", CSS url(/…): dead under file://,
//       and pointing past the site on a GitHub Pages project site
//   A4  in *.html only:
//         an executable inline <script> (no src, and no type or a JavaScript
//         one); a script block whose type is not executable is a data block
//         and is allowed
//         a <script src> that is not one of ALLOWED_SCRIPT_SRC
//         an on<name>= event attribute
//         a javascript: or vbscript: URL
//         a <base> tag, a <meta http-equiv>, a srcdoc attribute
//   A5  .js and .css are build output, not contributor content: A4 does not
//       apply to them. A2 and A3 do, read as literal text there (a script can
//       assemble markup at run time).
//
// How a page is read — deliberately simple, and never more permissive than a
// browser:
//   • Tags are found with a small scanner, not with per-line regexes: a tag
//     may span lines, its attributes may be double-quoted, single-quoted or
//     bare, and an attribute value is judged after its character references
//     are decoded (href="&#106;avascript:…" is a javascript: URL to a
//     browser). Tabs and newlines are dropped from a URL first, as a URL
//     parser does.
//   • Event attributes and script URLs are looked for inside tags only. The
//     words onclick= or javascript: in running text are text.
//   • HTML comments are not recognised: a tag inside one is checked like any
//     other. A browser does not run it — but where a comment ends has enough
//     special cases (`<!-->` closes at once) that an audit which trusted them
//     could be talked out of seeing a script. Reporting a commented-out tag
//     costs its author a deletion; missing one costs every reader.
//   • The content of <script> and <style> is not read as tags (it is not
//     markup to a browser either) and ends at the first matching end tag. A
//     <style>'s content is read as CSS. A browser keeps a script element open
//     past a nested <script> that follows <!--; the audit stops at the first
//     </script> — so that one case is over-reported, never under-reported.
//   • Not covered, on purpose (the brief lists the rules): srcset, poster,
//     action and other URL attributes, @import "…", CSS escapes.

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * The only `src` a <script> may carry (A4): the scripts the first-party
 * templates load, from what templates.js / render.js actually write.
 *   data.js, assets/js/search.js    render.js renderSearch → search.html
 *   assets/js/item-filter.js        render.js renderItems → items.html
 *                                    (a file since task 6b A8)
 * templates.js emits no <script> at all. Exact values, as written.
 */
const ALLOWED_SCRIPT_SRC = Object.freeze(['assets/js/item-filter.js', 'assets/js/search.js', 'data.js']);

/** Named character references a URL could be assembled from; anything else stays as written. */
const NAMED_REFERENCES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', semi: ';', sol: '/', bsol: '\\',
  num: '#', percnt: '%', quest: '?', excl: '!', comma: ',', period: '.', plus: '+', equals: '=',
  lpar: '(', rpar: ')', Tab: '\t', NewLine: '\n',
});

// How a tag is read. HTML has exactly five whitespace characters — tab, line
// feed, form feed, carriage return and space — and every character class
// below names all five.
const HTML_SPACE_RE = /[\t\n\f\r ]/;
const TAG_NAME_RE = /^[^\t\n\f\r />]+/;
const ATTRIBUTE_NAME_RE = /^[^\t\n\f\r =/>]+/;
/** An unquoted attribute value ends at whitespace or `>`; a `/` belongs to it. */
const UNQUOTED_VALUE_RE = /^[^\t\n\f\r >]*/;
/** What may follow `</script` / `</style` for it to close the element. */
const AFTER_END_TAG_NAME = '[\\t\\n\\f\\r />]';
/** <script> / <style>: elements whose content is text, never markup. */
const RAW_TEXT = new Set(['script', 'style']);
const EVENT_ATTRIBUTE = /^on[a-z]+$/;

async function walkFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(full)));
    else out.push(full);
  }
  return out.sort();
}

const toPosix = (p) => p.split(path.sep).join('/');

// ---------------------------------------------------------------------------
// Values as a browser reads them
// ---------------------------------------------------------------------------

/** Character references decoded: numeric ones (with or without `;`) and the named ones of NAMED_REFERENCES. */
function decodeCharacterReferences(value) {
  return value
    .replace(/&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/g, (whole, hex, dec) => {
      const code = Number.parseInt(hex ?? dec, hex === undefined ? 10 : 16);
      if (!Number.isFinite(code) || code > 0x10ffff) return whole;
      return String.fromCodePoint(code === 0 ? 0xfffd : code);
    })
    .replace(/&([A-Za-z][A-Za-z0-9]*);/g, (whole, name) => NAMED_REFERENCES[name] ?? NAMED_REFERENCES[name.toLowerCase()] ?? whole);
}

/**
 * A URL as a browser reads it: character references decoded, tabs and
 * newlines dropped (a URL parser ignores them), blanks and control
 * characters trimmed at both ends.
 */
function readUrl(raw) {
  return decodeCharacterReferences(raw)
    .replace(/[\t\n\r]/g, '')
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
}

/** How a URL as written refers to something. */
function urlKind(raw) {
  const url = readUrl(raw);
  if (/^https?:\/\//i.test(url)) return 'http';
  if (url.startsWith('//')) return 'protocol-relative';
  if (url.startsWith('/')) return 'root-relative';
  return 'other';
}

const isScriptUrl = (raw) => /^(?:javascript|vbscript):/i.test(readUrl(raw));

/**
 * Does a browser run a <script> with this `type`? It runs one with no type,
 * with `module`, and with any JavaScript (or the old VBScript) MIME type —
 * parameters included. Everything else is a data block it never executes.
 */
function isExecutableScriptType(raw) {
  const essence = readUrl(raw.split(';')[0]).toLowerCase();
  return essence === '' || essence === 'module' || /(?:java|ecma|live|j|vb)script/.test(essence);
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

// Every scanner reports through `report(index, code, detail)`: one violation,
// anchored at `index` in the text it was found in.

/** The line of `text` that holds `index`, trimmed and cut to 160 characters. */
function lineText(text, index) {
  const from = text.lastIndexOf('\n', index - 1) + 1;
  const to = text.indexOf('\n', index);
  return text.slice(from, to < 0 ? text.length : to).trim().slice(0, 160);
}

/**
 * `url(…)` values of a stylesheet: external, protocol-relative and
 * root-relative ones are violations. `at(cssOffset)` gives the position in
 * the reported text the violation is anchored at; `describe` its detail.
 */
function scanCss(css, report, at, describe) {
  // Comments are blanked out with their length kept, so offsets stay true.
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  for (const m of blanked.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    const kind = urlKind(m[2]);
    if (kind !== 'other') report(at(m.index), `css-url-${kind}`, describe(at(m.index)));
  }
}

/** One src / href value: external, protocol-relative or root-relative — each with the code of its element kind. */
function reportUrl(index, raw, element, httpAllowed, report, detail) {
  const kind = urlKind(raw);
  if (kind === 'http') {
    if (!httpAllowed) report(index, `${element}-http`, detail);
  } else if (kind !== 'other') {
    report(index, `${element}-${kind}`, detail);
  }
}

/**
 * A start tag at `start`: its name, its attributes (name, value — null when
 * it has none — and the position of the name), and where it ends.
 */
function parseStartTag(text, start) {
  let i = start + 1;
  const name = TAG_NAME_RE.exec(text.slice(i, i + 64));
  const tagName = name === null ? '' : name[0].toLowerCase();
  i += name === null ? 0 : name[0].length;
  const attributes = [];
  while (i < text.length) {
    const c = text[i];
    if (c === '>') { i += 1; break; }
    if (HTML_SPACE_RE.test(c) || c === '/') { i += 1; continue; }
    const attribute = ATTRIBUTE_NAME_RE.exec(text.slice(i, i + 256));
    if (attribute === null) { i += 1; continue; }
    const at = i;
    i += attribute[0].length;
    let value = null;
    let j = i;
    while (j < text.length && HTML_SPACE_RE.test(text[j])) j += 1;
    if (text[j] === '=') {
      j += 1;
      while (j < text.length && HTML_SPACE_RE.test(text[j])) j += 1;
      const quote = text[j];
      if (quote === '"' || quote === "'") {
        j += 1;
        const end = text.indexOf(quote, j);
        value = text.slice(j, end < 0 ? text.length : end);
        j = end < 0 ? text.length : end + 1;
      } else {
        const bare = UNQUOTED_VALUE_RE.exec(text.slice(j, j + 4096));
        value = bare === null ? '' : bare[0];
        j += value.length;
      }
      i = j;
    }
    attributes.push({ name: attribute[0].toLowerCase(), value });
  }
  return { name: tagName, attributes, end: i };
}

/**
 * Everything a start tag may do wrong. Every violation of one tag is anchored
 * at the tag's own start — the line a contributor finds it on, even when the
 * tag spans lines — and reported in document order.
 */
function checkTag(text, start, tag, report) {
  const snippet = () => text.slice(start, tag.end).replace(/\s+/g, ' ').trim().slice(0, 160);
  const isBase = tag.name === 'base';
  if (isBase) report(start, 'base-tag', snippet());
  if (tag.name === 'meta' && tag.attributes.some((a) => a.name === 'http-equiv')) report(start, 'meta-http-equiv', snippet());

  let type = null;
  let src = null;
  for (const { name, value } of tag.attributes) {
    const raw = value ?? '';
    if (EVENT_ATTRIBUTE.test(name)) report(start, 'inline-event-handler', snippet());
    if (name === 'srcdoc') report(start, 'srcdoc', snippet());
    if (isScriptUrl(raw)) report(start, 'script-url', snippet());
    if (name === 'src') {
      reportUrl(start, raw, 'src', false, report, snippet());
    } else if ((name === 'href' || name === 'xlink:href') && !isBase) {
      // A <base> is refused as what it is; its href is not counted again.
      reportUrl(start, raw, 'href', tag.name === 'a', report, snippet());
    }
    if (name === 'style') scanCss(decodeCharacterReferences(raw), report, () => start, snippet);
    if (tag.name === 'script') {
      if (name === 'src') src = raw;
      if (name === 'type') type = raw;
    }
  }
  if (tag.name === 'script') {
    if (src !== null) {
      // An outside src is the external resource it is (reported above);
      // what is left is a site path — allowed only for the first-party list.
      if (urlKind(src) === 'other' && !ALLOWED_SCRIPT_SRC.includes(readUrl(src))) report(start, 'script-src', snippet());
    } else if (type === null || isExecutableScriptType(type)) {
      report(start, 'script-inline', snippet());
    }
  }
}

function scanHtml(text, report) {
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) return;
    const next = text[lt + 1];
    if (next === '/') { // an end tag has nothing to check
      const gt = text.indexOf('>', lt + 2);
      i = gt < 0 ? text.length : gt + 1;
      continue;
    }
    if (next === undefined || !/[A-Za-z]/.test(next)) { // `<!`, `<?`, or a bare `<`: not a tag
      i = lt + 1;
      continue;
    }
    const tag = parseStartTag(text, lt);
    checkTag(text, lt, tag, report);
    i = tag.end;
    if (!RAW_TEXT.has(tag.name)) continue;
    const close = new RegExp(`</${tag.name}(?=${AFTER_END_TAG_NAME}|$)`, 'ig');
    close.lastIndex = tag.end;
    const found = close.exec(text);
    if (tag.name === 'style') {
      // Read as written (no character references decoded): decoding would
      // move the offsets, and the line number is what a contributor needs.
      const contentEnd = found === null ? text.length : found.index;
      const contentStart = tag.end;
      scanCss(text.slice(contentStart, contentEnd), report, (offset) => contentStart + offset, (index) => lineText(text, index));
    }
    if (found === null) return;
    const gt = text.indexOf('>', found.index);
    i = gt < 0 ? text.length : gt + 1;
  }
}

/** A .js file, as literal text: the markup a script may assemble at run time. */
function scanScriptText(text, report) {
  for (const m of text.matchAll(/\bsrc\s*=\s*(["'])(.*?)\1/gi)) reportUrl(m.index, m[2], 'src', false, report, lineText(text, m.index));
  for (const m of text.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) reportUrl(m.index, m[2], 'href', false, report, lineText(text, m.index));
  scanCss(text, report, (offset) => offset, (index) => lineText(text, index));
}

/** fetch( calls and XMLHttpRequest, wherever they are written. */
function scanCalls(text, report) {
  for (const m of text.matchAll(/\bfetch\s*\(/g)) report(m.index, 'fetch', lineText(text, m.index));
  for (const m of text.matchAll(/XMLHttpRequest/g)) report(m.index, 'xhr', lineText(text, m.index));
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * Audit every .html/.js/.css file under dir (see the header for the rules).
 * @returns {Promise<Array<{ file: string, line: number, code: string, detail: string }>>}
 *   file = posix path relative to dir; line = 1-based, where the violation
 *   starts (a tag that spans lines: the line it starts on; line 0 for a file
 *   that could not be read — code `unreadable`); detail = the offending tag
 *   or line, at most 160 characters. Sorted by file, then by position. An
 *   empty array means the site is clean.
 */
async function auditExternalLinks(dir) {
  const violations = [];
  const files = (await walkFiles(dir)).filter((f) => /\.(html|js|css)$/i.test(f));
  for (const file of files) {
    const relative = toPosix(path.relative(dir, file));
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      violations.push({ file: relative, line: 0, code: 'unreadable', detail: err.message });
      continue;
    }
    const found = [];
    const report = (index, code, detail) => { found.push({ index, code, detail }); };
    if (/\.html$/i.test(file)) scanHtml(text, report);
    else if (/\.css$/i.test(file)) scanCss(text, report, (offset) => offset, (index) => lineText(text, index));
    else scanScriptText(text, report);
    scanCalls(text, report);
    for (const { index, code, detail } of found.sort((a, b) => a.index - b.index)) {
      let line = 1;
      for (let k = index - 1; k >= 0; k -= 1) if (text.charCodeAt(k) === 10) line += 1;
      violations.push({ file: relative, line, code, detail });
    }
  }
  return violations;
}

module.exports = { auditExternalLinks, ALLOWED_SCRIPT_SRC };
