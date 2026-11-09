'use strict';

/**
 * MRT-50.67 — Política do contexto reservado de homologação Destaxa em débito.
 *
 * Escopo: adapter real + ambiente homologacao (caminho CRT real atual).
 * Não altera o catálogo comercial de formas de pagamento do PDV fora deste contexto.
 * Não converte crédito→débito nem inventa modalidade ausente.
 */

const {
  ERROS,
  VALOR_HOMOLOGACAO_CENTAVOS,
  AMBIENTE_TRANSACAO_REAL
} = require('./destaxaConstantes');
const { normalizarTipoTef } = require('../tefFluxoPagamento');

/** Únicas modalidades aceitas na autorização reservada de homologação (débito). */
const MODALIDADES_HOMOLOGACAO_DEBITO = Object.freeze(['cartao_debito', 'debito']);

function modalidadeHomologacaoDebitoPermitida(tipoPdv) {
  const tipo = normalizarTipoTef(tipoPdv);
  return MODALIDADES_HOMOLOGACAO_DEBITO.includes(tipo);
}

/**
 * Valida o envelope operacional da homologação de débito R$1,00.
 * Não chama DLL / NativeHost / adquirente.
 *
 * @returns {{ ok: true, tipoNormalizado: string, valorCentavos: number }
 *   | { ok: false, codigo: string, mensagem: string }}
 */
function validarContextoHomologacaoDebito({
  ambiente = null,
  tipoPdv = null,
  valorCentavos = null,
  modoAdapter = 'real'
} = {}) {
  const modo = String(modoAdapter || '').trim().toLowerCase();
  if (modo && modo !== 'real') {
    return {
      ok: false,
      codigo: ERROS.DESTAXA_INVALID_CONFIGURATION,
      mensagem: `Contexto de homologação débito exige adapter real; recebido ${modo || '(vazio)'}`
    };
  }

  const amb = String(ambiente || '').trim().toLowerCase();
  if (amb !== AMBIENTE_TRANSACAO_REAL) {
    return {
      ok: false,
      codigo: ERROS.DESTAXA_AMBIENTE_NAO_PERMITIDO,
      mensagem: `Homologação débito Destaxa permitida somente em ${AMBIENTE_TRANSACAO_REAL}; recebido ${amb || '(vazio)'}`
    };
  }

  if (valorCentavos == null || !Number.isSafeInteger(valorCentavos)) {
    return {
      ok: false,
      codigo: ERROS.DESTAXA_VALOR_NAO_PERMITIDO,
      mensagem: 'Valor de homologação inválido ou ausente'
    };
  }
  if (valorCentavos !== VALOR_HOMOLOGACAO_CENTAVOS) {
    return {
      ok: false,
      codigo: ERROS.DESTAXA_VALOR_NAO_PERMITIDO,
      mensagem: `Homologação Destaxa real aceita somente ${VALOR_HOMOLOGACAO_CENTAVOS} centavos (R$1,00)`
    };
  }

  const tipoBruto = tipoPdv == null ? '' : String(tipoPdv).trim();
  if (!tipoBruto) {
    return {
      ok: false,
      codigo: ERROS.DESTAXA_MODALIDADE_NAO_PERMITIDA,
      mensagem: 'Modalidade ausente — homologação reservada exige cartao_debito'
    };
  }

  const tipo = normalizarTipoTef(tipoBruto);
  if (!modalidadeHomologacaoDebitoPermitida(tipo)) {
    return {
      ok: false,
      codigo: ERROS.DESTAXA_MODALIDADE_NAO_PERMITIDA,
      mensagem: `Modalidade "${tipoBruto}" bloqueada no contexto de homologação débito (somente cartao_debito)`
    };
  }

  return {
    ok: true,
    tipoNormalizado: tipo,
    valorCentavos
  };
}

module.exports = {
  MODALIDADES_HOMOLOGACAO_DEBITO,
  modalidadeHomologacaoDebitoPermitida,
  validarContextoHomologacaoDebito
};
