'use strict';

/**
 * Unit tests for `src/services.js` — the gateway's downstream route table.
 *
 * `services.js` is a PURE module (imports nothing from `@hms/shared`), so NO
 * mock is required. Target URLs are resolved LAZILY on every
 * `getServices()` / `buildTarget()` call (live `process.env` read), so env
 * changes take effect WITHOUT `jest.resetModules()`. The env-isolation bookend
 * is still applied for hygiene, and `*_SERVICE_*` overrides are stripped in
 * `beforeEach` so default target resolution is deterministic.
 */

const services = require('../../src/services');
const { SERVICE_DEFINITIONS, envVarName, buildTarget, getServices } = services;

const OLD_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  const cleaned = { ...OLD_ENV };
  for (const key of Object.keys(cleaned)) {
    if (/_SERVICE_(PORT|HOST|URL)$/.test(key)) delete cleaned[key];
  }
  process.env = cleaned;
});

afterEach(() => {
  process.env = OLD_ENV;
});

// Expected route table (order matters), per the AAP and root .env.example/compose.
const EXPECTED_SERVICES = [
  { key: 'auth', prefix: '/api/auth', serviceName: 'auth-service', defaultPort: 4001, public: true },
  { key: 'patients', prefix: '/api/patients', serviceName: 'patient-service', defaultPort: 4002, public: false },
  { key: 'appointments', prefix: '/api/appointments', serviceName: 'appointment-service', defaultPort: 4003, public: false },
  { key: 'emr', prefix: '/api/emr', serviceName: 'emr-service', defaultPort: 4004, public: false },
  { key: 'billing', prefix: '/api/billing', serviceName: 'billing-service', defaultPort: 4005, public: false },
  { key: 'pharmacy', prefix: '/api/pharmacy', serviceName: 'pharmacy-service', defaultPort: 4006, public: false },
  { key: 'laboratory', prefix: '/api/laboratory', serviceName: 'laboratory-service', defaultPort: 4007, public: false },
  { key: 'inventory', prefix: '/api/inventory', serviceName: 'inventory-service', defaultPort: 4008, public: false },
  { key: 'reports', prefix: '/api/reports', serviceName: 'reports-service', defaultPort: 4009, public: false },
];

describe('services', () => {
  describe('getServices() route table', () => {
    it('returns exactly 9 routes', () => {
      expect(getServices()).toHaveLength(9);
    });

    it('returns routes in the expected order', () => {
      expect(getServices().map((s) => s.prefix)).toEqual(EXPECTED_SERVICES.map((s) => s.prefix));
    });

    it.each(EXPECTED_SERVICES.map((s, i) => [s.prefix, s, i]))(
      '%s maps to the correct serviceName, default target, empty roles and public flag',
      (_prefix, expected, index) => {
        const route = getServices()[index];
        expect(route.serviceName).toBe(expected.serviceName);
        expect(route.target).toBe(`http://${expected.serviceName}:${expected.defaultPort}`);
        expect(route.roles).toEqual([]);
        if (expected.public) {
          expect(route.public).toBeTruthy();
        } else {
          expect(route.public).toBeFalsy();
        }
      }
    );

    it('marks only /api/auth as public', () => {
      const publicRoutes = getServices().filter((s) => s.public);
      expect(publicRoutes).toHaveLength(1);
      expect(publicRoutes[0].prefix).toBe('/api/auth');
    });

    it('returns a fresh array and fresh role arrays on each call (lazy)', () => {
      const first = getServices();
      const second = getServices();
      expect(first).not.toBe(second);
      expect(first[0].roles).not.toBe(second[0].roles);
    });
  });

  describe('envVarName()', () => {
    it.each([
      ['patient-service', 'PORT', 'PATIENT_SERVICE_PORT'],
      ['auth-service', 'URL', 'AUTH_SERVICE_URL'],
      ['emr-service', 'HOST', 'EMR_SERVICE_HOST'],
      ['appointment-service', 'PORT', 'APPOINTMENT_SERVICE_PORT'],
    ])('maps (%s, %s) to %s', (serviceName, suffix, expected) => {
      expect(envVarName(serviceName, suffix)).toBe(expected);
    });
  });

  describe('buildTarget() / target precedence (lazy per call)', () => {
    const patientsDef = SERVICE_DEFINITIONS.find((d) => d.serviceName === 'patient-service');

    it('defaults to http://<composeName>:<defaultPort>', () => {
      expect(buildTarget(patientsDef)).toBe('http://patient-service:4002');
    });

    it('honors a *_SERVICE_PORT override on the next getServices() call (proves laziness)', () => {
      expect(getServices().find((s) => s.serviceName === 'patient-service').target)
        .toBe('http://patient-service:4002');

      process.env.PATIENT_SERVICE_PORT = '15002';

      expect(getServices().find((s) => s.serviceName === 'patient-service').target)
        .toBe('http://patient-service:15002');
    });

    it('honors a *_SERVICE_HOST override', () => {
      process.env.PATIENT_SERVICE_HOST = '127.0.0.1';
      expect(buildTarget(patientsDef)).toBe('http://127.0.0.1:4002');
    });

    it('combines *_SERVICE_HOST and *_SERVICE_PORT overrides', () => {
      process.env.PATIENT_SERVICE_HOST = '127.0.0.1';
      process.env.PATIENT_SERVICE_PORT = '7000';
      expect(buildTarget(patientsDef)).toBe('http://127.0.0.1:7000');
    });

    it('lets *_SERVICE_URL win over host/port and strips trailing slashes', () => {
      process.env.PATIENT_SERVICE_URL = 'https://gateway.example.com/patients/';
      process.env.PATIENT_SERVICE_HOST = 'ignored-host';
      process.env.PATIENT_SERVICE_PORT = '1';
      expect(buildTarget(patientsDef)).toBe('https://gateway.example.com/patients');
    });

    it('ignores a whitespace-only *_SERVICE_URL and falls back to host/port', () => {
      process.env.PATIENT_SERVICE_URL = '   ';
      expect(buildTarget(patientsDef)).toBe('http://patient-service:4002');
    });
  });
});
