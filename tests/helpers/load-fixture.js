'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

/**
 * Read tests/fixtures/<name> as UTF-8 text.
 * Shared by every test file so fixtures stay in one place.
 */
function loadFixture(name) {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

module.exports = { loadFixture };
