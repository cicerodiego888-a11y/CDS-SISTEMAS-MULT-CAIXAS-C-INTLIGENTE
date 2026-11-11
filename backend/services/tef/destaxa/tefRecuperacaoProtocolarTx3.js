'use strict';

/**
 * SPRINT 51.45 — Path nomeado RECUPERACAO_PROTOCOLAR_TX3.
 *
 * Escopo exclusivo: tef_transacoes.id=3 (NSU 2338 / auth 211139 / venda 66).
 * Propósito: preparar/autorizar finalizaTransacaoDestaxa(0) da pendência Destaxa
 * da operação original — sem CRT, sem TX_START/CONTINUE, sem FINALIZE(9).
 *
 * Gate global permanece OFF. Permit excepcional one-shot é documento de segurança
 * (dry-run nesta sprint não grava ledger nem chama DLL).
 *
 * A API Destaxa não recebe NSU/transactionId: a exclusividade da pendência no
 * Client deve ser comprovada por evidências antes de qualquer FINALIZE.
 */

const crypto = require('crypto');
const {
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR,
  CODIGO_CLIENT_OK,
  transacaoRealHabilitada
} = require('./destaxaConstantes');

const PATH_NOME = 'RECUPERACAO_PROTOCOLAR_TX3';

const OPERACAO_AUTORIZADA = Object.freeze({
  path: PATH_NOME,
  transactionId: '3',
  id: 3,
  vendaId: 66,
  valor: 1,
  modalidade: 'cartao_debito',
  nsu: '2338',
  nsuRede: '241255',
  autorizacao: '211139',
  idempotency_key: 'tef-segunda-tentativa-bd6a8809bc64abb7',
  codigoVespague: '10100017275707',
  terminal: 'TACB0120',
  confirmacaoPermitida: FINALIZACAO_CONFIRMAR,
  sprint: 'SPRINT-51.45'
});

const CODIGOS_INIT = Object.freeze({
  A1_ESPERADO: 'A1',
  OK: CODIGO_CLIENT_OK,
  F0_ABORTAR: 'F0'
});

function criarErro(codigo, mensagem, detalhes = null) {
  const error = new Error(mensagem);
  error.code = codigo;
  if (detalhes) error.detalhes = detalhes;
  return error;
}

function normalizarTexto(v) {
  if (v == null) return '';
  return String(v).trim();
}

function normalizarCodigo(v) {
  return normalizarTexto(v).toUpperCase();
}

