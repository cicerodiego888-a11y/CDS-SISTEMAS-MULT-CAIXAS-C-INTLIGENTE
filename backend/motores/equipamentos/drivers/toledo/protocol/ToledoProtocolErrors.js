/**
 * Sprint 15.2 — ToledoProtocolErrors
 * Erros específicos do Motor 90AX.
 */

'use strict';

class ToledoProtocolError extends Error {
  constructor(message, code, extras = {}) {
    super(message);
    this.name = 'ToledoProtocolError';
    this.code = code || 'PROTOCOL_ERROR';
    this.statusCode = extras.statusCode || 400;
    Object.assign(this, extras);
  }
}

class InvalidChecksumError extends ToledoProtocolError {
  constructor(message = 'Checksum inválido', extras = {}) {
    super(message, 'INVALID_CHECKSUM', extras);
    this.name = 'InvalidChecksumError';
  }
}

class TimeoutError extends ToledoProtocolError {
  constructor(message = 'Timeout de protocolo', extras = {}) {
    super(message, 'PROTOCOL_TIMEOUT', { statusCode: 408, ...extras });
    this.name = 'TimeoutError';
  }
}

class InvalidFrameError extends ToledoProtocolError {
  constructor(message = 'Frame inválido', extras = {}) {
    super(message, 'INVALID_FRAME', extras);
    this.name = 'InvalidFrameError';
  }
}

class UnexpectedResponseError extends ToledoProtocolError {
  constructor(message = 'Resposta inesperada', extras = {}) {
    super(message, 'UNEXPECTED_RESPONSE', extras);
    this.name = 'UnexpectedResponseError';
  }
}

class ConnectionLostError extends ToledoProtocolError {
  constructor(message = 'Conexão perdida', extras = {}) {
    super(message, 'CONNECTION_LOST', { statusCode: 503, ...extras });
    this.name = 'ConnectionLostError';
  }
}

class CommandNotFoundError extends ToledoProtocolError {
  constructor(command) {
    super(`Comando não registrado: ${command}`, 'COMMAND_NOT_FOUND', { statusCode: 404, command });
    this.name = 'CommandNotFoundError';
  }
}

module.exports = {
  ToledoProtocolError,
  InvalidChecksumError,
  TimeoutError,
  InvalidFrameError,
  UnexpectedResponseError,
  ConnectionLostError,
  CommandNotFoundError
};
