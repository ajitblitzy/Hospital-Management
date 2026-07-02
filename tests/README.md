# HMS Automated Tests — E2E, API, Performance & Security

This folder holds the Hospital Management System (HMS) **repository-level
automated test suites** — the cross-service automation that exercises the
_running_ system end-to-end. These suites **complement (they do not replace)**
the unit and integration tests that live inside each backend microservice
(`../backend/*`) and the component tests in the React app (`../frontend/`).
Concretely, this folder owns the cross-service **API**, **end-to-end UI**,
**performance**, and **security** automation for HMS.

> **Prerequisite:** every suite here runs against a **running system** — either
> the local stack brought up with the root
> [`../docker-compose.yml`](../docker-compose.yml) (with database migrations and
> seed data applied), or a reachable **deployed** environment configured through
> environment variables. See [Running the Full Stack First](#running-the-full-stack-first).

## Testing Strategy

The QA & DevOps strategy defines six testing types. Unit and integration tests
stay **co-located** with the code they exercise; the cross-service suites are
**centralized here**:

| Test Type               | Owned By                                                             | Tooling                                                       |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| Unit Testing            | Each `../backend/<service>` and `../frontend/`                       | Jest / Vitest                                                 |
| Integration Testing     | Each `../backend/<service>`                                          | Jest + Supertest / test database                              |
| API Testing             | **This folder — [`api/`](./api)**                                    | Postman / Newman                                              |
| Security Testing        | **This folder — [`security/`](./security)**                          | Checklists + automated auth / RBAC / input-validation asserts |
| Performance Testing     | **This folder — [`performance/`](./performance)**                    | k6 / Artillery                                                |
| User Acceptance Testing | **This folder — [`e2e/`](./e2e)** (Playwright journeys) + manual UAT | Playwright                                                    |

In short: this folder **centralizes the cross-service suites** (API, security,
performance, and end-to-end UI), while **unit and integration tests stay
co-located** with the code they test inside each service and the frontend.

## Folder Structure

```
tests/
├── e2e/           # Playwright UI automation — end-to-end user journeys across the 8 roles & core modules
├── api/           # Postman/Newman API automation — collections + environments for the gateway & services
├── performance/   # k6/Artillery load & performance scripts targeting the spec risk areas
├── security/      # Security test assets & checklists (auth/RBAC, patient-data privacy, input validation)
├── fixtures/      # Shared synthetic/seeded test data & credentials used across suites
└── README.md      # This file
```

- [`e2e/`](./e2e) — Playwright UI automation: end-to-end user journeys across
  the 8 roles and core modules.
- [`api/`](./api) — Postman/Newman API automation: collections + environments
  for the API gateway and its `/api/*` routes.
- [`performance/`](./performance) — k6/Artillery load & performance scripts
  targeting the QA-spec risk areas.
- [`security/`](./security) — security test assets & checklists (auth/RBAC,
  patient-data privacy, input validation).
- [`fixtures/`](./fixtures) — shared synthetic/seeded test data and credentials
  consumed by every suite.

> **Standalone project.** `tests/` is intentionally **not** part of the root npm
> workspaces (the root [`../package.json`](../package.json) declares
> `workspaces: ["frontend", "backend/*", "backend/services/*"]`). Each sub-suite
> (`e2e/`, `api/`, `performance/`, `security/`, `fixtures/`) is **self-contained**
> with its own `package.json` (Node >= 18); there is no single `tests` workspace
> root. The exact scripts and configuration for each suite live in that suite's
> own folder (authored by that suite's agent).

## Suites

### End-to-End UI (`e2e/`) — Playwright

Playwright journeys that model real **user-acceptance** flows through the React
single-page app, covering the **8 roles** and the core modules:

- Hospital Administrator
- Doctor
- Nurse
- Receptionist
- Lab Technician
- Pharmacist
- Patient
- Insurance Coordinator

Representative journeys include login + MFA, patient registration, appointment
booking, billing / payment, and prescription dispensing. The suite targets the
frontend at `FRONTEND_URL` (default `http://localhost:3000`).

```bash
cd tests/e2e
npm install
npx playwright install --with-deps   # first run only: download browsers
npx playwright test                  # headless run
npx playwright test --ui             # local interactive mode
npx playwright show-report           # open the HTML report (playwright-report/)
```

### API (`api/`) — Postman / Newman

Postman collections and environment files for the **API gateway**
(`http://localhost:8080`) and its `/api/*` routes. The collections validate
authentication (login / refresh, RBAC), CRUD across the modules, and error
handling. They run **headlessly via Newman** in CI.

```bash
cd tests/api
npm install
npm test                             # run the collections headlessly via Newman
# …or run a single collection directly:
npx newman run collections/hms-api.postman_collection.json \
    -e environments/local.postman_environment.json \
    --reporters cli,junit --reporter-junit-export newman/hms-api.junit.xml
```

### Performance (`performance/`) — k6 / Artillery

Load and performance scripts that target the QA-spec **risk areas**: concurrent
billing transactions (`/api/billing`), appointment-scheduling conflicts
(`/api/appointments`), and high-availability endpoints (`/health`). k6 runs as a
standalone binary; npm scripts wrap the common scenarios.

```bash
cd tests/performance
k6 run billing-load.js               # or: npx artillery run billing-load.yml
npm run test:smoke                   # short, CI-safe smoke run (MODE=smoke)
```

### Security (`security/`)

Auth / RBAC coverage across the **8 roles** (verifying least-privilege on every
`/api/*` route), patient-data-privacy leak checks, and input-validation /
negative tests that support the Security Testing requirement. The suite combines
automated checks with a reviewer **checklist** (e.g. `security/checklist.md`).

```bash
cd tests/security
npm install
npm test                             # run the automated auth/RBAC/input-validation checks
```

### Fixtures (`fixtures/`)

Shared **synthetic** test data modeling the 8 core entities (Patients, Doctors,
Appointments, Prescriptions, Invoices, Laboratory Reports, Admissions,
Departments) plus the **seeded** login credentials for the 8 roles. Published as
the `@hms/test-fixtures` package and consumed by every suite via
`"@hms/test-fixtures": "file:../fixtures"`. **Synthetic / seeded data only** —
see [Patient Data Privacy](#patient-data-privacy).

```bash
cd tests/fixtures
npm install
npm run validate                     # sanity-check the fixture datasets
```

## Environment Configuration

Every suite reads its configuration from **environment variables** (never
hardcoded), consistent with the root [`../.env.example`](../.env.example). The
variables the suites consume:

| Variable                                     | Purpose                                                                                                              | Default                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `FRONTEND_URL`                               | Base URL of the React SPA that Playwright drives (E2E).                                                              | `http://localhost:3000` |
| `GATEWAY_URL`                                | Root URL of the API gateway; also the host for the non-`/api` `GET /health` probe.                                   | `http://localhost:8080` |
| `API_BASE_URL`                               | Base URL for application API traffic — the gateway plus its `/api` prefix. Derives from `API_GATEWAY_PORT` (`8080`). | `${GATEWAY_URL}/api`    |
| `TEST_<ROLE>_EMAIL` / `TEST_<ROLE>_PASSWORD` | Seeded login for each role (e.g. `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD`), matching `../database/seeds/`.         | seeded demo values      |
| `TEST_DEFAULT_PASSWORD`                      | Shared local-dev password fallback for every seeded role.                                                            | seeded demo value       |
| `TEST_<ROLE>_TOTP_SECRET`                    | Optional per-role TOTP secret to complete the MFA challenge for privileged roles (Administrator, Doctor).            | _unset_                 |

The per-role credential prefixes are `TEST_ADMIN`, `TEST_DOCTOR`, `TEST_NURSE`,
`TEST_RECEPTIONIST`, `TEST_LABTECH`, `TEST_PHARMACIST`, `TEST_PATIENT`, and
`TEST_INSURANCE` — one pair per role, matching the seeded demo users under
[`../database/seeds/`](../database/seeds).

Notes:

- The **API (`api/`)** suite supplies these values through its own Postman
  environment files (`environments/local.postman_environment.json` and
  `environments/deployed.postman_environment.json`) rather than OS env vars.
- Individual backend microservices listen on their own ports (the
  `*_SERVICE_PORT` range defined in [`../.env.example`](../.env.example)); the
  suites normally reach them **through the gateway on `8080`** rather than
  directly.

**Run modes:**

- **Local** — against `docker compose up` using the default `localhost` values;
  nothing to configure beyond copying the env template (below).
- **Deployed** — point the suites at any reachable environment by **overriding**
  the base-URL and credential variables (`FRONTEND_URL`, `GATEWAY_URL` /
  `API_BASE_URL`, and the `TEST_*` credentials).

**`.env` files are gitignored** (see [`../.gitignore`](../.gitignore)):

- Copy the root [`../.env.example`](../.env.example) → `../.env` for the local
  stack.
- If a suite ships its own `.env.example`, copy it → `.env` inside that suite's
  folder. Only the committed `*.env.example` templates hold placeholder values.

## Running the Full Stack First

The suites need a running system with the seeded demo users present. From the
**repository root**:

```bash
docker compose up -d        # start postgres, redis, the API gateway, backend services & frontend
npm run db:migrate          # apply database migrations
npm run db:seed             # create the seeded role users the suites log in as
```

`npm run docker:up` / `npm run docker:down` wrap `docker compose up -d` /
`docker compose down`. Once the stack is healthy, run any suite from its own
folder, for example:

```bash
cd tests/e2e && npm install && npx playwright test
```

> **Hostnames — Compose vs host.** Inside the Compose network, services address
> each other by **service name** (`postgres`, `redis`, `api-gateway`); from the
> **host machine** the same services are reachable on `localhost`. The default
> env values above assume you run the suites from the host.

## Continuous Integration

These suites are wired into the **GitHub Actions** workflows in the sibling
[`../.github/`](../.github) folder (CI integration per the QA & DevOps strategy).
Every suite is runnable **headlessly** and emits **machine-readable** reports.
The typical CI job:

1. Brings up the stack (or targets a deployed environment).
2. Waits for `GET /health` to report healthy.
3. Runs the **API** suite headlessly (Newman) and the **E2E** suite headlessly
   (Playwright), emitting **HTML + JUnit** reports.
4. Uploads the generated reports as CI artifacts.

Generated reports are written to the **gitignored** directories
(`playwright-report/`, `test-results/`, `newman/`, `coverage/`) and uploaded as
build artifacts — they are **never committed**.

## Patient Data Privacy

> **⚠️ Patient data privacy is a first-class concern.**
>
> Patient-data privacy is an explicit **risk area** in the QA & DevOps strategy.
> Every suite, fixture, and report in this folder MUST use **synthetic or seeded
> data ONLY** — **never real patient PII or production credentials** in any
> suite, fixture, or report. All names, identifiers, contact details, and
> insurance data are fabricated, and login credentials map to the DEV-ONLY
> seeded demo users; none of these values may ever be used against production.
