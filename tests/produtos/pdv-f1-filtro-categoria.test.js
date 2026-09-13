/**
 * PDV F1 — filtro por categoria_id em GET /api/produtos
 * Regressão: accordion Bebidas não pode listar produtos de outra categoria.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function test(nome, fn) {
  try {
    fn();
    console.log(`  OK  ${nome}`);
    return true;
  } catch (err) {
    console.error(`  FALHOU  ${nome}`);
    console.error(`    ${err.message}`);
    return false;
  }
}

const produtosRoute = fs.readFileSync(
  path.join(__dirname, '../../backend/rotas/produtos.js'),
  'utf8'
);
const pdvJs = fs.readFileSync(
  path.join(__dirname, '../../frontend/pdv/js/pdv.js'),
  'utf8'
);

const inicioListar = produtosRoute.indexOf('// LISTAR PRODUTOS');
const fimListar = produtosRoute.indexOf("router.get('/catalogo-versao'");
assert.ok(inicioListar >= 0 && fimListar > inicioListar, 'bloco LISTAR PRODUTOS não encontrado');
const blocoListar = produtosRoute.slice(inicioListar, fimListar);

let ok = 0;
let fail = 0;

if (test('GET /produtos aplica filtro p.categoria_id', () => {
  assert.ok(blocoListar.includes('req.query.categoria_id'));
  assert.ok(blocoListar.includes('p.categoria_id = ?'));
})) ok++; else fail++;

if (test('GET /produtos aplica filtro p.subcategoria_id opcional', () => {
  assert.ok(blocoListar.includes('req.query.subcategoria_id'));
  assert.ok(blocoListar.includes('p.subcategoria_id = ?'));
})) ok++; else fail++;

if (test('F1 PDV filtra defensivamente por categoria_id no cliente', () => {
  assert.ok(pdvJs.includes('toggleProdutosCategoria'));
  assert.ok(pdvJs.includes("String(p.categoria_id || '') === String(categoriaId)"));
})) ok++; else fail++;

if (test('Filtro lógico: Bebidas não inclui açougue', () => {
  const categoriaBebidas = 2;
  const lista = [
    { id: 1, nome: 'Coca cola 1L', categoria_id: 2 },
    { id: 2, nome: 'Carne de Hamburger Friato', categoria_id: 1 },
    { id: 3, nome: 'Fanta Laranja 2L', categoria_id: 2 },
    { id: 4, nome: 'Empanado Friato', categoria_id: 1 }
  ];
  const filtrados = lista.filter((p) => String(p.categoria_id || '') === String(categoriaBebidas));
  assert.strictEqual(filtrados.length, 2);
  assert.ok(filtrados.every((p) => p.categoria_id === 2));
  assert.ok(!filtrados.some((p) => /Hamburger|Empanado/i.test(p.nome)));
})) ok++; else fail++;

console.log(`Resultado: ${ok} OK, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
