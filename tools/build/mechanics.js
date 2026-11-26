'use strict';

// content/mods/<modId>/mechanics/<slug>.md → mechanic pages (the hand-written
// content layer), read through the layout (tools/build/content-layout.js) so
// that the build entry (skeleton-build.js) stays pure orchestration and the
// step can be unit-tested on its own.
//
// Contract:
//   slug     = the file name without .md
//   title    = frontmatter `title` > first ATX h1 > slug
//   navLabel = frontmatter `nav_label`, when it declares the top-nav about
//              entry (see normalizeNavLabel); null otherwise (task 5b A)
//   mod      = the mod directory the page is in (layout.mods[].id); null for
//              an entry that came from `mechanics`, the data
//   source   = the file as written
// Every entry of the result carries navLabel and mod, set or not.
// A slug already present in `mechanics` is replaced by the page; new slugs
// are appended — the pages of ALL mods in one file-name order, never grouped
// by mod: that order is the mechanics index, the item pages' 相关页面 and
// data.js. A null layout (or one without mods) returns the base entries as
// they came, navLabel normalised and mod null.

const fs = require('node:fs/promises');
const path = require('node:path');

const { splitFrontmatter } = require('../extract/frontmatter.js');

/** By the file name of each — the order of the pages, across mods. */
const byFileName = (a, b) => {
  const left = path.basename(a.file);
  const right = path.basename(b.file);
  return left < right ? -1 : left > right ? 1 : 0;
};

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
 * Merge the mechanic pages of every mod (content/mods/<modId>/mechanics/*.md,
 * as the layout lists them) into `mechanics` (see the header).
 * The result has the same shape on every path (task 6b D2): each entry
 * carries `navLabel` — the label, or null — and `mod`, whether it is an
 * untouched base entry, a replaced one or an appended one.
 * @param {Array<{slug: string, title: string, source: string, navLabel?: string|null}>} mechanics
 * @param {object|null} layout readContentLayout 的结果(null 时只有基线条目)
 * @returns {Promise<Array<{slug: string, title: string, navLabel: string|null, source: string, mod: string|null}>>}
 */
async function mergeMechanicsContent(mechanics, layout) {
  // Base entries keep everything they came with; navLabel is normalised so
  // that "which page declares the about entry" is answered one way everywhere,
  // and mod is null: the data does not say which mod a page belongs to.
  const bySlug = new Map((mechanics ?? []).map((m) => [m.slug, { ...m, navLabel: normalizeNavLabel(m.navLabel), mod: m.mod ?? null }]));
  const baseEntries = () => [...bySlug.values()];
  const pages = (layout?.mods ?? [])
    .flatMap((mod) => mod.mechanics.map((page) => ({ ...page, mod: mod.id })))
    .sort(byFileName);
  for (const { slug, file, mod } of pages) {
    const source = await fs.readFile(file, 'utf8');
    const { fm, body } = splitFrontmatter(source);
    bySlug.set(slug, {
      slug,
      title: titleFrom(fm.title, body, slug),
      navLabel: normalizeNavLabel(fm.nav_label),
      source,
      mod,
    });
  }
  return [...bySlug.values()];
}

module.exports = { mechanicTitle, mergeMechanicsContent, mechanicsWithNavLabel, normalizeNavLabel };
