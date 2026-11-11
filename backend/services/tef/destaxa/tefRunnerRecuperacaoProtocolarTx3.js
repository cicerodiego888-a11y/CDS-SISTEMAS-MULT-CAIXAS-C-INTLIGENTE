'use strict';

/**
 * SPRINT 51.46 — Runner controlado de recuperação protocolar TX 3.
 *
 * Usa exclusivamente o path RECUPERACAO_PROTOCOLAR_TX3.
 * Nesta sprint: dry-run obrigatório — sem DLL, NativeHost, V$Pague, permit ledger
 * ou gate ON. Execução real permanece bloqueada até GO explícito do PO em sprint futura.
 */

const crypto = require('crypto');
const {
  PATH_NOME,
  OPERACAO_AUTORIZADA,
  validarIdentidadeTx3,
  validarOperacaoPermitida,
  avaliarExclusividadePendenciaDestaxa,
  criarPermitRecuperacaoTx3,
  montarAutorizacaoFinalizarSemContextoCrt,
  classificarInitClientParaRecuperacao,
  listarProibicoes,
  planejarRecuperacaoProtocolarTx3
} = require('./tefRecuperacaoProtocolarTx3');
const {
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR,
  transacaoRealHabilitada
} = require('./destaxaConstantes');

const SPRINT = 'SPRINT-51.46';
const TOKEN_GO_PO = 'GO-PO-RECUPERACAO-TX3-FINALIZE-0';

/** Hard-block desta sprint: nenhuma chamada nativa mesmo com flags de execução. */
const EXECUCAO_NATIVA_HABILITADA_NESTA_SPRINT = false;

const FASES = Object.freeze({
  PRECHECK_IDENTIDADE: 'PRECHECK_IDENTIDADE',
  PRECHECK_SESSAO: 'PRECHECK_SESSAO',
  EXCLUSIVIDADE: 'EXCLUSIVIDADE',
  AUTORIZACAO_PO: 'AUTORIZACAO_PO',
  PERMIT: 'PERMIT',
  GATE_NATIVO: 'GATE_NATIVO',
  AUDITORIA: 'AUDITORIA',
  CONCLUIDO: 'CONCLUIDO',
  ABORTADO: 'ABORTADO'
});

function criarErro(codigo, mensagem, detalhes = null) {
  const error = new Error(mensagem);
  error.code = codigo;
  if (detalhes) error.detalhes = detalhes;
  return error;
}

function agoraIso() {
  return new Date().toISOString();
}

function normalizarTexto(v) {
  if (v == null) return '';
  return String(v).trim();
}

function registrar(auditoria, fase, evento, detalhes = {}) {
  auditoria.push({
    ts: agoraIso(),
    fase,
    evento,
    ...detalhes
  });
}

/**
 * Revalida NSU 2338, auth 211139, venda 66 e V$Pague 10100017275707.
 */
function revalidarIdentificadoresTx3({ linha, venda, codigoVespague }) {
  const esperado = OPERACAO_AUTORIZADA;
  const atual = {
    id: linha?.id ?? null,
    nsu: normalizarTexto(linha?.nsu),
    autorizacao: normalizarTexto(linha?.autorizacao),
    vendaId: Number(linha?.venda_id),
    idempotency_key: normalizarTexto(linha?.idempotency_key),
    codigoVespague: normalizarTexto(codigoVespague),
    vendaLinhaId: venda?.id != null ? Number(venda.id) : null
  };

  const divergencias = [];
  if (Number(atual.id) !== esperado.id) divergencias.push('id');
  if (atual.nsu !== esperado.nsu) divergencias.push('nsu');
  if (atual.autorizacao !== esperado.autorizacao) divergencias.push('autorizacao');
  if (atual.vendaId !== esperado.vendaId) divergencias.push('venda_id');
  if (atual.idempotency_key !== esperado.idempotency_key) divergencias.push('idempotency_key');
  if (atual.codigoVespague !== esperado.codigoVespague) divergencias.push('codigoVespague');
  if (atual.vendaLinhaId !== esperado.vendaId) divergencias.push('venda.id');

  if (divergencias.length > 0) {
    throw criarErro(
      'TEF_RUNNER_TX3_DIVERGENCIA_IDENTIFICADORES',
      'Divergência nos identificadores da TX 3 — runner abortado.',
      { divergencias, esperado: {
        id: esperado.id,
        nsu: esperado.nsu,
        autorizacao: esperado.autorizacao,
        vendaId: esperado.vendaId,
        idempotency_key: esperado.idempotency_key,
        codigoVespague: esperado.codigoVespague
      }, atual }
    );
  }

  return { ok: true, identidade: {
    transactionId: esperado.transactionId,
    nsu: esperado.nsu,
    autorizacao: esperado.autorizacao,
    vendaId: esperado.vendaId,
    idempotency_key: esperado.idempotency_key,
    codigoVespague: esperado.codigoVespague
  } };
}

