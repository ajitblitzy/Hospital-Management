'use strict';

/**
 * @file tests/security/reporter.js
 * @module @hms/security-tests/reporter
 *
 * Result reporting for the HMS `@hms/security-tests` harness. Turns the flat
 * `results` array produced by `harness.js` into two complementary outputs:
 *
 *   1. A **machine-readable JUnit XML** report written to the gitignored
 *      `test-results/` directory (default {@link module:@hms/security-tests/config.junitPath}).
 *      The JUnit schema is the lingua-franca that the `../../.github/` CI
 *      workflows (GitHub Actions) consume to render per-test pass/fail/skip
 *      status, so writing it lets the security suite surface results in CI
 *      exactly like the other suites.
 *   2. A **human-readable console summary** for local runs and CI logs:
 *      per-suite counts, an explicit list of failures, a condensed list of
 *      skips (skips are EXPECTED when the system-under-test is only partially
 *      available), and a one-line totals footer.
 *
 * It also derives the process exit code from the results.
 *
 * DESIGN CONTRACT
 * ---------------
 *   - ZERO third-party dependencies. This module requires ONLY the Node.js
 *     standard library (`node:fs`, `node:path`) plus the sibling `./config`
 *     for the default JUnit output path. That keeps the harness installable
 *     and runnable with nothing but Node.
 *   - CommonJS module (the suite is CommonJS; the repo root has no
 *     `"type": "module"`).
 *   - Pure with respect to `process.env`: this module reads no environment
 *     variables directly — all configuration flows in through `./config`.
 *
 * RESULT SHAPE (contract with `harness.js`)
 * -----------------------------------------
 * Each entry of `results` is a plain object:
 *   {
 *     suite:      string,                    // logical grouping (a "check" file)
 *     name:       string,                    // individual assertion / test name
 *     status:     'pass' | 'fail' | 'skip',  // outcome
 *     error:      string | null,             // failure detail OR skip reason
 *     durationMs: number,                    // wall-clock duration, milliseconds
 *   }
 * The skip *reason* is carried in `error`; `reason`/`message` are also honoured
 * defensively (see {@link messageOf}). Missing / malformed fields are tolerated
 * so a partially-populated result never crashes reporting.
 *
 * PATIENT-DATA PRIVACY / SECRET SAFETY
 * ------------------------------------
 * The QA strategy treats credential and patient-data leakage as a top risk.
 * {@link printSummary} therefore NEVER prints raw secrets: the run metadata is
 * restricted to a fixed {@link SAFE_META_KEYS} allow-list, and every value that
 * reaches the console is passed through {@link redactSecrets}, which masks
 * basic-auth URL credentials, bearer tokens, JWTs, common provider API keys,
 * and `password=`/`token=`-style key/value pairs.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

// ===========================================================================
// Phase 1 — XML escaping & sanitization
// ---------------------------------------------------------------------------
// A JUnit report is XML 1.0. Two things must be handled before interpolating
// arbitrary strings (test names, error bodies that may contain raw HTTP
// response bytes) into the document:
//   (a) the five XML metacharacters must be entity-escaped, and
//   (b) control characters that are simply ILLEGAL in XML 1.0 must be removed,
//       otherwise the produced file fails to parse even though every `<`/`&`
//       was escaped.
// ===========================================================================

/**
 * Matches control characters that are NOT permitted anywhere in an XML 1.0
 * document. XML 1.0 allows only tab (`\x09`), line-feed (`\x0A`) and carriage
 * return (`\x0D`) from the C0 range; every other code point below `\x20` is
 * forbidden and must be stripped/normalized to keep the document well-formed.
 *
 * @constant
 * @type {RegExp}
 */
// eslint-disable-next-line no-control-regex -- intentionally targets illegal XML 1.0 control chars
const XML_INVALID_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/**
 * Escape a value for safe inclusion in XML text or an attribute.
 *
 * Behaviour:
 *   - `null`/`undefined` collapse to an empty string (clean output rather than
 *     the literal text `"null"`).
 *   - Any non-string is coerced with `String()` so numbers/objects never throw.
 *   - Illegal XML 1.0 control characters are replaced with a single space.
 *   - The five XML metacharacters are entity-escaped. `&` is replaced FIRST so
 *     the ampersands introduced by the later replacements are not double-escaped.
 *
 * @param {*} value - The value to escape (any type).
 * @returns {string} An XML-safe string.
 */
