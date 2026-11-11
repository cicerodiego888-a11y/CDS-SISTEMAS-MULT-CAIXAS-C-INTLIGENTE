'use strict';

const { isDeepStrictEqual } = require('util');

/**
 * MRT-21 — Orquestração segura do ciclo CRT Destaxa (mesmo Native Host / bridge).
 *
 * Sequência: TX_START → (99 → TX_CONTINUE)* → TX_FINALIZE quando conclusivo 00.
 * Não faz retry de TX_START. Não trata 99 como aprovação. Timeout ≠ cancelamento.
 *
 * Usado pelo DestaxaRealAdapter.autorizarPagamento (fluxo TefManager), isolado do
 * harness MRT-20 e sem alterar o contrato genérico do TefManager além do retorno.
 */

const {
  OPERACOES,
  TIPOS_ACAO,
  CLASSIFICACAO_CODIGO,
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR,
  ERROS,
  transacaoRealHabilitada
} = require('./destaxaConstantes');
const { ERROS_HOST } = require('./destaxaNativeHostProtocolo');
const {
  extrairEvidenciasRetorno00,
  classificarRetornoA1
} = require('./destaxaProtocolo');

const MAX_CONTINUES_PADRAO = 32;

const CICLO_ERROS = Object.freeze({
  TX_START_REPETIDO: 'DESTAXA_CICLO_TX_START_REPETIDO',
  CONTINUIDADE_SEM_RESPOSTA: 'DESTAXA_CICLO_CONTINUIDADE_SEM_RESPOSTA',
  LIMITE_CONTINUE: 'DESTAXA_CICLO_LIMITE_CONTINUE',
  HOST_ENCERRADO: 'DESTAXA_CICLO_HOST_ENCERRADO',
  HOST_BUSY: 'DESTAXA_CICLO_HOST_BUSY',
  INCONCLUSIVO: 'DESTAXA_CICLO_INCONCLUSIVO',
  INIT_OU_GATE: 'DESTAXA_CICLO_BLOQUEADO_PRE_TX',
  /** TEF-DESTAXA-51.25 — FINALIZE(0) bloqueado sem evidências 00 persistidas/confirmadas */
  EVIDENCIAS_NAO_PERSISTIDAS: 'DESTAXA_CICLO_EVIDENCIAS_NAO_PERSISTIDAS',
  A1_BLOQUEADO: 'DESTAXA_CICLO_A1_BLOQUEADO'
});

function bridgeUsaDriverNativo(bridge) {
  try {
    const orq = typeof bridge?.getOrquestradorTransacao === 'function'
      ? bridge.getOrquestradorTransacao()
      : null;
    return orq?._driver?.nome === 'native';
  } catch (_) {
    return false;
  }
}

/** Gate env ON ou permit excepcional one-shot já instalado no orquestrador. */
function bridgePossuiGateOuExcepcional(bridge) {
  if (transacaoRealHabilitada()) return true;
  try {
    const orq = typeof bridge?.getOrquestradorTransacao === 'function'
      ? bridge.getOrquestradorTransacao()
      : null;
    const permit = typeof orq?.obterPermitExcepcional === 'function'
      ? orq.obterPermitExcepcional()
      : null;
    if (permit && permit.exceptional === true && permit.oneShot === true) return true;
  } catch (_) { /* ignore */ }
  return false;
}

function bloquearCicloPorGate(passos, transactionId, soContinuidade = false) {
  return {
    sucesso: false,
    conclusivo: true,
    retryAllowed: false,
    codigo: CICLO_ERROS.INIT_OU_GATE,
    mensagem: 'Ciclo CRT bloqueado: gate financeiro OFF — TX_START/CONTINUE/FINALIZE nativos recusados',
    financialState: 'UNKNOWN',
    transactionId: transactionId || null,
    ciclo: {
      passos,
      txStartExecutado: false,
      continues: 0,
      finalizado: false,
      soContinuidade: soContinuidade === true
    },
    reconciliacaoObrigatoria: false
  };
}

function codigoDe(resultado) {
  return String(resultado?.codigoDestaxa || resultado?.codigo || '').trim().toUpperCase();
}

function ehHostMorto(resultado) {
  const c = codigoDe(resultado);
  return c === ERROS_HOST.HOST_OFFLINE
    || c === ERROS_HOST.HOST_CRASHED
    || c === ERROS_HOST.HOST_UNAVAILABLE
    || c === CICLO_ERROS.HOST_ENCERRADO
    || resultado?.hostError === ERROS_HOST.HOST_OFFLINE;
}

function ehHostBusy(resultado) {
  const c = codigoDe(resultado);
  return c === ERROS_HOST.HOST_BUSY || c === CICLO_ERROS.HOST_BUSY;
}

function ehInconclusivo(resultado) {
  const c = codigoDe(resultado);
  if (c === '08') return true;
  if (resultado?.financialState === 'UNKNOWN') return true;
  if (resultado?.classificacao === CLASSIFICACAO_CODIGO.TIMEOUT) return true;
  if (resultado?.classificacao === CLASSIFICACAO_CODIGO.UNKNOWN) return true;
  if (resultado?.classificacao === CLASSIFICACAO_CODIGO.UNCONFIRMED) return true;
  if (resultado?.estado === 'TIMEOUT' || resultado?.estado === 'UNKNOWN') return true;
  return false;
}

