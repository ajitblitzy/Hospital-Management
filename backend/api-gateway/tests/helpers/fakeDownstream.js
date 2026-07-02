'use strict';

/**
 * fakeDownstream.js
 * -----------------------------------------------------------------------------
 * Ephemeral, in-process **fake downstream HTTP server** for the
 * `@hms/api-gateway` test suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * The API gateway proxies inbound requests to backend microservices. To assert
 * the gateway's proxy/routing/header-forwarding behavior *hermetically* — with
 * **no live Redis/Postgres/real services** — the integration tests in
 * `backend/api-gateway/tests/integration/` do the following:
 *
 *   1. `start()` this fake server (binds an OS-assigned ephemeral 127.0.0.1 port),
 *   2. point a `*_SERVICE_URL` env var at the returned `url`,
 *   3. build the gateway app and drive it through `supertest`,
 *   4. assert on exactly what arrived here (method, verbatim URL path, forwarded
 *      headers such as `x-request-id` / `authorization`, and body).
 *
 * The only network endpoint opened is this in-process server on 127.0.0.1, and
 * it is always torn down by the tests' `afterEach` / `afterAll` via `stop()`.
 * This keeps the suite deterministic and CI-friendly, per
 * `Hospital_Management_Documentation_Package/05_Hospital_Management_QA_Testing_and_DevOps_Strategy.pdf`
 * (automated, repeatable Unit / Integration / API testing).
 *
 * DESIGN CONSTRAINTS (intentional)
 * --------------------------------
 * - **Node core `http` ONLY.** No Express, no `http-proxy`, no third-party
 *   packages, and **no in-repo dependencies**. This keeps the helper foundational
 *   and free of import cycles.
 * - **Plain CommonJS** (`require` / `module.exports`). No ESM. Jest runs with
 *   `testEnvironment: 'node'` and CommonJS.
 * - **No Jest lifecycle code** lives here (no `describe`/`it`/`beforeEach`/etc.).
 *   This is a pure utility; the tests own their lifecycle. The filename is
 *   deliberately NOT `*.test.js`, so Jest's `testMatch` will not collect it.
 * - **Deterministic & side-effect-light.** No global state mutation, no
 *   `process.env` writes, and no console logging on the happy path. Every
 *   resource is fully tear-down-able.
 *
 * KEY BEHAVIOR (the linchpin for routing assertions)
 * ---------------------------------------------------
 * The gateway's `src/proxy.js` sets `pathRewrite: (path, req) => req.originalUrl`,
 * so a gateway request to `/api/patients/123` arrives here with
 * `req.url === '/api/patients/123'`. This helper therefore records `req.url`
 * **verbatim** and echoes it back — that is what routing tests assert against.
 *
 * @module tests/helpers/fakeDownstream
 */

const http = require('http');

/**
 * A single captured inbound request, recorded verbatim as it arrived at the
 * fake downstream server.
 *
 * @typedef {Object} CapturedRequest
 * @property {string} method  HTTP method (e.g. `'GET'`, `'POST'`).
 * @property {string} url     The request URL/path **exactly** as received
 *                            (e.g. `'/api/patients/123'`). Preserved verbatim.
 * @property {import('http').IncomingHttpHeaders} headers  Request headers as
 *                            received (e.g. `x-request-id`, `authorization`).
 * @property {string} body    The full request body decoded as a UTF-8 string
 *                            (empty string when there is no body).
 */

/**
 * Mutable response configuration. When `body` is `undefined` the server echoes
 * the captured request as JSON; otherwise it returns the configured `body`.
 *
 * @typedef {Object} ResponseConfig
 * @property {number} statusCode                 HTTP status code to respond with.
 * @property {Object<string,string>} [headers]   Response headers.
 * @property {(string|Object|undefined)} [body]  Response body. `undefined` =>
 *                                                echo the captured request.
 */

/**
 * The value the `start()` promise resolves to.
 *
 * @typedef {Object} StartResult
 * @property {import('http').Server} server  The underlying Node HTTP server.
 * @property {number} port                   The OS-assigned ephemeral port.
 * @property {string} url                     `http://127.0.0.1:<port>`.
 */

