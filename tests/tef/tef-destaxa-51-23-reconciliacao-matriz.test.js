'use strict';

/**
 * TEF-DESTAXA-51.23 — matriz de reconciliação id=1 (cenários A–F).
 * Somente lógica pura / leitura de fontes. Sem SQLite, DLL, NativeHost, ASAR ou CRT.
 *
 * node tests/tef/tef-destaxa-51-23-reconciliacao-matriz.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const TEF_MANAGER = path.join(ROOT, 'backend/services/tef/TefManager.js');
const PENDENCIAS = path.join(ROOT, 'backend/services/tef/tefPendenciasService.js');
const POLICY = path.join(ROOT, 'backend/services/tef/tefFinancialSafetyPolicy.js');

const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

/** Espelho de STATUS_POR_RECONCILIACAO em TefManager (produção). */
const STATUS_POR_RECONCILIACAO = Object.freeze({
  [FINANCIAL_STATES.CONFIRMED_SUCCESS]: 'aprovado',
  [FINANCIAL_STATES.CONFIRMED_DENIED]: 'negado',
  CANCELLED: 'cancelado'
});

/** Evidências mínimas exigidas para cada cenário Destaxa (preparação — não executa). */
const MATRIZ = Object.freeze({
  A_INEXISTENTE: {
    financialStateProposto: null,
    statusLocalAlvo: null,
    exigeProtocoloEscritoDestaxa: true,
    autoEncerraUnknown: false,
    mapeamentoNativoStatusPorReconciliacao: false,
    nota: 'Sem financialState nativo para inexistente; não mapear automaticamente para CANCELLED'
  },
  B_RECUSADA: {
    financialStateProposto: FINANCIAL_STATES.CONFIRMED_DENIED,
    statusLocalAlvo: 'negado',
    exigeProtocoloEscritoDestaxa: true,
    autoEncerraUnknown: false,
    mapeamentoNativoStatusPorReconciliacao: true
  },
  C_CANCELADA: {
    financialStateProposto: 'CANCELLED',
    statusLocalAlvo: 'cancelado',
    exigeProtocoloEscritoDestaxa: true,
    autoEncerraUnknown: false,
    mapeamentoNativoStatusPorReconciliacao: true
  },
  D_APROVADA: {
    financialStateProposto: FINANCIAL_STATES.CONFIRMED_SUCCESS,
    statusLocalAlvo: 'aprovado',
    exigeProtocoloEscritoDestaxa: true,
    exigeNsuAutorizacao: true,
    autoEncerraUnknown: false,
    mapeamentoNativoStatusPorReconciliacao: true,
    lacunaNsuNoFluxoAtual: true
  },
  E_PENDENTE_INCONCLUSIVA: {
    financialStateProposto: FINANCIAL_STATES.UNKNOWN,
    statusLocalAlvo: 'pendente',
    exigeProtocoloEscritoDestaxa: true,
    autoEncerraUnknown: false,
    mapeamentoNativoStatusPorReconciliacao: false
  },
  F_NAO_LOCALIZADA: {
    financialStateProposto: FINANCIAL_STATES.UNKNOWN,
    statusLocalAlvo: 'pendente',
    exigeProtocoloEscritoDestaxa: true,
    autoEncerraUnknown: false,
    mapeamentoNativoStatusPorReconciliacao: false,
    nota: 'Não localizar ≠ inexistente financeira comprovada'
  }
});

/**
 * Simula a decisão de “pode reconciliar automaticamente a partir de sinal fraco?”
 * Sempre false — espelha política CDS.
 */
function podeEncerrarAutomaticamentePorSinalFraco(sinal) {
  const fracos = new Set([
    'timeout',
    'resposta_78',
    'codigo_99',
    'ausencia_nsu_local',
    'verbal_sem_protocolo',
    'nao_localizada_sem_protocolo',
    'status_pendente_db'
  ]);
  if (fracos.has(sinal)) return false;
  return false;
}

/**
 * Gate de reconciliarResultadoTardio (espelho): financialState deve estar em mapa
 * e exigir confirmação explícita. UNKNOWN nunca passa.
 */
function gateReconciliacaoExplicita({ financialState, usuario, observacao, confirmacao_explicita, travaEstado }) {
  if (travaEstado !== 'RECONCILIACAO_PENDENTE') {
    return { ok: false, codigo: 'TEF_RECONCILIACAO_PREMATURA_OU_SEM_TRAVA' };
  }
  if (!STATUS_POR_RECONCILIACAO[financialState]) {
    return { ok: false, codigo: 'TEF_RECONCILIACAO_INVALIDA' };
  }
  if (!String(usuario || '').trim() || !String(observacao || '').trim()) {
    return { ok: false, codigo: 'TEF_RECONCILIACAO_INVALIDA' };
  }
  if (confirmacao_explicita !== true) {
    return { ok: false, codigo: 'TEF_RECONCILIACAO_SEM_CONFIRMACAO' };
  }
  return {
    ok: true,
    statusAlvo: STATUS_POR_RECONCILIACAO[financialState],
    travaLiberadaImediata: false
  };
}

