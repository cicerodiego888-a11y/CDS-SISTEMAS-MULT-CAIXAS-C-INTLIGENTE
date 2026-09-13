'use strict';

/**
 * SMART-DASHBOARD-RC1.0 — plugin oficial (sem SQL)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  resetPluginManager,
  bootstrapPlugins,
  obterPluginManager
} = require('../../backend/plugins');
const {
  SMART_DASHBOARD_CODIGO,
  SMART_DASHBOARD_VERSION
} = require('../../backend/plugins/smart-dashboard/version');
const { temPermissao, DEFAULT_LAYOUT } = require('../../backend/plugins/smart-dashboard/cards');

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd10-'));
    const db = new sqlite3.Database(path.join(dir, 't.db'), (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`CREATE TABLE produtos (
          id INTEGER PRIMARY KEY, codigo TEXT, nome TEXT, estoque_atual REAL DEFAULT 0,
          estoque_minimo REAL DEFAULT 5, ativo INTEGER DEFAULT 1, item_fiscal INTEGER DEFAULT 1,
          ncm TEXT, controla_estoque INTEGER DEFAULT 1
        )`);
        db.run(`CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE contas_receber (
          id INTEGER PRIMARY KEY, valor_restante REAL, status TEXT, data_vencimento TEXT
        )`);
        db.run(`CREATE TABLE vendas (
          id INTEGER PRIMARY KEY, data_venda TEXT, cancelada INTEGER DEFAULT 0
        )`);
        db.run(`INSERT INTO produtos (codigo, nome, estoque_atual, estoque_minimo) VALUES ('1','A',0,10)`);
        db.run(`INSERT INTO contas_receber (valor_restante, status, data_vencimento)
                VALUES (80,'aberto', date('now','-1 day'))`);
        db.run(`INSERT INTO vendas (data_venda, cancelada) VALUES (date('now'),0)`);
        db.run(`INSERT INTO vendas (data_venda, cancelada) VALUES (date('now','-1 day'),0)`, (e) => {
          if (e) reject(e);
          else resolve(db);
        });
      });
    });
  });
}

/** Garante que o plugin não contém SQL de negócio embutido */
function assertSemSqlDireto() {
  const pluginJs = fs.readFileSync(
    path.join(__dirname, '../../backend/plugins/smart-dashboard/plugin.js'),
    'utf8'
  );
  const cardsJs = fs.readFileSync(
    path.join(__dirname, '../../backend/plugins/smart-dashboard/cards.js'),
    'utf8'
  );
  const banned = /\b(db\.(all|get|run)|SELECT\s+|INSERT\s+|UPDATE\s+|DELETE\s+)/i;
  assert.ok(!banned.test(pluginJs), 'plugin.js não deve ter SQL');
  assert.ok(!banned.test(cardsJs), 'cards.js não deve ter SQL');
}

async function main() {
  await test('versão SMART-DASHBOARD-RC1.0', () => {
    assert.strictEqual(SMART_DASHBOARD_CODIGO, 'SMART-DASHBOARD-RC1.0');
    assert.strictEqual(SMART_DASHBOARD_VERSION, '1.0.0');
  });

  await test('sem SQL direto no plugin', () => {
    assertSemSqlDireto();
  });

  await test('permissões ações rápidas', () => {
    assert.strictEqual(temPermissao({ role: 'admin' }, 'nfe'), true);
    assert.strictEqual(temPermissao({ role: 'operador', permissoes: ['pdv'] }, 'nfe'), false);
    assert.strictEqual(temPermissao({ role: 'operador', permissoes: ['pdv'] }, 'pdv'), true);
  });

  const db = await criarDb();
  resetPluginManager();
  await bootstrapPlugins({ db });
  const pm = obterPluginManager({ db });
  const admin = { id: 7, role: 'admin', permissoes: ['*'] };

  await test('plugin carregado e health', async () => {
    const list = pm.list().map((p) => p.id);
    assert.ok(list.includes('smart-dashboard'));
    const h = await pm.health('smart-dashboard');
    assert.ok(h.loaded);
    assert.ok(h.enabled);
  });

  await test('dashboard monta cards via motores', async () => {
    const r = await pm.invoke('smart-dashboard', 'dashboard', {}, admin);
    assert.ok(r.ok, r.error);
    const d = r.result;
    assert.strictEqual(d.codigo, 'SMART-DASHBOARD-RC1.0');
    assert.ok(d.cards.situacao);
    assert.ok(d.cards.alertas.items.length >= 1);
    assert.ok(d.cards.oportunidades);
    assert.ok(d.cards.ia.motor === 'CIA');
    assert.ok(d.cards.previsoes.fonte === 'ForecastEngine');
    assert.ok(d.cards.acoes.items.length >= 6);
    assert.ok(d.cards.operacional);
    assert.ok(d.cards.insights.items.length >= 1);
    assert.ok(d.fontes.includes('CIP'));
    assert.ok(Array.isArray(d.ordered));
  });

  await test('ações respeitam permissão', async () => {
    const user = { id: 8, role: 'operador', permissoes: ['pdv', 'caixa'] };
    const r = await pm.invoke('smart-dashboard', 'dashboard', {}, user);
    const acoes = r.result.cards.acoes.items;
    assert.ok(acoes.find((a) => a.id === 'nova_venda').permitido);
    assert.ok(!acoes.find((a) => a.id === 'emitir_nfe').permitido);
  });

  await test('modo executivo', async () => {
    const r = await pm.invoke('smart-dashboard', 'executive', {}, admin);
    assert.ok(r.ok, r.error);
    assert.ok(r.result.financeiro);
    assert.ok(r.result.vendas);
    assert.ok(r.result.estoque);
    assert.ok(r.result.fluxo);
    assert.ok(r.result.kpis);
  });

  await test('personalização layout', async () => {
    const save = await pm.invoke('smart-dashboard', 'layout', {
      layout: {
        order: ['insights', 'situacao', ...DEFAULT_LAYOUT.order.filter((x) => !['insights', 'situacao'].includes(x))],
        hidden: ['oportunidades'],
        pinned: ['insights']
      }
    }, admin);
    assert.ok(save.ok);
    const dash = await pm.invoke('smart-dashboard', 'dashboard', {}, admin);
    assert.ok(!dash.result.ordered.some((c) => c.id === 'oportunidades'));
    assert.strictEqual(dash.result.ordered[0].id, 'insights');
    const reset = await pm.invoke('smart-dashboard', 'layout', { reset: true }, admin);
    assert.ok(reset.result.layout.order.includes('situacao'));
  });

  await test('IA responde via CIA', async () => {
    const r = await pm.invoke('smart-dashboard', 'ask', {
      mensagem: 'Como estão minhas vendas?',
      origem: 'smart-dashboard'
    }, admin);
    assert.ok(r.ok, r.error);
    assert.ok(r.result.resposta || r.result.intent);
  });

  await test('feature flag desliga plugin', async () => {
    pm.setEnabled('smart-dashboard', false);
    const r = await pm.invoke('smart-dashboard', 'dashboard', {}, admin);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'PLUGIN_DISABLED');
    pm.setEnabled('smart-dashboard', true);
    const ok = await pm.invoke('smart-dashboard', 'dashboard', {}, admin);
    assert.ok(ok.ok);
  });

  resetPluginManager();
  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });

  console.log('\nSMART-DASHBOARD-RC1.0 testes OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
