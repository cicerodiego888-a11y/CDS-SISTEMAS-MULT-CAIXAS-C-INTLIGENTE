'use strict';

/**
 * TEF-17 — Política segura de cancelamento Destaxa (mocks; sem INIT/TX real).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const tefContrato = require('../../backend/services/tef/tefContrato');
const politica = require('../../backend/services/tef/destaxa/destaxaCancelamentoPolitica');
const { OPERACOES, FINALIZACAO_CANCELAR } = require('../../backend/services/tef/destaxa/destaxaConstantes');

function test(nome, fn) {
  const ret = fn();
  if (ret && typeof ret.then === 'function') {
    return ret.then(() => console.log(`  OK  ${nome}`))
      .catch((err) => {
        console.error(`  FAIL ${nome}`);
        throw err;
      });
  }
  console.log(`  OK  ${nome}`);
  return Promise.resolve();
}

async function criarDbIsolado() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tef17-'));
  const dbPath = path.join(dir, 'tef17.db');
  const db = new sqlite3.Database(dbPath);
  await new Promise((resolve, reject) => {
    db.exec(`
      CREATE TABLE tef_transacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT,
        nsu TEXT,
        autorizacao TEXT,
        payload_retorno TEXT,
        reversao_executada INTEGER DEFAULT 0,
        reversao_motivo TEXT,
        reversao_data TEXT,
        atualizado_em TEXT,
        criado_em TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE tef_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transacao_id INTEGER,
        tipo TEXT,
        mensagem TEXT,
        payload TEXT,
        hash_integridade TEXT,
        criado_em TEXT
      );
    `, (err) => (err ? reject(err) : resolve()));
  });
  return { dir, dbPath, db };
}

console.log('=== TEF-17 — Política cancelamento Destaxa ===\n');

(async () => {
  await test('contrato real: EST documentado; campos entrada EST ausentes; finaliza(9) ≠ estorno', () => {
    assert.strictEqual(politica.CONTRATO_CANCELAMENTO_DESTAXA.operacaoEstorno, OPERACOES.EST);
    assert.strictEqual(politica.CONTRATO_CANCELAMENTO_DESTAXA.camposEntradaEstDocumentados, null);
    assert.strictEqual(politica.CONTRATO_CANCELAMENTO_DESTAXA.exportCancelamentoDedicado, false);
    assert.strictEqual(
      politica.CONTRATO_CANCELAMENTO_DESTAXA.abortarTransacaoCorrente.confirmacaoCancelar,
      FINALIZACAO_CANCELAR
    );
    assert.strictEqual(
      politica.CONTRATO_CANCELAMENTO_DESTAXA.abortarTransacaoCorrente.distintoDeEstornoComercial,
      true
    );
    assert.strictEqual(politica.CONTRATO_CANCELAMENTO_DESTAXA.estornoComercialHabilitadoNoCds, false);
  });

  await test('provedor sem suporte → NAO_SUPORTADO sem sucesso financeiro', async () => {
    const adapter = new DestaxaRealAdapter({}, {
      executionMode: 'in-process',
      nativeLoader: { carregarBiblioteca() { throw new Error('não deve carregar'); } },
      resolver: { resolverDll() { return { sucesso: false }; } }
    });
    const r = await adapter.cancelarPagamento({
      transacao_id: 10,
      nsu: '123',
      autorizacao: 'ABC'
    });
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(r.cancelConfirmed, false);
    assert.strictEqual(r.financialState, 'UNCHANGED');
    assert.strictEqual(r.cancelOutcome, politica.OUTCOMES.NAO_SUPORTADO);
    assert.strictEqual(r.codigo, politica.CODIGOS.NAO_SUPORTADO);
    assert.notStrictEqual(r.status, tefContrato.STATUS.CANCELADO);
  });

  await test('solicitação sem dados obrigatórios → DADOS_INSUFICIENTES (modo simulação)', async () => {
    const adapter = new DestaxaRealAdapter({}, { executionMode: 'in-process', nativeLoader: {}, resolver: {} });
    const r = await adapter.cancelarPagamento(
      { transacao_id: 11 },
      {
        permitirSimulacaoProvedor: true,
        resultadoProvedorSimulado: { sucesso: true, codigoDestaxa: '00', classificacao: 'SUCCESS' }
      }
    );
    assert.strictEqual(r.cancelOutcome, politica.OUTCOMES.DADOS_INSUFICIENTES);
    assert.strictEqual(r.cancelConfirmed, false);
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(r.financialState, 'UNCHANGED');
  });

  await test('cancelamento recusado (simulado) → RECUSADO', async () => {
    const adapter = new DestaxaRealAdapter({}, { executionMode: 'in-process', nativeLoader: {}, resolver: {} });
    const r = await adapter.cancelarPagamento(
      { transacao_id: 12, nsu: 'NSU1', autorizacao: 'AUT1' },
      {
        resultadoProvedorSimulado: {
          sucesso: false,
          recusado: true,
          classificacao: 'DENIED',
          codigoDestaxa: '05',
          mensagem: 'recusado mock'
        }
      }
    );
    assert.strictEqual(r.cancelOutcome, politica.OUTCOMES.RECUSADO);
    assert.strictEqual(r.cancelConfirmed, false);
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(r.financialState, 'UNCHANGED');
  });

  await test('timeout durante cancelamento (simulado) → TIMEOUT ≠ cancelado', async () => {
    const adapter = new DestaxaRealAdapter({}, { executionMode: 'in-process', nativeLoader: {}, resolver: {} });
    const r = await adapter.cancelarPagamento(
      { transacao_id: 13, nsu: 'NSU2', autorizacao: 'AUT2' },
      { resultadoProvedorSimulado: { timeout: true, codigoDestaxa: '08', mensagem: 'timeout mock' } }
    );
    assert.strictEqual(r.cancelOutcome, politica.OUTCOMES.TIMEOUT);
    assert.strictEqual(r.cancelConfirmed, false);
    assert.strictEqual(tefContrato.cancelamentoConfirmado(r), false);
  });

  await test('resultado inconclusivo (simulado)', async () => {
    const adapter = new DestaxaRealAdapter({}, { executionMode: 'in-process', nativeLoader: {}, resolver: {} });
    const r = await adapter.cancelarPagamento(
      { transacao_id: 14, nsu: 'NSU3', autorizacao: 'AUT3' },
      { resultadoProvedorSimulado: { sucesso: false, codigoDestaxa: 'FF', mensagem: 'desconhecido' } }
    );
    assert.strictEqual(r.cancelOutcome, politica.OUTCOMES.INCONCLUSIVO);
    assert.strictEqual(r.cancelConfirmed, false);
    assert.strictEqual(r.financialState, 'UNCHANGED');
  });

  await test('confirmação válida simulada → CONFIRMADO', async () => {
    const adapter = new DestaxaRealAdapter({}, { executionMode: 'in-process', nativeLoader: {}, resolver: {} });
    const r = await adapter.cancelarPagamento(
      { transacao_id: 15, nsu: 'NSU4', autorizacao: 'AUT4' },
      {
        resultadoProvedorSimulado: {
          sucesso: true,
          codigoDestaxa: '00',
          classificacao: 'SUCCESS',
          confirmadoPeloProvedor: true,
          mensagem: 'estorno ok mock'
        }
      }
    );
    assert.strictEqual(r.cancelOutcome, politica.OUTCOMES.CONFIRMADO);
    assert.strictEqual(r.cancelConfirmed, true);
    assert.strictEqual(r.sucesso, true);
    assert.strictEqual(r.status, tefContrato.STATUS.CANCELADO);
    assert.strictEqual(r.financialState, 'CANCELLED');
    assert.strictEqual(tefContrato.cancelamentoConfirmado(r), true);
  });

  await test('criarRespostaCancelamento com cancelConfirmed=false nunca afirma cancelado', () => {
    const r = tefContrato.criarRespostaCancelamento({
      sucesso: true,
      status: tefContrato.STATUS.CANCELADO,
      cancelConfirmed: false,
      mensagem: 'falso positivo bloqueado'
    });
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(r.cancelConfirmed, false);
    assert.notStrictEqual(r.status, tefContrato.STATUS.CANCELADO);
    assert.strictEqual(r.financialState, 'UNCHANGED');
  });

  await test('TefManager: cancelamento não confirmado preserva status aprovado', async () => {
    const { dir, dbPath, db } = await criarDbIsolado();
    const prevDbDir = process.env.DB_DIR;
    const prevDbPath = process.env.DB_PATH;

    // Isola database.js se usado — aqui mockamos via monkeypatch do require cache
    const databaseModulePath = require.resolve('../../backend/database');
    const originalDatabase = require.cache[databaseModulePath];

    const fakeDb = db;
    require.cache[databaseModulePath] = {
      id: databaseModulePath,
      filename: databaseModulePath,
      loaded: true,
      exports: fakeDb
    };

    const tefRepositoryPath = require.resolve('../../backend/services/tef/tefRepository');
    const originalRepo = require.cache[tefRepositoryPath];
    require.cache[tefRepositoryPath] = {
      id: tefRepositoryPath,
      filename: tefRepositoryPath,
      loaded: true,
      exports: {
        registrarLog() { /* noop isolado */ },
        criarTransacao() {},
        criarTransacaoExclusiva() {},
        listarTransacoesPendentes() {},
        atualizarTransacao() {},
        registrarAcesso() {}
      }
    };

    const tefFactoryPath = require.resolve('../../backend/services/tef/tefFactory');
    const originalFactory = require.cache[tefFactoryPath];
    const adapterFake = {
      async cancelarPagamento() {
        return politica.responderCancelamentoSeguro({
          transacao_id: 1,
          nsu: 'N',
          autorizacao: 'A'
        });
      }
    };
    require.cache[tefFactoryPath] = {
      id: tefFactoryPath,
      filename: tefFactoryPath,
      loaded: true,
      exports: {
        obterAdapter: async () => adapterFake,
        resetAdapter: () => {}
      }
    };

    // Recarrega TefManager com deps isoladas
    const tefManagerPath = require.resolve('../../backend/services/tef/TefManager');
    delete require.cache[tefManagerPath];
    const TefManager = require('../../backend/services/tef/TefManager');

    await new Promise((resolve, reject) => {
      fakeDb.run(
        `INSERT INTO tef_transacoes (id, status, nsu, autorizacao) VALUES (1, 'aprovado', 'N', 'A')`,
        (err) => (err ? reject(err) : resolve())
      );
    });

    const manager = typeof TefManager === 'function' ? new TefManager() : TefManager;
    const cancelar = manager.cancelar ? manager.cancelar.bind(manager) : TefManager.cancelar.bind(TefManager);
    const resultado = await cancelar(1, 'teste tef-17');

    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.cancelConfirmed, false);
    assert.strictEqual(resultado.financialState, 'UNCHANGED');

    const row = await new Promise((resolve, reject) => {
      fakeDb.get('SELECT status FROM tef_transacoes WHERE id = 1', (err, r) => {
        if (err) return reject(err);
        resolve(r);
      });
    });
    assert.strictEqual(row.status, 'aprovado', 'status financeiro não pode virar cancelado/erro');

    // restore
    if (originalDatabase) require.cache[databaseModulePath] = originalDatabase;
    else delete require.cache[databaseModulePath];
    if (originalRepo) require.cache[tefRepositoryPath] = originalRepo;
    else delete require.cache[tefRepositoryPath];
    if (originalFactory) require.cache[tefFactoryPath] = originalFactory;
    else delete require.cache[tefFactoryPath];
    delete require.cache[tefManagerPath];

    fakeDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (prevDbDir === undefined) delete process.env.DB_DIR; else process.env.DB_DIR = prevDbDir;
    if (prevDbPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = prevDbPath;
  });

  await test('regressão: mapear timeout nunca vira CONFIRMADO', () => {
    const m = politica.mapearResultadoProvedor({ timeout: true });
    assert.strictEqual(m.outcome, politica.OUTCOMES.TIMEOUT);
    assert.strictEqual(m.cancelConfirmed, false);
  });

  console.log('\nTEF-17 testes OK — sem INIT / sem TX real / banco oficial intacto.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
