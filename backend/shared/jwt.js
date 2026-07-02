/**
 * @module @hms/shared/jwt
 *
 * JSON Web Token (JWT) utilities for the Hospital Management System (HMS) auth
 * flow. This module provides the small set of stateless primitives used to
 * issue, verify, refresh, and inspect JWTs:
 *
 *   - {@link signAccessToken}     — mint a short-lived access token.
 *   - {@link signRefreshToken}    — mint a long-lived refresh token.
 *   - {@link verifyAccessToken}   — verify + decode an access token.
 *   - {@link verifyRefreshToken}  — verify + decode a refresh token.
 *   - {@link refreshAccessToken}  — mint a new access token from a valid refresh token.
 *   - {@link decodeToken}         — decode WITHOUT verification (inspection only).
 *
 * Design context (grounded in the HMS Technical Architecture — "JWT-based
 * authentication", "Role-based authorization" — and the Functional
 * Requirements — "Secure login with role-based access control"):
 *
 *   - This file is a PURE utility. It contains NO Express/HTTP logic. The RBAC
 *     middleware (`rbac.js`) is the primary consumer: it calls
 *     {@link verifyAccessToken} and maps the thrown `jsonwebtoken` errors
 *     (`TokenExpiredError` / `JsonWebTokenError`) to HTTP 401 responses. The
 *     login/refresh HTTP endpoints live in the auth-service and call the sign /
 *     refresh helpers here.
 *
 *   - It is DELIBERATELY narrow. Password hashing, login orchestration,
 *     multi-factor authentication, session management, and refresh-token
 *     rotation / blacklisting are NOT implemented here — they are auth-service
 *     responsibilities. This module only performs token operations and provides
 *     the primitives those higher-level flows build on.
 *
 * Design contract (MUST be preserved by all edits):
 *
 *   1. Side-effect-free at import time. Requiring this module opens no
 *      connections, performs no I/O, and reads NO configuration. Configuration
 *      is read lazily (see {@link loadJwtConfig}) on the first call to any
 *      function, so a consuming service can populate `process.env` (e.g. via
 *      `dotenv`) BEFORE the first token operation materializes the config.
 *
 *   2. Stateless. There is no in-memory session, cache, or connection. Every
 *      function is a pure transformation of its inputs plus the current
 *      configuration.
 *
 *   3. Secret-safe. Tokens and signing secrets are NEVER logged by this module,
 *      and error messages raised here never embed secret material.
 *
 * Claim conventions (kept consistent with `rbac.js`):
 *
 *   - `sub`  — the authenticated user's id (the JWT "subject" registered claim).
 *   - `role` — the RBAC role string (one of the eight roles validated by
 *              `rbac.js`). This module does not itself validate role values; it
 *              simply carries them through the token payload.
 *
 * Secret-separation note: `JWT_SECRET` and `JWT_REFRESH_SECRET` default to the
 * same placeholder (`"change_me"`) in `.env.example`. With those defaults the
 * access and refresh secrets are identical, so cryptographic separation of the
 * two token classes only holds once an operator sets DISTINCT secrets (as the
 * `.env.example` comments instruct). Regardless of secret configuration, the
 * `issuer` claim (`"hms"`) is applied to and verified on both token classes.
 */

"use strict";

const jwt = require("jsonwebtoken");

/**
 * Default `issuer` (`iss`) claim applied when signing, and asserted when
 * verifying, both access and refresh tokens. Callers may override it per-call
 * via the `options` argument of the sign helpers (verification always asserts
 * this issuer, which keeps tokens minted by other systems from validating).
 *
 * @type {string}
 */
const DEFAULT_ISSUER = "hms";

/**
 * Registered/standard JWT claims that are managed by `jsonwebtoken` itself and
 * MUST be stripped from a decoded payload before it is re-signed by
 * {@link refreshAccessToken}.
 *
 * `iat`, `exp`, `nbf`, and `jti` are timing/identity claims that must be
 * regenerated for the new token rather than copied from the refresh token.
 *
 * `iss` and `aud` are included in addition to the timing claims because the
 * sign helpers set `issuer` (and callers may set `audience`) via the `options`
 * argument. `jsonwebtoken` throws (e.g. `Bad "options.issuer" option. The
 * payload already has an "iss" property.`) if a claim is present BOTH in the
 * payload AND in the options, so these must be removed to let the sign step
 * re-apply them cleanly.
 *
 * @type {ReadonlyArray<string>}
 */
const REFRESH_STRIP_CLAIMS = Object.freeze([
  "iat",
  "exp",
  "nbf",
  "jti",
  "iss",
  "aud",
]);

