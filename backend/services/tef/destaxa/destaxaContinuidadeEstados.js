'use strict';

/**
 * TEF-DESTAXA-51.05 — Estados explícitos de continuidade CRT (observabilidade).
 * UNKNOWN nunca autoriza retry automático.
 */

const destaxaLogger = require('./destaxaLogger');

const ESTADOS_CONTINUIDADE = Object.freeze({
  AGUARDANDO_COLETA: 'AGUARDANDO_COLETA',
  AGUARDANDO_RESPOSTA_OPERADOR: 'AGUARDANDO_RESPOSTA_OPERADOR',
  CONTINUANDO: 'CONTINUANDO',
  PROCESSANDO: 'PROCESSANDO',
  APROVADO: 'APROVADO',
  REJEITADO: 'REJEITADO',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN'
});

/** Chaves Destaxa cuja captura ocorre no PinPad — AC envia informacao vazia (MRT-50.74). */
const CHAVES_COLETA_PINPAD = Object.freeze([
  'transacao_cartao_numero',
  'transacao_cartao',
  'cartao',
  'senha',
  'senha_portador',
  'pin',
  'pin_online',
  'cvv',
  'codigo_seguranca'
]);

/**
 * COLETA delegada ao PinPad: não inventa PAN/senha; ack vazio libera TX_CONTINUE.
 */
function ehColetaDelegadaAoPinPad(acao = {}) {
  const chave = String(acao?.chave || '').trim().toLowerCase();
  if (chave) {
    if (CHAVES_COLETA_PINPAD.includes(chave)) return true;
    if (/cartao|senha|pin|track|emv|chip|aproxim/.test(chave)) return true;
  }
  const msg = String(acao?.mensagem || '').toLowerCase();
  if (/aproxime|insira|passe o cart|aguarde a senha|digite a senha|pin-pad|pinpad/.test(msg)) {
    return true;
  }
  return false;
}

/**
 * Timeout de continuidade no PDV quando Destaxa não declara `timeout` na ação.
 * Deve ser < 120s do V$Pague aguardando a aplicação comercial.
 */
const TIMEOUT_PDV_CONTINUIDADE_PADRAO_SEG = 90;

function registrarEventoContinuidade(evento, detalhe = {}) {
  try {
    destaxaLogger.registrarPersistente(`continuidade.${evento}`, {
      sprint: 'TEF-DESTAXA-51.05',
      evento: `continuidade.${evento}`,
      estado: detalhe.estado || null,
      transactionId: detalhe.transactionId != null ? String(detalhe.transactionId) : null,
      requestId: detalhe.requestId || null,
      codigo: detalhe.codigo || null,
      tipoAcao: detalhe.tipoAcao || null,
      chave: detalhe.chave ? '[chave]' : null,
      origem: detalhe.origem || null,
      retryAllowed: false
    });
  } catch (_) {
    /* observabilidade best-effort */
  }
}

module.exports = {
  ESTADOS_CONTINUIDADE,
  CHAVES_COLETA_PINPAD,
  TIMEOUT_PDV_CONTINUIDADE_PADRAO_SEG,
  ehColetaDelegadaAoPinPad,
  registrarEventoContinuidade
};
