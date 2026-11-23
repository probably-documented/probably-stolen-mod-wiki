'use strict';

// Task 4: external-link audit (offline discipline) — moved verbatim from
// modwiki tools/build/build.js: BWIKI_CREDIT_URL (L44-45), fs helpers
// walkFiles/toPosix (L101-117) and auditExternalLinks (L133-185). dist/
// must be double-clickable via file:// — any fetch/XHR/http src|href is a
// violation; the single whitelisted external href is the BWIKI footer
// credit (CC BY-NC-SA 4.0 attribution).

const fs = require('node:fs/promises');
const path = require('node:path');

/** Footer credit link — the single audited external-href whitelist (T7). */
const BWIKI_CREDIT_URL = 'https://wiki.biligame.com/probablystolen';

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
// External-link audit (offline discipline)
// ---------------------------------------------------------------------------

/**
 * Audit every .html/.js/.css file under dir for external references.
 * Forbidden: fetch(, XMLHttpRequest, src="http…", href="http…" outside the
 * BWIKI footer whitelist, CSS url(http…). Returns an array of
 * { file, line, code, detail } — empty array means the site is offline-clean.
 */
async function auditExternalLinks(dir) {
  const violations = [];
  const files = (await walkFiles(dir)).filter((f) => /\.(html|js|css)$/i.test(f));
  for (const file of files) {
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      violations.push({ file: toPosix(path.relative(dir, file)), line: 0, code: 'unreadable', detail: err.message });
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      let hit = null;

      if (/\bfetch\s*\(/.test(line)) hit = 'fetch';
      else if (line.includes('XMLHttpRequest')) hit = 'xhr';
      else if (/\bsrc\s*=\s*["']https?:\/\//i.test(line)) hit = 'src-http';
      else if (/url\(\s*["']?https?:\/\//i.test(line)) hit = 'css-url-http';
      else {
        // href="http…": every http(s) href must be the whitelisted BWIKI credit.
        const hrefs = line.match(/href\s*=\s*["']([^"']*)["']/gi) ?? [];
        const bad = hrefs.some((h) => {
          const m = h.match(/=\s*["']([^"']*)["']/i);
          const url = m ? m[1] : '';
          return /^https?:\/\//i.test(url) && !url.startsWith(BWIKI_CREDIT_URL);
        });
        if (bad) hit = 'href-http';
      }

      if (hit !== null) {
        violations.push({
          file: toPosix(path.relative(dir, file)),
          line: i + 1,
          code: hit,
          detail: line.trim().slice(0, 160),
        });
      }
    }
  }
  return violations;
}

module.exports = { auditExternalLinks, BWIKI_CREDIT_URL };
