'use strict';

// Task 4 (controller ruling B): item-texture helpers, moved verbatim from
// modwiki tools/build/build.js — exists (L119-126) and the whole "Item
// textures" section (L187-301: iconRel / iconRescueNames / resolveTexture /
// dropMissingIcons). Everything below the MOD_DIRS line is byte-identical to
// the source; do not edit it here.
//
// Why repo A needs it: fixture builds never read the game's Mods/ directory,
// so a declared icon has no texture source. buildSkeleton runs the real
// build's missing-texture path (dropMissingIcons → warn → item.icon = null →
// the templates' 无图 fallback) rather than shipping <img src> pointing at
// files dist does not carry. copyItemTextures lives in skeleton-build.js: it
// copies the kept textures from assets-src/mods/<modId>/Textures/Items/ into
// dist/assets/items/<modId>/.
//
// Sole adaptation — MOD_DIRS: the source derives it from merge.js MOD_TABLE
// (install directory ↔ mod id). Repo A has no install directories and must
// not grow a Mods/ mapping, so the map is id → id over the fixture mod list.
// That is all dropMissingIcons needs to report "no texture file → 无图
// fallback" (instead of "no install dir mapping") for every known mod.

const fs = require('node:fs/promises');
const path = require('node:path');

const { FIXTURE_DATA } = require('../../data/fixture-model.js');

/** mod id → directory probed for Textures/Items (id → id in the fixture repo). */
const MOD_DIRS = new Map(FIXTURE_DATA.mods.map(({ id }) => [id, id]));

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Item textures: Mods/<dir>/Textures/Items/<file> → dist/assets/items/<modId>/
// ---------------------------------------------------------------------------

/**
 * Resolve an item's declared icon to its dist-relative asset path
 * (`items/<modId>/<file>.png`; merge.js toIconPath shape). Returns null for
 * null/empty icons — those render the 无图 fallback and copy nothing.
 */
function iconRel(item) {
  if (typeof item?.icon !== 'string' || item.icon === '') return null;
  return item.icon.includes('/')
    ? item.icon
    : `items/${item.mod}/${item.icon.toLowerCase().endsWith('.png') ? item.icon : `${item.icon}.png`}`;
}

/**
 * Declared icon file name → normalized rescue candidates. The family's
 * channels declare icons like `gear.catEars` / `dish.takoyaki` /
 * `brood_white_tentacle` while the texture files are `cat_ears.png`,
 * `brood_takoyaki.png`, `brood_tentacle_white.png` — dot→underscore,
 * camelCase→snake, dropping/rotating the prefix word, or swapping it for a
 * family texture prefix (`brood_`/`brothel_`) recovers the file.
 * @returns {string[]} candidate file names (with .png)
 */
function iconRescueNames(fileName) {
  const base = String(fileName).replace(/\.png$/i, '');
  const snake = base
    .replace(/\./g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  const words = snake.split('_').filter(Boolean);
  const rest = words.slice(1).join('_');
  const names = [snake, rest, [...words].sort().join('_'), `brood_${rest}`, `brothel_${rest}`];
  return [...new Set(names)].map((name) => `${name}.png`);
}

/**
 * Resolve an item's declared icon to its physical texture source.
 * Candidate dirs: the item's own mod first, then the mod implied by the icon
 * path segment (cross-mod declarations — a lewd_meme item pointing at a
 * lewd_meme_remake texture resolves in the remake install dir). If the
 * declared name misses everywhere, retry with iconRescueNames variants
 * (case-insensitive) and rewrite to the actual file on hit.
 * @returns {Promise<{src: string, modId: string, fileName: string,
 *   rescued: boolean} | null>} null = no texture exists for this icon
 */
async function resolveTexture(item, { modsDir, modDirs = MOD_DIRS }) {
  const rel = iconRel(item);
  if (rel === null) return null;
  const segs = rel.split('/');
  const fileName = segs.pop();
  const iconMod = segs.length >= 2 && segs[0] === 'items' ? segs[1] : null;

  const candidates = [];
  for (const modId of [item.mod, iconMod]) {
    if (modId == null) continue;
    const dir = modDirs.get(modId);
    if (dir !== undefined && !candidates.some((c) => c.modId === modId)) candidates.push({ modId, dir });
  }

  for (const { modId, dir } of candidates) {
    const src = path.join(modsDir, dir, 'Textures', 'Items', fileName);
    if (await exists(src)) return { src, modId, fileName, rescued: false };
  }
  for (const { modId, dir } of candidates) {
    const dirPath = path.join(modsDir, dir, 'Textures', 'Items');
    let files;
    try {
      files = await fs.readdir(dirPath);
    } catch {
      continue;
    }
    const byLower = new Map(files.map((f) => [f.toLowerCase(), f]));
    for (const cand of iconRescueNames(fileName)) {
      const hit = byLower.get(cand.toLowerCase());
      if (hit !== undefined) return { src: path.join(dirPath, hit), modId, fileName: hit, rescued: true };
    }
  }
  return null;
}

/**
 * Drop declared icons whose texture source file does not exist on disk
 * (T11 real-data smoke: a declared-but-missing file renders a broken <img>
 * and a console 404 on every page carrying the item). Before nulling, one
 * normalized-name rescue pass (resolveTexture) rewrites fixable declarations
 * — final review Important: 14 of the 24 dropped icons exist under a
 * normalized spelling. Nulling the icon here — before rendering — keeps
 * merge's declared value intact while the site degrades to the 无图 fallback,
 * so pages stay console-error-clean.
 * @returns {Promise<number>} number of icons dropped
 */
async function dropMissingIcons(items, { modsDir, modDirs = MOD_DIRS, warn = console.warn } = {}) {
  let dropped = 0;
  for (const item of items ?? []) {
    const rel = iconRel(item);
    if (rel === null) continue;
    const resolved = await resolveTexture(item, { modsDir, modDirs });
    if (resolved === null) {
      const mapped = modDirs.get(item.mod) !== undefined
        || (rel.includes('/') && modDirs.get(rel.split('/')[1]) !== undefined);
      warn(`[build] icon dropped: ${rel} (${mapped ? 'no texture file → 无图 fallback' : 'no install dir mapping'})`);
      item.icon = null;
      dropped += 1;
      continue;
    }
    const fixed = `items/${resolved.modId}/${resolved.fileName}`;
    if (fixed !== item.icon) {
      warn(`[build] icon rescued: ${rel} → ${fixed}${resolved.rescued ? ' (normalized name match)' : ''}`);
      item.icon = fixed;
    }
  }
  return dropped;
}

module.exports = { dropMissingIcons };
