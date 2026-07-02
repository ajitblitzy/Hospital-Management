'use strict';

/**
 * @file tests/security/harness.js
 * @module @hms/security-tests/harness
 *
 * Minimal, ZERO-DEPENDENCY test registry + assertion library (CommonJS) for the
 * HMS `@hms/security-tests` suite. It intentionally replaces Jest/Mocha: the
 * security suite must stay self-contained so it is trivially runnable both
 * LOCALLY and in CI (`../../.github/`) with nothing but a Node.js runtime and
 * the sibling `./config` module — no `npm install` of a test framework, no
 * watchers, no global test binaries.
 *
 * WHAT THIS PROVIDES
 * ---------------------------------------------------------------------------
 *   1. A tiny SUITE/TEST registry — `suite(name, fn)` and `test(name, fn)` —
 *      where suites register their tests synchronously and tests may be async.
 *   2. A runtime `skip(reason)` mechanism (via {@link SkipError}) for GRACEFUL
 *      DEGRADATION: when a precondition is unmet at run time (no auth token
 *      available, the system-under-test returns 503, the network is
 *      unreachable, MFA cannot be completed, ...) a test SKIPS rather than
 *      FAILS. This is what lets the same suite run green in an offline lint-only
 *      CI stage and against a fully-seeded local stack.
 *   3. A rich, SECURITY-oriented assertion set — including the first-class
 *      {@link assertNoSensitiveDataLeak} (patient-data-privacy is the #1 risk
 *      area in the HMS QA strategy) and {@link assertErrorShape} for the API
 *      error contract used by input-validation probes.
 *   4. An async {@link run} that executes every registered test SEQUENTIALLY
 *      (never in parallel — hammering the gateway would trip rate limits and
 *      distort results) and returns a structured, machine-readable result set
 *      consumed by the suite's `reporter.js` (JUnit XML) and `run.js` entry
 *      point.
 *
 * DESIGN CONTRACT
 * ---------------------------------------------------------------------------
 *   - ZERO external dependencies. The ONLY `require` is the sibling `./config`
 *     module, used exclusively for `config.SENSITIVE_PATTERNS` (the leak
 *     signatures) and `config.verbose` (opt-in per-test logging).
 *   - Assertions throw a plain `Error` on failure; the error MESSAGE is the
 *     human-readable failure text surfaced by the runner and reporter.
 *   - The runner NEVER throws for a failing/broken test — it captures the
 *     outcome as structured data so a single bad test cannot abort the run.
 *
 * @see module:@hms/security-tests/config
 */

// The sole dependency: pattern list for the leak assertion + the verbose flag.
const config = require('./config');

// ===========================================================================
// Phase 1 — Suite / test registry
// ---------------------------------------------------------------------------
// A flat list of suites, each holding an ordered list of tests. `currentSuite`
// is a transient pointer that is ONLY non-null while a `suite(...)` body is
// executing, so nested `test(...)` calls know where to register themselves.
// ===========================================================================

/**
 * The registry of all declared suites. Each entry has the shape
 * `{ name: string, tests: Array<{ name: string, fn: Function }> }`.
 *
 * @type {Array<{ name: string, tests: Array<{ name: string, fn: Function }> }>}
 */
const suites = [];

/**
 * Pointer to the suite currently being populated. Non-null ONLY for the
 * synchronous duration of a {@link suite} callback; `null` at all other times.
 *
 * @type {?{ name: string, tests: Array<{ name: string, fn: Function }> }}
 */
let currentSuite = null;

/**
 * Declare a test suite and register its tests.
 *
 * The registration function `fn` is invoked SYNCHRONOUSLY so that every nested
 * {@link test} call executes while `currentSuite` points at this suite. A suite
 * that registers no tests is permitted (it simply contributes nothing to the
 * run). `currentSuite` is always cleared afterwards — even if `fn` throws
 * during registration — so a faulty suite body cannot corrupt the registry for
 * subsequently declared suites.
 *
 * @param {string} name - Human-readable suite name (used in result rows/logs).
 * @param {Function} fn - Synchronous callback that registers tests via {@link test}.
 * @returns {void}
 * @throws {TypeError} If `fn` is not a function.
 */
