'use strict';

/**
 * MRT-22 — Contrato de continuidade CRT Destaxa para o PDV.
 * Espelha TIPOS_ACAO / formato de respostasContinuidade sem inventar campos Destaxa.
 *
 * MRT-38 — Hardening no mesmo contrato (sem mecanismo paralelo):
 * timeout de coleta, resposta duplicada, ausência de operador/TTY,
 * correlação de identidade antes do ciclo.
 */

const { TIPOS_ACAO } = require('./destaxaConstantes');
const { CICLO_ERROS } = require('./destaxaCrtCicloOrquestracao');

const TIPOS_CONTINUIDADE = Object.freeze({
  DISPLAY: TIPOS_ACAO.DISPLAY,
  COLETA: TIPOS_ACAO.COLETA,
  OPCAO: TIPOS_ACAO.OPCAO
});

const ERROS_CONTINUIDADE = Object.freeze({
  OPCAO_AUSENTE: 'DESTAXA_PDV_OPCAO_AUSENTE',
  OPCAO_INVALIDA: 'DESTAXA_PDV_OPCAO_INVALIDA',
  COLETA_VAZIA: 'DESTAXA_PDV_COLETA_VAZIA',
  TIMEOUT: 'DESTAXA_CONTINUIDADE_TIMEOUT',
  RESPOSTA_DUPLICADA: 'DESTAXA_CONTINUIDADE_RESPOSTA_DUPLICADA',
  TIMESTAMP_INVALIDO: 'DESTAXA_CONTINUIDADE_TIMESTAMP_INVALIDO',
  TIMEOUT_INVALIDO: 'DESTAXA_CONTINUIDADE_TIMEOUT_INVALIDO',
  PERSISTENCIA_FALHOU: 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU',
  SEM_OPERADOR: 'DESTAXA_PDV_SEM_OPERADOR',
  SEM_TTY: 'DESTAXA_PDV_SEM_TTY',
  IDENTIDADE_AUSENTE: 'TEF_CONTINUIDADE_SEM_TRANSACAO',
  IDENTIDADE_DIVERGENTE: 'TEF_IDEMPOTENCY_DIVERGENTE',
  HOST_OFFLINE: 'TEF_NATIVE_HOST_SESSAO_PERDIDA'
});

/** Registro em memória do processo — protege reenvio idêntico do mesmo passo. */
const _respostasContinuidadeEnviadas = new Map();

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

function normalizarTimestampSolicitacao99(solicitadaEm) {
  if (typeof solicitadaEm === 'number' && Number.isFinite(solicitadaEm)) {
    const data = new Date(solicitadaEm);
    return Number.isFinite(data.getTime()) ? data.toISOString() : null;
  }
  if (typeof solicitadaEm !== 'string' || !solicitadaEm.trim()) return null;
  const instante = Date.parse(solicitadaEm);
  if (!Number.isFinite(instante)) return null;
  return new Date(instante).toISOString();
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

/**
 * PDV headless / Node sem DOM: coleta interativa não pode ficar silenciosa.
 */
function avaliarDisponibilidadeOperador(ambiente = {}) {
  if (ambiente.forcarSemOperador === true) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.SEM_OPERADOR,
      mensagem: 'Operador indisponível para continuidade TEF — coleta não pode ser descartada',
      requerIntervencao: true,
      retryAllowed: false
    };
  }
  if (ambiente.tty === false || ambiente.headless === true || ambiente.semTty === true) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.SEM_TTY,
      mensagem: 'Ambiente sem TTY/UI — OPCAO/COLETA exige operador no PDV; não seguir em silêncio',
      requerIntervencao: true,
      retryAllowed: false
    };
  }
  const temDom = ambiente.document === true
    || (typeof document !== 'undefined' && document != null);
  const temJquery = ambiente.jquery === true
    || (typeof globalThis !== 'undefined' && typeof globalThis.$ === 'function');
  if (ambiente.exigirUi === true && (!temDom || !temJquery)) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.SEM_TTY,
      mensagem: 'UI PDV ausente (document/$); continuidade interativa bloqueada explicitamente',
      requerIntervencao: true,
      retryAllowed: false
    };
  }
  return { ok: true };
}