/**
 * Valida estado declarado da sessão Destaxa (sem chamar DLL nesta sprint).
 * Espera A1; 00/F0/outros abortam.
 */
function validarEstadoSessaoDestaxa(estadoSessao = {}) {
  const codigoInit = normalizarTexto(
    estadoSessao.codigoInitClient ?? estadoSessao.initClientCodigo ?? estadoSessao.codigo
  ).toUpperCase();

  const classificado = classificarInitClientParaRecuperacao(codigoInit);
  if (!classificado.prosseguirFinalize) {
    return {
      ok: false,
      abortar: true,
      codigo: codigoInit === '00'
        ? 'TEF_RUNNER_TX3_INIT_00'
        : codigoInit === 'F0'
          ? 'TEF_RUNNER_TX3_INIT_F0'
          : 'TEF_RUNNER_TX3_SESSAO_INVALIDA',
      mensagem: classificado.mensagem,
      codigoInit: codigoInit || null,
      classificado
    };
  }

  if (estadoSessao.timeout === true || estadoSessao.timeoutInit === true) {
    return {
      ok: false,
      abortar: true,
      codigo: 'TEF_RUNNER_TX3_TIMEOUT_SESSAO',
      mensagem: 'Timeout na validação de sessão Destaxa — abortar sem retry.',
      codigoInit
    };
  }

  return {
    ok: true,
    abortar: false,
    codigo: null,
    mensagem: 'Estado de sessão Destaxa compatível com recuperação (A1 declarado).',
    codigoInit: 'A1',
    classificado,
    fonte: normalizarTexto(estadoSessao.fonte) || null,
    leituraNativa: false
  };
}

/**
 * Exige autorização explícita do PO antes de qualquer emissão de permit / chamada nativa.
 */
function exigirAutorizacaoExplicitaPo(pedido = {}) {
  const confirmacao = pedido.confirmacaoExplicitaPo === true
    || pedido.confirmacao_explicita_po === true
    || pedido.confirmacaoExplicita === true;
  const token = normalizarTexto(pedido.tokenGoPo || pedido.token_go_po || pedido.goPo);
  const operador = normalizarTexto(pedido.operador);

  if (!confirmacao) {
    throw criarErro(
      'TEF_RUNNER_TX3_PO_NAO_CONFIRMADO',
      'Autorização explícita do Product Owner é obrigatória antes do permit/nativo.'
    );
  }
  if (!operador) {
    throw criarErro('TEF_RUNNER_TX3_OPERADOR', 'Operador responsável é obrigatório.');
  }
  if (token !== TOKEN_GO_PO) {
    throw criarErro(
      'TEF_RUNNER_TX3_TOKEN_GO_INVALIDO',
      'Token GO do PO ausente ou inválido para recuperação TX 3.',
      { esperado: TOKEN_GO_PO, informado: token || null }
    );
  }

  return {
    ok: true,
    tokenGoPo: TOKEN_GO_PO,
    operador,
    autorizadoEm: agoraIso()
  };
}

function validarPedidoOperacao(pedido = {}) {
  const operation = normalizarTexto(pedido.operation || 'TX_FINALIZE').toUpperCase();
  const confirmacao = pedido.confirmacao != null ? Number(pedido.confirmacao) : FINALIZACAO_CONFIRMAR;

  if (operation === 'TX_START' || operation === 'TX_CONTINUE' || operation === 'CRT') {
    throw criarErro(
      'TEF_RUNNER_TX3_OPERACAO_PROIBIDA',
      `${operation} é proibido no runner de recuperação TX 3.`
    );
  }
  if (confirmacao === FINALIZACAO_CANCELAR || confirmacao === 9) {
    throw criarErro(
      'TEF_RUNNER_TX3_FINALIZE9_BLOQUEADO',
      'FINALIZE(9) é proibido no runner de recuperação TX 3.'
    );
  }

  return validarOperacaoPermitida({
    operation: 'TX_FINALIZE',
    confirmacao,
    transactionId: OPERACAO_AUTORIZADA.transactionId
  });
}

