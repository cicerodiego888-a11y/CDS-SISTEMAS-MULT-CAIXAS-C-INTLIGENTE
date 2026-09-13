/**
 * ToledoPrix4Errors — Hierarquia de exceções do driver Toledo Prix 4 Uno.
 *
 * @module ToledoPrix4Errors
 */

const { FABRICANTE, MODELO } = require('./ToledoPrix4Constants');

/**
 * Erro base do driver Toledo Prix 4 Uno.
 */
class ToledoPrix4Error extends Error {
  /**
   * @param {string} mensagem
   * @param {Object} [detalhes]
   */
  constructor(mensagem, detalhes = {}) {
    super(mensagem);
    this.name = 'ToledoPrix4Error';
    this.fabricante = FABRICANTE;
    this.modelo = MODELO;
    this.detalhes = detalhes;
    this.timestamp = new Date().toISOString();
  }
}

/** Erro de conexão (Ethernet TCP, handshake, etc.) */
class ToledoPrix4ConnectionError extends ToledoPrix4Error {
  constructor(mensagem, detalhes = {}) {
    super(mensagem, detalhes);
    this.name = 'ToledoPrix4ConnectionError';
  }
}

/** Erro de protocolo (frame inválido, ACK/NAK, etc.) */
class ToledoPrix4ProtocolError extends ToledoPrix4Error {
  constructor(mensagem, detalhes = {}) {
    super(mensagem, detalhes);
    this.name = 'ToledoPrix4ProtocolError';
  }
}

/** Erro de validação de payload antes do envio */
class ToledoPrix4ValidationError extends ToledoPrix4Error {
  /**
   * @param {string} mensagem
   * @param {string[]} [erros]
   * @param {Object} [detalhes]
   */
  constructor(mensagem, erros = [], detalhes = {}) {
    super(mensagem, { ...detalhes, erros });
    this.name = 'ToledoPrix4ValidationError';
    this.erros = erros;
  }
}

/** Erro de timeout em operação */
class ToledoPrix4TimeoutError extends ToledoPrix4Error {
  constructor(mensagem, detalhes = {}) {
    super(mensagem, detalhes);
    this.name = 'ToledoPrix4TimeoutError';
  }
}

/** Erro durante descoberta de equipamentos */
class ToledoPrix4DiscoveryError extends ToledoPrix4Error {
  constructor(mensagem, detalhes = {}) {
    super(mensagem, detalhes);
    this.name = 'ToledoPrix4DiscoveryError';
  }
}

/** Erro na conversão DTO → formato Toledo */
class ToledoPrix4MapperError extends ToledoPrix4Error {
  constructor(mensagem, detalhes = {}) {
    super(mensagem, detalhes);
    this.name = 'ToledoPrix4MapperError';
  }
}

/** Erro de diagnóstico/homologação */
class ToledoPrix4DiagnosticsError extends ToledoPrix4Error {
  constructor(mensagem, detalhes = {}) {
    super(mensagem, detalhes);
    this.name = 'ToledoPrix4DiagnosticsError';
  }
}

module.exports = {
  ToledoPrix4Error,
  ToledoPrix4ConnectionError,
  ToledoPrix4ProtocolError,
  ToledoPrix4ValidationError,
  ToledoPrix4TimeoutError,
  ToledoPrix4DiscoveryError,
  ToledoPrix4MapperError,
  ToledoPrix4DiagnosticsError
};