function suite(name, fn) {
  if (typeof fn !== 'function') {
    throw new TypeError(
      `suite("${name}") requires a registration function as its second argument`,
    );
  }
  const entry = { name: String(name), tests: [] };
  suites.push(entry);
  currentSuite = entry;
  try {
    fn();
  } finally {
    // Always clear the pointer, even if the suite body threw mid-registration.
    currentSuite = null;
  }
}

/**
 * Register a single test within the currently-open {@link suite}.
 *
 * The test function may be synchronous or async (it may return a Promise); the
 * runner awaits it regardless. To skip at run time, call {@link skip} from
 * inside `fn`.
 *
 * @param {string} name - Human-readable test name (unique within its suite by convention).
 * @param {Function} fn - The test body; sync or async. Throw to fail, {@link skip} to skip.
 * @returns {void}
 * @throws {Error} If called outside a {@link suite} body (no suite is open).
 * @throws {TypeError} If `fn` is not a function.
 */
function test(name, fn) {
  if (!currentSuite) {
    throw new Error(
      `test("${name}") must be called inside a suite() body; no suite is currently open`,
    );
  }
  if (typeof fn !== 'function') {
    throw new TypeError(
      `test("${name}") requires a test function as its second argument`,
    );
  }
  currentSuite.tests.push({ name: String(name), fn });
}

// ===========================================================================
// Phase 2 — Skip mechanism (graceful degradation)
// ---------------------------------------------------------------------------
// A dedicated error type lets the runner distinguish an intentional runtime
// SKIP (precondition unmet) from a genuine assertion FAILURE.
// ===========================================================================

/**
 * Error type thrown by {@link skip} to signal an intentional, non-failing skip.
 * The runner treats an escaping `SkipError` as `status: 'skip'`; any other
 * thrown value is a `status: 'fail'`.
 *
 * @augments Error
 */
class SkipError extends Error {
  /**
   * @param {string} [message] - Human-readable reason the test was skipped.
   */
  constructor(message) {
    super(message);
    this.name = 'SkipError';
  }
}

/**
 * Skip the currently-executing test with a reason. Call this from INSIDE a test
 * body when a precondition is unmet at run time (e.g. no token could be
 * obtained, a downstream dependency returned 503, the network is unreachable,
 * or MFA cannot be completed). It throws a {@link SkipError}, which the runner
 * records as a skip rather than a failure.
 *
 * @param {string} reason - Why the test is being skipped (surfaced in results).
 * @returns {never} Always throws.
 * @throws {SkipError} Always.
 */
function skip(reason) {
  throw new SkipError(reason);
}

// ===========================================================================
// Internal helpers — safe value formatting for assertion messages
// ---------------------------------------------------------------------------
// Render arbitrary values compactly and safely (never throws) so failure
// messages are readable. Not exported.
// ===========================================================================

/**
 * Render a value as a compact, human-readable string for use in assertion
 * failure messages. Strings are quoted (so whitespace/empty strings are
 * visible), numbers/booleans are shown verbatim, and objects are JSON-encoded
 * with a safe fallback for values that cannot be serialized (e.g. circular
 * references or `BigInt`).
 *
 * @param {*} value - Any value.
 * @returns {string} A readable representation that is safe to embed in a message.
 */
function format(value) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return `${value.toString()}n`;
  }
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (value === undefined) {
    return 'undefined';
  }
  try {
    return JSON.stringify(value);
  } catch {
    // Circular structure, BigInt inside an object, etc.
    return String(value);
  }
}

/**
 * Compose a final assertion message: when the caller supplied a `message`, the
 * computed `detail` (which always contains the observed/expected values) is
 * appended in parentheses so both the caller's context AND the concrete values
 * are present in the failure text.
 *
 * @param {string|undefined} message - The caller-supplied message, if any.
 * @param {string} detail - The computed detail describing the mismatch.
 * @returns {string} The combined message.
 */
function withDetail(message, detail) {
  return message ? `${message} (${detail})` : detail;
}

// ===========================================================================
// Phase 3 — Assertions
// ---------------------------------------------------------------------------
// Each assertion throws a plain Error whose message becomes the failure text.
// A caller-supplied `message` is optional; when omitted a descriptive default
// that includes the offending value(s) is generated.
// ===========================================================================

