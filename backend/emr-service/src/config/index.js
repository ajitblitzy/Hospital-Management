'use strict';

/**
 * EMR service-local configuration.
 *
 * Exposes ONLY the per-service HTTP `port` and `serviceName`. All shared
 * configuration (database, Redis, JWT, encryption, etc.) is intentionally
 * provided by `@hms/shared`'s `config.getConfig()` and is NOT duplicated here.
 *
 * `port` reads `EMR_SERVICE_PORT` and falls back to 4004 when the variable is
 * missing, empty, non-numeric, or 0. The sole consumer (`../index.js`) invokes
 * `dotenv.config(...)` before requiring this module, so reading `process.env`
 * at load time is safe and has no side effects.
 *
 * @module emr-service/config
 * @type {{ port: number, serviceName: string }}
 */
module.exports = {
  port: Number(process.env.EMR_SERVICE_PORT) || 4004,
  serviceName: 'emr-service',
};
