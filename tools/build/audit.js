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
//         a fetch( call, the word XMLHttpRequest — not in a page (ruling AB
//         c): there they can be nothing but text. In the .js files and the
//         stylesheets they are still read as before
//   A3  root-relative-url: a URL-bearing attribute (URL_ATTRIBUTES — <a href>
//         included, and each candidate of srcset) holds an address that
//         starts with /; css-root-relative: the same in CSS. Dead under
//         file://, and pointing past the site on a GitHub Pages project site.
//   A9  data-url / css-data-url (ruling AB b): a data: address is allowed
//         only as an image that is not SVG (image/*, but not
//         image/svg+xml), in the src / srcset of an <img> or a <source>, or
//         the poster of a <video>. Anywhere else — any other tag or
//         attribute, any other type — and anywhere in CSS, it is a
//         violation: in an iframe, an object or an embed, data:text/html runs
//         its script, and so does data:image/svg+xml wherever a browser
//         treats the drawing as a document. Not applied to .js files.
//   A4  in *.html only:
//         an executable inline <script>: any script block but one whose
//         type is exactly application/json, text/plain or application/ld+json
//         (the data-block allow-list, ruling AB a)
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
//   • Inside <svg> / <math> that content IS markup: there <script/> and
//     <style/> are self-closing, and what follows them is read like the rest
//     of the page (the audit counts the <svg> / <math> it has seen opened and
//     not closed — the safe side of the browser's own rule: see scanHtml).
//   • CSS is read in one pass: a string with its escaped quotes and
//     continued lines, a comment and an escape (\68 ttps:// is https://) are
//     told apart where each of them is, and the addresses are looked for on
//     what that produced. A quoted string is text, not syntax:
//     content:"url(…)" is no url(). A string that a line break ends before
//     its quote is dropped, as a browser drops it; one that the end of the
//     text closes stands with what was read of it — a browser requests the
//     address in it, so it is read too.
//   • An address written in running text, outside every tag, is not a
//     violation: a contributor may write a URL in a sentence (ruling AA).
//   • A tag's attributes are read with the scanner whatever the rule: a >
//     inside a quoted value does not end the tag, so nothing hides behind it.
//   • In a .js file only src=, href= and CSS are read, as text.

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
  'data-url', 'css-data-url',
  'fetch', 'xhr',
  'script-inline', 'script-src', 'inline-event-handler', 'script-url', 'base-tag', 'meta-http-equiv', 'srcdoc',
  'unreadable',
]);

/**
 * The named character references whose value is an ASCII character — every
 * one a browser knows. They are the ones that can change what the audit
 * reads: a quote, a parenthesis, a slash, the asterisk of a comment's end, a
 * backslash, a blank, `&` itself, the characters a URL or a MIME type is
 * made of. The other two thousand–odd named references have values outside
 * ASCII; left as written they move no boundary the audit looks for and no
 * scheme (a no-break space is no CSS blank, and a URL parser trims C0
 * controls and spaces only), so they are not decoded.
 *
 * Names are exact — HTML has `&quot;` and `&QUOT;`, and no `&Quot;`. A name
 * is tried longest first, so `&quot;` wins over `&quot`.
 */
const NAMED_REFERENCES = Object.freeze({
  Tab: '\t', NewLine: '\n', excl: '!', quot: '"', QUOT: '"', num: '#', dollar: '$', percnt: '%', amp: '&', AMP: '&', apos: "'",
  lpar: '(', rpar: ')', ast: '*', midast: '*', plus: '+', comma: ',', period: '.', sol: '/', colon: ':', semi: ';', lt: '<', LT: '<',
  equals: '=', gt: '>', GT: '>', quest: '?', commat: '@', lsqb: '[', bsol: '\\', rsqb: ']', Hat: '^', lowbar: '_', grave: '`',
  lcub: '{', verbar: '|', rcub: '}',
});
const NAMED_LONGEST = Math.max(...Object.keys(NAMED_REFERENCES).map((name) => name.length)) + 1; // with the `;`
/**
 * The historical names HTML reads without their `;` — those whose value is
 * ASCII; the rest would change nothing. In an attribute value such a name is
 * NOT a reference when `=` or an ASCII letter or digit follows it (for
 * historical reasons): `&quothttps://…` stays written.
 */
