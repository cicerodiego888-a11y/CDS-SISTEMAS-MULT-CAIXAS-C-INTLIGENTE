/**
 * Sprint 15.4 — ToledoSyncValidator
 * Valida resposta do lote: checksum, quantidade, integridade, resultado.
 */

'use strict';

const { SyncError, CODES } = require('./ToledoSyncErrors');

function validarItemCarga(item, tipo = 'PLU') {
  if (!item || typeof item !== 'object') {
    return { ok: false, erro: 'Item inválido' };
  }
  if (tipo === 'PLU' || tipo === 'PRECO' || tipo === 'ETIQUETA') {
    if (item.plu == null && item.codigo == null && item.produto_id == null) {
      return { ok: false, erro: 'PLU/código obrigatório' };
    }
  }
  if (tipo === 'DEPARTAMENTO' && item.departamento == null && item.id == null && item.codigo == null) {
    return { ok: false, erro: 'Departamento obrigatório' };
  }
  return { ok: true };
}

function validarCarga(itens, tipo = 'PLU') {
  const lista = Array.isArray(itens) ? itens : [];
  const erros = [];
  lista.forEach((item, idx) => {
    const v = validarItemCarga(item, tipo);
    if (!v.ok) erros.push({ index: idx, erro: v.erro, plu: item?.plu });
  });
  return { ok: erros.length === 0, erros, total: lista.length };
}

/**
 * Valida resposta 90AX de um item/lote.
 * @param {object} result — retorno de engine.execute
 * @param {{lote?:object, esperado?:number}} [ctx]
 */
function validarResposta(result, ctx = {}) {
  if (!result) {
    return { ok: false, erro: 'Resposta vazia', code: CODES.SYNC_FAILED };
  }
  if (result.sucesso !== true && result.success !== true) {
    return {
      ok: false,
      erro: result.erro?.mensagem || result.error || 'Falha no envio',
      code: result.erro?.codigo || CODES.SYNC_FAILED
    };
  }
  if (result.parsed && result.parsed.valid === false) {
    return { ok: false, erro: 'Checksum/frame inválido na resposta', code: 'INVALID_CHECKSUM' };
  }
  if (result.validacao === false) {
    return { ok: false, erro: 'Validação de protocolo falhou', code: 'INVALID_FRAME' };
  }

  const avisos = [];
  if (ctx.lote && ctx.lote.checksum && result.payload?.loteChecksum
    && String(result.payload.loteChecksum) !== String(ctx.lote.checksum)) {
    avisos.push('Checksum de lote divergente na resposta');
  }
  if (ctx.esperado != null && result.payload?.quantidade != null
    && Number(result.payload.quantidade) !== Number(ctx.esperado)) {
    avisos.push(`Quantidade divergente (esperado ${ctx.esperado})`);
  }

  return {
    ok: true,
    checksum: result.checksum || result.parsed?.checksum || null,
    responseCommand: result.responseCommand || result.parsed?.command || null,
    avisos,
    latenciaMs: result.latenciaMs || null,
    txHex: result.txHex || null,
    rxHex: result.rxHex || null
  };
}

function assertModo(modo) {
  const m = String(modo || '').toLowerCase();
  if (m === 'delta' || m === 'inteligente') return 'delta';
  if (m !== 'full' && m !== 'incremental' && m !== 'completo' && m !== 'alteracoes') {
    throw SyncError.fromCode(CODES.INVALID_INPUT, `Modo inválido: ${modo}`, { statusCode: 400 });
  }
  return m === 'completo' || m === 'full' ? 'full' : 'incremental';
}

module.exports = {
  validarItemCarga,
  validarCarga,
  validarResposta,
  assertModo
};