function ehAcaoRequerida(resultado) {
  return resultado?.requerContinuacao === true
    || codigoDe(resultado) === '99'
    || resultado?.classificacao === CLASSIFICACAO_CODIGO.ACTION_REQUIRED;
}

function ehSucessoConclusivo(resultado) {
  return resultado?.sucesso === true
    || codigoDe(resultado) === '00'
    || resultado?.classificacao === CLASSIFICACAO_CODIGO.SUCCESS;
}

function ehNegado(resultado) {
  const c = codigoDe(resultado);
  return ['03', '04', '09'].includes(c)
    || resultado?.classificacao === CLASSIFICACAO_CODIGO.DENIED;
}

function ehA1(resultado) {
  return codigoDe(resultado) === 'A1';
}

function fecharBloqueioA1({
  resultado,
  transactionId,
  passos,
  continues,
  txStartExecutado,
  soContinuidade,
  origemApi
}) {
  const meta = classificarRetornoA1(origemApi || 'iniciaTransacaoDestaxa', {
    transactionId: resultado?.contexto?.transactionId || transactionId || null
  });
  return {
    sucesso: false,
    conclusivo: false,
    inconclusivo: true,
    retryAllowed: false,
    bloqueadoA1: true,
    codigo: CICLO_ERROS.A1_BLOQUEADO,
    codigoDestaxa: 'A1',
    mensagem: meta.mensagem,
    financialState: 'BLOCKED',
    estado: 'BLOCKED',
    a1: meta,
    resultadoUltimo: resultado,
    resultadoInicio: null,
    evidencias: null,
    finalizeExecutado: false,
    transactionId: meta.transactionId,
    ciclo: {
      passos,
      txStartExecutado: txStartExecutado === true,
      continues,
      finalizado: false,
      soContinuidade: soContinuidade === true
    },
    reconciliacaoObrigatoria: true
  };
}

async function _confirmarPersistenciaEvidencias00({
  persistirEvidencias,
  exigirEvidencias,
  transactionId,
  resultado00,
  evidencias,
  emitir
}) {
  emitir('RECEBER_00', {
    codigoDestaxa: '00',
    nsu: evidencias?.nsu || null,
    temAutorizacao: Boolean(evidencias?.autorizacao),
    temComprovante1via: Boolean(evidencias?.comprovanteCliente),
    temComprovante2via: Boolean(evidencias?.comprovanteLoja)
  });
  emitir('EXTRAIR_EVIDENCIAS', {
    completa: evidencias?.completa === true,
    parcial: evidencias?.parcial === true
  });

  if (exigirEvidencias !== true && typeof persistirEvidencias !== 'function') {
    return {
      ok: true,
      skipped: true,
      evidencias,
      confirmada: false
    };
  }

  if (typeof persistirEvidencias !== 'function') {
    return {
      ok: false,
      codigo: CICLO_ERROS.EVIDENCIAS_NAO_PERSISTIDAS,
      mensagem: 'FINALIZE(0) bloqueado: callback de persistência de evidências 00 ausente',
      evidencias
    };
  }

  if (evidencias?.completa !== true) {
    return {
      ok: false,
      codigo: CICLO_ERROS.EVIDENCIAS_NAO_PERSISTIDAS,
      mensagem: 'FINALIZE(0) bloqueado: evidências do retorno 00 incompletas (NSU ausente)',
      evidencias,
      parcial: true
    };
  }

  emitir('PERSISTIR_EVIDENCIAS', { transactionId });
  let resultado;
  try {
    resultado = await persistirEvidencias({
      transactionId,
      resultado00,
      evidencias
    });
  } catch (error) {
    return {
      ok: false,
      codigo: error.codigo || error.code || CICLO_ERROS.EVIDENCIAS_NAO_PERSISTIDAS,
      mensagem: `FINALIZE(0) bloqueado: falha ao persistir evidências 00: ${error.message}`,
      evidencias
    };
  }

  const txId = transactionId == null ? '' : String(transactionId).trim();
  const confirmada = resultado?.ok === true
    && resultado?.confirmada === true
    && resultado?.duravel === true
    && String(resultado.transactionId || '') === txId
    && resultado?.evidencias?.nsu
    && String(resultado.evidencias.nsu) === String(evidencias.nsu);

  emitir('CONFIRMAR_PERSISTENCIA', {
    confirmada,
    codigo: resultado?.codigo || null
  });

  if (!confirmada) {
    return {
      ok: false,
      codigo: resultado?.codigo || CICLO_ERROS.EVIDENCIAS_NAO_PERSISTIDAS,
      mensagem: resultado?.mensagem
        || 'FINALIZE(0) bloqueado: persistência das evidências 00 não confirmada',
      evidencias,
      persistencia: resultado || null
    };
  }

  return {
    ok: true,
    confirmada: true,
    evidencias: resultado.evidencias || evidencias,
    persistencia: resultado
  };
}