const NAMED_WITHOUT_SEMICOLON = Object.freeze(new Set(['amp', 'AMP', 'lt', 'LT', 'gt', 'GT', 'quot', 'QUOT']));
/** What a numeric reference from 0x80 to 0x9F is in HTML: the Windows-1252 character, not the control. */
const C1_REPLACEMENTS = Object.freeze({
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030,
  0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
});

// How a tag is read. HTML has exactly five whitespace characters — tab, line
// feed, form feed, carriage return and space — and every character class
// below names all five.
//
// The three are sticky (flag `y`): they match at matchAt()'s index and
// nowhere else, on the text itself. Nothing here is cut at some number of
// characters (ruling AC 1): a name or a value is read to where it really
// ends, as a browser reads it. The audit once read the first 256 characters
// of a name and the first 4096 of an unquoted value; what followed the cut
// was read as something new — an attribute the browser never had, a `type`
// or `href` that made the audit drop the real one. A length limit belongs
// to the snippet a report shows, and nowhere else.
const HTML_SPACE_RE = /[\t\n\f\r ]/;
const TAG_NAME_RE = /[^\t\n\f\r />]+/y;
const ATTRIBUTE_NAME_RE = /[^\t\n\f\r =/>]+/y;
/** An unquoted attribute value ends at whitespace or `>`; a `/` belongs to it. */
const UNQUOTED_VALUE_RE = /[^\t\n\f\r >]*/y;
/** `re.exec(text)` with `re.lastIndex` set to `index`: the sticky match at that point, or null. */
const matchAt = (re, text, index) => { re.lastIndex = index; return re.exec(text); };
/** What may follow `</script` / `</style` for it to close the element. */
const AFTER_END_TAG_NAME = '[\\t\\n\\f\\r />]';
/** <script> / <style>: elements whose content is text, never markup. */
const RAW_TEXT = new Set(['script', 'style']);
/**
 * The elements that open foreign content (SVG, MathML). Inside it a
 * `<script/>` or `<style/>` is self-closing, and what follows is markup
 * again — an HTML `<script/>` is not (see scanHtml).
 */
const FOREIGN_ROOTS = new Set(['svg', 'math']);
const END_TAG_NAME_RE = /[a-z][a-z0-9-]*/iy;
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

/**
 * The character reference at `at` (text[at] is `&`) in an attribute value, as
 * HTML consumes it: { text, end }, or null when it is none — `&#` with no
 * digit after, `&` before anything that is no name, a historical name that
 * an `=`, a letter or a digit follows.
 *   numeric   `&#104;` `&#x68;`, the `;` optional, any number of digits
 *   named     from NAMED_REFERENCES, the longest first, the `;` optional
 *             for the historical names only
 */
function readCharacterReference(text, at) {
  if (text[at + 1] === '#') {
    const hex = text[at + 2] === 'x' || text[at + 2] === 'X';
    const from = at + 2 + (hex ? 1 : 0);
    let end = from;
    while (end < text.length && (hex ? /[0-9a-f]/i : /[0-9]/).test(text[end])) end += 1;
    if (end === from) return null;
    const digits = text.slice(from, end);
    if (text[end] === ';') end += 1;
    let code = Number.parseInt(digits, hex ? 16 : 10);
    if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) code = 0xfffd;
    else if (C1_REPLACEMENTS[code] !== undefined) code = C1_REPLACEMENTS[code];
    return { text: String.fromCodePoint(code), end };
  }
  for (let length = Math.min(NAMED_LONGEST, text.length - at - 1); length >= 1; length -= 1) {
    const name = text.slice(at + 1, at + 1 + length);
    const withSemicolon = name.endsWith(';');
    const value = NAMED_REFERENCES[withSemicolon ? name.slice(0, -1) : name];
    if (value === undefined) continue;
    if (!withSemicolon && !NAMED_WITHOUT_SEMICOLON.has(name)) continue; // `&apos ` is no reference
    if (!withSemicolon && /[=0-9A-Za-z]/.test(text[at + 1 + length] ?? '')) return null;
    return { text: value, end: at + 1 + length };
  }
  return null;
}