/**
 * Assert that `cond` is truthy.
 *
 * @param {*} cond - The condition to check.
 * @param {string} [message] - Failure message.
 * @returns {void}
 * @throws {Error} If `cond` is falsy.
 */
function assert(cond, message) {
  if (!cond) {
    throw new Error(message || 'Assertion failed: expected a truthy value');
  }
}

/**
 * Assert strict equality (`===`) between `actual` and `expected`. Both values
 * are always included in the failure message.
 *
 * @param {*} actual - The observed value.
 * @param {*} expected - The expected value.
 * @param {string} [message] - Failure message prefix.
 * @returns {void}
 * @throws {Error} If `actual !== expected`.
 */
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    const detail = `expected ${format(actual)} === ${format(expected)}`;
    throw new Error(withDetail(message, detail));
  }
}

/**
 * Assert strict inequality (`!==`) between `actual` and `expected`.
 *
 * @param {*} actual - The observed value.
 * @param {*} expected - The value it must NOT equal.
 * @param {string} [message] - Failure message prefix.
 * @returns {void}
 * @throws {Error} If `actual === expected`.
 */
function assertNotEqual(actual, expected, message) {
  if (actual === expected) {
    const detail = `expected ${format(actual)} !== ${format(expected)}`;
    throw new Error(withDetail(message, detail));
  }
}

/**
 * Assert that `haystack` includes `needle`. Works for both strings (substring)
 * and arrays (element membership). Any other `haystack` type fails.
 *
 * @param {string|Array<*>} haystack - The string or array to search.
 * @param {*} needle - The substring or element to look for.
 * @param {string} [message] - Failure message prefix.
 * @returns {void}
 * @throws {Error} If `haystack` is not a string/array or does not include `needle`.
 */
function assertIncludes(haystack, needle, message) {
  const searchable = typeof haystack === 'string' || Array.isArray(haystack);
  if (!searchable || !haystack.includes(needle)) {
    const detail = `expected ${format(haystack)} to include ${format(needle)}`;
    throw new Error(withDetail(message, detail));
  }
}

/**
 * Assert that the string form of `str` matches `regex`. A fresh `RegExp` copy
 * is used internally so a stateful (`/g`) pattern supplied by the caller is
 * neither mutated nor able to produce order-dependent results.
 *
 * @param {*} str - The subject (coerced to a string).
 * @param {RegExp|string} regex - The pattern to test.
 * @param {string} [message] - Failure message prefix.
 * @returns {void}
 * @throws {Error} If the subject does not match.
 */
function assertMatch(str, regex, message) {
  const matcher =
    regex instanceof RegExp
      ? new RegExp(regex.source, regex.flags)
      : new RegExp(String(regex));
  const subject = String(str);
  if (!matcher.test(subject)) {
    const detail = `expected ${format(subject)} to match ${regex}`;
    throw new Error(withDetail(message, detail));
  }
}

/**
 * Assert that `value` is one of the members of `arr` (`arr.includes(value)`).
 *
 * @param {*} value - The value to look for.
 * @param {Array<*>} arr - The set of allowed values.
 * @param {string} [message] - Failure message prefix.
 * @returns {void}
 * @throws {Error} If `arr` is not an array or does not contain `value`.
 */
function assertOneOf(value, arr, message) {
  if (!Array.isArray(arr) || !arr.includes(value)) {
    const detail = `expected ${format(value)} to be one of ${format(arr)}`;
    throw new Error(withDetail(message, detail));
  }
}

/**
 * Assert that an HTTP `status` is one of the allowed statuses in `arr`. A
 * specialization of {@link assertOneOf} whose message always shows the ACTUAL
 * status plus the allowed set — the most common security-test check.
 *
 * @param {number} status - The observed HTTP status code.
 * @param {Array<number>} arr - The allowed status codes.
 * @param {string} [message] - Failure message prefix.
 * @returns {void}
 * @throws {Error} If `status` is not in `arr`.
 */
function assertStatusIn(status, arr, message) {
  const allowed = Array.isArray(arr) ? arr : [];
  if (!allowed.includes(status)) {
    const detail = `expected HTTP status ${format(status)} to be one of [${allowed.join(', ')}]`;
    throw new Error(withDetail(message, detail));
  }
}

