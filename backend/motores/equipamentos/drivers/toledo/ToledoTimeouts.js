/**
 * RC14.14.1 — Timeouts unificados Toledo / Connection
 * Fonte única — não hardcodar timeouts locais em produção.
 */

'use strict';

const CONNECT = 5000;
const HANDSHAKE = 5000;
const READ = 5000;
const WRITE = 5000;

const ToledoTimeouts = Object.freeze({
  CONNECT,
  HANDSHAKE,
  READ,
  WRITE,
  /** aliases legados */
  connectTimeoutMs: CONNECT,
  handshakeTimeoutMs: HANDSHAKE,
  readTimeoutMs: READ,
  writeTimeoutMs: WRITE,
  pingTimeoutMs: READ
});

module.exports = ToledoTimeouts;
