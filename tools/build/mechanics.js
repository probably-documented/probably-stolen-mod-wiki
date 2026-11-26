'use strict';

// content/mods/<modId>/mechanics/<slug>.md → mechanic pages (the hand-written
// content layer), read through the layout (tools/build/content-layout.js) so
// that the build entry (skeleton-build.js) stays pure orchestration and the
// step can be unit-tested on its own.
//
// Contract:
//   slug     = the file name without .md
//   title    = frontmatter `title` > first ATX h1 > slug
//   mod      = the mod directory the page is in (layout.mods[].id); null for
//              an entry that came from `mechanics`, the data
//   source   = the file as written
// A slug already present in `mechanics` is replaced by the page; new slugs
// are appended — the pages of ALL mods in one file-name order, never grouped
// by mod: that order is each mod's own navigation page (its 机制说明 list),
// the item pages' 相关页面 and data.js. A null layout (or one without mods)
// returns the base entries as they came, mod null.
//
// And, since stage 3 (task 5): which site page declares the top nav's about
// entry (sitePagesWithNavLabel) — content/site/<文件名>.md with a front matter
// `nav_label`. A mechanic page cannot declare it any more; a `nav_label` in a
// mechanic page's front matter is simply not read.

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
 * provides. Only a non-empty string counts: a missing key, an empty or blank
 * value, or anything the YAML subset parses into a non-string (number,
 * boolean, list) means "not set" → null. The label is trimmed, like the title.
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeNavLabel(value) {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  return label === '' ? null : label;
}

/**
 * The site pages that declare the top nav's about entry (see the header), in
 * file-name order — as the layout lists them. Whether more than one does is
 * for the build entry to judge and report. A page the layout listed whose
 * file is gone by the time it is read declares nothing: there is nothing to
 * read a label from.
 * @param {object|null} layout readContentLayout 的结果
 * @returns {Promise<Array<{ slug: string, navLabel: string, file: string }>>}
 */
async function sitePagesWithNavLabel(layout) {
  const pages = [];
  for (const page of layout?.site ?? []) {
    let source;
    try {
      source = await fs.readFile(page.file, 'utf8');
    } catch (err) {
      if (err != null && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) continue;
      throw err;
    }
    const navLabel = normalizeNavLabel(splitFrontmatter(source).fm.nav_label);
    if (navLabel !== null) pages.push({ slug: page.slug, navLabel, file: page.file });
  }
  return pages;
}

/**
 * Merge the mechanic pages of every mod (content/mods/<modId>/mechanics/*.md,
 * as the layout lists them) into `mechanics` (see the header).
 * Every entry of the result has the same four keys — slug, title, source and
 * mod — whether it is an untouched base entry, a replaced one or an appended
 * one. A base entry that still carries a `navLabel` loses it: no mechanic page
 * declares the about entry.
 * @param {Array<{slug: string, title: string, source: string}>} mechanics
 * @param {object|null} layout readContentLayout 的结果(null 时只有基线条目)
 * @returns {Promise<Array<{slug: string, title: string, source: string, mod: string|null}>>}
 */
async function mergeMechanicsContent(mechanics, layout) {
  const bySlug = new Map((mechanics ?? []).map((m) => {
    const { navLabel: _notDeclared, ...rest } = m;
    return [m.slug, { ...rest, mod: m.mod ?? null }];
  }));
  const pages = (layout?.mods ?? [])
    .flatMap((mod) => mod.mechanics.map((page) => ({ ...page, mod: mod.id })))
    .sort(byFileName);
  for (const { slug, file, mod } of pages) {
    const source = await fs.readFile(file, 'utf8');
    const { fm, body } = splitFrontmatter(source);
    bySlug.set(slug, { slug, title: titleFrom(fm.title, body, slug), source, mod });
  }
  return [...bySlug.values()];
}

module.exports = { mechanicTitle, mergeMechanicsContent, sitePagesWithNavLabel };
