/**
 * ToledoPrix4FrameBuilder — LEGADO / LABORATÓRIO (Sprint 11A)
 *
 * RC14.14.2: NÃO usar em produção.
 * Produção → protocol/ToledoFrameBuilder.js (com checksum XOR).
 *
 * Formato temporário SEM CHK:
 *   [STX 0x02][CMD 2 ASCII][SEP 0x1C][PAYLOAD UTF-8 JSON opcional][ETX 0x03]
 *
 * @module ToledoPrix4FrameBuilder
 * @deprecated Produção usa drivers/toledo/protocol/ToledoFrameBuilder
 */

const { COMANDOS } = require('./ToledoPrix4Constants');

const STX = 0x02;
const ETX = 0x03;
const SEP = 0x1c;

/** Códigos de resposta simulada (Sprint 11A) */
const RESPOSTA = {
  ACK: 'AK',
  NAK: 'NK',
  STATUS: 'RS',
  PESO: 'PW'
};

/**
 * Serializa payload para buffer UTF-8.
 * @param {*} payload
 * @returns {Buffer}
 * @private
 */
function _serializarPayload(payload) {
  if (payload === null || payload === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

/**
 * Monta frame genérico Toledo (formato temporário Sprint 11A).
 * @param {string} comando - Código de 2 caracteres (ex: HS, EP)
 * @param {*} [payload]
 * @returns {Buffer}
 */
function buildFrame(comando, payload) {
  const cmd = String(comando || '').slice(0, 2).toUpperCase();
  if (cmd.length !== 2) {
    throw new Error(`ToledoPrix4FrameBuilder: comando inválido "${comando}"`);
  }

  const partes = [
    Buffer.from([STX]),
    Buffer.from(cmd, 'ascii'),
    Buffer.from([SEP]),
    _serializarPayload(payload),
    Buffer.from([ETX])
  ];

  return Buffer.concat(partes);
}

/**
 * @returns {Buffer}
 */
function buildHandshake() {
  return buildFrame(COMANDOS.HANDSHAKE, {
    versao: '11A-infra',
    firmware_alvo: '90AX',
    modo: 'temporario'
  });
}

/**
 * @returns {Buffer}
 */
function buildPing() {
  return buildFrame(COMANDOS.PING, { ts: Date.now() });
}

/**
 * @returns {Buffer}
 */
function buildStatus() {
  return buildFrame(COMANDOS.STATUS, null);
}

/**
 * @param {Object} produto
 * @returns {Buffer}
 */
function buildProduto(produto) {
  return buildFrame(COMANDOS.ENVIAR_PRODUTO, produto || {});
}

/**
 * @param {Object} departamento
 * @returns {Buffer}
 */
function buildDepartamento(departamento) {
  return buildFrame(COMANDOS.ENVIAR_DEPARTAMENTO, departamento || {});
}

/**
 * @param {Object} promocao
 * @returns {Buffer}
 */
function buildPromocao(promocao) {
  return buildFrame(COMANDOS.ENVIAR_PROMOCAO, promocao || {});
}

/**
 * @param {string|number} codigo
 * @returns {Buffer}
 */
function buildRemocaoProduto(codigo) {
  return buildFrame(COMANDOS.REMOVER_PRODUTO, { plu: String(codigo) });
}

/**
 * Frame de resposta ACK simulada (usado em testes e mocks TCP).
 * @param {Object} [dados]
 * @returns {Buffer}
 */
function buildAck(dados = {}) {
  return buildFrame(RESPOSTA.ACK, { ok: true, ...dados });
}

/**
 * Frame de resposta NAK simulada.
 * @param {string} [mensagem]
 * @returns {Buffer}
 */
function buildNak(mensagem = 'erro simulado') {
  return buildFrame(RESPOSTA.NAK, { ok: false, mensagem });
}

/**
 * Frame de resposta de status simulada.
 * @param {Object} [dados]
 * @returns {Buffer}
 */
function buildRespostaStatus(dados = {}) {
  return buildFrame(RESPOSTA.STATUS, {
    online: true,
    firmware: '90AX-sim',
    ...dados
  });
}

/**
 * Frame de resposta de peso simulada.
 * @param {Object} [dados]
 * @returns {Buffer}
 */
function buildRespostaPeso(dados = {}) {
  return buildFrame(RESPOSTA.PESO, {
    valor: 0,
    unidade: 'kg',
    estavel: false,
    simulado: true,
    ...dados
  });
}

module.exports = {
  STX,
  ETX,
  SEP,
  RESPOSTA,
  buildFrame,
  buildHandshake,
  buildPing,
  buildStatus,
  buildProduto,
  buildDepartamento,
  buildPromocao,
  buildRemocaoProduto,
  buildAck,
  buildNak,
  buildRespostaStatus,
  buildRespostaPeso
};