function valorNumerico(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Valida identidade CDS da TX 3 (linha + venda).
 */
function validarIdentidadeTx3({ linha = null, venda = null, pedido = {} } = {}) {
  const idPedido = Number(pedido.transacaoId ?? pedido.id ?? linha?.id);
  if (idPedido !== OPERACAO_AUTORIZADA.id) {
    throw criarErro(
      'TEF_RECUP_TX3_ID_NAO_AUTORIZADO',
      `Path ${PATH_NOME} autorizado somente para id=${OPERACAO_AUTORIZADA.id}.`,
      { idInformado: idPedido }
    );
  }

  if (!linha || Number(linha.id) !== OPERACAO_AUTORIZADA.id) {
    throw criarErro('TEF_RECUP_TX3_LINHA_AUSENTE', 'Linha tef_transacoes.id=3 obrigatória.');
  }

  if (normalizarTexto(linha.idempotency_key) !== OPERACAO_AUTORIZADA.idempotency_key) {
    throw criarErro('TEF_RECUP_TX3_IDEMPOTENCY', 'idempotency_key diverge da operação original.', {
      esperado: OPERACAO_AUTORIZADA.idempotency_key,
      atual: linha.idempotency_key || null
    });
  }

  if (normalizarTexto(linha.nsu) !== OPERACAO_AUTORIZADA.nsu) {
    throw criarErro('TEF_RECUP_TX3_NSU', 'NSU diverge.', {
      esperado: OPERACAO_AUTORIZADA.nsu,
      atual: linha.nsu || null
    });
  }

  if (normalizarTexto(linha.autorizacao) !== OPERACAO_AUTORIZADA.autorizacao) {
    throw criarErro('TEF_RECUP_TX3_AUTORIZACAO', 'Autorização diverge.', {
      esperado: OPERACAO_AUTORIZADA.autorizacao,
      atual: linha.autorizacao || null
    });
  }

  if (Number(linha.venda_id) !== OPERACAO_AUTORIZADA.vendaId) {
    throw criarErro('TEF_RECUP_TX3_VENDA_TX', 'venda_id da TEF diverge.', {
      esperado: OPERACAO_AUTORIZADA.vendaId,
      atual: linha.venda_id
    });
  }

  if (valorNumerico(linha.valor) !== OPERACAO_AUTORIZADA.valor) {
    throw criarErro('TEF_RECUP_TX3_VALOR', 'Valor diverge.', {
      esperado: OPERACAO_AUTORIZADA.valor,
      atual: linha.valor
    });
  }

  if (!venda || Number(venda.id) !== OPERACAO_AUTORIZADA.vendaId) {
    throw criarErro('TEF_RECUP_TX3_VENDA_AUSENTE', 'Venda 66 obrigatória.');
  }

  if (venda.tef_transacao_id != null
      && Number(venda.tef_transacao_id) !== OPERACAO_AUTORIZADA.id) {
    throw criarErro('TEF_RECUP_TX3_VENDA_VINCULO', 'Venda 66 vinculada a outra TEF.', {
      tef_transacao_id: venda.tef_transacao_id
    });
  }

  if (pedido.confirmacaoExplicitaPo !== true
      && pedido.confirmacao_explicita_po !== true
      && pedido.confirmacaoExplicita !== true) {
    throw criarErro(
      'TEF_RECUP_TX3_CONFIRMACAO_PO',
      'Confirmação explícita do Product Owner é obrigatória.'
    );
  }

  if (!normalizarTexto(pedido.operador)) {
    throw criarErro('TEF_RECUP_TX3_OPERADOR', 'Operador responsável é obrigatório.');
  }

  return { ok: true, transactionId: OPERACAO_AUTORIZADA.transactionId };
}

/**
 * Bloqueia operações fora do escopo do path.
 */
function validarOperacaoPermitida({
  operation = null,
  confirmacao = null,
  transactionId = null
} = {}) {
  const op = normalizarTexto(operation).toUpperCase();
  if (op === 'TX_START' || op === 'TX_CONTINUE' || op === 'CRT') {
    throw criarErro(
      'TEF_RECUP_TX3_OPERACAO_PROIBIDA',
      `${op} é proibido no path ${PATH_NOME}.`,
      { operation: op }
    );
  }

  if (op && op !== 'TX_FINALIZE') {
    throw criarErro(
      'TEF_RECUP_TX3_OPERACAO_INVALIDA',
      `Operação ${op} não é TX_FINALIZE.`,
      { operation: op }
    );
  }

  if (transactionId != null && String(transactionId) !== OPERACAO_AUTORIZADA.transactionId) {
    throw criarErro(
      'TEF_RECUP_TX3_TRANSACTION_ID',
      'transactionId diverge de 3.',
      { transactionId }
    );
  }

  if (confirmacao != null) {
    const conf = Number(confirmacao);
    if (conf === FINALIZACAO_CANCELAR || conf === 9) {
      throw criarErro(
        'TEF_RECUP_TX3_FINALIZE9_BLOQUEADO',
        'FINALIZE(9) é proibido neste path (desfazimento bloqueado).',
        { confirmacao: conf }
      );
    }
    if (conf !== FINALIZACAO_CONFIRMAR) {
      throw criarErro(
        'TEF_RECUP_TX3_CONFIRMACAO_INVALIDA',
        'Somente confirmacao=0 é permitida.',
        { confirmacao: conf }
      );
    }
  }

  return { ok: true, operation: 'TX_FINALIZE', confirmacao: FINALIZACAO_CONFIRMAR };
}

/**
 * Exclusividade da pendência Destaxa no Client.
 * Sem prova suficiente → abortar ANTES do FINALIZE.
 */
function avaliarExclusividadePendenciaDestaxa(evidencias = {}) {
  const codigoInit = normalizarCodigo(evidencias.codigoInitClient || evidencias.initClientCodigo);
  const vespague = normalizarTexto(
    evidencias.codigoVespague || evidencias.transacao_codigo_vespague
  );
  const nsu = normalizarTexto(evidencias.nsu);
  const autorizacao = normalizarTexto(evidencias.autorizacao);
  const pendenciasCds = Array.isArray(evidencias.pendenciasOperacionaisCds)
    ? evidencias.pendenciasOperacionaisCds
    : [];
  const finalizePosterior = evidencias.finalizeDestaxaPosteriorATx3 === true;
  const multiplasPendencias = evidencias.multiplasPendenciasDestaxa === true;
  const exclusividadeExplicita = evidencias.confirmacaoExclusividadePo === true
    || evidencias.confirmacao_exclusividade_po === true;

  if (codigoInit === CODIGOS_INIT.F0_ABORTAR) {
    return {
      ok: false,
      abortarAntesFinalize: true,
      codigo: 'TEF_RECUP_TX3_F0',
      mensagem: 'INIT_CLIENT retornou F0 — sequência inválida; FINALIZE abortado.'
    };
  }

  if (codigoInit === CODIGOS_INIT.OK) {
    return {
      ok: false,
      abortarAntesFinalize: true,
      codigo: 'TEF_RECUP_TX3_INIT_00_INESPERADO',
      mensagem: 'INIT_CLIENT retornou 00 — pendência Destaxa aparentemente ausente; FINALIZE abortado.'
    };
  }

  if (codigoInit !== CODIGOS_INIT.A1_ESPERADO) {
    return {
      ok: false,
      abortarAntesFinalize: true,
      codigo: 'TEF_RECUP_TX3_INIT_NAO_A1',
      mensagem: `Pré-condição A1 ausente (codigo=${codigoInit || 'null'}).`,
      detalhes: { codigoInit }
    };
  }

  if (nsu !== OPERACAO_AUTORIZADA.nsu || autorizacao !== OPERACAO_AUTORIZADA.autorizacao) {
    return {
      ok: false,
      abortarAntesFinalize: true,
      codigo: 'TEF_RECUP_TX3_CORRELACAO_NSU_AUTH',
      mensagem: 'Evidência de correlação NSU/autorização diverge da TX 3.'
    };
  }

  if (vespague !== OPERACAO_AUTORIZADA.codigoVespague) {
    return {
      ok: false,
      abortarAntesFinalize: true,
      codigo: 'TEF_RECUP_TX3_CORRELACAO_VESPAGUE',
      mensagem: 'Código V$Pague/vespague diverge — exclusividade da pendência não comprovada.',
      detalhes: {
        esperado: OPERACAO_AUTORIZADA.codigoVespague,
        atual: vespague || null
      }
    };
  }

  if (pendenciasCds.some((p) => {
    const id = String(p?.id ?? p?.transactionId ?? '');
    const st = normalizarTexto(p?.status).toLowerCase();
    return id && id !== OPERACAO_AUTORIZADA.transactionId && st === 'pendente';
  })) {
    return {
      ok: false,
      abortarAntesFinalize: true,
      codigo: 'TEF_RECUP_TX3_OUTRA_PENDENCIA_CDS',
      mensagem: 'Há outra pendência operacional CDS — exclusividade não comprovada.'
    };
  }

  if (finalizePosterior) {
    return {
      ok: false,
      abortarAntesFinalize: true,
      codigo: 'TEF_RECUP_TX3_FINALIZE_JA_REGISTRADO',
      mensagem: 'Evidência indica FINALIZE Destaxa posterior à TX 3 — abortar.'
    };
  }

  if (multiplasPendencias) {
    return {
      ok: false,
      abortarAntesFinalize: true,
      codigo: 'TEF_RECUP_TX3_PENDENCIAS_MULTIPLAS',
      mensagem: 'Múltiplas pendências Destaxa possíveis — FINALIZE abortado (API sem NSU).'
    };
  }

  if (!exclusividadeExplicita) {
    return {
      ok: false,
      abortarAntesFinalize: true,
      codigo: 'TEF_RECUP_TX3_EXCLUSIVIDADE_NAO_CONFIRMADA',
      mensagem: 'PO deve confirmar explicitamente que a pendência A1 é exclusivamente a TX 3.'
    };
  }

  if (!normalizarTexto(evidencias.fonteEvidenciaA1)) {
    return {
      ok: false,
      abortarAntesFinalize: true,
      codigo: 'TEF_RECUP_TX3_FONTE_A1_AUSENTE',
      mensagem: 'Fonte da evidência A1 (log NativeHost) é obrigatória.'
    };
  }

  return {
    ok: true,
    abortarAntesFinalize: false,
    codigo: null,
    mensagem: 'Exclusividade da pendência Destaxa comprovada para TX 3 (A1 + correlação).',
    correlacao: {
      nsu: OPERACAO_AUTORIZADA.nsu,
      autorizacao: OPERACAO_AUTORIZADA.autorizacao,
      codigoVespague: OPERACAO_AUTORIZADA.codigoVespague,
      codigoInitClient: CODIGOS_INIT.A1_ESPERADO
    }
  };
}

/**
 * Documento de permit one-shot (em memória). dryRun=true → não grava ledger.
 */
function criarPermitRecuperacaoTx3({ dryRun = true, operador = '' } = {}) {
  if (transacaoRealHabilitada()) {
    // Gate ON global não é necessário e não deve ser pré-requisito; apenas alerta.
  }

  const permitId = dryRun
    ? `dry-run-${crypto.randomBytes(8).toString('hex')}`
    : crypto.randomBytes(16).toString('hex');

  const hostPermit = Object.freeze({
    permitId,
    operation: 'TX_FINALIZE',
    transactionId: OPERACAO_AUTORIZADA.transactionId,
    purpose: PATH_NOME,
    confirmacao: FINALIZACAO_CONFIRMAR
  });

  const exceptionalPermit = Object.freeze({
    exceptional: true,
    oneShot: true,
    dryRun: dryRun === true,
    purpose: PATH_NOME,
    operation: 'TX_FINALIZE',
    confirmacao: FINALIZACAO_CONFIRMAR,
    transactionId: OPERACAO_AUTORIZADA.transactionId,
    valorCentavos: 100,
    tipoPermitido: ['cartao_debito', 'debito'],
    operacaoLedger: 'RECUPERACAO_FINALIZE_0',
    operador: normalizarTexto(operador) || null,
    emitidoEm: new Date().toISOString(),
    retryAutomatico: false
  });

  return {
    ok: true,
    dryRun: dryRun === true,
    ledgerEscrito: false,
    hostPermit,
    exceptionalPermit,
    gateGlobal: transacaoRealHabilitada() ? 'ON' : 'OFF',
    mensagem: dryRun
      ? 'Permit dry-run criado em memória (ledger não alterado).'
      : 'Permit de recuperação materializado (somente sob GO de execução futura).'
  };
}

/**
 * Autorização consumível pelo orquestrador para FINALIZE sem _contexto CRT.
 */
function montarAutorizacaoFinalizarSemContextoCrt({
  hostPermit,
  exceptionalPermit,
  exclusividade
} = {}) {
  if (!hostPermit
      || hostPermit.operation !== 'TX_FINALIZE'
      || String(hostPermit.transactionId) !== OPERACAO_AUTORIZADA.transactionId
      || Number(hostPermit.confirmacao) !== FINALIZACAO_CONFIRMAR
      || hostPermit.purpose !== PATH_NOME) {
    throw criarErro(
      'TEF_RECUP_TX3_HOST_PERMIT_INVALIDO',
      'Host permit inválido para FINALIZE(0) da TX 3.'
    );
  }

  if (!exceptionalPermit
      || exceptionalPermit.exceptional !== true
      || exceptionalPermit.oneShot !== true
      || exceptionalPermit.purpose !== PATH_NOME
      || Number(exceptionalPermit.confirmacao) !== FINALIZACAO_CONFIRMAR) {
    throw criarErro(
      'TEF_RECUP_TX3_EXCEPTIONAL_INVALIDO',
      'Permit excepcional inválido para recuperação TX 3.'
    );
  }

  if (!exclusividade || exclusividade.ok !== true || exclusividade.abortarAntesFinalize === true) {
    throw criarErro(
      'TEF_RECUP_TX3_EXCLUSIVIDADE_OBRIGATORIA',
      'Autorização sem contexto CRT exige exclusividade Destaxa comprovada.'
    );
  }

  return Object.freeze({
    path: PATH_NOME,
    permiteFinalizarSemContextoCrt: true,
    transactionId: OPERACAO_AUTORIZADA.transactionId,
    confirmacao: FINALIZACAO_CONFIRMAR,
    hostPermit,
    exceptionalPermit,
    exclusividade,
    retryAutomatico: false
  });
}

/**
 * Planejamento completo (dry-run ou pré-execução). Não chama DLL.
 */
function planejarRecuperacaoProtocolarTx3({
  linha,
  venda,
  pedido = {},
  evidenciasPendencia = {},
  dryRun = true
} = {}) {
  if (pedido.executarReal === true || pedido.executarDll === true) {
    throw criarErro(
      'TEF_RECUP_TX3_EXECUCAO_REAL_BLOQUEADA',
      'Sprint 51.45 / planejar: execução real Destaxa bloqueada neste módulo.'
    );
  }

  validarIdentidadeTx3({ linha, venda, pedido });
  validarOperacaoPermitida({
    operation: 'TX_FINALIZE',
    confirmacao: pedido.confirmacao != null ? pedido.confirmacao : FINALIZACAO_CONFIRMAR,
    transactionId: OPERACAO_AUTORIZADA.transactionId
  });

  if (Number(pedido.confirmacao) === FINALIZACAO_CANCELAR) {
    throw criarErro('TEF_RECUP_TX3_FINALIZE9_BLOQUEADO', 'FINALIZE(9) bloqueado.');
  }

  const exclusividade = avaliarExclusividadePendenciaDestaxa({
    ...evidenciasPendencia,
    nsu: evidenciasPendencia.nsu || linha.nsu,
    autorizacao: evidenciasPendencia.autorizacao || linha.autorizacao
  });

  if (!exclusividade.ok) {
    return {
      ok: false,
      elegivel: false,
      abortarAntesFinalize: true,
      path: PATH_NOME,
      dryRun: dryRun === true,
      codigo: exclusividade.codigo,
      mensagem: exclusividade.mensagem,
      exclusividade,
      permit: null,
      autorizacaoSemContexto: null,
      passosPrevistos: [],
      proibicoes: listarProibicoes()
    };
  }

  const permit = criarPermitRecuperacaoTx3({
    dryRun: dryRun !== false,
    operador: pedido.operador
  });

  const autorizacaoSemContexto = montarAutorizacaoFinalizarSemContextoCrt({
    hostPermit: permit.hostPermit,
    exceptionalPermit: permit.exceptionalPermit,
    exclusividade
  });

  return {
    ok: true,
    elegivel: true,
    abortarAntesFinalize: false,
    path: PATH_NOME,
    dryRun: permit.dryRun,
    mensagem: 'Path RECUPERACAO_PROTOCOLAR_TX3 elegível (dry-run / planejamento).',
    identidade: {
      transactionId: OPERACAO_AUTORIZADA.transactionId,
      nsu: OPERACAO_AUTORIZADA.nsu,
      autorizacao: OPERACAO_AUTORIZADA.autorizacao,
      vendaId: OPERACAO_AUTORIZADA.vendaId,
      idempotency_key: OPERACAO_AUTORIZADA.idempotency_key,
      codigoVespague: OPERACAO_AUTORIZADA.codigoVespague
    },
    exclusividade,
    permit,
    autorizacaoSemContexto,
    gateGlobal: permit.gateGlobal,
    passosPrevistos: [
      'SECURITY_BOOTSTRAP (permit TX_FINALIZE + transactionId=3)',
      'LOAD',
      'INIT_CLIENT (esperar A1; abortar se 00 ou F0)',
      'TX_FINALIZE confirmacao=0 / finalizaTransacaoDestaxa(0) sem _contexto CRT',
      'INIT_CLIENT pós (esperar 00)',
      'Auditoria tef_logs sem alterar NSU/status/venda'
    ],
    passosProibidos: listarProibicoes(),
    retryAutomatico: false
  };
}

function listarProibicoes() {
  return Object.freeze([
    'TX_START',
    'TX_CONTINUE',
    'CRT',
    'FINALIZE(9)',
    'iniciaTransacaoDestaxa',
    'retryAutomatico',
    'DESTAXA_REAL_TRANSACTION_ENABLED=1 (não exigido / não ligar)',
    'alterar TX2/TX3/venda66',
    'emitir permit real nesta sprint 51.45'
  ]);
}

/**
 * Classifica retorno de INIT no contexto da recuperação.
 */
function classificarInitClientParaRecuperacao(codigo) {
  const c = normalizarCodigo(codigo);
  if (c === CODIGOS_INIT.A1_ESPERADO) {
    return {
      ok: true,
      prosseguirFinalize: true,
      codigo: c,
      mensagem: 'A1 — pré-condição de recuperação satisfeita.'
    };
  }
  if (c === CODIGOS_INIT.OK) {
    return {
      ok: false,
      prosseguirFinalize: false,
      codigo: c,
      abortar: true,
      mensagem: '00 inesperado — abortar FINALIZE.'
    };
  }
  if (c === CODIGOS_INIT.F0_ABORTAR) {
    return {
      ok: false,
      prosseguirFinalize: false,
      codigo: c,
      abortar: true,
      mensagem: 'F0 — abortar sem retry.'
    };
  }
  return {
    ok: false,
    prosseguirFinalize: false,
    codigo: c || null,
    abortar: true,
    mensagem: `Código INIT ${c || 'null'} não elegível para recuperação.`
  };
}

module.exports = {
  PATH_NOME,
  OPERACAO_AUTORIZADA,
  CODIGOS_INIT,
  validarIdentidadeTx3,
  validarOperacaoPermitida,
  avaliarExclusividadePendenciaDestaxa,
  criarPermitRecuperacaoTx3,
  montarAutorizacaoFinalizarSemContextoCrt,
  planejarRecuperacaoProtocolarTx3,
  classificarInitClientParaRecuperacao,
  listarProibicoes
};
