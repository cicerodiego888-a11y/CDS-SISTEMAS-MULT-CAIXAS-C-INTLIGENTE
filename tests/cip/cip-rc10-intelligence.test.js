'use strict';

/**
 * CIP-RC1.0 — CDS Intelligence Platform
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  CIP_VERSION,
  CIP_CODIGO,
  CipService,
  ContextEngine,
  ForecastEngine,
  BusinessRuleEngine,
  RecommendationHub,
  obterCip
} = require('../../backend/motores/cip');

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cip10-'));
    const db = new sqlite3.Database(path.join(dir, 'test.db'), (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`CREATE TABLE produtos (
          id INTEGER PRIMARY KEY,
          codigo TEXT, nome TEXT, estoque_atual REAL DEFAULT 0,
          estoque_minimo REAL DEFAULT 0, ativo INTEGER DEFAULT 1,
          item_fiscal INTEGER DEFAULT 1, ncm TEXT, controla_estoque INTEGER DEFAULT 1
        )`);
        db.run(`CREATE TABLE contas_receber (
          id INTEGER PRIMARY KEY, valor_restante REAL, status TEXT, data_vencimento TEXT
        )`);
        db.run(`CREATE TABLE vendas (
          id INTEGER PRIMARY KEY, data_venda TEXT, cancelada INTEGER DEFAULT 0
        )`);
        db.run(`INSERT INTO produtos (id, codigo, nome, estoque_atual, estoque_minimo, ncm)
                VALUES (1, '10', 'Arroz 5kg', 2, 10, '10063021'),
                       (2, '20', 'Feijão', 0, 5, NULL)`);
        db.run(`INSERT INTO contas_receber (valor_restante, status, data_vencimento)
                VALUES (150, 'aberto', date('now', '-3 day')),
                       (80, 'aberto', date('now', '+2 day'))`);
        db.run(
          `INSERT INTO vendas (data_venda, cancelada) VALUES
           (date('now', '-2 day'), 0),
           (date('now', '-1 day'), 0),
           (date('now'), 0)`,
          (e) => (e ? reject(e) : resolve(db))
        );
      });
    });
  });
}

async function main() {
  await test('versão CIP-RC1.0', () => {
    assert.strictEqual(CIP_VERSION, '1.0.0');
    assert.strictEqual(CIP_CODIGO, 'CIP-RC1.0');
  });

  await test('ContextEngine prioriza módulos', () => {
    const ctx = new ContextEngine();
    assert.strictEqual(ctx.resolve('pdv').prioridade, 'velocidade');
    assert.strictEqual(ctx.resolve('compras').prioridade, 'fornecedores');
    assert.strictEqual(ctx.resolve('financeiro').prioridade, 'risco');
    assert.strictEqual(ctx.resolve('crm').prioridade, 'relacionamento');
  });

  await test('ForecastEngine vendas', () => {
    const f = new ForecastEngine();
    const r = f.preverVendas([
      { dia: '2026-07-01', vendas: 10 },
      { dia: '2026-07-02', vendas: 12 },
      { dia: '2026-07-03', vendas: 14 }
    ], 5);
    assert.ok(r.mediaDiaria > 0);
    assert.strictEqual(r.previsao.length, 5);
    assert.ok(['alta', 'baixa', 'estavel'].includes(r.tendencia));
  });

  await test('BusinessRuleEngine estoque mínimo', () => {
    const rules = new BusinessRuleEngine();
    const hits = rules.avaliar({
      estoque: {
        criticos: [{ id: 1, nome: 'Arroz', estoque_atual: 2, estoque_minimo: 10 }],
        produtosZerados: 1
      },
      financeiro: { contasVencidas: 1, valorVencido: 150, contasAVencer7d: 1, valorAVencer7d: 80 },
      fiscal: { produtosSemNcm: 1 },
      mib: { knowledge: null }
    });
    assert.ok(hits.some((h) => h.regra === 'estoque_minimo'));
    assert.ok(hits.some((h) => h.acaoSugerida === 'sugerir_pedido'));
  });

  await test('RecommendationHub consolida', () => {
    const hub = new RecommendationHub();
    const list = hub.consolidar({
      regras: [{
        regra: 'estoque_minimo',
        tipo: 'sugestao_compra',
        severidade: 'alta',
        titulo: 'Comprar',
        mensagem: 'x',
        produto_id: 1
      }],
      forecast: {
        estoque: [{ produto_id: 1, nome: 'Arroz', diasAteRuptura: 2, risco: 'alto' }],
        fluxoCaixa: { alerta: 'ok' }
      },
      contexto: { pesos: { risco: 0.5 } }
    });
    assert.ok(list.length >= 2);
  });

  const db = await criarDb();
  CipService.resetInstance();
  const cip = obterCip(db);

  await test('analyze produz insights', async () => {
    const r = await cip.analyze({ origem: 'erp', dryRun: true, automacao: true });
    assert.ok(r.insights);
    assert.ok(r.recommendations.length >= 1);
    assert.ok(r.forecast.vendas);
    assert.ok(r.contexto.id);
  });

  await test('APIs facade insights/recommendations/forecast', async () => {
    const insights = await cip.insights({ force: true, origem: 'pdv' });
    assert.ok(insights.resumo);
    const recs = await cip.recommendations({ origem: 'pdv' });
    assert.ok(Array.isArray(recs.items));
    const fc = await cip.forecast();
    assert.ok(fc.vendas);
  });

  await test('não duplica papel do MIB', () => {
    const info = cip.info();
    assert.ok(info.papeis.MIB.includes('busca'));
    assert.ok(info.papeis.CIP.includes('inteligência') || info.papeis.CIP.includes('decisão'));
  });

  await test('rebuild dryRun', async () => {
    const r = await cip.rebuild({ dryRun: true, automacao: false });
    assert.ok(r.analisadoEm);
  });

  CipService.resetInstance();
  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });
  console.log('\nCIP-RC1.0 testes OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