function montarAbort(auditoria, fase, codigo, mensagem, extras = {}) {
  registrar(auditoria, FASES.ABORTADO, 'ABORT', { codigo, mensagem, faseOrigem: fase });
  return {
    ok: false,
    elegivel: false,
    abortado: true,
    dryRun: extras.dryRun !== false,
    sprint: SPRINT,
    path: PATH_NOME,
    fase: FASES.ABORTADO,
    codigo,
    mensagem,
    dllChamada: false,
    nativeHostChamado: false,
    vespagueChamado: false,
    permitLedgerEscrito: false,
    retryAutomatico: false,
    gateGlobal: transacaoRealHabilitada() ? 'ON' : 'OFF',
    auditoria,
    ...extras
  };
}

/**
 * Runner controlado. Por padrão dry-run; execução nativa hard-blocked na 51.46.
 */
function executarRunnerRecuperacaoProtocolarTx3({
  linha = null,
  venda = null,
  pedido = {},
  evidenciasPendencia = {},
  estadoSessaoDestaxa = null,
  dryRun = true,
  permitRejeitadoSimulado = false
} = {}) {
  const auditoria = [];
  const runId = `runner-tx3-${crypto.randomBytes(6).toString('hex')}`;
  const modoDryRun = dryRun !== false;

  registrar(auditoria, FASES.PRECHECK_IDENTIDADE, 'INICIO', {
    runId,
    dryRun: modoDryRun,
    sprint: SPRINT,
    path: PATH_NOME,
    gateGlobal: transacaoRealHabilitada() ? 'ON' : 'OFF'
  });

  if (pedido.retryAutomatico === true || pedido.autoRetry === true) {
    return montarAbort(
      auditoria,
      FASES.PRECHECK_IDENTIDADE,
      'TEF_RUNNER_TX3_RETRY_PROIBIDO',
      'Retry automático é proibido neste runner.',
      { dryRun: modoDryRun }
    );
  }

  // Hard-block sprint: qualquer pedido de execução real aborta.
  if (
    modoDryRun === false
    || pedido.executarReal === true
    || pedido.executarDll === true
    || pedido.chamarNativeHost === true
  ) {
    if (!EXECUCAO_NATIVA_HABILITADA_NESTA_SPRINT) {
      return montarAbort(
        auditoria,
        FASES.GATE_NATIVO,
        'TEF_RUNNER_TX3_SPRINT_51_46_SEM_EXECUCAO_NATIVA',
        'Sprint 51.46: execução nativa bloqueada. Aguardar GO do PO em sprint de execução.',
        {
          dryRun: true,
          pedidoExecucaoReal: true,
          execucaoNativaHabilitadaNestaSprint: false
        }
      );
    }
  }

  let fase = FASES.PRECHECK_IDENTIDADE;
  try {
    validarPedidoOperacao(pedido);

    const vespagueInformado = evidenciasPendencia.codigoVespague
      || evidenciasPendencia.transacao_codigo_vespague
      || OPERACAO_AUTORIZADA.codigoVespague;

    const revalidacao = revalidarIdentificadoresTx3({
      linha,
      venda,
      codigoVespague: vespagueInformado
    });
    registrar(auditoria, fase, 'IDENTIDADE_OK', revalidacao.identidade);

    // validarIdentidadeTx3 também exige PO/operador — usamos flags do pedido dry-run
    // mas a fase AUTORIZACAO_PO abaixo exige o token GO formal do runner.
    validarIdentidadeTx3({
      linha,
      venda,
      pedido: {
        ...pedido,
        transacaoId: OPERACAO_AUTORIZADA.id,
        confirmacaoExplicitaPo: pedido.confirmacaoExplicitaPo === true
          || pedido.confirmacao_explicita_po === true
          || pedido.confirmacaoExplicita === true
          || Boolean(normalizarTexto(pedido.tokenGoPo || pedido.token_go_po || pedido.goPo))
      }
    });

    fase = FASES.PRECHECK_SESSAO;
    const estado = estadoSessaoDestaxa || {
      codigoInitClient: evidenciasPendencia.codigoInitClient
        || evidenciasPendencia.initClientCodigo,
      timeout: evidenciasPendencia.timeout === true,
      fonte: evidenciasPendencia.fonteEvidenciaA1 || evidenciasPendencia.fonte
    };
    const sessao = validarEstadoSessaoDestaxa(estado);
    if (!sessao.ok) {
      return montarAbort(auditoria, fase, sessao.codigo, sessao.mensagem, {
        dryRun: modoDryRun,
        sessao
      });
    }
    registrar(auditoria, fase, 'SESSAO_OK', {
      codigoInit: sessao.codigoInit,
      leituraNativa: false,
      fonte: sessao.fonte
    });

    fase = FASES.EXCLUSIVIDADE;
    const exclusividade = avaliarExclusividadePendenciaDestaxa({
      ...evidenciasPendencia,
      nsu: evidenciasPendencia.nsu || linha?.nsu,
      autorizacao: evidenciasPendencia.autorizacao || linha?.autorizacao,
      codigoVespague: vespagueInformado
    });
    if (!exclusividade.ok || exclusividade.abortarAntesFinalize) {
      return montarAbort(
        auditoria,
        fase,
        exclusividade.codigo || 'TEF_RUNNER_TX3_EXCLUSIVIDADE',
        exclusividade.mensagem || 'Exclusividade da pendência não comprovada.',
        { dryRun: modoDryRun, exclusividade }
      );
    }
    registrar(auditoria, fase, 'EXCLUSIVIDADE_OK', exclusividade.correlacao || {});

    fase = FASES.AUTORIZACAO_PO;
    const authPo = exigirAutorizacaoExplicitaPo(pedido);
    registrar(auditoria, fase, 'PO_AUTORIZADO', {
      tokenGoPo: authPo.tokenGoPo,
      operador: authPo.operador
    });

    fase = FASES.PERMIT;
    if (permitRejeitadoSimulado === true) {
      return montarAbort(
        auditoria,
        fase,
        'TEF_RUNNER_TX3_PERMIT_REJEITADO',
        'Permit excepcional rejeitado — abortar sem contornar Host security.',
        { dryRun: modoDryRun }
      );
    }

    // Permit somente após pré-validações + GO PO. Nesta sprint: sempre dry-run em memória.
    const permit = criarPermitRecuperacaoTx3({
      dryRun: true,
      operador: authPo.operador
    });
    if (permit.ledgerEscrito === true || permit.dryRun !== true) {
      return montarAbort(
        auditoria,
        fase,
        'TEF_RUNNER_TX3_PERMIT_NAO_DRY_RUN',
        'Sprint 51.46 exige permit dry-run (ledger intacto).',
        { dryRun: modoDryRun, permit }
      );
    }

    const autorizacaoSemContexto = montarAutorizacaoFinalizarSemContextoCrt({
      hostPermit: permit.hostPermit,
      exceptionalPermit: permit.exceptionalPermit,
      exclusividade
    });
    registrar(auditoria, fase, 'PERMIT_DRY_RUN_EMITIDO', {
      permitId: permit.hostPermit.permitId,
      operation: permit.hostPermit.operation,
      confirmacao: permit.hostPermit.confirmacao,
      transactionId: permit.hostPermit.transactionId,
      ledgerEscrito: false
    });

    fase = FASES.GATE_NATIVO;
    registrar(auditoria, fase, 'NATIVO_NAO_CHAMADO', {
      motivo: 'SPRINT_51_46_DRY_RUN',
      passosBloqueados: [
        'iniciaClientDestaxa',
        'finalizaTransacaoDestaxa',
        'DLL',
        'NativeHost',
        'V$Pague'
      ]
    });

    fase = FASES.AUDITORIA;
    const plano = planejarRecuperacaoProtocolarTx3({
      linha,
      venda,
      pedido: {
        ...pedido,
        operador: authPo.operador,
        confirmacaoExplicitaPo: true,
        confirmacao: FINALIZACAO_CONFIRMAR
      },
      evidenciasPendencia: {
        ...evidenciasPendencia,
        codigoVespague: vespagueInformado,
        confirmacaoExclusividadePo: evidenciasPendencia.confirmacaoExclusividadePo === true
          || evidenciasPendencia.confirmacao_exclusividade_po === true
      },
      dryRun: true
    });

    registrar(auditoria, fase, 'AUDITORIA_REGISTRADA', {
      elegivel: plano.elegivel === true,
      path: PATH_NOME
    });

    fase = FASES.CONCLUIDO;
    registrar(auditoria, fase, 'DRY_RUN_PRONTO', {
      mensagem: 'Runner pronto; aguardar GO específico do PO para sprint de execução real.'
    });

    return {
      ok: true,
      elegivel: plano.elegivel === true && plano.ok === true,
      abortado: false,
      dryRun: true,
      sprint: SPRINT,
      path: PATH_NOME,
      runId,
      fase: FASES.CONCLUIDO,
      mensagem: 'Runner controlado TX3 concluído em dry-run — sem chamada nativa.',
      identidade: revalidacao.identidade,
      sessao,
      exclusividade,
      autorizacaoPo: {
        tokenGoPo: authPo.tokenGoPo,
        operador: authPo.operador,
        autorizadoEm: authPo.autorizadoEm
      },
      permit: {
        dryRun: true,
        ledgerEscrito: false,
        hostPermit: permit.hostPermit,
        exceptionalPermit: {
          purpose: permit.exceptionalPermit.purpose,
          operation: permit.exceptionalPermit.operation,
          confirmacao: permit.exceptionalPermit.confirmacao,
          transactionId: permit.exceptionalPermit.transactionId,
          oneShot: permit.exceptionalPermit.oneShot,
          dryRun: permit.exceptionalPermit.dryRun,
          retryAutomatico: permit.exceptionalPermit.retryAutomatico
        }
      },
      autorizacaoSemContexto,
      planoResumo: {
        ok: plano.ok,
        elegivel: plano.elegivel,
        passosPrevistos: plano.passosPrevistos,
        passosProibidos: listarProibicoes()
      },
      procedimentoExecucao: listarProcedimentoExecucaoFutura(),
      dllChamada: false,
      nativeHostChamado: false,
      vespagueChamado: false,
      permitLedgerEscrito: false,
      retryAutomatico: false,
      execucaoUnica: true,
      gateGlobal: transacaoRealHabilitada() ? 'ON' : 'OFF',
      auditoria
    };
  } catch (error) {
    return montarAbort(
      auditoria,
      fase,
      error.code || 'TEF_RUNNER_TX3_ERRO',
      error.message || 'Falha no runner de recuperação TX 3.',
      {
        dryRun: modoDryRun,
        detalhes: error.detalhes || null
      }
    );
  }
}

