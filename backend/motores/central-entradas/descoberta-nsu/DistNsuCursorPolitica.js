/**
 * Política de avanço do cursor distNSU (Sprint 3).
 * Cursor só avança após lote processado com segurança.
 *
 * @module motores/central-entradas/descoberta-nsu/DistNsuCursorPolitica
 */
'use strict';

const { DistNsuStatus } = require('./DistNsuStatus');

/**
 * @param {Object} params
 * @param {string} params.cStat
 * @param {Object} [params.persistidos]
 * @param {Error|null} [params.erro]
 * @param {string} [params.tipoErro] — PARSER|SOAP|TIMEOUT|BANCO|TRANSPORTE
 * @returns {{ avancar: boolean, status: string, motivo: string }}
 */
function avaliarAvancoCursor({
  cStat = '',
  persistidos = null,
  erro = null,
  tipoErro = null
} = {}) {
  const c = String(cStat || '');

  if (erro || tipoErro) {
    const t = String(tipoErro || classificarErro(erro)).toUpperCase();
    const mapa = {
      PARSER: DistNsuStatus.ERRO_PARSER,
      BANCO: DistNsuStatus.ERRO_BANCO,
      TIMEOUT: DistNsuStatus.ERRO,
      SOAP: DistNsuStatus.ERRO,
      TRANSPORTE: DistNsuStatus.ERRO,
      CERTIFICADO: DistNsuStatus.ERRO
    };
    return {
      avancar: false,
      status: mapa[t] || DistNsuStatus.ERRO,
      motivo: `Cursor preservado — ${t}: ${(erro && erro.message) || t}`
    };
  }

  if (c === '656') {
    return {
      avancar: false,
      status: DistNsuStatus.BLOQUEADO,
      motivo: 'cStat 656 — cursor não avança por consumo indevido (Gate/Cooldown)'
    };
  }

  if (persistidos) {
    if (Number(persistidos.errosPersistencia || 0) > 0) {
      return {
        avancar: false,
        status: DistNsuStatus.ERRO_BANCO,
        motivo: 'Persistência falhou — cursor não avança'
      };
    }
    if (Number(persistidos.errosZip || 0) > 0) {
      return {
        avancar: false,
        status: DistNsuStatus.ERRO_PARSER,
        motivo: 'ZIP inválido no lote — cursor não avança para permitir reprocessamento'
      };
    }
    if (Number(persistidos.errosSchema || 0) > 0) {
      return {
        avancar: false,
        status: DistNsuStatus.ERRO_PARSER,
        motivo: 'Schema inválido no lote — cursor não avança'
      };
    }
  }

  if (c === '137') {
    return {
      avancar: true,
      status: DistNsuStatus.SEM_NOVOS_DOCUMENTOS,
      motivo: 'cStat 137 — sem novos documentos; cursor pode acompanhar retorno SEFAZ'
    };
  }

  if (c === '138') {
    const qtd = Number(persistidos?.recebidosZip || 0);
    return {
      avancar: true,
      status: qtd > 0 ? DistNsuStatus.LOTE_PROCESSADO : DistNsuStatus.SEM_NOVOS_DOCUMENTOS,
      motivo: qtd > 0
        ? `Lote processado com sucesso (${qtd} docZip)`
        : 'cStat 138 sem documentos — cursor acompanha retorno'
    };
  }

  return {
    avancar: false,
    status: DistNsuStatus.CURSOR_PRESERVADO,
    motivo: `cStat ${c || '—'} — sem política de avanço`
  };
}

function classificarErro(erro) {
  const m = String(erro?.message || erro || '').toLowerCase();
  if (m.includes('timeout') || m.includes('etimedout')) return 'TIMEOUT';
  if (m.includes('parse') || m.includes('xml')) return 'PARSER';
  if (m.includes('sqlite') || m.includes('banco') || m.includes('database')) return 'BANCO';
  if (m.includes('certificado') || m.includes('pfx')) return 'CERTIFICADO';
  if (m.includes('soap') || m.includes('http')) return 'SOAP';
  return 'TRANSPORTE';
}

/**
 * maxNSU > ultNSU ⇒ existem posições posteriores (não implica NF perdida).
 */
function existemDocumentosPosteriores(ultNsu, maxNsu) {
  const u = String(ultNsu || '').replace(/\D/g, '').padStart(15, '0');
  const m = String(maxNsu || '').replace(/\D/g, '').padStart(15, '0');
  return m > u;
}

module.exports = {
  avaliarAvancoCursor,
  classificarErro,
  existemDocumentosPosteriores
};