/**
 * The character references of an attribute value, decoded — in ONE pass:
 * what a reference decodes to is not read again, exactly as in a browser
 * (`&#38;quot;` is `&quot;` written out, not a quote; the audit used to
 * decode the digits, then the name, and make it one). Numeric ones with or
 * without `;`, and the named ones of NAMED_REFERENCES. Anything else stays
 * as written.
 */
function decodeCharacterReferences(value) {
  let out = '';
  let i = 0;
  for (let amp = value.indexOf('&'); amp >= 0; amp = value.indexOf('&', i)) {
    out += value.slice(i, amp);
    const reference = readCharacterReference(value, amp);
    if (reference === null) { out += '&'; i = amp + 1; continue; }
    out += reference.text;
    i = reference.end;
  }
  return out + value.slice(i);
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
 * The types a <script> block is a mere data block for (ruling AB a) — the
 * allow-list. Compared exactly, without case: "application/json;
 * charset=utf-8" or " application/json " are not on it. To a browser
 * (HTML Standard, "prepare the script element") those are data blocks too,
 * so refusing them only over-reports; what matters is the other way round:
 * `module`, `importmap` and `speculationrules` are types the browser ACTS
 * on, and so is anything that is a JavaScript MIME type — so nothing but
 * these three is let through.
 */
const DATA_BLOCK_TYPES = Object.freeze(new Set(['application/json', 'text/plain', 'application/ld+json']));

const isDataBlockType = (raw) => DATA_BLOCK_TYPES.has(decodeCharacterReferences(raw).toLowerCase());

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

// Every scanner reports through `report(index, code, detail)`: one violation,
// anchored at `index` in the text it was found in.

/**
 * The lines of a text, for the report. `lineBreaksOf` collects where every
 * line ends once; `lineText` then finds the line that holds `index` by
 * halving, and `lineNumber` is 1 plus the number of line breaks before it.
 * (Both used to search from the top of the text for every violation — once
 * per attribute of a tag with many, once per address of a long stylesheet:
 * time grew with the square. Ruling AC 3.)
 */
function lineBreaksOf(text) {
  const breaks = [];
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) breaks.push(at);
  return breaks;
}

