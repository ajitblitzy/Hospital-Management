# HMS Performance & Load Tests (k6)

Performance/load tests for the Hospital Management System (HMS), targeting the
**risk areas** called out in the QA & DevOps strategy
(`../../Hospital_Management_Documentation_Package/05_Hospital_Management_QA_Testing_and_DevOps_Strategy.pdf`):

| Risk area | Scenario | Target |
|-----------|----------|--------|
| Concurrent billing transactions | [`billing-load.js`](./billing-load.js) | `POST`/`GET` `/api/billing` |
| Appointment-scheduling conflicts | [`appointment-conflict.js`](./appointment-conflict.js) | concurrent booking on `/api/appointments` |
| High-availability requirements | [`health-availability.js`](./health-availability.js) | gateway (and service) `/health` |

The suite runs against the running system through the **API gateway**
(`http://localhost:8080`, all app traffic under the `/api` prefix) and the
infrastructure `/health` endpoints.

> **⚠️ Patient-data privacy is first-class.** These scenarios use **synthetic /
> seeded data only** (from the shared [`../fixtures/`](../fixtures) package) and
> credentials supplied via **environment variables**. Never put real patient PII
> or production secrets in scripts, payloads, or reports.

## Tooling: k6

This suite uses **[k6](https://k6.io)** — a standalone load-testing binary. Each
scenario is a k6 ES-module script that declares `options` (VUs / stages /
thresholds) and a default function. k6 runs on its own JavaScript runtime (not
Node.js): it reads environment variables via `-e KEY=value` (exposed as `__ENV`)
and reads the shared fixture JSON files directly from disk with `open()`.

### Install k6

```bash
# macOS
brew install k6
# Debian/Ubuntu
sudo gpg -k && \
  sudo apt-get install -y k6      # via the k6 apt repo (see k6 docs)
# Docker
docker run --rm -i --network=host -v "$PWD:/src" -w /src grafana/k6 run billing-load.js
```

> This folder also ships a `package.json` (`@hms/performance-tests`, Node >= 18)
> so the suite is self-contained and consistent with the other `tests/*` suites.
> It only provides **npm-script wrappers** around the `k6` binary — there are no
> runtime dependencies to install, and `tests/` is intentionally **not** part of
> the root npm workspaces.

## Prerequisites — a running, seeded system

From the repository root:

```bash
docker-compose up -d      # postgres, redis, api-gateway, backend services, frontend
npm run db:migrate        # create the schema
npm run db:seed           # create the seeded demo users the tests log in as
```

Wait for the gateway to be healthy before load-testing:

```bash
curl -fsS http://localhost:8080/health
```

## Running the scenarios

Always run from **this** directory (so `open('../fixtures/*.json')` and the
`test-results/` output resolve correctly):

```bash
cd tests/performance

# via k6 directly
k6 run health-availability.js
k6 run billing-load.js
k6 run appointment-conflict.js

# via the npm-script wrappers
npm run test:health
npm run test:billing
npm run test:appointments
npm run test:all          # health -> billing -> appointments
```

### Load profiles

`MODE` selects the load shape; `VUS` / `DURATION` / `MAX_VUS` fine-tune it:

```bash
k6 run -e MODE=smoke  billing-load.js         # default: short & light (CI-safe)
k6 run -e MODE=load  -e VUS=25 billing-load.js # ramp up, sustain, ramp down
k6 run -e MODE=stress -e MAX_VUS=200 billing-load.js
```

## Authentication

Protected `/api/*` routes require `Authorization: Bearer <accessToken>`. Each
scenario's `setup()` obtains a token once:

1. If `AUTH_TOKEN` is set, it is used directly. Use this for **MFA/privileged**
   roles (admin, doctor) whose login returns an MFA challenge instead of a token.
2. Otherwise the scenario calls `POST /api/auth/login` with `PERF_AUTH_EMAIL` /
   `PERF_AUTH_PASSWORD`, or the seeded defaults for `PERF_AUTH_ROLE` (default
   `receptionist` — a **non-MFA** role, so login returns tokens directly).

```bash
# log in as a seeded non-MFA role (default)
k6 run billing-load.js
# use an explicit, pre-obtained token (any role, incl. MFA users)
k6 run -e AUTH_TOKEN="$MY_JWT" billing-load.js
# log in as a specific seeded role
k6 run -e PERF_AUTH_ROLE=insurance billing-load.js
```

`/health` is public infrastructure, so `health-availability.js` needs no auth.

## Environment variables

k6 does **not** auto-load a `.env` file; pass variables with `-e KEY=value` (or
export them and reference `${VAR}` on the command line). All have local defaults.

| Variable | Default | Purpose |
|----------|---------|---------|
| `GATEWAY_URL` | `http://localhost:8080` | Gateway host root (used for `/health`) |
| `API_BASE_URL` | `${GATEWAY_URL}/api` | Application API base (`/api` prefix) |
| `HEALTH_URL` | `${GATEWAY_URL}/health` | Gateway health endpoint |
| `MODE` | `smoke` | Load shape: `smoke` \| `load` \| `stress` |
| `VUS` / `DURATION` / `MAX_VUS` | `5` / `30s` / `100` | Concurrency & duration knobs |
| `AUTH_TOKEN` | _(unset)_ | Pre-obtained bearer token (skips login) |
| `PERF_AUTH_ROLE` | `receptionist` | Seeded role to log in as (non-MFA) |
| `PERF_AUTH_EMAIL` / `PERF_AUTH_PASSWORD` | _(seeded)_ | Explicit login credentials |
| `TEST_<ROLE>_EMAIL` / `TEST_<ROLE>_PASSWORD` | _(seeded)_ | Per-role creds (mirrors `../fixtures/`) |
| `TEST_DEFAULT_PASSWORD` | `ChangeMe123!` | Shared seeded dev password |
| `BILLING_P95_MS` / `BILLING_ERROR_RATE` | `800` / `0.01` | Billing SLA gates |
| `APPT_P95_MS` | `1000` | Appointment latency SLA |
| `HEALTH_P95_MS` / `HEALTH_ERROR_RATE` | `200` / `0.001` | Health SLA gates |
| `CONTENTION` / `ROUNDS` | `20` / `5` | Appointment-conflict contention knobs |
| `PERF_BILLING_WRITE` | `false` | Also exercise `POST /api/billing` |
| `PERF_HEALTH_ALL_SERVICES` | `false` | Probe every service `:port/health` |

The seeded-credential env-var names and defaults intentionally match the shared
`../fixtures/` package (`@hms/test-fixtures`) and `../../database/seeds/`.

## Interpreting results

Each run prints a concise summary and writes machine-readable reports into the
**gitignored** `test-results/` directory:

- `test-results/<scenario>-summary.json` — the full k6 metrics object.
- `test-results/<scenario>-junit.xml` — one JUnit test case per **threshold**;
  a breached SLA becomes a `<failure>`, so CI fails the job on an SLA breach.

k6 exits non-zero when any threshold fails, which fails the CI step automatically.

### What each scenario asserts

- **billing-load** — reads (and optionally writes) `/api/billing` under
  concurrency; gates on `p95` latency, `http_req_failed` error rate, and a >99%
  check pass rate.
- **appointment-conflict** — many synthetic patients book the **same** doctor +
  slot at once; the scheduler must return a decisive **201** or **409** (never a
  `5xx`) and stay within the latency SLA (`appt_server_error == 0`,
  `appt_decisive > 99%`). `409` is treated as a correct outcome, not an error.
- **health-availability** — sustained probing of `/health`; gates on availability
  (`>= 99.5%` healthy) and response-time SLA.

## CI

These scenarios run headlessly and emit JUnit XML, so they wire directly into the
GitHub Actions workflows in [`../../.github/`](../../.github). A typical job spins
up the stack (or targets a deployed environment via `GATEWAY_URL`), waits for
`/health`, runs the scenarios, and uploads `test-results/` as artifacts. Because
performance runs are heavier, they may be scheduled (nightly) rather than on every
push.
