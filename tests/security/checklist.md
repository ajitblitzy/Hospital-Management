# HMS Security Verification Checklist

A reviewer-facing security checklist for the **Hospital Management System (HMS)**.
It enumerates the security properties that must hold for the platform and maps
each one to how it is verified — either by the automated security suite in this
folder (`tests/security/`) or by a human/deployment check.

Each section is grounded in the HMS documentation package:

- **Authentication & Authorization** — `02_Hospital_Management_Functional_Requirements_Specification`
  ("Secure login with role-based access control"; "Multi-factor authentication
  for privileged users"; "Session timeout and audit logging").
- **Security Architecture** — `03_Hospital_Management_Technical_Architecture`
  ("JWT-based authentication"; "Encrypted patient data storage"; "API gateway
  protection"; "Role-based authorization").
- **Security Testing & risk areas** — `05_Hospital_Management_QA_Testing_and_DevOps_Strategy`
  ("Security Testing"; "Patient data privacy" is called out as a top risk area).
- **Roles & compliance** — `01_Hospital_Management_Product_Vision_and_Scope`
  (the eight (8) user roles; "Ensure regulatory compliance and data security").

## How to use this checklist

1. **Run the automated suite.** From the repository root run `npm test` (or, from
   this folder, `npm test` / `node run.js`). This executes the security suite and
   satisfies every item tagged `[Automated]`. See `README.md` in this folder for
   prerequisites (a seeded, running system-under-test) and configuration.
2. **Confirm the automated result.** A green run means the `[Automated]` items
   below are asserted; the machine-readable report is written to
   `test-results/junit-security.xml`. Check off each `[Automated]` box once the
   corresponding suite passes.
3. **Verify the manual items.** Work through every `[Manual]` item by hand or in a
   deployed environment (some are destructive or time-based and are intentionally
   not automated by default), and check off each box.
4. **Record the result.** Fill in the review record below and the result fields in
   the footer.

### Legend

- **`[Automated]`** — asserted by the automated security suite in this folder; the
  parenthetical names the check file that covers it (e.g. `auth.checks.js`).
- **`[Manual]`** — verified by hand or in a deployed environment (code review, DB
  inspection, configuration review, or a time-/rate-based observation).
- Checkbox `- [ ]` = not yet verified; `- [x]` = verified for the environment and
  date recorded below.

### Review record (fill in per run)

| Field          | Value                                                        |
| -------------- | ------------------------------------------------------------ |
| Environment    | _(name / base URL under test, e.g. `http://localhost:8080`)_ |
| Suite version  | `@hms/security-tests` _(see `package.json`)_                 |
| Reviewed by    | _(name)_                                                     |
| Date           | _(YYYY-MM-DD)_                                               |
| `npm test` run | _(pass / fail — attach `test-results/junit-security.xml`)_   |

---

## Section 1 — Authentication

Grounded in spec `02` ("Secure login with role-based access control") and spec
`03` ("JWT-based authentication").

- [ ] `[Automated]` Unauthenticated requests to protected `/api/*` routes are rejected with `401` (`auth.checks.js`).
- [ ] `[Automated]` Requests with a malformed / garbage bearer token are rejected with `401` (`auth.checks.js`).
- [ ] `[Automated]` Requests with an expired / invalid-signature JWT are rejected with `401` (`auth.checks.js`).
- [ ] `[Automated]` The public `/api/auth/login` route is reachable and validates input (not gated by JWT) (`auth.checks.js`).
- [ ] `[Automated]` A valid non-privileged login issues a JWT access token (`auth.checks.js`).
- [ ] `[Manual]` Account lockout after `MAX_FAILED_LOGIN_ATTEMPTS = 5` failed attempts (destructive; verify manually or in a disposable environment).
- [ ] `[Manual]` Passwords are stored hashed (bcrypt / argon2) — never in plaintext (verify via DB inspection / code review).
- [ ] `[Manual]` Audit logging records authentication events (spec `02`: "audit logging").

## Section 2 — Multi-Factor Authentication (MFA)

Grounded in spec `02` ("Multi-factor authentication for privileged users"). The
privileged roles are **Hospital Administrator** and **Doctor** (the MFA-required
set in `rbac-matrix.js` / the backend seed model).

- [ ] `[Automated]` Privileged roles (**Hospital Administrator**, **Doctor**) receive an MFA challenge on password login and do **not** receive tokens until MFA is completed (`auth.checks.js`).
- [ ] `[Manual]` MFA enrollment provisions a TOTP secret; `POST /api/auth/mfa/verify` with a valid 6-digit code issues tokens (enable via `SECURITY_COMPLETE_MFA=1` plus `TEST_ADMIN_TOTP_SECRET` / `TEST_DOCTOR_TOTP_SECRET` to automate this flow).
- [ ] `[Automated]` Invalid MFA code format (non-6-digit) is rejected with a `4xx` validation error, never a `5xx` (`input-validation.checks.js`).

## Section 3 — Session Management

Grounded in spec `02` ("Session timeout").

- [ ] `[Automated]` Logout succeeds for an authenticated session (`auth.checks.js`).
- [ ] `[Manual]` Idle session timeout is enforced after ~30 minutes (manual / time-based observation).
- [ ] `[Manual]` Refresh-token rotation / revocation works; a logged-out or expired refresh token cannot mint new access tokens.

## Section 4 — Authorization / RBAC least-privilege (8 roles)

Grounded in spec `02`/`03` ("Role-based access control" / "Role-based
authorization") and spec `01` (the eight (8) user roles). The suite treats HTTP
status codes as: **`401`** = unauthenticated / missing or invalid token,
**`403`** = authenticated but forbidden (fine-grained denial at the service),
**`503`** = downstream service unavailable ⇒ **inconclusive** (skipped, neither
pass nor fail).

### RBAC access matrix

Rows are the eight (8) roles; columns are the protected resources exposed through
the API gateway. **✓ = access allowed**, **✗ = access denied**. This table mirrors
the `allowed` sets in `rbac-matrix.js` (the single source of truth the automated
probes assert against).

| Role                   | Patients | Appointments | Laboratory | Pharmacy | Billing | Reports | Inventory¹ | EMR² |
| ---------------------- | :------: | :----------: | :--------: | :------: | :-----: | :-----: | :--------: | :--: |
| Hospital Administrator |    ✓     |      ✓       |     ✓      |    ✓     |    ✓    |    ✓    |     ✓      |  ✓   |
| Doctor                 |    ✓     |      ✓       |     ✓      |    ✓     |    ✗    |    ✓    |     ✗      |  ✓   |
| Nurse                  |    ✓     |      ✓       |     ✓      |    ✓     |    ✗    |    ✗    |     ✗      |  ✓   |
| Receptionist           |    ✓     |      ✓       |     ✗      |    ✗     |    ✓    |    ✗    |     ✗      |  ✓   |
| Lab Technician         |    ✓     |      ✓       |     ✓      |    ✗     |    ✗    |    ✗    |     ✗      |  ✓   |
| Pharmacist             |    ✗     |      ✗       |     ✗      |    ✓     |    ✗    |    ✓    |     ✓      |  ✓   |
| Patient                |    ✓     |      ✓       |     ✓      |    ✓     |    ✓    |    ✗    |     ✗      |  ✓   |
| Insurance Coordinator  |    ✓     |      ✗       |     ✗      |    ✗     |    ✓    |    ✗    |     ✗      |  ✓   |

¹ **Inventory** is an `AMBIGUOUS` best-effort assumption in `rbac-matrix.js`
(read access assumed restricted to Hospital Administrator + Pharmacist); confirm
against the intended design — see the manual item below.

² **EMR** is `AUTH_ONLY`: any authenticated role may reach it (✓ = authenticated
access is permitted), so **no per-role deny is asserted** for this column. The
Hospital Administrator holds all permissions and is therefore allowed on every
resource.

### RBAC checks

- [ ] `[Automated]` Each allowed role can access its permitted routes (not `401`/`403`) (`rbac.checks.js`).
- [ ] `[Automated]` Each disallowed role is denied (`401`/`403`) on routes outside its permissions — no privilege escalation (`rbac.checks.js`).
- [ ] `[Automated]` The Hospital Administrator is never denied on any protected route (`rbac.checks.js`; requires MFA/TOTP to fully assert — otherwise skipped).
- [ ] `[Manual]` Verify that write / update / delete actions (`POST`/`PUT`/`DELETE`), not just reads, honor the same least-privilege matrix.
- [ ] `[Manual]` Confirm the `inventory` (AMBIGUOUS) and `emr` (AUTH_ONLY) policies against the intended design (documented assumptions in `rbac-matrix.js`).

## Section 5 — Patient-Data Privacy

Grounded in spec `03` ("Encrypted patient data storage") and spec `05`
("Patient data privacy" is a top risk area).

- [ ] `[Automated]` Protected patient data is not exposed to unauthorized roles (e.g. a Pharmacist cannot read Patients) (`rbac.checks.js`).
- [ ] `[Automated]` Responses and errors never leak password hashes, MFA/TOTP secrets, salts, private keys, SQL internals, or stack traces (`rbac.checks.js`, `input-validation.checks.js`).
- [ ] `[Manual]` Patient data (PII/PHI) is encrypted at rest (DB / storage review) and in transit (TLS).
- [ ] `[Manual]` Logs do not contain PII/PHI or secrets.

## Section 6 — Input Validation & Abuse Resistance

Grounded in spec `02` (input handling for registration/profiles) and spec `03`
("API gateway protection").

- [ ] `[Automated]` SQL-injection / object-injection style credentials are safely rejected (no login, no `5xx`) (`input-validation.checks.js`).
- [ ] `[Automated]` Malformed JSON request bodies yield `4xx` (never `5xx`) (`input-validation.checks.js`).
- [ ] `[Automated]` Missing required fields yield `400 VALIDATION_ERROR` (`input-validation.checks.js`).
- [ ] `[Automated]` Oversized payloads are handled gracefully (no `5xx`; `400`/`413`/`429` acceptable) (`input-validation.checks.js`).
- [ ] `[Automated]` XSS-style payloads are not reflected back unescaped (`input-validation.checks.js`).
- [ ] `[Manual]` File-upload validation (identification documents — spec `02`: "Upload identification documents"): enforce type/size limits and reject malicious or oversized files.

## Section 7 — API Gateway Protection

Grounded in spec `03` ("API gateway protection").

- [ ] `[Automated]` The gateway forwards `Authorization: Bearer <token>` and enforces JWT on protected routes; unavailable downstream services surface as `503` (treated as inconclusive / skipped) (`rbac.checks.js`).
- [ ] `[Manual]` Rate limiting is enforced (e.g. `RATE_LIMIT_MAX`, `429` on abuse) — optionally automate via `SECURITY_TEST_RATE_LIMIT=1`.
- [ ] `[Manual]` Security headers are present in deployed responses (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, and CSP as applicable) — optionally enforce via `SECURITY_EXPECT_HEADERS=1`.
- [ ] `[Manual]` CORS policy restricts origins appropriately.

## Section 8 — Secrets & Transport Hygiene

Grounded in spec `05` (patient-privacy risk) and spec `01` ("data security").

- [ ] `[Manual]` No real PII or production credentials are used in tests — only seeded role credentials, synthetic fixtures, and environment variables.
- [ ] `[Manual]` TLS/HTTPS is enforced in non-local environments; no secrets are committed to source (see `.gitignore`).
- [ ] `[Manual]` Test artifacts (`test-results/`) contain no secrets and are gitignored.

---

## Footer

Automated coverage is produced by `npm test` (see `README.md` in this folder);
the machine-readable results are written to `test-results/junit-security.xml`.
The automated suite covers all three primary areas — authentication/RBAC,
patient-data privacy, and input validation — plus API gateway protection, while
the `[Manual]` items cover the deployment-, time-, and destructive-verification
gaps that cannot be safely asserted from a black-box test run.

**Sign-off (fill in per review):**

- **Environment:** ______________________________________________
- **Reviewed by:** ______________________________________________
- **Date:** ______________________________________________
- **Result (pass / fail / notes):** ______________________________________________

## Appendix — Specification references

| Ref  | Document                                                       | Verifies (in this checklist)                                                                                 |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `01` | `01_Hospital_Management_Product_Vision_and_Scope`              | The eight (8) roles; "Ensure regulatory compliance and data security".                                       |
| `02` | `02_Hospital_Management_Functional_Requirements_Specification` | Secure login + RBAC; MFA for privileged users; session timeout; audit logging; input & file-upload handling. |
| `03` | `03_Hospital_Management_Technical_Architecture`                | JWT-based authentication; encrypted patient data storage; API gateway protection; role-based authorization.  |
| `05` | `05_Hospital_Management_QA_Testing_and_DevOps_Strategy`        | Security Testing; "Patient data privacy" risk area.                                                          |

The eight (8) roles referenced throughout — Hospital Administrator, Doctor,
Nurse, Receptionist, Lab Technician, Pharmacist, Patient, and Insurance
Coordinator — and their allowed-resource sets are defined authoritatively in
`rbac-matrix.js`, which the automated RBAC probes consume.
