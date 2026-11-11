'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const recup = require(path.join(ROOT, 'backend/services/tef/destaxa/tefRecuperacaoProtocolarTx3.js'));
const DestaxaTransacaoOrquestrador = require(
  path.join(ROOT, 'backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js')
);
const tefManagerSrc = fs.readFileSync(
  path.join(ROOT, 'backend/services/tef/TefManager.js'),
  'utf8'
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

const pedidoOk = Object.freeze({
  transacaoId: 3,
  operador: 'PO/teste-51-45',
  confirmacaoExplicitaPo: true,
  confirmacao: 0
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

function planejar(extra = {}) {
  return recup.planejarRecuperacaoProtocolarTx3({
    linha: extra.linha || linhaOk,
    venda: extra.venda || vendaOk,
    pedido: { ...pedidoOk, ...(extra.pedido || {}) },
    evidenciasPendencia: { ...evidenciasOk, ...(extra.evidencias || {}) },
    dryRun: extra.dryRun !== false
  });
}

test('1) TX 3 identidade correta: path elegível em dry-run', () => {
  const plano = planejar();
  assert.strictEqual(plano.ok, true);
  assert.strictEqual(plano.elegivel, true);
  assert.strictEqual(plano.path, 'RECUPERACAO_PROTOCOLAR_TX3');
  assert.strictEqual(plano.dryRun, true);
  assert.strictEqual(plano.permit.ledgerEscrito, false);
  assert.strictEqual(plano.permit.hostPermit.operation, 'TX_FINALIZE');
  assert.strictEqual(plano.permit.hostPermit.transactionId, '3');
  assert.strictEqual(plano.permit.hostPermit.confirmacao, 0);
  assert.strictEqual(plano.autorizacaoSemContexto.permiteFinalizarSemContextoCrt, true);
  assert.strictEqual(plano.gateGlobal, 'OFF');
  assert.strictEqual(plano.retryAutomatico, false);
});

test('2) TX diferente de 3: bloqueado', () => {
  assert.throws(
    () => planejar({ linha: { ...linhaOk, id: 2 }, pedido: { ...pedidoOk, transacaoId: 2 } }),
    (err) => err.code === 'TEF_RECUP_TX3_ID_NAO_AUTORIZADO'
  );
});

test('3) NSU divergente: bloqueado', () => {
  assert.throws(
    () => planejar({ linha: { ...linhaOk, nsu: '9999' } }),
    (err) => err.code === 'TEF_RECUP_TX3_NSU'
  );
});

test('4) Autorização divergente: bloqueado', () => {
  assert.throws(
    () => planejar({ linha: { ...linhaOk, autorizacao: '000000' } }),
    (err) => err.code === 'TEF_RECUP_TX3_AUTORIZACAO'
  );
});

test('5) FINALIZE(9): bloqueado', () => {
  assert.throws(
    () => recup.validarOperacaoPermitida({ operation: 'TX_FINALIZE', confirmacao: 9, transactionId: '3' }),
    (err) => err.code === 'TEF_RECUP_TX3_FINALIZE9_BLOQUEADO'
  );
  assert.throws(
    () => planejar({ pedido: { ...pedidoOk, confirmacao: 9 } }),
    (err) => err.code === 'TEF_RECUP_TX3_FINALIZE9_BLOQUEADO'
  );
});

test('6) TX_START e TX_CONTINUE: bloqueados', () => {
  assert.throws(
    () => recup.validarOperacaoPermitida({ operation: 'TX_START', transactionId: '3' }),
    (err) => err.code === 'TEF_RECUP_TX3_OPERACAO_PROIBIDA'
  );
  assert.throws(
    () => recup.validarOperacaoPermitida({ operation: 'TX_CONTINUE', transactionId: '3' }),
    (err) => err.code === 'TEF_RECUP_TX3_OPERACAO_PROIBIDA'
  );
});

test('7) Ausência de contexto CRT: FINALIZE permitido somente com auth do path', () => {
  const plano = planejar();
  const orq = new DestaxaTransacaoOrquestrador({
    driver: {
      nome: 'native',
      finalizaTransacaoDestaxa: (conf) => {
        assert.strictEqual(conf, 0);
        return { codigo: '00', saida: '' };
      }
    },
    permitirTransacaoReal: false
  });

  const semAuth = orq.finalizarTransacao(0);
  assert.strictEqual(semAuth.sucesso, false);
  assert.ok(
    String(semAuth.codigo || '').includes('NAO_ENCONTRADA')
      || String(semAuth.mensagem || '').includes('Nenhuma transação')
  );

  const comAuth = orq.finalizarTransacao(0, {
    autorizacaoRecuperacao: plano.autorizacaoSemContexto
  });
  assert.strictEqual(comAuth.sucesso, true);
  assert.strictEqual(comAuth.recuperacaoProtocolarTx3, true);
  assert.strictEqual(comAuth.semContextoCrt, true);
  assert.strictEqual(comAuth.confirmacao, 0);

  const finalize9 = orq.finalizarTransacao(9, {
    autorizacaoRecuperacao: plano.autorizacaoSemContexto
  });
  assert.strictEqual(finalize9.sucesso, false);
});

test('8) Ciclo automático 51.41 preservado no TefManager', () => {
  assert.ok(tefManagerSrc.includes('intentCicloAutomaticoFinalize'));
  assert.ok(tefManagerSrc.includes("operation === 'TX_FINALIZE'"));
  assert.ok(
    tefManagerSrc.includes("continuidadeAtiva && ['TX_CONTINUE', 'TX_FINALIZE'].includes(operation)")
  );
});

test('9) Path PDV sem continuidade CRT continua exigindo continuidade (estático)', () => {
  // Espelho da regra 51.41: PDV intent só CONTINUE/FINALIZE sem continuidade → sem permit
  const decidir = (ctx) => {
    const { operation, transactionId, continuidadeAtiva, intent, linhaAtiva, emExecucao } = ctx;
    const intentCicloAutomaticoContinue = operation === 'TX_CONTINUE'
      && Array.isArray(intent?.allowedOperations)
      && intent.allowedOperations.includes('TX_START')
      && intent.allowedOperations.includes('TX_CONTINUE');
    const intentCicloAutomaticoFinalize = operation === 'TX_FINALIZE'
      && Array.isArray(intent?.allowedOperations)
      && intent.allowedOperations.includes('TX_START')
      && intent.allowedOperations.includes('TX_CONTINUE')
      && intent.allowedOperations.includes('TX_FINALIZE');
    const execucaoAutorizada = Boolean(
      transactionId
      && linhaAtiva
      && emExecucao
      && String(intent?.transactionId || '') === transactionId
      && Array.isArray(intent?.allowedOperations)
      && intent.allowedOperations.includes(operation)
      && (operation === 'TX_START'
        || (continuidadeAtiva && ['TX_CONTINUE', 'TX_FINALIZE'].includes(operation))
        || intentCicloAutomaticoContinue
        || intentCicloAutomaticoFinalize)
    );
    return execucaoAutorizada;
  };

  assert.strictEqual(decidir({
    operation: 'TX_FINALIZE',
    transactionId: '1',
    continuidadeAtiva: false,
    emExecucao: true,
    linhaAtiva: { id: '1' },
    intent: { transactionId: '1', allowedOperations: ['TX_CONTINUE', 'TX_FINALIZE'] }
  }), false);

  assert.strictEqual(decidir({
    operation: 'TX_FINALIZE',
    transactionId: '1',
    continuidadeAtiva: false,
    emExecucao: true,
    linhaAtiva: { id: '1' },
    intent: { transactionId: '1', allowedOperations: ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE'] }
  }), true);
});

test('10) Ausência de evidência de exclusividade: bloqueio obrigatório', () => {
  const semPo = planejar({
    evidencias: { confirmacaoExclusividadePo: false }
  });
  assert.strictEqual(semPo.ok, false);
  assert.strictEqual(semPo.abortarAntesFinalize, true);
  assert.strictEqual(semPo.codigo, 'TEF_RECUP_TX3_EXCLUSIVIDADE_NAO_CONFIRMADA');

  const semVespague = planejar({
    evidencias: { codigoVespague: 'outro' }
  });
  assert.strictEqual(semVespague.abortarAntesFinalize, true);
  assert.strictEqual(semVespague.codigo, 'TEF_RECUP_TX3_CORRELACAO_VESPAGUE');

  const init00 = planejar({ evidencias: { codigoInitClient: '00' } });
  assert.strictEqual(init00.codigo, 'TEF_RECUP_TX3_INIT_00_INESPERADO');

  const initF0 = planejar({ evidencias: { codigoInitClient: 'F0' } });
  assert.strictEqual(initF0.codigo, 'TEF_RECUP_TX3_F0');

  const multiplas = planejar({ evidencias: { multiplasPendenciasDestaxa: true } });
  assert.strictEqual(multiplas.codigo, 'TEF_RECUP_TX3_PENDENCIAS_MULTIPLAS');
});

test('11) classificarInitClient: A1 prossegue; 00/F0 abortam', () => {
  assert.strictEqual(recup.classificarInitClientParaRecuperacao('A1').prosseguirFinalize, true);
  assert.strictEqual(recup.classificarInitClientParaRecuperacao('00').abortar, true);
  assert.strictEqual(recup.classificarInitClientParaRecuperacao('F0').abortar, true);
});

test('12) Gate global OFF no planejamento dry-run', () => {
  const plano = planejar();
  assert.notStrictEqual(process.env.DESTAXA_REAL_TRANSACTION_ENABLED, '1');
  assert.strictEqual(plano.gateGlobal, 'OFF');
  assert.ok(plano.passosProibidos.includes('DESTAXA_REAL_TRANSACTION_ENABLED=1 (não exigido / não ligar)'));
});