/**
 * Resolve resposta para continuaTransacaoDestaxa sem inventar coleta/opção.
 * DISPLAY → ack vazio.
 * COLETA PinPad (cartão/senha no terminal) → informacao vazia (MRT-50.74 / 51.05) — não inventa PAN.
 * COLETA/OPCAO tipadas → fila explícita do chamador / PDV.
 */
function resolverRespostaContinuidade(acao, filaRespostas) {
  const {
    ehColetaDelegadaAoPinPad,
    registrarEventoContinuidade,
    ESTADOS_CONTINUIDADE
  } = require('./destaxaContinuidadeEstados');
  const tipo = acao?.tipo || null;
  if (tipo === TIPOS_ACAO.DISPLAY || tipo == null) {
    return { ok: true, resposta: { displayAck: true }, origem: 'display_ack' };
  }
  if (tipo === TIPOS_ACAO.COLETA && ehColetaDelegadaAoPinPad(acao)) {
    registrarEventoContinuidade('pinpad_ack_vazio', {
      estado: ESTADOS_CONTINUIDADE.CONTINUANDO,
      tipoAcao: tipo,
      chave: acao?.chave || null,
      origem: 'pinpad_ack_vazio'
    });
    return { ok: true, resposta: { informacao: '' }, origem: 'pinpad_ack_vazio' };
  }
  if (tipo === TIPOS_ACAO.COLETA || tipo === TIPOS_ACAO.OPCAO) {
    if (!Array.isArray(filaRespostas) || filaRespostas.length === 0) {
      registrarEventoContinuidade('sem_resposta_fila', {
        estado: ESTADOS_CONTINUIDADE.AGUARDANDO_RESPOSTA_OPERADOR,
        tipoAcao: tipo,
        chave: acao?.chave || null,
        codigo: CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA
      });
      return {
        ok: false,
        codigo: CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA,
        mensagem: `Ação ${tipo} exige resposta explícita na fila respostasContinuidade — 99 não é aprovação`
      };
    }
    const proxima = filaRespostas.shift();
    if (proxima == null) {
      return {
        ok: false,
        codigo: CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA,
        mensagem: `Fila vazia para ação ${tipo}`
      };
    }
    if (typeof proxima === 'string' || typeof proxima === 'number') {
      return { ok: true, resposta: { informacao: String(proxima) }, origem: 'fila' };
    }
    return { ok: true, resposta: proxima, origem: 'fila' };
  }
  return {
    ok: false,
    codigo: CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA,
    mensagem: `Tipo de ação 99 não suportado para auto-continuidade: ${tipo}`
  };
}

/**
 * @param {object} deps
 * @param {object} deps.bridge - DestaxaHostBridge / NativeBridge (mesma instância do ciclo)
 * @param {string} [deps.operacao]
 * @param {object} deps.camposEntrada
 * @param {string|null} [deps.transactionId]
 * @param {array} [deps.respostasContinuidade]
 * @param {number} [deps.maxContinues]
 * @param {function} [deps.onPasso]
 */
