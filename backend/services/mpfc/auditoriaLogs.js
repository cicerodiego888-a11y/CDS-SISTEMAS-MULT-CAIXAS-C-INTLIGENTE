/**
 * RC8.2.2 — Logs oficiais de auditoria do MPFC.
 * Padrão CDS: console.log('[EVENTO]', JSON.stringify(payload))
 */
'use strict';

const MOTOR = 'MPFC';
const VERSAO_MOTOR = '8.2.2';

function emitir(evento, campos = {}) {
  const payload = {
    evento,
    motor: MOTOR,
    versaoMotor: VERSAO_MOTOR,
    ...campos
  };
  try {
    console.log(`[${evento}]`, JSON.stringify(payload));
  } catch (_) {
    /* ignore */
  }
  return payload;
}

function logPoliticaCarregada(politica = {}) {
  const modo = politica.modo === 'FLEXIVEL' ? 'FLEXIVEL' : 'FIXA';
  emitir('MPFC_POLITICA_CARREGADA', {
    versao: politica.versao,
    codigoPolitica: politica.codigoPolitica,
    modo,
    percentual: politica.percentualDinheiroFiscal,
    margem: politica.margemMinimaSobreOCusto,
    nuncaVenderAbaixoDaMargem: politica.nuncaVenderAbaixoDaMargem,
    preservarDinheiro: politica.preservarDinheiro
  });
  if (modo === 'FLEXIVEL') {
    emitir('MPFC_MODO_FLEXIVEL', {
      percentualDinheiroFiscal: politica.percentualDinheiroFiscal,
      codigoPolitica: politica.codigoPolitica
    });
  } else {
    emitir('MPFC_MODO_FIXA', {
      preservarDinheiro: Boolean(politica.preservarDinheiro),
      codigoPolitica: politica.codigoPolitica
    });
  }
}

function logSnapshotGravado(politica = {}, meta = {}) {
  return emitir('MPFC_SNAPSHOT_GRAVADO', {
    vendaId: meta.vendaId != null ? meta.vendaId : null,
    codigoPolitica: politica.codigoPolitica,
    modo: politica.modo,
    percentualDinheiroFiscal: politica.percentualDinheiroFiscal,
    fonte: meta.fonte || 'criar_venda'
  });
}

function logValidacaoMargem(resultado = {}, meta = {}) {
  return emitir('MPFC_VALIDACAO_MARGEM', {
    sucesso: Boolean(resultado.sucesso),
    aplicada: Boolean(resultado.aplicada),
    margemMinimaSobreOCusto: meta.margemMinimaSobreOCusto,
    nuncaVenderAbaixoDaMargem: meta.nuncaVenderAbaixoDaMargem,
    itensViolados: Array.isArray(resultado.itensViolados)
      ? resultado.itensViolados.length
      : 0,
    motivo: resultado.motivo || resultado.error || null
  });
}

function logSnapshotUtilizado(contexto, politica = {}, meta = {}) {
  return emitir('MPFC_SNAPSHOT_UTILIZADO', {
    contexto: String(contexto || 'operacao'),
    vendaId: meta.vendaId != null ? meta.vendaId : null,
    codigoPolitica: politica.codigoPolitica || null,
    modo: politica.modo || null,
    fonte: meta.fonte || 'mpfc_politica_snapshot',
    snapshotPresente: Boolean(meta.snapshotPresente)
  });
}

module.exports = {
  MOTOR,
  VERSAO_MOTOR,
  emitir,
  logPoliticaCarregada,
  logSnapshotGravado,
  logValidacaoMargem,
  logSnapshotUtilizado
};