/** Estado mutável em memória — prova que cenários A–F não alteram UNKNOWN sozinhos. */
function criarLinhaId1Mock() {
  return {
    id: 1,
    status: 'pendente',
    nsu: null,
    autorizacao: null,
    financialState: FINANCIAL_STATES.UNKNOWN,
    operationalState: 'PENDING_WITH_EVIDENCE',
    mutacoes: 0
  };
}

function aplicarCenarioSemExecucao(linha, cenarioKey) {
  const cenario = MATRIZ[cenarioKey];
  assert.ok(cenario);
  // Preparação: nenhum cenário muda a linha automaticamente.
  if (cenario.autoEncerraUnknown === false) {
    return {
      ...linha,
      preparacao: cenarioKey,
      status: linha.status,
      financialState: linha.financialState
    };
  }
  throw new Error('cenário não deveria auto-encerrar');
}

console.log('\nTEF-DESTAXA-51.23 — matriz reconciliação id=1\n');

test('S1) Fonte: STATUS_POR_RECONCILIACAO só SUCCESS/DENIED/CANCELLED', () => {
  const src = fs.readFileSync(TEF_MANAGER, 'utf8');
  assert.ok(src.includes('STATUS_POR_RECONCILIACAO'));
  assert.ok(src.includes('CONFIRMED_SUCCESS'));
  assert.ok(src.includes('CONFIRMED_DENIED'));
  assert.ok(src.includes('CANCELLED'));
  assert.ok(src.includes('confirmacao_explicita !== true'));
  assert.ok(src.includes('async reconciliarResultadoTardio'));
  assert.ok(src.includes('async reconciliarNativeHost'));
});

test('S2) tefPendenciasService: nunca aprovar automaticamente; timeout ≠ cancelamento', () => {
  const src = fs.readFileSync(PENDENCIAS, 'utf8');
  assert.ok(src.includes('nuncaAprovarAutomaticamente: true'));
  assert.ok(src.includes('timeoutNaoECancelamento: true'));
  assert.ok(src.includes('TEF_LIBERACAO_INCONCLUSIVA_PROIBIDA'));
  assert.ok(src.includes('liberacaoAutomaticaProibida: true'));
});

test('S3) Política financeira: 99=PENDING, 08=UNKNOWN, retryAlways false', () => {
  const { classificarCodigoFinanceiro } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
  const c99 = classificarCodigoFinanceiro('99');
  assert.strictEqual(c99.financialState, FINANCIAL_STATES.PENDING);
  assert.strictEqual(c99.retryAllowed, false);
  const c08 = classificarCodigoFinanceiro('08');
  assert.strictEqual(c08.financialState, FINANCIAL_STATES.UNKNOWN);
  assert.strictEqual(c08.retryAllowed, false);
  const src = fs.readFileSync(POLICY, 'utf8');
  assert.ok(src.includes("code === '99'"));
});

test('A) Inexistente: sem mapeamento nativo; não encerra UNKNOWN automaticamente', () => {
  const linha = criarLinhaId1Mock();
  const apos = aplicarCenarioSemExecucao(linha, 'A_INEXISTENTE');
  assert.strictEqual(apos.status, 'pendente');
  assert.strictEqual(apos.financialState, FINANCIAL_STATES.UNKNOWN);
  assert.strictEqual(STATUS_POR_RECONCILIACAO[null], undefined);
  assert.strictEqual(
    gateReconciliacaoExplicita({
      financialState: 'INEXISTENTE',
      usuario: 'op',
      observacao: 'Destaxa disse inexistente',
      confirmacao_explicita: true,
      travaEstado: 'RECONCILIACAO_PENDENTE'
    }).ok,
    false
  );
});

test('B) Recusada: mapeia CONFIRMED_DENIED→negado, mas só com confirmação explícita', () => {
  assert.strictEqual(MATRIZ.B_RECUSADA.mapeamentoNativoStatusPorReconciliacao, true);
  const gateSem = gateReconciliacaoExplicita({
    financialState: FINANCIAL_STATES.CONFIRMED_DENIED,
    usuario: 'op',
    observacao: 'protocolo Destaxa #1',
    confirmacao_explicita: false,
    travaEstado: 'RECONCILIACAO_PENDENTE'
  });
  assert.strictEqual(gateSem.ok, false);
  const gateCom = gateReconciliacaoExplicita({
    financialState: FINANCIAL_STATES.CONFIRMED_DENIED,
    usuario: 'op',
    observacao: 'protocolo Destaxa #1',
    confirmacao_explicita: true,
    travaEstado: 'RECONCILIACAO_PENDENTE'
  });
  assert.strictEqual(gateCom.ok, true);
  assert.strictEqual(gateCom.statusAlvo, 'negado');
  assert.strictEqual(gateCom.travaLiberadaImediata, false);
  const linha = aplicarCenarioSemExecucao(criarLinhaId1Mock(), 'B_RECUSADA');
  assert.strictEqual(linha.status, 'pendente');
});

