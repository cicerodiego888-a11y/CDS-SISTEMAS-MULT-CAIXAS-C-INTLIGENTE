'use strict';

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-sprint17b-'));
const dbPath = path.join(tempDir, 'sprint17b.sqlite');
const REAL_DB_PATH = path.join(
  process.env.PROGRAMDATA || 'C:\\ProgramData',
  'MercantilFiscal',
  'dados',
  'mercadao.db'
);
const db = new sqlite3.Database(dbPath);
const {
  categoriaEhAcougueOuHortifruti,
  resolverFlagsNovoProduto
} = require('../../backend/services/categorias/categoriaPadroes');
const {
  normalizarProdutosCategoriaEspecial,
  normalizarProdutoCategoriaEspecial
} = require('../../backend/services/categorias/normalizacaoProdutosCategoriaEspecial');
const { garantirSchemaProdutoIdentificadores } = require('../../backend/motores/produto-identidade/schema/produtoIdentificadoresSchema');
const PdvProdutoIdentificacaoService = require('../../backend/motores/produto-identidade/services/PdvProdutoIdentificacaoService');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes || 0 });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function garantirIdentificadores() {
  return new Promise((resolve, reject) => {
    garantirSchemaProdutoIdentificadores(db, (err) => (err ? reject(err) : resolve()));
  });
}

async function criarSchemaTeste() {
  await run(`CREATE TABLE categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    descricao TEXT,
    tipo TEXT NOT NULL DEFAULT 'produto',
    ativo INTEGER DEFAULT 1,
    padrao_controla_estoque INTEGER NOT NULL DEFAULT 1,
    padrao_controle_comercial TEXT NOT NULL DEFAULT 'PADRAO',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo VARCHAR(50) UNIQUE,
    codigo_barras TEXT,
    nome VARCHAR(200) NOT NULL,
    categoria_id INTEGER,
    unidade VARCHAR(20),
    preco_venda DECIMAL(18,6) NOT NULL,
    ativo INTEGER DEFAULT 1,
    marca_id INTEGER,
    estoque_atual DECIMAL(10,2) DEFAULT 0,
    controla_estoque INTEGER DEFAULT 1,
    item_fiscal INTEGER DEFAULT 0,
    saldo_fiscal REAL DEFAULT 0,
    saldo_nao_fiscal REAL DEFAULT 0,
    reservado_fiscal REAL DEFAULT 0,
    reservado_nao_fiscal REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
  )`);
  await run(`CREATE TABLE marcas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    ativo INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE pedido_estoque_reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    pedido_item_id INTEGER,
    produto_id INTEGER NOT NULL,
    quantidade_fiscal REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ATIVA',
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME
  )`);
  await run(`CREATE TABLE venda_estoque_reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    venda_item_id INTEGER,
    produto_id INTEGER NOT NULL,
    quantidade_fiscal REAL DEFAULT 0,
    quantidade_nao_fiscal REAL DEFAULT 0,
    status TEXT DEFAULT 'ATIVA',
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME
  )`);
  await garantirIdentificadores();
}

async function criarCategoria(nome) {
  const r = await run(`INSERT INTO categorias (nome) VALUES (?)`, [nome]);
  return r.lastID;
}

async function criarProduto({ codigo, nome, categoriaId, itemFiscal, controlaEstoque, saldoFiscal, saldoNaoFiscal }) {
  const r = await run(`
    INSERT INTO produtos (
      codigo, codigo_barras, nome, categoria_id, unidade, preco_venda, ativo,
      estoque_atual, controla_estoque, item_fiscal, saldo_fiscal, saldo_nao_fiscal,
      reservado_fiscal, reservado_nao_fiscal
    ) VALUES (?, ?, ?, ?, 'UN', 2, 1, ?, ?, ?, ?, ?, 0, 0)
  `, [codigo, codigo, nome, categoriaId, saldoFiscal + saldoNaoFiscal, controlaEstoque, itemFiscal, saldoFiscal, saldoNaoFiscal]);
  await run(`
    INSERT INTO produto_identificadores (produto_id, tipo, codigo, codigo_exibicao, principal, origem)
    VALUES (?, 'INTERNO', ?, ?, 1, 'SPRINT17B_TEST')
  `, [r.lastID, codigo, codigo]);
  return r.lastID;
}

async function produtosDaCategoria(categoriaId) {
  return all(
    `SELECT p.*, c.nome AS categoria_nome
     FROM produtos p JOIN categorias c ON c.id = p.categoria_id
     WHERE p.categoria_id = ? ORDER BY p.id`,
    [categoriaId]
  );
}

