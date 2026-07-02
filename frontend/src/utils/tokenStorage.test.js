/**
 * @vitest-environment jsdom
 *
 * Unit tests for {@link module:utils/tokenStorage} — the SSR-safe,
 * exception-safe persistence layer for the HMS JWT access/refresh tokens.
 *
 * These tests exercise the module's public API only (never its private
 * in-memory fallback) against the jsdom-provided `window.localStorage`:
 *   - STORAGE_KEYS shape/immutability
 *   - access & refresh token round-trips (getter + raw storage key)
 *   - null / empty removal semantics (the literal string "null" must never
 *     be persisted)
 *   - getStoredAuth / setStoredAuth (full, partial and cleared states)
 *   - failure safety: the public API must never throw and reads must degrade
 *     to `null` when the underlying Web Storage throws (quota / SecurityError)
 *
 * The suite explicitly imports the Vitest globals (even though the harness
 * runs with `globals: true`) so the file is self-describing and robust when
 * executed in isolation. The `@vitest-environment jsdom` docblock above
 * guarantees a DOM-backed `localStorage` regardless of the project-wide
 * default environment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  STORAGE_KEYS,
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  getStoredAuth,
  setStoredAuth,
  clearTokens,
} from './tokenStorage';

// ---------------------------------------------------------------------------
// Test isolation
// ---------------------------------------------------------------------------
// Every test must be order-independent. `beforeEach` starts each test from an
// empty store, and `afterEach` both restores any spies installed by the
// failure-safety cases (so a throwing `setItem`/`getItem` never leaks into the
// next test) and clears the store again once mocks are back to normal.
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Phase 1 — Keys
// ---------------------------------------------------------------------------
describe('STORAGE_KEYS', () => {
  it('exposes the namespaced HMS access/refresh token keys', () => {
    expect(STORAGE_KEYS.ACCESS_TOKEN).toBe('hms.accessToken');
    expect(STORAGE_KEYS.REFRESH_TOKEN).toBe('hms.refreshToken');
  });

  it('is frozen to prevent accidental runtime mutation', () => {
    expect(Object.isFrozen(STORAGE_KEYS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — Access / refresh round-trip
// ---------------------------------------------------------------------------
describe('access / refresh token round-trip', () => {
  it('persists and reads back the access token (incl. the raw storage key)', () => {
    setAccessToken('abc');

    expect(getAccessToken()).toBe('abc');
    // The value is stored verbatim under the namespaced key (no wrapping).
    expect(localStorage.getItem('hms.accessToken')).toBe('abc');
  });

  it('persists and reads back the refresh token (incl. the raw storage key)', () => {
    setRefreshToken('rt');

    expect(getRefreshToken()).toBe('rt');
    expect(localStorage.getItem('hms.refreshToken')).toBe('rt');
  });

  it('returns null for both tokens when storage is empty', () => {
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — Null / empty removal semantics
// ---------------------------------------------------------------------------
describe('null / empty removal semantics', () => {
  it('removes the access token when set to null (never persists "null")', () => {
    setAccessToken('abc');
    expect(getAccessToken()).toBe('abc');

    setAccessToken(null);

    expect(getAccessToken()).toBeNull();
    // The key must be absent — not the literal string "null", which would be
    // mistaken for a real token on the next read.
    expect(localStorage.getItem('hms.accessToken')).toBeNull();
    expect(localStorage.getItem('hms.accessToken')).not.toBe('null');
  });

  it('removes the access token when set to an empty string', () => {
    setAccessToken('abc');
    expect(getAccessToken()).toBe('abc');

    setAccessToken('');

    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem('hms.accessToken')).toBeNull();
  });

  it('removes the refresh token when set to null', () => {
    setRefreshToken('rt');
    expect(getRefreshToken()).toBe('rt');

    setRefreshToken(null);

    expect(getRefreshToken()).toBeNull();
    expect(localStorage.getItem('hms.refreshToken')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — getStoredAuth / setStoredAuth
// ---------------------------------------------------------------------------
describe('getStoredAuth / setStoredAuth', () => {
  it('round-trips both tokens as a single auth object', () => {
    setStoredAuth({ accessToken: 'a', refreshToken: 'r' });

    expect(getStoredAuth()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('reports both tokens as null after clearTokens()', () => {
    setStoredAuth({ accessToken: 'a', refreshToken: 'r' });

    clearTokens();

    expect(getStoredAuth()).toEqual({ accessToken: null, refreshToken: null });
  });

  it('applies a partial update, leaving the omitted token null', () => {
    setStoredAuth({ accessToken: 'a' });

    expect(getStoredAuth()).toEqual({ accessToken: 'a', refreshToken: null });
  });

  it('leaves an existing token untouched when omitted from a partial update', () => {
    setStoredAuth({ accessToken: 'a', refreshToken: 'r' });

    // Rotate only the access token; the refresh token must survive untouched.
    setStoredAuth({ accessToken: 'a2' });

    expect(getStoredAuth()).toEqual({ accessToken: 'a2', refreshToken: 'r' });
  });

  it('ignores null, undefined and non-object input without throwing', () => {
    setStoredAuth({ accessToken: 'a', refreshToken: 'r' });

    expect(() => setStoredAuth(null)).not.toThrow();
    expect(() => setStoredAuth(undefined)).not.toThrow();
    expect(() => setStoredAuth('not-an-object')).not.toThrow();

    // Existing tokens must be left completely undisturbed.
    expect(getStoredAuth()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — Failure safety (the underlying Web Storage throws)
// ---------------------------------------------------------------------------
describe('failure safety when Web Storage throws', () => {
  it('setAccessToken swallows a throwing setItem (e.g. quota exceeded)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => setAccessToken('x')).not.toThrow();
  });

  it('getAccessToken returns null and does not throw when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    let token;
    expect(() => {
      token = getAccessToken();
    }).not.toThrow();
    expect(token).toBeNull();
  });

  it('clearTokens does not throw when removeItem throws', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => clearTokens()).not.toThrow();
  });
});
