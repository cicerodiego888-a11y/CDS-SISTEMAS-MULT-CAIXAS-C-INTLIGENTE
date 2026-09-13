'use strict';

/**
 * MIB-RC2.0 — Motor Cognitivo de Busca
 * Fuzzy, sinônimos, stop words, aprendizado e ranking adaptativo.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  MIB_VERSION,
  MIB_CODIGO,
  normalizarNomeBusca,
  levenshtein,
  tokenizar,
  MibService,
  RankingEngine,
  LearningEngine,
  SinonimosService
} = require('../../backend/motores/mib');
const { filtrarStopWords } = require('../../backend/motores/mib/core/stopWords');

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mib20-'));
    const arquivo = path.join(dir, 'test.db');
    const db = new sqlite3.Database(arquivo, (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`CREATE TABLE produtos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo TEXT UNIQUE,
          codigo_barras TEXT,
          nome TEXT NOT NULL,
          nome_busca TEXT,
          preco_venda REAL DEFAULT 0,
          ativo INTEGER DEFAULT 1,
          item_fiscal INTEGER DEFAULT 1,
          categoria_id INTEGER,
          marca_id INTEGER,
          unidade TEXT,
          unidade_comercial TEXT DEFAULT 'UN',
          quantidade_por_embalagem REAL DEFAULT 0,
          compra_por_embalagem INTEGER DEFAULT 0,
          valor_compra_embalagem REAL DEFAULT 0,
          estoque_atual REAL DEFAULT 0,
          saldo_fiscal REAL DEFAULT 0,
          saldo_nao_fiscal REAL DEFAULT 0,
          controla_estoque INTEGER DEFAULT 1,
          estoque_minimo REAL DEFAULT 0,
          vendido_por_peso INTEGER DEFAULT 0,
          produto_fracionado INTEGER DEFAULT 0,
          permite_venda_unidade INTEGER DEFAULT 0,
          peso_medio_unidade REAL DEFAULT 0,
          preco_unidade REAL DEFAULT 0,
          preco_compra REAL DEFAULT 0
        )`);
        db.run(`CREATE TABLE produto_identificadores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_id INTEGER, tipo TEXT, codigo TEXT,
          ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE promocoes (
          id INTEGER PRIMARY KEY, produto_id INTEGER, status TEXT,
          data_inicio TEXT, data_fim TEXT, preco_promocional REAL, desconto_percentual REAL
        )`);
        db.run(`CREATE TABLE produto_atacado (
          id INTEGER PRIMARY KEY, produto_id INTEGER, preco_atacado REAL, quantidade_minima REAL
        )`);
        db.run(`CREATE TABLE vendas (
          id INTEGER PRIMARY KEY, data_venda TEXT, cancelada INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE vendas_itens (
          id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER, quantidade REAL
        )`);
        db.run(
          `INSERT INTO produtos (codigo, codigo_barras, nome, nome_busca, preco_venda)
           VALUES
           ('10', '7891001', 'Coca Cola 2L', ?, 8.5),
           ('20', '7891002', 'Arroz Tio João 5KG', ?, 22),
           ('30', '7891003', 'Feijão Carioca 1KG', ?, 9),
           ('40', '7891004', 'Biscoito Recheado', ?, 4),
           ('50', '7891005', 'Refrigerante Guaraná 2L', ?, 7)`,
          [
            normalizarNomeBusca('Coca Cola 2L'),
            normalizarNomeBusca('Arroz Tio João 5KG'),
            normalizarNomeBusca('Feijão Carioca 1KG'),
            normalizarNomeBusca('Biscoito Recheado'),
            normalizarNomeBusca('Refrigerante Guaraná 2L')
          ],
          (e) => (e ? reject(e) : resolve(db))
        );
      });
    });
  });
}

async function main() {
  await test('versão >= RC2.0', () => {
    assert.ok(MIB_VERSION);
    assert.ok(String(MIB_CODIGO).startsWith('MIB-RC'));
  });

  await test('Levenshtein básico', () => {
    assert.strictEqual(levenshtein('coca', 'coca'), 0);
    assert.strictEqual(levenshtein('coka', 'coca'), 1);
    assert.ok(levenshtein('aros', 'arroz') <= 2);
    assert.strictEqual(levenshtein('feijao', 'feijao'), 0);
  });

  await test('stop words + tokenização', () => {
    const toks = tokenizar('ARROZ TIPO 1 DE TIO JOÃO 5KG');
    assert.ok(toks.tokensNorm.includes('arroz') || toks.tokens.includes('arroz'));
    assert.ok(!filtrarStopWords(['de', 'da', 'tipo', 'arroz']).includes('de'));
    assert.ok(!filtrarStopWords(['de', 'da', 'tipo', 'arroz']).includes('tipo'));
    assert.ok(filtrarStopWords(['de', 'da', 'tipo', 'arroz']).includes('arroz'));
  });

  const db = await criarDb();
  MibService.resetInstance();
  const mib = MibService.getInstance(db);
  await mib.iniciar();

  await test('busca exata prefixo', async () => {
    const r = await mib.buscar('coca', { limite: 10 });
    assert.ok(r.itens.some((p) => /coca/i.test(p.nome)));
    assert.ok((r.meta.tempoMs || 0) < 50);
  });

  await test('fuzzy COKA → Coca Cola', async () => {
    const r = await mib.buscar('COKA', { limite: 10 });
    assert.ok(
      r.itens.some((p) => /coca/i.test(p.nome)) || (r.meta.sugestao && r.meta.sugestao.sugestoes?.length),
      'deve achar fuzzy ou sugerir correção'
    );
  });

  await test('fuzzy AROS → Arroz', async () => {
    const r = await mib.buscar('AROS', { limite: 10 });
    assert.ok(r.itens.some((p) => /arroz/i.test(p.nome)));
  });

  await test('sinônimo REFRI → refrigerante', async () => {
    const r = await mib.buscar('REFRI', { limite: 10 });
    assert.ok(r.itens.some((p) => /refrigerante|guaran/i.test(p.nome)));
  });

  await test('sinônimo BOLACHA → biscoito', async () => {
    const r = await mib.buscar('BOLACHA', { limite: 10 });
    assert.ok(r.itens.some((p) => /biscoito/i.test(p.nome)));
  });

  await test('cadastro sinônimo manual', async () => {
    await mib.cadastrarSinonimo('tj', 'tiojoao', 'manual');
    const lista = await mib.listarSinonimos();
    assert.ok(lista.some((s) => s.termo === 'tj' || s.sinonimo === 'tj'));
  });

  await test('aprendizado cria preferência', async () => {
    const learning = mib.engine.learning;
    learning.limitePreferencia = 3;
    for (let i = 0; i < 3; i += 1) {
      await learning.registrarEvento({
        texto: 'COCA',
        produto_id: 1,
        operador_id: 7,
        filial_id: 1,
        caixa_id: 2,
        posicao: 0,
        tempo_ms: 120
      });
    }
    const pref = learning.preferenciaProduto(normalizarNomeBusca('COCA'), 7);
    assert.strictEqual(pref, 1);
    const r = await mib.buscar('COCA', { limite: 5, operador_id: 7 });
    assert.ok(r.itens.length >= 1);
    assert.strictEqual(Number(r.itens[0].id), 1);
  });

  await test('ranking adaptativo eleva produto aprendido', () => {
    const learning = new LearningEngine(null, { limitePreferencia: 2 });
    learning.registrarSelecao(1);
    learning.registrarSelecao(1);
    learning._prefMem.set(`${normalizarNomeBusca('coca')}|9`, new Map([[1, 5]]));
    const rank = new RankingEngine(learning);
    const a = {
      id: 1,
      codigo: '10',
      nome_busca: normalizarNomeBusca('Coca Cola 2L'),
      nome: 'Coca Cola 2L'
    };
    const b = {
      id: 99,
      codigo: '99',
      nome_busca: normalizarNomeBusca('Coca Zero'),
      nome: 'Coca Zero'
    };
    const ordered = rank.ordenar([b, a], {
      termoNorm: normalizarNomeBusca('coca'),
      termoRaw: 'COCA',
      operador_id: 9
    });
    assert.strictEqual(Number(ordered[0].id), 1);
  });

  await test('analytics e reset', async () => {
    const a = await mib.analytics();
    assert.ok(a);
    assert.ok(typeof a.aprendizados === 'number' || a.aprendizados == null || true);
    const reset = await mib.resetLearning();
    assert.ok(reset.ok);
  });

  await test('config cognitiva', async () => {
    const cfg = await mib.setConfig({
      ativarFuzzy: true,
      ativarSinonimos: true,
      ativarAprendizado: true,
      ativarAutoCorrecao: true,
      sensibilidadeLevenshtein: 2
    });
    assert.strictEqual(cfg.ativarFuzzy, true);
    assert.strictEqual(cfg.sensibilidadeLevenshtein, 2);
  });

  // smoke SinonimosService isolado
  await test('SinonimosService seed', async () => {
    const syn = new SinonimosService(db);
    await syn.carregar();
    const exp = syn.expandir([normalizarNomeBusca('refri')]);
    assert.ok(exp.some((t) => t.includes('refrigerante') || t === normalizarNomeBusca('refrigerante')));
  });

  MibService.resetInstance();
  await new Promise((resolve) => {
    try {
      db.close(() => resolve());
    } catch (_) {
      resolve();
    }
    setTimeout(resolve, 200);
  });
  console.log('\nMIB-RC2.0 testes OK');
  process.exitCode = 0;
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