function listarProcedimentoExecucaoFutura() {
  return Object.freeze([
    '1. Obter GO explícito do PO com token GO-PO-RECUPERACAO-TX3-FINALIZE-0 em sprint de execução nomeada.',
    '2. Revalidar readonly CDS: id=3, NSU 2338, auth 211139, venda 66, vespague 10100017275707.',
    '3. Confirmar exclusividade A1 (fonte NativeHost) + confirmação PO de pendência única.',
    '4. Emitir permit one-shot excepcional TX_FINALIZE + transactionId=3 + confirmacao=0 (ledger).',
    '5. SECURITY_BOOTSTRAP + LOAD (sem CRT / START / CONTINUE).',
    '6. INIT_CLIENT: seguir só se A1; abortar se 00 ou F0; sem retry.',
    '7. Única chamada finalizaTransacaoDestaxa(0) / TX_FINALIZE via path RECUPERACAO_PROTOCOLAR_TX3.',
    '8. INIT_CLIENT pós: esperar 00; se A1 persistir ou ≠00 → parar e escalar.',
    '9. Auditoria tef_logs; não alterar TX2/TX3/venda66; gate permanece OFF.'
  ]);
}

function listarCondicoesInterrupcao() {
  return Object.freeze([
    'INIT_CLIENT retornar 00 ou F0 em vez de A1',
    'Pendência não correlacionável exclusivamente à TX 3',
    'Mais de uma pendência possível',
    'Permit rejeitado',
    'Divergência de identificadores',
    'Timeout ou resposta FINALIZE diferente de 00',
    'Pedido de FINALIZE(9), TX_START, TX_CONTINUE ou CRT',
    'Ausência de GO/token do PO'
  ]);
}

module.exports = {
  SPRINT,
  TOKEN_GO_PO,
  FASES,
  EXECUCAO_NATIVA_HABILITADA_NESTA_SPRINT,
  revalidarIdentificadoresTx3,
  validarEstadoSessaoDestaxa,
  exigirAutorizacaoExplicitaPo,
  validarPedidoOperacao,
  executarRunnerRecuperacaoProtocolarTx3,
  listarProcedimentoExecucaoFutura,
  listarCondicoesInterrupcao,
  PATH_NOME,
  OPERACAO_AUTORIZADA
};