/**
 * Timeout do campo `timeout` (segundos) da ação 99 — autoridade do Client Destaxa.
 * Sem solicitadaEm válido, não inventa expiração.
 */
function avaliarTimeoutColeta({
  timeoutSegundos,
  solicitadaEm,
  agoraMs = Date.now()
} = {}) {
  const timestampNormalizado = normalizarTimestampSolicitacao99(solicitadaEm);
  if (!timestampNormalizado) {
    return {
      ok: false,
      avaliado: false,
      codigo: ERROS_CONTINUIDADE.TIMESTAMP_INVALIDO,
      mensagem: 'Timestamp original da solicitação 99 ausente ou inválido — continuidade recusada',
      financialStateHint: 'UNKNOWN',
      retryAllowed: false,
      reconciliacaoObrigatoria: true
    };
  }
  if (timeoutSegundos == null || timeoutSegundos === '') {
    return { ok: true, avaliado: false, solicitadaEm: timestampNormalizado };
  }
  const seg = Number(timeoutSegundos);
  if (!Number.isFinite(seg) || seg <= 0) {
    return {
      ok: false,
      avaliado: false,
      codigo: ERROS_CONTINUIDADE.TIMEOUT_INVALIDO,
      mensagem: 'Timeout declarado pela solicitação 99 é inválido — continuidade recusada',
      financialStateHint: 'UNKNOWN',
      retryAllowed: false,
      reconciliacaoObrigatoria: true
    };
  }
  const inicioMs = Date.parse(timestampNormalizado);
  const limite = inicioMs + (seg * 1000);
  if (agoraMs > limite) {
    return {
      ok: false,
      avaliado: true,
      codigo: ERROS_CONTINUIDADE.TIMEOUT,
      mensagem: `Timeout de coleta (${seg}s) excedido — continuidade recusada; estado UNKNOWN; sem retry`,
      financialStateHint: 'UNKNOWN',
      retryAllowed: false,
      reconciliacaoObrigatoria: true
    };
  }
  return {
    ok: true,
    avaliado: true,
    restanteMs: limite - agoraMs,
    solicitadaEm: timestampNormalizado
  };
}

function _fingerprintResposta(resposta) {
  if (resposta == null) return '';
  if (typeof resposta === 'string' || typeof resposta === 'number') return String(resposta).trim();
  if (typeof resposta === 'object') {
    if (resposta.informacao != null) return `informacao=${String(resposta.informacao).trim()}`;
    if (resposta.displayAck === true) return 'displayAck';
    try {
      return JSON.stringify(resposta);
    } catch (_) {
      return String(resposta);
    }
  }
  return String(resposta);
}

function _chaveDuplicata({ transactionId, acao, resposta, solicitadaEm }) {
  const a = normalizarAcaoContinuidade(acao);
  return [
    String(transactionId || ''),
    a.tipo || '',
    a.chave || '',
    a.mensagem || '',
    normalizarTimestampSolicitacao99(solicitadaEm) || '',
    _fingerprintResposta(resposta)
  ].join('|');
}

/**
 * Rejeita o mesmo passo+resposta já aceito nesta identidade (anti-duplo clique / reenvio).
 */
function registrarOuRejeitarRespostaDuplicada({
  transactionId,
  acao,
  resposta,
  solicitadaEm,
  registrar = true
} = {}) {
  if (transactionId == null || String(transactionId).trim() === '') {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.IDENTIDADE_AUSENTE,
      mensagem: 'transactionId obrigatório para anti-duplicata de continuidade',
      retryAllowed: false
    };
  }
  const chave = _chaveDuplicata({ transactionId, acao, resposta, solicitadaEm });
  if (_respostasContinuidadeEnviadas.has(chave)) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA,
      mensagem: 'Resposta de continuidade já registrada para este passo — reenvio bloqueado',
      retryAllowed: false
    };
  }
  if (registrar) {
    _respostasContinuidadeEnviadas.set(chave, Date.now());
  }
  return { ok: true, chave };
}

