'use strict';

/**
 * MRT-02 — Contrato Terminal Router + identidade PDV (sem INIT/TX real).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  ROUTE_CODES,
  MODOS_ROUTER,
  EXTENSION_POINTS,
  criarTerminalRouter,
  classificarIdentidadeInformada,
  criarPdvIdentityValidator
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

async function criarDbTerminais() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt02-'));
  const db = new sqlite3.Database(path.join(dir, 't.db'));
  await new Promise((resolve, reject) => {
    db.exec(`
      CREATE TABLE caixas (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        ativo INTEGER DEFAULT 1
      );
      CREATE TABLE terminais (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        hostname TEXT UNIQUE,
        caixa_id INTEGER,
        ativo INTEGER DEFAULT 1
      );
      INSERT INTO caixas (id, nome, ativo) VALUES (10, 'Caixa 1', 1);
      INSERT INTO caixas (id, nome, ativo) VALUES (11, 'Caixa Inativo', 0);
      INSERT INTO terminais (id, nome, hostname, caixa_id, ativo)
        VALUES (1, 'PDV 1', 'DESKTOP-OK', 10, 1);
      INSERT INTO terminais (id, nome, hostname, caixa_id, ativo)
        VALUES (2, 'PDV Inativo', 'DESKTOP-OFF', 10, 0);
      INSERT INTO terminais (id, nome, hostname, caixa_id, ativo)
        VALUES (3, 'PDV Sem Caixa', 'DESKTOP-SOLO', NULL, 1);
      INSERT INTO terminais (id, nome, hostname, caixa_id, ativo)
        VALUES (4, 'PDV Caixa Morto', 'DESKTOP-DEAD', 11, 1);
    `, (err) => (err ? reject(err) : resolve()));
  });

  const getRow = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });

  return { dir, db, getRow };
}

console.log('=== MRT-02 — Contrato e identidade PDV ===\n');

(async () => {
  const { dir, db, getRow } = await criarDbTerminais();
  const identity = criarPdvIdentityValidator({ getRow });

  const bindingOk = {
    ok: true,
    mensagem: 'mock singleton',
    config: { empresa_codigo: 'E1', loja_codigo: 'L1' },
    adapterBinding: {
      fonte: 'tef_configuracao_singleton',
      modo: 'COMPAT_SINGLETON',
      registro: { provedor: 'destaxa', ambiente: 'homologacao', empresa_codigo: 'E1', loja_codigo: 'L1' },
      executionMode: 'native-host',
      terminalTefId: null,
      dispositivoId: null
    }
  };

  const router = criarTerminalRouter({
    identityValidator: identity,
    carregarBindingSingleton: async () => bindingOk
  });

  await test('classificar: inteiro → pdv_id; hostname/MAC proibidos', () => {
    assert.strictEqual(classificarIdentidadeInformada('1').tipo, 'pdv_id');
    assert.strictEqual(classificarIdentidadeInformada('DESKTOP-OK').tipo, 'hostname');
    assert.strictEqual(classificarIdentidadeInformada('aa:bb:cc:dd:ee:ff').tipo, 'mac');
    assert.strictEqual(classificarIdentidadeInformada('aabbccddeeff').tipo, 'mac');
  });

  await test('PDV válido → ROUTE_OK + binding singleton', async () => {
    const d = await router.resolve({ pdvId: 1, operacao: 'autorizar' });
    assert.strictEqual(d.sucesso, true);
    assert.strictEqual(d.codigo, ROUTE_CODES.ROUTE_OK);
    assert.strictEqual(d.modo, MODOS_ROUTER.COMPAT_SINGLETON);
    assert.strictEqual(d.pdvId, '1');
    assert.strictEqual(d.pdv.caixaId, 10);
    assert.strictEqual(d.terminalTefId, null);
    assert.strictEqual(d.dispositivoId, null);
    assert.ok(d.adapterBinding);
    assert.strictEqual(d.adapterBinding.fonte, 'tef_configuracao_singleton');
    assert.strictEqual(d.isolamento.alocacaoAtiva, false);
  });

  await test('PDV inexistente', async () => {
    const d = await router.resolve({ pdvId: 999 });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.PDV_INEXISTENTE);
  });

  await test('PDV inativo', async () => {
    const d = await router.resolve({ pdvId: 2 });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.PDV_INATIVO);
  });

  await test('PDV sem vínculo (caixa_id null)', async () => {
    const d = await router.resolve({ pdvId: 3 });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.PDV_SEM_VINCULO);
  });

  await test('PDV com caixa inativo → SEM_VINCULO', async () => {
    const d = await router.resolve({ pdvId: 4 });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.PDV_SEM_VINCULO);
  });

  await test('Hostname não aceito como pdvId', async () => {
    const d = await router.resolve({ pdvId: 'DESKTOP-OK' });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.PDV_HOSTNAME_OU_MAC_PROIBIDO);
  });

  await test('MAC não aceito como pdvId', async () => {
    const d = await router.resolve({ pdvId: 'AA:BB:CC:DD:EE:FF' });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.PDV_HOSTNAME_OU_MAC_PROIBIDO);
  });

  await test('hostHints hostname/mac não viram identidade', async () => {
    const d = await router.resolve({
      hostHints: { hostname: 'DESKTOP-OK', mac: 'aa:bb:cc:dd:ee:ff' },
      operacao: 'autorizar'
    });
    assert.strictEqual(d.sucesso, true);
    assert.strictEqual(d.codigo, ROUTE_CODES.SINGLETON_FALLBACK);
    assert.strictEqual(d.pdvId, null);
  });

  await test('empresa/loja incompatível com singleton', async () => {
    const d = await router.resolve({ pdvId: 1, empresaId: 'OUTRA' });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.EMPRESA_LOJA_INCOMPATIVEL);
  });

  await test('fallback singleton com pdvId omitido', async () => {
    const d = await router.resolve({ operacao: 'autorizar' });
    assert.strictEqual(d.sucesso, true);
    assert.strictEqual(d.codigo, ROUTE_CODES.SINGLETON_FALLBACK);
    assert.strictEqual(d.meta.pdvOmitido, true);
    assert.ok(d.adapterBinding);
  });

  await test('pontos de extensão documentados no decision', async () => {
    const d = await router.resolve({});
    assert.ok(d.extensoes.registry);
    assert.ok(EXTENSION_POINTS.allocation);
    assert.match(d.extensoes.registry, /MRT-03/);
  });

  await test('TefManager importa Terminal Router (evidência estática)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/TefManager.js'),
      'utf8'
    );
    // MRT-06: resolve via tefRouterIntegration (que usa TerminalRouter)
    assert.match(src, /tefRouterIntegration|obterTerminalRouter/);
    assert.match(src, /_routeDecision/);
    assert.match(src, /MRT-02|MRT-06/);
  });

  await test('rota /pagar aceita pdv_id/terminal_id (evidência estática)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/rotas/tef.js'),
      'utf8'
    );
    assert.match(src, /pdv_id/);
    assert.match(src, /terminal_id/);
    assert.match(src, /nunca hostname/);
  });

  await test('adapters Destaxa não foram alterados nesta sprint (contrato)', () => {
    // Garantia de escopo: DestaxaRealAdapter não referencia terminalRouter
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'),
      'utf8'
    );
    assert.ok(!/terminalRouter/.test(src));
  });

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('\nMRT-02 testes OK — sem INIT / sem TX / sem migration.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