/**
 * Assert that an HTTP `status` is NOT one of the statuses in `arr` (e.g. assert
 * a protected route did not return `200`). The message shows the actual status.
 *
 * @param {number} status - The observed HTTP status code.
 * @param {Array<number>} arr - The disallowed status codes.
 * @param {string} [message] - Failure message prefix.
 * @returns {void}
 * @throws {Error} If `status` IS in `arr`.
 */
function assertNotStatusIn(status, arr, message) {
  const disallowed = Array.isArray(arr) ? arr : [];
  if (disallowed.includes(status)) {
    const detail = `expected HTTP status ${format(status)} NOT to be one of [${disallowed.join(', ')}]`;
    throw new Error(withDetail(message, detail));
  }
}

/**
 * Unconditionally fail the current test with `message`. Useful for
 * "unreachable" branches and for failing after a check that a request should
 * have thrown/redirected but did not.
 *
 * @param {string} [message] - The failure message.
 * @returns {never} Always throws.
 * @throws {Error} Always.
 */
function fail(message) {
  throw new Error(message || 'fail() was called');
}

/**
 * Assert that `text` does NOT leak any sensitive/credential material or leaked
 * internal error detail, as defined by `config.SENSITIVE_PATTERNS`.
 *
 * This enforces the patient-data-privacy rule at the top of the HMS QA risk
 * register: non-auth responses, error bodies, and logs must NEVER surface
 * password hashes/salts, MFA/TOTP secrets, private keys, raw SQL, ORM
 * internals, driver error codes, or JS stack frames. The auth login/MFA JWTs
 * (`accessToken`/`refreshToken`) are DELIBERATELY excluded from the pattern
 * list, so this assertion is safe to run against auth success payloads too.
 *
 * `text` is scanned as-is when it is a string; objects are `JSON.stringify`-d
 * first (with a safe fallback). A nullish `text` is treated as "no leak" so
 * callers can pass an absent body without a guard.
 *
 * @param {*} text - The response/error/log content to scan (string or object).
 * @param {string} context - A short label identifying WHAT was scanned; echoed
 *   into the failure message (e.g. the route or check name).
 * @returns {void}
 * @throws {Error} If any sensitive pattern matches; the message names the pattern.
 */
function assertNoSensitiveDataLeak(text, context) {
  // A nullish body cannot leak anything — accept it gracefully.
  if (text === null || text === undefined) {
    return;
  }

  let haystack;
  if (typeof text === 'string') {
    haystack = text;
  } else {
    try {
      haystack = JSON.stringify(text);
    } catch {
      // Circular structure or otherwise non-serializable — fall back safely.
      haystack = String(text);
    }
  }

  // `JSON.stringify` can yield `undefined` (e.g. for a bare function); nothing
  // to scan in that case.
  if (haystack === undefined || haystack === null || haystack === '') {
    return;
  }

  for (const pattern of config.SENSITIVE_PATTERNS) {
    // Use a fresh RegExp copy so a stateful (`/g`) pattern in the shared,
    // frozen list is never mutated and cannot yield order-dependent matches.
    const matcher =
      pattern instanceof RegExp
        ? new RegExp(pattern.source, pattern.flags)
        : new RegExp(String(pattern));
    if (matcher.test(haystack)) {
      throw new Error(
        'Sensitive data leak detected (' + context + '): matched ' + pattern,
      );
    }
  }
}

/**
 * Assert that `json` matches the HMS API error contract
 * `{ error: { code: string, message?: string, ... } }`. Used by
 * input-validation / negative-path checks to confirm the gateway returns a
 * well-formed, machine-readable error envelope rather than a bare string, an
 * HTML error page, or a leaked stack trace.
 *
 * @param {*} json - The parsed JSON response body.
 * @param {string} [message] - Failure message prefix.
 * @returns {void}
 * @throws {Error} If `json` is not an object with an `error.code` string.
 */
function assertErrorShape(json, message) {
  const ok =
    json !== null &&
    typeof json === 'object' &&
    json.error !== null &&
    typeof json.error === 'object' &&
    typeof json.error.code === 'string';
  if (!ok) {
    const detail = `expected API error contract { error: { code: string, ... } } but received ${format(json)}`;
    throw new Error(withDetail(message, detail));
  }
}