async function executarCicloCrt(deps = {}) {
  const bridge = deps.bridge;
  const operacao = String(deps.operacao || OPERACOES.CRT).toUpperCase();
  const camposEntrada = deps.camposEntrada || {};
  const transactionId = deps.transactionId != null ? String(deps.transactionId) : null;
  const fila = Array.isArray(deps.respostasContinuidade)
    ? [...deps.respostasContinuidade]
    : [];
  const maxContinues = Number.isInteger(deps.maxContinues) && deps.maxContinues > 0
    ? deps.maxContinues
    : MAX_CONTINUES_PADRAO;
  const onPasso = typeof deps.onPasso === 'function' ? deps.onPasso : null;

  const passos = [];
  let txStartExecutado = false;
  let continues = 0;

  const emitir = (passo, detalhe) => {
    const entrada = { passo, em: new Date().toISOString(), ...detalhe };
    passos.push(entrada);
    if (onPasso) onPasso(entrada);
    return entrada;
  };

  const fecharInconclusivo = (resultado, motivo) => ({
    sucesso: false,
    conclusivo: false,
    inconclusivo: true,
    retryAllowed: false,
    codigo: CICLO_ERROS.INCONCLUSIVO,
    codigoDestaxa: codigoDe(resultado) || null,
    mensagem: motivo || 'Resultado inconclusivo — reconciliação obrigatória; sem nova cobrança automática',
    financialState: resultado?.financialState || 'UNKNOWN',
    estado: resultado?.estado || null,
    transactionId: resultado?.contexto?.transactionId || transactionId,
    resultadoUltimo: resultado,
    ciclo: { passos, txStartExecutado, continues, finalizado: false },
    reconciliacaoObrigatoria: true
  });

  if (operacao !== OPERACOES.CRT) {
    return {
      sucesso: false,
      conclusivo: true,
      retryAllowed: false,
      codigo: ERROS.DESTAXA_OPERACAO_NAO_PERMITIDA,
      mensagem: `Ciclo CRT recusou operação ${operacao}`,
      ciclo: { passos, txStartExecutado: false, continues: 0, finalizado: false }
    };
  }

  // MRT-27 — ciclo de produção exige identidade persistida quando solicitado
  if (deps.exigirPersistencia === true && (transactionId == null || String(transactionId).trim() === '')) {
    emitir('TX_START_BLOQUEADO', { motivo: 'TEF_PERSISTENCIA_OBRIGATORIA' });
    return {
      sucesso: false,
      conclusivo: true,
      retryAllowed: false,
      codigo: ERROS.TEF_PERSISTENCIA_OBRIGATORIA || 'TEF_PERSISTENCIA_OBRIGATORIA',
      mensagem: 'Ciclo CRT bloqueado: sem transactionId persistido (TefManager)',
      financialState: 'UNKNOWN',
      transactionId: null,
      ciclo: { passos, txStartExecutado: false, continues: 0, finalizado: false },
      reconciliacaoObrigatoria: false
    };
  }

  // MRT-50.67 / 51.02 — gate env ou permit excepcional antes de TX_START nativo
  if (bridgeUsaDriverNativo(bridge) && !bridgePossuiGateOuExcepcional(bridge)) {
    emitir('TX_START_BLOQUEADO', { motivo: ERROS.DESTAXA_REAL_TRANSACTION_DISABLED });
    return bloquearCicloPorGate(passos, transactionId, false);
  }

  txStartExecutado = true;
  emitir('TX_START', { operacao, transactionId });
  // 51.05 — cede event loop do Electron main antes da IPC TX_START (evita NOT_RESPONDING)
  await new Promise((r) => setImmediate(r));
  let atual = await bridge.iniciarTransacaoDestaxa(operacao, camposEntrada, { transactionId });
  emitir('TX_START_RESULT', {
    codigoDestaxa: codigoDe(atual),
    requerContinuacao: ehAcaoRequerida(atual),
    sucesso: atual?.sucesso === true
  });

  if (ehHostBusy(atual)) {
    return {
      sucesso: false,
      conclusivo: false,
      retryAllowed: false,
      codigo: CICLO_ERROS.HOST_BUSY,
      mensagem: 'Host ocupado — TX_START não concluído; sem retry automático',
      resultadoUltimo: atual,
      ciclo: { passos, txStartExecutado: false, continues: 0, finalizado: false }
    };
  }
  // Busy: marcar que não houve start efetivo para o chamador (flag local já true —
  // reportamos txStartExecutado:false no ciclo pois provedor não aceitou)
  if (ehHostMorto(atual)) {
    return {
      sucesso: false,
      conclusivo: false,
      retryAllowed: false,
      codigo: CICLO_ERROS.HOST_ENCERRADO,
      mensagem: 'Native Host encerrado durante TX_START',
      resultadoUltimo: atual,
      ciclo: { passos, txStartExecutado: true, continues: 0, finalizado: false },
      reconciliacaoObrigatoria: true
    };
  }
  if (ehA1(atual)) {
    emitir('A1_BLOQUEADO', { origemApi: 'iniciaTransacaoDestaxa' });
    return fecharBloqueioA1({
      resultado: atual,
      transactionId,
      passos,
      continues,
      txStartExecutado: true,
      soContinuidade: false,
      origemApi: 'iniciaTransacaoDestaxa'
    });
  }

  if (ehInconclusivo(atual)) {
    return fecharInconclusivo(atual, 'Timeout/inconclusivo em TX_START');
  }

  return prosseguirCicloAposResultado({
    bridge,
    atual,
    transactionId,
    fila,
    maxContinues,
    passos,
    continues,
    emitir,
    fecharInconclusivo,
    txStartExecutado: true,
    persistirRespostaAntesContinue: deps.persistirRespostaAntesContinue,
    persistirEvidenciasAntesFinalize: deps.persistirEvidenciasAntesFinalize,
    exigirEvidenciasAntesFinalize: deps.exigirEvidenciasAntesFinalize === true
  });
}

/**
 * Continuação explícita do PDV após COLETA/OPCAO — NUNCA chama TX_START.
 * `respostaOperador` é a resposta imediata; `respostasContinuidade` cobre passos seguintes.
 */