/** The number of line breaks before `index`: the text is cut in halves until it is known. */
function breaksBefore(breaks, index) {
  let low = 0;
  let high = breaks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (breaks[middle] < index) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The line of `text` that holds `index`, trimmed and cut to 160 characters. */
function lineText(text, breaks, index) {
  const line = breaksBefore(breaks, index);
  const from = line === 0 ? 0 : breaks[line - 1] + 1;
  const to = line < breaks.length ? breaks[line] : text.length;
  return text.slice(from, to).trim().slice(0, 160);
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

/**
 * One CSS escape at `i` (css[i] is a backslash), as CSS Syntax 3 §4.3.7
 * reads it. `\XXXXXX` — one to six hex digits and one optional blank after
 * them — is that code point (0, a surrogate or anything past U+10FFFF is
 * U+FFFD); `\c`, a backslash before any other character, is that character.
 * A backslash before a line break continues a string and stands for nothing;
 * one at the very end stands for nothing too — there is no character for it
 * to escape. Returns the text and where it ends.
 */
function cssEscape(css, i) {
  const next = css[i + 1];
  if (next === undefined) return { text: '', end: i + 1 };
  if (next === '\n' || next === '\f' || (next === '\r' && css[i + 2] !== '\n')) return { text: '', end: i + 2 };
  if (next === '\r') return { text: '', end: i + 3 };
  let digits = '';
  let end = i + 1;
  while (end < css.length && end < i + 7 && /[0-9a-f]/i.test(css[end])) { digits += css[end]; end += 1; }
  if (digits === '') return { text: next, end: i + 2 };
  if (css[end] !== undefined && /[ \t\n\r\f]/.test(css[end])) end += 1;
  const code = Number.parseInt(digits, 16);
  return {
    text: code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code),
    end,
  };
}

const isCssLineBreak = (c) => c === '\n' || c === '\r' || c === '\f';
const isCssBlank = (c) => c === ' ' || c === '\t' || isCssLineBreak(c);
const CSS_NAME_START = /[a-zA-Z_\\\-\u0080-\uffff]/; // a backslash starts a name too: \75 rl( is url(
const CSS_NAME_CHAR = /[a-zA-Z0-9_\-\u0080-\uffff]/;

/** A name (identifier) from `i`: name characters and escapes, up to the first character that is neither. */
function readCssName(css, i) {
  let value = '';
  while (i < css.length) {
    const c = css[i];
    if (CSS_NAME_CHAR.test(c)) { value += c; i += 1; continue; }
    if (c === '\\' && !isCssLineBreak(css[i + 1])) { const e = cssEscape(css, i); value += e.text; i = e.end; continue; }
    break;
  }
  return { value, end: i };
}

/**
 * CSS read in ONE pass, as far as the audit needs it (CSS Syntax 3 §4): a
 * string with its escaped quotes and continued lines, a comment and an
 * escape are told apart where each of them is. The audit used to blank the
 * comments first, then run three regular expressions that did not cross a
 * line — so a `/*` inside a string swallowed the rule after it, and an
 * address with a line break in it matched nothing.
 *   { type: 'string',     value, at }  a quoted string, escapes undone
 *   { type: 'url',        value, at }  url( followed by an unquoted address, read to the )
 *   { type: 'function',   value, at }  a name directly followed by ( — the ( is part of it
 *   { type: 'at-keyword', value, at }  @name
 *   { type: 'ident',      value, at }
 *   { type: 'char',       value, at }  any other single character
 * Comments are dropped, and so is a string that a line break ends before its
 * quote (a bad string, which a browser drops too). A string that the end of
 * the text closes is kept, with what was read of it: a browser requests the
 * address in it. `at` is where the token starts in the text read.
 */
function tokenizeCss(css) {
  const tokens = [];
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (isCssBlank(c)) { i += 1; continue; }
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const at = i;
      i += 1;
      let value = '';
      let bad = false;
      while (i < css.length) {
        const d = css[i];
        if (d === c) { i += 1; break; }
        if (isCssLineBreak(d)) { bad = true; break; } // a line break before its quote: a bad string
        if (d === '\\') { const e = cssEscape(css, i); value += e.text; i = e.end; continue; }
        value += d;
        i += 1;
      }
      // A bad string is dropped, as a browser drops it. One that the END OF
      // THE TEXT closes is not: it stands with what was read of it (CSS
      // Syntax 3), and a browser requests the address in it —
      // `<style>@import "https://…` to </style>, `url("https://…` at the
      // end of a stylesheet file (review round 2).
      if (!bad) tokens.push({ type: 'string', value, at });
      continue;
    }
    if (c === '@') {
      const name = readCssName(css, i + 1);
      if (name.value !== '') { tokens.push({ type: 'at-keyword', value: name.value, at: i }); i = name.end; continue; }
      tokens.push({ type: 'char', value: c, at: i });
      i += 1;
      continue;
    }
    if (CSS_NAME_START.test(c)) {
      const at = i;
      const name = readCssName(css, i);
      i = name.end;
      if (css[i] !== '(') { tokens.push({ type: 'ident', value: name.value, at }); continue; }
      i += 1;
      const after = css[i];
      if (name.value.toLowerCase() !== 'url' || after === undefined || after === '"' || after === "'" || isCssBlank(after)) {
        // url( with a quote or a blank right after it is a function whose
        // argument is a string — or a blank, then one.
        tokens.push({ type: 'function', value: name.value, at });
        continue;
      }
      // url( followed by anything else: the address itself, up to the )
      let value = '';
      while (i < css.length && css[i] !== ')') {
        if (css[i] === '\\' && !isCssLineBreak(css[i + 1])) { const e = cssEscape(css, i); value += e.text; i = e.end; continue; }
        value += css[i];
        i += 1;
      }
      if (i < css.length) i += 1;
      tokens.push({ type: 'url', value: value.trim(), at });
      continue;
    }
    tokens.push({ type: 'char', value: c, at: i });
    i += 1;
  }
  return tokens;
}

