'use strict';

/**
 * MRT-06 — Integração controlada Router ↔ TefManager (sem INIT/TX real/migration).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const integ = require('../../backend/services/tef/tefRouterIntegration');
const tefContrato = require('../../backend/services/tef/tefContrato');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');

const {
  criarTerminalRegistry,
  resetTerminalRegistryParaTestes,
  TERMINAL_STATES
} = require('../../backend/services/tef/terminalRegistry');

const {
  criarTerminalAllocator,
  resetTerminalAllocatorParaTestes,
  ALLOCATION_CODES,
  RELEASE_REASONS
} = require('../../backend/services/tef/terminalAllocator');

const {
  criarTerminalRouter,
  resetTerminalRouterParaTestes,
  criarPdvIdentityValidator,
  ROUTE_CODES
} = require('../../backend/services/tef/terminalRouter');

const {
  resetExecutionContextResolverParaTestes,
  LOCALIDADE_EXECUCAO,
  TOPOLOGIES
} = require('../../backend/services/tef/executionContext');

function test(nome, fn) {
  const ret = fn();
  if (ret && typeof ret.then === 'function') {
    return ret.then(() => console.log(`  OK  ${nome}`)).catch((err) => {
      console.error(`  FAIL ${nome}`);
      throw err;
    });
  }
  console.log(`  OK  ${nome}`);
  return Promise.resolve();
}

async function criarDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt06-'));
  const db = new sqlite3.Database(path.join(dir, 't.db'));
  await new Promise((resolve, reject) => {
    db.exec(`
      CREATE TABLE caixas (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER DEFAULT 1);
      CREATE TABLE terminais (
        id INTEGER PRIMARY KEY, nome TEXT, hostname TEXT, caixa_id INTEGER, ativo INTEGER DEFAULT 1
      );
      INSERT INTO caixas VALUES (10, 'C1', 1);
      INSERT INTO terminais VALUES (1, 'PDV1', 'PC-A', 10, 1);
      INSERT INTO terminais VALUES (2, 'PDV2', 'PC-A', 10, 1);
      INSERT INTO terminais VALUES (3, 'PDV3', 'PC-B', 10, 1);
    `, (err) => (err ? reject(err) : resolve()));
  });
  const getRow = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
  const getAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  return { dir, db, getRow, getAll };
}

console.log('=== MRT-06 — Integração TefManager ===\n');

(async () => {
  resetTerminalRegistryParaTestes();
  resetTerminalAllocatorParaTestes();
  resetTerminalRouterParaTestes();
  resetExecutionContextResolverParaTestes();

  const { dir, db, getRow, getAll } = await criarDb();
  const identity = criarPdvIdentityValidator({ getRow });
  const registry = criarTerminalRegistry();
  const allocator = criarTerminalAllocator();

  registry.registrar({
    id: 'tef-1',
    pdvId: '1',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'dev-1', tipo: 'pinpad', portaCom: 'COM1', ativo: true },
    meta: { estacaoHostname: 'PC-A' }
  });
  registry.registrar({
    id: 'tef-2',
    pdvId: '2',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'dev-2', tipo: 'pinpad', portaCom: 'COM2', ativo: true },
    meta: { estacaoHostname: 'PC-A' }
  });
  registry.registrar({
    id: 'tef-3',
    pdvId: '3',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'dev-3', tipo: 'pinpad', portaCom: 'COM1', ativo: true },
    meta: { estacaoHostname: 'PC-B' }
  });
  registry.registrar({
    id: 'tef-off',
    pdvId: '1',
    provedor: 'sitef',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'dev-off', tipo: 'pinpad', portaCom: 'COM9', ativo: false },
    meta: { estacaoHostname: 'PC-A' }
  });

  const bindingOk = {
    ok: true,
    mensagem: 'mock',
    config: {},
    adapterBinding: {
      fonte: 'tef_configuracao_singleton',
      modo: 'COMPAT_SINGLETON',
      registro: { provedor: 'destaxa', ambiente: 'homologacao' },
      executionMode: 'native-host'
    }
  };

  const mapa = [
    { pdvId: '1', hostname: 'PC-A' },
    { pdvId: '2', hostname: 'PC-A' },
    { pdvId: '3', hostname: 'PC-B' }
  ];

  const router = criarTerminalRouter({
    identityValidator: identity,
    registry,
    allocator,
    carregarBindingSingleton: async () => bindingOk,
    mapaPdvEstacao: mapa
  });

  await test('fluxo COMPAT_SINGLETON (pdvId omitido) + allocate', async () => {
    allocator.resetParaTestes();
    const rota = await integ.resolverRotaAutorizacao({}, {
      router,
      mapaPdvEstacao: mapa
    });
    assert.strictEqual(rota.sucesso, true);
    assert.ok(rota.routeDecision.modo === 'ALLOCATE' || rota.routeDecision.sucesso);
    assert.ok(rota.leaseId);
    assert.ok(
      rota.routeDecision.codigo === ROUTE_CODES.SINGLETON_FALLBACK
      || rota.routeDecision.modo === 'ALLOCATE'
    );
    integ.aplicarPosAutorizacao(rota.leaseId, {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.SUCESSO_CONFIRMADO
    }, { router });
  });

  await test('PDV com terminal lógico resolvido', async () => {
    allocator.resetParaTestes();
    const rota = await integ.resolverRotaAutorizacao({
      pdvId: 1,
      provedorPreferido: 'destaxa',
      hostname: 'PC-A'
    }, { router, mapaPdvEstacao: mapa });
    assert.strictEqual(rota.sucesso, true);
    assert.strictEqual(rota.routeDecision.terminalTefId, 'tef-1');
    assert.ok(rota.leaseId);
    assert.ok(rota.routeDecision.executionContext);
    // Mapa da instalação inclui PC-B → MULTI_ESTACAO; execução local em PC-A
    assert.ok(
      rota.routeDecision.executionContext.topologia === TOPOLOGIES.MULTI_ESTACAO
      || rota.routeDecision.executionContext.topologia === TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV
    );
    assert.strictEqual(
      rota.routeDecision.executionContext.localidadeExecucao,
      LOCALIDADE_EXECUCAO.LOCAL
    );
    integ.aplicarPosAutorizacao(rota.leaseId, {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.FALHA_CONFIRMADA
    }, { router });
  });

  await test('PDV sem cadastro no Registry → fallback singleton + lease', async () => {
    allocator.resetParaTestes();
    // PDV 3 tem registry — use id inexistente? PDV válido sem terminal: criar PDV 99
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO terminais VALUES (99, 'PDV99', 'PC-A', 10, 1)`,
        (err) => (err ? reject(err) : resolve())
      );
    });
    const rota = await integ.resolverRotaAutorizacao({
      pdvId: 99,
      hostname: 'PC-A'
    }, { router, mapaPdvEstacao: [...mapa, { pdvId: '99', hostname: 'PC-A' }] });
    assert.strictEqual(rota.sucesso, true);
    assert.ok(
      rota.routeDecision.codigo === ROUTE_CODES.ROUTE_OK
      || rota.routeDecision.modo === 'ALLOCATE'
    );
    assert.ok(rota.leaseId);
    integ.aplicarPosAutorizacao(rota.leaseId, {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.SUCESSO_CONFIRMADO
    }, { router });
  });

  await test('terminal ocupado', async () => {
    allocator.resetParaTestes();
    const a = await integ.resolverRotaAutorizacao({
      pdvId: 1,
      provedorPreferido: 'destaxa',
      hostname: 'PC-A'
    }, { router, mapaPdvEstacao: mapa });
    assert.strictEqual(a.sucesso, true);
    const b = await integ.resolverRotaAutorizacao({
      pdvId: 1,
      provedorPreferido: 'destaxa',
      hostname: 'PC-A'
    }, { router, mapaPdvEstacao: mapa });
    assert.strictEqual(b.sucesso, false);
    assert.ok(
      b.routeDecision.codigo === ROUTE_CODES.TERMINAL_OCUPADO
      || b.routeDecision.codigo === ROUTE_CODES.RUNTIME_OCUPADO
    );
    integ.aplicarPosAutorizacao(a.leaseId, {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.SUCESSO_CONFIRMADO
    }, { router });
  });

  await test('runtime Destaxa ocupado (PDVs distintos, mesma estação)', async () => {
    allocator.resetParaTestes();
    const a = await integ.resolverRotaAutorizacao({
      pdvId: 1,
      provedorPreferido: 'destaxa',
      hostname: 'PC-A'
    }, { router, mapaPdvEstacao: mapa });
    const b = await integ.resolverRotaAutorizacao({
      pdvId: 2,
      provedorPreferido: 'destaxa',
      hostname: 'PC-A'
    }, { router, mapaPdvEstacao: mapa });
    assert.strictEqual(a.sucesso, true);
    assert.strictEqual(b.sucesso, false);
    assert.strictEqual(b.routeDecision.codigo, ROUTE_CODES.RUNTIME_OCUPADO);
    integ.aplicarPosAutorizacao(a.leaseId, {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.FALHA_CONFIRMADA
    }, { router });
  });

  await test('dispositivo indisponível', async () => {
    allocator.resetParaTestes();
    const rota = await integ.resolverRotaAutorizacao({
      pdvId: 1,
      provedorPreferido: 'sitef',
      hostname: 'PC-A'
    }, { router, mapaPdvEstacao: mapa });
    assert.strictEqual(rota.sucesso, false);
    assert.strictEqual(rota.routeDecision.codigo, ROUTE_CODES.DISPOSITIVO_INDISPONIVEL);
    assert.ok(!rota.leaseId);
  });

  await test('topologia REMOTA_REQUERIDA bloqueada', async () => {
    allocator.resetParaTestes();
    const rota = await integ.resolverRotaAutorizacao({
      pdvId: 3,
      provedorPreferido: 'destaxa',
      hostname: 'PC-A'
    }, { router, mapaPdvEstacao: mapa });
    assert.strictEqual(rota.sucesso, false);
    assert.strictEqual(rota.routeDecision.codigo, ROUTE_CODES.ESTACAO_REMOTA_NAO_SUPORTADA);
    assert.ok(
      !rota.leaseId
      || allocator.statusTerminal('tef-3').ocupado === false
    );
  });

  await test('classificar: timeout/inconclusivo NÃO libera', () => {
    const cls = integ.classificarPosAutorizacao({
      sucesso: false,
      status: tefContrato.STATUS.PENDENTE,
      codigo: 'TIMEOUT',
      financialState: FINANCIAL_STATES.UNKNOWN
    }, { transacaoId: 42, forcarInconclusivo: true });
    assert.strictEqual(cls.acao, 'MARCAR_INCONCLUSIVO');
  });

  await test('liberação após resultado confirmado + inconclusivo bloqueia', () => {
    allocator.resetParaTestes();
    const a1 = allocator.adquirir({ terminalTefId: 'tef-x', provedor: 'destaxa', pdvId: '1' });
    const clsOk = integ.classificarPosAutorizacao({
      sucesso: true,
      status: tefContrato.STATUS.APROVADO
    }, { transacaoId: 1 });
    assert.strictEqual(clsOk.acao, 'LIBERAR');
    const lib = integ.aplicarPosAutorizacao(a1.lease.leaseId, clsOk, { router });
    assert.strictEqual(lib.ok, true);

    const a2 = allocator.adquirir({ terminalTefId: 'tef-y', provedor: 'sitef', pdvId: '1' });
    allocator.marcarInconclusivo(a2.lease.leaseId);
    const clsInc = integ.classificarPosAutorizacao({
      sucesso: false,
      status: tefContrato.STATUS.PENDENTE,
      codigo: 'TEF_UNKNOWN'
    }, { transacaoId: 9, forcarInconclusivo: true });
    const bloq = integ.aplicarPosAutorizacao(a2.lease.leaseId, {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.TIMEOUT_OCUPACAO
    }, { router });
    // liberar com TIMEOUT em inconclusivo → bloqueado pelo allocator
    assert.strictEqual(bloq.ok, false);
    assert.strictEqual(bloq.codigo, ALLOCATION_CODES.LIBERACAO_BLOQUEADA_INCONCLUSIVA);
    // marca inconclusivo (já marcado) ok
    integ.aplicarPosAutorizacao(a2.lease.leaseId, clsInc, { router });
    allocator.liberar(a2.lease.leaseId, RELEASE_REASONS.FORCAR_ADMIN);
  });

  await test('falha durante aquisição (allocate) — sem lease', async () => {
    allocator.resetParaTestes();
    // Ocupa runtime Destaxa antes
    allocator.adquirir({ terminalTefId: 'tef-holder', provedor: 'destaxa', pdvId: '9' });
    const rota = await integ.resolverRotaAutorizacao({
      pdvId: 1,
      provedorPreferido: 'destaxa',
      hostname: 'PC-A'
    }, { router, mapaPdvEstacao: mapa });
    assert.strictEqual(rota.sucesso, false);
    assert.ok(!rota.leaseId);
    assert.strictEqual(rota.routeDecision.codigo, ROUTE_CODES.RUNTIME_OCUPADO);
    allocator.resetParaTestes();
  });

  await test('carregarMapaPdvEstacao read-only', async () => {
    const m = await integ.carregarMapaPdvEstacao({ getAll });
    assert.ok(m.some((x) => x.pdvId === '1' && x.hostname === 'PC-A'));
    assert.ok(m.some((x) => x.pdvId === '3' && x.hostname === 'PC-B'));
  });

  await test('TefManager usa tefRouterIntegration (estático)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/TefManager.js'),
      'utf8'
    );
    assert.match(src, /tefRouterIntegration/);
    assert.match(src, /resolverRotaAutorizacao/);
    assert.match(src, /fecharLeaseTerminal/);
    assert.match(src, /classificarPosAutorizacao/);
    // lock financeiro TEF-13 preservado
    assert.match(src, /idempotency_key/);
    assert.match(src, /tefLockService\.comLock/);
    // não reescreve adapters
    assert.ok(!src.includes('DestaxaRealAdapter'));
  });

  await test('pedido de autorização força allocate + exigirExecucaoLocal', () => {
    const p = integ.montarPedidoAutorizacao({ pdvId: 1, hostname: 'H' });
    assert.strictEqual(p.allocate, true);
    assert.strictEqual(p.exigirExecucaoLocal, true);
    assert.strictEqual(p.operacao, 'autorizar');
  });

  await test('REMOTA no executionContext reconhecida', () => {
    assert.strictEqual(LOCALIDADE_EXECUCAO.REMOTA_REQUERIDA, 'REMOTA_REQUERIDA');
  });

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  resetTerminalRegistryParaTestes();
  resetTerminalAllocatorParaTestes();
  resetTerminalRouterParaTestes();
  resetExecutionContextResolverParaTestes();

  console.log('\nMRT-06 testes OK — sem INIT / TX real / migration.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
