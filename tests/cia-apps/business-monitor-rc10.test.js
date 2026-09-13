'use strict';

/**
 * BUSINESS-MONITOR-RC1.0
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
  BUSINESS_MONITOR_CODIGO,
  BUSINESS_MONITOR_VERSION
} = require('../../backend/plugins/business-monitor/version');
const { detectarVendas, detectarEstoque, detectarFinanceiro } = require('../../backend/plugins/business-monitor/detectors');
const createPlugin = require('../../backend/plugins/business-monitor/plugin');

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm10-'));
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
        db.run(`INSERT INTO produtos (codigo, nome, estoque_atual, estoque_minimo) VALUES ('1','Coca',0,10)`);
        db.run(`INSERT INTO contas_receber (valor_restante, status, data_vencimento)
                VALUES (150,'aberto', date('now','-3 day'))`);
        // série com queda: ontem 10 implícito via múltiplas, hoje 1
        for (let i = 10; i >= 1; i -= 1) {
          const n = i === 1 ? 1 : 8;
          for (let k = 0; k < n; k += 1) {
            db.run(`INSERT INTO vendas (data_venda, cancelada) VALUES (date('now','-${i - 1} day'),0)`);
          }
        }
        db.run('SELECT 1', (e) => (e ? reject(e) : resolve(db)));
      });
    });
  });
}

function assertSemSql() {
  const files = ['plugin.js', 'detectors.js', 'EventStore.js'];
  const banned = /\b(db\.(all|get|run)|SELECT\s+|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)/i;
  for (const f of files) {
    const txt = fs.readFileSync(path.join(__dirname, '../../backend/plugins/business-monitor', f), 'utf8');
    assert.ok(!banned.test(txt), f + ' não deve ter SQL');
  }
}

async function main() {
  await test('versão BUSINESS-MONITOR-RC1.0', () => {
    assert.strictEqual(BUSINESS_MONITOR_CODIGO, 'BUSINESS-MONITOR-RC1.0');
    assert.strictEqual(BUSINESS_MONITOR_VERSION, '1.0.0');
  });

  await test('sem SQL direto', () => assertSemSql());

  await test('detectores unitários', () => {
    const full = {
      sinais: {
        vendas: {
          serie30d: [
            { dia: '2026-07-01', vendas: 20 },
            { dia: '2026-07-02', vendas: 5 }
          ]
        },
        estoque: { produtosZerados: 2, criticos: [{ id: 1, nome: 'Coca' }] },
        financeiro: { contasVencidas: 3, valorVencido: 500, valorAVencer7d: 0 }
      },
      forecast: {
        vendas: { tendencia: 'baixa', mediaDiaria: 15 },
        fluxoCaixa: { alerta: 'pressao_caixa', liquidoEstimado7d: -10, entradas7d: 0, riscoVencido: 500 },
        estoque: [{ produto_id: 1, nome: 'Coca', risco: 'alto', diasAteRuptura: 1 }]
      },
      recommendations: [{ tipo: 'oportunidade', titulo: 'estoque parado' }]
    };
    assert.ok(detectarVendas(full).some((e) => e.tipo === 'queda'));
    assert.ok(detectarEstoque(full).some((e) => e.tipo === 'ruptura'));
    assert.ok(detectarFinanceiro(full).some((e) => e.tipo === 'inadimplencia'));
  });

  const db = await criarDb();
  resetPluginManager();
  createPlugin._storeForTest.clear();
  await bootstrapPlugins({ db });
  const pm = obterPluginManager({ db });
  const admin = { id: 1, role: 'admin', permissoes: ['*'] };

  await test('plugin carregado', async () => {
    assert.ok(pm.list().some((p) => p.id === 'business-monitor'));
    const h = await pm.health('business-monitor');
    assert.ok(h.loaded && h.enabled);
  });

  await test('analyze gera eventos', async () => {
    const r = await pm.invoke('business-monitor', 'analyze', { force: true }, admin);
    assert.ok(r.ok, r.error);
    assert.ok(r.result.detectados >= 1);
    assert.ok(r.result.stats.total >= 1);
  });

  await test('events / alerts / opportunities', async () => {
    const ev = await pm.invoke('business-monitor', 'events', { limite: 50 }, admin);
    assert.ok(ev.ok);
    assert.ok(Array.isArray(ev.result.items));

    const al = await pm.invoke('business-monitor', 'alerts', {}, admin);
    assert.ok(al.ok);

    const op = await pm.invoke('business-monitor', 'opportunities', {}, admin);
    assert.ok(op.ok);
  });

  await test('dashboard timeline e mapas', async () => {
    const r = await pm.invoke('business-monitor', 'dashboard', { refresh: false }, admin);
    assert.ok(r.ok, r.error);
    assert.ok(r.result.timeline);
    assert.ok(r.result.mapaRiscos);
    assert.ok(r.result.mapaOportunidades);
    assert.ok(r.result.historico);
  });

  await test('resolve ações', async () => {
    const ev = await pm.invoke('business-monitor', 'events', { status: 'aberto', limite: 1 }, admin);
    const id = ev.result.items[0]?.id;
    assert.ok(id);
    const res = await pm.invoke('business-monitor', 'resolve', { id, acao: 'resolver' }, admin);
    assert.ok(res.ok);
    assert.strictEqual(res.result.evento.status, 'resolvido');
  });

  await test('análise CIA a partir do alerta', async () => {
    await pm.invoke('business-monitor', 'analyze', {}, admin);
    const ev = await pm.invoke('business-monitor', 'alerts', {}, admin);
    const id = (ev.result.items[0] || (await pm.invoke('business-monitor', 'events', { status: 'aberto' }, admin)).result.items[0])?.id;
    assert.ok(id);
    const r = await pm.invoke('business-monitor', 'resolve', { id, acao: 'cia' }, admin);
    assert.ok(r.ok, r.error);
    assert.ok(r.result.cia);
  });

  await test('feature flag desliga', async () => {
    pm.setEnabled('business-monitor', false);
    const r = await pm.invoke('business-monitor', 'analyze', {}, admin);
    assert.strictEqual(r.code, 'PLUGIN_DISABLED');
    pm.setEnabled('business-monitor', true);
  });

  resetPluginManager();
  createPlugin._storeForTest.clear();
  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });

  console.log('\nBUSINESS-MONITOR-RC1.0 testes OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
