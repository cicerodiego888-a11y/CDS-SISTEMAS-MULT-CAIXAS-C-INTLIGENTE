/**
 * RC8.2 — Snapshot da Política Fiscal Comercial.
 */
'use strict';

const {
  freezeDeep,
  criarPoliticaFiscalComercialV1,
  serializarSnapshotPolitica
} = require('./PoliticaFiscalComercialV1');

const VERSAO_SNAPSHOT = '1.0';

/**
 * @param {object} politica — PoliticaFiscalComercialV1
 * @param {object} [meta]
 */
function criarPoliticaFiscalComercialSnapshot(politica, meta = {}) {
  const politicaFrozen = politica && Object.isFrozen(politica)
    ? politica
    : criarPoliticaFiscalComercialV1(politica || {});

  const payload = serializarSnapshotPolitica(politicaFrozen);
  const capturadoEm = meta.capturadoEm != null
    ? meta.capturadoEm
    : new Date().toISOString();

  const snapshot = {
    versaoSnapshot: VERSAO_SNAPSHOT,
    ...payload,
    politica: politicaFrozen,
    capturadoEm,
    persistido: Boolean(meta.persistido),
    fonte: meta.fonte != null ? String(meta.fonte) : 'mpfc',
    vendaId: meta.vendaId != null ? meta.vendaId : null
  };

  return freezeDeep(snapshot);
}

function snapshotParaJson(politica) {
  return JSON.stringify(serializarSnapshotPolitica(politica));
}

module.exports = {
  VERSAO_SNAPSHOT,
  criarPoliticaFiscalComercialSnapshot,
  snapshotParaJson,
  serializarSnapshotPolitica
};
