'use strict';

/**
 * @hms/test-fixtures — Seeded role login credentials.
 *
 * PATIENT-DATA PRIVACY / SECURITY (FIRST-CLASS):
 *   SYNTHETIC / SEEDED, DEVELOPMENT-ONLY data. These map 1:1 to the idempotent
 *   demo users created by `../../database/seeds/04_demo_users.sql`. NEVER put
 *   real patient PII or production credentials in this repository.
 *
 * Credentials are supplied to the test suites via ENVIRONMENT VARIABLES and
 * fall back to the well-known local-dev defaults below (which match the seed
 * file) so the suites work out-of-the-box against a freshly seeded local stack:
 *   TEST_<ROLE>_EMAIL     e.g. TEST_ADMIN_EMAIL
 *   TEST_<ROLE>_PASSWORD  e.g. TEST_ADMIN_PASSWORD
 *   TEST_DEFAULT_PASSWORD overrides the shared default password for every role.
 *
 * NOTE: env vars are read at import time — set them (dotenv / CI env) BEFORE
 * requiring this module.
 */

// Well-known LOCAL-DEV password shared by every seeded demo account. This is the
// same value documented in database/seeds/04_demo_users.sql — it is NOT a secret
// and MUST NOT be used in production.
const DEFAULT_PASSWORD = process.env.TEST_DEFAULT_PASSWORD || 'ChangeMe123!';

// One entry per HMS role (8 roles from 01_Product_Vision_and_Scope), aligned
// exactly with the seeded demo users (04_demo_users.sql): username, email, and
// whether MFA is enabled (privileged users: Hospital Administrator + Doctor).
const ROLE_DEFINITIONS = [
  { key: 'admin',         role: 'Hospital Administrator', envPrefix: 'TEST_ADMIN',        username: 'admin',       defaultEmail: 'admin@hms.local',        mfaEnabled: true,  privileged: true  },
  { key: 'doctor',        role: 'Doctor',                 envPrefix: 'TEST_DOCTOR',       username: 'dr.smith',    defaultEmail: 'doctor@hms.local',       mfaEnabled: true,  privileged: true  },
  { key: 'nurse',         role: 'Nurse',                  envPrefix: 'TEST_NURSE',        username: 'nurse.joy',   defaultEmail: 'nurse@hms.local',        mfaEnabled: false, privileged: false },
  { key: 'receptionist',  role: 'Receptionist',           envPrefix: 'TEST_RECEPTIONIST', username: 'reception',   defaultEmail: 'receptionist@hms.local', mfaEnabled: false, privileged: false },
  { key: 'labTechnician', role: 'Lab Technician',         envPrefix: 'TEST_LABTECH',      username: 'labtech',     defaultEmail: 'labtech@hms.local',      mfaEnabled: false, privileged: false },
  { key: 'pharmacist',    role: 'Pharmacist',             envPrefix: 'TEST_PHARMACIST',   username: 'pharmacist',  defaultEmail: 'pharmacist@hms.local',   mfaEnabled: false, privileged: false },
  { key: 'patient',       role: 'Patient',                envPrefix: 'TEST_PATIENT',      username: 'patient.doe', defaultEmail: 'patient@hms.local',      mfaEnabled: false, privileged: false },
  { key: 'insurance',     role: 'Insurance Coordinator',  envPrefix: 'TEST_INSURANCE',    username: 'insurance',   defaultEmail: 'insurance@hms.local',    mfaEnabled: false, privileged: false },
];

function buildCredential(def) {
  return {
    key: def.key,
    role: def.role,
    username: def.username,
    email: process.env[`${def.envPrefix}_EMAIL`] || def.defaultEmail,
    password: process.env[`${def.envPrefix}_PASSWORD`] || DEFAULT_PASSWORD,
    mfaEnabled: def.mfaEnabled,
    privileged: def.privileged,
    envEmailVar: `${def.envPrefix}_EMAIL`,
    envPasswordVar: `${def.envPrefix}_PASSWORD`,
  };
}

// Map of roleKey -> resolved credential object.
const credentials = ROLE_DEFINITIONS.reduce((acc, def) => {
  acc[def.key] = buildCredential(def);
  return acc;
}, {});

// Ordered list of the valid role keys.
const roles = ROLE_DEFINITIONS.map((def) => def.key);

/**
 * Return the resolved credential for a role key (e.g. 'admin', 'doctor').
 * Throws a helpful error for unknown keys.
 */
function getCredentials(roleKey) {
  const cred = credentials[roleKey];
  if (!cred) {
    throw new Error(
      `[@hms/test-fixtures] Unknown role key "${roleKey}". Valid keys: ${roles.join(', ')}`
    );
  }
  return cred;
}

module.exports = { credentials, getCredentials, roles, DEFAULT_PASSWORD };
