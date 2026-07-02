/**
 * @module utils/tokenStorage
 *
 * Thin, SSR-safe and exception-safe persistence layer for the Hospital
 * Management System (HMS) JSON Web Tokens (JWTs).
 *
 * The HMS backend issues short-lived access tokens and longer-lived refresh
 * tokens as part of its JWT-based authentication scheme (see
 * "03_Hospital_Management_Technical_Architecture" -> Security Architecture:
 * "JWT-based authentication", "Role-based authorization"). This module is the
 * single, centralized place the SPA reads and writes those raw token strings.
 *
 * Consumers:
 *   - services/apiClient.js  attaches the access token as the
 *     `Authorization: Bearer <accessToken>` header on outgoing requests, and
 *     reads/rotates the refresh token during the 401 "silent refresh" flow.
 *   - store/authSlice        hydrates the initial auth state on app load
 *     (getStoredAuth), persists tokens on successful login (setStoredAuth), and
 *     clears them on logout / refresh failure (clearTokens).
 *
 * ---------------------------------------------------------------------------
 * SECURITY NOTE - READ BEFORE CHANGING
 * ---------------------------------------------------------------------------
 * Tokens are persisted in Web Storage (localStorage by default). Any JavaScript
 * executing on the page - including malicious script injected via an XSS
 * vulnerability - can read Web Storage, so tokens kept here are susceptible to
 * XSS-based token theft. Persisting JWTs client-side is an accepted trade-off
 * for this SPA architecture (stateless JWT auth, doc 03) in exchange for a
 * simpler, cookie-less API gateway integration.
 *
 * To keep the blast radius of any such theft minimal:
 *   - Store ONLY the JWTs here. NEVER store passwords, API secrets, or any
 *     patient PII / PHI. Patient data is encrypted and kept server-side per the
 *     architecture's "Encrypted patient data storage".
 *   - Keep access-token lifetimes short and rely on refresh-token rotation.
 *
 * If security requirements later harden, migrate token transport to `httpOnly`,
 * `Secure`, `SameSite` cookies (which are unreadable by JavaScript). Because
 * every read/write funnels through this module and the STORAGE_KEYS constants,
 * that migration stays localized to this file plus the apiClient refresh flow.
 *
 * This module performs NO network calls and does NOT decode or verify JWTs - it
 * only stores and retrieves opaque token strings. JWT decoding lives in
 * store/authSlice and the auth hooks (via the `jwt-decode` package).
 */

/**
 * Centralized, namespaced Web Storage keys for the HMS auth tokens.
 *
 * Every read/write in this module (and any future token-related code) MUST use
 * these constants rather than inlining raw string keys, so the storage schema
 * stays consistent and greppable. The object is frozen to prevent accidental
 * mutation at runtime.
 *
 * @readonly
 * @constant
 * @type {Readonly<{ ACCESS_TOKEN: string, REFRESH_TOKEN: string }>}
 */
export const STORAGE_KEYS = Object.freeze({
  /** Web Storage key holding the raw JWT access token. */
  ACCESS_TOKEN: 'hms.accessToken',
  /** Web Storage key holding the raw JWT refresh token. */
  REFRESH_TOKEN: 'hms.refreshToken',
});

/**
 * Module-level, in-memory fallback that mirrors the subset of the Web Storage
 * API this module relies on. It is used whenever the real `localStorage` is
 * unavailable - e.g. server-side rendering (no `window`), privacy/incognito
 * modes that disable storage, disabled cookies, or sandboxed iframes that throw
 * on storage access. Backing it with a `Map` guarantees the public API never
 * throws and remains usable in Node/SSR and unit tests.
 *
 * Behaviour intentionally matches native Web Storage semantics:
 *   - `getItem` returns `null` (not `undefined`) for absent keys.
 *   - `setItem` coerces the value to a string, exactly like `Storage.setItem`.
 *
 * @type {{
 *   getItem: (key: string) => (string | null),
 *   setItem: (key: string, value: string) => void,
 *   removeItem: (key: string) => void,
 * }}
 */
const memoryStorage = (() => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
})();

/**
 * Resolve the active storage backend.
 *
 * Returns the browser's `localStorage` when it is present and accessible;
 * otherwise returns the in-memory {@link memoryStorage} fallback so callers
 * never have to reason about missing or throwing storage.
 *
 * `localStorage` is used (rather than `sessionStorage`) so a signed-in session
 * survives page reloads and is shared across tabs of the same origin. Switching
 * to session-scoped tokens is a one-line change: swap `window.localStorage` for
 * `window.sessionStorage` below.
 *
 * NOTE: This accessor is intentionally NOT memoized. Reading it fresh on every
 * call keeps behaviour correct if storage availability changes at runtime and
 * lets tests stub storage between assertions.
 *
 * @returns {{
 *   getItem: (key: string) => (string | null),
 *   setItem: (key: string, value: string) => void,
 *   removeItem: (key: string) => void,
 * }} The browser `localStorage`, or the in-memory fallback.
 */
function getStorage() {
  // SSR / non-browser guard: `window` is undefined under Node (SSR, or tests
  // running without jsdom), so fall straight back to in-memory storage.
  if (typeof window === 'undefined') {
    return memoryStorage;
  }

  try {
    // Merely *accessing* `window.localStorage` can throw a SecurityError in
    // sandboxed iframes or when storage is disabled, hence the try/catch.
    const storage = window.localStorage;
    if (storage) {
      return storage;
    }
  } catch {
    // Storage disabled or unavailable - degrade to the in-memory fallback.
  }

  return memoryStorage;
}

