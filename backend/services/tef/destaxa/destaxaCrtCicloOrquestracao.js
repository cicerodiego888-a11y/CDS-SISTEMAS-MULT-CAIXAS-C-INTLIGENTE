'use strict';

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
  ERROS
} = require('./destaxaConstantes');
const { ERROS_HOST } = require('./destaxaNativeHostProtocolo');

const MAX_CONTINUES_PADRAO = 32;

const CICLO_ERROS = Object.freeze({
  TX_START_REPETIDO: 'DESTAXA_CICLO_TX_START_REPETIDO',
  CONTINUIDADE_SEM_RESPOSTA: 'DESTAXA_CICLO_CONTINUIDADE_SEM_RESPOSTA',
  LIMITE_CONTINUE: 'DESTAXA_CICLO_LIMITE_CONTINUE',
  HOST_ENCERRADO: 'DESTAXA_CICLO_HOST_ENCERRADO',
  HOST_BUSY: 'DESTAXA_CICLO_HOST_BUSY',
  INCONCLUSIVO: 'DESTAXA_CICLO_INCONCLUSIVO',
  INIT_OU_GATE: 'DESTAXA_CICLO_BLOQUEADO_PRE_TX'
});

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

/**
 * Resolve resposta para continuaTransacaoDestaxa sem inventar coleta/opção.
 * DISPLAY → ack vazio. COLETA/OPCAO → fila explícita do chamador.
 */
function resolverRespostaContinuidade(acao, filaRespostas) {
  const tipo = acao?.tipo || null;
  if (tipo === TIPOS_ACAO.DISPLAY || tipo == null) {
    return { ok: true, resposta: { displayAck: true }, origem: 'display_ack' };
  }
  if (tipo === TIPOS_ACAO.COLETA || tipo === TIPOS_ACAO.OPCAO) {
    if (!Array.isArray(filaRespostas) || filaRespostas.length === 0) {
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

  txStartExecutado = true;
  emitir('TX_START', { operacao, transactionId });
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
    txStartExecutado: true
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
    soContinuidade: true
  });
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
    soContinuidade
  } = ctx;
  let { atual, continues } = ctx;

  while (ehAcaoRequerida(atual)) {
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

    continues += 1;
    emitir('TX_CONTINUE', {
      n: continues,
      tipoAcao: atual.acao?.tipo || null,
      origemResposta: resolucao.origem
    });
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
      ciclo: {
        passos,
        txStartExecutado: txStartExecutado === true,
        continues,
        finalizado: false,
        soContinuidade: soContinuidade === true
      }
    };
  }

  if (!ehSucessoConclusivo(atual)) {
    return fecharInconclusivo(atual, `Código não conclusivo após ciclo: ${codigoDe(atual) || '(vazio)'}`);
  }

  emitir('TX_FINALIZE', { confirmacao: FINALIZACAO_CONFIRMAR });
  const finalizado = await bridge.finalizarTransacaoDestaxa(FINALIZACAO_CONFIRMAR, { transactionId });
  emitir('TX_FINALIZE_RESULT', {
    codigoDestaxa: codigoDe(finalizado),
    sucesso: finalizado?.sucesso === true
  });

  if (ehHostMorto(finalizado) || ehInconclusivo(finalizado)) {
    return fecharInconclusivo(finalizado, 'Inconclusivo/host em TX_FINALIZE — reconciliação obrigatória');
  }

  const okFinal = ehSucessoConclusivo(finalizado) || finalizado?.sucesso === true;
  return {
    sucesso: okFinal,
    conclusivo: true,
    retryAllowed: false,
    codigoDestaxa: codigoDe(finalizado) || codigoDe(atual),
    classificacao: okFinal ? CLASSIFICACAO_CODIGO.SUCCESS : (finalizado.classificacao || null),
    financialState: finalizado.financialState || (okFinal ? 'CONFIRMED_SUCCESS' : 'UNKNOWN'),
    mensagem: finalizado.mensagem || finalizado.descricao || (okFinal ? 'CRT finalizada' : 'Falha na finalização'),
    confirmacao: FINALIZACAO_CONFIRMAR,
    resultadoInicio: atual,
    resultadoUltimo: finalizado,
    transactionId: finalizado?.contexto?.transactionId || atual?.contexto?.transactionId || transactionId,
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
