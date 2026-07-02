'use strict';

/**
 * Auth-service canonical test fixtures.
 *
 * Static, deterministic, reusable sample data for the auth-service Jest suite
 * (both unit and integration specs) and the seed for `factories.js`.
 *
 * Design contract:
 *   - Pure data only: NO business assertions and NO logic live in this module.
 *   - SAFE by construction: obviously-fake values only. Emails use the reserved
 *     `@hms.test` domain, names are generic ("Test Doctor"), and there is NO real
 *     PII or secret anywhere. A fake test password literal appears exclusively
 *     inside `LOGIN_REQUEST` (it models user *input*, never a stored credential).
 *   - Credential-free users: user objects NEVER carry `passwordHash`,
 *     `password_hash`, `mfaSecret`, `password`, or any secret/salt field. This is
 *     a hard security rule grounded in the QA strategy's "Patient data privacy"
 *     risk area — only safe, API-shaped user fields are exposed.
 *   - Deterministic: fixed UUID-looking string ids and fixed ISO timestamps. No
 *     `Date.now()`, no `Math.random()`, no `crypto` — every value is a literal.
 *   - Immutable: every exported structure is deep-frozen so a test can never
 *     mutate shared canonical state. `factories.js` returns fresh, override-able
 *     copies for the cases that need mutation.
 *
 * Plain CommonJS: no ESM, no Jest globals. Filename is `fixtures.js` so the Jest
 * runner never treats it as a spec.
 *
 * @module tests/helpers/fixtures
 */

/**
 * Recursively freeze a value and every nested object/array so the canonical
 * fixtures cannot be mutated by a test. Primitives and already-frozen objects
 * are returned untouched. No external dependencies.
 *
 * @template T
 * @param {T} value - The value (object, array, or primitive) to deep-freeze.
 * @returns {T} The same reference, deeply frozen when it is an object.
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.keys(value).forEach((key) => {
      deepFreeze(value[key]);
    });
    Object.freeze(value);
  }
  return value;
}

/*
 * Deterministic literal constants shared across the fixtures. Keeping them here
 * (rather than inlining) guarantees related records line up while remaining
 * fully static — there is no runtime clock or randomness involved.
 */
const CREATED_AT = '2024-01-01T00:00:00.000Z';
const UPDATED_AT = '2024-06-01T00:00:00.000Z';
const SESSION_CREATED_AT = '2024-01-01T00:00:00.000Z';
// Far-future so "session is still valid" assertions are stable and clock-free.
const SESSION_EXPIRES_AT = '2099-01-01T00:00:00.000Z';
// Deterministic MFA challenge token reused by the challenge + verify payloads.
const MFA_TOKEN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/*
 * ---------------------------------------------------------------------------
 * Roles
 * ---------------------------------------------------------------------------
 * These MUST stay in sync with `@hms/shared` `ROLES`. They are intentionally
 * duplicated here as plain string literals to avoid load-order / dependency
 * coupling in the test helpers (the shared module is not a dependency of this
 * file).
 */

/**
 * Convenience map of role keys to their canonical display strings. Keys mirror
 * the `@hms/shared` `ROLES` keys; values mirror the display strings.
 *
 * @type {Readonly<Record<string, string>>}
 */
const ROLES = {
  HOSPITAL_ADMINISTRATOR: 'Hospital Administrator',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  RECEPTIONIST: 'Receptionist',
  LAB_TECHNICIAN: 'Lab Technician',
  PHARMACIST: 'Pharmacist',
  PATIENT: 'Patient',
  INSURANCE_COORDINATOR: 'Insurance Coordinator',
};

/**
 * The eight canonical HMS role display strings, in their exact order and
 * spelling. Mirrors `@hms/shared` `ROLES` values.
 *
 * @type {ReadonlyArray<string>}
 */
const ROLE_NAMES = [
  'Hospital Administrator',
  'Doctor',
  'Nurse',
  'Receptionist',
  'Lab Technician',
  'Pharmacist',
  'Patient',
  'Insurance Coordinator',
];

/*
 * ---------------------------------------------------------------------------
 * Users
 * ---------------------------------------------------------------------------
 * SECURITY (Patient-data-privacy risk area): every user below exposes ONLY
 * safe, API-shaped fields. Users intentionally carry NO credential fields
 * whatsoever — never `passwordHash`, `password_hash`, `mfaSecret`, `password`,
 * or any secret/salt. The single `password` literal in this file lives in
 * `LOGIN_REQUEST` below and models fake user input, not a stored credential.
 *
 * `mfaEnabled` is `true` only for privileged roles (Hospital Administrator,
 * Doctor) to reflect the "multi-factor authentication for privileged users"
 * requirement; it is `false` for the rest.
 */

