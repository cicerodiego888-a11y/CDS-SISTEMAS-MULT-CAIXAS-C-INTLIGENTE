'use strict';

/**
 * TEF-DESTAXA-51.12 — validação do caminho TefManager vs runner sintético.
 * Somente mocks em memória. Sem SQLite, DLL, NativeHost, V$Pague ou TX.
 *
 * node tests/tef/tef-destaxa-51-12-caminho-tefmanager.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const RUNNER = path.join(ROOT, 'docs/homologacao/tef/TEF-DESTAXA-51.10/tef-51-10-runner.js');
const HISTORICO = path.join(
  ROOT,
  'docs/homologacao/tef/TEF-DESTAXA-51.10/tef-51-10-runner.HISTORICO-INEQ-51.10.js'
);
const TEF_MANAGER = path.join(ROOT, 'backend/services/tef/TefManager.js');
const REPO = path.join(ROOT, 'backend/services/tef/tefRepository.js');
const PERSIST_GATE = path.join(ROOT, 'backend/services/tef/tefPersistenciaObrigatoria.js');

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

/** Espelho do gate do adapter (sem I/O). */
function validarPersistenciaAntesEnvio(preparacao, gateOn) {
  const transactionId = preparacao?.transactionId != null
    ? String(preparacao.transactionId)
    : null;
  const confirmada = preparacao?.persistenciaConfirmada === true;
  if (!gateOn && preparacao?.caminhoHarness === 'simulado') {
    return { ok: true, caminho: 'harness_simulado' };
  }
  if (!transactionId || !confirmada) {
    return {
      ok: false,
      codigo: 'TEF_PERSISTENCIA_OBRIGATORIA',
      mensagem: 'Operação financeira Destaxa exige TefManager.autorizar com identidade persistida antes da DLL'
    };
  }
  return { ok: true, transactionId, persistenciaConfirmada: true };
}

/** Memória: tabela tef_transacoes simulada. */
function criarStoreMemoria() {
  const rows = new Map();
  let seq = 1000;
  return {
    rows,
    insertExclusivo(payload) {
      const pendente = [...rows.values()].some((r) => r.status === 'pendente');
      if (pendente) return null;
      seq += 1;
      const id = seq;
      rows.set(String(id), {
        id,
        status: 'pendente',
        payload_retorno: {
          persistencia: { ...payload.persistencia },
          continuidade: payload.continuidade || {}
        }
      });
      return id; // lastID
    },
    buscar(id) {
      return rows.get(String(id)) || null;
    },
    gravarContinuidade(id, cont) {
      const tx = rows.get(String(id));
      if (!tx) return null;
      if (cont && cont._forceFail) return { status: 'pendente', payload_retorno: { continuidade: {} } };
      tx.payload_retorno.continuidade = cont;
      return { status: tx.status, payload_retorno: tx.payload_retorno };
    }
  };
}

function registrarSolicitacao99Mem(store, transacaoId, { solicitadaEm, acao }) {
  const tx = store.buscar(transacaoId);
  if (!tx) return { ok: false, codigo: 'TEF_TRANSACAO_NAO_ENCONTRADA' };
  const persistencia = tx.payload_retorno?.persistencia || {};
  const identidade = {
    transactionId: String(tx.id),
    operation_id: String(persistencia.operation_id || ''),
    idempotency_key: String(persistencia.idempotency_key || ''),
    fingerprint: String(persistencia.fingerprint || '')
  };
  if (!identidade.operation_id || !identidade.idempotency_key || !identidade.fingerprint) {
    return { ok: false, codigo: 'DESTAXA_CONTINUIDADE_IDENTIDADE_DIVERGENTE' };
  }
  const cont = {
    estado: 'AGUARDANDO_RESPOSTA',
    solicitacao99: { solicitadaEm, acao, identidade },
    txStartCount: 1
  };
  const relida = store.gravarContinuidade(transacaoId, cont);
  const confirmada = relida
    && relida.payload_retorno?.continuidade?.estado === 'AGUARDANDO_RESPOSTA'
    && relida.payload_retorno?.continuidade?.solicitacao99?.solicitadaEm === solicitadaEm;
  if (!confirmada) {
    return {
      ok: false,
      codigo: 'DESTAXA_CONTINUIDADE_PERSISTENCIA_FALHOU',
      mensagem: 'Solicitação 99 não foi confirmada após releitura'
    };
  }
  return {
    ok: true,
    duravel: true,
    confirmada: true,
    transactionId: String(transacaoId),
    identidade,
    solicitadaEm,
    estadoDespacho: 'INICIADO',
    despachoId: `desp-${transacaoId}`,
    fingerprint: identidade.fingerprint,
    resposta: { informacao: '' }
  };
}

