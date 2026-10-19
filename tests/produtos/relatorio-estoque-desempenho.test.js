'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Relatório de estoque — desempenho', () => {
  it('consulta última compra em JOIN agregado, sem p.* e sem subquery por produto', () => {
    const src = read('backend/rotas/produtos.js');
    const inicio = src.indexOf("router.get('/relatorio-estoque'");
    const fim = src.indexOf("router.get('/mib/health'", inicio);
    const rota = src.slice(inicio, fim > inicio ? fim : inicio + 8000);

    assert.match(rota, /GROUP BY ci\.produto_id/);
    assert.match(rota, /LEFT JOIN \(/);
    assert.doesNotMatch(rota, /SELECT\s+p\.\*/);
    assert.doesNotMatch(rota, /SELECT MAX\(c2\.data_compra\)/);
    assert.doesNotMatch(rota, /normalizarProdutoResposta/);
  });

  it('impressão usa arquivo temporário e não clona o HTML do modal', () => {
    const electron = read('electron-janelas-modulo.js');
    const handler = electron.slice(
      electron.indexOf('function registrarIpcImprimirRelatorioHtml'),
      electron.indexOf('function registrarIpcAbrirComprovante')
    );
    assert.match(handler, /win\.loadFile\(tmp\)/);
    assert.match(handler, /writeFile\(tmp, html/);
    assert.doesNotMatch(handler, /encodeURIComponent\(html\)/);
    assert.match(handler, /document\.fonts\.ready/);
    assert.match(handler, /requestAnimationFrame/);
    assert.match(handler, /rendered\.items !== rendered\.expectedItemRows/);
    assert.match(handler, /rendered\.officialTotals !== rendered\.expectedPurchases/);
    assert.match(handler, /webContents\.print\(\{ silent: false, printBackground: true \}, \(success, failureReason\)/);
    assert.match(handler, /if \(win && !win\.isDestroyed\(\)\) win\.destroy\(\)/);
    assert.match(handler, /await fs\.promises\.rm\(tempDir, \{ recursive: true \}\)/);

    const produtos = read('frontend/erp/js/produtos.js');
    const printFn = produtos.slice(
      produtos.indexOf('function printRelatorioEstoqueProdutos'),
      produtos.indexOf('function garantirModalRelatorioEstoque')
    );
    assert.match(printFn, /__cdsRelatorioEstoqueItens/);
    assert.doesNotMatch(printFn, /modal-body/);
    assert.match(produtos, /formatarColunaEstoqueRelatorio/);
  });
});