async function continuarCicloCrt(deps = {}) {
  const bridge = deps.bridge;
  const transactionId = deps.transactionId != null ? String(deps.transactionId) : null;
  const fila = Array.isArray(deps.respostasContinuidade)
    ? [...deps.respostasContinuidade]
    : [];
  const maxContinues = Number.isInteger(deps.maxContinues) && deps.maxContinues > 0
    ? deps.maxContinues
    : MAX_CONTINUES_PADRAO;
  const onPasso = typeof deps.onPasso === 'function' ? deps.onPasso : null;
  const persistirRespostaAntesContinue = deps.persistirRespostaAntesContinue;
  const passos = [];
  let continues = 0;

  const emitir = (passo, detalhe) => {
    const entrada = { passo, em: new Date().toISOString(), ...detalhe };
    passos.push(entrada);
    if (onPasso) onPasso(entrada);
    return entrada;
  };

  const fecharInconclusivo = (resultado, motivo) => ({
    sucesso: false,
    conclusivo: false,
    inconclusivo: true,
    retryAllowed: false,
    codigo: CICLO_ERROS.INCONCLUSIVO,
    codigoDestaxa: codigoDe(resultado) || null,
    mensagem: motivo || 'Resultado inconclusivo — reconciliação obrigatória; sem nova cobrança automática',
    financialState: resultado?.financialState || 'UNKNOWN',
    estado: resultado?.estado || null,
    transactionId: resultado?.contexto?.transactionId || transactionId,
    resultadoUltimo: resultado,
    ciclo: { passos, txStartExecutado: false, continues, finalizado: false, soContinuidade: true },
    reconciliacaoObrigatoria: true
  });

  // MRT-50.67 / 51.02 — CONTINUE nativo exige gate env OU permit excepcional
  if (bridgeUsaDriverNativo(bridge) && !bridgePossuiGateOuExcepcional(bridge)) {
    emitir('TX_CONTINUE_BLOQUEADO', { motivo: ERROS.DESTAXA_REAL_TRANSACTION_DISABLED });
    return bloquearCicloPorGate(passos, transactionId, true);
  }

  if (deps.respostaOperador == null && fila.length === 0) {
    return {
      sucesso: false,
      conclusivo: false,
      retryAllowed: false,
      codigo: CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA,
      mensagem: 'continuarCicloCrt exige respostaOperador ou respostasContinuidade',
      requerContinuacao: true,
      ciclo: { passos, txStartExecutado: false, continues: 0, finalizado: false, soContinuidade: true }
    };
  }

  const primeira = deps.respostaOperador != null
    ? (typeof deps.respostaOperador === 'string' || typeof deps.respostaOperador === 'number'
      ? { informacao: String(deps.respostaOperador) }
      : deps.respostaOperador)
    : null;

  let atual;
  if (primeira) {
    const persistencia = await _persistirAntesContinue({
      persistirResposta: persistirRespostaAntesContinue,
      transactionId,
      acao: deps.acaoAtual || null,
      resposta: primeira,
      solicitadaEm: deps.solicitadaEm
    });
    if (!persistencia.ok) {
      return _resultadoPersistenciaContinuidadeFalhou(
        transactionId,
        persistencia,
        passos,
        continues,
        false
      );
    }
    continues += 1;
    emitir('TX_CONTINUE', { n: continues, origemResposta: 'operador_pdv', soContinuidade: true });
    atual = await bridge.continuarTransacaoDestaxa(primeira, { transactionId });
    emitir('TX_CONTINUE_RESULT', {
      n: continues,
      codigoDestaxa: codigoDe(atual),
      requerContinuacao: ehAcaoRequerida(atual)
    });
  } else {
    // Fila-only: monta resposta sintética a partir do próximo item — exige acaoAtual
    const resolucao = resolverRespostaContinuidade(deps.acaoAtual || { tipo: TIPOS_ACAO.COLETA }, fila);
    if (!resolucao.ok) {
      return {
        sucesso: false,
        conclusivo: false,
        retryAllowed: false,
        codigo: resolucao.codigo,
        mensagem: resolucao.mensagem,
        requerContinuacao: true,
        acao: deps.acaoAtual || null,
        ciclo: { passos, txStartExecutado: false, continues: 0, finalizado: false, soContinuidade: true }
      };
    }
    const persistencia = await _persistirAntesContinue({
      persistirResposta: persistirRespostaAntesContinue,
      transactionId,
      acao: deps.acaoAtual || null,
      resposta: resolucao.resposta,
      solicitadaEm: deps.solicitadaEm
    });
    if (!persistencia.ok) {
      return _resultadoPersistenciaContinuidadeFalhou(
        transactionId,
        persistencia,
        passos,
        continues,
        false
      );
    }
    continues += 1;
    emitir('TX_CONTINUE', { n: continues, origemResposta: resolucao.origem, soContinuidade: true });
    atual = await bridge.continuarTransacaoDestaxa(resolucao.resposta, { transactionId });
    emitir('TX_CONTINUE_RESULT', {
      n: continues,
      codigoDestaxa: codigoDe(atual),
      requerContinuacao: ehAcaoRequerida(atual)
    });
  }

  if (ehHostBusy(atual)) {
    return {
      sucesso: false,
      conclusivo: false,
      retryAllowed: false,
      codigo: CICLO_ERROS.HOST_BUSY,
      mensagem: 'Host ocupado em TX_CONTINUE',
      resultadoUltimo: atual,
      ciclo: { passos, txStartExecutado: false, continues, finalizado: false, soContinuidade: true },
      reconciliacaoObrigatoria: true
    };
  }
  if (ehHostMorto(atual)) {
    return {
      sucesso: false,
      conclusivo: false,
      retryAllowed: false,
      codigo: CICLO_ERROS.HOST_ENCERRADO,
      mensagem: 'Native Host encerrado durante TX_CONTINUE',
      resultadoUltimo: atual,
      ciclo: { passos, txStartExecutado: false, continues, finalizado: false, soContinuidade: true },
      reconciliacaoObrigatoria: true
    };
  }
  if (ehA1(atual)) {
    emitir('A1_BLOQUEADO', { origemApi: 'continuaTransacaoDestaxa' });
    return fecharBloqueioA1({
      resultado: atual,
      transactionId,
      passos,
      continues,
      txStartExecutado: false,
      soContinuidade: true,
      origemApi: 'continuaTransacaoDestaxa'
    });
  }

  if (ehInconclusivo(atual)) {
    return fecharInconclusivo(atual, 'Timeout/inconclusivo em TX_CONTINUE');
  }

  return prosseguirCicloAposResultado({
    bridge,
    atual,
    transactionId,
    fila,
    maxContinues,
    passos,
    continues,
    emitir,
    fecharInconclusivo,
    txStartExecutado: false,
    soContinuidade: true,
    persistirRespostaAntesContinue,
    persistirEvidenciasAntesFinalize: deps.persistirEvidenciasAntesFinalize,
    exigirEvidenciasAntesFinalize: deps.exigirEvidenciasAntesFinalize === true
  });
}