/**
 * Lazily load the JWT configuration slice.
 *
 * Requiring `./config` and calling `getConfig()` happen HERE — at call time,
 * not at module import time — which is what keeps this module side-effect-free
 * on import (`config.js` itself only reads `process.env` when `getConfig()` is
 * invoked). `getConfig()` memoizes its result, so repeated calls are cheap.
 *
 * @returns {{secret: string, expiresIn: string, refreshSecret: string, refreshExpiresIn: string}}
 *   The `jwt` section of the shared HMS configuration.
 */
function loadJwtConfig() {
  return require("./config").getConfig().jwt;
}

/**
 * Validate that a value is a plain claims object suitable for signing.
 *
 * `jsonwebtoken` only supports the `expiresIn` option (which this module always
 * sets) when the payload is an object literal; string/Buffer payloads would
 * cause a cryptic downstream error. Guarding here yields a clear, actionable
 * message at the call site. This guard lives on the SIGNING path only — the
 * verification path intentionally performs no such guarding so that
 * `jsonwebtoken`'s own error types propagate unchanged (see
 * {@link verifyAccessToken}).
 *
 * @param {*} payload      The value to validate.
 * @param {string} fnName  Name of the calling function (for the error message).
 * @returns {void}
 * @throws {TypeError} If `payload` is not a non-null, non-array object.
 */
function assertSignablePayload(payload, fnName) {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new TypeError(
      `${fnName}: payload must be a plain claims object (e.g. { sub, role }).`,
    );
  }
}

/**
 * Sign a short-lived ACCESS token.
 *
 * The token is signed with the access secret (`config.jwt.secret`) and expires
 * after `config.jwt.expiresIn` (default `15m`). The `issuer` claim defaults to
 * {@link DEFAULT_ISSUER} (`"hms"`) and can be overridden — along with any other
 * `jsonwebtoken` sign option — via `options`.
 *
 * The caller's `payload` object is NOT mutated: `jsonwebtoken` clones the
 * payload internally before adding timing claims (its `mutatePayload` option
 * defaults to `false`), so the object passed in is left untouched.
 *
 * @param {Object} payload            Plain claims object. Use `sub` for the
 *                                    user id and `role` for the RBAC role,
 *                                    e.g. `{ sub: userId, role, email }`.
 * @param {import("jsonwebtoken").SignOptions} [options={}]
 *                                    Extra/overriding sign options (e.g.
 *                                    `expiresIn`, `issuer`, `audience`,
 *                                    `subject`, `jwtid`). Values here take
 *                                    precedence over the defaults.
 * @returns {string} The signed, compact-serialization JWT access token.
 * @throws {TypeError} If `payload` is not a plain object.
 * @throws {Error} If `jsonwebtoken` rejects the payload/options (propagated).
 */
function signAccessToken(payload, options = {}) {
  assertSignablePayload(payload, "signAccessToken");
  const cfg = loadJwtConfig();
  return jwt.sign(payload, cfg.secret, {
    expiresIn: cfg.expiresIn,
    issuer: DEFAULT_ISSUER,
    ...options,
  });
}

/**
 * Sign a long-lived REFRESH token.
 *
 * Identical in shape to {@link signAccessToken} but signed with the SEPARATE
 * refresh secret (`config.jwt.refreshSecret`) and the longer refresh TTL
 * (`config.jwt.refreshExpiresIn`, default `7d`). Keeping a distinct secret for
 * refresh tokens means a leaked access secret cannot be used to mint refresh
 * tokens (and vice-versa) once operators configure distinct secrets.
 *
 * As with {@link signAccessToken}, the caller's `payload` is not mutated.
 *
 * @param {Object} payload            Plain claims object (typically just the
 *                                    identity claims needed to re-issue an
 *                                    access token later, e.g. `{ sub, role }`).
 * @param {import("jsonwebtoken").SignOptions} [options={}]
 *                                    Extra/overriding sign options.
 * @returns {string} The signed, compact-serialization JWT refresh token.
 * @throws {TypeError} If `payload` is not a plain object.
 * @throws {Error} If `jsonwebtoken` rejects the payload/options (propagated).
 */
function signRefreshToken(payload, options = {}) {
  assertSignablePayload(payload, "signRefreshToken");
  const cfg = loadJwtConfig();
  return jwt.sign(payload, cfg.refreshSecret, {
    expiresIn: cfg.refreshExpiresIn,
    issuer: DEFAULT_ISSUER,
    ...options,
  });
}

