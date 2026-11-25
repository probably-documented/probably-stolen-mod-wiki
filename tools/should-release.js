'use strict';

// should-release.js — what the release workflow asks before it tests, builds and publishes.
//
//   node tools/should-release.js [--github-output <file>]
//
// It reads two things, the latest release of the repository and git, turns them into what
// release-policy.js takes, and prints the decision. With --github-output it also appends the
// decision to that file (GitHub's $GITHUB_OUTPUT), one key per line:
//   release, reason, tag, zip, previous_tag
//
// A failure to read either is never taken for "no release yet": only an explicit 404 from the
// API is. Anything else stops the run — a network error or a missing token must not publish
// a second package as if it were the first.

const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { decideRelease, releaseTagName, zipNameFor } = require('./release-policy.js');

const execFileP = promisify(execFile);

/** Runs one command and returns its stdout. On failure the error carries the command's stderr. */
async function run(file, args) {
  const { stdout } = await execFileP(file, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return stdout;
}

/**
 * The latest release as the policy takes it.
 * @param {string} apiAnswer the body of `gh api repos/<owner>/<repo>/releases/latest`
 * @returns {{ tagName: string, publishedAt: Date }}
 * @throws {Error} unless `tag_name` is a non-empty string and `published_at` parses
 */
function latestFromApi(apiAnswer) {
  let release;
  try {
    release = JSON.parse(apiAnswer);
  } catch (err) {
    throw new Error(`[release] the API answer is not JSON: ${String(apiAnswer).slice(0, 200)}`, { cause: err });
  }
  const tagName = release?.tag_name;
  if (typeof tagName !== 'string' || tagName === '') {
    throw new Error('[release] the latest release has no tag_name in the API answer');
  }
  const publishedAt = new Date(release.published_at);
  if (typeof release.published_at !== 'string' || Number.isNaN(publishedAt.getTime())) {
    throw new Error(`[release] the latest release ${tagName} has no parseable published_at: ${JSON.stringify(release.published_at)}`);
  }
  return { tagName, publishedAt };
}

/** One git command that answers a commit hash. A failure names the command. */
async function gitSha(runFile, args) {
  try {
    return (await runFile('git', args)).trim();
  } catch (err) {
    throw new Error(`[release] git ${args.join(' ')} failed: ${err?.stderr || err?.message}`, { cause: err });
  }
}

/**
 * What the policy needs, read from the repository.
 * @param {object} args
 * @param {(file: string, args: string[]) => Promise<string>} args.runFile runs one command, answers its stdout
 * @param {string} args.repo the repository as owner/name
 * @param {number} [args.now] the current time in milliseconds
 * @returns {Promise<{ latest: { tagName: string, sha: string, publishedAt: Date } | null,
 *   headSha: string, now: number }>}
 */
async function collectState({ runFile, repo, now = Date.now() }) {
  let apiAnswer;
  try {
    apiAnswer = await runFile('gh', ['api', `repos/${repo}/releases/latest`]);
  } catch (err) {
    // Only an explicit 404 means "no release yet". A network error, a 500 or a missing
    // token must not be read as the first release: that would publish right past the cooldown.
    if (/\b404\b/.test(`${err?.stderr ?? ''} ${err?.message ?? ''}`)) {
      return { latest: null, headSha: await gitSha(runFile, ['rev-parse', 'HEAD']), now };
    }
    throw new Error(`[release] could not read the latest release of ${repo}: ${err?.stderr || err?.message}`, { cause: err });
  }
  const { tagName, publishedAt } = latestFromApi(apiAnswer);
  const sha = await gitSha(runFile, ['rev-list', '-n', '1', `${tagName}^{commit}`]);
  return { latest: { tagName, sha, publishedAt }, headSha: await gitSha(runFile, ['rev-parse', 'HEAD']), now };
}

/**
 * The decision, with the names the workflow publishes under.
 * @returns {Promise<{ release: boolean, reason: string, tag: string, zip: string, previousTag: string }>}
 *   `tag` and `zip` are named after the UTC calendar date of `now`; `previousTag` is the tag of
 *   the latest release, '' when there is none
 */
async function decide({ runFile, repo, now = Date.now() }) {
  const state = await collectState({ runFile, repo, now });
  const { release, reason } = decideRelease(state);
  const today = new Date(now);
  return {
    release,
    reason,
    tag: releaseTagName(today),
    zip: zipNameFor(today),
    previousTag: state.latest?.tagName ?? '',
  };
}

/**
 * `decide`, printed and — when `githubOutput` is given — appended to that file.
 * @param {object} [args] `runFile` defaults to running the commands; `repo` defaults to GH_REPO
 * @returns {Promise<ReturnType<typeof decide>>}
 */
async function main({ runFile = run, repo = process.env.GH_REPO, now = Date.now(), githubOutput = null } = {}) {
  if (!repo) throw new Error('[release] GH_REPO is not set (the repository as owner/name)');
  const result = await decide({ runFile, repo, now });
  if (githubOutput) {
    const lines = [
      `release=${result.release}`,
      `reason=${result.reason}`,
      `tag=${result.tag}`,
      `zip=${result.zip}`,
      `previous_tag=${result.previousTag}`,
    ];
    await fs.appendFile(githubOutput, `${lines.join('\n')}\n`);
  }
  console.log(`[release] ${result.release ? 'publish' : 'skip'}: ${result.reason}`);
  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--github-output');
  const githubOutput = at === -1 ? null : args[at + 1];
  if (at !== -1 && !githubOutput) {
    console.error('[release] --github-output needs a file path');
    process.exitCode = 1;
  } else {
    main({ githubOutput }).catch((err) => {
      console.error(`[release] fatal: ${err?.stderr || err?.message || err}`);
      process.exitCode = 1;
    });
  }
}

module.exports = { latestFromApi, collectState, decide, main };