/**
 * An address as a CSS token gives it, read as a URL parser reads it: tabs
 * and newlines dropped, blanks and control characters trimmed at both ends.
 * No character references here: a stylesheet, and the content of a <style>
 * element, decode none in a browser; the references of a style="" attribute
 * were decoded once, before its value was read as CSS.
 */
const cssUrl = (raw) => raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');

/**
 * How an address written in CSS refers to something: an outside site (by
 * scheme, or protocol-relative), the site root, a data: address — or nothing
 * that concerns the audit.
 */
function cssAddressKind(raw) {
  const url = cssUrl(raw);
  if (url.startsWith('//') || /^https?:\/\//i.test(url)) return 'external';
  if (url.startsWith('/')) return 'root-relative';
  if (/^data:/i.test(url)) return 'data';
  return null;
}

const CODE_OF_CSS_ADDRESS = Object.freeze({
  external: 'css-external-url',
  'root-relative': 'css-root-relative',
  data: 'css-data-url',
});

/** The index of the token that closes what the function token or `(` at `open` opens; -1 when nothing does. */
function matchingParen(tokens, open) {
  let depth = 1;
  for (let j = open + 1; j < tokens.length; j += 1) {
    const t = tokens[j];
    if (t.type === 'function' || (t.type === 'char' && t.value === '(')) depth += 1;
    else if (t.type === 'char' && t.value === ')') {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

const isCssFunction = (token, name) => token.type === 'function' && token.value.toLowerCase() === name;
const isCssChar = (token, value) => token.type === 'char' && token.value === value;

/**
 * A2, A3 and A9 for CSS: in a stylesheet, a <style> block or a style=""
 * attribute, @import, url() and image-set() may hold neither an outside nor
 * a root-relative address, nor a data: address (ruling AB b: in CSS there is
 * no image slot). The text is read once by tokenizeCss, and the addresses are
 * looked for on its tokens:
 *   url(…)     an unquoted address, or the one string inside the parentheses
 *              (url( "…" ) included); otherwise the pieces are joined
 *   @import    the first string after it, before the end of the at-rule;
 *              @import url(…) is read by the line above
 *   image-set(…)  every string of its list, an address that is a url(…)
 * anchor, an address that is a url(…) having been read already
 * `at(offset)` gives the position in the reported text a violation is
 * anchored at; `describe` its detail. `literalsAreCss` is for a .js file,
 * where the CSS sits inside the script's own string literals: there every
 * string is read as CSS in its turn (once — what is a string inside that is
 * an address, not CSS again). `dataUrls` off: A9 does not apply to a .js file.
 */
function scanTokens(tokens, report, at, describe, { literalsAreCss = false, dataUrls = true } = {}) {
  const seen = new Set();
  const hit = (offset, raw) => {
    const kind = cssAddressKind(raw);
    if (kind === null || seen.has(offset)) return;
    seen.add(offset);
    if (kind === 'data' && !dataUrls) return; // a .js file is read as text: A9 does not apply to it
    report(at(offset), CODE_OF_CSS_ADDRESS[kind], describe(at(offset)));
  };
  const inner = (k) => {
    const close = matchingParen(tokens, k);
    return { close, tokens: tokens.slice(k + 1, close < 0 ? tokens.length : close) };
  };
  // In two passes. Every url(…) first, remembering the string that is its
  // address — so that image-set(url("…") 1x) does not report it a second time.
  const addressOfUrl = new Set();
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.type === 'string' && literalsAreCss) {
      scanTokens(tokenizeCss(token.value), report, (offset) => at(token.at + offset), (index) => describe(at(token.at + index)), { dataUrls });
    } else if (token.type === 'url') {
      hit(token.at, token.value);
    } else if (isCssFunction(token, 'url')) {
      const args = inner(k).tokens;
      const strings = args.filter((t) => t.type === 'string');
      if (strings.length === 1 && args.length === 1) {
        addressOfUrl.add(k + 1);
        hit(token.at, strings[0].value);
      } else {
        hit(token.at, args.map((t) => t.value).join(''));
      }
    }
  }
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.type === 'at-keyword' && token.value.toLowerCase() === 'import') {
      for (let j = k + 1; j < tokens.length && !isCssChar(tokens[j], ';') && !isCssChar(tokens[j], ')') && !isCssChar(tokens[j], '{'); j += 1) {
        if (tokens[j].type === 'string') { hit(tokens[j].at, tokens[j].value); break; }
        if (tokens[j].type === 'url' || isCssFunction(tokens[j], 'url')) break;
      }
    } else if (token.type === 'function' && /(?:^|-)image-set$/.test(token.value.toLowerCase())) {
      const { tokens: args } = inner(k);
      args.forEach((t, n) => {
        // anchored at the image-set( itself: the line a contributor finds it on
        if (t.type === 'string' && !addressOfUrl.has(k + 1 + n)) hit(token.at, t.value);
      });
    }
  }
}

