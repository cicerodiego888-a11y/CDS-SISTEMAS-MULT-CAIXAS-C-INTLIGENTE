/**
 * Sprint 14.7 — ToledoPluBuilder
 *
 * Serialização de upload PLU sobre o framing V1 já validado no Lab
 * (STX/CMD/SEP/payload/CHK/ETX — mesmo canal de HS/PN capturado na 14.5).
 * Payload EP permanece extensível quando frames 90AX reais forem confirmados.
 */

'use strict';

const frameBuilder = require('../ToledoFrameBuilder');
const { COMMANDS } = require('../ToledoProtocol');
const { PluError, CODES } = require('./ToledoPluErrors');

const PROTOCOL_PROFILE = Object.freeze({
  source: 'lab-v1-framing',
  command: COMMANDS.UPLOAD_PLU,
  version: '14.7-infra'
});

/**
 * @param {object} plu estrutura mapeada
 * @returns {Buffer}
 */
function build(plu) {
  if (!plu || !plu.plu) {
    throw PluError.fromCode(CODES.PLU_REQUIRED, 'PLU ausente no builder');
  }
  const payload = {
    plu: String(plu.plu),
    descricao: plu.descricao || '',
    preco: Number(plu.preco),
    validade: plu.validade != null ? plu.validade : null,
    tara: Number(plu.tara) || 0,
    departamento: Number(plu.departamento) || 0,
    codigoBarras: plu.codigoBarras || '',
    _proto: PROTOCOL_PROFILE.version
  };
  return frameBuilder.build(PROTOCOL_PROFILE.command, payload);
}

function getProtocolProfile() {
  return { ...PROTOCOL_PROFILE };
}

module.exports = {
  build,
  getProtocolProfile,
  PROTOCOL_PROFILE
};
