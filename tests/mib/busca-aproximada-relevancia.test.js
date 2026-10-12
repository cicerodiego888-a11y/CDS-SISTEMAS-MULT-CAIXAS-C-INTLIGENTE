'use strict';

/**
 * Busca aproximada: candidato relevante não pode sumir pela posição no catálogo,
 * e as sugestões filtradas saem ordenadas por relevância.
 * Caso real: "palpa" — POLPA MARACUJA 400G (recém-cadastrada, fim do catálogo) ficava
 * depois do 60º candidato aceito e nunca era examinada.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const sqlite3 = require('sqlite3');

const SearchAI = require('../../backend/motores/mib/ai/SearchAI');
const { normalizarNomeBusca } = require('../../backend/motores/mib/core/normalizarNomeBusca');
const {
  criarBuscaOperacionalProdutosService,
  avaliarSugestao
} = require('../../backend/services/busca-operacional-produtos');

function motorCom(nomes) {
  const lista = nomes.map((nome, i) => ({ id: i + 1, nome, nome_busca: normalizarNomeBusca(nome), preco: 1 }));
  const config = { ativarFuzzy: true, sensibilidadeLevenshtein: 2 };
  return new SearchAI({
    sinonimos: { expandir: (t) => t },
    learning: {},
    catalog: { ativo: () => ({ lista }) },
    config: { get: (k) => config[k] }
  });
}

// "pasta" fica a 2 edições de "palpa": aceito pelo fuzzy, mas menos relevante que "polpa"/"palha" (1 edição).
const PASTAS = Array.from({ length: 70 }, (_, i) => `PASTA SABOR ${i + 1}`);

test('motor: POLPA no fim do catálogo, depois de 70 candidatos aceitos, continua sendo encontrada', () => {
  const ai = motorCom([...PASTAS, 'BATATA PALHA YOKI 105G', ...PASTAS.map((n) => `${n} B`), 'POLPA MARACUJA 400G']);
  const r = ai.buscarFuzzy('palpa', { limite: 20 });
  assert.strictEqual(r.itens.length, 20);
  assert.deepStrictEqual(r.itens.slice(0, 2).map((p) => p.nome), ['BATATA PALHA YOKI 105G', 'POLPA MARACUJA 400G']);
  assert.ok(r.itens.slice(0, 2).every((p) => p._fuzzyDist === 1));
  assert.ok(r.itens.slice(2).every((p) => p._fuzzyDist === 2));
  assert.ok(r.sugestoes.includes('POLPA MARACUJA 400G'));
});

test('motor: limite final respeitado e empate mantém a ordem do catálogo', () => {
  const ai = motorCom([...PASTAS, 'POLPA GOIABA 400G', 'POLPA MARACUJA 400G']);
  const r = ai.buscarFuzzy('palpa', { limite: 5 });
  assert.strictEqual(r.itens.length, 5);
  assert.deepStrictEqual(r.itens.map((p) => p.nome), [
    'POLPA GOIABA 400G', 'POLPA MARACUJA 400G', 'PASTA SABOR 1', 'PASTA SABOR 2', 'PASTA SABOR 3'
  ]);
});

test('motor: correspondência de distância 0 vem antes das aproximadas', () => {
  const ai = motorCom(['PASTA DE ALHO', 'PALHA DE ACO', 'PALPA DOCE']);
  const r = ai.buscarFuzzy('palpa', { limite: 20 });
  assert.deepStrictEqual(r.itens.map((p) => [p.nome, p._fuzzyDist]), [
    ['PALPA DOCE', 0], ['PALHA DE ACO', 1], ['PASTA DE ALHO', 2]
  ]);
});

async function criarDb() {
  const db = new sqlite3.Database(':memory:');
  const run = (sql) => new Promise((res, rej) => db.run(sql, (e) => (e ? rej(e) : res())));
  await run(`CREATE TABLE produtos (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, codigo_barras TEXT,
    nome TEXT NOT NULL, nome_busca TEXT, preco_venda REAL DEFAULT 0, ativo INTEGER DEFAULT 1,
    item_fiscal INTEGER DEFAULT 1, categoria_id INTEGER, marca_id INTEGER)`);
  await run(`CREATE TABLE produto_identificadores (id INTEGER PRIMARY KEY AUTOINCREMENT, produto_id INTEGER,
    tipo TEXT, codigo TEXT, ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0)`);
  await run('CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)');
  await run('CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)');
  await run('CREATE TABLE produto_atacado (id INTEGER PRIMARY KEY, produto_id INTEGER, preco_atacado REAL, quantidade_minima REAL)');
  return db;
}

async function sugestoesPara(termo, recebidas) {
  const db = await criarDb();
  const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => recebidas });
  const r = await svc.buscar({ q: termo, incluirSugestoes: true });
  db.close();
  return r;
}

test('serviço: "palpa" prioriza POLPA e descarta o que não passa na regra estrita', async () => {
  // Ordem em que o MIB entrega (ranking do motor), como na reprodução da cópia isolada.
  const recebidas = [
    { id: 554, nome: 'Batata Palha Yoki Tradicional 105g', _fuzzyDist: 1 },
    { id: 10, nome: 'Limpa Forno Força Azul Pasta 230 g', _fuzzyDist: 2 },
    { id: 11, nome: 'Papel Higiênico Noble Folha Dupla 12 Rolos 20 m', _fuzzyDist: 2 },
    { id: 650, nome: 'Sal Parrilla Gourmet 500 g Lebre', _fuzzyDist: 1 },
    { id: 873, nome: 'Sal Parrilha Chef Nobre C/pimenta 400gr', _fuzzyDist: 1 },
    { id: 785, nome: 'BATATA PALHA VALOR 100G', _fuzzyDist: 1 },
    { id: 1211, nome: 'POLPA MARACUJA 400G', _fuzzyDist: 1 }
  ];
  const r = await sugestoesPara('palpa', recebidas);
  assert.strictEqual(r.itens.length, 0);
  assert.deepStrictEqual(r.sugestoes.map((p) => p.nome), [
    'POLPA MARACUJA 400G',
    'Batata Palha Yoki Tradicional 105g',
    'BATATA PALHA VALOR 100G'
  ]);
  assert.strictEqual(r.meta.sugestoes_descartadas, 4);
});

test('serviço: _fuzzyDist não decide a ordem; distância é recalculada pelo nome', async () => {
  const r = await sugestoesPara('palpa', [
    { id: 1, nome: 'Batata Palha Yoki Tradicional 105g', _fuzzyDist: 0 },
    { id: 2, nome: 'POLPA MARACUJA 400G' },
    { id: 3, nome: 'Osso de Sopa', _fuzzyDist: 0, _matchTipo: { sinonimo: true } }
  ]);
  assert.deepStrictEqual(r.sugestoes.map((p) => p.id), [2, 1]);
});

test('serviço: menor distância primeiro, depois a palavra mais próxima do início do nome', async () => {
  const r = await sugestoesPara('arros', [
    { id: 1, nome: 'Mucilon Arroz Sachê 180 g' },
    { id: 2, nome: 'Arroz Branco Tipo 1 Pop 1 kg' },
    { id: 3, nome: 'ARROS DOCE ARTESANAL' },
    { id: 4, nome: 'Arrozina Tradicional 180 g' }
  ]);
  assert.deepStrictEqual(r.sugestoes.map((p) => p.id), [3, 2, 4, 1]);
});

test('serviço: termo com várias palavras soma distância e posição', () => {
  const principal = avaliarSugestao({ nome: 'Leite Condensado Italac 395g' }, 'leite condensdo');
  const secundario = avaliarSugestao({ nome: 'Doce de Leite Condensado 400g' }, 'leite condensdo');
  assert.deepStrictEqual(principal, { distancia: 1, posicao: 1 });
  assert.deepStrictEqual(secundario, { distancia: 1, posicao: 5 });
  assert.strictEqual(avaliarSugestao({ nome: 'Sal Parrilha Chef Nobre' }, 'palpa'), null);
});

test('serviço: limite final das sugestões é respeitado', async () => {
  const recebidas = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, nome: `POLPA SABOR ${i + 1}` }));
  const r = await sugestoesPara('palpa', recebidas);
  assert.strictEqual(r.sugestoes.length, 20);
  assert.deepStrictEqual(r.sugestoes.map((p) => p.id), recebidas.slice(0, 20).map((p) => p.id));
});