/** A stylesheet, a <style> block or a style="" attribute: read once, then read for its addresses. */
function scanCss(css, report, at, describe, { literalsAreCss = false, dataUrls = true } = {}) {
  scanTokens(tokenizeCss(css), report, at, describe, { literalsAreCss, dataUrls });
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
 * May this data: address stay? (ruling AB b — A9.) A data: address is a
 * whole document written into the page: in an iframe, an object or an
 * embed, data:text/html runs its script, and so does data:image/svg+xml
 * wherever a browser treats the drawing as a document. So it is allowed
 * only as an image that is not SVG — image/*, but not image/svg+xml — and
 * only in the src / srcset of an <img> or a <source>, or the poster of a
 * <video>. Anywhere else it is a violation, whatever its type.
 * `url` is the address as a browser reads it (readUrl). Its type is what
 * precedes the first ; or , (RFC 2397); a data: address without one is
 * text/plain.
 */
function dataUrlAllowed(url, attribute, tagName) {
  const type = (url.slice('data:'.length).split(/[;,]/)[0].trim().toLowerCase()) || 'text/plain';
  if (!type.startsWith('image/') || type === 'image/svg+xml') return false;
  const imageSlot = (tagName === 'img' || tagName === 'source') && (attribute === 'src' || attribute === 'srcset');
  const posterSlot = tagName === 'video' && attribute === 'poster';
  return imageSlot || posterSlot;
}

/**
 * A2, A3 and A9 for one attribute value (ruling AA — by class, not by named
 * attribute; ruling AB b). `url` is the value as a browser reads it (readUrl).
 *   protocol-relative-url  it starts with // — any attribute, <a href> included
 *   external-url           it holds an http:// or https:// address — any
 *                          attribute but the href of an <a>, wherever in the
 *                          value the address sits (srcset, content, style…)
 *   root-relative-url      a URL-bearing attribute (URL_ATTRIBUTES) holds an
 *                          address that starts with / — <a href> included
 *   data-url               it holds a data: address outside the image slots
 *                          (dataUrlAllowed)
 * One value may break several rules; that is several entries. `dataUrls`
 * is off for a .js file: read as text, it has no tag to tell the slots.
 */
function reportUrl(index, url, attribute, tagName, report, detail, { dataUrls = true } = {}) {
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
  if (dataUrls && candidates.some((candidate) => /^data:/i.test(candidate) && !dataUrlAllowed(candidate, attribute, tagName))) {
    report(index, 'data-url', detail);
  }
}

/**
 * A start tag at `start`: its name, its attributes (name, value — null when
 * it has none), and where it ends. Of repeated attributes only the first is
 * kept, as a browser does.
 *
 * The name, every attribute name and every value are read to where they
 * really end — a name of any length is one name, with whatever is glued to
 * it (ruling AC 1; review round 2). A quoted value may run over lines and
 * hold a `>`; an unquoted one ends at whitespace or at `>`, a `/` belonging
 * to it. A value that is empty (`src=>`) is `''`, not null: null is an
 * attribute without any `=`.
 */
function parseStartTag(text, start) {
  let i = start + 1;
  const name = matchAt(TAG_NAME_RE, text, i);
  const tagName = name === null ? '' : name[0].toLowerCase();
  i += name === null ? 0 : name[0].length;
  const attributes = [];
  const seen = new Set();
  let selfClosing = false;
  while (i < text.length) {
    const c = text[i];
    if (c === '>') { i += 1; break; }
    if (HTML_SPACE_RE.test(c) || c === '/') {
      // a `/` right before the `>` is the self-closing flag; one anywhere else
      // is nothing (a `/` of an unquoted value belongs to the value)
      if (c === '/' && text[i + 1] === '>') selfClosing = true;
      i += 1;
      continue;
    }
    const attribute = matchAt(ATTRIBUTE_NAME_RE, text, i);
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
        value = matchAt(UNQUOTED_VALUE_RE, text, j)[0];
        j += value.length;
      }
      i = j;
    }
    const attributeName = attribute[0].toLowerCase();
    // HTML parsing drops an attribute whose name is already on the tag: the
    // browser keeps the FIRST — and on an HTML element `TYPE` and `type` are
    // one name. Reading the last one let a script the browser runs pass as a
    // data block: <script type="text/javascript" type="application/json">.
    // The names seen are a set: a tag may carry tens of thousands.
    if (seen.has(attributeName)) continue;
    seen.add(attributeName);
    attributes.push({ name: attributeName, value });
  }
  return { name: tagName, attributes, end: i, selfClosing };
}

