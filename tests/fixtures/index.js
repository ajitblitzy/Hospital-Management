'use strict';

/**
 * @hms/test-fixtures — shared, SYNTHETIC test data + SEEDED login credentials
 * for the Hospital Management System repository-level test suites
 * (../e2e, ../api, ../performance, ../security).
 *
 * PATIENT-DATA PRIVACY (FIRST-CLASS): every value below is fabricated /
 * seeded and for local development & testing ONLY. Never introduce real
 * patient PII or production credentials.
 *
 * This is the single aggregated entry point. Consumers may also require the
 * individual JSON datasets directly (e.g. `require('@hms/test-fixtures/patients.json')`).
 */

const credentialsModule = require('./credentials.js');

// Synthetic entity datasets modeling the 8 core ERD entities
// (04_Database_Design_and_ERD). Field names use the DB snake_case convention;
// cross-entity references use natural/business keys (patient_number,
// employee_code, department name, appointment_number, admission_number).
const patients = require('./patients.json');
const doctors = require('./doctors.json');
const appointments = require('./appointments.json');
const prescriptions = require('./prescriptions.json');
const invoices = require('./invoices.json');
const laboratoryReports = require('./laboratory_reports.json');
const admissions = require('./admissions.json');
const departments = require('./departments.json');

// Map of entity name -> dataset array.
const entities = {
  patients,
  doctors,
  appointments,
  prescriptions,
  invoices,
  laboratoryReports,
  admissions,
  departments,
};

/**
 * Return a synthetic entity dataset by name (e.g. 'patients', 'laboratoryReports').
 * Throws a helpful error for unknown entity names.
 */
function getEntity(name) {
  if (!Object.prototype.hasOwnProperty.call(entities, name)) {
    throw new Error(
      `[@hms/test-fixtures] Unknown entity "${name}". Valid entities: ${Object.keys(entities).join(', ')}`
    );
  }
  return entities[name];
}

module.exports = {
  // Credentials API (re-exported from ./credentials.js)
  credentials: credentialsModule.credentials,
  getCredentials: credentialsModule.getCredentials,
  roles: credentialsModule.roles,
  DEFAULT_PASSWORD: credentialsModule.DEFAULT_PASSWORD,

  // Synthetic entity datasets
  patients,
  doctors,
  appointments,
  prescriptions,
  invoices,
  laboratoryReports,
  admissions,
  departments,

  // Aggregate map + helper
  entities,
  getEntity,
};
