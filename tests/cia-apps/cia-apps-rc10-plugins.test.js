'use strict';

/**
 * CIA-APPS RC1.0 — Plugin Safe
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  CIA_APPS_CODIGO,
  CIA_APPS_VERSION,
  PluginSandbox,
  FeatureFlags,
  CircuitBreaker,
  PluginManager,
  resetPluginManager,
  bootstrapPlugins
} = require('../../backend/plugins');

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log('OK', nome))
    .catch((err) => {
      console.error('FAIL', nome);
      throw err;
    });
}

function criarDb() {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cia-apps-'));
    const db = new sqlite3.Database(path.join(dir, 't.db'), (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`CREATE TABLE produtos (
          id INTEGER PRIMARY KEY, codigo TEXT, nome TEXT, estoque_atual REAL DEFAULT 0,
          estoque_minimo REAL DEFAULT 5, ativo INTEGER DEFAULT 1, item_fiscal INTEGER DEFAULT 1,
          ncm TEXT, controla_estoque INTEGER DEFAULT 1
        )`);
        db.run(`CREATE TABLE contas_receber (
          id INTEGER PRIMARY KEY, valor_restante REAL, status TEXT, data_vencimento TEXT
        )`);
        db.run(`CREATE TABLE vendas (
          id INTEGER PRIMARY KEY, data_venda TEXT, cancelada INTEGER DEFAULT 0
        )`);
        db.run(`INSERT INTO produtos (codigo, nome, estoque_atual, estoque_minimo, ncm)
                VALUES ('1','Item A',0,10,NULL)`);
        db.run(`INSERT INTO contas_receber (valor_restante, status, data_vencimento)
                VALUES (50,'aberto', date('now','-2 day'))`);
        db.run(`INSERT INTO vendas (data_venda, cancelada) VALUES (date('now'),0)`, (e) => {
          if (e) reject(e);
          else resolve(db);
        });
      });
    });
  });
}

/** Plugin fixture temporário (travado / falha / ok) */
function criarFixturePlugins(root) {
  const make = (id, body) => {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      id, name: id, version: '9.9.9', enabled: true, motors: ['CIP']
    }));
    fs.writeFileSync(path.join(dir, 'permissions.json'), JSON.stringify({ somenteLeitura: true }));
    fs.writeFileSync(path.join(dir, 'plugin.js'), body);
  };

  make('ok-plugin', `
    module.exports = function() {
      return {
        async load() { return { ok: true }; },
        async unload() {},
        async health() { return { ok: true }; },
        async ask() { return { resposta: 'ok-fixture' }; }
      };
    };
  `);

  make('fail-plugin', `
    module.exports = function() {
      return {
        async load() { return { ok: true }; },
        async unload() {},
        async health() { return { ok: true }; },
        async ask() { throw new Error('falha proposital'); }
      };
    };
  `);

  make('stuck-plugin', `
    module.exports = function() {
      return {
        async load() { return { ok: true }; },
        async unload() {},
        async health() { return { ok: true }; },
        async ask() {
          return new Promise(() => {}); // nunca resolve
        }
      };
    };
  `);
}

