'use strict';

/**
 * MRT-05 — Topologias de execução e ExecutionContext (sem INIT/TX/migration).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  criarExecutionContextResolver,
  resetExecutionContextResolverParaTestes,
  inferirTopologia,
  TOPOLOGIES,
  LOCALIDADE_EXECUCAO,
  EXEC_CODES,
  matrizProvedor,
  chaveEstacao
} = require('../../backend/services/tef/executionContext');

const {
  criarTerminalRegistry,
  resetTerminalRegistryParaTestes,
  TERMINAL_STATES
} = require('../../backend/services/tef/terminalRegistry');

const {
  criarTerminalAllocator,
  resetTerminalAllocatorParaTestes
} = require('../../backend/services/tef/terminalAllocator');

const {
  criarTerminalRouter,
  resetTerminalRouterParaTestes,
  criarPdvIdentityValidator,
  ROUTE_CODES
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt05-'));
  const db = new sqlite3.Database(path.join(dir, 't.db'));
  await new Promise((resolve, reject) => {
    db.exec(`
      CREATE TABLE caixas (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER DEFAULT 1);
      CREATE TABLE terminais (
        id INTEGER PRIMARY KEY, nome TEXT, hostname TEXT, caixa_id INTEGER, ativo INTEGER DEFAULT 1
      );
      INSERT INTO caixas VALUES (10, 'C1', 1);
      INSERT INTO terminais VALUES (1, 'PDV1', 'PC-LOJA-A', 10, 1);
      INSERT INTO terminais VALUES (2, 'PDV2', 'PC-LOJA-A', 10, 1);
      INSERT INTO terminais VALUES (3, 'PDV3', 'PC-LOJA-B', 10, 1);
      INSERT INTO terminais VALUES (4, 'PDV4', NULL, 10, 1);
    `, (err) => (err ? reject(err) : resolve()));
  });
  const getRow = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
  return { dir, db, getRow };
}

console.log('=== MRT-05 — Topologias e ExecutionContext ===\n');

(async () => {
  resetExecutionContextResolverParaTestes();
  resetTerminalRegistryParaTestes();
  resetTerminalAllocatorParaTestes();
  resetTerminalRouterParaTestes();

  const { dir, db, getRow } = await criarDb();
  const identity = criarPdvIdentityValidator({ getRow });
  const registry = criarTerminalRegistry();
  const allocator = criarTerminalAllocator();
  const resolver = criarExecutionContextResolver();

  registry.registrar({
    id: 'tef-1',
    pdvId: '1',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'dev-1', tipo: 'pinpad', portaCom: 'COM1', ativo: true },
    meta: { estacaoHostname: 'PC-LOJA-A' }
  });
  registry.registrar({
    id: 'tef-2',
    pdvId: '2',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'dev-2', tipo: 'pinpad', portaCom: 'COM2', ativo: true },
    meta: { estacaoHostname: 'PC-LOJA-A' }
  });
  registry.registrar({
    id: 'tef-3',
    pdvId: '3',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'dev-3', tipo: 'pinpad', portaCom: 'COM1', ativo: true },
    meta: { estacaoHostname: 'PC-LOJA-B' }
  });
  registry.registrar({
    id: 'tef-4-sem-dev',
    pdvId: '4',
    provedor: 'sitef',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: null
  });
  registry.registrar({
    id: 'tef-dev-off',
    pdvId: '1',
    provedor: 'sitef',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'dev-off', tipo: 'pinpad', portaCom: 'COM9', ativo: false },
    meta: { estacaoHostname: 'PC-LOJA-A' }
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

  const mapaMultiPdv = [
    { pdvId: '1', hostname: 'PC-LOJA-A' },
    { pdvId: '2', hostname: 'PC-LOJA-A' }
  ];
  const mapaMultiEstacao = [
    { pdvId: '1', hostname: 'PC-LOJA-A' },
    { pdvId: '3', hostname: 'PC-LOJA-B' }
  ];

  const router = criarTerminalRouter({
    identityValidator: identity,
    registry,
    allocator,
    carregarBindingSingleton: async () => bindingOk,
    mapaPdvEstacao: mapaMultiPdv
  });

  await test('contrato: identidades separadas no ExecutionContext', () => {
    const r = resolver.resolver({
      pdvId: '1',
      pdv: { hostname: 'PC-LOJA-A' },
      hostHints: { hostname: 'PC-LOJA-A' },
      terminalTefId: 'tef-1',
      dispositivo: { id: 'dev-1', ativo: true },
      provedor: 'destaxa',
      mapaPdvEstacao: [{ pdvId: '1', hostname: 'PC-LOJA-A' }]
    });
    const ctx = r.executionContext;
    assert.strictEqual(ctx.pdvId, '1');
    assert.strictEqual(ctx.terminalTefId, 'tef-1');
    assert.strictEqual(ctx.dispositivoId, 'dev-1');
    assert.strictEqual(ctx.estacao.identidadeEhPdv, false);
    assert.ok(ctx.estacao.id);
    assert.notStrictEqual(ctx.estacao.id, ctx.pdvId);
    assert.strictEqual(ctx.identidades.comercial.includes('pdvId'), true);
  });

  await test('uma estação / um PDV', () => {
    const topo = inferirTopologia([{ pdvId: '1', hostname: 'PC-A' }], '1');
    assert.strictEqual(topo.topologia, TOPOLOGIES.ESTACAO_UNICA_PDV_UNICO);
    const r = resolver.resolver({
      pdvId: '1',
      pdv: { hostname: 'PC-A' },
      hostHints: { hostname: 'PC-A' },
      terminalTefId: 't1',
      dispositivo: { id: 'd1', ativo: true },
      provedor: 'destaxa',
      mapaPdvEstacao: [{ pdvId: '1', hostname: 'PC-A' }]
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.executionContext.topologia, TOPOLOGIES.ESTACAO_UNICA_PDV_UNICO);
    assert.strictEqual(r.executionContext.localidadeExecucao, LOCALIDADE_EXECUCAO.LOCAL);
    assert.strictEqual(r.executionContext.codigo, EXEC_CODES.EXEC_OK);
  });

  await test('uma estação / múltiplos PDVs', () => {
    const topo = inferirTopologia(mapaMultiPdv);
    assert.strictEqual(topo.topologia, TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV);
    const r = resolver.resolver({
      pdvId: '1',
      pdv: { hostname: 'PC-LOJA-A' },
      hostHints: { hostname: 'PC-LOJA-A' },
      provedor: 'destaxa',
      dispositivo: { id: 'dev-1', ativo: true },
      terminalTefId: 'tef-1',
      mapaPdvEstacao: mapaMultiPdv
    });
    assert.strictEqual(r.executionContext.topologia, TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV);
    assert.strictEqual(r.executionContext.runtime.singletonDestaxa, true);
    assert.ok(r.executionContext.limitacoes.some((l) => l.codigo === 'SERIALIZACAO_GLOBAL_OBRIGATORIA'));
  });

  await test('múltiplas estações', () => {
    const topo = inferirTopologia(mapaMultiEstacao);
    assert.strictEqual(topo.topologia, TOPOLOGIES.MULTI_ESTACAO);
    const r = resolver.resolver({
      pdvId: '3',
      pdv: { hostname: 'PC-LOJA-B' },
      hostHints: { hostname: 'PC-LOJA-A' },
      provedor: 'destaxa',
      dispositivo: { id: 'dev-3', ativo: true },
      terminalTefId: 'tef-3',
      mapaPdvEstacao: mapaMultiEstacao
    });
    assert.strictEqual(r.executionContext.topologia, TOPOLOGIES.MULTI_ESTACAO);
    assert.strictEqual(r.executionContext.localidadeExecucao, LOCALIDADE_EXECUCAO.REMOTA_REQUERIDA);
    assert.ok(r.executionContext.limitacoes.some(
      (l) => l.codigo === EXEC_CODES.ESTACAO_REMOTA_NAO_SUPORTADA
        || l.codigo === EXEC_CODES.TOPOLOGIA_INCOMPATIVEL_PROVEDOR
    ));
  });

  await test('PDV sem estação vinculada', async () => {
    const d = await router.resolve({
      pdvId: 4,
      provedorPreferido: 'sitef',
      hostHints: { hostname: 'PC-LOJA-A' },
      mapaPdvEstacao: []
    });
    assert.strictEqual(d.sucesso, true, 'fallback/anotação — não bloqueia sem flag');
    assert.ok(d.executionContext);
    assert.strictEqual(d.executionContext.codigo, EXEC_CODES.ESTACAO_NAO_VINCULADA);

    const d2 = await router.resolve({
      pdvId: 4,
      provedorPreferido: 'sitef',
      exigirEstacaoVinculada: true,
      mapaPdvEstacao: []
    });
    assert.strictEqual(d2.sucesso, false);
    assert.strictEqual(d2.codigo, ROUTE_CODES.ESTACAO_NAO_VINCULADA);
  });

  await test('dispositivo indisponível', async () => {
    const r = resolver.resolver({
      pdvId: '1',
      pdv: { hostname: 'PC-LOJA-A' },
      hostHints: { hostname: 'PC-LOJA-A' },
      terminalTefId: 'tef-dev-off',
      dispositivo: { id: 'dev-off', ativo: false },
      provedor: 'sitef',
      mapaPdvEstacao: mapaMultiPdv
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, EXEC_CODES.DISPOSITIVO_INDISPONIVEL);

    const d = await router.resolve({
      pdvId: 1,
      provedorPreferido: 'sitef',
      hostHints: { hostname: 'PC-LOJA-A' }
    });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.DISPOSITIVO_INDISPONIVEL);
  });

  await test('terminal lógico sem dispositivo físico', async () => {
    // PDV4: só tef-4-sem-dev (sitef, sem device)
    const d = await router.resolve({
      pdvId: 4,
      provedorPreferido: 'sitef',
      hostHints: { hostname: 'PC-X' },
      mapaPdvEstacao: [{ pdvId: '4', hostname: 'PC-X' }],
      exigirEstacaoVinculada: false
    });
    // PDV4 hostname null no banco — estação não vinculada no pdv; forçamos mapa
    // Registry HIT sem dispositivo → anota TERMINAL_SEM_DISPOSITIVO (não bloqueia)
    if (d.sucesso) {
      assert.ok(
        d.executionContext.codigo === EXEC_CODES.TERMINAL_SEM_DISPOSITIVO
        || d.executionContext.codigo === EXEC_CODES.ESTACAO_NAO_VINCULADA
      );
      assert.strictEqual(d.dispositivoId, null);
    } else {
      // se exigir implícito de algo — aceitar TERMINAL_SEM_DISPOSITIVO só com flag
      assert.notStrictEqual(d.codigo, ROUTE_CODES.TERMINAL_SEM_DISPOSITIVO);
    }

    const hard = await router.resolve({
      pdvId: 4,
      provedorPreferido: 'sitef',
      mapaPdvEstacao: [{ pdvId: '4', hostname: 'PC-X' }],
      hostHints: { hostname: 'PC-X' },
      exigirDispositivo: true
    });
    assert.strictEqual(hard.sucesso, false);
    assert.strictEqual(hard.codigo, ROUTE_CODES.TERMINAL_SEM_DISPOSITIVO);
  });

  await test('hostname/MAC não confundidos com identidade comercial', async () => {
    const bad = await router.resolve({ pdvId: 'PC-LOJA-A' });
    assert.strictEqual(bad.sucesso, false);
    assert.strictEqual(bad.codigo, ROUTE_CODES.PDV_HOSTNAME_OU_MAC_PROIBIDO);

    const ok = await router.resolve({
      pdvId: 1,
      provedorPreferido: 'destaxa',
      hostHints: { hostname: 'PC-LOJA-A', mac: 'AABBCCDDEEFF' }
    });
    // pode falhar por ambiguidade destaxa+sitef no PDV1 — use preferido destaxa
    // sitef inativo device also registered — destaxa preferido deve pegar tef-1
    assert.strictEqual(ok.sucesso, true);
    assert.strictEqual(ok.pdvId, '1');
    assert.notStrictEqual(ok.executionContext.estacao.id, '1');
    assert.strictEqual(ok.executionContext.estacao.identidadeEhPdv, false);
    assert.ok(chaveEstacao({ hostname: 'PC-LOJA-A' }));
  });

  await test('runtime Destaxa singleton na matriz e no contexto', () => {
    const m = matrizProvedor('destaxa');
    assert.strictEqual(m.runtimeSingleton, true);
    assert.strictEqual(m.isolamento, 'GLOBAL_SERIALIZE');
    assert.strictEqual(
      m.topologias[TOPOLOGIES.MULTI_ESTACAO].suportado,
      false
    );
    assert.strictEqual(
      m.topologias[TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV].pagamentosSimultaneos,
      false
    );
  });

  await test('Router anexa ExecutionContext sem allocate (TefManager path)', async () => {
    const d = await router.resolve({
      pdvId: 2,
      provedorPreferido: 'destaxa',
      hostHints: { hostname: 'PC-LOJA-A' }
    });
    assert.strictEqual(d.sucesso, true);
    assert.ok(d.executionContext);
    assert.strictEqual(d.isolamento.alocacaoAtiva, false);
    assert.strictEqual(d.executionContext.runtime.singletonDestaxa, true);
  });

  await test('estação remota + exigirExecucaoLocal bloqueia Destaxa', async () => {
    const routerMulti = criarTerminalRouter({
      identityValidator: identity,
      registry,
      allocator,
      carregarBindingSingleton: async () => bindingOk,
      mapaPdvEstacao: mapaMultiEstacao
    });
    const d = await routerMulti.resolve({
      pdvId: 3,
      provedorPreferido: 'destaxa',
      hostHints: { hostname: 'PC-LOJA-A' },
      exigirExecucaoLocal: true
    });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.ESTACAO_REMOTA_NAO_SUPORTADA);
  });

  await test('TefManager não altera ciclo financeiro (estático)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/TefManager.js'),
      'utf8'
    );
    // MRT-06: rota via integração; ciclo financeiro (idempotency/lock/pendências) preservado
    assert.ok(!/allocate:\s*true/.test(src));
    assert.ok(!/exigirDispositivo:\s*true/.test(src));
    assert.match(src, /tefRouterIntegration|obterTerminalRouter/);
    assert.match(src, /idempotency_key/);
    assert.match(src, /tefLockService\.comLock/);
    assert.match(src, /_pendencias/);
  });

  await test('adapters não referenciam executionContext', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'),
      'utf8'
    );
    assert.ok(!src.includes('executionContext'));
    assert.ok(!src.includes('TOPOLOGIES'));
  });

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  resetExecutionContextResolverParaTestes();
  resetTerminalRegistryParaTestes();
  resetTerminalAllocatorParaTestes();
  resetTerminalRouterParaTestes();

  console.log('\nMRT-05 testes OK — sem INIT / TX / migration.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