/**
 * Safe sample users keyed by role for ergonomic access (e.g. `USERS.doctor`).
 *
 * @type {Readonly<Record<string, Readonly<object>>>}
 */
const USERS = {
  admin: {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin@hms.test',
    firstName: 'Test',
    lastName: 'Administrator',
    role: ROLES.HOSPITAL_ADMINISTRATOR,
    status: 'active',
    mfaEnabled: true,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  doctor: {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'doctor@hms.test',
    firstName: 'Test',
    lastName: 'Doctor',
    role: ROLES.DOCTOR,
    status: 'active',
    mfaEnabled: true,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  nurse: {
    id: '00000000-0000-0000-0000-000000000003',
    email: 'nurse@hms.test',
    firstName: 'Test',
    lastName: 'Nurse',
    role: ROLES.NURSE,
    status: 'active',
    mfaEnabled: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  receptionist: {
    id: '00000000-0000-0000-0000-000000000004',
    email: 'receptionist@hms.test',
    firstName: 'Test',
    lastName: 'Receptionist',
    role: ROLES.RECEPTIONIST,
    status: 'active',
    mfaEnabled: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  labTechnician: {
    id: '00000000-0000-0000-0000-000000000005',
    email: 'labtech@hms.test',
    firstName: 'Test',
    lastName: 'Technician',
    role: ROLES.LAB_TECHNICIAN,
    status: 'active',
    mfaEnabled: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  pharmacist: {
    id: '00000000-0000-0000-0000-000000000006',
    email: 'pharmacist@hms.test',
    firstName: 'Test',
    lastName: 'Pharmacist',
    role: ROLES.PHARMACIST,
    status: 'active',
    mfaEnabled: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  patient: {
    id: '00000000-0000-0000-0000-000000000007',
    email: 'patient@hms.test',
    firstName: 'Test',
    lastName: 'Patient',
    role: ROLES.PATIENT,
    status: 'active',
    mfaEnabled: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
  insuranceCoordinator: {
    id: '00000000-0000-0000-0000-000000000008',
    email: 'insurance@hms.test',
    firstName: 'Test',
    lastName: 'Coordinator',
    role: ROLES.INSURANCE_COORDINATOR,
    status: 'active',
    mfaEnabled: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  },
};

/**
 * Flat list of the sample users for iteration-style tests.
 *
 * @type {ReadonlyArray<Readonly<object>>}
 */
const USER_LIST = Object.keys(USERS).map((key) => USERS[key]);

/*
 * ---------------------------------------------------------------------------
 * Permissions
 * ---------------------------------------------------------------------------
 * Generic sample permissions using a `resource:action` naming style. Ids are
 * deterministic; descriptions are human-readable.
 */

/**
 * Sample permission records.
 *
 * @type {ReadonlyArray<Readonly<{ id: string, name: string, description: string }>>}
 */
const PERMISSIONS = [
  {
    id: '10000000-0000-0000-0000-000000000001',
    name: 'patients:read',
    description: 'Read patient records',
  },
  {
    id: '10000000-0000-0000-0000-000000000002',
    name: 'patients:write',
    description: 'Create or update patient records',
  },
  {
    id: '10000000-0000-0000-0000-000000000003',
    name: 'prescriptions:write',
    description: 'Create or update prescriptions',
  },
  {
    id: '10000000-0000-0000-0000-000000000004',
    name: 'invoices:read',
    description: 'Read billing invoices',
  },
  {
    id: '10000000-0000-0000-0000-000000000005',
    name: 'appointments:read',
    description: 'Read appointment schedules',
  },
];

/*
 * ---------------------------------------------------------------------------
 * Request payloads & MFA challenge
 * ---------------------------------------------------------------------------
 * Request-shaped inputs consumed by controller/route specs. The `password`
 * below is a clearly-fake test literal representing user input only.
 */

/**
 * Login request body. `password` is fake test input, not a stored secret.
 *
 * @type {Readonly<{ email: string, password: string }>}
 */
const LOGIN_REQUEST = {
  email: 'doctor@hms.test',
  password: 'Test1234!',
};

/**
 * MFA verification request body. `otp` is a six-digit code consistent with
 * `MFA.DIGITS = 6`.
 *
 * @type {Readonly<{ mfaToken: string, otp: string }>}
 */
const MFA_VERIFY_REQUEST = {
  mfaToken: MFA_TOKEN,
  otp: '123456',
};

/**
 * Refresh-token request body.
 *
 * @type {Readonly<{ refreshToken: string }>}
 */
const REFRESH_REQUEST = {
  refreshToken: 'test.refresh.token',
};

/**
 * Response payload shape returned when MFA is required at login.
 *
 * @type {Readonly<{ mfaRequired: boolean, mfaToken: string }>}
 */
const MFA_CHALLENGE = {
  mfaRequired: true,
  mfaToken: MFA_TOKEN,
};

// Convenience aliases matching the naming used by some specs.
const loginPayload = LOGIN_REQUEST;
const mfaPayload = MFA_VERIFY_REQUEST;
const refreshPayload = REFRESH_REQUEST;

/*
 * ---------------------------------------------------------------------------
 * Sessions
 * ---------------------------------------------------------------------------
 * Sample rows mirroring the `sessions` table concept, keyed by role for
 * ergonomic access. `expiresAt` is a fixed far-future timestamp so validity
 * checks stay deterministic.
 */

/**
 * Sample session records keyed by role.
 *
 * @type {Readonly<Record<string, Readonly<object>>>}
 */
const SESSIONS = {
  admin: {
    id: '20000000-0000-0000-0000-000000000001',
    userId: USERS.admin.id,
    role: ROLES.HOSPITAL_ADMINISTRATOR,
    createdAt: SESSION_CREATED_AT,
    expiresAt: SESSION_EXPIRES_AT,
    ip: '127.0.0.1',
    userAgent: 'jest-test-agent',
  },
  doctor: {
    id: '20000000-0000-0000-0000-000000000002',
    userId: USERS.doctor.id,
    role: ROLES.DOCTOR,
    createdAt: SESSION_CREATED_AT,
    expiresAt: SESSION_EXPIRES_AT,
    ip: '127.0.0.1',
    userAgent: 'jest-test-agent',
  },
  patient: {
    id: '20000000-0000-0000-0000-000000000003',
    userId: USERS.patient.id,
    role: ROLES.PATIENT,
    createdAt: SESSION_CREATED_AT,
    expiresAt: SESSION_EXPIRES_AT,
    ip: '127.0.0.1',
    userAgent: 'jest-test-agent',
  },
};

/*
 * ---------------------------------------------------------------------------
 * Audit-log entries
 * ---------------------------------------------------------------------------
 * Sample entries matching the shared `auditLog` input shape. `outcome` is one
 * of 'success' | 'failure' | 'denied' (mirrors `AUDIT_OUTCOMES`). The `action`
 * strings are representative; when used in assertions they should align with
 * `src/constants.js` `AUDIT_ACTIONS`.
 */

/**
 * Sample audit-log entries covering success, failure, and denied outcomes.
 *
 * @type {ReadonlyArray<Readonly<object>>}
 */
const AUDIT_ENTRIES = [
  {
    action: 'auth.login.success',
    actor: USERS.doctor.id,
    role: ROLES.DOCTOR,
    resource: 'auth/session',
    outcome: 'success',
    ip: '127.0.0.1',
    userAgent: 'jest-test-agent',
    requestId: '30000000-0000-0000-0000-000000000001',
    details: { mfa: true },
  },
  {
    action: 'auth.login.failure',
    actor: 'unknown@hms.test',
    role: null,
    resource: 'auth/session',
    outcome: 'failure',
    ip: '127.0.0.1',
    userAgent: 'jest-test-agent',
    requestId: '30000000-0000-0000-0000-000000000002',
    details: { reason: 'invalid_credentials' },
  },
  {
    action: 'authz.access.denied',
    actor: USERS.patient.id,
    role: ROLES.PATIENT,
    resource: 'patients:write',
    outcome: 'denied',
    ip: '127.0.0.1',
    userAgent: 'jest-test-agent',
    requestId: '30000000-0000-0000-0000-000000000003',
    details: { requiredPermission: 'patients:write' },
  },
];

/*
 * ---------------------------------------------------------------------------
 * Freeze & export
 * ---------------------------------------------------------------------------
 * Deep-freeze every exported structure so shared canonical state can never be
 * mutated by a test. Factories (in `factories.js`) return fresh copies for the
 * cases that need to mutate data.
 */
deepFreeze(ROLES);
deepFreeze(ROLE_NAMES);
deepFreeze(USERS);
deepFreeze(USER_LIST);
deepFreeze(PERMISSIONS);
deepFreeze(LOGIN_REQUEST);
deepFreeze(MFA_VERIFY_REQUEST);
deepFreeze(REFRESH_REQUEST);
deepFreeze(MFA_CHALLENGE);
deepFreeze(SESSIONS);
deepFreeze(AUDIT_ENTRIES);

module.exports = {
  ROLES,
  ROLE_NAMES,
  USERS,
  USER_LIST,
  PERMISSIONS,
  LOGIN_REQUEST,
  MFA_VERIFY_REQUEST,
  REFRESH_REQUEST,
  MFA_CHALLENGE,
  SESSIONS,
  AUDIT_ENTRIES,
  // Convenience aliases used by some specs.
  loginPayload,
  mfaPayload,
  refreshPayload,
};
