'use strict';

/**
 * MRT-27 — Persistência obrigatória / idempotência / recuperação de identidade TEF.
 * Identidade estável NÃO usa Date.now() como único componente.
 * Caminho financeiro real exige TefManager + linha persistida antes da DLL.
 */

const crypto = require('crypto');
const { FINANCIAL_STATES } = require('./tefFinancialSafetyPolicy');

const ERROS_PERSISTENCIA = Object.freeze({
  OBRIGATORIA: 'TEF_PERSISTENCIA_OBRIGATORIA',
  FALHOU: 'TEF_PERSISTENCIA_FALHOU',
  IDEMPOTENCIA_BLOQUEIA_REENVIAR: 'TEF_IDEMPOTENCIA_BLOQUEIA_REENVIAR',
  INCONCLUSIVA_SEM_REENVIO: 'TEF_OPERACAO_INCONCLUSIVA_SEM_REENVIO',
  APROVADA_PRESERVADA: 'TEF_OPERACAO_APROVADA_PRESERVADA',
  NEGADA_PRESERVADA: 'TEF_OPERACAO_NEGADA_PRESERVADA',
  TX_START_SEM_IDENTIDADE: 'TEF_TX_START_SEM_IDENTIDADE_PERSISTIDA'
});

const CAMINHOS = Object.freeze({
  PRODUCAO_TEF_MANAGER: 'PRODUCAO_TEF_MANAGER',
  HARNESS_SIMULADO: 'HARNESS_SIMULADO',
  HARNESS_HOMOLOGACAO: 'HARNESS_HOMOLOGACAO'
});

const STATUS_APROVADO = new Set(['aprovado', 'aprovada', 'approved', 'success']);
const STATUS_NEGADO = new Set(['negado', 'negada', 'denied', 'recusado', 'recusada']);
const STATUS_PENDENTE = new Set(['pendente', 'pending', 'em_andamento', 'unknown']);

function normalizarTexto(v) {
  if (v == null) return '';
  return String(v).trim().toLowerCase();
}

