/**
 * RC8.2.2 — Resolução da política operacional a partir da venda.
 *
 * Cancelamento / estorno / reprocessamento NUNCA leem a configuração atual.
 * Sempre usam mpfc_politica_snapshot gravado na venda.
 *
 * Migração: vendas legadas sem snapshot → PoliticaFiscalComercialV1 defaults
 * (FIXA_PADRAO), sem consultar configuracaoService.
 */
'use strict';

const {
  criarPoliticaFiscalComercialV1,
  serializarSnapshotPolitica,
  DEFAULTS_V1
} = require('./PoliticaFiscalComercialV1');
const { logSnapshotUtilizado } = require('./auditoriaLogs');

/**
 * @param {string|object|null} raw — JSON string ou objeto do snapshot
 * @returns {object|null}
 */
function parseSnapshotRaw(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return null;
  }
}

/**
 * Converte snapshot persistido → PoliticaFiscalComercialV1 imutável.
 * @param {object|string|null} snapshotRaw
 * @param {object} [meta]
 */
function politicaFromSnapshot(snapshotRaw, meta = {}) {
  const snap = parseSnapshotRaw(snapshotRaw);
  if (!snap) {
    const legado = criarPoliticaFiscalComercialV1({
      ...DEFAULTS_V1,
      modo: 'FIXA',
      preservarDinheiro: false,
      nuncaVenderAbaixoDaMargem: false
    });
    if (meta.emitirLog !== false) {
      logSnapshotUtilizado(meta.contexto || 'operacao', legado, {
        vendaId: meta.vendaId,
        snapshotPresente: false,
        fonte: 'defaults_v1_legado'
      });
    }
    return {
      politica: legado,
      snapshotPresente: false,
      fonte: 'defaults_v1_legado',
      payload: serializarSnapshotPolitica(legado)
    };
  }

  const politica = criarPoliticaFiscalComercialV1({
    versao: snap.versao,
    codigoPolitica: snap.codigoPolitica,
    modo: snap.modo,
    percentualDinheiroFiscal: snap.percentualDinheiroFiscal,
    margemMinimaSobreOCusto: snap.margemMinimaSobreOCusto,
    nuncaVenderAbaixoDaMargem: snap.nuncaVenderAbaixoDaMargem,
    preservarDinheiro: snap.preservarDinheiro
  });

  if (meta.emitirLog !== false) {
    logSnapshotUtilizado(meta.contexto || 'operacao', politica, {
      vendaId: meta.vendaId,
      snapshotPresente: true,
      fonte: 'mpfc_politica_snapshot'
    });
  }

  return {
    politica,
    snapshotPresente: true,
    fonte: 'mpfc_politica_snapshot',
    payload: serializarSnapshotPolitica(politica)
  };
}

/**
 * API oficial para cancelamento / estorno / reprocessamento.
 * @param {object} venda — row de vendas (deve incluir mpfc_politica_snapshot quando existir)
 * @param {string} contexto — 'cancelamento' | 'estorno' | 'reprocessamento' | ...
 */
function resolverPoliticaOperacionalDaVenda(venda = {}, contexto = 'operacao') {
  return politicaFromSnapshot(venda.mpfc_politica_snapshot, {
    vendaId: venda.id != null ? venda.id : null,
    contexto,
    emitirLog: true
  });
}

module.exports = {
  parseSnapshotRaw,
  politicaFromSnapshot,
  resolverPoliticaOperacionalDaVenda
};
