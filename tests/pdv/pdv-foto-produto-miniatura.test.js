/**
 * PDV — miniatura + lightbox de foto do produto (somente UI).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pdvJsPath = path.join(__dirname, '../../frontend/pdv/js/pdv.js');
const source = fs.readFileSync(pdvJsPath, 'utf8');

assert.match(source, /function urlImagemProdutoPdv\s*\(/);
assert.match(source, /function abrirFotoProdutoPdv\s*\(/);
assert.match(source, /function fecharFotoProdutoPdv\s*\(/);
assert.match(source, /class="pdv-produto-miniatura"/);
assert.match(source, /pdvFotoProdutoOverlay/);
assert.match(source, /stopPropagation/);
assert.match(source, /Escape/);

// Extrai e executa apenas os helpers de URL (sem DOM completo do PDV)
const urlFnMatch = source.match(
  /function urlImagemProdutoPdv\(path\) \{[\s\S]*?\n\}/
);
assert.ok(urlFnMatch, 'urlImagemProdutoPdv deve existir');

const sandbox = { module: {}, exports: {} };
vm.runInNewContext(`${urlFnMatch[0]}; module.exports = { urlImagemProdutoPdv };`, sandbox);
const { urlImagemProdutoPdv } = sandbox.module.exports;

assert.equal(urlImagemProdutoPdv(''), '');
assert.equal(urlImagemProdutoPdv(null), '');
assert.equal(urlImagemProdutoPdv('javascript:alert(1)'), '');
assert.equal(urlImagemProdutoPdv('data:text/html,x'), '');
assert.equal(urlImagemProdutoPdv('/storage/produtos/a.jpg'), '/storage/produtos/a.jpg');
assert.equal(urlImagemProdutoPdv('storage/produtos/a.jpg'), '/storage/produtos/a.jpg');
assert.equal(urlImagemProdutoPdv('https://cdn.exemplo/a.jpg'), 'https://cdn.exemplo/a.jpg');

const cssPath = path.join(__dirname, '../../frontend/css/pdv.css');
const css = fs.readFileSync(cssPath, 'utf8');
assert.match(css, /\.pdv-produto-miniatura\s*\{/);
assert.match(css, /cursor:\s*pointer/);
assert.match(css, /\.pdv-foto-overlay\s*\{/);
assert.match(css, /object-fit:\s*contain/);
assert.match(css, /90vw/);
assert.match(css, /90vh/);

console.log('OK pdv-foto-produto-miniatura');
