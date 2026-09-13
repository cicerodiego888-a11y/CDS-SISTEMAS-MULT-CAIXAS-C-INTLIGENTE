/**
 * RC15.0.1 — Códigos de resultado do TCP Connect (diagnóstico)
 * Não misturar com Handshake / Read / ACK.
 */

'use strict';

const TCP_CONNECT_STATUS = Object.freeze({
  OK: 'TCP_CONNECT_OK',
  TIMEOUT: 'TCP_CONNECT_TIMEOUT',
  REFUSED: 'TCP_CONNECT_REFUSED',
  HOST_UNREACHABLE: 'TCP_CONNECT_HOST_UNREACHABLE',
  SOCKET_EXCEPTION: 'TCP_CONNECT_SOCKET_EXCEPTION',
  IP_MISSING: 'TCP_CONNECT_IP_MISSING',
  NOT_STARTED: 'TCP_CONNECT_NOT_STARTED'
});

const HANDSHAKE_STATUS = Object.freeze({
  OK: 'HANDSHAKE_OK',
  TIMEOUT: 'HANDSHAKE_TIMEOUT',
  NAK: 'HANDSHAKE_NAK',
  NO_RESPONSE: 'HANDSHAKE_NO_RESPONSE',
  ERROR: 'HANDSHAKE_ERROR',
  NOT_STARTED: 'HANDSHAKE_NOT_STARTED'
});

/**
 * @param {Error|object|null} err
 * @returns {string}
 */
function classificarErroTcp(err) {
  if (!err) return TCP_CONNECT_STATUS.SOCKET_EXCEPTION;
  const code = String(err.code || err.errno || '').toUpperCase();
  const msg = String(err.message || '').toLowerCase();

  if (
    code === 'ETIMEDOUT'
    || code === 'TCP_TIMEOUT'
    || code === 'TIMEOUT'
    || msg.includes('timeout')
  ) {
    return TCP_CONNECT_STATUS.TIMEOUT;
  }
  if (code === 'ECONNREFUSED' || msg.includes('refused') || msg.includes('recusada')) {
    return TCP_CONNECT_STATUS.REFUSED;
  }
  if (
    code === 'EHOSTUNREACH'
    || code === 'ENETUNREACH'
    || code === 'EHOSTDOWN'
    || msg.includes('unreachable')
    || msg.includes('inalcanç')
  ) {
    return TCP_CONNECT_STATUS.HOST_UNREACHABLE;
  }
  return TCP_CONNECT_STATUS.SOCKET_EXCEPTION;
}

/**
 * @param {Error|object|null} err
 * @returns {string}
 */
function classificarErroHandshake(err) {
  if (!err) return HANDSHAKE_STATUS.ERROR;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || '').toLowerCase();
  if (code === 'PROTOCOL_TIMEOUT' || code === 'CONNECTION_TIMEOUT' || msg.includes('timeout')) {
    return HANDSHAKE_STATUS.TIMEOUT;
  }
  if (code === 'HANDSHAKE_FAILED' || msg.includes('nak')) {
    return HANDSHAKE_STATUS.NAK;
  }
  if (msg.includes('sem resposta') || msg.includes('no response') || msg.includes('vazio')) {
    return HANDSHAKE_STATUS.NO_RESPONSE;
  }
  return HANDSHAKE_STATUS.ERROR;
}

function rotuloTcp(codigo) {
  switch (codigo) {
    case TCP_CONNECT_STATUS.OK: return 'OK';
    case TCP_CONNECT_STATUS.TIMEOUT: return 'Timeout';
    case TCP_CONNECT_STATUS.REFUSED: return 'Conexão recusada';
    case TCP_CONNECT_STATUS.HOST_UNREACHABLE: return 'Host inacessível';
    case TCP_CONNECT_STATUS.SOCKET_EXCEPTION: return 'Exceção de socket';
    case TCP_CONNECT_STATUS.IP_MISSING: return 'IP não informado';
    case TCP_CONNECT_STATUS.NOT_STARTED: return 'Não iniciado';
    default: return codigo || 'Desconhecido';
  }
}

function rotuloHandshake(codigo) {
  switch (codigo) {
    case HANDSHAKE_STATUS.OK: return 'OK';
    case HANDSHAKE_STATUS.TIMEOUT: return 'Timeout';
    case HANDSHAKE_STATUS.NAK: return 'NAK';
    case HANDSHAKE_STATUS.NO_RESPONSE: return 'Sem resposta';
    case HANDSHAKE_STATUS.ERROR: return 'Erro';
    case HANDSHAKE_STATUS.NOT_STARTED: return 'Não iniciado';
    default: return codigo || 'Desconhecido';
  }
}

module.exports = {
  TCP_CONNECT_STATUS,
  HANDSHAKE_STATUS,
  classificarErroTcp,
  classificarErroHandshake,
  rotuloTcp,
  rotuloHandshake
};
