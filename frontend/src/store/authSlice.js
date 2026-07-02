/**
 * @file frontend/src/store/authSlice.js
 * @module store/authSlice
 *
 * Redux Toolkit (RTK) slice that owns the HMS SPA's **global authentication &
 * authorization state**. It is combined into the root store under the key
 * `auth` by the sibling `store/store.js`, so every field below is read from the
 * Redux tree as `state.auth.<field>`.
 *
 * This slice is the single source of truth for:
 *   - the logged-in `user` profile,
 *   - the JWT `accessToken` / `refreshToken` pair,
 *   - the user's `role` (drives client-side, defense-in-depth RBAC),
 *   - the `mfaRequired` challenge flag (multi-factor auth for privileged users),
 *   - and the session-timeout tracking fields `lastActivityAt` / `expiresAt` /
 *     `status`.
 *
 * ---------------------------------------------------------------------------
 * SPEC GROUNDING
 * ---------------------------------------------------------------------------
 * @see 02_Hospital_Management_Functional_Requirements_Specification --
 *      "Authentication & Authorization": secure login with role-based access
 *      control, multi-factor authentication for privileged users, session
 *      timeout and audit logging. Justifies `role`, `mfaRequired`, and the
 *      `lastActivityAt` / `expiresAt` / `status` session fields.
 * @see 03_Hospital_Management_Technical_Architecture -- "Security Architecture":
 *      JWT-based authentication, role-based authorization, API gateway
 *      protection. Justifies `accessToken` / `refreshToken` and `role`.
 *
 * ---------------------------------------------------------------------------
 * DEPENDENCY DISCIPLINE -- READ BEFORE ADDING IMPORTS (cycle-free invariant)
 * ---------------------------------------------------------------------------
 * This module imports ONLY from `@reduxjs/toolkit`, the `jwt-decode` package,
 * and the sibling `../utils` modules. It deliberately does NOT import `axios`
 * and NOTHING from `../services` at module scope.
 *
 * Reason: `services/apiClient.js` imports the store
 * (`import { store } from '../store/store'`) to read the Bearer token and to
 * dispatch `setTokens` / `logout` from its 401 -> silent-refresh interceptor.
 * The dependency direction is therefore strictly **services -> store**.
 * Importing anything from `../services` here would close that loop into a
 * circular import. The actual HTTP login / refresh network calls live in
 * `services/authService`; components and hooks dispatch the PLAIN action
 * creators defined below with the results of those calls.
 *
 * ---------------------------------------------------------------------------
 * SERIALIZABILITY
 * ---------------------------------------------------------------------------
 * Every value kept in this slice is a serializable primitive or plain object
 * (string / number / boolean / null / plain object) so RTK's default
 * `serializableCheck` middleware stays quiet. Timestamps are stored as
 * epoch-millisecond NUMBERS via `Date.now()` -- NEVER `Date` instances.
 *
 * ---------------------------------------------------------------------------
 * INTENTIONAL SIDE EFFECTS
 * ---------------------------------------------------------------------------
 * `setCredentials` and `setTokens` persist tokens via `setStoredAuth(...)`, and
 * `logout` clears them via `clearTokens()`. These localStorage writes are an
 * intentional, spec-directed pattern that keeps the persisted tokens in lockstep
 * with Redux. They are safe because `../utils/tokenStorage` is exception-safe
 * (it never throws and transparently falls back to in-memory storage under SSR
 * or when Web Storage is unavailable). NO network calls are performed here.
 */

import { createSlice } from '@reduxjs/toolkit';
// jwt-decode v4 exposes a NAMED export (`jwtDecode`), NOT a default export.
import { jwtDecode } from 'jwt-decode';
import { getStoredAuth, setStoredAuth, clearTokens } from '../utils/tokenStorage';
import { ROLE_VALUES } from '../utils/constants';

/* -------------------------------------------------------------------------- */
/* Module-private helpers                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Safely base64-decode a JWT's payload.
 *
 * IMPORTANT: `jwt-decode` only decodes the payload -- it does NOT verify the
 * token's signature. Signature verification is the backend / API gateway's
 * responsibility. This helper is used solely to read non-sensitive claims
 * (`role`, `exp`) for client-side UX (RBAC hints, expiry tracking).
 *
 * @param {string | null | undefined} token A raw JWT access token.
 * @returns {Record<string, unknown> | null} The decoded claims object, or
 *   `null` when the token is falsy or cannot be decoded (malformed token).
 */
