'use strict';

/**
 * Auditoria: cadastra produto e não encontra.
 * Reproduz o fluxo cadastro → banco → busca operacional (Cadastro/PDV).
 *
 * Executar: node --test tests/produtos/auditoria-cadastro-pesquisa-integridade.test.js
 */

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  criarBuscaOperacionalProdutosService,
  normalizarNomeBusca
} = require('../../backend/services/busca-operacional-produtos');

const ROOT = path.join(__dirname, '../..');
const ROTA_PRODUTOS = fs.readFileSync(path.join(ROOT, 'backend/rotas/produtos.js'), 'utf8');
const FRONT_PRODUTOS = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
const FRONT_SAVE_LOCK = FRONT_PRODUTOS.includes('__cdsProdutoSalvando');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function criarDb() {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-prod-'));
    const db = new sqlite3.Database(path.join(dir, 't.db'), (err) => {
      if (err) return reject(err);
      resolve(db);
    });
  });
}

async function garantirSchema(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE,
    nome TEXT NOT NULL,
    nome_busca TEXT,
    ativo INTEGER DEFAULT 1,
    categoria_id INTEGER,
    subcategoria_id INTEGER,
    unidade TEXT DEFAULT 'UN',
    preco_compra REAL DEFAULT 0,
    preco_venda REAL DEFAULT 0,
    estoque_atual REAL DEFAULT 0,
    estoque_minimo REAL DEFAULT 0,
    codigo_barras TEXT,
    item_fiscal INTEGER DEFAULT 0,
    saldo_fiscal REAL DEFAULT 0,
    saldo_nao_fiscal REAL DEFAULT 0,
    controla_estoque INTEGER DEFAULT 1,
    marca_id INTEGER
  )`);
  await run(db, `CREATE TABLE produto_identificadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER,
    tipo TEXT,
    codigo TEXT,
    ativo INTEGER DEFAULT 1,
    principal INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
  await run(db, `CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`);
  await run(db, `CREATE TABLE produto_atacado (
    id INTEGER PRIMARY KEY,
    produto_id INTEGER,
    preco_atacado REAL,
    quantidade_minima REAL
  )`);
}

function insertPostLegadoSemNomeBusca(db, p) {
  return run(
    db,
    `INSERT INTO produtos (codigo, nome, categoria_id, unidade, preco_venda, codigo_barras, ativo)
     VALUES (?,?,?,?,?,?,?)`,
    [p.codigo, p.nome, p.categoria_id ?? null, p.unidade || 'UN', p.preco_venda ?? 1, p.codigo_barras ?? null, p.ativo ?? 1]
  );
}

