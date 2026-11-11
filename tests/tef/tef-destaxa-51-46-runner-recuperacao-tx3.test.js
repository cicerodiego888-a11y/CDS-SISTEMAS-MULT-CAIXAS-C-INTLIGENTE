'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const runner = require(
  path.join(ROOT, 'backend/services/tef/destaxa/tefRunnerRecuperacaoProtocolarTx3.js')
);
const recup = require(
  path.join(ROOT, 'backend/services/tef/destaxa/tefRecuperacaoProtocolarTx3.js')
);

const linhaOk = Object.freeze({
  id: 3,
  status: 'aprovado',
  valor: 1,
  tipo: 'cartao_debito',
  nsu: '2338',
  autorizacao: '211139',
  venda_id: 66,
  idempotency_key: 'tef-segunda-tentativa-bd6a8809bc64abb7'
});

const vendaOk = Object.freeze({
  id: 66,
  total: 1,
  status: 'concluida',
  status_pagamento: 'quitada',
  tef_transacao_id: 3
});

const evidenciasOk = Object.freeze({
  codigoInitClient: 'A1',
  nsu: '2338',
  autorizacao: '211139',
  codigoVespague: '10100017275707',
  pendenciasOperacionaisCds: [],
  finalizeDestaxaPosteriorATx3: false,
  multiplasPendenciasDestaxa: false,
  confirmacaoExclusividadePo: true,
  fonteEvidenciaA1: 'destaxa-nativehost-observability.jsonl requestId=1a83ad933cc4fb7b'
});

const pedidoOk = Object.freeze({
  transacaoId: 3,
  operation: 'TX_FINALIZE',
  confirmacao: 0,
  operador: 'PO/teste-51-46',
  confirmacaoExplicitaPo: true,
  tokenGoPo: runner.TOKEN_GO_PO
});

function executar(extra = {}) {
  return runner.executarRunnerRecuperacaoProtocolarTx3({
    linha: extra.linha || linhaOk,
    venda: extra.venda || vendaOk,
    pedido: { ...pedidoOk, ...(extra.pedido || {}) },
    evidenciasPendencia: { ...evidenciasOk, ...(extra.evidencias || {}) },
    estadoSessaoDestaxa: extra.estadoSessao !== undefined
      ? extra.estadoSessao
      : {
          codigoInitClient: 'A1',
          fonte: evidenciasOk.fonteEvidenciaA1,
          timeout: false
        },
    dryRun: extra.dryRun !== false,
    permitRejeitadoSimulado: extra.permitRejeitadoSimulado === true
  });
}

test('1) dry-run elegível: identidade + exclusividade + permit em memória sem nativo', () => {
  const r = executar();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.elegivel, true);
  assert.strictEqual(r.dryRun, true);
  assert.strictEqual(r.path, 'RECUPERACAO_PROTOCOLAR_TX3');
  assert.strictEqual(r.sprint, 'SPRINT-51.46');
  assert.strictEqual(r.dllChamada, false);
  assert.strictEqual(r.nativeHostChamado, false);
  assert.strictEqual(r.vespagueChamado, false);
  assert.strictEqual(r.permitLedgerEscrito, false);
  assert.strictEqual(r.permit.hostPermit.operation, 'TX_FINALIZE');
  assert.strictEqual(r.permit.hostPermit.confirmacao, 0);
  assert.strictEqual(r.permit.hostPermit.transactionId, '3');
  assert.strictEqual(r.retryAutomatico, false);
  assert.strictEqual(r.execucaoUnica, true);
  assert.strictEqual(r.gateGlobal, 'OFF');
  assert.ok(Array.isArray(r.auditoria) && r.auditoria.length > 0);
});

