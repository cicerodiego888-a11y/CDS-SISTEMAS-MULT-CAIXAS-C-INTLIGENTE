'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const DestaxaNativeBridge = require(
  path.join(ROOT, 'backend/services/tef/destaxa/DestaxaNativeBridge.js')
);
const recup = require(
  path.join(ROOT, 'backend/services/tef/destaxa/tefRecuperacaoProtocolarTx3.js')
);

test('Bridge.finalizarTransacaoDestaxa encaminha autorizacaoRecuperacao', () => {
  const bridge = new DestaxaNativeBridge({
    config: {},
    loader: { carregarBiblioteca: () => ({ exports: {} }) },
    resolver: { resolverDll: () => ({ sucesso: false }) }
  });

  let recebido = null;
  bridge.getOrquestradorTransacao().finalizarTransacao = (confirmacao, opcoes) => {
    recebido = { confirmacao, opcoes };
    return { sucesso: true, codigoDestaxa: '00', recuperacaoProtocolarTx3: true };
  };

  const auth = {
    path: 'RECUPERACAO_PROTOCOLAR_TX3',
    permiteFinalizarSemContextoCrt: true,
    transactionId: '3',
    confirmacao: 0,
    exclusividade: { ok: true, abortarAntesFinalize: false }
  };
  const out = bridge.finalizarTransacaoDestaxa(0, { autorizacaoRecuperacao: auth });
  assert.strictEqual(out.sucesso, true);
  assert.strictEqual(recebido.confirmacao, 0);
  assert.strictEqual(recebido.opcoes.autorizacaoRecuperacao.path, 'RECUPERACAO_PROTOCOLAR_TX3');
});

test('Permit recuperação materializado (não dry-run) mantém purpose/TX_FINALIZE/0/3', () => {
  const permit = recup.criarPermitRecuperacaoTx3({ dryRun: false, operador: 'PO/teste' });
  assert.strictEqual(permit.dryRun, false);
  assert.strictEqual(permit.exceptionalPermit.purpose, 'RECUPERACAO_PROTOCOLAR_TX3');
  assert.strictEqual(permit.exceptionalPermit.operation, 'TX_FINALIZE');
  assert.strictEqual(permit.exceptionalPermit.confirmacao, 0);
  assert.strictEqual(permit.exceptionalPermit.transactionId, '3');
  assert.strictEqual(permit.ledgerEscrito, false);
});