async function _persistirAntesContinue({
  persistirResposta,
  transactionId,
  acao,
  resposta,
  solicitadaEm
}) {
  const txId = transactionId == null ? '' : String(transactionId).trim();
  if (!txId || typeof solicitadaEm !== 'string' || !solicitadaEm.trim()) {
    return {
      ok: false,
      codigo: 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU',
      mensagem: 'TX_CONTINUE bloqueado: transactionId e timestamp original são obrigatórios'
    };
  }
  if (typeof persistirResposta !== 'function') {
    return {
      ok: false,
      codigo: 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU',
      mensagem: 'TX_CONTINUE bloqueado: persistência durável da resposta não foi configurada'
    };
  }
  try {
    const resultado = await persistirResposta({
      transactionId,
      acao,
      resposta,
      solicitadaEm
    });
    const identidade = resultado?.identidade;
    const identidadeCompleta = identidade
      && String(identidade.transactionId || '') === txId
      && ['operation_id', 'idempotency_key', 'fingerprint'].every((campo) =>
        typeof identidade[campo] === 'string' && identidade[campo].trim() !== '');
    const confirmacaoValida = resultado?.ok === true
      && resultado?.duravel === true
      && resultado?.confirmada === true
      && String(resultado.transactionId || '') === txId
      && resultado.solicitadaEm === solicitadaEm
      && resultado.estadoDespacho === 'INICIADO'
      && typeof resultado.despachoId === 'string'
      && resultado.despachoId.trim() !== ''
      && typeof resultado.fingerprint === 'string'
      && resultado.fingerprint.trim() !== ''
      && identidadeCompleta
      && isDeepStrictEqual(resultado.resposta, resposta);
    if (confirmacaoValida) return resultado;
    return {
      ok: false,
      codigo: resultado?.codigo || 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU',
      mensagem: resultado?.mensagem
        || 'TX_CONTINUE bloqueado: reserva durável, identidade e resposta não foram confirmadas'
    };
  } catch (error) {
    return {
      ok: false,
      codigo: error.codigo || error.code || 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU',
      mensagem: `TX_CONTINUE bloqueado por falha de persistência: ${error.message}`
    };
  }
}

function _resultadoPersistenciaContinuidadeFalhou(
  transactionId,
  persistencia,
  passos,
  continues,
  txStartExecutado
) {
  return {
    sucesso: false,
    conclusivo: false,
    inconclusivo: true,
    retryAllowed: false,
    codigo: persistencia.codigo || 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU',
    mensagem: persistencia.mensagem,
    financialState: 'UNKNOWN',
    transactionId,
    ciclo: {
      passos,
      txStartExecutado: txStartExecutado === true,
      continues,
      finalizado: false,
      soContinuidade: true
    },
    reconciliacaoObrigatoria: true
  };
}