test('2) TX diferente de 3: bloqueado', () => {
  const r = executar({
    linha: { ...linhaOk, id: 2, venda_id: 66 },
    pedido: { ...pedidoOk, transacaoId: 2 }
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.abortado, true);
  assert.ok(
    r.codigo === 'TEF_RUNNER_TX3_DIVERGENCIA_IDENTIFICADORES'
      || r.codigo === 'TEF_RECUP_TX3_ID_NAO_AUTORIZADO'
  );
});

test('3) NSU divergente: bloqueado', () => {
  const r = executar({ linha: { ...linhaOk, nsu: '9999' } });
  assert.strictEqual(r.abortado, true);
  assert.strictEqual(r.codigo, 'TEF_RUNNER_TX3_DIVERGENCIA_IDENTIFICADORES');
});

test('4) Autorização divergente: bloqueado', () => {
  const r = executar({ linha: { ...linhaOk, autorizacao: '000000' } });
  assert.strictEqual(r.abortado, true);
  assert.strictEqual(r.codigo, 'TEF_RUNNER_TX3_DIVERGENCIA_IDENTIFICADORES');
});

test('5) V$Pague divergente: bloqueado', () => {
  const r = executar({ evidencias: { codigoVespague: '999' } });
  assert.strictEqual(r.abortado, true);
  assert.ok(
    r.codigo === 'TEF_RUNNER_TX3_DIVERGENCIA_IDENTIFICADORES'
      || r.codigo === 'TEF_RECUP_TX3_CORRELACAO_VESPAGUE'
  );
});

test('6) FINALIZE(9): bloqueado', () => {
  const r = executar({ pedido: { ...pedidoOk, confirmacao: 9 } });
  assert.strictEqual(r.abortado, true);
  assert.strictEqual(r.codigo, 'TEF_RUNNER_TX3_FINALIZE9_BLOQUEADO');
});

test('7) TX_START e TX_CONTINUE: bloqueados', () => {
  const start = executar({ pedido: { ...pedidoOk, operation: 'TX_START' } });
  assert.strictEqual(start.codigo, 'TEF_RUNNER_TX3_OPERACAO_PROIBIDA');
  const cont = executar({ pedido: { ...pedidoOk, operation: 'TX_CONTINUE' } });
  assert.strictEqual(cont.codigo, 'TEF_RUNNER_TX3_OPERACAO_PROIBIDA');
  const crt = executar({ pedido: { ...pedidoOk, operation: 'CRT' } });
  assert.strictEqual(crt.codigo, 'TEF_RUNNER_TX3_OPERACAO_PROIBIDA');
});

test('8) INIT 00 / F0 / timeout: abortam antes do permit', () => {
  const init00 = executar({
    estadoSessao: { codigoInitClient: '00', fonte: 'teste' }
  });
  assert.strictEqual(init00.codigo, 'TEF_RUNNER_TX3_INIT_00');
  assert.ok(!(init00.permit && init00.permit.hostPermit));

  const initF0 = executar({
    estadoSessao: { codigoInitClient: 'F0', fonte: 'teste' }
  });
  assert.strictEqual(initF0.codigo, 'TEF_RUNNER_TX3_INIT_F0');

  const timeout = executar({
    estadoSessao: { codigoInitClient: 'A1', timeout: true, fonte: 'teste' }
  });
  assert.strictEqual(timeout.codigo, 'TEF_RUNNER_TX3_TIMEOUT_SESSAO');
});

test('9) Sem exclusividade / múltiplas pendências: bloqueio obrigatório', () => {
  const semPo = executar({
    evidencias: { confirmacaoExclusividadePo: false }
  });
  assert.strictEqual(semPo.abortado, true);
  assert.strictEqual(semPo.codigo, 'TEF_RECUP_TX3_EXCLUSIVIDADE_NAO_CONFIRMADA');

  const multiplas = executar({
    evidencias: { multiplasPendenciasDestaxa: true }
  });
  assert.strictEqual(multiplas.codigo, 'TEF_RECUP_TX3_PENDENCIAS_MULTIPLAS');
});

test('10) Sem token GO do PO: aborta antes do permit', () => {
  const r = executar({
    pedido: { ...pedidoOk, tokenGoPo: '', confirmacaoExplicitaPo: true }
  });
  assert.strictEqual(r.abortado, true);
  assert.strictEqual(r.codigo, 'TEF_RUNNER_TX3_TOKEN_GO_INVALIDO');
  assert.ok(!(r.permit && r.permit.hostPermit));
});

test('11) Permit rejeitado: aborta sem nativo', () => {
  const r = executar({ permitRejeitadoSimulado: true });
  assert.strictEqual(r.codigo, 'TEF_RUNNER_TX3_PERMIT_REJEITADO');
  assert.strictEqual(r.dllChamada, false);
  assert.strictEqual(r.nativeHostChamado, false);
});

test('12) Tentativa de execução real nesta sprint: hard-block', () => {
  const r = executar({
    dryRun: false,
    pedido: { ...pedidoOk, executarReal: true }
  });
  assert.strictEqual(r.abortado, true);
  assert.strictEqual(r.codigo, 'TEF_RUNNER_TX3_SPRINT_51_46_SEM_EXECUCAO_NATIVA');
  assert.strictEqual(r.dllChamada, false);
  assert.strictEqual(runner.EXECUCAO_NATIVA_HABILITADA_NESTA_SPRINT, false);
});

test('13) Retry automático proibido', () => {
  const r = executar({ pedido: { ...pedidoOk, retryAutomatico: true } });
  assert.strictEqual(r.codigo, 'TEF_RUNNER_TX3_RETRY_PROIBIDO');
});

test('14) Path 51.45 permanece elegível; runner usa o mesmo PATH_NOME', () => {
  assert.strictEqual(runner.PATH_NOME, recup.PATH_NOME);
  assert.strictEqual(runner.PATH_NOME, 'RECUPERACAO_PROTOCOLAR_TX3');
  const plano = recup.planejarRecuperacaoProtocolarTx3({
    linha: linhaOk,
    venda: vendaOk,
    pedido: {
      transacaoId: 3,
      operador: 'PO/teste',
      confirmacaoExplicitaPo: true,
      confirmacao: 0
    },
    evidenciasPendencia: evidenciasOk,
    dryRun: true
  });
  assert.strictEqual(plano.elegivel, true);
});

test('15) Ausência de chamadas nativas no dry-run bem-sucedido', () => {
  const r = executar();
  const eventos = (r.auditoria || []).map((a) => a.evento);
  assert.ok(eventos.includes('NATIVO_NAO_CHAMADO'));
  assert.ok(eventos.includes('PERMIT_DRY_RUN_EMITIDO'));
  assert.ok(!eventos.includes('DLL_CHAMADA'));
  assert.ok(!eventos.includes('FINALIZE_EXECUTADO'));
});