function escapeXml(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(XML_INVALID_CONTROL_CHARS, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ===========================================================================
// Internal helpers (not exported)
// ===========================================================================

/**
 * Maximum number of characters kept from a failure/skip message before it is
 * truncated, both in the JUnit XML and the console. Long messages (e.g. a full
 * HTML error page echoed by the SUT) would otherwise bloat the report.
 *
 * @constant
 * @type {number}
 */
const MESSAGE_MAX_CHARS = 2000;

/**
 * Coerce any value to a string without throwing. `null`/`undefined` become the
 * empty string; everything else is `String()`-ed.
 *
 * @param {*} value - The value to coerce.
 * @returns {string} The coerced string.
 */
function coerceString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}

/**
 * Extract the human-readable detail from a result: the failure error for a
 * failed test, or the reason for a skipped one. The harness carries this in
 * `error`; `reason` and `message` are accepted as defensive fallbacks so the
 * reporter stays robust to minor shape drift.
 *
 * @param {object} result - A single harness result entry.
 * @returns {string} The detail text, or an empty string when none is present.
 */
function messageOf(result) {
  if (!result || typeof result !== 'object') {
    return '';
  }
  if (result.error !== null && result.error !== undefined) {
    return coerceString(result.error);
  }
  if (result.reason !== null && result.reason !== undefined) {
    return coerceString(result.reason);
  }
  if (result.message !== null && result.message !== undefined) {
    return coerceString(result.message);
  }
  return '';
}

/**
 * Return only the first line of a (possibly multi-line) string. Used to keep
 * the console failure/skip listing to a single tidy line per test.
 *
 * @param {*} value - The value whose first line is wanted.
 * @returns {string} The substring up to (but excluding) the first CR or LF.
 */
function firstLine(value) {
  const str = coerceString(value);
  const idx = str.search(/[\r\n]/);
  return idx === -1 ? str : str.slice(0, idx);
}

/**
 * Truncate a string to at most `max` characters, appending a compact,
 * ASCII-only marker noting how many characters were dropped.
 *
 * @param {*} value - The value to truncate.
 * @param {number} [max=MESSAGE_MAX_CHARS] - Maximum retained length.
 * @returns {string} The original string, or a truncated variant.
 */
function truncate(value, max = MESSAGE_MAX_CHARS) {
  const str = coerceString(value);
  if (str.length <= max) {
    return str;
  }
  return `${str.slice(0, max)}... [truncated ${str.length - max} chars]`;
}

/**
 * Normalize a duration to a safe, non-negative finite number of milliseconds.
 * Missing/NaN/negative values collapse to `0` so time math never yields `NaN`.
 *
 * @param {*} ms - The raw duration value.
 * @returns {number} A finite, non-negative millisecond count.
 */
function safeMs(ms) {
  const n = Number(ms);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Format a millisecond duration as the fixed-precision seconds string used by
 * the JUnit `time` attribute and the console totals line.
 *
 * @param {*} ms - The raw duration value in milliseconds.
 * @returns {string} Seconds with three decimal places (e.g. `"0.005"`).
 */
function formatSeconds(ms) {
  return (safeMs(ms) / 1000).toFixed(3);
}

/**
 * Group the flat results array by `suite`, preserving first-seen suite order,
 * and pre-aggregate the per-suite counters used by both outputs.
 *
 * @param {Array<object>} results - The harness results array.
 * @returns {Array<{name: string, cases: Array<object>, tests: number,
 *   failures: number, skips: number, passes: number, timeMs: number}>}
 *   Ordered per-suite groups.
 */
function groupBySuite(results) {
  const list = Array.isArray(results) ? results : [];
  const order = [];
  const bySuite = new Map();

  for (const item of list) {
    const result = item && typeof item === 'object' ? item : {};
    const suiteName = coerceString(result.suite) || 'unknown';

    let group = bySuite.get(suiteName);
    if (!group) {
      group = {
        name: suiteName,
        cases: [],
        tests: 0,
        failures: 0,
        skips: 0,
        passes: 0,
        timeMs: 0,
      };
      bySuite.set(suiteName, group);
      order.push(group);
    }

    const status = coerceString(result.status);
    const durationMs = safeMs(result.durationMs);
    group.cases.push({
      name: coerceString(result.name) || '(unnamed)',
      status,
      durationMs,
      raw: result,
    });
    group.tests += 1;
    group.timeMs += durationMs;
    if (status === 'fail') {
      group.failures += 1;
    } else if (status === 'skip') {
      group.skips += 1;
    } else {
      group.passes += 1;
    }
  }

  return order;
}

// ===========================================================================
// Secret redaction (console output only)
// ---------------------------------------------------------------------------
// `printSummary` MUST NOT echo credentials. Two layers protect the console:
//   1. Run metadata is limited to the SAFE_META_KEYS allow-list below.
//   2. Every value that reaches the console is passed through redactSecrets(),
//      which masks the credential shapes most likely to appear in a base URL,
//      an HTTP error body, or an auth header.
// NOTE: the JUnit XML deliberately keeps the (escaped, truncated) failure text
// verbatim — it is a machine-readable debugging artifact written only to the
// gitignored `test-results/` directory, never committed. The redaction policy
// is scoped to the console summary per the reporter's contract.
// ===========================================================================

/**
 * Ordered credential-masking rules. Applied in sequence so that a broad
 * key/value rule cannot re-expose a token already normalized by an earlier,
 * more specific rule (e.g. `Bearer <token>` is collapsed before the generic
 * `authorization: <value>` rule runs).
 *
 * @constant
 * @type {ReadonlyArray<{re: RegExp, repl: string}>}
 */
const REDACTIONS = Object.freeze([
  // Basic-auth credentials embedded in a URL: keep scheme + username, mask the
  // password (e.g. `https://user:pass@host` -> `https://user:***@host`). The
  // password segment uses a greedy `[^\s/]*@` so a password that itself
  // contains an (unencoded) `@` is still fully masked up to the authority's
  // final `@`, and a `/` or whitespace bounds the match to a single URL.
  { re: /([a-zA-Z][\w+.-]*:\/\/[^\s:/@]+:)[^\s/]*@/g, repl: '$1***@' },
  // HTTP bearer tokens.
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, repl: 'Bearer ***' },
  // JSON Web Tokens (header.payload.signature).
  {
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    repl: '[REDACTED_JWT]',
  },
  // Common provider API-key / access-key formats.
  {
    re: /\b(?:sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|ASIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{8,}|AIza[0-9A-Za-z_-]{20,})/g,
    repl: '[REDACTED_KEY]',
  },
  // Generic `key: value` / `key=value` secrets (password, secret, api_key,
  // access_key, authorization, auth, token). Anchored on `:`/`=` so ordinary
  // prose containing these words is left untouched.
  {
    re: /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|authorization|auth|token)(["']?\s*[:=]\s*["']?)\S+/gi,
    repl: '$1$2***',
  },
]);

/**
 * Mask credential-like substrings in a value so they are safe to print. Never
 * throws; non-strings are coerced first.
 *
 * @param {*} value - The value to scrub.
 * @returns {string} The value with credentials masked.
 */
function redactSecrets(value) {
  let str = coerceString(value);
  for (const rule of REDACTIONS) {
    str = str.replace(rule.re, rule.repl);
  }
  return str;
}

/**
 * Allow-list of run-metadata keys that {@link printSummary} may print. Anything
 * NOT in this list is ignored, so an operator can pass a rich `meta` object
 * (potentially containing secrets) without risking accidental disclosure.
 *
 * @constant
 * @type {ReadonlyArray<string>}
 */
const SAFE_META_KEYS = Object.freeze([
  'baseUrl',
  'apiBase',
  'apiPrefix',
  'frontendUrl',
  'requestTimeoutMs',
  'env',
  'node',
  'platform',
  'startedAt',
  'finishedAt',
]);

// ===========================================================================
// Phase 2 — writeJUnitXml(results, filePath)
// ===========================================================================

/**
 * Serialize the harness results to a JUnit XML report and write it to disk,
 * creating the destination directory (recursively) first.
 *
 * The document structure is:
 *   <testsuites tests failures skipped time>
 *     <testsuite name tests failures skipped time>
 *       <testcase classname name time/>                 (pass)
 *       <testcase classname name time>                  (fail)
 *         <failure message="...">...</failure>
 *       </testcase>
 *       <testcase classname name time>                  (skip)
 *         <skipped message="..."/>
 *       </testcase>
 *     </testsuite>
 *   </testsuites>
 * where every `time` is seconds (durationMs / 1000) and every interpolated
 * string is passed through {@link escapeXml}. Failure/skip detail is truncated
 * to {@link MESSAGE_MAX_CHARS}.
 *
 * @param {Array<object>} results - The harness results array. A non-array is
 *   treated as empty, producing a valid (empty) report.
 * @param {string} [filePath] - Destination path. Defaults to
 *   {@link module:@hms/security-tests/config.junitPath} when omitted/empty.
 * @returns {string} The path the report was written to (echoes `filePath` or
 *   the resolved default), convenient for logging by the caller.
 */
function writeJUnitXml(results, filePath) {
  const outPath = filePath || config.junitPath;
  const groups = groupBySuite(results);

  let totalTests = 0;
  let totalFailures = 0;
  let totalSkips = 0;
  let totalTimeMs = 0;
  for (const group of groups) {
    totalTests += group.tests;
    totalFailures += group.failures;
    totalSkips += group.skips;
    totalTimeMs += group.timeMs;
  }

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites tests="${totalTests}" failures="${totalFailures}" ` +
      `skipped="${totalSkips}" time="${formatSeconds(totalTimeMs)}">`,
  );

  for (const group of groups) {
    const suiteName = escapeXml(group.name);
    lines.push(
      `  <testsuite name="${suiteName}" tests="${group.tests}" ` +
        `failures="${group.failures}" skipped="${group.skips}" ` +
        `time="${formatSeconds(group.timeMs)}">`,
    );

    for (const testCase of group.cases) {
      const open =
        `    <testcase classname="${suiteName}" ` +
        `name="${escapeXml(testCase.name)}" ` +
        `time="${formatSeconds(testCase.durationMs)}"`;

      if (testCase.status === 'fail') {
        const detail = escapeXml(truncate(messageOf(testCase.raw)));
        lines.push(`${open}>`);
        lines.push(`      <failure message="${detail}">${detail}</failure>`);
        lines.push('    </testcase>');
      } else if (testCase.status === 'skip') {
        const reason = escapeXml(truncate(messageOf(testCase.raw)));
        lines.push(`${open}>`);
        lines.push(`      <skipped message="${reason}"/>`);
        lines.push('    </testcase>');
      } else {
        lines.push(`${open} />`);
      }
    }

    lines.push('  </testsuite>');
  }

  lines.push('</testsuites>');

  const xml = `${lines.join('\n')}\n`;

  // Create the (gitignored) results directory before writing so a fresh
  // checkout / CI runner does not fail on a missing `test-results/`.
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, xml, 'utf8');

  return outPath;
}

// ===========================================================================
// Phase 3 — printSummary(results, meta)
// ===========================================================================

/**
 * Whether ANSI color codes should be emitted. True only for an interactive TTY
 * and when the NO_COLOR convention (https://no-color.org) is not in effect, so
 * CI logs stay clean, colorless and grep-friendly.
 *
 * @constant
 * @type {boolean}
 */
const USE_COLOR =
  Boolean(process.stdout && process.stdout.isTTY) && !process.env.NO_COLOR;

/**
 * Wrap text in an ANSI SGR color code when color is enabled; otherwise return
 * the text unchanged. Keeps every call site colorization-agnostic.
 *
 * @param {string} code - The SGR parameter (e.g. `'31'` = red, `'1'` = bold).
 * @param {*} text - The text to (optionally) colorize.
 * @returns {string} The colorized or plain string.
 */
function paint(code, text) {
  const str = coerceString(text);
  return USE_COLOR ? `\x1b[${code}m${str}\x1b[0m` : str;
}

/**
 * Print the run-metadata header, restricted to the {@link SAFE_META_KEYS}
 * allow-list and scrubbed with {@link redactSecrets}. Does nothing when `meta`
 * is absent or not an object.
 *
 * @param {object} [meta] - Optional run metadata.
 * @returns {void}
 */
function printMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return;
  }
  for (const key of SAFE_META_KEYS) {
    const value = meta[key];
    if (value !== undefined && value !== null && value !== '') {
      console.log(`  ${key}: ${redactSecrets(value)}`);
    }
  }
}

/**
 * Print a concise, CI-friendly console report of the results: a header, an
 * optional (secret-safe) metadata block, per-suite counts, an explicit list of
 * failures and a condensed list of skips, and a one-line totals footer.
 *
 * Failures are written to STDERR (so they surface in CI error views); the rest
 * of the report goes to STDOUT. Secrets are never printed — see
 * {@link redactSecrets} and {@link SAFE_META_KEYS}.
 *
 * @param {Array<object>} results - The harness results array.
 * @param {object} [meta] - Optional run metadata (base URL, api base, ...).
 * @returns {void}
 */
function printSummary(results, meta) {
  const groups = groupBySuite(results);

  let totalTests = 0;
  let totalFailures = 0;
  let totalSkips = 0;
  let totalTimeMs = 0;
  for (const group of groups) {
    totalTests += group.tests;
    totalFailures += group.failures;
    totalSkips += group.skips;
    totalTimeMs += group.timeMs;
  }
  const totalPasses = totalTests - totalFailures - totalSkips;

  // Header + (secret-safe) metadata.
  console.log('');
  console.log(paint('1', '=== HMS Security Test Report ==='));
  printMeta(meta);

  // Per-suite breakdown.
  console.log('');
  console.log(paint('1', 'Suites:'));
  if (groups.length === 0) {
    console.log('  (no results)');
  } else {
    for (const group of groups) {
      console.log(
        `  ${group.name}: ${group.passes} passed, ${group.failures} failed, ` +
          `${group.skips} skipped (${formatSeconds(group.timeMs)}s)`,
      );
    }
  }

  // Explicit failure list (STDERR so CI error views pick it up).
  if (totalFailures > 0) {
    console.error('');
    console.error(paint('31', paint('1', `Failures (${totalFailures}):`)));
    for (const group of groups) {
      for (const testCase of group.cases) {
        if (testCase.status === 'fail') {
          const detail = redactSecrets(firstLine(messageOf(testCase.raw)));
          console.error(
            `  ${paint('31', '\u2717')} ${group.name} > ${testCase.name}: ${detail}`,
          );
        }
      }
    }
  }

  // Condensed skip list — skips are expected when the SUT is only partially
  // available, so surface them so operators know what was NOT verified.
  if (totalSkips > 0) {
    console.log('');
    console.log(paint('33', `Skipped (${totalSkips}):`));
    for (const group of groups) {
      for (const testCase of group.cases) {
        if (testCase.status === 'skip') {
          const reason = redactSecrets(firstLine(messageOf(testCase.raw)));
          console.log(`  - ${group.name} > ${testCase.name}: ${reason}`);
        }
      }
    }
  }

  // Totals footer.
  console.log('');
  console.log(
    `Total: ${totalTests} | Passed: ${totalPasses} | ` +
      `Failed: ${totalFailures} | Skipped: ${totalSkips} | ` +
      `Time: ${formatSeconds(totalTimeMs)}s`,
  );
}

// ===========================================================================
// Phase 4 — computeExitCode(results)
// ===========================================================================

/**
 * Compute the process exit code from the results.
 *
 * Returns `1` if ANY result failed, otherwise `0`. Skips do NOT fail the run:
 * the security suite is intentionally CI-friendly when the system-under-test is
 * only partially available, so unverified checks are skipped rather than
 * failed. (`run.js` handles the distinct "SUT entirely unreachable" hard-fail
 * case separately.)
 *
 * @param {Array<object>} results - The harness results array.
 * @returns {number} `1` when at least one failure exists, else `0`.
 */
function computeExitCode(results) {
  if (!Array.isArray(results)) {
    return 0;
  }
  const hasFailure = results.some(
    (result) =>
      result && typeof result === 'object' && result.status === 'fail',
  );
  return hasFailure ? 1 : 0;
}

// ===========================================================================
// Phase 5 — Exports
// ===========================================================================

module.exports = {
  writeJUnitXml,
  printSummary,
  computeExitCode,
  escapeXml,
};

