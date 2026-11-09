'use strict';

/**
 * TEF-DESTAXA-51.11 — diagnóstico estático da falha de persistência 99 (51.10).
 * Somente mocks em memória. Sem SQLite, DLL, NativeHost, V$Pague ou TX.
 *
 * node tests/tef/tef-destaxa-51-11-persistencia-99.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..');
const RESULTADO_5110 = path.join(
  ROOT,
  'docs/homologacao/tef/TEF-DESTAXA-51.10/resultado-crt.json'
);
const RUNNER_5110 = path.join(
  ROOT,
  'docs/homologacao/tef/TEF-DESTAXA-51.10/tef-51-10-runner.js'
);

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

/**
 * Espelho da ramificação crítica de registrarSolicitacao99 (sem I/O).
 * Fonte: destaxaContinuidadePersistencia.js — buscarTransacao → !tx.
 */
function registrarSolicitacao99RamificacaoTxAusente(tx) {
  if (!tx) {
    return { ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' };
  }
  return { ok: true };
}

/**
 * Espelho do fallback de mensagem em DestaxaRealAdapter._persistirRespostaContinuidade
 * quando registrarSolicitacao99 falha sem `mensagem`.
 */
function mensagemPersistenciaSolicitacao(solicitacao) {
  if (!solicitacao?.ok || solicitacao.duravel !== true || solicitacao.confirmada !== true) {
    return {
      ok: false,
      codigo: solicitacao?.codigo || 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU',
      mensagem: solicitacao?.mensagem || 'Solicitação 99 não confirmada em armazenamento durável'
    };
  }
  return { ok: true };
}

/**
 * Espelho mínimo do gate de confirmação em _persistirAntesContinue (ciclo).
 */
function confirmacaoValidaAntesContinue(resultado, txId, solicitadaEm, resposta) {
  const identidade = resultado?.identidade;
  const identidadeCompleta = identidade
    && String(identidade.transactionId || '') === String(txId)
    && ['operation_id', 'idempotency_key', 'fingerprint'].every((campo) =>
      typeof identidade[campo] === 'string' && identidade[campo].trim() !== '');
  return resultado?.ok === true
    && resultado?.duravel === true
    && resultado?.confirmada === true
    && String(resultado.transactionId || '') === String(txId)
    && resultado.solicitadaEm === solicitadaEm
    && resultado.estadoDespacho === 'INICIADO'
    && typeof resultado.despachoId === 'string'
    && resultado.despachoId.trim() !== ''
    && typeof resultado.fingerprint === 'string'
    && resultado.fingerprint.trim() !== ''
    && identidadeCompleta
    && JSON.stringify(resultado.resposta) === JSON.stringify(resposta);
}

console.log('\nTEF-DESTAXA-51.11 — persistência 99 (mocks)\n');

test('1) evidencia 51.10: codigo TEF_TRANSACAO_NAO_ENCONTRADA + mensagem durável', () => {
  const r = JSON.parse(fs.readFileSync(RESULTADO_5110, 'utf8'));
  assert.strictEqual(r.transactionId, 'tx-5110-2dbbb6922eb64990');
  assert.strictEqual(r.resposta.codigo, 'TEF_TRANSACAO_NAO_ENCONTRADA');
  assert.strictEqual(
    r.resposta.mensagem,
    'Solicitação 99 não confirmada em armazenamento durável'
  );
  assert.strictEqual(r.resposta.cicloCrt.continues, 0);
  assert.strictEqual(r.resposta.financialState, 'UNKNOWN');
});

test('2) runner 51.10 inventa transactionId string (não id SQLite)', () => {
  const src = fs.readFileSync(RUNNER_5110, 'utf8');
  assert.ok(src.includes("tx-5110-${crypto.randomBytes(8).toString('hex')}"));
  assert.ok(src.includes('persistenciaConfirmada: true'));
  assert.ok(!src.includes('criarTransacao'));
  assert.ok(!src.includes('TefManager'));
  assert.ok(src.includes('autorizarPagamento'));
});

test('3) ramificação !tx → TEF_TRANSACAO_NAO_ENCONTRADA sem mensagem', () => {
  const falha = registrarSolicitacao99RamificacaoTxAusente(null);
  assert.deepStrictEqual(falha, { ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' });
  assert.strictEqual(falha.mensagem, undefined);
});

test('4) adapter aplica fallback de mensagem idêntico ao 51.10', () => {
  const mapped = mensagemPersistenciaSolicitacao({
    ok: false,
    codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA'
  });
  assert.strictEqual(mapped.codigo, 'TEF_TRANSACAO_NAO_ENCONTRADA');
  assert.strictEqual(
    mapped.mensagem,
    'Solicitação 99 não confirmada em armazenamento durável'
  );
});

test('5) persistenciaConfirmada sintética NÃO implica linha em tef_transacoes', () => {
  const preparacaoRunner = {
    persistenciaConfirmada: true,
    transactionId: 'tx-5110-2dbbb6922eb64990',
    operation_id: 'op-5110-deadbeef',
    idempotency_key: 'idem-5110-35226e1d49f415d8',
    fingerprint: 'abc'
  };
  // Gate MRT-27 passa com flags — mas registrarSolicitacao99 exige SELECT id=?
  assert.strictEqual(preparacaoRunner.persistenciaConfirmada, true);
  const tx = null; // simula buscarTransacao(id sintético)
  const reg = registrarSolicitacao99RamificacaoTxAusente(tx);
  assert.strictEqual(reg.ok, false);
  assert.strictEqual(reg.codigo, 'TEF_TRANSACAO_NAO_ENCONTRADA');
});

test('6) contrato CONTINUE exige reserva durável completa (nao so ok:true)', () => {
  const parcial = {
    ok: true,
    duravel: true,
    confirmada: true,
    transactionId: '42',
    solicitadaEm: '2026-11-09T18:54:51.000Z',
    resposta: { informacao: '' },
    identidade: {
      transactionId: '42',
      operation_id: 'op',
      idempotency_key: 'idem',
      fingerprint: 'fp'
    }
    // faltam estadoDespacho / despachoId / fingerprint no topo
  };
  assert.strictEqual(
    confirmacaoValidaAntesContinue(
      parcial,
      '42',
      '2026-11-09T18:54:51.000Z',
      { informacao: '' }
    ),
    false
  );
});

test('7) caminho PDV: transactionId deve ser id numerico de tef_transacoes', () => {
  const idPdv = '1842';
  const idRunner = 'tx-5110-2dbbb6922eb64990';
  assert.ok(/^\d+$/.test(idPdv));
  assert.ok(!/^\d+$/.test(idRunner));
});

console.log(`\nResultado: ${passou} ok / ${falhou} falhas\n`);
process.exit(falhou ? 1 : 0);