function confirmarAntesContinue(resultado, txId, solicitadaEm, resposta) {
  const identidade = resultado?.identidade;
  const identidadeCompleta = identidade
    && String(identidade.transactionId || '') === String(txId)
    && ['operation_id', 'idempotency_key', 'fingerprint'].every((c) =>
      typeof identidade[c] === 'string' && identidade[c].trim() !== '');
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

console.log('\nTEF-DESTAXA-51.12 — caminho TefManager (mocks)\n');

test('1) Sem INSERT / sem persistenciaConfirmada → envio financeiro bloqueado', () => {
  const guard = validarPersistenciaAntesEnvio(
    { pronto: true, transactionId: null, persistenciaConfirmada: false },
    true
  );
  assert.strictEqual(guard.ok, false);
  assert.strictEqual(guard.codigo, 'TEF_PERSISTENCIA_OBRIGATORIA');
});

test('2) INSERT confirmado → transactionId = lastID real (numérico)', () => {
  const store = criarStoreMemoria();
  const lastID = store.insertExclusivo({
    persistencia: {
      operation_id: 'op-real-1',
      idempotency_key: 'idem-real-1',
      fingerprint: 'fp-real-1'
    }
  });
  assert.ok(Number.isInteger(lastID));
  assert.ok(/^\d+$/.test(String(lastID)));
  const preparacao = {
    transactionId: String(lastID),
    persistenciaConfirmada: true,
    operation_id: 'op-real-1',
    fingerprint: 'fp-real-1'
  };
  const guard = validarPersistenciaAntesEnvio(preparacao, true);
  assert.strictEqual(guard.ok, true);
  assert.strictEqual(guard.transactionId, String(lastID));
  assert.strictEqual(store.buscar(lastID).id, lastID);
});

test('3) ID inexistente bloqueia persistência 99', () => {
  const store = criarStoreMemoria();
  const r = registrarSolicitacao99Mem(store, 'tx-5110-fake', {
    solicitadaEm: '2026-11-09T18:54:51.000Z',
    acao: { chave: 'transacao_cartao_numero' }
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.codigo, 'TEF_TRANSACAO_NAO_ENCONTRADA');
});

test('4) Falha no UPDATE/releitura bloqueia TX_CONTINUE', () => {
  const store = criarStoreMemoria();
  const id = store.insertExclusivo({
    persistencia: {
      operation_id: 'op-2',
      idempotency_key: 'idem-2',
      fingerprint: 'fp-2'
    }
  });
  const original = store.gravarContinuidade.bind(store);
  store.gravarContinuidade = (tid, cont) => original(tid, { ...cont, _forceFail: true });
  const r = registrarSolicitacao99Mem(store, id, {
    solicitadaEm: '2026-11-09T19:00:00.000Z',
    acao: { chave: 'x' }
  });
  assert.strictEqual(r.ok, false);
  assert.ok(String(r.codigo).includes('PERSISTENCIA_FALHOU'));
  assert.strictEqual(
    confirmarAntesContinue(r, String(id), '2026-11-09T19:00:00.000Z', { informacao: '' }),
    false
  );
});

test('5) Persistência 99 confirmada libera estágio lógico do CONTINUE', () => {
  const store = criarStoreMemoria();
  const id = store.insertExclusivo({
    persistencia: {
      operation_id: 'op-3',
      idempotency_key: 'idem-3',
      fingerprint: 'fp-3'
    }
  });
  const solicitadaEm = '2026-11-09T19:01:00.000Z';
  const resposta = { informacao: '' };
  const r = registrarSolicitacao99Mem(store, id, {
    solicitadaEm,
    acao: { chave: 'transacao_cartao_numero' }
  });
  // Completa campos exigidos pelo gate do ciclo (já retornados no mock)
  r.resposta = resposta;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.duravel, true);
  assert.strictEqual(r.confirmada, true);
  assert.strictEqual(confirmarAntesContinue(r, String(id), solicitadaEm, resposta), true);
});

test('6) Runner não pode forjar confirmação durável (flag ≠ linha)', () => {
  const store = criarStoreMemoria();
  const forged = {
    persistenciaConfirmada: true,
    transactionId: 'tx-5110-2dbbb6922eb64990'
  };
  // Gate do adapter aceita a flag (buraco conhecido do 51.10 com auth excepcional),
  // mas a reserva 99 revalida no store e falha.
  const guard = validarPersistenciaAntesEnvio(forged, true);
  assert.strictEqual(guard.ok, true); // flag sintética passa o gate de superfície
  const reg = registrarSolicitacao99Mem(store, forged.transactionId, {
    solicitadaEm: '2026-11-09T18:54:51.000Z',
    acao: { chave: 'transacao_cartao_numero' }
  });
  assert.strictEqual(reg.ok, false);
  assert.strictEqual(reg.codigo, 'TEF_TRANSACAO_NAO_ENCONTRADA');
  assert.strictEqual(store.buscar(forged.transactionId), null);
});

test('7) Runner 51.10 operacional está desativado; histórico preservado', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  assert.ok(src.includes('RUNNER_OPERACIONAL_DESATIVADO') || src.includes('DESATIVADO'));
  assert.ok(src.includes('abortar') || src.includes('process.exit(3)') || src.includes('app.exit(3)'));
  assert.ok(!src.includes('autorizarPagamento'));
  assert.ok(!src.includes('persistenciaConfirmada: true'));
  assert.ok(fs.existsSync(HISTORICO));
  const hist = fs.readFileSync(HISTORICO, 'utf8');
  assert.ok(hist.includes('tx-5110-${crypto.randomBytes(8).toString(\'hex\')}'));
  assert.ok(hist.includes('persistenciaConfirmada: true'));
});

