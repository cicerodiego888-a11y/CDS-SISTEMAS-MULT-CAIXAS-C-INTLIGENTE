/**
 * MUC RC2.1 — RegraConversaoDTO (contrato público)
 * @module motores/muc/dto/RegraConversaoDTO
 */
'use strict';

const { resolverRegra, CATALOGO_REGRAS } = require('../constants/catalogoRegras');
const VERSAO = require('../version');

/**
 * @param {string} tipoConversao
 * @returns {Readonly<Object>}
 */
function criarRegraConversaoDTO(tipoConversao) {
  const regra = resolverRegra(tipoConversao);
  return Object.freeze({
    id: regra.id,
    regraAplicada: regra.regraAplicada,
    versaoRegra: regra.versaoRegra,
    versaoMotor: regra.versaoMotor,
    dataRegra: regra.dataRegra,
    motivo: regra.motivo,
    tipoConversao: String(tipoConversao || 'UNIDADE').toUpperCase(),
    versaoContrato: VERSAO.VERSAO_PUBLICA
  });
}

module.exports = {
  criarRegraConversaoDTO,
  CATALOGO_REGRAS
};
