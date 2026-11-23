'use strict';

// Task 4: fixture-only build entry — what `npm run build` (and therefore
// GitHub Actions) runs.
//
// Unlike modwiki's full builder this never touches the game directory or the
// decompile cache: the site is rendered entirely from the frozen FIXTURE_DATA
// literal plus the hand-written content/ layer. Flow (task contract):
//   rm dist → renderSite(structuredClone(FIXTURE_DATA), { contentDir })
//   → write files → auditExternalLinks(dist)
//
// Failure discipline: a render/write failure or any external-link audit
// violation throws with process.exitCode = 1, so a broken build can never
// deploy silently (file:// offline discipline).

const fs = require('node:fs/promises');
const path = require('node:path');

const { renderSite } = require('./render.js');
const { auditExternalLinks } = require('./audit.js');
const { FIXTURE_DATA } = require('../../data/fixture-model.js');

/**
 * Render the fixture site into distDir.
 * @param {{distDir?: string, contentDir?: string|null}} [options]
 *   contentDir supplies the optional content/items/<id>.md hand-written
 *   layer (pass null to skip the 详解 section entirely).
 * @returns {Promise<{pages: number}>} number of files rendered into distDir.
 * @throws {Error} on any render/write failure or external-link audit
 *   violation; process.exitCode is set to 1 before the throw.
 */
async function buildSkeleton({ distDir = 'dist', contentDir = 'content' } = {}) {
  try {
    // 1. Clean rebuild → idempotent file list (no stale pages survive).
    await fs.rm(distDir, { recursive: true, force: true });

    // 2. Render. FIXTURE_DATA is a frozen shared literal — structuredClone
    //    thaws a private copy so rendering can never mutate (or trip on) it
    //    (modwiki build.js L469 precedent).
    const rendered = await renderSite(structuredClone(FIXTURE_DATA), { contentDir });

    // 3. Write pages (posix rel paths from renderSite → platform paths).
    for (const [rel, content] of rendered) {
      const dest = path.join(distDir, ...rel.split('/'));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content);
    }

    // 4. External-link audit (offline discipline): any violation fails the build.
    const violations = await auditExternalLinks(distDir);
    if (violations.length > 0) {
      const lines = violations.map((v) => `  ${v.file}:${v.line} [${v.code}] ${v.detail}`);
      throw new Error(`[audit] FAIL — ${violations.length} external-link violation(s):\n${lines.join('\n')}`);
    }

    return { pages: rendered.size };
  } catch (err) {
    process.exitCode = 1;
    throw err;
  }
}

async function main() {
  const result = await buildSkeleton();
  console.log(`[build:skeleton] rendered ${result.pages} files → dist/`);
  console.log('[audit] OK — no external-link violations');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[build:skeleton] fatal:', err);
    process.exitCode = 1; // belt and braces: buildSkeleton already sets it
  });
}

module.exports = { buildSkeleton };