/**
 * Verify and decode an ACCESS token.
 *
 * Verifies the signature against the access secret (`config.jwt.secret`) and
 * asserts the `issuer` claim equals {@link DEFAULT_ISSUER} (`"hms"`). On
 * success it returns the decoded claims object.
 *
 * Errors are intentionally NOT caught or transformed here — they are allowed to
 * propagate so callers can distinguish failure modes:
 *
 *   - `TokenExpiredError`  — the token was well-formed and correctly signed but
 *                            has expired.
 *   - `JsonWebTokenError`  — the token is malformed, has a bad signature, or
 *                            fails a claim assertion (e.g. wrong issuer). The
 *                            more specific `NotBeforeError` is a subclass.
 *
 * `rbac.js` relies on this behaviour: it catches these error types and maps
 * them to an HTTP 401 response. Do NOT wrap these in a custom error type here.
 *
 * @param {string} token The compact-serialization JWT access token to verify.
 * @returns {Object} The verified, decoded claims payload.
 * @throws {import("jsonwebtoken").TokenExpiredError} If the token has expired.
 * @throws {import("jsonwebtoken").JsonWebTokenError} If the token is invalid
 *   (bad signature, malformed, wrong issuer, or otherwise unverifiable).
 */
function verifyAccessToken(token) {
  const cfg = loadJwtConfig();
  return jwt.verify(token, cfg.secret, { issuer: DEFAULT_ISSUER });
}

/**
 * Verify and decode a REFRESH token.
 *
 * Identical to {@link verifyAccessToken} but verifies against the refresh
 * secret (`config.jwt.refreshSecret`). The same error types propagate on
 * failure and MUST NOT be swallowed here.
 *
 * NOTE: When `JWT_SECRET` and `JWT_REFRESH_SECRET` are configured with the SAME
 * value (as they are with the shipped `"change_me"` defaults), a refresh token
 * will also validate under {@link verifyAccessToken} and vice-versa, because
 * the signatures are computed with the same key. Cross-class rejection is a
 * property of using DISTINCT secrets in a real deployment; the `issuer`
 * assertion alone does not separate the two classes.
 *
 * @param {string} token The compact-serialization JWT refresh token to verify.
 * @returns {Object} The verified, decoded claims payload.
 * @throws {import("jsonwebtoken").TokenExpiredError} If the token has expired.
 * @throws {import("jsonwebtoken").JsonWebTokenError} If the token is invalid.
 */
function verifyRefreshToken(token) {
  const cfg = loadJwtConfig();
  return jwt.verify(token, cfg.refreshSecret, { issuer: DEFAULT_ISSUER });
}

/**
 * Issue a fresh ACCESS token from a valid REFRESH token.
 *
 * The refresh token is first verified via {@link verifyRefreshToken}; if it is
 * invalid or expired that verification error propagates unchanged (the caller
 * decides how to respond, typically 401). On success, the JWT-managed claims
 * listed in {@link REFRESH_STRIP_CLAIMS} are removed from the decoded payload
 * so they are freshly generated for the new access token, and the remaining
 * identity claims (`sub`, `role`, `email`, and any custom claims) are carried
 * over. The cleaned payload is then signed with {@link signAccessToken},
 * producing a new short-lived access token with a fresh `exp`.
 *
 * Scope note: this is only the token-minting PRIMITIVE. Refresh-token rotation,
 * reuse detection, and blacklist/allow-list enforcement are policy concerns
 * owned by the caller (auth-service); this module intentionally does not
 * persist or track tokens.
 *
 * @param {string} refreshToken A valid, unexpired refresh token.
 * @returns {string} A newly signed access token bearing the carried-over
 *   identity claims and a fresh expiry.
 * @throws {import("jsonwebtoken").TokenExpiredError} If the refresh token has
 *   expired (propagated from {@link verifyRefreshToken}).
 * @throws {import("jsonwebtoken").JsonWebTokenError} If the refresh token is
 *   invalid (propagated from {@link verifyRefreshToken}).
 */
function refreshAccessToken(refreshToken) {
  const decoded = verifyRefreshToken(refreshToken);

  // Copy the verified claims and drop the JWT-managed ones so the new access
  // token gets fresh timing/issuer claims (and so the sign step does not throw
  // on a claim that is present in both the payload and the sign options).
  const cleanedPayload = { ...decoded };
  for (const claim of REFRESH_STRIP_CLAIMS) {
    delete cleanedPayload[claim];
  }

  return signAccessToken(cleanedPayload);
}

/**
 * Decode a token WITHOUT verifying its signature or claims.
 *
 * This is for INSPECTION ONLY (e.g. reading the `sub`/`role` of a token whose
 * signature will be verified elsewhere, or debugging). It performs NO
 * cryptographic verification and NO expiry/issuer checks, so its output MUST
 * NOT be used for any authentication or authorization decision — use
 * {@link verifyAccessToken} / {@link verifyRefreshToken} for that.
 *
 * Unlike the verify helpers, this never throws for a malformed token: a token
 * that cannot be decoded yields `null`.
 *
 * @param {string} token The compact-serialization JWT to decode.
 * @returns {(Object|null)} The decoded claims payload, or `null` if the token
 *   cannot be decoded.
 */
function decodeToken(token) {
  return jwt.decode(token, { complete: false });
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  refreshAccessToken,
  decodeToken,
};