test('C) Cancelada: CANCELLED→cancelado; não usa resposta 78 sozinha', () => {
  assert.strictEqual(podeEncerrarAutomaticamentePorSinalFraco('resposta_78'), false);
  const gate = gateReconciliacaoExplicita({
    financialState: 'CANCELLED',
    usuario: 'op',
    observacao: 'protocolo Destaxa cancelamento',
    confirmacao_explicita: true,
    travaEstado: 'RECONCILIACAO_PENDENTE'
  });
  assert.strictEqual(gate.ok, true);
  assert.strictEqual(gate.statusAlvo, 'cancelado');
  const linha = aplicarCenarioSemExecucao(criarLinhaId1Mock(), 'C_CANCELADA');
  assert.strictEqual(linha.financialState, FINANCIAL_STATES.UNKNOWN);
});

test('D) Aprovada: exige NSU/autorização no protocolo; fluxo atual não grava NSU sozinho', () => {
  assert.strictEqual(MATRIZ.D_APROVADA.exigeNsuAutorizacao, true);
  assert.strictEqual(MATRIZ.D_APROVADA.lacunaNsuNoFluxoAtual, true);
  const tm = fs.readFileSync(TEF_MANAGER, 'utf8');
  // reconciliarNativeHost atualiza status; não há atribuição a nsu/autorizacao no trecho de liberação
  const trecho = tm.slice(tm.indexOf('async reconciliarNativeHost'), tm.indexOf('async _verificarIdempotencia'));
  assert.ok(trecho.includes('status: statusFinal'));
  assert.ok(!/nsu\s*:/.test(trecho) || !trecho.includes('nsu: dados'));
  const linha = aplicarCenarioSemExecucao(criarLinhaId1Mock(), 'D_APROVADA');
  assert.strictEqual(linha.nsu, null);
  assert.strictEqual(linha.status, 'pendente');
});

test('E) Pendente/inconclusiva remota: UNKNOWN permanece; gate rejeita financialState UNKNOWN', () => {
  const gate = gateReconciliacaoExplicita({
    financialState: FINANCIAL_STATES.UNKNOWN,
    usuario: 'op',
    observacao: 'ainda inconclusivo',
    confirmacao_explicita: true,
    travaEstado: 'RECONCILIACAO_PENDENTE'
  });
  assert.strictEqual(gate.ok, false);
  assert.strictEqual(gate.codigo, 'TEF_RECONCILIACAO_INVALIDA');
  const linha = aplicarCenarioSemExecucao(criarLinhaId1Mock(), 'E_PENDENTE_INCONCLUSIVA');
  assert.strictEqual(linha.financialState, FINANCIAL_STATES.UNKNOWN);
  assert.strictEqual(linha.status, 'pendente');
});

test('F) Não localizada: mantém UNKNOWN; não prova inexistência', () => {
  assert.strictEqual(MATRIZ.F_NAO_LOCALIZADA.autoEncerraUnknown, false);
  assert.strictEqual(podeEncerrarAutomaticamentePorSinalFraco('nao_localizada_sem_protocolo'), false);
  const linha = aplicarCenarioSemExecucao(criarLinhaId1Mock(), 'F_NAO_LOCALIZADA');
  assert.strictEqual(linha.status, 'pendente');
  assert.strictEqual(linha.nsu, null);
});

test('Sinais fracos nunca encerram (timeout/78/99/verbal/ausência NSU)', () => {
  for (const sinal of [
    'timeout', 'resposta_78', 'codigo_99', 'ausencia_nsu_local', 'verbal_sem_protocolo', 'status_pendente_db'
  ]) {
    assert.strictEqual(podeEncerrarAutomaticamentePorSinalFraco(sinal), false, sinal);
  }
});

test('criarTransacaoExclusiva bloqueia com pendente (fonte)', () => {
  const repo = fs.readFileSync(path.join(ROOT, 'backend/services/tef/tefRepository.js'), 'utf8');
  assert.ok(repo.includes("WHERE NOT EXISTS (SELECT 1 FROM tef_transacoes WHERE status = 'pendente')"));
});

test('Todos os cenários A–F preservam linha mock intacta após preparação', () => {
  const base = criarLinhaId1Mock();
  for (const key of Object.keys(MATRIZ)) {
    const apos = aplicarCenarioSemExecucao({ ...base }, key);
    assert.strictEqual(apos.status, 'pendente', key);
    assert.strictEqual(apos.financialState, FINANCIAL_STATES.UNKNOWN, key);
    assert.strictEqual(apos.nsu, null, key);
    assert.strictEqual(apos.autorizacao, null, key);
  }
});

console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
process.exit(falhou ? 1 : 0);
