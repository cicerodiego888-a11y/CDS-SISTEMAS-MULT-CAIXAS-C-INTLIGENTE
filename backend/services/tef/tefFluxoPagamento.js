/**
 * Regras de fluxo PDV/backend: TEF habilitado prevalece sobre confirmação fiscal manual
 * para pagamentos em cartão (e demais formas TEF).
 *
 * Sprint TEF×NF-e: NF_AVULSA não herda obrigatoriedade de PIX genérico da NFC-e.
 */

function normalizarFormaPagamentoTEF(forma) {
  return String(forma || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Formas TEF no fluxo NFC-e / PDV (regra atual — inclui PIX genérico). */
const FORMAS_TEF = new Set([
  'cartao',
  'cartao_credito',
  'cartao_debito',
  'credito',
  'debito',
  'pix',
  'pix_tef',
  'tef'
]);

/**
 * Formas que exigem TEF na NF-e Avulsa.
 * PIX genérico (`pix`) = manual/chave → sem TEF.
 * PIX integrado = `pix_tef` (e cartão/terminal).
 */
const FORMAS_TEF_NFE_AVULSA = new Set([
  'cartao',
  'cartao_credito',
  'cartao_debito',
  'credito',
  'debito',
  'pix_tef',
  'tef'
]);

function normalizarOrigemDocumento(origem) {
  return String(origem || '')
    .toUpperCase()
    .trim();
}

function ehOrigemNfeAvulsa(origem) {
  return normalizarOrigemDocumento(origem) === 'NF_AVULSA';
}

/**
 * @param {string} forma
 * @param {string} [origem] — NF_AVULSA | PDV | NFCE | … (omitido = regra NFC-e/PDV)
 */
function formaPagamentoUsaTEF(forma, origem) {
  const f = normalizarFormaPagamentoTEF(forma);
  if (ehOrigemNfeAvulsa(origem)) {
    return FORMAS_TEF_NFE_AVULSA.has(f);
  }
  return FORMAS_TEF.has(f);
}

function normalizarTipoTef(tipo) {
  const forma = normalizarFormaPagamentoTEF(tipo);
  if (forma === 'pix') {
    return 'pix_tef';
  }
  return forma;
}

function formaPagamentoGravacaoFiscal(forma) {
  const normalizada = normalizarFormaPagamentoTEF(forma);
  if (normalizada === 'pix_tef') {
    return 'pix';
  }
  return normalizada;
}

function ehPagamentoPixTef(tipo) {
  return normalizarTipoTef(tipo) === 'pix_tef';
}

function parseTefHabilitado(valor) {
  return valor === true || valor === 'true' || valor === '1' || valor === 1;
}

function pagamentoMistoExigeTef(pagamentos, origem) {
  return (pagamentos || []).some((pagamento) =>
    formaPagamentoUsaTEF(pagamento?.forma_pagamento, origem)
  );
}

function resolverFluxoPagamentoFiscal({
  modoConfirmacaoFiscal,
  tefHabilitado,
  formaPagamento,
  ehPagamentoMisto,
  pagamentosMistos,
  totalFiscal,
  origem
}) {
  const formaNormalizada = normalizarFormaPagamentoTEF(formaPagamento);
  const pagamentoExigeTef = ehPagamentoMisto
    ? pagamentoMistoExigeTef(pagamentosMistos, origem)
    : formaPagamentoUsaTEF(formaNormalizada, origem);
  const tefOn = parseTefHabilitado(tefHabilitado);

  // NF-e Avulsa: TEF só se forma integrada; não usa modo_confirmacao_fiscal (NFC-e/PDV)
  if (ehOrigemNfeAvulsa(origem)) {
    const deveUsarTefAutomatico = tefOn && pagamentoExigeTef;
    return {
      formaNormalizada,
      pagamentoExigeTef,
      deveUsarTefAutomatico,
      usarConfirmacaoManual: false,
      origem: 'NF_AVULSA'
    };
  }

  // NFC-e / PDV — regra atual preservada
  const deveUsarTefAutomatico = tefOn && pagamentoExigeTef;
  const modoManual = String(modoConfirmacaoFiscal || 'TEF').toUpperCase() === 'MANUAL';
  const usarConfirmacaoManual = modoManual
    && Number(totalFiscal) > 0
    && !deveUsarTefAutomatico;

  return {
    formaNormalizada,
    pagamentoExigeTef,
    deveUsarTefAutomatico,
    usarConfirmacaoManual,
    origem: normalizarOrigemDocumento(origem) || 'NFCE'
  };
}

function isConfirmacaoFiscalManualFlag(confirmacaoManualFlag, modoGlobalConfirmacaoFiscal) {
  if (
    confirmacaoManualFlag === true
    || confirmacaoManualFlag === 'true'
    || confirmacaoManualFlag === 1
    || confirmacaoManualFlag === '1'
  ) {
    return true;
  }
  return String(modoGlobalConfirmacaoFiscal || 'TEF').toUpperCase() === 'MANUAL';
}

function devePularAutorizacaoTefBackend({
  pagamentosJaProcessados,
  confirmacaoManualFlag,
  tefHabilitado,
  modoGlobalConfirmacaoFiscal
}) {
  if (pagamentosJaProcessados) {
    return true;
  }

  const manual = isConfirmacaoFiscalManualFlag(
    confirmacaoManualFlag,
    modoGlobalConfirmacaoFiscal
  );

  return manual && !parseTefHabilitado(tefHabilitado);
}

module.exports = {
  normalizarFormaPagamentoTEF,
  formaPagamentoUsaTEF,
  normalizarTipoTef,
  formaPagamentoGravacaoFiscal,
  ehPagamentoPixTef,
  parseTefHabilitado,
  pagamentoMistoExigeTef,
  resolverFluxoPagamentoFiscal,
  isConfirmacaoFiscalManualFlag,
  devePularAutorizacaoTefBackend,
  ehOrigemNfeAvulsa,
  normalizarOrigemDocumento,
  FORMAS_TEF,
  FORMAS_TEF_NFE_AVULSA
};
