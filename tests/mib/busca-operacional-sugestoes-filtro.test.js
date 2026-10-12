'use strict';

/**
 * Busca operacional — sugestões MIB filtradas pelo termo digitado.
 * Caso real: "poupa" trazia Arroz "Pop", Milho "Pula-Pula", Lava-Roupas e Osso de Sopa
 * (Levenshtein 2) como sugestões. A POLPA (distância 1) é a única sugestão legítima.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const {
  criarBuscaOperacionalProdutosService,
  sugestaoCompativelComTermo,
  normalizarNomeBusca
} = require('../../backend/services/busca-operacional-produtos');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

async function criarDb(nomes) {
  const db = new sqlite3.Database(':memory:');
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, codigo_barras TEXT, nome TEXT NOT NULL,
    nome_busca TEXT, preco_venda REAL DEFAULT 0, ativo INTEGER DEFAULT 1, item_fiscal INTEGER DEFAULT 1,
    categoria_id INTEGER, marca_id INTEGER)`);
  await run(db, `CREATE TABLE produto_identificadores (id INTEGER PRIMARY KEY AUTOINCREMENT, produto_id INTEGER,
    tipo TEXT, codigo TEXT, ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0)`);
  await run(db, 'CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)');
  await run(db, 'CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)');
  await run(db, `CREATE TABLE produto_atacado (id INTEGER PRIMARY KEY, produto_id INTEGER,
    preco_atacado REAL, quantidade_minima REAL)`);
  for (const nome of nomes) {
    await run(db, 'INSERT INTO produtos (codigo, nome, nome_busca) VALUES (?, ?, ?)', [
      `C${normalizarNomeBusca(nome).slice(0, 10)}`, nome, normalizarNomeBusca(nome)
    ]);
  }
  return db;
}

const INDEVIDOS_POUPA = [
  { id: 611, nome: 'Arroz Branco Tipo 1 Pop 1 kg', _fuzzyDist: 2, _matchTipo: { fuzzy: true } },
  { id: 610, nome: 'Arroz Parboilizado Tipo 2 Pop 1 kg', _fuzzyDist: 2, _matchTipo: { fuzzy: true } },
  { id: 600, nome: 'Milho para Pipoca Kimimo Pula-Pula 400 g', _fuzzyDist: 2, _matchTipo: { fuzzy: true } },
  { id: 779, nome: 'Lava-Roupas em Pó ALA Lavanda 800g', _fuzzyDist: 2, _matchTipo: { fuzzy: true } },
  { id: 774, nome: 'Tira-Manchas em Pó Tixan Ypê Roupas Brancas e Coloridas 380g', _fuzzyDist: 2, _matchTipo: { fuzzy: true } },
  { id: 972, nome: 'Prendedor de Roupas Plastico', _fuzzyDist: 2, _matchTipo: { fuzzy: true } },
  { id: 735, nome: 'Osso de Sopa', _fuzzyDist: 2, _matchTipo: { fuzzy: true } }
];
const POLPA = { id: 1300, nome: 'POLPA MARACUJA 400G', _fuzzyDist: 1, _matchTipo: { fuzzy: true } };

test('"poupa" mantém POLPA MARACUJA 400G e remove as sugestões com distância não permitida', async () => {
  const db = await criarDb(['POLPA MARACUJA 400G', ...INDEVIDOS_POUPA.map((p) => p.nome)]);
  const svc = criarBuscaOperacionalProdutosService(db, {
    buscarSugestoesMib: async () => [POLPA, ...INDEVIDOS_POUPA]
  });
  const r = await svc.buscar({ q: 'poupa', incluirSugestoes: true });
  assert.strictEqual(r.itens.length, 0);
  assert.strictEqual(r.meta.mib_consultado, true);
  assert.deepStrictEqual(r.sugestoes.map((p) => p.nome), ['POLPA MARACUJA 400G']);
  assert.strictEqual(r.meta.sugestoes_descartadas, INDEVIDOS_POUPA.length);
  db.close();
});

test('sinônimo, preferência e _fuzzyDist ausente ou falso não contornam a regra', async () => {
  const db = await criarDb(['Produto qualquer']);
  const svc = criarBuscaOperacionalProdutosService(db, {
    buscarSugestoesMib: async () => [
      { id: 1, nome: 'Arroz Branco Tipo 1 Pop 1 kg', _matchTipo: { sinonimo: true, tokens: 1 } },
      { id: 2, nome: 'Milho para Pipoca Kimimo Pula-Pula 400 g', _matchTipo: { preferencia: true } },
      { id: 3, nome: 'Osso de Sopa', _fuzzyDist: 0 },
      { id: 4, nome: 'Lava-Roupas em Pó ALA Lavanda 800g' },
      { id: 5, nome: 'POLPA MARACUJA 400G' }
    ]
  });
  const r = await svc.buscar({ q: 'poupa', incluirSugestoes: true });
  assert.deepStrictEqual(r.sugestoes.map((p) => p.id), [5]);
  db.close();
});

test('erros de digitação legítimos continuam sugeridos', () => {
  const casos = [
    ['arros', 'Arroz Branco Tipo 1 Pop 1 kg'],
    ['fejao', 'Feijão Carioca Tipo 1 Precioso 1 kg'],
    ['detergnte', 'Detergente Líquido Ypê Neutro 500 ml'],
    ['leite condensdo', 'Leite Condensado Italac 395g'],
    ['PICOLE CERMOSO', 'PICOLE CREMOSO']
  ];
  for (const [termo, nome] of casos) {
    assert.strictEqual(sugestaoCompativelComTermo({ nome }, termo), true, `${termo} -> ${nome}`);
  }
});

test('sugestões sem relação com o termo são removidas', () => {
  const casos = [
    ['poupa', 'ROUPA INFANTIL'],
    ['arros', 'Aroma Artificial de Baunilha 30 ml MIX'],
    ['fejao', 'Melão'],
    ['macarao', 'Detergente Líquido Ypê Maçã 500 ml']
  ];
  for (const [termo, nome] of casos) {
    assert.strictEqual(sugestaoCompativelComTermo({ nome }, termo), false, `${termo} -> ${nome}`);
  }
});

test('tela Produtos não reconsulta o MIB quando o servidor já filtrou as sugestões', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
  const inicio = src.indexOf('async function executarBuscaProdutosViaMib');
  assert.ok(inicio >= 0);
  const corpo = src.slice(inicio, src.indexOf('function agendarBuscaProdutosMib', inicio));
  assert.match(corpo, /const mibJaConsultado = !!\(dados\.meta && dados\.meta\.mib_consultado\);/);
  assert.match(corpo, /if \(!possuiSugestao && !mibJaConsultado && sdk && typeof sdk\.search === 'function'\)/);
});

test('termo numérico só aceita sugestão com identificador igual', () => {
  assert.strictEqual(sugestaoCompativelComTermo({ nome: 'Item', codigo_barras: '123' }, '0123'), true);
  assert.strictEqual(sugestaoCompativelComTermo({ nome: 'Item 0123', codigo: '999' }, '0123'), false);
});
