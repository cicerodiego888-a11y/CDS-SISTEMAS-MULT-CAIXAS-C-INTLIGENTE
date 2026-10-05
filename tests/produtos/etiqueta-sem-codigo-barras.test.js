'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EtiquetaProduto = require('../../frontend/erp/js/etiquetaProduto');

const produto = {
  id: 1,
  nome: 'Café Teste',
  preco_venda: 12.5,
  codigo: 'A123',
  unidade: 'UN'
};

test('permite montar e imprimir etiqueta sem código de barras', () => {
  assert.equal(EtiquetaProduto.validarProduto(produto), null);
  const html = EtiquetaProduto.montarHtml(produto, '');
  assert.match(html, /class="etiqueta sem-codigo-barras"/);
  assert.match(html, /Café Teste/);
  assert.match(html, /R\$: 12,50/);
  assert.doesNotMatch(html, /class="barcode-area"/);
});

test('continua exigindo SVG quando o produto possui código de barras', () => {
  assert.throws(
    () => EtiquetaProduto.montarHtml({ ...produto, codigo_barras: '7891234567890' }, ''),
    /Não foi possível gerar o código de barras/
  );
  const html = EtiquetaProduto.montarHtml(
    { ...produto, codigo_barras: '7891234567890' },
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  );
  assert.match(html, /class="barcode-area"/);
});