function decodeToken(token) {
  if (!token) {
    return null;
  }
  try {
    return jwtDecode(token);
  } catch {
    // A malformed / opaque token must never crash the reducer or app bootstrap.
    return null;
  }
}

/**
 * Extract a valid HMS role from decoded JWT claims.
 *
 * The backend places the role VALUE string (one of {@link ROLE_VALUES}) into
 * the JWT `role` claim. Any value not in the exact 8-role vocabulary is
 * rejected so client-side RBAC never trusts an unknown role.
 *
 * @param {Record<string, unknown> | null | undefined} decoded Decoded claims.
 * @returns {string | null} The role string when it is one of the 8 canonical
 *   roles, otherwise `null`.
 */
function roleFromClaims(decoded) {
  const role = decoded?.role;
  return ROLE_VALUES.includes(role) ? role : null;
}

/**
 * Derive the token expiry (as epoch milliseconds) from decoded JWT claims.
 *
 * The standard JWT `exp` claim is expressed in **seconds** since the Unix
 * epoch; this converts it to milliseconds to match the rest of the slice's
 * `Date.now()`-based timestamps.
 *
 * @param {Record<string, unknown> | null | undefined} decoded Decoded claims.
 * @returns {number | null} `exp * 1000` when `exp` is a finite number,
 *   otherwise `null`.
 */
function expiryFromClaims(decoded) {
  const exp = decoded?.exp;
  // `Number.isFinite` (not the global `isFinite`) rejects non-numbers without
  // coercion, so a missing or non-numeric `exp` correctly yields `null`.
  return Number.isFinite(exp) ? exp * 1000 : null;
}

/* -------------------------------------------------------------------------- */
/* Initial state                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build the initial `state.auth` shape, hydrated from persisted tokens.
 *
 * Reading tokens from `tokenStorage` on module load lets a full page refresh
 * keep the user signed in: the access token (and the `role` recovered from it)
 * survive the reload without a round-trip to the backend. The full `user`
 * profile is intentionally NOT persisted -- it is re-populated by
 * `setCredentials` on the next login, or lazily re-fetched by the app shell.
 *
 * @returns {AuthState} The hydrated initial auth state.
 */
function buildInitialState() {
  const { accessToken, refreshToken } = getStoredAuth();
  const decoded = decodeToken(accessToken);

  return {
    accessToken: accessToken || null,
    refreshToken: refreshToken || null,
    // Full profile is set by `setCredentials` on login; it is not persisted.
    user: null,
    // Recovered from the stored access token so a refresh keeps RBAC working.
    role: roleFromClaims(decoded),
    mfaRequired: false,
    isAuthenticated: Boolean(accessToken),
    lastActivityAt: accessToken ? Date.now() : null,
    expiresAt: expiryFromClaims(decoded),
    status: accessToken ? 'authenticated' : 'idle',
    error: null,
  };
}

/**
 * The shape of `state.auth`.
 *
 * @typedef {Object} AuthState
 * @property {string | null} accessToken   Raw JWT access token, or `null`.
 * @property {string | null} refreshToken  Raw JWT refresh token, or `null`.
 * @property {Object | null} user          Logged-in user profile, or `null`.
 * @property {string | null} role          One of {@link ROLE_VALUES}, or `null`.
 * @property {boolean} mfaRequired         `true` while an MFA challenge is
 *   pending for a privileged login.
 * @property {boolean} isAuthenticated     `true` once a valid access token is
 *   present.
 * @property {number | null} lastActivityAt Epoch-ms of the last user activity
 *   (drives idle-timeout), or `null` when signed out.
 * @property {number | null} expiresAt     Epoch-ms access-token expiry derived
 *   from the JWT `exp` claim, or `null` when unknown.
 * @property {('idle'|'authenticated'|'mfa_required'|'unauthenticated')} status
 *   Coarse auth lifecycle state:
 *     - 'idle'            -- app boot with no session (never signed in).
 *     - 'authenticated'   -- a valid access token is held.
 *     - 'mfa_required'    -- credentials accepted; awaiting MFA challenge.
 *     - 'unauthenticated' -- explicitly signed out or session expired.
 * @property {string | null} error         Last auth error message (e.g. a
 *   "session expired" note set on `logout`), or `null`.
 */