// ===========================================================================
// Phase 4 — Runner
// ---------------------------------------------------------------------------
// Executes every registered test SEQUENTIALLY (never concurrently) so the suite
// respects the gateway's rate limits and produces deterministic, ordered
// results. Nothing here throws for a failing test — every outcome is captured
// as a structured row consumed by `reporter.js` / `run.js`.
// ===========================================================================

/**
 * Reduce an array of per-test result rows into aggregate counts + total time.
 * Key order (`total, passed, failed, skipped, durationMs`) is stable so the
 * printed summary is predictable across runs.
 *
 * @param {Array<{ status: string, durationMs: number }>} results - Result rows.
 * @returns {{ total: number, passed: number, failed: number, skipped: number, durationMs: number }}
 *   Aggregate summary.
 */
function computeSummary(results) {
  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
  };
  for (const result of results) {
    if (result.status === 'pass') {
      summary.passed += 1;
    } else if (result.status === 'fail') {
      summary.failed += 1;
    } else if (result.status === 'skip') {
      summary.skipped += 1;
    }
    summary.durationMs += result.durationMs || 0;
  }
  return summary;
}

/**
 * Execute every registered test, in declaration order, ONE AT A TIME.
 *
 * Each test is awaited (async test bodies are supported). Outcomes are mapped
 * to a stable `status`:
 *   - `'pass'`  — the body resolved without throwing.
 *   - `'skip'`  — the body threw a {@link SkipError} (precondition unmet).
 *   - `'fail'`  — the body threw anything else (assertion or unexpected error).
 *
 * The returned object is the structured result set consumed by the suite's
 * reporter (JUnit XML) and CLI entry point.
 *
 * @param {object} [options] - Optional run options.
 * @param {boolean} [options.verbose] - Override `config.verbose`; when truthy a
 *   `PASS/FAIL/SKIP <suite> > <name>` line is logged per test.
 * @returns {Promise<{
 *   results: Array<{ suite: string, name: string, status: string, error: (string|null), durationMs: number }>,
 *   summary: { total: number, passed: number, failed: number, skipped: number, durationMs: number }
 * }>} The per-test rows and their aggregate summary.
 */
async function run(options = {}) {
  const results = [];
  const verbose =
    options && options.verbose !== undefined
      ? Boolean(options.verbose)
      : config.verbose;

  for (const currentSuiteEntry of suites) {
    for (const testCase of currentSuiteEntry.tests) {
      const start = Date.now();
      let status;
      let error;
      try {
        await testCase.fn();
        status = 'pass';
        error = null;
      } catch (e) {
        if (e instanceof SkipError) {
          status = 'skip';
          error = e.message;
        } else {
          status = 'fail';
          // Prefer the concise message for real Errors; stringify anything else.
          error = e && e.stack ? e.message : String(e);
        }
      }
      const durationMs = Date.now() - start;
      results.push({
        suite: currentSuiteEntry.name,
        name: testCase.name,
        status,
        error,
        durationMs,
      });
      if (verbose) {
        const line = `${status.toUpperCase()} ${currentSuiteEntry.name} > ${testCase.name}`;
        console.log(error ? `${line} :: ${error}` : line);
      }
    }
  }

  return { results, summary: computeSummary(results) };
}

/**
 * Clear the entire suite registry and reset the current-suite pointer. Intended
 * for tests OF the harness itself (and for re-running the registry in a single
 * process); production runs invoke `require` once and never need it.
 *
 * @returns {void}
 */
function reset() {
  // Mutate in place so external references to the array stay valid.
  suites.length = 0;
  currentSuite = null;
}

/**
 * Return the live suite registry for introspection (e.g. counting registered
 * tests before a run). The returned array is the internal registry itself, so
 * callers must treat it as read-only.
 *
 * @returns {Array<{ name: string, tests: Array<{ name: string, fn: Function }> }>}
 *   The suite registry.
 */
function getSuites() {
  return suites;
}

// ===========================================================================
// Phase 5 — Public API
// ===========================================================================

module.exports = {
  // Registry + runner
  suite,
  test,
  skip,
  run,
  reset,
  getSuites,
  SkipError,
  // Assertions
  assert,
  assertEqual,
  assertNotEqual,
  assertIncludes,
  assertMatch,
  assertOneOf,
  assertStatusIn,
  assertNotStatusIn,
  assertNoSensitiveDataLeak,
  assertErrorShape,
  fail,
};
