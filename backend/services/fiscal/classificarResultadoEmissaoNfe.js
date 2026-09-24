/**
 * Classifica o resultado da emissão de NF-e sem inventar cStat.
 * Rejeição SEFAZ só existe quando há cStat de rejeição.
 */

'use strict';

const CLASSE_EMISSAO = Object.freeze({
  SUCCESS: 'SUCCESS',
  REJECTED_BY_SEFAZ: 'REJECTED_BY_SEFAZ',
  PROCESSING_ERROR: 'PROCESSING_ERROR',
  COMMUNICATION_ERROR: 'COMMUNICATION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR'
});

const STATUS_COMUNICACAO = new Set([
  'erro_comunicacao',
  'timeout',
  'servico_indisponivel',
  'communication_error'
]);

const STATUS_VALIDACAO = new Set([
  'erro_validacao',
  'erro_assinatura',
  'saldo_zerado',
  'saldo_insuficiente',
  'auditoria_fiscal_reprovada',
  'qtd_invalida',
  'item_nao_encontrado',
  'ref_nfe_invalida',
  'xml_origem_ausente',
  'nitem_origem_indeterminado',
  'modulo_desabilitado',
  'validation_error'
]);

function extrairCstat(r = {}) {
  const bruto = r.cStat != null
    ? r.cStat
    : (r.cstat_retorno != null
      ? r.cstat_retorno
      : (r.rejeicao_codigo != null
        ? r.rejeicao_codigo
        : (r.rejeicao && (r.rejeicao.codigo || r.rejeicao.cStat))));
  const n = String(bruto == null ? '' : bruto).trim();
  return n && /^\d+$/.test(n) ? n : null;
}

function extrairXmotivo(r = {}) {
  const texto = r.xMotivo
    || r.xmotivo_retorno
    || r.rejeicao_motivo
    || (r.rejeicao && (r.rejeicao.motivo || r.rejeicao.xMotivo))
    || r.mensagem
    || r.message
    || r.error
    || r.detalhe
    || null;
  const s = String(texto == null ? '' : texto).trim();
  return s || null;
}

function cStatEhRejeicaoSefaz(cStat) {
  if (!cStat) return false;
  const n = Number(cStat);
  if (!Number.isFinite(n)) return false;
  if (n === 100 || n === 150) return false;
  if (n === 103 || n === 104 || n === 105) return false;
  return n >= 200 || n === 110;
}

function classificarResultadoEmissaoNfe(r = {}) {
  const st = String(r.status || r.code || r.codigo || '').toLowerCase();
  if (st === 'saldo_insuficiente' || st === 'saldo_zerado') {
    return {
      classe: CLASSE_EMISSAO.VALIDATION_ERROR,
      titulo: 'Não foi possível emitir a NF-e',
      etapa: 'validacao',
      cStat: null,
      xMotivo: extrairXmotivo(r),
      rejeicaoSefaz: false
    };
  }
  const cStat = extrairCstat(r);
  const xMotivo = extrairXmotivo(r);
  const success = r.success === true || (st === 'autorizada' && r.success !== false);

  if (success && !cStatEhRejeicaoSefaz(cStat)) {
    return {
      classe: CLASSE_EMISSAO.SUCCESS,
      titulo: 'NF-e autorizada',
      etapa: null,
      cStat,
      xMotivo,
      rejeicaoSefaz: false
    };
  }

  if (st === 'rejeitada' || st === 'denegada' || cStatEhRejeicaoSefaz(cStat)) {
    if (cStat) {
      return {
        classe: CLASSE_EMISSAO.REJECTED_BY_SEFAZ,
        titulo: st === 'denegada' ? 'NF-e denegada' : 'NF-e rejeitada pela SEFAZ',
        etapa: 'sefaz',
        cStat,
        xMotivo,
        rejeicaoSefaz: true
      };
    }
  }

  if (STATUS_COMUNICACAO.has(st) || /comunicac|econn|enotfound|etimedout|socket|soap/i.test(st + ' ' + (xMotivo || ''))) {
    return {
      classe: CLASSE_EMISSAO.COMMUNICATION_ERROR,
      titulo: 'Falha na comunicação com a SEFAZ',
      etapa: 'comunicacao',
      cStat: null,
      xMotivo,
      rejeicaoSefaz: false
    };
  }

  if (STATUS_VALIDACAO.has(st) || st === 'erro') {
    return {
      classe: CLASSE_EMISSAO.VALIDATION_ERROR,
      titulo: 'Não foi possível emitir a NF-e',
      etapa: st === 'erro_assinatura' ? 'assinatura' : 'validacao',
      cStat: null,
      xMotivo,
      rejeicaoSefaz: false
    };
  }

  return {
    classe: CLASSE_EMISSAO.PROCESSING_ERROR,
    titulo: 'Não foi possível emitir a NF-e',
    etapa: 'processamento',
    cStat: cStat || null,
    xMotivo,
    rejeicaoSefaz: false
  };
}

