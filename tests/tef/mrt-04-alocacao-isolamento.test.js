'use strict';

/**
 * MRT-04 — Alocação e isolamento (sem INIT/TX/migration oficial).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  criarTerminalAllocator,
  resetTerminalAllocatorParaTestes,
  ALLOCATION_CODES,
  RELEASE_REASONS,
  politicaIsolamento
} = require('../../backend/services/tef/terminalAllocator');

const {
  criarTerminalRegistry,
  resetTerminalRegistryParaTestes,
  TERMINAL_STATES
} = require('../../backend/services/tef/terminalRegistry');

const {
  criarTerminalRouter,
  resetTerminalRouterParaTestes,
  criarPdvIdentityValidator,
  ROUTE_CODES,
  MODOS_ROUTER
} = require('../../backend/services/tef/terminalRouter');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt04-'));
  const db = new sqlite3.Database(path.join(dir, 't.db'));
  await new Promise((resolve, reject) => {
    db.exec(`
      CREATE TABLE caixas (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER DEFAULT 1);
      CREATE TABLE terminais (
        id INTEGER PRIMARY KEY, nome TEXT, hostname TEXT, caixa_id INTEGER, ativo INTEGER DEFAULT 1
      );
      INSERT INTO caixas VALUES (10, 'C1', 1);
      INSERT INTO terminais VALUES (1, 'PDV1', 'H1', 10, 1);
      INSERT INTO terminais VALUES (2, 'PDV2', 'H2', 10, 1);
    `, (err) => (err ? reject(err) : resolve()));
  });
  const getRow = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
  return { dir, db, getRow };
}

console.log('=== MRT-04 — Alocação e isolamento ===\n');

(async () => {
  resetTerminalAllocatorParaTestes();
  resetTerminalRegistryParaTestes();
  resetTerminalRouterParaTestes();

  const { dir, db, getRow } = await criarDb();
  const identity = criarPdvIdentityValidator({ getRow });
  const registry = criarTerminalRegistry();
  const allocator = criarTerminalAllocator({ ocupacaoTimeoutMs: 5000 });

  registry.registrar({
    id: 'tef-a',
    pdvId: '1',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    codigoLogicoProvedor: 'TA',
    dispositivo: { id: 'dev-a', tipo: 'pinpad', portaCom: 'COM1' }
  });
  registry.registrar({
    id: 'tef-b',
    pdvId: '2',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    codigoLogicoProvedor: 'TB',
    dispositivo: { id: 'dev-b', tipo: 'pinpad', portaCom: 'COM2' }
  });
  registry.registrar({
    id: 'tef-sitef-1',
    pdvId: '1',
    provedor: 'sitef',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'dev-s1', tipo: 'pinpad', portaCom: 'COM3' }
  });
  // Remover ambiguidade destaxa+sitef no PDV1: testes Destaxa usam provedorPreferido

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

  const router = criarTerminalRouter({
    identityValidator: identity,
    registry,
    allocator,
    carregarBindingSingleton: async () => bindingOk
  });

  await test('política Destaxa = GLOBAL_SERIALIZE', () => {
    const p = politicaIsolamento('destaxa');
    assert.strictEqual(p.modo, 'GLOBAL_SERIALIZE');
    assert.strictEqual(p.runtimeKey, 'runtime:destaxa:global');
    assert.strictEqual(p.permiteTerminaisParalelos, false);
  });

  await test('dois PDVs — mesmo terminal → TERMINAL_OCUPADO', async () => {
    allocator.resetParaTestes();
    const a1 = allocator.adquirir({ terminalTefId: 'tef-a', pdvId: '1', provedor: 'sitef' });
    assert.strictEqual(a1.ok, true);
    const a2 = allocator.adquirir({ terminalTefId: 'tef-a', pdvId: '2', provedor: 'sitef' });
    assert.strictEqual(a2.ok, false);
    assert.strictEqual(a2.codigo, ALLOCATION_CODES.TERMINAL_OCUPADO);
    assert.strictEqual(a2.conflito.tipo, 'TERMINAL');
    allocator.liberar(a1.lease.leaseId, RELEASE_REASONS.SUCESSO_CONFIRMADO);
  });

  await test('dois PDVs — terminais diferentes + Destaxa → RUNTIME_OCUPADO', async () => {
    allocator.resetParaTestes();
    const a1 = allocator.adquirir({ terminalTefId: 'tef-a', pdvId: '1', provedor: 'destaxa' });
    assert.strictEqual(a1.ok, true);
    assert.ok(a1.lease.runtimeKey);
    const a2 = allocator.adquirir({ terminalTefId: 'tef-b', pdvId: '2', provedor: 'destaxa' });
    assert.strictEqual(a2.ok, false);
    assert.strictEqual(a2.codigo, ALLOCATION_CODES.RUNTIME_OCUPADO);
    assert.strictEqual(a2.conflito.tipo, 'RUNTIME');
    allocator.liberar(a1.lease.leaseId, RELEASE_REASONS.FALHA_CONFIRMADA);
  });

  await test('dois PDVs — terminais diferentes + SiTef → ambos alocam', async () => {
    allocator.resetParaTestes();
    // cadastrar sitef no pdv2
    registry.registrar({
      id: 'tef-sitef-2',
      pdvId: '2',
      provedor: 'sitef',
      ambiente: 'homologacao',
      estado: TERMINAL_STATES.ATIVO,
      dispositivo: { id: 'dev-s2', tipo: 'pinpad', portaCom: 'COM4' }
    });
    const a1 = allocator.adquirir({ terminalTefId: 'tef-sitef-1', pdvId: '1', provedor: 'sitef' });
    const a2 = allocator.adquirir({ terminalTefId: 'tef-sitef-2', pdvId: '2', provedor: 'sitef' });
    assert.strictEqual(a1.ok, true);
    assert.strictEqual(a2.ok, true);
    assert.strictEqual(a1.lease.runtimeKey, null);
    allocator.liberar(a1.lease.leaseId, RELEASE_REASONS.SUCESSO_CONFIRMADO);
    allocator.liberar(a2.lease.leaseId, RELEASE_REASONS.SUCESSO_CONFIRMADO);
  });

  await test('runtime singleton ocupado vs terminal ocupado (diferenciação)', async () => {
    allocator.resetParaTestes();
    const a1 = allocator.adquirir({ terminalTefId: 'tef-a', provedor: 'destaxa', pdvId: '1' });
    const stT = allocator.statusTerminal('tef-a');
    const stR = allocator.statusRuntime('runtime:destaxa:global');
    assert.strictEqual(stT.ocupado, true);
    assert.strictEqual(stT.tipo, 'TERMINAL');
    assert.strictEqual(stR.ocupado, true);
    assert.strictEqual(stR.tipo, 'RUNTIME');
    const stOutro = allocator.statusTerminal('tef-b');
    assert.strictEqual(stOutro.ocupado, false);
    allocator.liberar(a1.lease.leaseId, RELEASE_REASONS.SUCESSO_CONFIRMADO);
  });

  await test('timeout com operação inconclusiva NÃO libera', async () => {
    let agora = 1_000_000;
    const alloc = criarTerminalAllocator({
      ocupacaoTimeoutMs: 1000,
      now: () => agora
    });
    const a1 = alloc.adquirir({ terminalTefId: 'tef-x', provedor: 'sitef' });
    assert.strictEqual(a1.ok, true);
    alloc.marcarInconclusivo(a1.lease.leaseId);
    agora += 5000;
    const st = alloc.statusTerminal('tef-x');
    assert.strictEqual(st.ocupado, true, 'inconclusiva sobrevive ao timeout de ocupação');
    const libTimeout = alloc.liberar(a1.lease.leaseId, RELEASE_REASONS.TIMEOUT_OCUPACAO);
    assert.strictEqual(libTimeout.codigo, ALLOCATION_CODES.LIBERACAO_BLOQUEADA_INCONCLUSIVA);
    const libOk = alloc.liberar(a1.lease.leaseId, RELEASE_REASONS.FALHA_CONFIRMADA);
    // ainda bloqueado — precisa FORCAR ou resultado confirmado after clearing flag
    assert.strictEqual(libOk.codigo, ALLOCATION_CODES.LIBERACAO_BLOQUEADA_INCONCLUSIVA);
    const forcar = alloc.liberar(a1.lease.leaseId, RELEASE_REASONS.FORCAR_ADMIN);
    assert.strictEqual(forcar.ok, true);
  });

  await test('liberação após resultado confirmado', async () => {
    allocator.resetParaTestes();
    const a1 = allocator.adquirir({ terminalTefId: 'tef-a', provedor: 'sitef' });
    const lib = allocator.liberar(a1.lease.leaseId, RELEASE_REASONS.SUCESSO_CONFIRMADO);
    assert.strictEqual(lib.ok, true);
    assert.strictEqual(allocator.statusTerminal('tef-a').ocupado, false);
  });

  await test('falha durante aquisição (parâmetro inválido)', () => {
    allocator.resetParaTestes();
    const r = allocator.adquirir({ provedor: 'destaxa' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, ALLOCATION_CODES.PARAMETRO_INVALIDO);
  });

  await test('tentativa de liberação duplicada', () => {
    allocator.resetParaTestes();
    const a1 = allocator.adquirir({ terminalTefId: 'tef-a', provedor: 'sitef' });
    assert.strictEqual(allocator.liberar(a1.lease.leaseId, RELEASE_REASONS.SUCESSO_CONFIRMADO).ok, true);
    const dup = allocator.liberar(a1.lease.leaseId, RELEASE_REASONS.SUCESSO_CONFIRMADO);
    assert.strictEqual(dup.ok, false);
    assert.strictEqual(dup.codigo, ALLOCATION_CODES.LEASE_JA_LIBERADO);
  });

  await test('recuperação de lock após reinicialização', () => {
    allocator.resetParaTestes();
    allocator.adquirir({ terminalTefId: 'tef-a', provedor: 'destaxa', pdvId: '1' });
    assert.strictEqual(allocator.statusTerminal('tef-a').ocupado, true);
    const rec = allocator.recuperarAposReinicio();
    assert.strictEqual(rec.ok, true);
    assert.ok(rec.liberados >= 1);
    assert.strictEqual(allocator.statusTerminal('tef-a').ocupado, false);
    assert.strictEqual(allocator.statusRuntime('runtime:destaxa:global').ocupado, false);
  });

  await test('Router allocate=true — Destaxa serializa PDVs distintos', async () => {
    allocator.resetParaTestes();
    const d1 = await router.resolve({
      pdvId: 1,
      provedorPreferido: 'destaxa',
      allocate: true,
      operacao: 'autorizar'
    });
    assert.strictEqual(d1.sucesso, true);
    assert.strictEqual(d1.isolamento.alocacaoAtiva, true);
    assert.ok(d1.isolamento.leaseId);
    assert.strictEqual(d1.modo, MODOS_ROUTER.ALLOCATE);

    const d2 = await router.resolve({
      pdvId: 2,
      provedorPreferido: 'destaxa',
      allocate: true
    });
    assert.strictEqual(d2.sucesso, false);
    assert.strictEqual(d2.codigo, ROUTE_CODES.RUNTIME_OCUPADO);

    router.liberarAlocacao(d1.isolamento.leaseId, RELEASE_REASONS.SUCESSO_CONFIRMADO);
  });

  await test('Router sem allocate — TefManager path inalterado (sem lease)', async () => {
    allocator.resetParaTestes();
    const d = await router.resolve({ pdvId: 1, provedorPreferido: 'destaxa' });
    assert.strictEqual(d.sucesso, true);
    assert.strictEqual(d.isolamento.alocacaoAtiva, false);
    assert.ok(!d.isolamento.leaseId);
  });

  await test('ambiguidade Registry permanece (sem seleção arbitrária)', async () => {
    // PDV1 tem destaxa + sitef ativos
    const d = await router.resolve({ pdvId: 1, allocate: true });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.TERMINAL_AMBIGUO);
  });

  await test('TefManager integra allocate via tefRouterIntegration (MRT-06)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/TefManager.js'),
      'utf8'
    );
    // MRT-06: allocate não é literal no TefManager — fica em tefRouterIntegration
    assert.ok(!/allocate:\s*true/.test(src));
    assert.match(src, /tefRouterIntegration/);
    assert.match(src, /resolverRotaAutorizacao|fecharLeaseTerminal/);
    const integ = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/tefRouterIntegration.js'),
      'utf8'
    );
    assert.match(integ, /allocate/);
    assert.match(integ, /obterTerminalRouter|router\.resolve/);
  });

  await test('adapters / TEF-13/14/15/17 não alterados nesta sprint (escopo)', () => {
    assert.ok(!fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'),
      'utf8'
    ).includes('terminalAllocator'));
    assert.ok(!fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/destaxa/destaxaCancelamentoPolitica.js'),
      'utf8'
    ).includes('terminalAllocator'));
  });

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  resetTerminalAllocatorParaTestes();
  resetTerminalRegistryParaTestes();
  resetTerminalRouterParaTestes();

  console.log('\nMRT-04 testes OK — sem INIT / TX / migration.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