/**
 * The initial `state.auth`, hydrated once at module-evaluation time.
 * @type {AuthState}
 */
const initialState = buildInitialState();

/* -------------------------------------------------------------------------- */
/* Slice                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The `auth` slice. Reducers are written Immer-style: they mutate the `state`
 * draft in place and return nothing. The action creators and reducer are
 * exported below.
 */
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /**
     * Store the user, role, and tokens after a successful (post-MFA) login.
     *
     * Dispatched by the login / MFA flow with the payload returned by
     * `services/authService`. Persists the tokens to storage so the session
     * survives a page refresh.
     *
     * @param {AuthState} state
     * @param {{ payload: {
     *   user?: Object | null,
     *   role?: string,
     *   accessToken?: string | null,
     *   refreshToken?: string | null,
     *   mfaRequired?: boolean,
     *   expiresAt?: number | null,
     * } }} action
     */
    setCredentials(state, action) {
      const {
        user,
        role,
        accessToken,
        refreshToken,
        mfaRequired,
        expiresAt,
      } = action.payload ?? {};

      state.accessToken = accessToken ?? null;
      state.refreshToken = refreshToken ?? state.refreshToken ?? null;

      // Intentional, spec-directed side effect: keep persisted tokens in sync.
      setStoredAuth({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      });

      const decoded = decodeToken(state.accessToken);

      // Role precedence: an explicit, valid payload role wins; otherwise fall
      // back to the role encoded in the JWT; otherwise `null`. Never store a
      // role outside the canonical 8 (ROLE_VALUES).
      state.role = ROLE_VALUES.includes(role) ? role : roleFromClaims(decoded);

      // Prefer the JWT-derived expiry; fall back to an explicit payload value.
      state.expiresAt = expiryFromClaims(decoded) ?? (expiresAt ?? null);

      state.user = user ?? state.user ?? null;
      state.isAuthenticated = Boolean(state.accessToken);
      // Login success normally clears any pending MFA challenge.
      state.mfaRequired = mfaRequired ?? false;
      state.status = 'authenticated';
      state.error = null;
      state.lastActivityAt = Date.now();
    },

    /**
     * Replace the tokens after a silent refresh, preserving `user` / `role`.
     *
     * Dispatched by the `services/apiClient` 401 -> refresh interceptor. When a
     * fresh access token is present the session is (re-)marked authenticated;
     * when it is falsy the refresh is treated as a failure and left for
     * `logout` to fully tear down (this reducer does not force-authenticate).
     *
     * @param {AuthState} state
     * @param {{ payload: {
     *   accessToken?: string | null,
     *   refreshToken?: string | null,
     * } }} action
     */
    setTokens(state, action) {
      const { accessToken, refreshToken } = action.payload ?? {};

      state.accessToken = accessToken ?? null;
      // Only touch the refresh token when the caller explicitly provided one,
      // so a plain access-token rotation keeps the existing refresh token.
      if (refreshToken !== undefined) {
        state.refreshToken = refreshToken || null;
      }

      // Intentional, spec-directed side effect: keep persisted tokens in sync.
      setStoredAuth({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      });

      state.expiresAt = expiryFromClaims(decodeToken(state.accessToken));

      if (state.accessToken) {
        state.isAuthenticated = true;
        state.status = 'authenticated';
      }
      state.error = null;
    },

    /**
     * Flag that the current login requires an MFA challenge (privileged user).
     *
     * A payload MAY be dispatched with this action, but it is intentionally
     * ignored -- no MFA secret or challenge material is ever stored in Redux.
     *
     * @param {AuthState} state
     */
    setMfaRequired(state) {
      state.mfaRequired = true;
      state.status = 'mfa_required';
      state.isAuthenticated = false;
    },

    /**
     * Clear the MFA-required flag once the challenge is satisfied or cancelled.
     *
     * Restores `status` to `'authenticated'` when a session already exists,
     * otherwise to `'idle'`.
     *
     * @param {AuthState} state
     */
    clearMfaRequired(state) {
      state.mfaRequired = false;
      state.status = state.isAuthenticated ? 'authenticated' : 'idle';
    },

    /**
     * Record the timestamp of the latest user activity for idle-timeout
     * tracking. Dispatched by `hooks/useSessionTimeout` on user interaction.
     *
     * @param {AuthState} state
     * @param {{ payload?: number }} action A specific epoch-ms timestamp, or
     *   any non-number (or omitted) payload to stamp the current time.
     */
    updateLastActivity(state, action) {
      state.lastActivityAt =
        typeof action.payload === 'number' ? action.payload : Date.now();
    },

    /**
     * Sign the user out: reset ALL auth state and clear persisted tokens.
     *
     * @param {AuthState} state
     * @param {{ payload?: { error?: string | null } }} [action] Optional
     *   payload; a `{ error }` message surfaces a reason (e.g. "session
     *   expired") for the login screen. Defaults to `null`.
     */
    logout(state, action) {
      state.accessToken = null;
      state.refreshToken = null;
      state.user = null;
      state.role = null;
      state.mfaRequired = false;
      state.isAuthenticated = false;
      state.lastActivityAt = null;
      state.expiresAt = null;
      state.status = 'unauthenticated';
      state.error = action?.payload?.error ?? null;

      // Deliberate side effect specified by the AAP: purge the persisted
      // `hms.accessToken` + `hms.refreshToken` so a logout fully ends the
      // session even across reloads. `clearTokens()` never throws.
      clearTokens();
    },
  },
});