/**
 * Everything a start tag may do wrong. Every violation of one tag is anchored
 * at the tag's own start — the line a contributor finds it on, even when the
 * tag spans lines — and reported in document order.
 */
function checkTag(text, start, tag, report) {
  // The snippet is made once per tag, and only when the tag has something to
  // report (ruling AC 3). It used to be built for every attribute, as an
  // argument: a tag of 32 000 attributes took 46 seconds.
  let shown = null;
  const snippet = () => shown ??= text.slice(start, tag.end).replace(/\s+/g, ' ').trim().slice(0, 160);
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
      // Decoded first, then judged as CSS, and only as CSS (ruling AC 2): a
      // browser decodes the character references of an attribute value before
      // it reads that value as CSS — url(&quot;…&quot;) is a quoted address to
      // it. reportUrl would report the same https:// a second time, in words
      // meant for a tag.
      scanCss(decodeCharacterReferences(raw), report, () => start, snippet);
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
    } else if (type === null || !isDataBlockType(type)) {
      report(start, 'script-inline', snippet());
    }
  }
}

/**
 * A page. `detailOf(index)` gives the line of the text that holds `index` (for what a <style> reports).
 *
 * The content of an HTML <script> or <style> is text: the scanner skips it to
 * the matching end tag. Inside foreign content it is not — there `<script/>`
 * and `<style/>` are self-closing, and what follows them is markup that the
 * browser acts on. The audit keeps count of the <svg> / <math> it has seen
 * opened and not seen closed, and while the count is above zero it reads the
 * content of a <script> or <style> as markup (a <style>'s also as CSS, which
 * the browser applies). The count is the safe side of the browser's own rule:
 * the browser leaves foreign content at more places than the count does (an
 * HTML element that breaks out, a <desc> or <foreignObject>, which are HTML
 * integration points), so where the two differ the audit reads MORE markup
 * than the browser does, and can only over-report. It used to read less: one
 * `<svg><script/></svg>` with no `</script>` after it made the rest of the
 * file the text of that script, and nothing in it was checked.
 */
