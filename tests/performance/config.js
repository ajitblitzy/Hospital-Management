// config.js — shared configuration for the HMS k6 performance tests.
//
// RUNTIME NOTE: k6 runs on its own JavaScript runtime (goja), NOT Node.js. It uses
// ES modules (import/export) and reads environment variables via the `__ENV` global
// (there is no `process.env`). For this reason the k6 suite does NOT `require()` the
// CommonJS `@hms/test-fixtures` package or its `credentials.js` (which reads
// process.env); instead it (a) reads the shared synthetic JSON datasets directly with
// k6's `open()` and (b) MIRRORS the fixtures credentials env-var contract below using
// `__ENV`, with the SAME variable names and the SAME seeded defaults.
//
// PATIENT-DATA PRIVACY (FIRST-CLASS): only synthetic/seeded data and env-supplied
// credentials are used here — never real patient PII or production secrets.

// ---------------------------------------------------------------------------
// Environment helpers (k6 exposes env vars on the __ENV global object)
// ---------------------------------------------------------------------------
export function env(name, fallback) {
  const v = __ENV[name];
  return v === undefined || v === '' ? fallback : v;
}
export function envInt(name, fallback) {
  const raw = env(name, undefined);
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}
export function envFloat(name, fallback) {
  const raw = env(name, undefined);
  if (raw === undefined) return fallback;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? fallback : n;
}
export function envBool(name, fallback) {
  const raw = env(name, undefined);
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

// ---------------------------------------------------------------------------
// Base URLs — everything defaults to the local docker-compose stack.
//   GATEWAY_URL : gateway host root; used for the infra `/health` endpoint
//                 (health is NOT under the /api prefix).
//   API_BASE_URL: application traffic base — the gateway `/api` prefix.
// Override either via env for deployed environments.
// ---------------------------------------------------------------------------
export const GATEWAY_URL = env('GATEWAY_URL', 'http://localhost:8080').replace(/\/+$/, '');
export const API_BASE_URL = env('API_BASE_URL', `${GATEWAY_URL}/api`).replace(/\/+$/, '');
export const HEALTH_URL = env('HEALTH_URL', `${GATEWAY_URL}/health`);

// Application endpoints (all go through the gateway /api prefix).
export const ENDPOINTS = {
  login: `${API_BASE_URL}/auth/login`,
  refresh: `${API_BASE_URL}/auth/refresh`,
  billing: `${API_BASE_URL}/billing`,
  appointments: `${API_BASE_URL}/appointments`,
  patients: `${API_BASE_URL}/patients`,
};

// Backend service ports (informational; optional direct per-service /health probes).
export const SERVICE_PORTS = {
  gateway: 8080,
  auth: 4001,
  patient: 4002,
  appointment: 4003,
  emr: 4004,
  billing: 4005,
  pharmacy: 4006,
  laboratory: 4007,
  inventory: 4008,
  reports: 4009,
};

// ---------------------------------------------------------------------------
// Seeded role credentials — mirrors the @hms/test-fixtures credentials contract.
// Same env-var names (TEST_<PREFIX>_EMAIL / TEST_<PREFIX>_PASSWORD,
// TEST_DEFAULT_PASSWORD) and same seeded defaults as tests/fixtures/credentials.js
// and database/seeds/04_demo_users.sql.
// ---------------------------------------------------------------------------
export const DEFAULT_PASSWORD = env('TEST_DEFAULT_PASSWORD', 'ChangeMe123!');

const SEEDED_ROLES = {
  admin: { prefix: 'TEST_ADMIN', email: 'admin@hms.local', privileged: true, mfaEnabled: true },
  doctor: { prefix: 'TEST_DOCTOR', email: 'doctor@hms.local', privileged: true, mfaEnabled: true },
  nurse: { prefix: 'TEST_NURSE', email: 'nurse@hms.local', privileged: false, mfaEnabled: false },
  receptionist: { prefix: 'TEST_RECEPTIONIST', email: 'receptionist@hms.local', privileged: false, mfaEnabled: false },
  labTechnician: { prefix: 'TEST_LABTECH', email: 'labtech@hms.local', privileged: false, mfaEnabled: false },
  pharmacist: { prefix: 'TEST_PHARMACIST', email: 'pharmacist@hms.local', privileged: false, mfaEnabled: false },
  patient: { prefix: 'TEST_PATIENT', email: 'patient@hms.local', privileged: false, mfaEnabled: false },
  insurance: { prefix: 'TEST_INSURANCE', email: 'insurance@hms.local', privileged: false, mfaEnabled: false },
};

export const ROLE_KEYS = Object.keys(SEEDED_ROLES);

// Resolve credentials for a seeded role key, honoring env overrides.
export function getCredentials(roleKey) {
  const base = SEEDED_ROLES[roleKey];
  if (!base) {
    throw new Error(`Unknown role '${roleKey}'. Known roles: ${ROLE_KEYS.join(', ')}`);
  }
  return {
    roleKey,
    email: env(`${base.prefix}_EMAIL`, base.email),
    password: env(`${base.prefix}_PASSWORD`, DEFAULT_PASSWORD),
    privileged: base.privileged,
    mfaEnabled: base.mfaEnabled,
  };
}

// ---------------------------------------------------------------------------
// SLA thresholds per risk area (p95 latency in ms, max error rate as a fraction).
// Override any value via env for stricter/looser gates per environment.
// ---------------------------------------------------------------------------
export const SLA = {
  billing: {
    p95: envInt('BILLING_P95_MS', 800),
    errorRate: envFloat('BILLING_ERROR_RATE', 0.01),
  },
  appointment: {
    p95: envInt('APPT_P95_MS', 1000),
    errorRate: envFloat('APPT_ERROR_RATE', 0.01),
  },
  health: {
    p95: envInt('HEALTH_P95_MS', 200),
    errorRate: envFloat('HEALTH_ERROR_RATE', 0.001),
  },
};

// ---------------------------------------------------------------------------
// Load profiles. MODE selects a shape; VUS/DURATION/MAX_VUS fine-tune it.
//   smoke  (default): a short, light single stage — safe for CI on every run.
//   load            : ramp up, sustain, ramp down at moderate concurrency.
//   stress          : push toward MAX_VUS to find breaking points.
// ---------------------------------------------------------------------------
export const MODE = env('MODE', 'smoke');

export function stagesFor(_kind) {
  if (MODE === 'load') {
    const target = envInt('VUS', 20);
    return [
      { duration: env('RAMP_UP', '30s'), target },
      { duration: env('SUSTAIN', '1m'), target },
      { duration: env('RAMP_DOWN', '30s'), target: 0 },
    ];
  }
  if (MODE === 'stress') {
    const max = envInt('MAX_VUS', 100);
    return [
      { duration: '30s', target: envInt('VUS', 20) },
      { duration: '1m', target: max },
      { duration: '1m', target: max },
      { duration: '30s', target: 0 },
    ];
  }
  // smoke (default)
  return [{ duration: env('DURATION', '30s'), target: envInt('VUS', 5) }];
}