function diagnostico(nome, rows) {
  const corretos = rows.filter((row) => Number(row.item_fiscal) === 0 && Number(row.controla_estoque) === 0).length;
  return { categoria: nome, total: rows.length, corretos, incorretos: rows.length - corretos };
}

function semFlags(row) {
  const { item_fiscal, controla_estoque, ...restante } = row;
  return restante;
}

async function snapshotReservas(produtoIds) {
  const ids = produtoIds.map(Number);
  const placeholders = ids.map(() => '?').join(', ');
  return {
    pedido: await all(`SELECT * FROM pedido_estoque_reservas WHERE produto_id IN (${placeholders}) ORDER BY id`, ids),
    venda: await all(`SELECT * FROM venda_estoque_reservas WHERE produto_id IN (${placeholders}) ORDER BY id`, ids)
  };
}

function carregarInclusaoPdv() {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
  const inicio = source.indexOf('function produtoControlaEstoquePdv');
  const fim = source.indexOf('function pdvNotificarBloqueioInclusaoProduto', inicio);
  assert.ok(inicio >= 0 && fim > inicio, 'Regras de inclusão do PDV encontradas');
  const factory = new Function(`
    let modoFiscal = false;
    function pdvResolverSaldosProduto(produto) {
      const saldoFiscal = Number(produto.saldo_fiscal || 0);
      const saldoNaoFiscal = Number(produto.saldo_nao_fiscal || 0);
      return { saldo_fiscal: saldoFiscal, saldo_nao_fiscal: saldoNaoFiscal, estoque_atual: saldoFiscal + saldoNaoFiscal };
    }
    function pdvPermitirVendaSemEstoque() { return false; }
    function pdvModoFiscalAtivo() { return modoFiscal; }
    ${source.slice(inicio, fim)}
    return {
      setModoFiscal(valor) { modoFiscal = valor === true; },
      pdvPodeIniciarInclusaoProduto,
      validarEstoqueVenda
    };
  `);
  return factory();
}

let ids;
let antes;
let diagnosticoAntes;
let diagnosticoDepois;
let primeiraExecucao;
let segundaExecucao;

before(async () => {
  assert.notEqual(path.resolve(dbPath), path.resolve(REAL_DB_PATH));
  assert.ok(path.resolve(dbPath).startsWith(path.resolve(tempDir)));
  await criarSchemaTeste();
  console.log(`SPRINT17B_DB_PATH=${dbPath}`);
  console.log('SPRINT17B_DB_ISOLATED=true');
});

