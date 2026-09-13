/**
 * Botão Buscar do PDV abre a consulta F1, com visualização por categoria ou nomes.
 * node --test tests/pdv/consulta-f1-botao-buscar.test.js
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PDV_JS = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
const BUSCA_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/pdvBuscaProduto.js'), 'utf8');

describe('PDV — Botão Buscar abre consulta F1', () => {
  it('Enter no campo principal continua confirmando o produto (bípador)', () => {
    assert.match(BUSCA_JS, /if \(event\.key === 'Enter'\)/);
    assert.match(BUSCA_JS, /confirmarEntrada\(\)/);
  });

  it('botão Buscar abre a consulta F1 em vez de adicionar direto', () => {
    assert.match(BUSCA_JS, /abrirConsultaProdutosPdvDoCampoBusca/);
    assert.match(BUSCA_JS, /abrirConsultaProdutosPDV/);
    assert.doesNotMatch(
      BUSCA_JS,
      /btnBuscar\.addEventListener\('click', \(\) => confirmarEntrada\(\)\)/
    );
    assert.match(PDV_JS, /\$\('#btnBuscarProdutoPdv'\)[\s\S]*abrirConsultaProdutosPdvDoCampoBusca/);
    assert.match(PDV_JS, /if \(e\.key === 'F1'\)[\s\S]*abrirConsultaProdutosPdvDoCampoBusca/);
  });

  it('consulta F1 tem opção por categoria ou apenas nomes', () => {
    assert.match(PDV_JS, /btnConsultaPdvPorCategoria/);
    assert.match(PDV_JS, /btnConsultaPdvPorNome/);
    assert.match(PDV_JS, /Por categoria/);
    assert.match(PDV_JS, /Apenas nomes/);
    assert.match(PDV_JS, /function carregarNomesConsultaPDV/);
    assert.match(PDV_JS, /function renderizarProdutosConsultaPDVPorCategoria/);
    assert.match(PDV_JS, /pdv_consulta_f1_modo/);
  });
});