function normalizarValor(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

/**
 * Fingerprint estável da intenção financeira (sem Date.now).
 */
function montarFingerprintOperacao(dados = {}, rota = {}) {
  const partes = [
    normalizarTexto(dados.provedor || rota.provedor || 'destaxa'),
    normalizarTexto(dados.tipo || dados.operacao || ''),
    normalizarValor(dados.valor),
    dados.venda_id != null ? String(dados.venda_id) : '',
    String(rota.pdvId || dados.pdv_id || dados.pdvId || ''),
    String(rota.terminalTefId || dados.terminal_tef_id || dados.terminalTefId || ''),
    normalizarTexto(dados.operation_id || dados.operationId || '')
  ];
  return crypto.createHash('sha256').update(partes.join('|'), 'utf8').digest('hex').slice(0, 32);
}

/**
 * operation_id estável: prefer client/PDV; senão hash(fingerprint seed + random).
 * Nunca Date.now() sozinho.
 */
function gerarOperationId(dados = {}, fingerprint = null) {
  const informado = dados.operation_id || dados.operationId || null;
  if (informado != null && String(informado).trim() !== '') {
    return String(informado).trim();
  }
  const fp = fingerprint || montarFingerprintOperacao(dados);
  const aleatorio = crypto.randomBytes(8).toString('hex');
  return `op_${fp.slice(0, 12)}_${aleatorio}`;
}

/**
 * Garante identidade completa antes da persistência / envio.
 */
function garantirIdentidadeOperacao(dados = {}, rota = {}) {
  const fingerprintBase = montarFingerprintOperacao(
    { ...dados, operation_id: dados.operation_id || dados.operationId || '' },
    rota
  );
  const operationId = gerarOperationId(dados, fingerprintBase);
  const fingerprint = montarFingerprintOperacao({ ...dados, operation_id: operationId }, rota);

  let idempotencyKey = dados.idempotency_key || dados.idempotencyKey || null;
  if (idempotencyKey == null || String(idempotencyKey).trim() === '') {
    idempotencyKey = `tef-fp-${fingerprint}`;
  } else {
    idempotencyKey = String(idempotencyKey).trim();
  }

  return {
    operation_id: operationId,
    fingerprint,
    idempotency_key: idempotencyKey,
    identidadeExclusivaDateNow: false
  };
}

function montarBlocoPersistenciaPreEnvio({
  operationId,
  fingerprint,
  idempotencyKey,
  vendaId = null,
  pdvId = null,
  terminalTefId = null,
  provedor = null,
  valor = null,
  tipo = null,
  estadoFinanceiroInicial = FINANCIAL_STATES.UNKNOWN,
  dataHora = null
} = {}) {
  return {
    operation_id: operationId != null ? String(operationId) : null,
    fingerprint: fingerprint != null ? String(fingerprint) : null,
    idempotency_key: idempotencyKey != null ? String(idempotencyKey) : null,
    venda_id: vendaId != null ? vendaId : null,
    pdvId: pdvId != null ? String(pdvId) : null,
    terminalTefId: terminalTefId != null ? String(terminalTefId) : null,
    provedor: provedor != null ? String(provedor) : null,
    valor: valor != null ? Number(valor) : null,
    tipo: tipo != null ? String(tipo) : null,
    estadoFinanceiroInicial: estadoFinanceiroInicial || FINANCIAL_STATES.UNKNOWN,
    dataHora: dataHora || new Date().toISOString(),
    persistidoAntesDll: true,
    sprint: 'MRT-27'
  };
}

/**
 * Classifica linha existente por idempotency_key / fingerprint.
 */
function classificarIdempotencia(row, fingerprintEsperado = null) {
  if (!row) {
    return { acao: 'CRIAR', codigo: null, reutilizar: false, bloquearEnvio: false };
  }

  const status = normalizarTexto(row.status);
  const payload = row.payload_retorno && typeof row.payload_retorno === 'object'
    ? row.payload_retorno
    : {};
  const persistencia = payload.persistencia || {};
  const financialState = payload.financialState
    || persistencia.estadoFinanceiroInicial
    || null;
  const mesmoFingerprint = fingerprintEsperado == null
    || !persistencia.fingerprint
    || String(persistencia.fingerprint) === String(fingerprintEsperado);

  if (STATUS_APROVADO.has(status) || financialState === FINANCIAL_STATES.CONFIRMED_SUCCESS) {
    return {
      acao: 'PRESERVAR_APROVACAO',
      codigo: ERROS_PERSISTENCIA.APROVADA_PRESERVADA,
      reutilizar: true,
      bloquearEnvio: true,
      transacaoId: row.id,
      status: row.status,
      provedor: row.provedor || null,
      idempotency_key: row.idempotency_key || null,
      mesmoFingerprint
    };
  }

  if (STATUS_NEGADO.has(status) || financialState === FINANCIAL_STATES.CONFIRMED_DENIED) {
    return {
      acao: 'PRESERVAR_NEGATIVA',
      codigo: ERROS_PERSISTENCIA.NEGADA_PRESERVADA,
      reutilizar: true,
      bloquearEnvio: true,
      transacaoId: row.id,
      status: row.status,
      provedor: row.provedor || null,
      idempotency_key: row.idempotency_key || null,
      mesmoFingerprint
    };
  }

  if (STATUS_PENDENTE.has(status)
    || financialState === FINANCIAL_STATES.UNKNOWN
    || financialState === FINANCIAL_STATES.PENDING
    || payload.inconclusivo === true) {
    return {
      acao: 'BLOQUEAR_REENVIAR',
      codigo: ERROS_PERSISTENCIA.INCONCLUSIVA_SEM_REENVIO,
      reutilizar: true,
      bloquearEnvio: true,
      transacaoId: row.id,
      status: row.status,
      provedor: row.provedor || null,
      idempotency_key: row.idempotency_key || null,
      financialState: financialState || FINANCIAL_STATES.UNKNOWN,
      mesmoFingerprint,
      preservarUnknown: true
    };
  }

  return {
    acao: 'REUTILIZAR_IDENTIDADE',
    codigo: ERROS_PERSISTENCIA.IDEMPOTENCIA_BLOQUEIA_REENVIAR,
    reutilizar: true,
    bloquearEnvio: true,
    transacaoId: row.id,
    status: row.status,
    provedor: row.provedor || null,
    idempotency_key: row.idempotency_key || null,
    mesmoFingerprint
  };
}

/**
 * Gate do Adapter: operação financeira real exige identidade persistida via TefManager.
 * Harness simulado (gate OFF) permanece separado — não abre caminho de produção.
 */
function validarPersistenciaAntesEnvioFinanceiro(preparacao = null, dados = {}, opcoes = {}) {
  const caminhoInformado = preparacao?.caminho
    || dados._caminhoTef
    || dados.caminhoTef
    || null;
  const harnessSimulado = caminhoInformado === CAMINHOS.HARNESS_SIMULADO
    || preparacao?.caminhoHarness === 'simulado'
    || dados._caminhoHarness === 'simulado';
  const harnessHomolog = caminhoInformado === CAMINHOS.HARNESS_HOMOLOGACAO
    || preparacao?.caminhoHarness === 'homologacao';

  const { transacaoRealHabilitada } = require('./destaxa/destaxaConstantes');
  const gateOn = typeof opcoes.gateOn === 'boolean'
    ? opcoes.gateOn
    : transacaoRealHabilitada();

  // Harness simulado sem gate: não é caminho financeiro de produção.
  if (harnessSimulado && !gateOn) {
    return {
      ok: true,
      caminho: CAMINHOS.HARNESS_SIMULADO,
      transactionId: preparacao?.transactionId || dados.transacao_id || null,
      aviso: 'Caminho harness simulado — sem envio financeiro real'
    };
  }

  // Homologação via harness explícito ainda exige identidade se gate ON
  // (não contorna TefManager em produção).
  if (harnessHomolog && !gateOn) {
    return {
      ok: true,
      caminho: CAMINHOS.HARNESS_HOMOLOGACAO,
      transactionId: preparacao?.transactionId || null,
      aviso: 'Harness homologação com gate OFF'
    };
  }

  const transactionId = preparacao?.transactionId != null
    ? String(preparacao.transactionId)
    : (dados.transacao_id != null ? String(dados.transacao_id) : null);
  const confirmada = preparacao?.persistenciaConfirmada === true;

  if (!transactionId || String(transactionId).trim() === '' || !confirmada) {
    return {
      ok: false,
      codigo: ERROS_PERSISTENCIA.OBRIGATORIA,
      mensagem: 'Operação financeira Destaxa exige TefManager.autorizar com identidade persistida antes da DLL',
      caminho: CAMINHOS.PRODUCAO_TEF_MANAGER,
      transactionId: transactionId || null,
      persistenciaConfirmada: confirmada
    };
  }

  return {
    ok: true,
    caminho: CAMINHOS.PRODUCAO_TEF_MANAGER,
    transactionId: String(transactionId),
    operation_id: preparacao?.operation_id || dados.operation_id || null,
    fingerprint: preparacao?.fingerprint || dados._fingerprint || null,
    persistenciaConfirmada: true
  };
}

/**
 * Proteção TX_START: com gate financeiro ON, transactionId persistido é obrigatório.
 */
function validarTxStartComPersistencia(opcoes = {}, gateOn = null) {
  const { transacaoRealHabilitada } = require('./destaxa/destaxaConstantes');
  const real = typeof gateOn === 'boolean' ? gateOn : transacaoRealHabilitada();
  if (!real) {
    return { ok: true, exigido: false };
  }
  const tid = opcoes.transactionId;
  if (tid == null || String(tid).trim() === '') {
    return {
      ok: false,
      codigo: ERROS_PERSISTENCIA.TX_START_SEM_IDENTIDADE,
      mensagem: 'TX_START com gate ON exige transactionId persistido (TefManager)',
      exigido: true
    };
  }
  return { ok: true, exigido: true, transactionId: String(tid) };
}

/**
 * Snapshot de recuperação pós-reinício a partir de linha pendente.
 */
function projetarRecuperacaoIdentidade(row) {
  if (!row) return null;
  const payload = row.payload_retorno && typeof row.payload_retorno === 'object'
    ? row.payload_retorno
    : {};
  const persistencia = payload.persistencia || {};
  return {
    transacaoId: row.id != null ? String(row.id) : null,
    operation_id: persistencia.operation_id || row.codigo_transacao || null,
    idempotency_key: row.idempotency_key || persistencia.idempotency_key || null,
    fingerprint: persistencia.fingerprint || null,
    provedor: row.provedor || persistencia.provedor || null,
    venda_id: row.venda_id != null ? row.venda_id : (persistencia.venda_id || null),
    pdvId: persistencia.pdvId || null,
    terminalTefId: persistencia.terminalTefId || null,
    valor: row.valor != null ? Number(row.valor) : persistencia.valor,
    tipo: row.tipo || persistencia.tipo || null,
    status: row.status || null,
    financialState: payload.financialState
      || persistencia.estadoFinanceiroInicial
      || FINANCIAL_STATES.UNKNOWN,
    reenvioAutomaticoProibido: true,
    preservarUnknown: true
  };
}

module.exports = {
  ERROS_PERSISTENCIA,
  CAMINHOS,
  montarFingerprintOperacao,
  gerarOperationId,
  garantirIdentidadeOperacao,
  montarBlocoPersistenciaPreEnvio,
  classificarIdempotencia,
  validarPersistenciaAntesEnvioFinanceiro,
  validarTxStartComPersistencia,
  projetarRecuperacaoIdentidade
};
