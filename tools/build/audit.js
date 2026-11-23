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
//   A2  outside that one attribute (ruling AA: by tag, not by named
//         attribute — src, srcset, poster, data, action, formaction, ping,
//         content, style… are covered at once):
//         protocol-relative-url — an attribute value that starts with //,
//         any attribute, <a href> included
//         external-url — an attribute value that holds an http:// or
//         https:// address, any attribute but the href of an <a>
//         css-external-url — in CSS (a stylesheet, a <style> block, a
//         style="" attribute), an outside address of @import, url() or
//         image-set(): by scheme, or protocol-relative
//         a fetch( call, the word XMLHttpRequest
//   A3  root-relative-url: a URL-bearing attribute (URL_ATTRIBUTES — <a href>
//         included, and each candidate of srcset) holds an address that
//         starts with /; css-root-relative: the same in CSS. Dead under
//         file://, and pointing past the site on a GitHub Pages project site.
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
//   • CSS is read after its comments are blanked and its escapes undone
//     (\68 ttps:// is https://), with a map back to the text as written for
//     the line number. A quoted string is text, not syntax: content:"url(…)"
//     is no url().
//   • An address written in running text, outside every tag, is not a
//     violation: a contributor may write a URL in a sentence (ruling AA).
//   • A tag's attributes are read with the scanner whatever the rule: a >
//     inside a quoted value does not end the tag, so nothing hides behind it.
//   • Not covered: a quote escaped inside a CSS string (it ends that string
//     early); in a .js file only src=, href= and CSS are read, as text.

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

/**
 * Every code the audit can report, in the order of the rules above. Exported
 * so that the build entry can check its report knows how to explain each of
 * them (skeleton-build.js AUDIT_ADVICE), and the audit's own tests can check
 * the list against what the rules really report.
 */
const CODES = Object.freeze([
  'protocol-relative-url', 'external-url', 'root-relative-url',
  'css-external-url', 'css-root-relative',
  'fetch', 'xhr',
  'script-inline', 'script-src', 'inline-event-handler', 'script-url', 'base-tag', 'meta-http-equiv', 'srcdoc',
  'unreadable',
]);

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

/**
 * The attributes whose value is a URL — or a list of URLs — that the browser
 * fetches or navigates to. A3 (root-relative) applies to them (ruling AA).
 * Not in the list: `content`, a URL only in <meta http-equiv="refresh"> —
 * and that tag is refused outright (A4) — and data-* attributes, which the
 * browser does not fetch. An outside address in ANY attribute is A2's
 * business and needs no list.
 */
const URL_ATTRIBUTES = Object.freeze(new Set([
  'href', 'xlink:href', 'src', 'srcset', 'imagesrcset', 'poster', 'data', 'action', 'formaction',
  'ping', 'cite', 'longdesc', 'usemap', 'manifest', 'background', 'archive', 'classid', 'codebase',
  'profile', 'icon', 'dynsrc', 'lowsrc', 'itemid', 'itemtype', 'resource', 'about',
]));

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

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

/**
 * CSS escapes undone (CSS Syntax 3 §4.3.7). `\XXXXXX` — one to six hex
 * digits, and one optional blank after them, which is consumed — is that
 * code point; `\c`, a backslash before anything else, is that character; a
 * backslash before a newline is no escape and both stay. Returns the text
 * and, for each of its characters, where it was in the input: unescaping
 * changes lengths, and the line reported must be the input's.
 */
function decodeCssEscapes(css) {
  let text = '';
  const map = [];
  const isHex = (c) => c !== undefined && /[0-9a-f]/i.test(c);
  const isBlank = (c) => c !== undefined && /[ \t\n\r\f]/.test(c);
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch !== '\\' || i + 1 >= css.length) { // the backslash itself, or one at the very end
      text += ch;
      map.push(i);
      continue;
    }
    const next = css[i + 1];
    if (next === '\n' || next === '\r' || next === '\f') { // no escape: keep both characters
      text += ch;
      map.push(i);
      continue;
    }
    if (isHex(next)) {
      let end = i + 1;
      while (end < css.length && end < i + 7 && isHex(css[end])) end += 1;
      const code = Number.parseInt(css.slice(i + 1, end), 16);
      if (isBlank(css[end])) end += 1; // the blank after the digits is part of the escape
      text += code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
      map.push(i);
      i = end - 1;
      continue;
    }
    text += next; // a character escape: the character itself
    map.push(i);
    i += 1;
  }
  return { text, map };
}