function scanHtml(text, report, detailOf) {
  let i = 0;
  let foreign = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) return;
    const next = text[lt + 1];
    if (next === '/') { // an end tag has nothing to check
      const name = matchAt(END_TAG_NAME_RE, text, lt + 2);
      if (name !== null && FOREIGN_ROOTS.has(name[0].toLowerCase()) && foreign > 0 && afterNameIs(text, lt + 2 + name[0].length)) foreign -= 1;
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
    if (FOREIGN_ROOTS.has(tag.name)) {
      if (!tag.selfClosing) foreign += 1;
      continue;
    }
    if (!RAW_TEXT.has(tag.name)) continue;
    if (foreign > 0 && tag.selfClosing) continue; // `<script/>`, `<style/>` in foreign content: an empty element
    const close = new RegExp(`</${tag.name}(?=${AFTER_END_TAG_NAME}|$)`, 'ig');
    close.lastIndex = tag.end;
    const found = close.exec(text);
    if (tag.name === 'style') {
      // The content is read as written: the CSS scanner keeps a map back to
      // it, so the line number is the line a contributor finds it on.
      const contentEnd = found === null ? text.length : found.index;
      const contentStart = tag.end;
      scanCss(text.slice(contentStart, contentEnd), report, (offset) => contentStart + offset, detailOf);
    }
    if (foreign > 0) continue; // its content is markup too, read on below
    if (found === null) return;
    const gt = text.indexOf('>', found.index);
    i = gt < 0 ? text.length : gt + 1;
  }
}

/** Is what follows a tag's name at `index` what may follow a tag name — whitespace, `/`, `>` — or the end of the text? */
const afterNameIs = (text, index) => text[index] === undefined || HTML_SPACE_RE.test(text[index]) || text[index] === '/' || text[index] === '>';

/** A .js file, as literal text: the markup a script may assemble at run time. No tag to read, so no <a href> exemption — and no slot for a data: image either, so A9 is not applied here. `detailOf(index)`: the line that holds `index`. */
function scanScriptText(text, report, detailOf) {
  const noDataUrls = { dataUrls: false };
  for (const m of text.matchAll(/\bsrc\s*=\s*(["'])(.*?)\1/gi)) reportUrl(m.index, readUrl(m[2]), 'src', '', report, detailOf(m.index), noDataUrls);
  for (const m of text.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) reportUrl(m.index, readUrl(m[2]), 'href', '', report, detailOf(m.index), noDataUrls);
  scanCss(text, report, (offset) => offset, detailOf, { literalsAreCss: true, dataUrls: false });
}

/** fetch( calls and XMLHttpRequest — not looked for in a page (see auditExternalLinks). */
function scanCalls(text, report, detailOf) {
  for (const m of text.matchAll(/\bfetch\s*\(/g)) report(m.index, 'fetch', detailOf(m.index));
  for (const m of text.matchAll(/XMLHttpRequest/g)) report(m.index, 'xhr', detailOf(m.index));
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
    // The lines of this file are found once for everything it reports (ruling
    // AC 3): every violation's line used to be counted from the top of the
    // file, one after another.
    const breaks = lineBreaksOf(text);
    const detailOf = (index) => lineText(text, breaks, index);
    const found = [];
    const report = (index, code, detail) => { found.push({ index, code, detail }); };
    if (/\.html$/i.test(file)) scanHtml(text, report, detailOf);
    else if (/\.css$/i.test(file)) scanCss(text, report, (offset) => offset, detailOf);
    else scanScriptText(text, report, detailOf);
    // fetch( and XMLHttpRequest are not looked for in a page (ruling AB c):
    // there they can be nothing but text — A4 leaves no way to run a script —
    // and reporting them failed the build on a sentence. The .js files are
    // still read for them, and so is a stylesheet, as before: the ruling
    // names pages only.
    if (!/\.html$/i.test(file)) scanCalls(text, report, detailOf);
    for (const { index, code, detail } of found.sort((a, b) => a.index - b.index)) {
      violations.push({ file: relative, line: breaksBefore(breaks, index) + 1, code, detail });
    }
  }
  return violations;
}

module.exports = { auditExternalLinks, ALLOWED_SCRIPT_SRC, CODES };
