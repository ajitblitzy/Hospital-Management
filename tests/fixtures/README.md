# @hms/test-fixtures

Shared **synthetic** test data and **seeded** login credentials for the Hospital
Management System (HMS) repository-level test suites:

- `../e2e` — Playwright end-to-end tests (UI at `http://localhost:3000`)
- `../api` — API/integration tests (gateway at `http://localhost:8080`, `/api` prefix)
- `../performance` — load/performance scenarios
- `../security` — security/authorization tests

This package is the **single source of truth** for test data so every suite stays
consistent and DRY.

> ## ⚠️ Patient-data privacy is FIRST-CLASS
>
> Per the QA & DevOps strategy, patient-data privacy is a top risk area. This
> package contains **SYNTHETIC / SEEDED data ONLY**. **Never** commit real patient
> PII, real identifiers, or production credentials here. All names, emails, phone
> numbers, national IDs, and insurance details are fabricated. Login credentials
> map to the **seeded demo users** and default to a well-known **local-dev**
> password that must never be used in production.

## Installation / usage

`tests/` is a standalone project and is intentionally **not** part of the root npm
workspaces. Each sibling suite depends on this package via a relative file path in
its own `package.json`:

```json
{
  "dependencies": {
    "@hms/test-fixtures": "file:../fixtures"
  }
}
```

The package is **CommonJS**, has **no runtime dependencies**, and requires
**Node >= 18**.

```js
// Aggregate entry point
const fixtures = require('@hms/test-fixtures');

fixtures.getCredentials('doctor');   // -> { email: 'doctor@hms.local', password, mfaEnabled: true, ... }
fixtures.patients;                    // -> array of synthetic patients
fixtures.getEntity('laboratoryReports');

// Or require an individual dataset directly
const patients = require('@hms/test-fixtures/patients.json');
```

## Login credentials (`credentials.js`)

Credentials are supplied via **environment variables** with fallback to local-dev
defaults that match the users seeded by `../../database/seeds/04_demo_users.sql`.
Set the variables (via dotenv or CI env) **before** requiring this package — they
are read at import time.

| Role key | Role | Username | Default email | MFA | Env overrides |
|----------|------|----------|---------------|-----|---------------|
| `admin` | Hospital Administrator | admin | admin@hms.local | yes | `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` |
| `doctor` | Doctor | dr.smith | doctor@hms.local | yes | `TEST_DOCTOR_EMAIL` / `TEST_DOCTOR_PASSWORD` |
| `nurse` | Nurse | nurse.joy | nurse@hms.local | no | `TEST_NURSE_EMAIL` / `TEST_NURSE_PASSWORD` |
| `receptionist` | Receptionist | reception | receptionist@hms.local | no | `TEST_RECEPTIONIST_EMAIL` / `TEST_RECEPTIONIST_PASSWORD` |
| `labTechnician` | Lab Technician | labtech | labtech@hms.local | no | `TEST_LABTECH_EMAIL` / `TEST_LABTECH_PASSWORD` |
| `pharmacist` | Pharmacist | pharmacist | pharmacist@hms.local | no | `TEST_PHARMACIST_EMAIL` / `TEST_PHARMACIST_PASSWORD` |
| `patient` | Patient | patient.doe | patient@hms.local | no | `TEST_PATIENT_EMAIL` / `TEST_PATIENT_PASSWORD` |
| `insurance` | Insurance Coordinator | insurance | insurance@hms.local | no | `TEST_INSURANCE_EMAIL` / `TEST_INSURANCE_PASSWORD` |

`TEST_DEFAULT_PASSWORD` overrides the shared default password for every role. The
final fallback is the well-known local-dev password documented in the seed file.
Privileged roles (Hospital Administrator, Doctor) have MFA enabled.

Exports: `credentials` (map), `getCredentials(roleKey)`, `roles` (ordered keys),
`DEFAULT_PASSWORD`.

## Synthetic entity catalog

Each dataset models one of the 8 core entities from the ERD
(`../../Hospital_Management_Documentation_Package/04_...Database_Design_and_ERD.pdf`).
Field names use the database **`snake_case`** convention; cross-entity references
use natural/business keys. Values are **deterministic** so suites can assert on them.

| File | Entity | Rows | Natural key | Key references |
|------|--------|------|-------------|----------------|
| `departments.json` | Departments | 9 | `name` | mirrors `../../database/seeds/03_departments.sql` |
| `doctors.json` | Doctors | 6 | `employee_code` (DOC-000n) | `department_name` |
| `patients.json` | Patients | 6 | `patient_number` (PAT-00000n) | — |
| `appointments.json` | Appointments | 6 | `appointment_number` (APT-00000n) | `patient_number`, `doctor_employee_code`, `department_name` |
| `admissions.json` | Admissions | 4 | `admission_number` (ADM-00000n) | `patient_number`, `attending_doctor_employee_code`, `department_name` |
| `prescriptions.json` | Prescriptions | 5 | `prescription_number` (RX-00000n) | `patient_number`, `doctor_employee_code`, `appointment_number`, `items[].medicine_sku` |
| `laboratory_reports.json` | Laboratory Reports | 4 | `report_number` (LAB-00000n) | `patient_number`, `ordering_doctor_employee_code` |
| `invoices.json` | Invoices | 6 | `invoice_number` (INV-00000n) | `patient_number`, `appointment_number` **or** `admission_number` |

### Cross-entity relationships (from the ERD)

- One patient can have many appointments.
- One doctor can manage many prescriptions.
- Invoices are linked to appointments **and** admissions (each invoice references one
  or the other).
- Prescription `items[].medicine_sku` values come from the seeded medicine catalog
  (`../../database/seeds/05_medicines.sql`).

### Invoice arithmetic invariants

For every invoice: `amount = quantity * unit_price`, `subtotal = Σ amount`,
`total = subtotal + tax - discount`, and `balance_due = total - amount_paid`.
Insurance claims track `approved_amount` separately from `amount_paid`.

## Alignment with the database seeds

This package is a **consumer** of the database seed contract; it never modifies it.
The following must stay in sync with `../../database/seeds/`:

- Demo users / credentials ↔ `04_demo_users.sql`
- Departments ↔ `03_departments.sql`
- Medicine SKUs referenced by prescriptions ↔ `05_medicines.sql`

## Validation

```bash
cd tests/fixtures
npm run validate   # prints: @hms/test-fixtures OK: 8 roles, 8 entities
```
