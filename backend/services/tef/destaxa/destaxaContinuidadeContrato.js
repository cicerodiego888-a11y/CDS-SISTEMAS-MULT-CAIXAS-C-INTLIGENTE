'use strict';

/**
 * MRT-22 — Contrato de continuidade CRT Destaxa para o PDV.
 * Espelha TIPOS_ACAO / formato de respostasContinuidade sem inventar campos Destaxa.
 */

const { TIPOS_ACAO } = require('./destaxaConstantes');
const { CICLO_ERROS } = require('./destaxaCrtCicloOrquestracao');

const TIPOS_CONTINUIDADE = Object.freeze({
  DISPLAY: TIPOS_ACAO.DISPLAY,
  COLETA: TIPOS_ACAO.COLETA,
  OPCAO: TIPOS_ACAO.OPCAO
});

/**
 * Normaliza ação 99 vinda do ciclo/adapter para o PDV.
 */
function normalizarAcaoContinuidade(acao) {
  if (!acao || typeof acao !== 'object') {
    return {
      tipo: null,
      mensagem: '',
      opcoes: [],
      tipoDado: null,
      mascara: null,
      chave: null,
      timeout: null,
      reconhecida: false
    };
  }
  const tipo = String(acao.tipo || '').toUpperCase() || null;
  const opcoes = Array.isArray(acao.opcoes)
    ? acao.opcoes.map((o) => String(o).trim()).filter(Boolean)
    : [];
  return {
    tipo,
    mensagem: String(acao.mensagem || ''),
    opcoes,
    tipoDado: acao.tipoDado || null,
    mascara: acao.mascara || null,
    chave: acao.chave || null,
    timeout: acao.timeout || null,
    reconhecida: tipo === TIPOS_CONTINUIDADE.DISPLAY
      || tipo === TIPOS_CONTINUIDADE.COLETA
      || tipo === TIPOS_CONTINUIDADE.OPCAO
  };
}

/**
 * Valida resposta do operador antes de enviar ao ciclo.
 * @returns {{ ok: boolean, codigo?: string, mensagem?: string, resposta?: object }}
 */
function validarRespostaOperador(acao, respostaBruta) {
  const acaoN = normalizarAcaoContinuidade(acao);
  const tipo = acaoN.tipo;

  if (tipo === TIPOS_CONTINUIDADE.DISPLAY || tipo == null) {
    return { ok: true, resposta: { displayAck: true }, tipo };
  }

  if (tipo === TIPOS_CONTINUIDADE.COLETA) {
    let valor = null;
    if (respostaBruta == null) {
      return {
        ok: false,
        codigo: 'DESTAXA_PDV_COLETA_VAZIA',
        mensagem: 'COLETA exige valor informado pelo operador'
      };
    }
    if (typeof respostaBruta === 'string' || typeof respostaBruta === 'number') {
      valor = String(respostaBruta).trim();
    } else if (typeof respostaBruta === 'object') {
      valor = respostaBruta.informacao != null
        ? String(respostaBruta.informacao).trim()
        : (respostaBruta.valor != null ? String(respostaBruta.valor).trim() : '');
    }
    if (!valor) {
      return {
        ok: false,
        codigo: 'DESTAXA_PDV_COLETA_INVALIDA',
        mensagem: 'Resposta de COLETA inválida ou vazia'
      };
    }
    return { ok: true, resposta: { informacao: valor }, tipo };
  }

  if (tipo === TIPOS_CONTINUIDADE.OPCAO) {
    if (respostaBruta == null || respostaBruta === '') {
      return {
        ok: false,
        codigo: 'DESTAXA_PDV_OPCAO_AUSENTE',
        mensagem: 'OPCAO exige seleção do operador'
      };
    }
    const escolhida = typeof respostaBruta === 'object'
      ? String(respostaBruta.informacao || respostaBruta.opcao || respostaBruta.valor || '').trim()
      : String(respostaBruta).trim();
    if (!escolhida) {
      return {
        ok: false,
        codigo: 'DESTAXA_PDV_OPCAO_AUSENTE',
        mensagem: 'OPCAO exige seleção do operador'
      };
    }
    if (acaoN.opcoes.length > 0 && !acaoN.opcoes.includes(escolhida)) {
      return {
        ok: false,
        codigo: 'DESTAXA_PDV_OPCAO_INVALIDA',
        mensagem: `Seleção "${escolhida}" não está entre as opções do provedor`
      };
    }
    return { ok: true, resposta: { informacao: escolhida }, tipo };
  }

  return {
    ok: false,
    codigo: CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA,
    mensagem: `Tipo de continuidade não suportado: ${tipo || '(vazio)'}`
  };
}

/**
 * Payload HTTP /tef/continuar esperado.
 */
function montarPedidoContinuidade({
  transacaoId,
  idempotencyKey,
  resposta,
  vendaId,
  acao
} = {}) {
  return {
    transacao_id: transacaoId != null ? Number(transacaoId) || String(transacaoId) : null,
    idempotency_key: idempotencyKey || null,
    venda_id: vendaId != null ? vendaId : null,
    resposta_continuidade: resposta || null,
    acao: acao || null,
    // Nunca regenerar cobrança / TX_START
    nao_iniciar_tx: true
  };
}

function ehSolicitacaoContinuidade(resultado) {
  if (!resultado || typeof resultado !== 'object') return false;
  if (resultado.requerContinuacao === true) return true;
  if (resultado.codigo === CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA) return true;
  const codigo = String(resultado.codigoDestaxa || resultado.codigo || '').toUpperCase();
  return codigo === '99' && resultado.sucesso !== true;
}

module.exports = {
  TIPOS_CONTINUIDADE,
  normalizarAcaoContinuidade,
  validarRespostaOperador,
  montarPedidoContinuidade,
  ehSolicitacaoContinuidade,
  CICLO_ERROS_REF: CICLO_ERROS
};