/**
 * The public interface returned by {@link createFakeDownstream}.
 *
 * @typedef {Object} FakeDownstream
 * @property {() => Promise<StartResult>} start
 * @property {() => Promise<void>} stop
 * @property {() => (CapturedRequest|undefined)} getLastRequest
 * @property {(cfg: Partial<ResponseConfig>) => void} setResponse
 * @property {() => void} reset
 * @property {CapturedRequest[]} requests
 */

/**
 * Create an ephemeral, in-process fake downstream HTTP server.
 *
 * The returned object exposes an idempotent, fully tear-down-able lifecycle
 * (`start`/`stop`), request-capture accessors (`getLastRequest`, `requests`),
 * and response-shaping helpers (`setResponse`, `reset`) for edge-case tests.
 *
 * By default the server records every inbound request and replies `200` with a
 * JSON body that echoes `{ method, url, headers, body }`. A test may override
 * the reply via `setResponse(...)` (e.g. to force a `503`) while the incoming
 * request is still always recorded first.
 *
 * @param {Object} [options={}]                     Optional initial response config.
 * @param {number} [options.statusCode=200]         Initial response status code.
 * @param {Object<string,string>} [options.headers] Initial response headers.
 *                                                   Defaults to
 *                                                   `{ 'Content-Type': 'application/json' }`.
 * @param {(string|Object)} [options.body]          Initial response body. When
 *                                                   omitted, the server echoes
 *                                                   the captured request as JSON.
 * @returns {FakeDownstream} The fake downstream control surface.
 */