function normalizarPayloadEmissaoNfe(data = {}) {
  const r = data.resultado && typeof data.resultado === 'object' ? data.resultado : data;
  const normalizado = {
    success: r.success === true || data.success === true || data.status === 'autorizada',
    status: data.status || r.status || data.code || r.code || null,
    code: data.code || r.code || null,
    notaId: data.notaId || r.notaId || r.idNota || null,
    numero: data.numero || r.numero || null,
    serie: data.serie || r.serie || null,
    chaveAcesso: data.chaveAcesso || r.chaveAcesso || r.chave || null,
    protocolo: data.protocolo || r.protocolo || null,
    recibo: data.recibo || r.recibo || null,
    cStat: extrairCstat(data) || extrairCstat(r),
    xMotivo: extrairXmotivo({
      ...r,
      xMotivo: data.xMotivo || r.xMotivo,
      message: data.mensagem || data.message || data.error || r.message || r.error
    }),
    message: data.mensagem || data.message || data.error || r.message || r.error || null,
    retorno: r.retorno || data.retornoSefaz || null
  };
  return {
    ...normalizado,
    ...classificarResultadoEmissaoNfe(normalizado)
  };
}

function deveBloquearNovaTransmissao(nota) {
  if (!nota) return { bloquear: false };
  const st = String(nota.status || '').toLowerCase();
  if (st === 'autorizada' || st === 'denegada' || st === 'cancelada') {
    return { bloquear: true, motivo: `Já existe NF-e ${st} (id ${nota.id}).` };
  }
  if (st === 'aguardando_retorno' || st === 'lote_enviado' || st === 'processando' || st === 'enviando') {
    return { bloquear: true, motivo: 'Há uma transmissão em andamento. Reconcilie antes de reenviar.' };
  }
  if (nota.protocolo || nota.recibo) {
    return { bloquear: true, motivo: 'Há recibo/protocolo de transmissão anterior. Reconcilie antes de reenviar.' };
  }
  const xmlRet = String(nota.xml_retorno || '');
  if (xmlRet && /<cStat>\s*\d+\s*<\/cStat>/i.test(xmlRet)) {
    return { bloquear: true, motivo: 'Há retorno SEFAZ anterior. Reconcilie o estado antes de nova transmissão.' };
  }
  if (st === 'rejeitada' || st === 'erro_comunicacao' || st === 'erro_transmissao') {
    if (nota.chave_acesso || xmlRet) {
      return { bloquear: true, motivo: 'Há evidência de transmissão anterior. Reconcilie antes de reenviar.' };
    }
  }
  return { bloquear: false };
}

module.exports = {
  CLASSE_EMISSAO,
  classificarResultadoEmissaoNfe,
  normalizarPayloadEmissaoNfe,
  extrairCstat,
  extrairXmotivo,
  cStatEhRejeicaoSefaz,
  deveBloquearNovaTransmissao
};