function limparRegistrosContinuidade(transactionId = null) {
  if (transactionId == null) {
    _respostasContinuidadeEnviadas.clear();
    return;
  }
  const prefixo = `${String(transactionId)}|`;
  for (const k of [..._respostasContinuidadeEnviadas.keys()]) {
    if (k.startsWith(prefixo)) _respostasContinuidadeEnviadas.delete(k);
  }
}

function correlacionarIdentidadeContinuidade({
  transactionId,
  idempotencyKeyInformada,
  idempotencyKeyPersistida
} = {}) {
  if (transactionId == null || String(transactionId).trim() === '') {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.IDENTIDADE_AUSENTE,
      mensagem: 'transacao_id obrigatório para continuidade',
      retryAllowed: false
    };
  }
  if (idempotencyKeyInformada && idempotencyKeyPersistida
    && String(idempotencyKeyInformada) !== String(idempotencyKeyPersistida)) {
    return {
      ok: false,
      codigo: ERROS_CONTINUIDADE.IDENTIDADE_DIVERGENTE,
      mensagem: 'idempotency_key diverge da transação — nova cobrança/TX_START proibida',
      retryAllowed: false
    };
  }
  return {
    ok: true,
    transactionId: String(transactionId),
    idempotency_key: idempotencyKeyInformada || idempotencyKeyPersistida || null
  };
}

/**
 * Pipeline único de validação pré-ciclo (OPCAO/COLETA/DISPLAY).
 * Não chama DLL. Não cria identidade.
 */
function validarContinuidadeCompleta({
  acao,
  respostaBruta,
  transactionId,
  idempotencyKeyInformada,
  idempotencyKeyPersistida,
  solicitadaEm,
  agoraMs,
  ambienteOperador,
  registrarDuplicata = true
} = {}) {
  const idCheck = correlacionarIdentidadeContinuidade({
    transactionId,
    idempotencyKeyInformada,
    idempotencyKeyPersistida
  });
  if (!idCheck.ok) return idCheck;

  const op = avaliarDisponibilidadeOperador(ambienteOperador || {});
  if (!op.ok) return op;

  const acaoN = normalizarAcaoContinuidade(acao);
  const validacao = validarRespostaOperador(acaoN, respostaBruta);
  if (!validacao.ok) return validacao;

  const to = avaliarTimeoutColeta({
    timeoutSegundos: acaoN.timeout,
    solicitadaEm,
    agoraMs
  });
  if (!to.ok) return to;

  const dup = registrarOuRejeitarRespostaDuplicada({
    transactionId: idCheck.transactionId,
    acao: acaoN,
    resposta: validacao.resposta,
    solicitadaEm: to.solicitadaEm,
    registrar: registrarDuplicata
  });
  if (!dup.ok) return dup;

  return {
    ok: true,
    tipo: validacao.tipo,
    resposta: validacao.resposta,
    acao: acaoN,
    transactionId: idCheck.transactionId,
    idempotency_key: idCheck.idempotency_key,
    solicitadaEm: to.solicitadaEm,
    entradaContinuaEsperada: validacao.resposta?.informacao != null
      ? `informacao=${validacao.resposta.informacao}`
      : (validacao.resposta?.displayAck ? '' : null)
  };
}

module.exports = {
  TIPOS_CONTINUIDADE,
  ERROS_CONTINUIDADE,
  normalizarAcaoContinuidade,
  normalizarTimestampSolicitacao99,
  validarRespostaOperador,
  montarPedidoContinuidade,
  ehSolicitacaoContinuidade,
  avaliarDisponibilidadeOperador,
  avaliarTimeoutColeta,
  registrarOuRejeitarRespostaDuplicada,
  limparRegistrosContinuidade,
  correlacionarIdentidadeContinuidade,
  validarContinuidadeCompleta,
  CICLO_ERROS_REF: CICLO_ERROS
};
