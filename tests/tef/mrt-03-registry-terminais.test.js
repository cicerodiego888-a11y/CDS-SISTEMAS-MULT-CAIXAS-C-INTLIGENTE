'use strict';

/**
 * MRT-03 — Terminal Registry + fallback (sem INIT/TX/migration oficial).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  TERMINAL_STATES,
  REGISTRY_CODES,
  criarTerminalRegistry,
  resetTerminalRegistryParaTestes,
  projetarVisaoSingleton
} = require('../../backend/services/tef/terminalRegistry');

const {
  ROUTE_CODES,
  MODOS_ROUTER,
  criarTerminalRouter,
  resetTerminalRouterParaTestes,
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

async function criarDbPdv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt03-'));
  const db = new sqlite3.Database(path.join(dir, 't.db'));
  await new Promise((resolve, reject) => {
    db.exec(`
      CREATE TABLE caixas (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER DEFAULT 1);
      CREATE TABLE terminais (
        id INTEGER PRIMARY KEY, nome TEXT, hostname TEXT, caixa_id INTEGER, ativo INTEGER DEFAULT 1
      );
      INSERT INTO caixas VALUES (10, 'Caixa 1', 1);
      INSERT INTO terminais VALUES (1, 'PDV 1', 'HOST-A', 10, 1);
      INSERT INTO terminais VALUES (5, 'PDV 5', 'HOST-B', 10, 1);
    `, (err) => (err ? reject(err) : resolve()));
  });
  const getRow = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
  return { dir, db, getRow };
}

console.log('=== MRT-03 — Registry de terminais TEF ===\n');

(async () => {
  resetTerminalRegistryParaTestes();
  resetTerminalRouterParaTestes();

  const { dir, db, getRow } = await criarDbPdv();
  const identity = criarPdvIdentityValidator({ getRow });
  const registry = criarTerminalRegistry();

  const bindingOk = {
    ok: true,
    mensagem: 'mock singleton',
    config: { empresa_codigo: 'E1', loja_codigo: 'L1' },
    adapterBinding: {
      fonte: 'tef_configuracao_singleton',
      modo: 'COMPAT_SINGLETON',
      registro: {
        provedor: 'destaxa',
        ambiente: 'homologacao',
        empresa_codigo: 'E1',
        loja_codigo: 'L1',
        terminal_codigo: 'T-SINGLE'
      },
      executionMode: 'native-host',
      terminalTefId: null,
      dispositivoId: null
    }
  };

  const router = criarTerminalRouter({
    identityValidator: identity,
    registry,
    carregarBindingSingleton: async () => bindingOk
  });

  const dispositivo = {
    id: 'dev-com4',
    tipo: 'pinpad',
    portaCom: 'COM4',
    fabricante: 'Gertec',
    modelo: 'PPC930',
    ativo: true
  };

  await test('consulta de terminal existente (Registry HIT)', async () => {
    registry.registrar({
      id: 'tef-1',
      pdvId: '1',
      empresaId: 'E1',
      lojaId: 'L1',
      provedor: 'destaxa',
      ambiente: 'homologacao',
      codigoLogicoProvedor: 'TERM-100',
      estado: TERMINAL_STATES.ATIVO,
      dispositivo
    });
    const r = await registry.resolverPorPdv({ pdvId: '1' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.codigo, REGISTRY_CODES.REGISTRY_HIT);
    assert.strictEqual(r.terminal.codigoLogicoProvedor, 'TERM-100');
    assert.strictEqual(r.dispositivo.portaCom, 'COM4');
    assert.notStrictEqual(r.terminal.id, r.dispositivo.id);
  });

  await test('separação terminal lógico × dispositivo físico', async () => {
    const r = await registry.resolverPorPdv({ pdvId: '1' });
    assert.strictEqual(r.separacao.terminalLogicoId, 'tef-1');
    assert.strictEqual(r.separacao.dispositivoId, 'dev-com4');
    assert.strictEqual(r.separacao.codigoLogicoProvedor, 'TERM-100');
    assert.strictEqual(r.separacao.portaCom, 'COM4');
    assert.strictEqual(r.separacao.hostnameNaoUsadoComoPdv, true);
  });

  await test('PDV sem terminal associado → MISS + fallback singleton no Router', async () => {
    const miss = await registry.resolverPorPdv({ pdvId: '5' });
    assert.strictEqual(miss.codigo, REGISTRY_CODES.REGISTRY_MISS);

    const d = await router.resolve({ pdvId: 5, operacao: 'autorizar' });
    assert.strictEqual(d.sucesso, true);
    assert.strictEqual(d.codigo, ROUTE_CODES.ROUTE_OK);
    assert.strictEqual(d.modo, MODOS_ROUTER.COMPAT_SINGLETON);
    assert.strictEqual(d.meta.registryMiss, true);
    assert.strictEqual(d.adapterBinding.fonte, 'tef_configuracao_singleton');
    assert.strictEqual(d.terminalTefId, null);
  });

  await test('terminal inativo', async () => {
    registry.registrar({
      id: 'tef-off',
      pdvId: '5',
      provedor: 'destaxa',
      ambiente: 'homologacao',
      estado: TERMINAL_STATES.INATIVO,
      dispositivo: null
    });
    const r = await registry.resolverPorPdv({ pdvId: '5' });
    assert.strictEqual(r.codigo, REGISTRY_CODES.TERMINAL_INATIVO);
    const d = await router.resolve({ pdvId: 5 });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.TERMINAL_INATIVO);
    registry.remover('tef-off');
  });

  await test('terminal não provisionado', async () => {
    registry.registrar({
      id: 'tef-np',
      pdvId: '5',
      provedor: 'destaxa',
      ambiente: 'homologacao',
      estado: TERMINAL_STATES.NAO_PROVISIONADO
    });
    const d = await router.resolve({ pdvId: 5 });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.TERMINAL_NAO_PROVISIONADO);
    registry.remover('tef-np');
  });

  await test('terminal indisponível', async () => {
    registry.registrar({
      id: 'tef-ind',
      pdvId: '5',
      provedor: 'sitef',
      ambiente: 'homologacao',
      estado: TERMINAL_STATES.INDISPONIVEL
    });
    const d = await router.resolve({ pdvId: 5 });
    assert.strictEqual(d.codigo, ROUTE_CODES.TERMINAL_INDISPONIVEL);
    registry.remover('tef-ind');
  });

  await test('empresa/loja incompatível no Registry', async () => {
    const r = await registry.resolverPorPdv({ pdvId: '1', empresaId: 'OUTRA' });
    assert.strictEqual(r.codigo, REGISTRY_CODES.EMPRESA_LOJA_INCOMPATIVEL);
  });

  await test('seleção ambígua (2 ativos)', async () => {
    registry.registrar({
      id: 'tef-2a',
      pdvId: '5',
      provedor: 'destaxa',
      ambiente: 'homologacao',
      estado: TERMINAL_STATES.ATIVO,
      dispositivo: { id: 'd1', tipo: 'pinpad', portaCom: 'COM1' }
    });
    registry.registrar({
      id: 'tef-2b',
      pdvId: '5',
      provedor: 'paygo',
      ambiente: 'homologacao',
      estado: TERMINAL_STATES.ATIVO,
      dispositivo: { id: 'd2', tipo: 'pinpad', portaCom: 'COM2' }
    });
    const d = await router.resolve({ pdvId: 5 });
    assert.strictEqual(d.sucesso, false);
    assert.strictEqual(d.codigo, ROUTE_CODES.TERMINAL_AMBIGUO);
    // desambigua por provedor
    const ok = await router.resolve({ pdvId: 5, provedorPreferido: 'destaxa' });
    assert.strictEqual(ok.sucesso, true);
    assert.strictEqual(ok.codigo, ROUTE_CODES.REGISTRY_RESOLVED);
    assert.strictEqual(ok.terminalTefId, 'tef-2a');
    assert.strictEqual(ok.adapterBinding.fonte, 'tef_terminal_registry');
    assert.strictEqual(ok.isolamento.alocacaoAtiva, false);
    registry.remover('tef-2a');
    registry.remover('tef-2b');
  });

  await test('Router HIT Registry para PDV 1', async () => {
    const d = await router.resolve({ pdvId: 1, empresaId: 'E1', lojaId: 'L1' });
    assert.strictEqual(d.sucesso, true);
    assert.strictEqual(d.codigo, ROUTE_CODES.REGISTRY_RESOLVED);
    assert.strictEqual(d.modo, MODOS_ROUTER.REGISTRY_RESOLVE);
    assert.strictEqual(d.terminalTefId, 'tef-1');
    assert.strictEqual(d.dispositivoId, 'dev-com4');
    assert.strictEqual(d.adapterBinding.pinpadPortaCom, 'COM4');
    assert.strictEqual(d.adapterBinding.registro.terminal_codigo, 'TERM-100');
  });

  await test('fallback singleton com pdvId omitido (preserva MRT-02)', async () => {
    const d = await router.resolve({ operacao: 'autorizar' });
    assert.strictEqual(d.sucesso, true);
    assert.strictEqual(d.codigo, ROUTE_CODES.SINGLETON_FALLBACK);
    assert.strictEqual(d.modo, MODOS_ROUTER.COMPAT_SINGLETON);
  });

  await test('hostname continua proibido como pdvId', async () => {
    const d = await router.resolve({ pdvId: 'HOST-A' });
    assert.strictEqual(d.codigo, ROUTE_CODES.PDV_HOSTNAME_OU_MAC_PROIBIDO);
  });

  await test('projeção singleton separa lógico × físico (mock repo)', async () => {
    const proj = await projetarVisaoSingleton({
      tefConfigRepository: {
        async buscarConfiguracaoCompleta() {
          return {
            principal: {
              id: 99,
              habilitado: 1,
              provedor: 'destaxa',
              ambiente: 'homologacao',
              terminal_codigo: 'LOG-1',
              empresa_codigo: 'E1',
              loja_codigo: 'L1'
            },
            pinpad: {
              id: 7,
              porta_com: 'COM9',
              fabricante: 'Gertec',
              modelo: 'PPC930',
              ativo: 1
            }
          };
        },
        async buscarConfiguracaoPrincipal() { return null; }
      }
    });
    assert.strictEqual(proj.ok, true);
    assert.strictEqual(proj.terminal.codigoLogicoProvedor, 'LOG-1');
    assert.strictEqual(proj.dispositivo.portaCom, 'COM9');
    assert.notStrictEqual(proj.terminal.id, proj.dispositivo.id);
    assert.strictEqual(proj.separacao.identidadeEstacao.includes('hostname'), true);
  });

  await test('migration proposta existe e NÃO é auto-aplicada', () => {
    const mig = path.join(__dirname, '../../docs/build/mrt-03-migration-proposta.sql');
    assert.ok(fs.existsSync(mig));
    const sql = fs.readFileSync(mig, 'utf8');
    assert.match(sql, /tef_terminais_logicos/);
    assert.match(sql, /tef_dispositivos/);
    assert.match(sql, /NÃO aplicar/);
    // database.js não referencia as novas tabelas
    const database = fs.readFileSync(
      path.join(__dirname, '../../backend/database.js'),
      'utf8'
    );
    assert.ok(!/tef_terminais_logicos/.test(database));
  });

  await test('adapters não referenciam Registry', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'),
      'utf8'
    );
    assert.ok(!/terminalRegistry/.test(src));
  });

  // Regressão MRT-02 rápida (classificador)
  await test('regressão MRT-02: MAC rejeitado', async () => {
    const d = await router.resolve({ pdvId: 'aa:bb:cc:dd:ee:ff' });
    assert.strictEqual(d.codigo, ROUTE_CODES.PDV_HOSTNAME_OU_MAC_PROIBIDO);
  });

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  resetTerminalRegistryParaTestes();
  resetTerminalRouterParaTestes();

  console.log('\nMRT-03 testes OK — sem INIT / TX / migration oficial.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