async function prosseguirCicloAposResultado(ctx) {
  const {
    bridge,
    transactionId,
    fila,
    maxContinues,
    passos,
    emitir,
    fecharInconclusivo,
    txStartExecutado,
    soContinuidade,
    persistirRespostaAntesContinue,
    persistirEvidenciasAntesFinalize,
    exigirEvidenciasAntesFinalize
  } = ctx;
  let { atual, continues } = ctx;

  while (ehAcaoRequerida(atual)) {
    const solicitadaEm = new Date().toISOString();
    // 99 NÃO é aprovação
    if (continues >= maxContinues) {
      return {
        sucesso: false,
        conclusivo: false,
        retryAllowed: false,
        codigo: CICLO_ERROS.LIMITE_CONTINUE,
        mensagem: `Limite de TX_CONTINUE (${maxContinues}) atingido — ciclo interrompido sem aprovação implícita`,
        resultadoUltimo: atual,
        ciclo: {
          passos,
          txStartExecutado: txStartExecutado === true,
          continues,
          finalizado: false,
          soContinuidade: soContinuidade === true
        },
        reconciliacaoObrigatoria: true
      };
    }

    const resolucao = resolverRespostaContinuidade(atual.acao, fila);
    if (!resolucao.ok) {
      return {
        sucesso: false,
        conclusivo: false,
        retryAllowed: false,
        codigo: resolucao.codigo,
        mensagem: resolucao.mensagem,
        requerContinuacao: true,
        acao: atual.acao || null,
        solicitadaEm,
        statusSugerido: 'pendente',
        resultadoUltimo: atual,
        ciclo: {
          passos,
          txStartExecutado: txStartExecutado === true,
          continues,
          finalizado: false,
          soContinuidade: soContinuidade === true
        }
      };
    }

    const persistencia = await _persistirAntesContinue({
      persistirResposta: persistirRespostaAntesContinue,
      transactionId,
      acao: atual.acao || null,
      resposta: resolucao.resposta,
      solicitadaEm
    });
    if (!persistencia.ok) {
      return _resultadoPersistenciaContinuidadeFalhou(
        transactionId,
        persistencia,
        passos,
        continues,
        txStartExecutado
      );
    }

    continues += 1;
    emitir('TX_CONTINUE', {
      n: continues,
      tipoAcao: atual.acao?.tipo || null,
      origemResposta: resolucao.origem
    });
    try {
      const {
        registrarEventoContinuidade,
        ESTADOS_CONTINUIDADE
      } = require('./destaxaContinuidadeEstados');
      registrarEventoContinuidade('tx_continue', {
        estado: ESTADOS_CONTINUIDADE.CONTINUANDO,
        transactionId,
        tipoAcao: atual.acao?.tipo || null,
        origem: resolucao.origem,
        codigo: null
      });
    } catch (_) { /* best-effort */ }
    // Cede o event loop do Electron main antes da IPC nativa (51.05).
    await new Promise((r) => setImmediate(r));
    atual = await bridge.continuarTransacaoDestaxa(resolucao.resposta, { transactionId });
    emitir('TX_CONTINUE_RESULT', {
      n: continues,
      codigoDestaxa: codigoDe(atual),
      requerContinuacao: ehAcaoRequerida(atual)
    });

    if (ehHostBusy(atual)) {
      return {
        sucesso: false,
        conclusivo: false,
        retryAllowed: false,
        codigo: CICLO_ERROS.HOST_BUSY,
        mensagem: 'Host ocupado em TX_CONTINUE',
        resultadoUltimo: atual,
        ciclo: {
          passos,
          txStartExecutado: txStartExecutado === true,
          continues,
          finalizado: false,
          soContinuidade: soContinuidade === true
        },
        reconciliacaoObrigatoria: true
      };
    }
    if (ehHostMorto(atual)) {
      return {
        sucesso: false,
        conclusivo: false,
        retryAllowed: false,
        codigo: CICLO_ERROS.HOST_ENCERRADO,
        mensagem: 'Native Host encerrado durante TX_CONTINUE',
        resultadoUltimo: atual,
        ciclo: {
          passos,
          txStartExecutado: txStartExecutado === true,
          continues,
          finalizado: false,
          soContinuidade: soContinuidade === true
        },
        reconciliacaoObrigatoria: true
      };
    }
    if (ehA1(atual)) {
      emitir('A1_BLOQUEADO', { origemApi: 'continuaTransacaoDestaxa' });
      return fecharBloqueioA1({
        resultado: atual,
        transactionId,
        passos,
        continues,
        txStartExecutado,
        soContinuidade,
        origemApi: 'continuaTransacaoDestaxa'
      });
    }

    if (ehInconclusivo(atual)) {
      return fecharInconclusivo(atual, 'Timeout/inconclusivo em TX_CONTINUE');
    }
  }

  if (ehNegado(atual)) {
    emitir('NEGADO', { codigoDestaxa: codigoDe(atual) });
    return {
      sucesso: false,
      conclusivo: true,
      retryAllowed: false,
      negado: true,
      codigoDestaxa: codigoDe(atual),
      classificacao: CLASSIFICACAO_CODIGO.DENIED,
      financialState: atual.financialState || 'CONFIRMED_DENIED',
      mensagem: atual.mensagem || atual.descricao || 'Transação negada pelo provedor',
      resultadoUltimo: atual,
      resultadoInicio: null,
      evidencias: null,
      finalizeExecutado: false,
      ciclo: {
        passos,
        txStartExecutado: txStartExecutado === true,
        continues,
        finalizado: false,
        soContinuidade: soContinuidade === true
      }
    };
  }

  if (ehA1(atual)) {
    emitir('A1_BLOQUEADO', { origemApi: 'iniciaTransacaoDestaxa' });
    return fecharBloqueioA1({
      resultado: atual,
      transactionId,
      passos,
      continues,
      txStartExecutado,
      soContinuidade,
      origemApi: 'iniciaTransacaoDestaxa'
    });
  }

  if (!ehSucessoConclusivo(atual)) {
    return fecharInconclusivo(atual, `Código não conclusivo após ciclo: ${codigoDe(atual) || '(vazio)'}`);
  }

  // TEF-DESTAXA-51.25 — preservar evidências do 00 ANTES de FINALIZE(0)
  const resultadoInicio = atual;
  const evidencias = extrairEvidenciasRetorno00(resultadoInicio);
  const persistenciaEvidencias = await _confirmarPersistenciaEvidencias00({
    persistirEvidencias: persistirEvidenciasAntesFinalize,
    exigirEvidencias: exigirEvidenciasAntesFinalize === true,
    transactionId,
    resultado00: resultadoInicio,
    evidencias,
    emitir
  });

  if (persistenciaEvidencias.ok !== true || (
    exigirEvidenciasAntesFinalize === true && persistenciaEvidencias.confirmada !== true
  )) {
    if (persistenciaEvidencias.skipped === true && exigirEvidenciasAntesFinalize !== true) {
      // legado/testes sem hook — FINALIZE permitido sem evidências duráveis
    } else {
      return {
        sucesso: false,
        conclusivo: false,
        inconclusivo: true,
        retryAllowed: false,
        codigo: persistenciaEvidencias.codigo || CICLO_ERROS.EVIDENCIAS_NAO_PERSISTIDAS,
        codigoDestaxa: '00',
        mensagem: persistenciaEvidencias.mensagem
          || 'Evidências do retorno 00 não confirmadas — FINALIZE(0) não executado',
        financialState: 'UNKNOWN',
        resultadoInicio,
        resultadoUltimo: resultadoInicio,
        evidencias: persistenciaEvidencias.evidencias || evidencias,
        evidenciasPersistidas: false,
        finalizeExecutado: false,
        transactionId: resultadoInicio?.contexto?.transactionId || transactionId,
        ciclo: {
          passos,
          txStartExecutado: txStartExecutado === true,
          continues,
          finalizado: false,
          soContinuidade: soContinuidade === true
        },
        reconciliacaoObrigatoria: true
      };
    }
  }

  const evidenciasConfirmadas = persistenciaEvidencias.evidencias || evidencias;
  emitir('TX_FINALIZE', { confirmacao: FINALIZACAO_CONFIRMAR });
  const finalizado = await bridge.finalizarTransacaoDestaxa(FINALIZACAO_CONFIRMAR, { transactionId });
  emitir('TX_FINALIZE_RESULT', {
    codigoDestaxa: codigoDe(finalizado),
    sucesso: finalizado?.sucesso === true
  });
  emitir('PERSISTIR_RESULTADO_FINAL', {
    codigoDestaxa: codigoDe(finalizado),
    evidenciasPreservadas: true
  });

  if (ehHostMorto(finalizado) || ehInconclusivo(finalizado)) {
    return {
      ...fecharInconclusivo(finalizado, 'Inconclusivo/host em TX_FINALIZE — reconciliação obrigatória'),
      resultadoInicio,
      evidencias: evidenciasConfirmadas,
      evidenciasPersistidas: persistenciaEvidencias.confirmada === true,
      finalizeExecutado: true,
      confirmacao: FINALIZACAO_CONFIRMAR
    };
  }

  const okFinal = ehSucessoConclusivo(finalizado) || finalizado?.sucesso === true;
  if (!okFinal) {
    return {
      sucesso: false,
      conclusivo: false,
      inconclusivo: true,
      retryAllowed: false,
      codigo: CICLO_ERROS.INCONCLUSIVO,
      codigoDestaxa: codigoDe(finalizado) || '00',
      mensagem: finalizado?.mensagem || finalizado?.descricao
        || 'FINALIZE(0) sem sucesso — evidências 00 preservadas; reconciliação obrigatória',
      financialState: finalizado?.financialState || 'UNKNOWN',
      confirmacao: FINALIZACAO_CONFIRMAR,
      resultadoInicio,
      resultadoUltimo: finalizado,
      evidencias: evidenciasConfirmadas,
      evidenciasPersistidas: persistenciaEvidencias.confirmada === true,
      finalizeExecutado: true,
      transactionId: finalizado?.contexto?.transactionId
        || resultadoInicio?.contexto?.transactionId
        || transactionId,
      ciclo: {
        passos,
        txStartExecutado: txStartExecutado === true,
        continues,
        finalizado: true,
        soContinuidade: soContinuidade === true
      },
      reconciliacaoObrigatoria: true
    };
  }

  return {
    sucesso: true,
    conclusivo: true,
    retryAllowed: false,
    codigoDestaxa: codigoDe(finalizado) || codigoDe(resultadoInicio) || '00',
    classificacao: CLASSIFICACAO_CODIGO.SUCCESS,
    financialState: finalizado.financialState || 'CONFIRMED_SUCCESS',
    mensagem: finalizado.mensagem || finalizado.descricao || 'CRT finalizada',
    confirmacao: FINALIZACAO_CONFIRMAR,
    resultadoInicio,
    resultadoUltimo: finalizado,
    evidencias: evidenciasConfirmadas,
    evidenciasPersistidas: persistenciaEvidencias.confirmada === true
      || persistenciaEvidencias.skipped === true,
    finalizeExecutado: true,
    transactionId: finalizado?.contexto?.transactionId
      || resultadoInicio?.contexto?.transactionId
      || transactionId,
    ciclo: {
      passos,
      txStartExecutado: txStartExecutado === true,
      continues,
      finalizado: true,
      soContinuidade: soContinuidade === true
    }
  };
}

module.exports = {
  executarCicloCrt,
  continuarCicloCrt,
  resolverRespostaContinuidade,
  CICLO_ERROS,
  MAX_CONTINUES_PADRAO,
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR,
  TIPOS_ACAO
};