/** The quoted strings of a CSS text as [start, end] with both quotes: what lies between them is not CSS syntax. */
function stringSpans(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    const quote = text[i];
    if (quote !== '"' && quote !== "'") { i += 1; continue; }
    const end = text.indexOf(quote, i + 1);
    const stop = end < 0 ? text.length : end;
    spans.push([i, stop]);
    i = stop + 1;
  }
  return spans;
}

/** What is between the `(` at `open` and the `)` that closes it, nested parentheses and quoted strings accounted for. */
function balancedArgs(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/** How an address written in CSS refers to something: an outside site (by scheme, or protocol-relative), the site root — or nothing that concerns the audit. */
function cssAddressKind(raw) {
  const url = readUrl(raw);
  if (url.startsWith('//') || /^https?:\/\//i.test(url)) return 'external';
  if (url.startsWith('/')) return 'root-relative';
  return null;
}

const CODE_OF_CSS_ADDRESS = Object.freeze({ external: 'css-external-url', 'root-relative': 'css-root-relative' });

/**
 * A2 and A3 for CSS (ruling AA): in a stylesheet, a <style> block or a
 * style="" attribute, @import, url() and image-set() may hold neither an
 * outside nor a root-relative address. Read in three steps, each on the
 * text the one before produced:
 *   1. comments are blanked with their length kept — a backslash inside one
 *      is no escape;
 *   2. escapes are undone (\68 ttps:// is https://), with a map back to the
 *      input for the line number;
 *   3. the addresses are looked for — outside quoted strings, which are
 *      text: content:"url(…)" is no url().
 * `at(inputOffset)` gives the position in the reported text a violation is
 * anchored at; `describe` its detail. `literalsAreCss` is for a .js file,
 * where the CSS sits inside the script's own string literals: there a
 * string is exactly where the address is written.
 * Not read as a browser would (the safe side, or rare): a quote escaped
 * inside a string ends that string early; an escaped `\@import` is
 * reported like an @import although it is a mere name to a browser.
 */
function scanCss(css, report, at, describe, { literalsAreCss = false } = {}) {
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const { text, map } = decodeCssEscapes(blanked);
  const spans = stringSpans(text);
  const inString = literalsAreCss ? () => false : (index) => spans.some(([from, to]) => index > from && index < to);
  const seen = new Set();
  const hit = (index, raw) => {
    const kind = cssAddressKind(raw);
    if (kind === null || seen.has(index)) return;
    seen.add(index);
    report(at(map[index]), CODE_OF_CSS_ADDRESS[kind], describe(at(map[index])));
  };
  const urlSpans = [];
  for (const m of text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    urlSpans.push([m.index, m.index + m[0].length]);
    if (!inString(m.index)) hit(m.index, m[2]);
  }
  for (const m of text.matchAll(/@import\s+(["'])(.*?)\1/gi)) {
    if (!inString(m.index)) hit(m.index, m[2]);
  }
  for (const m of text.matchAll(/(?:-[a-z]+-)?image-set\(/gi)) {
    const open = m.index + m[0].length - 1;
    if (inString(open)) continue;
    const args = balancedArgs(text, open);
    for (const s of args.matchAll(/(["'])(.*?)\1/g)) {
      const atString = open + 1 + s.index;
      // image-set(url("…") 1x): that address is the url()'s, reported there already.
      if (urlSpans.some(([from, to]) => atString > from && atString < to)) continue;
      hit(atString, s[2]);
    }
  }
}

/** The addresses an attribute value holds: one — or each candidate of srcset (comma separated, its first token) or of ping / archive (blank separated). */
function urlCandidates(attribute, url) {
  if (attribute === 'srcset' || attribute === 'imagesrcset') {
    return url.split(',').map((candidate) => candidate.trim().split(/[\t\n\f\r ]+/)[0]).filter((candidate) => candidate !== '');
  }
  if (attribute === 'ping' || attribute === 'archive') {
    return url.split(/[\t\n\f\r ]+/).filter((candidate) => candidate !== '');
  }
  return [url];
}

/**
 * A2 and A3 for one attribute value (ruling AA — by class, not by named
 * attribute). `url` is the value as a browser reads it (readUrl).
 *   protocol-relative-url  it starts with // — any attribute, <a href> included
 *   external-url           it holds an http:// or https:// address — any
 *                          attribute but the href of an <a>, wherever in the
 *                          value the address sits (srcset, content, style…)
 *   root-relative-url      a URL-bearing attribute (URL_ATTRIBUTES) holds an
 *                          address that starts with / — <a href> included
 * One value may break two rules; that is two entries.
 */
function reportUrl(index, url, attribute, tagName, report, detail) {
  const candidates = urlCandidates(attribute, url);
  // protocol-relative: the value itself, or any of the addresses it lists
  if (candidates.some((candidate) => candidate.startsWith('//'))) {
    report(index, 'protocol-relative-url', detail);
  } else if (/https?:\/\//i.test(url) && !(tagName === 'a' && attribute === 'href')) {
    report(index, 'external-url', detail);
  }
  if (URL_ATTRIBUTES.has(attribute) && candidates.some((candidate) => candidate.startsWith('/') && !candidate.startsWith('//'))) {
    report(index, 'root-relative-url', detail);
  }
}

/**
 * A start tag at `start`: its name, its attributes (name, value — null when
 * it has none), and where it ends. Of repeated attributes only the first is
 * kept, as a browser does.
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
    const attributeName = attribute[0].toLowerCase();
    // HTML parsing drops an attribute whose name is already on the tag: the
    // browser keeps the FIRST — and on an HTML element `TYPE` and `type` are
    // one name. Reading the last one let a script the browser runs pass as a
    // data block: <script type="text/javascript" type="application/json">.
    if (attributes.some((known) => known.name === attributeName)) continue;
    attributes.push({ name: attributeName, value });
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
    if (name === 'style') {
      // Judged as CSS, and only as CSS: reportUrl would report the same
      // https:// a second time, in words meant for a tag.
      scanCss(raw, report, () => start, snippet);
    } else if (value !== null) {
      // A2 and A3 by class (ruling AA), for every attribute of every tag.
      reportUrl(start, readUrl(raw), name, tag.name, report, snippet());
    }
    if (tag.name === 'script') {
      if (name === 'src') src = raw;
      if (name === 'type') type = raw;
    }
  }
  if (tag.name === 'script') {
    if (src !== null) {
      // An outside, protocol-relative or root-relative src was reported above;
      // what is left is a site path — allowed only for the first-party list.
      const url = readUrl(src);
      if (!url.startsWith('/') && !/https?:\/\//i.test(url) && !ALLOWED_SCRIPT_SRC.includes(url)) report(start, 'script-src', snippet());
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
      // The content is read as written: the CSS scanner keeps a map back to
      // it, so the line number is the line a contributor finds it on.
      const contentEnd = found === null ? text.length : found.index;
      const contentStart = tag.end;
      scanCss(text.slice(contentStart, contentEnd), report, (offset) => contentStart + offset, (index) => lineText(text, index));
    }
    if (found === null) return;
    const gt = text.indexOf('>', found.index);
    i = gt < 0 ? text.length : gt + 1;
  }
}

/** A .js file, as literal text: the markup a script may assemble at run time. No tag to read, so no <a href> exemption. */
function scanScriptText(text, report) {
  for (const m of text.matchAll(/\bsrc\s*=\s*(["'])(.*?)\1/gi)) reportUrl(m.index, readUrl(m[2]), 'src', '', report, lineText(text, m.index));
  for (const m of text.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) reportUrl(m.index, readUrl(m[2]), 'href', '', report, lineText(text, m.index));
  scanCss(text, report, (offset) => offset, (index) => lineText(text, index), { literalsAreCss: true });
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

module.exports = { auditExternalLinks, ALLOWED_SCRIPT_SRC, CODES };