async function main() {
  await test('versão CIA-APPS-RC1.0', () => {
    assert.strictEqual(CIA_APPS_CODIGO, 'CIA-APPS-RC1.0');
    assert.strictEqual(CIA_APPS_VERSION, '1.0.0');
  });

  await test('sandbox timeout', async () => {
    const sb = new PluginSandbox({ timeoutMs: 80, failureThreshold: 99 });
    const r = await sb.run(() => new Promise(() => {}));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'PLUGIN_TIMEOUT');
  });

  await test('sandbox captura falha', async () => {
    const sb = new PluginSandbox({ timeoutMs: 1000 });
    const r = await sb.run(() => { throw new Error('boom'); });
    assert.strictEqual(r.ok, false);
    assert.ok(/boom/.test(r.error));
  });

  await test('circuit breaker abre', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60000 });
    cb.failure();
    cb.failure();
    assert.strictEqual(cb.canExecute(), false);
    assert.strictEqual(cb.snapshot().state, 'open');
  });

  await test('feature flags por escopo', () => {
    const f = new FeatureFlags();
    f.set('x', true, { scope: 'global' });
    f.set('x', false, { scope: 'filial', scopeId: 2 });
    assert.strictEqual(f.isEnabled('x', { filial_id: 2 }), false);
    assert.strictEqual(f.isEnabled('x', { filial_id: 1 }), true);
  });

  const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'plugs-'));
  criarFixturePlugins(fixtures);

  await test('carga + ask plugin ok', async () => {
    const pm = new PluginManager({ pluginsDir: fixtures, timeoutMs: 500 });
    const load = await pm.load('ok-plugin');
    assert.ok(load.ok);
    const r = await pm.invoke('ok-plugin', 'ask', { mensagem: 'oi' });
    assert.ok(r.ok);
    assert.strictEqual(r.result.resposta, 'ok-fixture');
  });

  await test('plugin desligado não executa', async () => {
    const pm = new PluginManager({ pluginsDir: fixtures, timeoutMs: 500 });
    await pm.load('ok-plugin');
    pm.setEnabled('ok-plugin', false);
    const r = await pm.invoke('ok-plugin', 'ask', {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'PLUGIN_DISABLED');
  });

  await test('falha isolada — não derruba manager', async () => {
    const pm = new PluginManager({ pluginsDir: fixtures, timeoutMs: 500 });
    await pm.load('fail-plugin');
    await pm.load('ok-plugin');
    const fail = await pm.invoke('fail-plugin', 'ask', {});
    assert.strictEqual(fail.ok, false);
    const ok = await pm.invoke('ok-plugin', 'ask', {});
    assert.ok(ok.ok);
  });

  await test('plugin travado → timeout', async () => {
    const pm = new PluginManager({ pluginsDir: fixtures, timeoutMs: 100 });
    await pm.load('stuck-plugin');
    const r = await pm.invoke('stuck-plugin', 'ask', {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'PLUGIN_TIMEOUT');
  });

  await test('restart / rollback operacional', async () => {
    const pm = new PluginManager({ pluginsDir: fixtures, timeoutMs: 500 });
    await pm.load('ok-plugin');
    pm.setEnabled('ok-plugin', false);
    const rst = await pm.restart('ok-plugin');
    assert.ok(rst.ok);
    // após restart, enabled volta do manifest (true) via load()
    const r = await pm.invoke('ok-plugin', 'ask', {});
    assert.ok(r.ok);
  });

  const db = await criarDb();
  resetPluginManager();

  await test('bootstrap plugins oficiais + health', async () => {
    const boot = await bootstrapPlugins({ db });
    assert.ok(boot.ok);
    const { obterPluginManager } = require('../../backend/plugins');
    const pm = obterPluginManager({ db });
    const ids = pm.list().map((p) => p.id);
    for (const id of [
      'commercial-copilot',
      'inventory-copilot',
      'financial-copilot',
      'fiscal-copilot',
      'catalog-copilot'
    ]) {
      assert.ok(ids.includes(id), 'faltando ' + id);
    }
    const health = await pm.health();
    assert.ok(health.plugins.length >= 5);
    assert.ok(health.memoriaMb > 0);
  });

  await test('copilotos CIP ask (consulta)', async () => {
    const { obterPluginManager } = require('../../backend/plugins');
    const pm = obterPluginManager({ db });
    const fin = await pm.invoke('financial-copilot', 'ask', { mensagem: 'Inadimplentes' }, { role: 'admin' });
    assert.ok(fin.ok, fin.error);
    assert.ok(/Inadimpl/i.test(fin.result.resposta));

    const inv = await pm.invoke('inventory-copilot', 'ask', { mensagem: 'Produtos em ruptura' });
    assert.ok(inv.ok, inv.error);

    const fis = await pm.invoke('fiscal-copilot', 'ask', { mensagem: 'Problemas fiscais' });
    assert.ok(fis.ok, fis.error);
    assert.strictEqual(fis.result.emite, false);

    const com = await pm.invoke('commercial-copilot', 'ask', { mensagem: 'Quais produtos estão sem giro?' });
    assert.ok(com.ok, com.error);
  });

  await test('dashboard painel', () => {
    const { obterPluginManager } = require('../../backend/plugins');
    const dash = obterPluginManager({ db }).dashboard();
    assert.strictEqual(dash.codigo, 'CIA-APPS-RC1.0');
    assert.ok(Array.isArray(dash.plugins));
    assert.ok(dash.recentes);
  });

  resetPluginManager();
  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });

  console.log('\nCIA-APPS-RC1.0 testes OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