function createFakeDownstream(options = {}) {
  /**
   * Ordered log of every request captured since creation (or last `reset()`).
   * Exposed directly so tests can assert on count and order.
   * @type {CapturedRequest[]}
   */
  const requests = [];

  /**
   * The active HTTP server instance, or `null` when stopped/never-started.
   * @type {import('http').Server|null}
   */
  let server = null;

  /**
   * Whether the server is currently accepting connections. Guards idempotent
   * `start()` / `stop()`.
   * @type {boolean}
   */
  let listening = false;

  /**
   * Tracks every open TCP socket so `stop()` can proactively destroy lingering
   * keep-alive connections. Without this, an idle keep-alive socket can keep
   * `server.close()` pending — which would prevent the ephemeral port from
   * being released promptly and would surface as an "open handle" warning.
   * @type {Set<import('net').Socket>}
   */
  const sockets = new Set();

  /**
   * The current response configuration. `body === undefined` means "echo".
   * @type {ResponseConfig}
   */
  let responseConfig = {
    statusCode: options.statusCode || 200,
    headers: options.headers || { 'Content-Type': 'application/json' },
    body: options.body, // undefined => echo the captured request
  };

  /**
   * Node HTTP request handler. Buffers the body, records the request verbatim,
   * then responds — echoing by default or using the configured response.
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @returns {void}
   */
  function handler(req, res) {
    /** @type {Buffer[]} */
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      // Decode the accumulated body as UTF-8. With no body this is ''.
      const body = Buffer.concat(chunks).toString('utf8');

      // Capture the request VERBATIM. `req.url` carries the full original path
      // (the gateway proxy rewrites to `req.originalUrl`), and `req.headers`
      // includes forwarded headers such as `x-request-id` and `authorization`.
      /** @type {CapturedRequest} */
      const record = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      };
      requests.push(record);

      // Choose response headers: honor a configured set, otherwise default JSON.
      const headers = responseConfig.headers || { 'Content-Type': 'application/json' };
      res.writeHead(responseConfig.statusCode, headers);

      if (responseConfig.body !== undefined) {
        // Custom response body: strings pass through; objects are JSON encoded.
        res.end(
          typeof responseConfig.body === 'string'
            ? responseConfig.body
            : JSON.stringify(responseConfig.body)
        );
      } else {
        // Default behavior: echo the captured request back to the caller.
        res.end(JSON.stringify(record));
      }
    });

    // Defensive guards: a client abort or a broken pipe must never surface as
    // an uncaught exception that crashes the test process. These are no-ops on
    // the happy path and preserve the asserted behavior above.
    req.on('error', () => {
      try {
        res.destroy();
      } catch (e) {
        /* already destroyed / not writable — nothing to do */
      }
    });
    res.on('error', () => {
      /* swallow broken-pipe style errors during teardown */
    });
  }

  /**
   * Start the fake server on an OS-assigned ephemeral `127.0.0.1` port.
   *
   * Resolves only AFTER the server emits `listening`, guaranteeing that the
   * returned `port`/`url` are immediately usable by the caller. Calling
   * `start()` again while already listening is a safe no-op that resolves with
   * the current `{ server, port, url }`.
   *
   * @returns {Promise<StartResult>} Resolves with `{ server, port, url }`.
   */
  function start() {
    return new Promise((resolve, reject) => {
      // Idempotent start: if we're already listening, hand back current details.
      if (listening && server) {
        const port = server.address().port;
        return resolve({ server, port, url: 'http://127.0.0.1:' + port });
      }

      server = http.createServer(handler);

      // Track every connection so `stop()` can force-close keep-alive sockets.
      server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => {
          sockets.delete(socket);
        });
      });

      // Surface a bind/listen error to the caller (e.g. EADDRINUSE). `once`
      // ensures this cannot reject after a successful listen.
      server.once('error', reject);

      // Port 0 => the OS assigns a free ephemeral port. Bind to loopback only.
      server.listen(0, '127.0.0.1', () => {
        listening = true;
        const port = server.address().port;
        resolve({ server, port, url: 'http://127.0.0.1:' + port });
      });
    });
  }

  /**
   * Stop the fake server and FULLY release its socket/port.
   *
   * Correctness contract:
   * - Resolves only AFTER `server.close()`'s callback fires, so the ephemeral
   *   port is guaranteed released and can be re-bound. This is essential for the
   *   "downstream unreachable => 503" integration case, where a test `start()`s
   *   then `stop()`s to free the port and expects the gateway proxy to fail.
   * - Proactively destroys any tracked open (incl. keep-alive) sockets so
   *   `close()` does not hang and no "open handle" warning is produced.
   * - Idempotent and safe to call when never started / already stopped:
   *   resolves immediately without throwing.
   *
   * @returns {Promise<void>} Resolves once the server is fully closed.
   */
  function stop() {
    return new Promise((resolve) => {
      // Safe no-op when never started or already stopped.
      if (!server || !listening) {
        listening = false;
        return resolve();
      }

      // Force-close lingering sockets so the port releases promptly.
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch (e) {
          /* socket already destroyed — ignore */
        }
      }
      sockets.clear();

      // Resolve only after the underlying socket is actually released.
      server.close(() => {
        listening = false;
        server = null;
        resolve();
      });
    });
  }

  /**
   * Get the most recently captured request.
   *
   * @returns {CapturedRequest|undefined} The last record, or `undefined` if no
   *                                       request has been received yet.
   */
  function getLastRequest() {
    return requests.length ? requests[requests.length - 1] : undefined;
  }

  /**
   * Override the server's response configuration for subsequent requests.
   * Merges the provided fields over the current config, so a test can change
   * only `statusCode` (or only `body`) without clobbering the rest.
   *
   * The incoming request is always recorded first regardless of this setting.
   *
   * @param {Partial<ResponseConfig>} cfg  Fields to merge into the response config.
   * @returns {void}
   */
  function setResponse(cfg) {
    responseConfig = Object.assign({}, responseConfig, cfg);
  }

  /**
   * Clear the captured `requests` log in place (preserving the array identity
   * that callers may already hold a reference to).
   *
   * @returns {void}
   */
  function reset() {
    requests.length = 0;
  }

  return { start, stop, getLastRequest, setResponse, reset, requests };
}

module.exports = { createFakeDownstream };