test('8) Fonte TefManager: INSERT → lastID → preparacaoComPersistencia antes do adapter', () => {
  const tm = fs.readFileSync(TEF_MANAGER, 'utf8');
  const repo = fs.readFileSync(REPO, 'utf8');
  assert.ok(tm.includes('criarTransacaoExclusiva'));
  assert.ok(tm.includes('preparacaoComPersistencia'));
  assert.ok(tm.includes('persistenciaConfirmada: true'));
  assert.ok(tm.includes('autorizarPagamento'));
  assert.ok(repo.includes('this.lastID'));
  assert.ok(repo.includes('WHERE NOT EXISTS (SELECT 1 FROM tef_transacoes WHERE status = \'pendente\')'));
  // Ordem relativa no TefManager: criarTransacaoExclusiva aparece antes de preparacaoComPersistencia
  assert.ok(tm.indexOf('criarTransacaoExclusiva') < tm.indexOf('preparacaoComPersistencia'));
  assert.ok(tm.indexOf('preparacaoComPersistencia') < tm.indexOf('autorizarPagamento('));
});

test('9) Gate de superfície ainda exige flag+id quando gateOn (código real)', () => {
  // Carrega somente o módulo de gate — sem TX/DLL
  const { validarPersistenciaAntesEnvioFinanceiro } = require(PERSIST_GATE);
  const bloqueio = validarPersistenciaAntesEnvioFinanceiro(
    { pronto: true },
    {},
    { gateOn: true }
  );
  assert.strictEqual(bloqueio.ok, false);
  const okFlag = validarPersistenciaAntesEnvioFinanceiro(
    { transactionId: '1842', persistenciaConfirmada: true, operation_id: 'op', fingerprint: 'fp' },
    {},
    { gateOn: true }
  );
  assert.strictEqual(okFlag.ok, true);
  assert.strictEqual(okFlag.transactionId, '1842');
});

console.log(`\nResultado: ${passou} ok / ${falhou} falhas\n`);
process.exit(falhou ? 1 : 0);
