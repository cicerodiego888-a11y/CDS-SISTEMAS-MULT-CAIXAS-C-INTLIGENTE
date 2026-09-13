/**
 * CFOP do cadastro de produto pela NF-e usa o padrão da empresa, não o da nota.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

describe('CFOP padrão da empresa no cadastro pela nota', () => {
  it('cadastro de produto aplica e cacheia cfop_padrao', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
    assert.match(src, /function obterCfopPadraoEmpresa/);
    assert.match(src, /function aplicarCfopPadraoEmpresaNoFormulario/);
    assert.match(src, /function resolverCfopSalvarNovoProduto/);
    assert.match(src, /miipPrefillXml/);
    assert.match(src, /resolverCfopSalvarNovoProduto/);
  });

  it('MIIP não copia CFOP da NF-e para o formulário quando há padrão da empresa', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/miip-central-revisao.js'), 'utf8');
    assert.match(src, /function aplicarCfopPadraoEmpresaNoCadastro/);
    assert.match(src, /Padrão fiscal da empresa/);
    assert.doesNotMatch(src, /setCampoTexto\('#cfop', xml\.cfop\)/);
  });
});
