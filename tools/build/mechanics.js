'use strict';

// content/mechanics/<slug>.md → mechanic pages (the hand-written content
// layer). This is the merge step the build entry (skeleton-build.js) had
// inlined since Task 4, moved here (task 5b C1) so that entry is pure
// orchestration again and the step can be unit-tested on its own.
//
// Contract — same as modwiki merge.js readMechanics:
//   slug     = the file name without .md
//   title    = frontmatter `title` > first ATX h1 > slug
//   navLabel = frontmatter `nav_label`, when it declares the top-nav about
//              entry (see normalizeNavLabel); null otherwise (task 5b A)
//   source   = the file as written
// Every entry of the result carries navLabel, set or not (task 6b D2).
// A slug already present in `mechanics` is replaced by the file; new slugs
// are appended in file-name order. A missing directory (or a null
// contentDir) returns the base entries as they came, navLabel normalised.

const fs = require('node:fs/promises');
const path = require('node:path');

const { splitFrontmatter } = require('../extract/frontmatter.js');

const isMissing = (err) => err != null && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

/** frontmatter `title` (already parsed) > first ATX h1 > slug. */
function titleFrom(fromFm, body, slug) {
  if (typeof fromFm === 'string' && fromFm.trim() !== '') return fromFm.trim();
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : slug;
}

/** frontmatter `title` > first ATX h1 > slug (modwiki merge.js readMechanics order). */
function mechanicTitle(source, slug) {
  const { fm, body } = splitFrontmatter(source);
  return titleFrom(fm.title, body, slug);
}

/**
 * frontmatter `nav_label` → the text of the top-nav about entry this page
 * provides (task 5b A1/A4). Only a non-empty string counts: a missing key,
 * an empty or blank value, or anything the YAML subset parses into a
 * non-string (number, boolean, list) means "not set" → null. The label is
 * trimmed, like the title.
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeNavLabel(value) {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  return label === '' ? null : label;
}

/**
 * The entries that provide the top-nav about entry (navLabel set), in
 * order — the ONE answer to "is navLabel set?" (task 6b D1): render.js
 * takes the first of these for the top nav. The top nav has room for
 * exactly one such page; the build entry goes red when this returns more
 * than one.
 * @param {Array<{navLabel?: string|null}>} mechanics
 * @returns {Array<{slug: string, navLabel: string}>}
 */
function mechanicsWithNavLabel(mechanics) {
  return (mechanics ?? []).filter((m) => normalizeNavLabel(m.navLabel) !== null);
}

/**
 * Merge content/mechanics/*.md into `mechanics` (see the header).
 * The result has the same shape on every path (task 6b D2): each entry
 * carries `navLabel` — the label, or null — whether it is an untouched
 * base entry, a replaced one or an appended one.
 * @param {Array<{slug: string, title: string, source: string, navLabel?: string|null}>} mechanics
 * @param {string|null} contentDir the content root (null skips the merge)
 * @returns {Promise<Array<{slug: string, title: string, navLabel: string|null, source: string}>>}
 */
async function mergeMechanicsContent(mechanics, contentDir) {
  // Base entries keep everything they came with; navLabel is normalised so
  // that "which page declares the about entry" is answered one way everywhere.
  const bySlug = new Map((mechanics ?? []).map((m) => [m.slug, { ...m, navLabel: normalizeNavLabel(m.navLabel) }]));
  const baseEntries = () => [...bySlug.values()];
  if (contentDir == null) return baseEntries();
  const dir = path.join(contentDir, 'mechanics');
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return baseEntries();
    throw err;
  }
  const names = entries
    .filter((e) => e.isFile() && /\.md$/i.test(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const source = await fs.readFile(path.join(dir, name), 'utf8');
    const slug = name.replace(/\.md$/i, '');
    const { fm, body } = splitFrontmatter(source);
    bySlug.set(slug, {
      slug,
      title: titleFrom(fm.title, body, slug),
      navLabel: normalizeNavLabel(fm.nav_label),
      source,
    });
  }
  return [...bySlug.values()];
}

module.exports = { mechanicTitle, mergeMechanicsContent, mechanicsWithNavLabel, normalizeNavLabel };