/**
 * Read a single token value for the given storage key.
 *
 * @param {string} key One of the {@link STORAGE_KEYS} values.
 * @returns {string | null} The stored token, or `null` when it is absent or the
 *   underlying storage throws. The error is never propagated to the caller.
 */
function readToken(key) {
  try {
    return getStorage().getItem(key);
  } catch {
    // Reads must never throw - treat any failure as "no token".
    return null;
  }
}

/**
 * Persist (or clear) a single token value for the given storage key.
 *
 * A valid token is a non-empty string. Any other input - `null`, `undefined`,
 * an empty string, or a non-string value - is treated as a request to REMOVE
 * the key, so the literal strings `"null"` / `"undefined"` are never persisted
 * (they would otherwise be mistaken for a real token on the next read).
 *
 * @param {string} key One of the {@link STORAGE_KEYS} values.
 * @param {string | null | undefined} token The raw token to store, or a
 *   falsy/empty value to remove the key.
 * @returns {void} Silently no-ops if the underlying storage throws.
 */
function writeToken(key, token) {
  try {
    if (typeof token === 'string' && token.length > 0) {
      getStorage().setItem(key, token);
    } else {
      getStorage().removeItem(key);
    }
  } catch {
    // Writes must never throw - a failed persist degrades to a no-op.
  }
}

/**
 * Remove a single token value for the given storage key.
 *
 * @param {string} key One of the {@link STORAGE_KEYS} values.
 * @returns {void} Silently no-ops if the underlying storage throws.
 */
function removeToken(key) {
  try {
    getStorage().removeItem(key);
  } catch {
    // Removal must never throw.
  }
}

/**
 * Get the persisted JWT access token.
 *
 * Consumer: services/apiClient.js attaches it as `Authorization: Bearer <token>`.
 *
 * @returns {string | null} The access token, or `null` when none is stored or
 *   on any storage failure.
 */
export function getAccessToken() {
  return readToken(STORAGE_KEYS.ACCESS_TOKEN);
}

/**
 * Persist the JWT access token.
 *
 * Passing `null`, `undefined`, or an empty string removes the key instead of
 * storing a placeholder - see {@link writeToken}.
 *
 * @param {string | null | undefined} token The raw access token, or a
 *   falsy/empty value to clear it.
 * @returns {void} Never throws.
 */
export function setAccessToken(token) {
  writeToken(STORAGE_KEYS.ACCESS_TOKEN, token);
}

/**
 * Get the persisted JWT refresh token.
 *
 * Consumer: services/apiClient.js reads and rotates it during the 401 refresh
 * flow.
 *
 * @returns {string | null} The refresh token, or `null` when none is stored or
 *   on any storage failure.
 */
export function getRefreshToken() {
  return readToken(STORAGE_KEYS.REFRESH_TOKEN);
}

/**
 * Persist the JWT refresh token.
 *
 * Passing `null`, `undefined`, or an empty string removes the key - see
 * {@link writeToken}.
 *
 * @param {string | null | undefined} token The raw refresh token, or a
 *   falsy/empty value to clear it.
 * @returns {void} Never throws.
 */
export function setRefreshToken(token) {
  writeToken(STORAGE_KEYS.REFRESH_TOKEN, token);
}

/**
 * Read both tokens at once.
 *
 * Consumer: store/authSlice uses this to hydrate the initial auth state when
 * the app boots.
 *
 * @returns {{ accessToken: (string | null), refreshToken: (string | null) }}
 *   The currently stored tokens, each `null` when absent or on failure.
 */
export function getStoredAuth() {
  return {
    accessToken: getAccessToken(),
    refreshToken: getRefreshToken(),
  };
}

/**
 * Persist both tokens at once (convenience used on login success).
 *
 * Accepts a PARTIAL object: only the fields that are explicitly present on
 * `auth` are written. A present field whose value is `null`/`undefined`/empty
 * removes that key, while an absent field is left untouched. This lets callers
 * update just one token (e.g. rotate only the access token after a refresh)
 * without disturbing the other.
 *
 * @param {{ accessToken?: (string | null), refreshToken?: (string | null) }} [auth]
 *   Partial auth object. A `null`, `undefined`, or non-object argument is
 *   ignored.
 * @returns {void} Never throws.
 */
export function setStoredAuth(auth) {
  // Guard against null / undefined / non-object input without throwing
  // (`typeof null === 'object'`, hence the explicit null check).
  if (auth === null || typeof auth !== 'object') {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(auth, 'accessToken')) {
    setAccessToken(auth.accessToken);
  }
  if (Object.prototype.hasOwnProperty.call(auth, 'refreshToken')) {
    setRefreshToken(auth.refreshToken);
  }
}

/**
 * Remove BOTH tokens.
 *
 * Consumer: store/authSlice calls this on logout and on an unrecoverable
 * refresh failure. Guaranteed never to throw, even when storage is unavailable.
 *
 * @returns {void} Never throws.
 */
export function clearTokens() {
  removeToken(STORAGE_KEYS.ACCESS_TOKEN);
  removeToken(STORAGE_KEYS.REFRESH_TOKEN);
}
