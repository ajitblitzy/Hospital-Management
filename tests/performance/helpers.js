// helpers.js — shared helpers for the HMS k6 performance tests.
//
// Provides: authentication (obtain a JWT before hitting protected routes), auth
// headers, a small fixture picker, and a SELF-CONTAINED end-of-test summary
// generator that writes CI-friendly JSON + JUnit XML into the gitignored
// `test-results/` directory (no remote jslib dependency, so it runs offline/hermetic).

import http from 'k6/http';
import { check } from 'k6';
import { ENDPOINTS, getCredentials, env } from './config.js';

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

// Extract a bearer token from a variety of plausible login response shapes.
// The backend is scaffolded in parallel, so we defensively probe common fields.
export function extractToken(body) {
  if (!body || typeof body !== 'object') return undefined;
  const d = body.data || {};
  const t = body.tokens || d.tokens || {};
  return (
    body.accessToken ||
    body.token ||
    body.access_token ||
    d.accessToken ||
    d.token ||
    d.access_token ||
    t.accessToken ||
    t.access ||
    t.token ||
    undefined
  );
}

// Obtain an access token ONCE (call from setup()). Returns { token, via }.
// Priority:
//   1. AUTH_TOKEN env  -> use directly (works for MFA/privileged roles obtained out-of-band)
//   2. POST /api/auth/login with PERF_AUTH_EMAIL/PERF_AUTH_PASSWORD, or the seeded
//      defaults for PERF_AUTH_ROLE (default 'receptionist' — a NON-MFA role, so the
//      login returns tokens directly rather than an MFA challenge).
export function authenticate() {
  const direct = env('AUTH_TOKEN', undefined);
  if (direct) {
    return { token: direct, via: 'env:AUTH_TOKEN' };
  }

  const roleKey = env('PERF_AUTH_ROLE', 'receptionist');
  let email = env('PERF_AUTH_EMAIL', undefined);
  let password = env('PERF_AUTH_PASSWORD', undefined);
  if (!email || !password) {
    const creds = getCredentials(roleKey);
    email = email || creds.email;
    password = password || creds.password;
  }

  const res = http.post(
    ENDPOINTS.login,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/login' } }
  );

  let body;
  try {
    body = res.json();
  } catch (e) {
    body = undefined;
  }
  const token = extractToken(body);

  check(res, {
    'login responded 2xx': (r) => r.status >= 200 && r.status < 300,
    'login returned an access token': () => !!token,
  });

  if (!token) {
    console.warn(
      `[auth] Could not obtain a token from ${ENDPOINTS.login} (status ${res.status}). ` +
        'Protected-route requests will likely return 401. If the target user requires MFA ' +
        '(admin/doctor), pass a pre-obtained token via  -e AUTH_TOKEN=<jwt>  or set ' +
        'PERF_AUTH_ROLE to a non-MFA seeded role.'
    );
  }
  return { token, via: `login:${email}` };
}

// Build request headers, adding Authorization when a token is present.
export function authHeaders(token, extra) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return Object.assign(headers, extra || {});
}

// Pick a pseudo-random element from an array (data selection only — not crypto).
export function pick(arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Self-contained end-of-test summary (JSON + JUnit XML + concise stdout text)
// ---------------------------------------------------------------------------

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// A k6 threshold result entry may be a boolean or an object { ok: boolean }.
export function thresholdPassed(entry) {
  if (typeof entry === 'boolean') return entry;
  if (entry && typeof entry === 'object') return entry.ok !== false;
  return true;
}

// Convert k6 summary `data` into JUnit XML: one <testcase> per metric threshold,
// marked <failure> when the SLA threshold was breached. Lets CI fail on SLA breach.
export function toJUnit(data, suiteName) {
  const metrics = (data && data.metrics) || {};
  const cases = [];
  let failures = 0;

  Object.keys(metrics).forEach((metricName) => {
    const th = metrics[metricName] && metrics[metricName].thresholds;
    if (!th) return;
    Object.keys(th).forEach((expr) => {
      const passed = thresholdPassed(th[expr]);
      const caseName = `${metricName} ${expr}`;
      if (passed) {
        cases.push(`    <testcase classname="${xmlEscape(suiteName)}" name="${xmlEscape(caseName)}" />`);
      } else {
        failures += 1;
        cases.push(
          `    <testcase classname="${xmlEscape(suiteName)}" name="${xmlEscape(caseName)}">\n` +
            `      <failure message="SLA threshold breached">${xmlEscape(caseName)}</failure>\n` +
            '    </testcase>'
        );
      }
    });
  });

  const total = cases.length;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<testsuites name="${xmlEscape(suiteName)}" tests="${total}" failures="${failures}">\n` +
    `  <testsuite name="${xmlEscape(suiteName)}" tests="${total}" failures="${failures}">\n` +
    (cases.length ? cases.join('\n') + '\n' : '') +
    '  </testsuite>\n' +
    '</testsuites>\n'
  );
}

// A compact, colorless text summary for stdout (key metrics + threshold pass/fail).
export function toText(data, suiteName) {
  const m = (data && data.metrics) || {};
  const lines = [];
  lines.push('');
  lines.push(`=== ${suiteName} — k6 summary ===`);

  const reqs = m.http_reqs && m.http_reqs.values;
  const dur = m.http_req_duration && m.http_req_duration.values;
  const failed = m.http_req_failed && m.http_req_failed.values;
  if (reqs) lines.push(`http_reqs        : ${reqs.count} total (${(reqs.rate || 0).toFixed(2)}/s)`);
  if (dur) {
    lines.push(
      `http_req_duration: avg=${(dur.avg || 0).toFixed(1)}ms ` +
        `p95=${(dur['p(95)'] || 0).toFixed(1)}ms max=${(dur.max || 0).toFixed(1)}ms`
    );
  }
  if (failed) lines.push(`http_req_failed  : ${((failed.rate || 0) * 100).toFixed(2)}%`);

  let anyFail = false;
  Object.keys(m).forEach((name) => {
    const th = m[name] && m[name].thresholds;
    if (!th) return;
    Object.keys(th).forEach((expr) => {
      const passed = thresholdPassed(th[expr]);
      if (!passed) anyFail = true;
      lines.push(`  [${passed ? 'PASS' : 'FAIL'}] ${name} ${expr}`);
    });
  });

  lines.push(anyFail ? '=== RESULT: THRESHOLDS FAILED ===' : '=== RESULT: all thresholds passed ===');
  lines.push('');
  return lines.join('\n');
}

// Assemble the handleSummary() return map: concise stdout + JSON + JUnit XML into
// the gitignored test-results/ directory (paths are relative to the run cwd, which
// is tests/performance/ — matching `cd tests/performance && k6 run <scenario>.js`).
export function summarize(data, suiteName) {
  const out = {};
  out.stdout = toText(data, suiteName);
  out[`test-results/${suiteName}-summary.json`] = JSON.stringify(data, null, 2);
  out[`test-results/${suiteName}-junit.xml`] = toJUnit(data, suiteName);
  return out;
}