/* -------------------------------------------------------------------------- */
/* Action creators                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Plain action creators. Components / hooks / services dispatch these with the
 * results of their (network) work -- this slice performs no network I/O itself.
 */
export const {
  setCredentials,
  setTokens,
  setMfaRequired,
  clearMfaRequired,
  updateLastActivity,
  logout,
} = authSlice.actions;

/* -------------------------------------------------------------------------- */
/* Selectors                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Select the entire `auth` slice.
 * @param {{ auth: AuthState }} state
 * @returns {AuthState}
 */
export const selectAuth = (state) => state.auth;

/**
 * Select the current user's role (one of {@link ROLE_VALUES}), or `null`.
 * @param {{ auth: AuthState }} state
 * @returns {string | null}
 */
export const selectRole = (state) => state.auth.role;

/**
 * Select whether the user is authenticated (a valid access token is held).
 * @param {{ auth: AuthState }} state
 * @returns {boolean}
 */
export const selectIsAuthenticated = (state) => state.auth.isAuthenticated;

/**
 * Select whether an MFA challenge is currently pending.
 * @param {{ auth: AuthState }} state
 * @returns {boolean}
 */
export const selectMfaRequired = (state) => state.auth.mfaRequired;

/**
 * Select the logged-in user profile, or `null`.
 * @param {{ auth: AuthState }} state
 * @returns {Object | null}
 */
export const selectUser = (state) => state.auth.user;

/**
 * Select the raw JWT access token, or `null`.
 * @param {{ auth: AuthState }} state
 * @returns {string | null}
 */
export const selectAccessToken = (state) => state.auth.accessToken;

/**
 * Select the access-token expiry (epoch-ms), or `null` when unknown.
 * @param {{ auth: AuthState }} state
 * @returns {number | null}
 */
export const selectExpiresAt = (state) => state.auth.expiresAt;

/**
 * Select the coarse auth lifecycle status.
 * @param {{ auth: AuthState }} state
 * @returns {('idle'|'authenticated'|'mfa_required'|'unauthenticated')}
 */
export const selectAuthStatus = (state) => state.auth.status;

/**
 * Select the epoch-ms timestamp of the last recorded user activity, or `null`.
 * @param {{ auth: AuthState }} state
 * @returns {number | null}
 */
export const selectLastActivityAt = (state) => state.auth.lastActivityAt;

/* -------------------------------------------------------------------------- */
/* Reducer (default export)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The `auth` reducer. Imported by `store/store.js` (as `authReducer`) and
 * combined under the `auth` key.
 */
export default authSlice.reducer;