function insertPostCorrigido(db, p) {
  const nomeBusca = Object.prototype.hasOwnProperty.call(p, 'nome_busca')
    ? p.nome_busca
    : normalizarNomeBusca(p.nome);
  return run(
    db,
    `INSERT INTO produtos (codigo, nome, nome_busca, ativo, categoria_id, unidade, preco_venda, codigo_barras)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      p.codigo,
      p.nome,
      nomeBusca,
      p.ativo == null ? 1 : p.ativo,
      p.categoria_id ?? null,
      p.unidade || 'UN',
      p.preco_venda ?? 1,
      p.codigo_barras == null ? null : String(p.codigo_barras)
    ]
  );
}

function nomes(itens) {
  return (itens || []).map((x) => x.nome);
}

describe('auditoria cadastro → pesquisa', () => {
  test('POST inclui nome_busca e ativo no INSERT (código)', () => {
    assert.match(ROTA_PRODUTOS, /INSERT INTO produtos \(/);
    assert.match(ROTA_PRODUTOS, /nome_busca/);
    assert.match(ROTA_PRODUTOS, /nomeBuscaGravar/);
    assert.match(ROTA_PRODUTOS, /Array\(39\)/);
    assert.ok(
      /controlarValidade && estoqueInicial > 0 && !data_validade_inicial/.test(ROTA_PRODUTOS)
    );
    const idxValidacao = ROTA_PRODUTOS.indexOf("error: 'Data de validade é obrigatória para o estoque inicial.'");
    const idxInsert = ROTA_PRODUTOS.indexOf('INSERT INTO produtos');
    assert.ok(idxValidacao > 0 && idxInsert > 0);
    assert.ok(idxValidacao < idxInsert, 'validação de validade deve ocorrer ANTES do INSERT');
  });

  test('frontend trava duplo clique em saveProduto', () => {
    assert.equal(FRONT_SAVE_LOCK, true);
    assert.match(FRONT_PRODUTOS, /window\.__cdsProdutoSalvando === true/);
    assert.match(FRONT_PRODUTOS, /complete:\s*function\s*\(\)\s*\{\s*window\.__cdsProdutoSalvando = false;/);
  });

  test('legado: INSERT sem nome_busca torna o produto invisível na pesquisa por nome', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });

    const ins = await insertPostLegadoSemNomeBusca(db, {
      codigo: 'AUD-LEGADO-001',
      nome: 'PRODUTO TESTE AUDITORIA 2026'
    });
    const row = await get(db, 'SELECT * FROM produtos WHERE id = ?', [ins.lastID]);
    assert.ok(row);
    assert.equal(row.nome, 'PRODUTO TESTE AUDITORIA 2026');
    assert.ok(row.nome_busca == null || row.nome_busca === '');

    const rNome = await svc.buscar({ q: 'PRODUTO TESTE AUDITORIA 2026', incluirSugestoes: false });
    assert.equal(rNome.itens.length, 0, 'nome_busca NULL: busca por nome NÃO encontra (causa do relato)');

    const rCodigo = await svc.buscar({ q: 'AUD-LEGADO-001', incluirSugestoes: false });
    assert.ok(rCodigo.itens.some((p) => Number(p.id) === ins.lastID), 'código interno ainda encontra');
  });

  test('corrigido: cadastrar → banco por ID → nome → código → parte do nome', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });

    const ins = await insertPostCorrigido(db, {
      codigo: 'AUD-2026-001',
      nome: 'PRODUTO TESTE AUDITORIA 2026'
    });
    const id = ins.lastID;
    const row = await get(db, 'SELECT * FROM produtos WHERE id = ?', [id]);
    assert.ok(row, 'produto persistido');
    assert.equal(row.ativo, 1);
    assert.equal(row.nome_busca, 'produtotesteauditoria2026');
    assert.equal(row.categoria_id, null);

    const porId = await get(db, 'SELECT id, nome FROM produtos WHERE id = ?', [id]);
    assert.equal(porId.nome, 'PRODUTO TESTE AUDITORIA 2026');

    const cheio = await svc.buscar({ q: 'PRODUTO TESTE AUDITORIA 2026', incluirSugestoes: false });
    assert.ok(cheio.itens.some((p) => Number(p.id) === id));

    const codigo = await svc.buscar({ q: 'AUD-2026-001', incluirSugestoes: false });
    assert.ok(codigo.itens.some((p) => Number(p.id) === id));

    const parte = await svc.buscar({ q: 'PRODUTO TESTE', incluirSugestoes: false });
    assert.ok(parte.itens.some((p) => Number(p.id) === id));

    const tokenMeio = await svc.buscar({ q: 'AUDITORIA', incluirSugestoes: false });
    assert.ok(
      tokenMeio.itens.some((p) => Number(p.id) === id),
      'token do meio do nome deve encontrar quando não há prefixo concorrente'
    );
  });

  test('acentos e espaços: armazena original, pesquisa normalizada', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });

    const casos = [
      { codigo: 'AG-01', nome: 'Água Mineral' },
      { codigo: 'AG-02', nome: 'agua mineral' },
      { codigo: 'AG-03', nome: 'ÁGUA MINERAL' },
      { codigo: 'AG-04', nome: 'Água  Mineral' },
      { codigo: 'AG-05', nome: 'Água Mineral ' }
    ];
    for (const c of casos) {
      await insertPostCorrigido(db, c);
      const row = await get(db, 'SELECT nome, nome_busca FROM produtos WHERE codigo = ?', [c.codigo]);
      assert.equal(row.nome, c.nome, 'nome original preservado');
      assert.equal(row.nome_busca, 'aguamineral');
    }

    const rAcento = await svc.buscar({ q: 'ÁGUA', incluirSugestoes: false });
    const rSem = await svc.buscar({ q: 'agua', incluirSugestoes: false });
    const rMineral = await svc.buscar({ q: 'MINERAL', incluirSugestoes: false });
    assert.ok(rAcento.itens.length >= 5);
    assert.ok(rSem.itens.length >= 5);
    assert.ok(rMineral.itens.length >= 5);
  });

  test('EAN: zeros à esquerda como string', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    const ean = '0789123456789';
    await insertPostCorrigido(db, {
      codigo: 'EAN-01',
      nome: 'PRODUTO EAN AUDITORIA',
      codigo_barras: ean
    });
    const row = await get(db, 'SELECT codigo_barras FROM produtos WHERE codigo = ?', ['EAN-01']);
    assert.equal(row.codigo_barras, ean);
    assert.notEqual(row.codigo_barras, '789123456789');

    const r = await svc.buscar({ q: ean, incluirSugestoes: false });
    assert.ok(r.itens.some((p) => String(p.codigo_barras) === ean));
  });

  test('código interno ABC001: match exato; minúsculo não é tratado como o mesmo identificador', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    await insertPostCorrigido(db, { codigo: 'ABC001', nome: 'PRODUTO CODIGO INTERNO' });
    const a = await svc.buscar({ q: 'ABC001', incluirSugestoes: false });
    const b = await svc.buscar({ q: 'abc001', incluirSugestoes: false });
    assert.ok(a.itens.some((p) => String(p.codigo) === 'ABC001'));
    assert.equal(
      b.itens.some((p) => String(p.codigo) === 'ABC001'),
      false,
      'regra atual: identificador usa igualdade SQL case-sensitive; não alterar nesta sprint'
    );
  });

  test('ausência de categoria não oculta o produto na busca', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    await insertPostCorrigido(db, { codigo: 'CAT-0', nome: 'SEM CATEGORIA AUDITORIA', categoria_id: null });
    const r = await svc.buscar({ q: 'SEM CATEGORIA AUDITORIA', incluirSugestoes: false });
    assert.equal(r.itens.length, 1);
    assert.equal(r.itens[0].categoria_id, null);
  });

  test('produto recém-criado nasce ativo=1 e entra na busca', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    const ins = await insertPostCorrigido(db, { codigo: 'ATV-1', nome: 'ATIVO DEFAULT' });
    const row = await get(db, 'SELECT ativo FROM produtos WHERE id = ?', [ins.lastID]);
    assert.equal(Number(row.ativo), 1);
    const r = await svc.buscar({ q: 'ATIVO DEFAULT', incluirSugestoes: false });
    assert.equal(r.itens.length, 1);
  });

  test('ativo=0 fica de fora da busca operacional', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    await insertPostCorrigido(db, { codigo: 'ATV-0', nome: 'PRODUTO INATIVO AUD', ativo: 0 });
    const r = await svc.buscar({ q: 'PRODUTO INATIVO AUD', incluirSugestoes: false });
    assert.equal(r.itens.length, 0);
  });

  test('mesmo nome, códigos diferentes: ambos encontrados', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    await insertPostCorrigido(db, { codigo: 'DUP-A', nome: 'ARROZ TIPO 1 AUD' });
    await insertPostCorrigido(db, { codigo: 'DUP-B', nome: 'ARROZ TIPO 1 AUD' });
    const r = await svc.buscar({ q: 'ARROZ TIPO 1 AUD', incluirSugestoes: false });
    assert.equal(r.itens.length, 2);
    const porA = await svc.buscar({ q: 'DUP-A', incluirSugestoes: false });
    const porB = await svc.buscar({ q: 'DUP-B', incluirSugestoes: false });
    assert.equal(porA.itens.length, 1);
    assert.equal(porB.itens.length, 1);
  });

  test('UNIQUE de código: segundo INSERT falha', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    await insertPostCorrigido(db, { codigo: 'UNQ-1', nome: 'PRIMEIRO' });
    await assert.rejects(
      () => insertPostCorrigido(db, { codigo: 'UNQ-1', nome: 'SEGUNDO' }),
      /UNIQUE/i
    );
  });

  test('excluir (hard delete) e recriar o mesmo código', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    const a = await insertPostCorrigido(db, { codigo: 'REC-1', nome: 'FANTASMA A' });
    await run(db, 'DELETE FROM produtos WHERE id = ?', [a.lastID]);
    await insertPostCorrigido(db, { codigo: 'REC-1', nome: 'FANTASMA B' });
    const r = await svc.buscar({ q: 'REC-1', incluirSugestoes: false });
    assert.equal(r.itens.length, 1);
    assert.equal(r.itens[0].nome, 'FANTASMA B');
  });

  test('paginação: termo específico encontra além do limite 20', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    for (let i = 1; i <= 40; i += 1) {
      await insertPostCorrigido(db, {
        codigo: `GEN-${String(i).padStart(3, '0')}`,
        nome: `PRODUTO GENERICO LOTE ${i}`
      });
    }
    await insertPostCorrigido(db, {
      codigo: 'AUD-2026-001',
      nome: 'PRODUTO TESTE AUDITORIA 2026'
    });
    const r = await svc.buscar({ q: 'PRODUTO TESTE AUDITORIA 2026', incluirSugestoes: false });
    assert.ok(r.itens.some((p) => String(p.codigo) === 'AUD-2026-001'));
    assert.ok(r.itens.length <= 20);
  });

  test('isolamento Sprint 04: prefixo continua isolando CONTEM de outro radical', async () => {
    const db = await criarDb();
    await garantirSchema(db);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    await insertPostCorrigido(db, { codigo: '0001', nome: 'PICOLE CREMOSO' });
    await insertPostCorrigido(db, { codigo: '0002', nome: 'PICOLE MORANGO - Cremoso' });
    const r = await svc.buscar({ q: 'PICOLE CRE', incluirSugestoes: false });
    assert.ok(r.itens.every((p) => p.nome === 'PICOLE CREMOSO'));
    assert.ok(!nomes(r.itens).some((n) => /MORANGO/i.test(n)));
  });

  test('esquema produtos: sem empresa_id/tenant_id (isolamento é por arquivo de banco)', async () => {
    assert.doesNotMatch(ROTA_PRODUTOS, /INSERT INTO produtos \([\s\S]*empresa_id/);
    const schemaDb = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    const bloco = schemaDb.match(/CREATE TABLE IF NOT EXISTS produtos \([\s\S]*?\)/);
    assert.ok(bloco);
    assert.doesNotMatch(bloco[0], /empresa_id|tenant_id|company_id/);
  });

  test('GET /api/produtos não filtra item_fiscal (cadastro ≠ PDV)', () => {
    assert.match(ROTA_PRODUTOS, /function filtroSqlModoFiscalProduto/);
    assert.match(ROTA_PRODUTOS, /item_fiscal não define visibilidade do catálogo/);
    const m = ROTA_PRODUTOS.match(/function filtroSqlModoFiscalProduto[\s\S]*?return '';/);
    assert.ok(m);
  });
});
