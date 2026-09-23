/**
 * Classificação explícita de fontes de NSU (Sprint 6).
 * DOCUMENT_NSUS — únicos usados em análise de intervalos/lacunas de documentos.
 * CURSOR_NSUS / QUERY_NSUS — diagnóstico separado; não geram "lacunas de documento".
 */
'use strict';

const NsuFonte = Object.freeze({
  DOCUMENT: 'DOCUMENT_NSUS',
  CURSOR: 'CURSOR_NSUS',
  QUERY: 'QUERY_NSUS'
});

/**
 * @param {Object[]} documentos
 * @param {Object[]} auditoria
 * @param {Function} padNsu
 * @returns {{ documentNsus: string[], cursorNsus: string[], queryNsus: string[] }}
 */
function classificarNsus(documentos = [], auditoria = [], padNsu = (n) => String(n || '')) {
  const documentNsus = [];
  const cursorNsus = [];
  const queryNsus = [];

  for (const doc of documentos || []) {
    if (doc && doc.nsu) documentNsus.push(padNsu(doc.nsu));
  }

  for (const ev of auditoria || []) {
    const tipo = String(ev.tipo || '').toUpperCase();
    const nsu = ev.nsu ? padNsu(ev.nsu) : null;
    let detalhe = {};
    try {
      detalhe = typeof ev.detalhe === 'string' ? JSON.parse(ev.detalhe || '{}') : (ev.detalhe || {});
    } catch { detalhe = {}; }

    if (tipo === 'NSU' || tipo === 'CURSOR' || detalhe.ultNsuNovo != null || detalhe.ultNsuAnterior != null) {
      if (nsu) cursorNsus.push(nsu);
      if (detalhe.ultNsuNovo != null) cursorNsus.push(padNsu(detalhe.ultNsuNovo));
      if (detalhe.ultNsuAnterior != null) cursorNsus.push(padNsu(detalhe.ultNsuAnterior));
      continue;
    }

    if (tipo === 'CONSULTA' || tipo === 'QUERY' || tipo === 'DIST_NSU' || tipo === 'DISTNSU') {
      if (nsu) queryNsus.push(nsu);
      continue;
    }

    // ZIP / PERSISTENCIA / DOCUMENTO — NSU de documento observado
    if (tipo === 'ZIP' || tipo === 'PERSISTENCIA' || tipo === 'DOCUMENTO' || tipo === 'DOC') {
      if (nsu) documentNsus.push(nsu);
      continue;
    }

    // Demais eventos com NSU: não misturar em DOCUMENT para lacunas
    if (nsu) queryNsus.push(nsu);
  }

  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  return {
    documentNsus: uniq(documentNsus),
    cursorNsus: uniq(cursorNsus),
    queryNsus: uniq(queryNsus),
    fontes: NsuFonte
  };
}

module.exports = {
  NsuFonte,
  classificarNsus
};
