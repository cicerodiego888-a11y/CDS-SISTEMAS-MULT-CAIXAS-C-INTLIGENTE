/**
 * V1.0.13 — refresh automático da Lista de Produtos após Importação Inicial.
 * Executar: node --test tests/produtos/importacao-inicial-refresh-lista-v1013.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('V1.0.13 — refresh Lista de Produtos após importação', () => {
  it('executarImportacaoInicialProdutos chama loadProdutos somente após sucesso', () => {
    const src = fs.readFileSync(
      path.join(root, 'frontend/erp/js/importacao-inicial-produtos.js'),
      'utf8'
    );
    const fn = src.match(/async function executarImportacaoInicialProdutos\(\)[\s\S]*?(?=\nwindow\.loadImportacaoInicialProdutos)/);
    assert.ok(fn, 'função executarImportacaoInicialProdutos não encontrada');
    const corpo = fn[0];

    assert.match(corpo, /if\s*\(\s*!resp\.ok\s*\|\|\s*!data\.sucesso\s*\)/);
    assert.match(corpo, /typeof loadProdutos === 'function'/);
    assert.match(corpo, /await refresh/);
    assert.equal(/location\.reload\s*\(/.test(corpo), false);

    const idxThrow = corpo.indexOf('throw new Error');
    const idxLoad = corpo.indexOf("typeof loadProdutos === 'function'");
    const idxCatch = corpo.indexOf('} catch (err)');
    assert.ok(idxThrow >= 0 && idxLoad > idxThrow, 'loadProdutos deve ocorrer após confirmação de sucesso');
    assert.ok(idxCatch > idxLoad, 'loadProdutos deve ficar no try (antes do catch)');
    assert.equal(/loadProdutos/.test(corpo.slice(idxCatch)), false, 'erro não deve disparar loadProdutos');
  });

  it('loadProdutos retorna o $.ajax (thenable) sem novo endpoint/cache', () => {
    const src = fs.readFileSync(path.join(root, 'frontend/erp/js/produtos.js'), 'utf8');
    const fn = src.match(/function loadProdutos\([^)]*\)[\s\S]*?window\.loadProdutos = loadProdutos;/);
    assert.ok(fn, 'função loadProdutos não encontrada');
    assert.match(fn[0], /return\s+\$\.ajax\s*\(/);
    assert.match(fn[0], /\/produtos\?modo_fiscal=/);
    assert.match(fn[0], /window\.produtosList\s*=/);
    assert.match(fn[0], /renderProdutos\s*\(\s*window\.produtosList\s*\)/);
    assert.match(fn[0], /atualizarListagemProdutosSemRemontarShell/);
  });
});