after(async () => {
  await new Promise((resolve) => db.close(() => resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Sprint 17B — normalização em SQLite isolado', () => {
  it('preserva integridade, é idempotente e mantém busca/inclusão F12 OFF/ON', async () => {
    ids = {
      acougue: await criarCategoria('AÇOUGUE'),
      hortifruti: await criarCategoria('HORTIFRUTI'),
      bebidas: await criarCategoria('BEBIDAS')
    };
    const a = await criarProduto({ codigo: 'S17B-LEG-A', nome: 'Produto A Açougue', categoriaId: ids.acougue, itemFiscal: 1, controlaEstoque: 1, saldoFiscal: 10, saldoNaoFiscal: 5 });
    const b = await criarProduto({ codigo: 'S17B-LEG-B', nome: 'Produto B Açougue', categoriaId: ids.acougue, itemFiscal: 1, controlaEstoque: 1, saldoFiscal: 20, saldoNaoFiscal: 0 });
    const c = await criarProduto({ codigo: 'S17B-LEG-C', nome: 'Produto C Hortifruti', categoriaId: ids.hortifruti, itemFiscal: 1, controlaEstoque: 1, saldoFiscal: 8, saldoNaoFiscal: 4 });
    const d = await criarProduto({ codigo: 'S17B-LEG-D', nome: 'Produto D Hortifruti', categoriaId: ids.hortifruti, itemFiscal: 0, controlaEstoque: 1, saldoFiscal: 3, saldoNaoFiscal: 7 });
    const e = await criarProduto({ codigo: 'S17B-LEG-E', nome: 'Produto E Bebidas', categoriaId: ids.bebidas, itemFiscal: 1, controlaEstoque: 1, saldoFiscal: 30, saldoNaoFiscal: 0 });
    const idsAlvo = [a, b, c, d];

    await run(`INSERT INTO pedido_estoque_reservas (pedido_id, pedido_item_id, produto_id, quantidade_fiscal, status)
      VALUES (17001, 17011, ?, 2, 'ATIVA')`, [a]);
    await run('UPDATE produtos SET reservado_fiscal = 2 WHERE id = ?', [a]);

    antes = await all(
      `SELECT p.*, c.nome AS categoria_nome FROM produtos p
       JOIN categorias c ON c.id = p.categoria_id WHERE p.id IN (?, ?, ?, ?, ?) ORDER BY p.id`,
      [a, b, c, d, e]
    );
    const reservasAntes = await snapshotReservas(idsAlvo);
    const gruposAntes = {
      acougue: await produtosDaCategoria(ids.acougue),
      hortifruti: await produtosDaCategoria(ids.hortifruti),
      bebidas: await produtosDaCategoria(ids.bebidas)
    };
    diagnosticoAntes = {
      acougue: diagnostico('AÇOUGUE', gruposAntes.acougue),
      hortifruti: diagnostico('HORTIFRUTI', gruposAntes.hortifruti),
      bebidas: diagnostico('BEBIDAS', gruposAntes.bebidas)
    };
    console.log('SPRINT17B_DIAGNOSTICO_ANTES=' + JSON.stringify(diagnosticoAntes));
    console.log('SPRINT17B_PRODUTOS_ANTES=' + JSON.stringify(antes.map((row) => ({
      id: row.id, nome: row.nome, categoria: row.categoria_nome,
      item_fiscal: row.item_fiscal, controla_estoque: row.controla_estoque,
      saldo_fiscal: row.saldo_fiscal, saldo_nao_fiscal: row.saldo_nao_fiscal
    }))));
    assert.deepEqual(diagnosticoAntes, {
      acougue: { categoria: 'AÇOUGUE', total: 2, corretos: 0, incorretos: 2 },
      hortifruti: { categoria: 'HORTIFRUTI', total: 2, corretos: 0, incorretos: 2 },
      bebidas: { categoria: 'BEBIDAS', total: 1, corretos: 0, incorretos: 1 }
    });

    primeiraExecucao = await normalizarProdutosCategoriaEspecial(db);
    assert.equal(primeiraExecucao.produtosAlterados, 4);
    const depois = await all(
      `SELECT p.*, c.nome AS categoria_nome FROM produtos p
       JOIN categorias c ON c.id = p.categoria_id WHERE p.id IN (?, ?, ?, ?, ?) ORDER BY p.id`,
      [a, b, c, d, e]
    );
    for (const row of depois) {
      const anterior = antes.find((item) => item.id === row.id);
      assert.deepEqual(semFlags(row), semFlags(anterior), `somente flags podem mudar: produto ${row.id}`);
    }
    assert.deepEqual(await snapshotReservas(idsAlvo), reservasAntes);
    assert.ok(depois.filter((row) => categoriaEhAcougueOuHortifruti(row.categoria_nome))
      .every((row) => Number(row.item_fiscal) === 0 && Number(row.controla_estoque) === 0));
    assert.deepEqual(depois.find((row) => row.id === e), antes.find((row) => row.id === e));

    const gruposDepois = {
      acougue: await produtosDaCategoria(ids.acougue),
      hortifruti: await produtosDaCategoria(ids.hortifruti),
      bebidas: await produtosDaCategoria(ids.bebidas)
    };
    diagnosticoDepois = {
      acougue: diagnostico('AÇOUGUE', gruposDepois.acougue),
      hortifruti: diagnostico('HORTIFRUTI', gruposDepois.hortifruti),
      bebidas: diagnostico('BEBIDAS', gruposDepois.bebidas)
    };
    console.log('SPRINT17B_DIAGNOSTICO_DEPOIS=' + JSON.stringify(diagnosticoDepois));
    assert.deepEqual(diagnosticoDepois, {
      acougue: { categoria: 'AÇOUGUE', total: 2, corretos: 2, incorretos: 0 },
      hortifruti: { categoria: 'HORTIFRUTI', total: 2, corretos: 2, incorretos: 0 },
      bebidas: { categoria: 'BEBIDAS', total: 1, corretos: 0, incorretos: 1 }
    });
    assert.equal((await get('SELECT COUNT(*) AS total FROM venda_estoque_reservas')).total, 0);

    segundaExecucao = await normalizarProdutosCategoriaEspecial(db);
    assert.equal(segundaExecucao.produtosAlterados, 0);
    console.log(`SPRINT17B_SEGUNDA_EXECUCAO=${segundaExecucao.produtosAlterados}`);

    for (const [nome, categoriaId] of [['Açougue', ids.acougue], ['Hortifruti', ids.hortifruti]]) {
      const categoria = await get('SELECT * FROM categorias WHERE id = ?', [categoriaId]);
      const flags = resolverFlagsNovoProduto({ item_fiscal: 1, controla_estoque: 1 }, categoria, 0, 0);
      assert.deepEqual({ item_fiscal: flags.itemFiscal, controla_estoque: flags.controlaEstoque }, { item_fiscal: 0, controla_estoque: 0 });
      const novo = await criarProduto({
        codigo: `S17B-NOVO-${nome}`, nome: `Novo ${nome}`, categoriaId,
        itemFiscal: flags.itemFiscal, controlaEstoque: flags.controlaEstoque,
        saldoFiscal: 0, saldoNaoFiscal: 0
      });
      const row = await get('SELECT item_fiscal, controla_estoque FROM produtos WHERE id = ?', [novo]);
      assert.deepEqual(row, { item_fiscal: 0, controla_estoque: 0 });
    }
    const categoriaBebidas = await get('SELECT * FROM categorias WHERE id = ?', [ids.bebidas]);
    const bebidasFlags = resolverFlagsNovoProduto({ item_fiscal: 1, controla_estoque: 1 }, categoriaBebidas, 0, 0);
    assert.equal(bebidasFlags.itemFiscal, 1);
    assert.equal(bebidasFlags.controlaEstoque, 1);

    for (const [chave, categoriaId] of [['ACOU', ids.acougue], ['HORTI', ids.hortifruti]]) {
      const produto = await criarProduto({
        codigo: `S17B-MOVER-${chave}`, nome: `Mover ${chave}`, categoriaId: ids.bebidas,
        itemFiscal: 1, controlaEstoque: 1, saldoFiscal: 6, saldoNaoFiscal: 2
      });
      await run('UPDATE produtos SET categoria_id = ? WHERE id = ?', [categoriaId, produto]);
      const alterado = await normalizarProdutoCategoriaEspecial(db, produto, categoriaId);
      assert.equal(alterado.produtosAlterados, 1);
      assert.deepEqual(
        await get('SELECT item_fiscal, controla_estoque, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = ?', [produto]),
        { item_fiscal: 0, controla_estoque: 0, saldo_fiscal: 6, saldo_nao_fiscal: 2 }
      );
    }

    const identificacaoPdv = new PdvProdutoIdentificacaoService({ db });
    const inclusaoPdv = carregarInclusaoPdv();
    for (const [nome, produto] of [['Açougue', gruposDepois.acougue[0]], ['Hortifruti', gruposDepois.hortifruti[0]]]) {
      for (const modoFiscal of [false, true]) {
        const resultado = await identificacaoPdv.identificar(produto.codigo, { origem: 'pdv', modoFiscal });
        assert.equal(resultado.encontrado, true, `${nome} pesquisável com F12 ${modoFiscal ? 'ON' : 'OFF'}`);
        const cadastro = await get('SELECT item_fiscal, controla_estoque FROM produtos WHERE id = ?', [produto.id]);
        assert.deepEqual(cadastro, { item_fiscal: 0, controla_estoque: 0 });
        inclusaoPdv.setModoFiscal(modoFiscal);
        const itemPdv = {
          ...resultado.produto,
          controla_estoque: cadastro.controla_estoque,
          saldo_fiscal: produto.saldo_fiscal,
          saldo_nao_fiscal: produto.saldo_nao_fiscal
        };
        assert.equal(inclusaoPdv.pdvPodeIniciarInclusaoProduto(itemPdv).sucesso, true,
          `${nome} pode ser incluído com F12 ${modoFiscal ? 'ON' : 'OFF'}`);
        assert.equal(inclusaoPdv.validarEstoqueVenda(itemPdv, 1, modoFiscal).sucesso, true,
          `${nome} valida venda com F12 ${modoFiscal ? 'ON' : 'OFF'}`);
      }
    }
    const fiscal = await identificacaoPdv.identificar('S17B-LEG-E', { origem: 'pdv', modoFiscal: true });
    assert.equal(fiscal.encontrado, true);
    assert.equal(Number((await get('SELECT item_fiscal FROM produtos WHERE id = ?', [e])).item_fiscal), 1);
    inclusaoPdv.setModoFiscal(true);
    assert.equal(inclusaoPdv.validarEstoqueVenda({
      ...fiscal.produto,
      controla_estoque: 1,
      saldo_fiscal: 30,
      saldo_nao_fiscal: 0
    }, 1, true).sucesso, true, 'produto fiscal continua funcionando com F12 ON');

    console.log('SPRINT17B_RESULTADO=PASS');
    console.log('SPRINT17B_NORMALIZADOS=4; ACOUGUE=2; HORTIFRUTI=2; BEBIDAS=0');
    console.log('SPRINT17B_INTEGRIDADE=saldo/reservas/outros campos OK; comprometimentos=N/A');
    console.log('SPRINT17B_NOVOS=OK; CATEGORIA=OK; PDV_F12_OFF_ON=OK');
  });
});
