'use strict';

// content/mechanics/<slug>.md → mechanic pages (the hand-written content
// layer). This is the merge step the build entry (skeleton-build.js) had
// inlined since Task 4, moved here unchanged (task 5b C1) so that entry is
// pure orchestration again and the step can be unit-tested on its own.
//
// Contract — same as modwiki merge.js readMechanics:
//   slug   = the file name without .md
//   title  = frontmatter `title` > first ATX h1 > slug
//   source = the file as written
// A slug already present in `mechanics` is replaced by the file; new slugs
// are appended in file-name order. A missing directory (or a null contentDir)
// leaves `mechanics` as is.

const fs = require('node:fs/promises');
const path = require('node:path');

const { splitFrontmatter } = require('../extract/frontmatter.js');

const isMissing = (err) => err != null && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

/** frontmatter `title` > first ATX h1 > slug (modwiki merge.js readMechanics order). */
function mechanicTitle(source, slug) {
  const { fm, body } = splitFrontmatter(source);
  const fromFm = fm.title;
  if (typeof fromFm === 'string' && fromFm.trim() !== '') return fromFm.trim();
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : slug;
}

/**
 * Merge content/mechanics/*.md into `mechanics` (see the header).
 * @param {Array<{slug: string, title: string, source: string}>} mechanics
 * @param {string|null} contentDir the content root (null skips the merge)
 * @returns {Promise<Array<{slug: string, title: string, source: string}>>}
 */
async function mergeMechanicsContent(mechanics, contentDir) {
  if (contentDir == null) return mechanics;
  const dir = path.join(contentDir, 'mechanics');
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return mechanics;
    throw err;
  }
  const bySlug = new Map((mechanics ?? []).map((m) => [m.slug, m]));
  const names = entries
    .filter((e) => e.isFile() && /\.md$/i.test(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const source = await fs.readFile(path.join(dir, name), 'utf8');
    const slug = name.replace(/\.md$/i, '');
    bySlug.set(slug, { slug, title: mechanicTitle(source, slug), source });
  }
  return [...bySlug.values()];
}

module.exports = { mechanicTitle, mergeMechanicsContent };
